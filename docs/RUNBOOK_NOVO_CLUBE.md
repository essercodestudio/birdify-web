# Runbook — Onboarding de clube novo (subdomínio dedicado)

Passo-a-passo pra ligar um clube novo em produção com subdomínio
próprio (`<clube>.birdify.com.br`), TLS válido, tema isolado e admin
com acesso ao painel `/admin/*`.

Consolidado a partir dos onboardings de Pine Hill (2026-08-24) e
Paraná Golf Club (2026-08-27), incluindo as armadilhas descobertas
no caminho.

---

## Variáveis do onboarding

Antes de começar, preencha estes valores — todos os comandos abaixo
usam eles como placeholder `${VAR}`:

| Variável | Exemplo | O que é |
|----------|---------|---------|
| `CLUB_NAME` | `Paraná Golf Club` | Nome oficial do clube (aparece no header/temas) |
| `CLUB_SUBDOMAIN` | `paranagolf` | Sem `.birdify.com.br`. Sem acento, minúsculo, `[a-z0-9-]+` |
| `CLUB_DOMAIN` | `paranagolf.birdify.com.br` | `${CLUB_SUBDOMAIN}.birdify.com.br` |
| `ADMIN_NAME` | `Paulo Kappauns` | Nome completo do admin do clube |
| `ADMIN_EMAIL` | `adminprgolf@golf.com` | Email do admin (UNIQUE em `users`) |

Escolha `PRIMARY_COLOR` = `#22c55e` (verde Birdify default) como
placeholder — o clube customiza depois pelo painel `/admin/clube`.

---

## Pré-requisito — DNS

Antes de qualquer coisa na VPS, criar registro DNS A:

```
${CLUB_SUBDOMAIN}.birdify.com.br  →  72.60.15.37
```

Provedor DNS: Hostinger. Propagação normalmente < 5 min. Valide com:

```bash
dig +short ${CLUB_DOMAIN}
# esperado: 72.60.15.37
```

Se ainda não resolveu, esperar e não seguir — o Certbot HTTP-01
precisa que o subdomínio resolva pra fazer o desafio.

---

## Passo 1 — Investigação do estado atual

**SEMPRE fazer antes** de tocar em qualquer coisa. O certificado e o
Nginx podem ter mudado desde o último onboarding.

```bash
certbot certificates
grep -n "server_name" /etc/nginx/sites-available/birdify
grep -E "^FRONTEND_URL" /var/www/golf-scorer/backend/.env
```

O que anotar:

1. **Cert principal `birdify.com.br`** — qual conjunto de domínios ele
   cobre HOJE. Precisa disso pra montar o comando do Passo 2.
2. **Nginx server_name** — confirmar que o bloco 443 tem
   `*.birdify.com.br` (wildcard). Se sim, o Nginx já serve o novo
   subdomínio sem edição — só faltará o cert.
3. **FRONTEND_URLS atual** — a lista literal separada por vírgula. Vai
   servir de base pro Passo 5 (adicionar sem remover nada).

---

## Passo 2 — Certbot Expand (armadilha do wildcard)

REGRA DE OURO — extraída do incidente do Pine Hill (2026-08-24):

> Quando o bloco Nginx tem `server_name` com `*.birdify.com.br`, um
> `certbot --nginx -d ${CLUB_DOMAIN}` **isolado** vai enxergar o bloco
> existente e **substituir** o `ssl_certificate` por um cert que cobre
> só o novo domínio — deixando `birdify.com.br` com cert inválido.

**SEMPRE listar TODOS os domínios do cert principal + o novo juntos**,
pra o Certbot detectar que já existe cert cobrindo alguns e oferecer
a opção **Expand** (gerando um cert único que cobre a união):

```bash
certbot --nginx \
  -d birdify.com.br \
  -d www.birdify.com.br \
  -d pinehill.birdify.com.br \
  -d <TODOS_OS_JÁ_EXISTENTES_DO_PASSO_1> \
  -d ${CLUB_DOMAIN}
```

