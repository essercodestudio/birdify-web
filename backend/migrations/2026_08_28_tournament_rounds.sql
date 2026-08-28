-- 2026-08-28: torneio multi-rodada
--
-- MOTIVO: torneios reais frequentemente têm 2..N rodadas (ex: sexta/sábado/domingo).
-- Hoje `tournaments` guarda 1 start_date + 1 course_id, e `scores` agrega tacadas
-- do torneio inteiro sem distinguir a rodada. Numa competição multi-round isso
-- soma indevidamente as tacadas de todas as rodadas como se fosse um cartão só,
-- e o admin não consegue nem cadastrar as datas/campo de cada round.
--
-- MODELO: `tournaments.total_rounds` (default 1 = comportamento antigo) + nova
-- tabela `tournament_rounds` com (round_number, round_date, course_id).
-- `scores.round_number` distingue tacada de round. Se `total_rounds=1`, toda a
-- experiência atual sobrevive intacta (UI oculta seletor, backend usa round=1).
--
-- IDEMPOTÊNCIA: todos os DDLs são envoltos em checagens via information_schema
-- + PREPARE dinâmico. Rodar 2x é seguro — a segunda execução é no-op. Isso
-- diverge do padrão do repo (que aceita "erro na segunda execução — ignorar")
-- porque o /verify roda a migration múltiplas vezes num loop de teste.
--
-- BACKFILL: cada torneio existente ganha exatamente 1 linha em tournament_rounds
-- com round_number=1, herdando start_date + course_id atuais. Scores existentes
-- recebem round_number=1 automaticamente via DEFAULT. Nada muda pra torneios de
-- 1 rodada — modelo é backward-compatible.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournaments.total_rounds
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'total_rounds');
SET @sql := IF(@exists = 0,
  'ALTER TABLE tournaments ADD COLUMN total_rounds TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER format',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. tournament_rounds (1..N rodadas por torneio, cada uma com data+curso)
-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE TABLE IF NOT EXISTS já é idempotente por natureza.
-- ON DELETE CASCADE em tournament_id: deletar torneio limpa todas as rodadas.
-- ON DELETE RESTRICT em course_id: proteger contra apagar curso amarrado a
-- rodada existente (o admin precisa mover a rodada antes).
CREATE TABLE IF NOT EXISTS tournament_rounds (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  round_number  TINYINT UNSIGNED NOT NULL,
  round_date    DATETIME NOT NULL,
  course_id     INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tr_tourn  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_course FOREIGN KEY (course_id)     REFERENCES courses(id)     ON DELETE RESTRICT,
  UNIQUE KEY uk_tr_num (tournament_id, round_number),
  INDEX idx_tr_tourn (tournament_id, round_number)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. scores.round_number + UNIQUE KEY estendida
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.a) Adiciona coluna round_number (default 1 backfilla scores existentes)
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'scores'
                   AND COLUMN_NAME = 'round_number');
SET @sql := IF(@exists = 0,
  'ALTER TABLE scores ADD COLUMN round_number TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER hole_number',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.b) Se uk_score existe SEM round_number, drop pra recriar. Se já cobre
--      round_number, no-op. Se não existe, no-op (o CREATE cuida embaixo).
SET @needsDrop := (
  SELECT IF(
    -- índice uk_score existe...
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores' AND INDEX_NAME = 'uk_score') > 0
    AND
    -- ...mas não contém round_number
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores'
        AND INDEX_NAME = 'uk_score' AND COLUMN_NAME = 'round_number') = 0
  , 1, 0)
);
SET @sql := IF(@needsDrop = 1,
  'ALTER TABLE scores DROP INDEX uk_score',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.c) Cria uk_score novo se ainda não cobrir round_number
SET @hasNewIdx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores'
                      AND INDEX_NAME = 'uk_score' AND COLUMN_NAME = 'round_number');
