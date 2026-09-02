# Runbook — Deploy Bloco 3 · commit 3.1 (Onda B · Fase B.1 · schema doubles)

Deploy do commit `48b16bf` sozinho em produção — schema base do modo
doubles + `entity_ref` + verify runtime. Nenhuma UI ou controller de
duplas é ativado ainda: torneios existentes (todos `modality='individual'`
por default) continuam funcionando 100% do mesmo jeito.

**Escopo**: só esse commit. Não empurrar mais nada da Onda B antes de
validar em prod. Próximos commits (3.2 em diante) só depois deste
runbook completo.

**Backup pré-existente relevante**: `backup_prod_YYYY-MM-DD_HH-MM_pre_onda_a.sql`
(o mais recente em `/root/`, de 2026-09-01, feito antes da Onda A).
Vamos gerar um novo `pre_doubles` antes desta migration.

---

## Convenções

- **Você digita todo comando de estado real** (git push, ssh, mysql, pm2,
  rm, etc). Claude nunca. Base: [[feedback-producao-workflow]].
- **SQL não-trivial via arquivo + SOURCE**, nunca colar direto no
  `mysql>` (terminal SSH trunca paste longo — [[feedback-ssh-paste-truncate]]).
- **Se qualquer etapa der saída inesperada, PARA e cola no chat**.
  Especialmente qualquer `derivado > 0` que não seja esperado —
  base [[feedback-delete-reconhecimento]].

---

## Variáveis desta janela

| Variável | Valor esperado | O que é |
|----------|----------------|---------|
| `COMMIT` | `48b16bf` | Hash do commit 3.1 no local |
| `MIGRATION` | `backend/migrations/2026_09_01_tournament_doubles.sql` | Arquivo aplicado |
| `BACKUP_TAG` | `pre_doubles` | Sufixo do backup pré-migration |
| `PM2_APP` | `birdify-api` | Nome do processo backend |
| `REPO_PATH` | `/var/www/golf-scorer` | Caminho na VPS |
| `DB_NAME` | `golf_db` | Banco de produção |

---

## Etapa 0 — Push local → origin/main

Confirme primeiro que só o commit 3.1 está à frente:

```powershell
git log --oneline origin/main..HEAD
# Esperado: uma linha só
# 48b16bf feat(doubles): schema + entity_ref + verify (Bloco 3 · commit 3.1)
```

Se aparecer mais de uma linha, PARA e cola no chat — algo extra
entrou por engano e o deploy tem que ser reescopado.

Se OK, VOCÊ digita:

```powershell
git push origin main
```

**Esperado**: `To github.com:.../golf-scorer.git` seguido de `main -> main`,
sem `[rejected]` nem `error:`.

---

## Etapa 1 — SSH na VPS

```
ssh root@<VPS_IP>
cd /var/www/golf-scorer
```

Confirme HEAD ANTIGO antes do pull:

```
git log --oneline -1
# Esperado: 9221da1 feat(scoring-type): UI liga/desliga por result_kind + verify (Bloco 2 · commit 2.3)
```

---

## Etapa 2 — Backup do banco (obrigatório)

Gera nome com timestamp exato pra ficar rastreável:

```
BACKUP_FILE="/root/backup_prod_$(date +%Y-%m-%d_%H-%M)_pre_doubles.sql"
echo "$BACKUP_FILE"
# Esperado: /root/backup_prod_2026-09-02_HH-MM_pre_doubles.sql
```

Executa o dump (você digita a senha do root MySQL):

```
mysqldump -u root -p --single-transaction --routines --triggers golf_db > "$BACKUP_FILE"
ls -lh "$BACKUP_FILE"
```

**Esperado**: arquivo > 1 MB, sem erro.

**Se falhar**: PARA. O deploy não segue sem backup válido.

---

## Etapa 3 — Pull do repo

```
git fetch origin
git log --oneline origin/main..HEAD
# Esperado: (vazio) — HEAD já está em 9221da1, origin/main tem 48b16bf à frente

git pull --ff-only origin main
git log --oneline -1
# Esperado: 48b16bf feat(doubles): schema + entity_ref + verify (Bloco 3 · commit 3.1)

ls -la backend/migrations/2026_09_01_tournament_doubles.sql
# Esperado: arquivo existe, ~15 KB
```

