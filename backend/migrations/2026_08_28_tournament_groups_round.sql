-- 2026-08-28 (tarde): grupos de torneio por rodada (Opção B — Item 4 backlog)
--
-- MOTIVO: hoje um `tournament_groups` serve pra todas as N rodadas do torneio
-- (1 grupo = 1 código de acesso permanente). Isso trava re-seeding entre
-- rodadas (líder da R1 vai pro último grupo em R2, típico de torneio oficial)
-- e impede montagem manual por dia. Opção B do Item 4 desacopla: cada grupo
-- pertence a UMA rodada específica.
--
-- MODELO: `tournament_groups.round_number` (default 1) + UNIQUE
-- (tournament_id, round_number, group_name) — impede admin criar 2 "Flight 1"
-- na mesma rodada, mas permite "Flight 1" repetido entre rodadas diferentes
-- (o grupo é reagrupamento por dia).
--
-- IDEMPOTÊNCIA: mesmo padrão da migration 2026_08_28_tournament_rounds —
-- checagens via information_schema + PREPARE dinâmico. Rodar 2x é no-op.
--
-- BACKFILL: DEFAULT 1 preenche todos os grupos existentes com round=1.
-- Nada muda pra torneios single-round; multi-rodada existentes ficam todos
-- em R1 até o admin criar grupos manuais/automáticos das outras rodadas.
--
-- PRÉ-CHECK EM PROD (2026-08-28 tarde): duplicatas de (tournament_id, group_name)
-- = 0 rows. UNIQUE cria sem falha.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournament_groups.round_number
-- ═══════════════════════════════════════════════════════════════════════════
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournament_groups'
                   AND COLUMN_NAME = 'round_number');
SET @sql := IF(@exists = 0,
  'ALTER TABLE tournament_groups ADD COLUMN round_number TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER tournament_id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. UNIQUE KEY (tournament_id, round_number, group_name) — D1 aprovado
-- ═══════════════════════════════════════════════════════════════════════════
-- Bloqueia admin criar "Flight 1" duas vezes na mesma rodada, mas permite
-- "Flight 1" em R1 e outro "Flight 1" em R2 (grupos independentes por dia).
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME   = 'tournament_groups'
                   AND INDEX_NAME   = 'uk_tgroup_round_name');
SET @sql := IF(@exists = 0,
  'ALTER TABLE tournament_groups ADD UNIQUE KEY uk_tgroup_round_name (tournament_id, round_number, group_name)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. INDEX (tournament_id, round_number) — pra listar grupos filtrados por rodada
-- ═══════════════════════════════════════════════════════════════════════════
-- O UNIQUE composto acima já cobre `(tournament_id, round_number, ...)` como
-- prefixo — MySQL usa o índice pra WHERE por prefixo. Mas mantenho índice
-- explícito pra semântica clara e pra caso alguém dropar o UNIQUE no futuro.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME   = 'tournament_groups'
                   AND INDEX_NAME   = 'idx_tgroup_round');
SET @sql := IF(@exists = 0,
  'ALTER TABLE tournament_groups ADD INDEX idx_tgroup_round (tournament_id, round_number)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sanidade pós-migration
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournament_groups)                                  AS total_grupos,
  (SELECT COUNT(*) FROM tournament_groups WHERE round_number = 1)           AS grupos_r1,
  (SELECT COUNT(*) FROM tournament_groups WHERE round_number != 1)          AS grupos_outros_rounds,
  (SELECT COUNT(DISTINCT round_number) FROM tournament_groups)              AS distinct_rounds;
