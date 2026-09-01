-- 2026-08-31: Pontuação por Resultado (Onda A · Commit 1)
--
-- MOTIVO: torneios reais frequentemente têm formato tipo Stableford, em que o
-- ranking é por PONTOS (Birdie=3, Par=2, Bogey=1, etc) ao invés de tacadas
-- brutas. Hoje o sistema só suporta strokes; queremos adicionar um segundo modo
-- SEM alterar o comportamento dos torneios existentes.
--
-- MODELO — dois eixos ORTOGONAIS no torneio (Onda A + Onda B):
--   - Eixo Modalidade (Onda B — não implementado ainda):
--       tournaments.modality ENUM('individual','doubles')
--   - Eixo Marcação (Onda A — ESTA migration):
--       tournaments.scoring_type ENUM('strokes','result_points')
--
-- ESCOPO desta migration (Onda A · Commit 1):
--   1. tournaments.scoring_type — default 'strokes' preserva torneios legados
--   2. tournament_result_points — tabela de config de pontos por resultado (por torneio)
--   3. scores.result_kind — nullable; preenchido quando scoring_type='result_points'.
--      strokes continua NOT NULL (agora armazena valor DERIVADO do resultado + par do buraco)
--   4. admin_score_audit.previous_result_kind + .new_result_kind — nullable, rastreia
--      edição de resultado feita pelo admin
--   5. admin_score_audit.target_dupla_id — nullable, SEM FK (tournament_duplas ainda
--      não existe). Adicionado aqui pra evitar migration futura na Onda B (aditivo puro).
--      A FK será criada na migration da Onda B quando tournament_duplas existir.
--
-- IDEMPOTÊNCIA: mesmo padrão do 2026_08_28_tournament_rounds.sql — DDLs envoltos
-- em checagens via information_schema + PREPARE dinâmico. Rodar 2x é seguro.
--
-- BACKFILL: nenhum. Torneios existentes recebem scoring_type='strokes' automaticamente
-- via DEFAULT, sem tocar nas linhas. Zero impacto em dado histórico.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournaments.scoring_type
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'scoring_type');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN scoring_type ENUM('strokes','result_points') NOT NULL DEFAULT 'strokes' AFTER total_rounds",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. tournament_result_points — config de pontos por resultado (por torneio)
-- ═══════════════════════════════════════════════════════════════════════════
-- Chave composta (tournament_id, result_kind) garante 1 valor por (torneio, resultado).
-- ON DELETE CASCADE: deletar torneio limpa a config.
-- Só tem sentido quando tournaments.scoring_type='result_points'; se o torneio for
-- 'strokes' e ainda assim houver linhas aqui (ex: admin trocou o tipo), o
-- backend deve ignorá-las — não há constraint SQL forçando consistência (seria
-- via CHECK cross-table, que MySQL não suporta bem).
CREATE TABLE IF NOT EXISTS tournament_result_points (
  tournament_id  INT NOT NULL,
  result_kind    ENUM('hio','albatross','eagle','birdie','par','bogey','double_bogey','triple_bogey') NOT NULL,
  points         INT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, result_kind),
  CONSTRAINT fk_trp_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. scores.result_kind — nullable
-- ═══════════════════════════════════════════════════════════════════════════
-- Preenchido só em torneios scoring_type='result_points'. NULL em torneios strokes
-- (todos os existentes ficam NULL — comportamento antigo preservado).
-- strokes continua NOT NULL; em result_points guarda o valor DERIVADO (HiO=1,
-- Albatross=par-3, Eagle=par-2, Birdie=par-1, Par=par, Bogey=par+1,
-- DoubleBogey=par+2, TripleBogey=par+3). Preserva integrações que já leem strokes:
-- Meu Desempenho, exportação Excel, agregações antigas.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'scores'
                   AND COLUMN_NAME = 'result_kind');
SET @sql := IF(@exists = 0,
  "ALTER TABLE scores ADD COLUMN result_kind ENUM('hio','albatross','eagle','birdie','par','bogey','double_bogey','triple_bogey') NULL AFTER strokes",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. admin_score_audit — rastreamento de edição por resultado
-- ═══════════════════════════════════════════════════════════════════════════
-- previous_result_kind / new_result_kind: NULL em todo audit antigo (torneios strokes)
-- e nos audits de torneio strokes futuros. Preenchido só quando admin edita torneio
-- result_points.
-- target_dupla_id: coluna adicionada AGORA (aditivo) pra Onda B — evita migration
-- futura só pra isso. SEM FK enquanto tournament_duplas não existir. A FK
-- será adicionada na migration de Duplas.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'admin_score_audit'
                   AND COLUMN_NAME = 'previous_result_kind');
SET @sql := IF(@exists = 0,
  "ALTER TABLE admin_score_audit ADD COLUMN previous_result_kind ENUM('hio','albatross','eagle','birdie','par','bogey','double_bogey','triple_bogey') NULL AFTER previous_strokes",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'admin_score_audit'
                   AND COLUMN_NAME = 'new_result_kind');
SET @sql := IF(@exists = 0,
  "ALTER TABLE admin_score_audit ADD COLUMN new_result_kind ENUM('hio','albatross','eagle','birdie','par','bogey','double_bogey','triple_bogey') NULL AFTER new_strokes",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'admin_score_audit'
                   AND COLUMN_NAME = 'target_dupla_id');
SET @sql := IF(@exists = 0,
  'ALTER TABLE admin_score_audit ADD COLUMN target_dupla_id INT NULL AFTER target_user_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA (imprime resultado — não altera nada)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournaments WHERE scoring_type = 'strokes')       AS torneios_strokes,
  (SELECT COUNT(*) FROM tournaments WHERE scoring_type = 'result_points') AS torneios_pontos,
  (SELECT COUNT(*) FROM tournament_result_points)                          AS linhas_config_pontos,
  (SELECT COUNT(*) FROM scores WHERE result_kind IS NOT NULL)              AS scores_com_resultado;
-- Esperado logo após rodar a migration num banco existente:
--   torneios_strokes = total de torneios (todos migrados p/ default)
--   torneios_pontos = 0
--   linhas_config_pontos = 0
--   scores_com_resultado = 0
