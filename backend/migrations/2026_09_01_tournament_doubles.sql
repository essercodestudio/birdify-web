-- 2026-09-01: Torneio em Duplas / Scramble (Onda B · Bloco 3 · Fase B.1 · Commit B1.1)
--
-- MOTIVO: torneios em DUPLA compartilham 1 scorecard e 1 resultado por buraco
-- entre 2 jogadores. Feature ortogonal ao scoring_type da Onda A — funciona
-- tanto com 'strokes' quanto com 'result_points'. Decisao arquitetural
-- consolidada em [[project-todo-scoring-duplas-onda-b]] e no plano do Bloco 3.
--
-- ESCOPO desta migration:
--   1. tournaments.modality ENUM('individual','doubles') DEFAULT 'individual'
--   2. tournament_duplas (id, tournament_id, dupla_name, handicap)
--   3. tournament_dupla_players (dupla_id, user_id) — 1 user por dupla
--      + UNIQUE composto pra evitar mesmo user em 2 duplas do mesmo torneio
--   4. group_duplas (group_id, dupla_id, handicap) — dupla escalada no grupo
--   5. scores.user_id NOT NULL -> NULL  (dono agora eh user OU dupla)
--   6. scores.dupla_id INT NULL + FK CASCADE
--   7. DROP uk_score (4-col) + CREATE UNIQUE (5-col com dupla_id)
--   8. tournament_scorecard_signatures.dupla_id INT NULL + FK CASCADE
--      + DROP uk_sig (4-col: tid, gid, uid, round) + CREATE UNIQUE (5-col)
--   9. admin_score_audit.target_dupla_id ganha FK (coluna JA existe da Onda A)
--
-- IDEMPOTENCIA: mesmo padrao das migrations anteriores. Checa
-- information_schema/existencia antes de cada DDL. Rodar 2x eh safe.
--
-- GUARDA DE DADOS (destrutivo controlado): antes de DROP uk_score + CREATE
-- novo, faz SELECT COUNT GROUP BY na tupla (tid, uid, hole, round) HAVING
-- COUNT>1 — se >0, ABORTA com SIGNAL SQLSTATE '45000' pra impedir migration
-- num banco divergente. UNIQUE novo trata NULL como distinto entao aceita
-- ambos NULL, mas se ja tem duplicata na 4-col antiga o CREATE quebra
-- silenciosamente E o banco fica sem UNIQUE (perigo pra saveScore).
--
-- COMPATIBILIDADE: torneios existentes ganham modality='individual' via
-- DEFAULT. Scores.user_id continua sendo populado normalmente (backend
-- so grava dupla_id em torneios doubles). Nenhum torneio existente
-- muda de comportamento.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. GUARDA — aborta se ja houver duplicatas na chave 4-col
-- ═══════════════════════════════════════════════════════════════════════════
-- Se esta contagem for > 0, o banco tem estado inconsistente que o UNIQUE
-- atual (uk_score) deveria bloquear mas nao bloqueou (bug legado ou UNIQUE
-- perdido em migration anterior). A migration Onda B nao deve prosseguir —
-- corrija a divergencia antes.
SET @dups := (
  SELECT COUNT(*) FROM (
    SELECT tournament_id, user_id, hole_number, round_number
      FROM scores
     GROUP BY tournament_id, user_id, hole_number, round_number
    HAVING COUNT(*) > 1
  ) x
);
-- Nota: SIGNAL SQLSTATE dentro de PREPARE nao eh suportado por drivers como
-- mysql2 (funciona so via CLI). Pra abortar em QUALQUER cliente, tenta INSERT
-- numa tabela deliberadamente inexistente com nome descritivo — gera
-- ER_NO_SUCH_TABLE com mensagem que qualquer operador entende no traceback.
SET @sql := IF(@dups > 0,
  CONCAT("INSERT INTO abort_scores_", @dups, "_duplicatas_corrija_antes VALUES (1)"),
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournaments.modality
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'modality');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN modality ENUM('individual','doubles') NOT NULL DEFAULT 'individual' AFTER scoring_type",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. tournament_duplas
-- ═══════════════════════════════════════════════════════════════════════════
-- Nome livre digitado pelo admin (ex: "Joao e Pedro"). handicap eh o handicap
-- combinado da dupla, confirmado no lobby igual ao individual.
CREATE TABLE IF NOT EXISTS tournament_duplas (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id  INT NOT NULL,
  dupla_name     VARCHAR(100) NOT NULL,
  handicap       DECIMAL(4,1) NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_td_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_td_tourn (tournament_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. tournament_dupla_players
-- ═══════════════════════════════════════════════════════════════════════════
-- 2 linhas por dupla (uma por jogador). UNIQUE composto (dupla_id, user_id) evita
-- inserir mesmo user duas vezes na mesma dupla. Um segundo UNIQUE em
-- (tournament_id, user_id) — via tabela desnormalizada — seria necessario pra
-- impedir user em 2 duplas do MESMO torneio, mas isso violaria BCNF. Solucao
-- pratica: validacao no controller (SELECT 1 WHERE outro dupla_id do mesmo
-- tournament ja tem esse user).
CREATE TABLE IF NOT EXISTS tournament_dupla_players (
  dupla_id  INT NOT NULL,
  user_id   INT NOT NULL,
  PRIMARY KEY (dupla_id, user_id),
  CONSTRAINT fk_tdp_dupla FOREIGN KEY (dupla_id) REFERENCES tournament_duplas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tdp_user  FOREIGN KEY (user_id)  REFERENCES users(id)             ON DELETE CASCADE,
  INDEX idx_tdp_user (user_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. group_duplas
-- ═══════════════════════════════════════════════════════════════════════════
-- Espelho de group_players para duplas. Handicap por dupla POR grupo (mesmo
-- padrao do individual: handicap re-declarado por rodada, ver Bloco D).
CREATE TABLE IF NOT EXISTS group_duplas (
  group_id  INT NOT NULL,
  dupla_id  INT NOT NULL,
  handicap  DECIMAL(4,1) NULL,
  PRIMARY KEY (group_id, dupla_id),
  CONSTRAINT fk_gd_group FOREIGN KEY (group_id) REFERENCES tournament_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_gd_dupla FOREIGN KEY (dupla_id) REFERENCES tournament_duplas(id) ON DELETE CASCADE,
  INDEX idx_gd_dupla (dupla_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. scores.user_id NOT NULL -> NULL
-- ═══════════════════════════════════════════════════════════════════════════
-- Score agora tem dono XOR: user_id preenchido em torneios individual, dupla_id
-- em torneios doubles. Sem CHECK cross-cell (MySQL 8 respeita mas ainda evitamos
-- pra manter migration simples) — enforcement no controller.
SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME = 'scores'
                     AND COLUMN_NAME = 'user_id');
SET @sql := IF(@nullable = 'NO',
  'ALTER TABLE scores MODIFY COLUMN user_id INT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. scores.dupla_id
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'scores'
                   AND COLUMN_NAME = 'dupla_id');
SET @sql := IF(@exists = 0,
  'ALTER TABLE scores ADD COLUMN dupla_id INT NULL AFTER user_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK separada (idempotente): so cria se nao existir ainda
SET @fkExists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME  = 'scores'
                     AND CONSTRAINT_NAME = 'fk_scores_dupla');
SET @sql := IF(@fkExists = 0,
  'ALTER TABLE scores ADD CONSTRAINT fk_scores_dupla FOREIGN KEY (dupla_id) REFERENCES tournament_duplas(id) ON DELETE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indice separado
SET @idxExists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME  = 'scores'
                      AND INDEX_NAME  = 'idx_scores_dupla');
SET @sql := IF(@idxExists = 0,
  'ALTER TABLE scores ADD INDEX idx_scores_dupla (dupla_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. DROP uk_score (4-col) + CREATE UNIQUE novo via COLUNA GERADA
-- ═══════════════════════════════════════════════════════════════════════════
-- DECISAO REVERTIDA (2026-09-01): a estrategia inicial "UNIQUE 5-col com NULL
-- distinto" (tid, user_id, dupla_id, hole, round) NAO funciona — MySQL trata
-- CADA NULL como distinto, entao 2 rows (tid, NULL, dupla=D1, 1, 1) sao
-- consideradas distintas mesmo tendo TUDO igual exceto o NULL de user_id.
-- Comprovado no verify-doubles-migration.js: UNIQUE 5-col aceita 2 rows
-- da MESMA dupla no mesmo hole/round.
--
-- Solucao correta: coluna gerada STORED que colapsa user_id e dupla_id num
-- unico BIGINT — user_id (positivo) e -dupla_id (negativo) nunca colidem
-- (users e duplas tem sequences independentes; user 5 != -dupla 5). Assim
-- o UNIQUE fica sobre valores NAO-NULL e rejeita corretamente.
--
-- CHECK opcional (nao adicionado aqui): user_id XOR dupla_id (exatamente um
-- preenchido). Enforcement no controller ja garante — evita CHECK cross-cell
-- que polui o schema.

-- 7a. Drop uk_score legado (4-col) se ainda existir
SET @oldExists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME  = 'scores'
                      AND INDEX_NAME  = 'uk_score');
SET @sql := IF(@oldExists > 0,
  'ALTER TABLE scores DROP INDEX uk_score',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7b. Drop uk_score_v2 antiga (5-col direto sem coluna gerada) se veio de
-- migration anterior (rodar migration 2x em local antes desta correcao).
SET @oldV2 := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'scores'
                   AND INDEX_NAME  = 'uk_score_v2'
                   AND COLUMN_NAME = 'dupla_id');
-- Se o UNIQUE atual tem dupla_id como coluna direta (versao 5-col ruim),
-- drop pra recriar sobre entity_ref.
SET @sql := IF(@oldV2 > 0,
  'ALTER TABLE scores DROP INDEX uk_score_v2',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7c. Coluna entity_ref REAL (nao GENERATED) INT NOT NULL. Preenchida pelo
-- backend em cada INSERT/UPSERT — controller passa entity_ref = user_id (torneio
-- individual) OU -dupla_id (torneio doubles). Users positivos, -dupla_id
-- negativo, namespaces nao colidem.
--
-- DESCARTAMOS coluna GENERATED STORED porque MySQL PROIBE index/unique em
-- coluna gerada cujas bases (user_id, dupla_id) tenham FK CASCADE — o erro eh
-- ER_CANNOT_ADD_FOREIGN. Nossas FKs de user_id/dupla_id sao CASCADE (semantica
-- LGPD: apagar user apaga scores dele). Manter CASCADE + usar coluna real
-- preenchida pelo controller eh o menor mal.
--
-- Enforcement: NOT NULL faz o INSERT sem entity_ref falhar ruidosamente.
-- Bug potencial: se controller esquecer de setar em UPDATE, entity_ref fica
-- inconsistente com user_id/dupla_id — mas nao ha UPDATE de user_id/dupla_id
-- em scores no codebase atual (so INSERT ou DELETE), entao risco baixo.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'scores'
                   AND COLUMN_NAME = 'entity_ref');
-- Adiciona NULLABLE inicialmente pra permitir backfill.
SET @sql := IF(@exists = 0,
  'ALTER TABLE scores ADD COLUMN entity_ref INT NULL AFTER dupla_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7d. Backfill: scores existentes (todos individuais) tem user_id preenchido
-- e dupla_id NULL — entity_ref = user_id. UPDATE em WHERE entity_ref IS NULL
-- eh idempotente (segunda execucao afeta 0 linhas).
UPDATE scores SET entity_ref = COALESCE(user_id, -dupla_id) WHERE entity_ref IS NULL;

-- 7e. Depois do backfill, promove pra NOT NULL. Se ja for NOT NULL, DO 0.
SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME  = 'scores'
                     AND COLUMN_NAME = 'entity_ref');
SET @sql := IF(@nullable = 'YES',
  'ALTER TABLE scores MODIFY COLUMN entity_ref INT NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7f. UNIQUE final: (tid, entity_ref, hole, round). Nome uk_score_v2
-- reaproveitado (ja dropado acima se estava na versao ruim).
SET @newExists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME  = 'scores'
                      AND INDEX_NAME  = 'uk_score_v2');
SET @sql := IF(@newExists = 0,
  'ALTER TABLE scores ADD UNIQUE KEY uk_score_v2 (tournament_id, entity_ref, hole_number, round_number)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. tournament_scorecard_signatures.dupla_id + UNIQUE novo
-- ═══════════════════════════════════════════════════════════════════════════
-- Assinatura de dupla usa mesmo modelo: qualquer jogador da dupla assina em
-- nome dela, e a linha em signatures leva dupla_id (user_id do assinante fica
-- pra rastreio, mas identidade da assinatura eh a dupla).
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournament_scorecard_signatures'
                   AND COLUMN_NAME = 'dupla_id');
SET @sql := IF(@exists = 0,
  'ALTER TABLE tournament_scorecard_signatures ADD COLUMN dupla_id INT NULL AFTER user_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fkExists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME  = 'tournament_scorecard_signatures'
                     AND CONSTRAINT_NAME = 'fk_sig_dupla');
SET @sql := IF(@fkExists = 0,
  'ALTER TABLE tournament_scorecard_signatures ADD CONSTRAINT fk_sig_dupla FOREIGN KEY (dupla_id) REFERENCES tournament_duplas(id) ON DELETE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. admin_score_audit.target_dupla_id — FK (coluna ja existe da Onda A)
-- ═══════════════════════════════════════════════════════════════════════════
-- Onda A criou a coluna sem FK (tournament_duplas ainda nao existia). Agora
-- que existe, adiciona FK ON DELETE SET NULL (audit nao pode sumir junto com
-- alvo — mesmo padrao dos target_user_id/admin_user_id/tournament_id).
SET @fkExists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME  = 'admin_score_audit'
                     AND CONSTRAINT_NAME = 'fk_asa_target_dupla');
SET @sql := IF(@fkExists = 0,
  'ALTER TABLE admin_score_audit ADD CONSTRAINT fk_asa_target_dupla FOREIGN KEY (target_dupla_id) REFERENCES tournament_duplas(id) ON DELETE SET NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERENCIA (imprime resultado — nao altera nada)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournaments WHERE modality = 'individual')                     AS torneios_individuais,
  (SELECT COUNT(*) FROM tournaments WHERE modality = 'doubles')                        AS torneios_duplas,
  (SELECT COUNT(*) FROM tournament_duplas)                                              AS duplas_cadastradas,
  (SELECT COUNT(*) FROM tournament_dupla_players)                                       AS dupla_players,
  (SELECT COUNT(*) FROM group_duplas)                                                   AS grupos_com_duplas,
  (SELECT COUNT(*) FROM scores WHERE dupla_id IS NOT NULL)                              AS scores_de_dupla,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND INDEX_NAME='uk_score_v2'
      AND COLUMN_NAME='entity_ref')                                                     AS uk_v2_uses_entity_ref,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND COLUMN_NAME='entity_ref') AS entity_ref_col_installed,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='scores' AND INDEX_NAME='uk_score')    AS uk_score_legacy_still_there;
-- Esperado num banco existente logo apos rodar:
--   torneios_individuais = total de torneios (default)
--   torneios_duplas = 0
--   duplas_cadastradas = 0, dupla_players = 0, grupos_com_duplas = 0, scores_de_dupla = 0
--   entity_ref_col_installed = 1
--   uk_v2_uses_entity_ref = 1   (UNIQUE aponta pra coluna gerada)
--   uk_score_legacy_still_there = 0  (dropado com sucesso)