---

## Etapa 4 — Parar o backend (janela de manutenção)

DDL na tabela `scores` é destrutivo (DROP + CREATE de UNIQUE). Backend
tem que estar OFF pra evitar `saveScore` concorrente entre o DROP e o
CREATE do índice novo. Vale também pro teste do guard na Etapa 6, que
temporariamente remove o `uk_score` também.

```
pm2 stop birdify-api
pm2 status
# Esperado: birdify-api com status "stopped"
```

A partir daqui, nenhum jogador consegue salvar score. **Objetivo:
janela < 10 min entre Etapa 4 e Etapa 9.**

---

## Etapa 5 — Pre-check do guard em prod

Antes do teste com duplicata forjada, roda a query do guard exatamente
como ela está na migration, contra os dados REAIS de prod, pra saber se
já existe alguma duplicata legítima que faria a migration abortar:

```
mysql -u root -p golf_db
```

Dentro do mysql:

```sql
SELECT COUNT(*) AS dups_reais_em_prod FROM (
  SELECT tournament_id, user_id, hole_number, round_number
    FROM scores
   GROUP BY tournament_id, user_id, hole_number, round_number
  HAVING COUNT(*) > 1
) x;
```

**Esperado**: `0`.

**Se > 0**: PARA, sai do mysql (`\q`), cola no chat quantas duplicatas
apareceram. Provavelmente é bug legado (uk_score foi perdido em migration
anterior). Precisa investigar antes de seguir.

Mantenha a sessão do mysql aberta pra próxima etapa.

---

## Etapa 6 — Teste do guard com duplicata FORJADA (em prod real)

**Propósito**: provar que o mecanismo do guard REALMENTE dispara quando
existe duplicata, não só que "rodou limpo por sorte". Mesmo cenário do
`verify-doubles-migration.js` que rodou local.

**Segurança**:
- Backend parado — sem `saveScore` concorrente
- Torneio criado é 100% efêmero (nome começa com `VERIFY GUARD PROD`)
- Duplicata plantada só existe dentro desse torneio efêmero
- Cleanup deleta o torneio inteiro (FK CASCADE cobre scores + rounds)
- `uk_score` é temporariamente dropado — re-adicionado antes de sair
  (embora a migration real na Etapa 7 dropa de novo — a re-adição é
  cinto de segurança se algo falhar entre 6 e 7)

Ainda dentro do mysql. Bloco 1 — baseline:

```sql
SELECT COUNT(*) AS scores_baseline FROM scores;
-- Guarda esse número mental (ex: 1234). Vamos checar de novo no fim.

SHOW INDEX FROM scores WHERE Key_name = 'uk_score';
-- Esperado: 4 linhas (uk_score com tournament_id, user_id, hole_number, round_number)
```

Bloco 2 — dropa uk_score, planta duplicata:

```sql
ALTER TABLE scores DROP INDEX uk_score;

INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, status)
  SELECT 1,
         CONCAT('VERIFY GUARD PROD ', UNIX_TIMESTAMP()),
         DATE_ADD(NOW(), INTERVAL 30 DAY),
         (SELECT id FROM courses WHERE club_id = 1 LIMIT 1),
         'shotgun', 1, 'OPEN';
SET @tid := LAST_INSERT_ID();
SELECT @tid AS tournament_efemero_id;

INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
  SELECT @tid, 1, DATE_ADD(NOW(), INTERVAL 30 DAY),
         (SELECT course_id FROM tournaments WHERE id = @tid);

SET @uid := (SELECT id FROM users LIMIT 1);
SELECT @uid AS user_vitima_id;

INSERT INTO scores (tournament_id, user_id, hole_number, round_number, strokes)
  VALUES (@tid, @uid, 1, 1, 4),
         (@tid, @uid, 1, 1, 5);

SELECT COUNT(*) AS dups_plantadas FROM scores WHERE tournament_id = @tid;
-- Esperado: 2
```