Quando perguntar `(E)xpand/(C)ancel`, responder **E**.

**Validação obrigatória:**

```bash
certbot certificates | grep -A 3 "Certificate Name: birdify.com.br"
curl -sI https://birdify.com.br            | head -1
curl -sI https://www.birdify.com.br        | head -1
curl -sI https://pinehill.birdify.com.br   | head -1
# ... um curl -sI pra cada subdomínio existente
curl -sI https://${CLUB_DOMAIN}            | head -1
```

Todos devem devolver `HTTP/1.1 200 OK` (ou 301/302) **sem erro TLS**.
Se algum falhar, o cert está mal — repetir o Certbot com a lista
correta.

---

## Passo 3 — INSERTs no banco (transação supervisionada)

Backup do banco antes (rede de segurança padrão):

```bash
STAMP=$(date +%Y%m%d_%H%M)
mkdir -p /root/backups
mysqldump -u root -p golf_db > /root/backups/golf_db_${STAMP}_pre_${CLUB_SUBDOMAIN}.sql
ls -lh /root/backups/golf_db_${STAMP}_pre_${CLUB_SUBDOMAIN}.sql
tail -1 /root/backups/golf_db_${STAMP}_pre_${CLUB_SUBDOMAIN}.sql
# esperado: "-- Dump completed on ..." (dump íntegro)
```

### 3.1 Gerar hash bcrypt da senha inicial (sem expor a senha)

```bash
(
  cd /var/www/golf-scorer/backend
  read -sp "Senha inicial do admin: " P; echo
  HASH=$(node -e "process.stdin.on('data',d=>console.log(require('bcryptjs').hashSync(d.toString().replace(/\n$/,''),10)))" <<< "$P")
  umask 077
  cat > /root/${CLUB_SUBDOMAIN}_onboard.sql <<SQL
SELECT id, name, domain FROM clubs
 WHERE domain = '${CLUB_DOMAIN}';

SELECT id, email FROM users
 WHERE email = '${ADMIN_EMAIL}';

START TRANSACTION;

INSERT INTO clubs (name, domain, primary_color)
VALUES ('${CLUB_NAME}',
        '${CLUB_DOMAIN}',
        '#22c55e');
SET @club_id = LAST_INSERT_ID();

INSERT INTO users (name, email, password_hash, role)
VALUES ('${ADMIN_NAME}',
        '${ADMIN_EMAIL}',
        '${HASH}',
        'ADMIN');
SET @user_id = LAST_INSERT_ID();

INSERT INTO club_admins (user_id, club_id)
VALUES (@user_id, @club_id);

SELECT @club_id AS club_id, @user_id AS user_id;

SELECT id, name, domain, primary_color, background_color, logo_url
  FROM clubs WHERE id = @club_id;

SELECT id, name, email, role FROM users WHERE id = @user_id;

SELECT user_id, club_id FROM club_admins
 WHERE user_id = @user_id AND club_id = @club_id;

-- COMMIT; manual, após conferir os SELECTs acima
SQL
)
history -d $((HISTCMD-1)) 2>/dev/null
ls -la /root/${CLUB_SUBDOMAIN}_onboard.sql
```

Notas:
- Subshell `(...)`: senha, `P` e `HASH` morrem no `)`. Zero `unset`.
- `read -sp`: prompt escondido; herestring `<<<` passa por stdin (não
  vira argv, nem entra em `ps auxf`).
- `umask 077` antes do `cat >`: arquivo criado só-leitura pro root.
- O arquivo temporário contém o hash — deletar depois com `shred -u`.

### 3.2 Rodar a transação

```bash
mysql -u root -p golf_db
```

Dentro do mysql:
```
mysql> SOURCE /root/${CLUB_SUBDOMAIN}_onboard.sql;
```

O que conferir no output antes de commitar:

| Check | Esperado |
|-------|----------|
| Preflight `clubs` (domain) | `Empty set` — 0 linhas |
| Preflight `users` (email) | `Empty set` — 0 linhas |
| INSERT clubs | `1 row affected` |
| INSERT users | `1 row affected` |
| INSERT club_admins | `1 row affected` |
| SELECT `@club_id`, `@user_id` | Inteiros novos, ambos não-NULL |
| SELECT do clube | 1 linha com `name`, `domain`, `primary_color` corretos, `background_color=NULL`, `logo_url=NULL` |
| SELECT do user | 1 linha com `role=ADMIN`, email correto |
| SELECT do vínculo `club_admins` | 1 linha com `(user_id, club_id)` batendo |

Se qualquer coisa divergir:
```
mysql> ROLLBACK;
```

Se tudo bater:
```
mysql> COMMIT;
```

Sanity check pós-commit (fora da transação):
```sql
SELECT id, name, domain, primary_color FROM clubs WHERE id = <CLUB_ID>;
SELECT id, name, email, role, LEFT(password_hash, 7) AS hash_prefix
  FROM users WHERE id = <USER_ID>;
SELECT user_id, club_id FROM club_admins WHERE user_id = <USER_ID>;
```

`hash_prefix` deve ser `$2b$10$` (bcrypt round 10).

### 3.3 Apagar o SQL temporário (contém o hash)

```bash
shred -u /root/${CLUB_SUBDOMAIN}_onboard.sql
```

`shred -u` sobrescreve antes de deletar — o hash não sobra em blocos
livres do disco.

---

## Passo 4 — Atualizar `FRONTEND_URLS` (CORS)

Sem isso, o CORS bloqueia todos os XHR do novo domínio.

```bash
cd /var/www/golf-scorer/backend
cp .env .env.bak.$(date +%Y%m%d_%H%M)
```

Pega a linha atual de `FRONTEND_URLS`, adiciona `https://${CLUB_DOMAIN}`
no final (preservando TODAS as URLs existentes), e substitui:

```bash
sed -i 's|^FRONTEND_URLS=.*|FRONTEND_URLS=<LISTA_ATUAL>,https://'${CLUB_DOMAIN}'|' .env
grep -E "^FRONTEND_URL" .env
```

Confere que o `grep` mostra a nova URL no final e que **nenhuma URL
antiga sumiu** (comparar com o que você anotou no Passo 1).

Padrão recorrente pra pescar: se o clube tem alias `www.` no cert
(cenário Pine Hill/Paraná), `www.${CLUB_DOMAIN}` também precisa entrar
na lista — vale a mesma lacuna do bug do CORS descoberto no onboarding
do Paraná Golf.

---

## Passo 5 — `pm2 restart --update-env`

O `--update-env` é OBRIGATÓRIO — sem ele o processo continua com o
`FRONTEND_URLS` antigo em memória, e o CORS segue bloqueando o novo
subdomínio.

```bash
pm2 restart birdify-api --update-env
pm2 logs birdify-api --lines 25 --nostream
```

O que conferir:

1. **5 mensagens de saúde:**
   - `Pool de conexões MySQL configurado (fuso BRT)`
   - `Birdify Engine rodando na porta 3001`
   - `Socket.io ativo — tempo real habilitado`
   - `Detetive Multi-Clubes ativado.`
   - `Despertador da meia-noite (Cron) ativado!`
2. **Sem stack trace novo** de `Origem não autorizada`. Se aparecer
   uma origem legítima bloqueada (ex: `www.${CLUB_DOMAIN}`), voltar
   ao Passo 4 e adicionar.
3. Erros conhecidos que continuam aparecendo (não é regressão):
   - `❌ Cron [Pine Hill Golf Club Score]: ER_NO_REFERENCED_ROW`
   - `ValidationError … ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

---

## Passo 6 — Smoke test

### 6.1 Backend
```bash
curl -sI https://${CLUB_DOMAIN} | head -1
# esperado: HTTP/1.1 200 OK