SET @sql := IF(@hasNewIdx = 0,
  'ALTER TABLE scores ADD UNIQUE KEY uk_score (tournament_id, user_id, hole_number, round_number)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.d) Index de leitura por round (leaderboard filtrado)
SET @hasIdxRound := (SELECT COUNT(*) FROM information_schema.STATISTICS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores'
                        AND INDEX_NAME = 'idx_scores_round');
SET @sql := IF(@hasIdxRound = 0,
  'ALTER TABLE scores ADD INDEX idx_scores_round (tournament_id, round_number)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.e) Dropa unique_score LEGADO (user_id, tournament_id, hole_number) — SEM
--      round_number, esse índice bloqueia scores da mesma (user,tourn,hole)
--      em rounds diferentes, inviabilizando multi-rodada. Não estava no
--      SCHEMA.sql documentado; sobrou de versão antiga. Antes do drop, cria
--      idx_scores_user pra sustentar a FK scores_ibfk_1 (user_id) que hoje
--      é servida por unique_score.
SET @hasAuxUser := (SELECT COUNT(*) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores'
                       AND INDEX_NAME = 'idx_scores_user');
SET @sql := IF(@hasAuxUser = 0,
  'ALTER TABLE scores ADD INDEX idx_scores_user (user_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @hasLegacy := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scores'
                      AND INDEX_NAME = 'unique_score');
SET @sql := IF(@hasLegacy > 0,
  'ALTER TABLE scores DROP INDEX unique_score',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. tournament_scorecard_signatures — assinatura por rodada
-- ═══════════════════════════════════════════════════════════════════════════
-- Num torneio multi-rodada, cada rodada tem seu cartão assinado separadamente.
-- Sem round_number na UNIQUE, o jogador só conseguiria assinar R1 — as demais
-- travariam com "duplicate key".

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournament_scorecard_signatures'
                   AND COLUMN_NAME = 'round_number');
SET @sql := IF(@exists = 0,
  'ALTER TABLE tournament_scorecard_signatures ADD COLUMN round_number TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER user_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice auxiliar em tournament_id — o uk_sig atual é o ÚNICO índice cobrindo
-- essa coluna e é referenciado pela FK fk_sig_tourn. Se dropar sem criar suplente,
-- MySQL aborta com ER_DROP_INDEX_FK. As outras FKs (group_id, user_id) já têm
-- KEYs próprias (fk_sig_group / fk_sig_user), então só falta cobrir tournament_id.
SET @hasAuxIdx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tournament_scorecard_signatures'
                      AND INDEX_NAME = 'idx_sig_tourn');
SET @sql := IF(@hasAuxIdx = 0,
  'ALTER TABLE tournament_scorecard_signatures ADD INDEX idx_sig_tourn (tournament_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop UNIQUE antigo se não cobrir round_number (agora seguro — idx_sig_tourn sustenta a FK)
SET @needsDrop := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tournament_scorecard_signatures'
        AND INDEX_NAME = 'uk_sig') > 0
    AND
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tournament_scorecard_signatures'
        AND INDEX_NAME = 'uk_sig' AND COLUMN_NAME = 'round_number') = 0
  , 1, 0)
);
SET @sql := IF(@needsDrop = 1,
  'ALTER TABLE tournament_scorecard_signatures DROP INDEX uk_sig',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @hasNewIdx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tournament_scorecard_signatures'
                      AND INDEX_NAME = 'uk_sig' AND COLUMN_NAME = 'round_number');
SET @sql := IF(@hasNewIdx = 0,
  'ALTER TABLE tournament_scorecard_signatures ADD UNIQUE KEY uk_sig (tournament_id, group_id, user_id, round_number)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. admin_score_audit.round_number (nullable — NULL = torneio 1-rodada legado)
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'admin_score_audit'
                   AND COLUMN_NAME = 'round_number');
SET @sql := IF(@exists = 0,
  'ALTER TABLE admin_score_audit ADD COLUMN round_number TINYINT UNSIGNED NULL AFTER hole_number',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. BACKFILL — 1 linha em tournament_rounds por torneio existente
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotente via NOT EXISTS: só insere se o torneio ainda não tem nenhuma
-- rodada cadastrada. Rodar 2x → 2ª vez insere 0 linhas.
-- Filtra course_id IS NULL (torneios com curso deletado depois via SET NULL)
-- porque tournament_rounds.course_id é NOT NULL.
INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
SELECT t.id, 1, t.start_date, t.course_id
  FROM tournaments t
 WHERE t.course_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM tournament_rounds tr WHERE tr.tournament_id = t.id
   );

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA (imprime resultado — não altera nada)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournaments)              AS total_torneios,
  (SELECT COUNT(*) FROM tournaments WHERE course_id IS NOT NULL) AS torneios_com_curso,
  (SELECT COUNT(*) FROM tournament_rounds)        AS total_rounds,
  (SELECT COUNT(DISTINCT tournament_id) FROM tournament_rounds) AS torneios_com_rounds;
-- Esperado: torneios_com_rounds == torneios_com_curso (backfill completo).
