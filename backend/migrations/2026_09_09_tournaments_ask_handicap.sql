-- 2026-09-09: toggle "pedir handicap ao entrar no grupo" por torneio.
--
-- MOTIVO: hoje todo torneio força o jogador a informar o handicap no
-- lobby (modal em JoinGame.js) antes de liberar o Scorecard. Alguns
-- clubes rodam torneios "só Gross" — o handicap ali só polui a UX
-- porque nunca vai ser usado pra ranking. Queremos um toggle no
-- painel do organizador: se DESLIGADO, o jogador entra direto no
-- Scorecard, sem informar handicap, e o Leaderboard/Scorecard escondem
-- toda menção a Net.
--
-- ESCOPO desta migration (Fase 2 · Commit 2.1):
--   1. tournaments.ask_handicap TINYINT(1) NOT NULL DEFAULT 1
--
-- COMPORTAMENTO:
--   - DEFAULT 1: torneios existentes ganham ask_handicap=1 sem tocar
--     nas linhas. Zero mudança de comportamento — o modal de handicap
--     continua abrindo exatamente como antes.
--   - Frontend (commits seguintes) le esse campo e pula o modal quando 0.
--   - Backend rejeita categoria custom com faixa de handicap quando
--     ask_handicap=0 (integracao vem na Fase 1 · Mudanca 1, aqui so
--     preparamos o schema).
--
-- INTERACAO COM OUTROS EIXOS (nao muda comportamento existente):
--   - scoring_type='result_points': ja ignora handicap pro ranking;
--     combinar com ask_handicap=0 e' natural.
--   - modality='doubles': idem, o handicap por dupla so alimenta Net;
--     ask_handicap=0 pula o modal de handicap por dupla tambem.
--
-- IDEMPOTENCIA: mesmo padrao das migrations 2026_08_31 e 2026_09_01 —
-- DDL protegido por checagem em information_schema + PREPARE dinamico.
-- Rodar 2x e' seguro.
--
-- BACKFILL: nenhum. Todos os torneios existentes ganham ask_handicap=1
-- via DEFAULT sem tocar nas linhas. Zero impacto em dado historico.
--
-- BACKUP OBRIGATORIO ANTES (em prod):
--   mysqldump -u root -p --single-transaction --routines --triggers \
--     golf_db > /root/backup_YYYY_MM_DD_pre_ask_handicap.sql
--   ls -lh + tail -5 confirmando dump completo antes de rodar a migration.
--
-- ROLLBACK MANUAL (se algo der errado depois do commit):
--   ALTER TABLE tournaments DROP COLUMN ask_handicap;
--   (aditivo puro — nenhuma outra tabela toca nessa coluna)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tournaments.ask_handicap
-- ═══════════════════════════════════════════════════════════════════════════
-- Posicionamento: AFTER modality — fica junto com scoring_type/modality como
-- os 3 "eixos de configuracao de comportamento" do torneio.
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME  = 'tournaments'
                   AND COLUMN_NAME = 'ask_handicap');
SET @sql := IF(@exists = 0,
  "ALTER TABLE tournaments ADD COLUMN ask_handicap TINYINT(1) NOT NULL DEFAULT 1 AFTER modality",
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERENCIA (imprime resultado — nao altera nada)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT COUNT(*) FROM tournaments)                            AS total_torneios,
  (SELECT COUNT(*) FROM tournaments WHERE ask_handicap = 1)     AS pedem_handicap,
  (SELECT COUNT(*) FROM tournaments WHERE ask_handicap = 0)     AS nao_pedem_handicap;
-- Esperado logo apos rodar a migration num banco existente:
--   total_torneios == pedem_handicap (todos default 1)
--   nao_pedem_handicap = 0