curl -s https://${CLUB_DOMAIN}/api/theme
# esperado: JSON com "id":<CLUB_ID>, "name":"<CLUB_NAME>",
#           "domain":"<CLUB_DOMAIN>", "primary_color":"#22c55e"
```

Se o `/api/theme` devolver clube id=1 ("Birdify Padrão"), o Detetive
de Domínios não pegou o subdomínio — provável falha de
`clubs.domain`. Revisitar Passo 3.

Sanity check CORS:
```bash
curl -sI -H "Origin: https://${CLUB_DOMAIN}" https://${CLUB_DOMAIN}/api/theme \
  | grep -i access-control-allow-origin
# esperado: access-control-allow-origin: https://<CLUB_DOMAIN>
```

### 6.2 Navegador (aba anônima em cada passo)

1. `https://${CLUB_DOMAIN}` — cadeado verde, sem cert warning, tela
   de login com identidade default (verde `#22c55e`).
2. Login com `${ADMIN_EMAIL}` + senha inicial → PlayerHome.
3. Menu admin ou `/admin/dashboard` — entra sem 403, painel KPIs do
   clube novo, tudo zerado.
4. **Regressão** — visitar cada domínio existente:
   `https://birdify.com.br`, `https://pinehill.birdify.com.br`, etc.
   Todos devem carregar sem cert warning e mostrar a identidade
   correta do respectivo clube.

Pedir pro admin trocar a senha inicial via `/esqueci-senha` no
primeiro login (a senha inicial ficou registrada apenas em memória
temporária durante o Passo 3).

---

## Rollback

Cada passo tem uma reversão isolada — não é necessário reverter tudo.

| Passo falhou | Reversão |
|--------------|----------|
| 2 (Certbot) | Rodar `certbot --nginx` de novo com a lista antiga (sem o novo `-d`) pra recuperar o cert anterior. |
| 3 (INSERTs) — antes do COMMIT | `ROLLBACK;` no mysql. Zero efeito. |
| 3 (INSERTs) — depois do COMMIT | `DELETE FROM club_admins WHERE user_id=<U>; DELETE FROM users WHERE id=<U>; DELETE FROM clubs WHERE id=<C>;` OU restore do dump `/root/backups/golf_db_<STAMP>_pre_<CLUB>.sql`. |
| 4 (.env) | `cp .env.bak.<STAMP> .env && pm2 restart birdify-api --update-env` |
| 5 (pm2) | Se o restart falhou, ver `pm2 logs --err`. Se o boot deu Error, corrigir causa raiz — não force skip. |

---

## Armadilhas conhecidas (lições coletadas)

1. **CORS sem normalização** — `www.<domain>` é ORIGIN diferente de
   `<domain>`. Se o cert cobre `www`, o CORS também precisa.
   Descoberto no Paraná Golf (2026-08-27).
2. **Certbot + Nginx wildcard = perigo** — sempre listar TODOS os
   domínios existentes + o novo. Descoberto no Pine Hill (2026-08-24).
3. **`pm2 restart` sem `--update-env`** — env novo não é propagado.
   O processo continua com os valores do último start.
4. **Senha em texto puro no chat** — proibido. Sempre usar o fluxo
   `read -sp` + `bcryptjs` + herestring (Passo 3.1).
5. **Terminal SSH trunca paste longo** — SQL não-trivial vai por
   arquivo + `SOURCE`, nunca colado direto no `mysql`.
6. **Detetive de Domínios é string-match exato** em `clubs.domain`.
   Domínio no banco tem que ser LITERAL `<sub>.birdify.com.br`, sem
   `https://`, sem porta, sem trailing slash.

---

## Estado ao final

- Um cert Let's Encrypt cobrindo `birdify.com.br` + todos os
  subdomínios de clubes (renovação automática via cron do Certbot).
- Uma linha em `clubs` por clube.
- Uma linha em `users` por admin + uma linha em `club_admins`
  vinculando cada admin ao seu clube.
- `.env` `FRONTEND_URLS` com todas as URLs `https://<sub>.birdify.com.br`
  separadas por vírgula.
- Cada subdomínio serve o app React com a identidade visual do
  respectivo clube (default até o admin configurar via `/admin/clube`).