Bloco 3 — roda a migration esperando ABORTO:

```sql
SOURCE /var/www/golf-scorer/backend/migrations/2026_09_01_tournament_doubles.sql;
```

**Esperado (saída)**:

```
ERROR 1146 (42S02): Table 'golf_db.abort_scores_1_duplicatas_corrija_antes' doesn't exist
```

**A prova está no `_1_`** do nome da tabela: o guard contou exatamente
1 par de duplicatas (o nosso plantado) antes de tentar `INSERT` na
tabela fake.

**Se a saída for diferente**:
- `abort_scores_0_...` → o guard não achou a duplicata plantada (bug no
  guard ou plantei mal). PARA, cola no chat.
- `Query OK` sem erro nenhum → o guard NÃO está funcionando. PARA,
  cola no chat — não pode aplicar migration em prod sem guard funcional.
- Qualquer outro erro → PARA, cola no chat.

Bloco 4 — cleanup:

```sql
DELETE FROM scores WHERE tournament_id = @tid;
DELETE FROM tournament_rounds WHERE tournament_id = @tid;
DELETE FROM tournaments WHERE id = @tid;

ALTER TABLE scores ADD UNIQUE KEY uk_score (tournament_id, user_id, hole_number, round_number);

SELECT COUNT(*) AS scores_depois FROM scores;
-- Esperado: mesmo número da baseline (etapa 6, bloco 1)

SHOW TABLES LIKE 'abort_scores_%';
-- Esperado: Empty set (a tabela fake nunca foi criada — o erro é o hack)
```

**Se `scores_depois != scores_baseline`**: PARA imediatamente, cola no
chat. Alguém escreveu score durante a janela (backend estava pra estar
OFF — houve write manual? Cron?). Estado inconsistente.

Sai do mysql:

```sql
\q
```

---

## Etapa 7 — Aplicar a migration real

Agora que o guard está provado funcional E prod tem 0 duplicatas
legítimas, roda a migration pra valer:

```
mysql -u root -p golf_db < backend/migrations/2026_09_01_tournament_doubles.sql
```

**Esperado (última linha da saída — SELECT de conferência da migration)**:

```
torneios_individuais   torneios_duplas   duplas_cadastradas   dupla_players   grupos_com_duplas   scores_de_dupla   entity_ref_col_installed   uk_v2_uses_entity_ref   uk_score_legacy_still_there
<N>                    0                 0                    0               0                   0                 1                          1                       0
```

Onde:
- `<N>` = total de torneios em prod (todos herdaram default `individual`)
- `torneios_duplas = 0` (nenhum criado ainda)
- `entity_ref_col_installed = 1` (coluna criada)
- `uk_v2_uses_entity_ref = 1` (UNIQUE novo apontando pra entity_ref)
- `uk_score_legacy_still_there = 0` (uk_score antigo dropado)

**Se qualquer coluna sair diferente**: PARA, cola no chat. Restore do
backup fica como plano B (Rollback abaixo).

---

## Etapa 8 — Verify schema em prod

Confirma via `information_schema` (sem depender do SELECT da migration):

```
mysql -u root -p golf_db
```

```sql
-- 1. tournaments.modality
SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'golf_db'
   AND TABLE_NAME = 'tournaments'
   AND COLUMN_NAME = 'modality';
-- Esperado: enum('individual','doubles') | NO | individual
```

```sql
-- 2. Tabelas novas existem
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'golf_db'
   AND TABLE_NAME IN ('tournament_duplas', 'tournament_dupla_players', 'group_duplas')
 ORDER BY TABLE_NAME;
-- Esperado: 3 linhas
```

```sql
-- 3. scores.user_id NULLABLE + entity_ref NOT NULL
SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'golf_db'
   AND TABLE_NAME = 'scores'
   AND COLUMN_NAME IN ('user_id', 'dupla_id', 'entity_ref')
 ORDER BY COLUMN_NAME;
-- Esperado:
--   dupla_id    | YES | int
--   entity_ref  | NO  | int
--   user_id     | YES | int
```

