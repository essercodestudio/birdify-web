-- 2026-09-12: conteudo rico do torneio (Onda C · Fase C.5).
--
-- MOTIVO: hoje o jogador ve o torneio num modal enxuto (nome, descricao,
-- data, PIX, sponsors). A restruturacao de nav do jogador pede uma tela
-- de detalhe rica com capa + secoes expansiveis (Informacoes, Programacao,
-- Premiacao, Regulamento) que o admin cadastra por torneio.
--
-- ESCOPO desta migration (Onda C · Fase C.5):
--   1. tournaments.cover_image_path VARCHAR(500) NULL
--   2. tournaments.event_summary    VARCHAR(500) NULL  -- "Sobre o evento" curto
--   3. tournaments.info_content     TEXT         NULL  -- "Informacoes do torneio"
--   4. tournaments.schedule_content TEXT         NULL  -- "Programacao"
--   5. tournaments.prizes_content   TEXT         NULL  -- "Premiacao"
--   6. tournaments.rules_content    TEXT         NULL  -- "Regulamento"
--
-- COMPORTAMENTO:
--   - Todos NULL default → torneios existentes (33 no local, ~similar em prod)
--     nao ganham nada; zero mudanca visual/comportamental antes do admin
--     preencher.
--   - Frontend do jogador (TournamentDetail.js) NAO consome esses campos
--     nesta fase — layout rico e' a Fase C.6, escondendo secoes vazias.
--   - Coluna `description` (ja existente, TEXT) NAO e' substituida:
--     event_summary e' novo (curto, cartao), description segue como
--     campo interno/opcional.
--
-- IDEMPOTENCIA: mesmo padrao das migrations 2026_08_31, 2026_09_01,
-- 2026_09_09 — DDL protegido por checagem em information_schema.COLUMNS
-- + PREPARE dinamico. Rodar 2x e' seguro.
--
-- POSICIONAMENTO: sem AFTER — evita conflito de ordem se um ambiente
-- tiver drift de schema (colunas adicionadas manualmente etc). MySQL
-- adiciona ao final da tabela, o que e' aceitavel (SCHEMA.sql documenta
-- a ordem logica desejada; a ordem fisica so importa pra SELECT *).
--
-- BACKFILL: nenhum. Todas as linhas existentes ficam NULL. Retrocompat
-- 100%: nn() helper do tournamentController normaliza undefined/'' -> NULL
-- no create/update.
--
-- BACKUP OBRIGATORIO ANTES (em prod E em local):
--   mysqldump -u root -p --single-transaction golf_db tournaments \
--     > /root/backup_YYYY_MM_DD_pre_rich_details.sql
--   ls -lh + tail -5 confirmando dump completo antes de rodar a migration.
--
-- ROLLBACK MANUAL (se algo der errado depois do commit):
--   ALTER TABLE tournaments
--     DROP COLUMN cover_image_path,
--     DROP COLUMN event_summary,
--     DROP COLUMN info_content,
--     DROP COLUMN schedule_content,
--     DROP COLUMN prizes_content,
--     DROP COLUMN rules_content;
--   (aditivo puro — nenhuma outra tabela toca nessas colunas.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournaments.cover_image_path
-- ═══════════════════════════════════════════════════════════════════════════
-- Path relativo do padrao do projeto (/uploads/tournaments/{clubId}/{id}.jpg).
-- 500 chars alinha com sponsors.image_url e clubs.logo_url.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'cover_image_path');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN cover_image_path VARCHAR(500) DEFAULT NULL",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. tournaments.event_summary
-- ═══════════════════════════════════════════════════════════════════════════
-- "Sobre o evento" curto (subtitulo no cartao do detalhe do torneio).
-- 500 chars e' generoso pra 1-2 paragrafos; convive com description
-- (que continua sendo o texto livre longo/opcional/legado).
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'event_summary');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN event_summary VARCHAR(500) DEFAULT NULL",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. tournaments.info_content
-- ═══════════════════════════════════════════════════════════════════════════
-- Corpo da secao "Informacoes do torneio" (tela de detalhe do jogador).
-- TEXT (~65k) — texto livre, exibido com whiteSpace: pre-wrap.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'info_content');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN info_content TEXT DEFAULT NULL",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. tournaments.schedule_content
-- ═══════════════════════════════════════════════════════════════════════════
-- Corpo da secao "Programacao". Decisao (usuario): texto livre, nao
-- estruturado a partir de tournament_rounds — flexivel pra torneios com
-- horarios e blocos que nao seguem 1:1 uma rodada por dia.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'schedule_content');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN schedule_content TEXT DEFAULT NULL",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. tournaments.prizes_content
-- ═══════════════════════════════════════════════════════════════════════════
-- Corpo da secao "Premiacao".
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'prizes_content');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN prizes_content TEXT DEFAULT NULL",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. tournaments.rules_content
-- ═══════════════════════════════════════════════════════════════════════════
-- Corpo da secao "Regulamento" (tipicamente o campo mais longo).
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'rules_content');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN rules_content TEXT DEFAULT NULL",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERENCIA (imprime resultado — nao altera nada)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournaments)                                     AS total_torneios,
  (SELECT COUNT(*) FROM tournaments WHERE cover_image_path IS NOT NULL)  AS com_capa,
  (SELECT COUNT(*) FROM tournaments WHERE event_summary    IS NOT NULL)  AS com_summary,
  (SELECT COUNT(*) FROM tournaments WHERE info_content     IS NOT NULL)  AS com_info,
  (SELECT COUNT(*) FROM tournaments WHERE schedule_content IS NOT NULL)  AS com_schedule,
  (SELECT COUNT(*) FROM tournaments WHERE prizes_content   IS NOT NULL)  AS com_prizes,
  (SELECT COUNT(*) FROM tournaments WHERE rules_content    IS NOT NULL)  AS com_rules;
-- Esperado logo apos rodar a migration num banco existente:
--   total_torneios = 33 (local)
--   com_capa = com_summary = com_info = com_schedule = com_prizes = com_rules = 0
