-- 2026-09-01: Kinds ligados/desligados por torneio (Bloco 2 · Commit 2.1)
--
-- MOTIVO: admin quer ATIVAR/DESATIVAR cada tipo de resultado (HiO, Albatross,
-- Eagle, Birdie, Par, Bogey, Double, Triple) individualmente por torneio.
-- Ex: torneio Stableford simplificado usa só Birdie/Par/Bogey/Double; os
-- outros 4 tipos ficam desativados — não aparecem no ResultPicker do
-- Scorecard nem no dropdown do AdminScoreEditor daquele torneio.
--
-- ESCOPO desta migration:
--   1. tournament_result_points.enabled TINYINT(1) NOT NULL DEFAULT 1
--
-- COMPORTAMENTO:
--   - DEFAULT 1: torneios já existentes ganham 8 kinds TODOS habilitados.
--     Nenhum torneio hoje muda de comportamento — o ResultPicker segue com
--     as 8 opções.
--   - Backend (Bloco 2 · Commit 2.2) passa a rejeitar saveScore /
--     editTournamentScore quando result_kind não estiver enabled=1.
--   - Frontend (Bloco 2 · Commit 2.3) filtra os botões/dropdown pelos
--     enabled=1 do torneio.
--
-- REGRA APROVADA (decisão de produto Bloco 2, 2026-09-01):
--   Desativar um kind NÃO é bloqueado mesmo se já houver scores gravados
--   com aquele kind. Scores antigos continuam contando pontos no leaderboard
--   (SUM em tournament_result_points respeita o valor do points salvo,
--   independentemente de enabled). Apenas ESCRITA nova daquele kind é
--   bloqueada. Isso preserva histórico e dá liberdade pro admin ajustar
--   config no meio do torneio se precisar.
--
-- IDEMPOTÊNCIA: mesmo padrão das migrations anteriores (2026_08_28,
-- 2026_08_31) — DDL protegido por checagem em information_schema +
-- PREPARE dinâmico. Rodar 2x é seguro.
--
-- BACKFILL: nenhum. Todos os torneios existentes ganham enabled=1 via
-- DEFAULT sem tocar nas linhas. Zero impacto em dado histórico.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournament_result_points.enabled
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournament_result_points'
                   AND COLUMN_NAME = 'enabled');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournament_result_points ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER points",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA (imprime resultado — não altera nada)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournament_result_points)                          AS total_config_rows,
  (SELECT COUNT(*) FROM tournament_result_points WHERE enabled = 1)        AS enabled_rows,
  (SELECT COUNT(*) FROM tournament_result_points WHERE enabled = 0)        AS disabled_rows,
  (SELECT COUNT(DISTINCT tournament_id) FROM tournament_result_points)     AS tournaments_with_config;
-- Esperado logo após rodar a migration num banco existente:
--   total_config_rows == enabled_rows (todos default 1)
--   disabled_rows = 0
--   tournaments_with_config = número de torneios result_points criados até agora