```sql
-- 4. UNIQUE novo instalado + antigo dropado
SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = 'golf_db'
   AND TABLE_NAME = 'scores'
   AND INDEX_NAME IN ('uk_score', 'uk_score_v2')
 ORDER BY INDEX_NAME, SEQ_IN_INDEX;
-- Esperado: 4 linhas de uk_score_v2 (tournament_id, entity_ref, hole_number, round_number).
--           ZERO linhas de uk_score.
```

```sql
-- 5. Backfill do entity_ref: todo score existente tem entity_ref = user_id
SELECT COUNT(*) AS scores_com_entity_ref_divergente
  FROM scores
 WHERE entity_ref IS NULL OR entity_ref != user_id;
-- Esperado: 0
```

```sql
-- 6. FKs novas
SELECT CONSTRAINT_NAME
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = 'golf_db'
   AND CONSTRAINT_NAME IN ('fk_scores_dupla', 'fk_sig_dupla', 'fk_asa_target_dupla')
 ORDER BY CONSTRAINT_NAME;
-- Esperado: 3 linhas
```

Se todas as 6 conferências OK, sai:

```sql
\q
```

**Se alguma falhar**: PARA, cola no chat. Restore fica como plano B.

---

## Etapa 9 — Restart do backend

```
pm2 start birdify-api
pm2 status
# Esperado: birdify-api com status "online"

pm2 logs birdify-api --lines 30
# Esperado: sem erro de "Unknown column" ou "Table doesn't exist".
# Ctrl+C pra sair dos logs.
```

Janela de manutenção fechada. Jogadores voltam a conseguir salvar
score.

---

## Etapa 10 — Smoke test em produção

Objetivo: **provar que torneios individuais existentes continuam salvando
score OK** — o commit 3.1 não pode ter quebrado o caminho antigo.

Do teu celular ou browser, entra num torneio de teste (ou pega o
torneio de teste dedicado que a gente já usa, ou o torneio local mais
recente que ainda está OPEN):

1. Abre lobby → grupo → scorecard
2. Marca 1 score (buraco 1, qualquer valor)
3. Confirma que salvou (badge/toast de sucesso)
4. Recarrega a página (F5)
5. Confirma que o score persistiu

Em paralelo, no VPS:

```
mysql -u root -p golf_db -e "SELECT tournament_id, user_id, dupla_id, entity_ref, hole_number, strokes FROM scores ORDER BY id DESC LIMIT 3;"
```

**Esperado no score que você acabou de salvar**:
- `user_id` = seu user_id (não NULL)
- `dupla_id` = NULL (torneio é `modality='individual'`)
- `entity_ref` = seu user_id (igual ao user_id, backend passou corretamente)

**Se `entity_ref` sair NULL ou diferente de `user_id`**: BUG grave no
controller. Backend não está passando `entity_ref` — provavelmente rota
usa código que não foi atualizado. PARA, cola no chat.

---

## Etapa 11 — Fecha janela: atualiza memória local

De volta ao PC, atualiza [[project-estado-atual]] com:
- HEAD: `48b16bf`
- Feature entregue: Fase B.1 da Onda B (schema doubles + entity_ref)
- Bugs: nenhum
- Onde a próxima sessão retoma: Fase B.2 do Bloco 3 (controllers de duplas)

Cola o resultado do smoke test em [[project-historico-sessoes]].

---

## Rollback (plano B)

Só se algo quebrar de forma irrecuperável nas Etapas 7-10.

**Preconditions**: o backup da Etapa 2 existe e é > 1 MB.

```
pm2 stop birdify-api
mysql -u root -p golf_db < "$BACKUP_FILE"
git reset --hard 9221da1     # HEAD anterior ao commit 3.1
pm2 start birdify-api
pm2 logs birdify-api --lines 30
```

Depois cola no chat exatamente o que aconteceu (qual etapa, qual saída
inesperada) — precisa entender a causa antes de tentar de novo.

**Nota sobre `git reset --hard` na VPS**: só use se você entende que
isso apaga qualquer arquivo modificado localmente na VPS (não devia
ter nenhum, mas confirma com `git status` antes).
