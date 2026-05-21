# 🦅 Birdify — Guia de Deploy

Sistema de gestão de golfe (Node.js/Express + React + MySQL).

## Pré-requisitos no servidor

- Node.js 18+ e npm
- MySQL 8+ (banco `golf_db`)
- Nginx (proxy reverso + SSL) e PM2 (gerenciador de processo)

## Variáveis de ambiente

⚠️ **Nunca commite arquivos `.env`.** Crie-os manualmente no servidor a partir dos
`.env.example`. Os valores reais ficam só no servidor.

### Backend — `backend/.env`

| Variável        | Descrição                                              | Obrigatória |
|-----------------|--------------------------------------------------------|:-----------:|
| `PORT`          | Porta da API (ex.: `3001`)                             | Sim         |
| `JWT_SECRET`    | Segredo dos tokens. String aleatória longa (64+ hex)   | Sim         |
| `DB_HOST`       | Host do MySQL (ex.: `localhost`)                       | Sim         |
| `DB_PORT`       | Porta do MySQL (ex.: `3306`)                           | Não         |
| `DB_USER`       | Usuário do MySQL                                       | Sim         |
| `DB_PASSWORD`   | Senha do MySQL                                         | Sim         |
| `DB_NAME`       | Nome do banco (`golf_db`)                              | Sim         |
| `EMAIL_HOST`    | SMTP de envio (ex.: `smtp.gmail.com`)                  | Sim         |
| `EMAIL_USER`    | Conta de e-mail remetente                              | Sim         |
| `EMAIL_PASS`    | Senha de app do e-mail (16 caracteres)                 | Sim         |
| `FRONTEND_URLS` | Origens permitidas pelo CORS, separadas por vírgula    | Sim         |

> `FRONTEND_URL` (singular) ainda é aceito por compatibilidade; prefira `FRONTEND_URLS`.

### Frontend — `frontend/.env.production`

| Variável               | Valor recomendado em produção                   |
|------------------------|-------------------------------------------------|
| `GENERATE_SOURCEMAP`   | `false` (não expor o código-fonte no navegador) |
| `INLINE_RUNTIME_CHUNK` | `false`                                         |
| `REACT_APP_API_URL`    | `/api` (mesma origem)                           |
| `REACT_APP_SOCKET_URL` | vazio (mesma origem)                            |
| `REACT_APP_MEDIA_URL`  | vazio (caminho relativo `/uploads/...`)         |

## Passos de deploy

```bash
# Backend
cd backend
npm ci --omit=dev
# crie o backend/.env com os valores reais
pm2 start server.js --name birdify-api

# Frontend
cd ../frontend
npm ci
npm run build          # gera frontend/build/ (servido pelo Nginx)
```

## Checklist de segurança pré-deploy

- [ ] `backend/.env` e `frontend/.env*` criados no servidor e **fora do Git**
- [ ] `JWT_SECRET` e senhas exclusivos de produção (não reutilizar os de dev)
- [ ] `FRONTEND_URLS` aponta só para o domínio oficial (CORS sem `*`)
- [ ] `GENERATE_SOURCEMAP=false` no build de produção
- [ ] `helmet` instalado e ativo no Express
- [ ] HTTPS ativo no Nginx; `_diag.js` não enviado ao servidor
