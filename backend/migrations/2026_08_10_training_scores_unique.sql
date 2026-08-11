-- Migration: garantir UNIQUE KEY em training_scores.
--
-- MOTIVO: TrainingController.saveScore usa INSERT ... ON DUPLICATE KEY UPDATE
-- assumindo unique (group_id, user_id, hole_number). A constraint nunca foi
-- criada em produção — o UPSERT vira INSERT normal e cada clique em +/-
-- gera uma linha nova em vez de atualizar a existente. Ranking do treino
-- passa a somar duplicatas.
--
-- ESCOPO EM PRODUÇÃO (medido em 2026-08-10):
--   - 42 combinações duplicadas
--   - 61 linhas extras a remover
--   - Distribuição: 1x6 ocorrências, 2x5, 3x4, 3x3, 33x2
--
-- REGRA GERAL DE DEDUP: mantém o registro de MAIOR id.
-- Justificativa: o id maior é a última tentativa de UPSERT do backend, ou
-- seja, o valor que o usuário viu como confirmado no display antes de sair
-- do hole. Reflete a intenção final.
--
-- EXCEÇÃO EXPLÍCITA — hole 8, group 50, user 2:
--   - Duas linhas: id 460 (strokes=4, par do buraco) e id 461 (strokes=20).
--   - 20 tacadas em par-4 é fantasma (clique acidental repetido do BUG 2
--     antigo, resolvido em 31275e7). Regra "maior id" pegaria o 20 —
--     inaceitável. Aplicamos o INVERSO nesse caso: manter id 460, deletar
--     id 461. Aprovado pelo dono do dado (viniesser30@gmail.com, próprio
--     jogador do treino).
--
-- PRÉ-REQUISITO OBRIGATÓRIO:
--   mysqldump -u root -p golf_db > /root/backup_YYYY_MM_DD_pre_dedup.sql
--   Backup COMPLETO do banco, não só desta tabela. Confirmar tamanho > 1MB.

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — AUDITORIA (só SELECT, não altera nada)
-- ─────────────────────────────────────────────────────────────────────────────
-- Rode e confirme:
--   * combinações duplicadas = 42
--   * linhas extras = 61
--   * casos com maior ocorrência batem com o que já validamos
--   * hole 8 do grupo 50 continua com ids 460 e 461

SELECT COUNT(*) AS combinacoes_duplicadas FROM (
  SELECT group_id, user_id, hole_number
  FROM training_scores
  GROUP BY group_id, user_id, hole_number
  HAVING COUNT(*) > 1
) x;

SELECT SUM(ocorrencias - 1) AS linhas_extras FROM (
  SELECT group_id, user_id, hole_number, COUNT(*) AS ocorrencias
  FROM training_scores
  GROUP BY group_id, user_id, hole_number
  HAVING COUNT(*) > 1
) x;

SELECT id, group_id, user_id, hole_number, strokes
FROM training_scores
WHERE group_id = 50 AND user_id = 2 AND hole_number = 8
ORDER BY id;
-- Esperado: 2 linhas — id=460 strokes=4, id=461 strokes=20.

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — DEDUPLICAÇÃO EM TRANSAÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
-- Rodar TUDO até o "-- fim da transação (aguardar decisão)" ANTES de commit.
-- NÃO commite sozinho — cole o resultado dos 3 SELECTs de conferência aqui
-- pra Claude validar antes de escolher COMMIT ou ROLLBACK.

START TRANSACTION;

-- Baseline antes
SELECT COUNT(*) AS total_antes FROM training_scores;

-- 2.a) Exceção do hole 8, group 50, user 2: deleta EXPLICITAMENTE o id 461.
--      Precisa vir ANTES da dedup geral, senão a regra "maior id" pega o 461.
DELETE FROM training_scores WHERE id = 461;

-- 2.b) Dedup geral: mantém o MAIOR id por (group_id, user_id, hole_number).
DELETE t1 FROM training_scores t1
INNER JOIN training_scores t2
  ON t1.group_id    = t2.group_id
 AND t1.user_id     = t2.user_id
 AND t1.hole_number = t2.hole_number
 AND t1.id < t2.id;

-- Conferência final
SELECT COUNT(*) AS total_depois FROM training_scores;

SELECT COUNT(*) AS duplicatas_restantes FROM (
  SELECT group_id, user_id, hole_number
  FROM training_scores
  GROUP BY group_id, user_id, hole_number
  HAVING COUNT(*) > 1
) x;

-- Confirma que o caso do hole 8 ficou como decidido
SELECT id, group_id, user_id, hole_number, strokes
FROM training_scores
WHERE group_id = 50 AND user_id = 2 AND hole_number = 8;
-- Esperado: 1 linha — id=460 strokes=4.

-- ── fim da transação (aguardar decisão) ──────────────────────────────────────
-- Espera o "pode COMMIT" do Claude olhando os 3 números.
-- Esperado:
--   total_depois = total_antes - 61
--   duplicatas_restantes = 0
--   hole 8 caso = 1 linha (id=460, strokes=4)
--
-- Se bater: COMMIT;
-- Se não bater: ROLLBACK;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — APLICAR UNIQUE KEY (só após COMMIT do passo 2)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE training_scores
  ADD UNIQUE KEY uq_training_score (group_id, user_id, hole_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4 — VERIFICAÇÃO FINAL
-- ─────────────────────────────────────────────────────────────────────────────
SHOW CREATE TABLE training_scores;
-- Deve aparecer:  UNIQUE KEY `uq_training_score` (`group_id`,`user_id`,`hole_number`)
