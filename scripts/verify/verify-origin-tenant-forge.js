// Verificação runtime: Achado CRÍTICO #1 da auditoria de segurança
// (2026-09-17) — o "Detetive de Domínios" (backend/server.js) não pode
// mais confiar no header Origin pra resolver req.club em produção.
//
// Vulnerabilidade (pré-fix): Origin é declarado pelo cliente e forjável
// por qualquer requisição fora de navegador (curl/script/app — CORS só é
// reforçado pelo navegador). Um jogador comum de QUALQUER clube, com seu
// próprio JWT válido, conseguia forjar `Origin: http://<domínio-de-outro-clube>`
// e o backend passava a tratar req.club como sendo esse outro clube —
// vazando dado de leitura/ação de qualquer rota `requireAuth` não-admin.
//
// Fix: backend/server.js só aplica o override de Origin quando
// `NODE_ENV !== "production"` (mesmo padrão já usado pro logger morgan
// em server.js:121). Em produção, o tenant vem só de req.hostname (Host
// real da requisição, garantido pelo Nginx via server_name).
//
// Cenários:
//   B1 (baseline): player loga sem forjar nada → GET /tournaments/list
//                  devolve o torneio do Clube 1 (host real), não o do Clube 2.
//   B2 (exploit tentado): mesmo player, mesmo JWT, forjando
//                  `Origin: http://<domínio-clube-2>` no GET.
//       - Rodando SEM NODE_ENV=production → Origin AINDA sobrescreve
//         (comportamento preservado de propósito pros scripts
//         course_tees_multitenant.js / tee_rules_multitenant.js, que
//         dependem disso pra simular 2 clubes num backend local sem DNS
//         real) → devolve torneio do Clube 2. Vazamento *esperado* aqui,
//         não é regressão — é o modo dev/teste.
//       - Rodando COM NODE_ENV=production → Origin é ignorado → continua
//         devolvendo o torneio do Clube 1. Fix confirmado.
//
// Como rodar (2 modos, sempre contra backend LOCAL — nunca produção):
//   1) Modo dev (confirma que o override de teste não quebrou):
//        cd backend && npm start
//        cd scripts/verify && node verify-origin-tenant-forge.js dev
//
//   2) Modo prod-like (confirma que o vazamento foi fechado):
//        cd backend && NODE_ENV=production npm start
//        cd scripts/verify && node verify-origin-tenant-forge.js prod
//
// Sai 0 se o resultado bate com o modo esperado, 1 caso contrário.

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

const MODE = (process.argv[2] || 'prod').toLowerCase();
if (!['dev', 'prod'].includes(MODE)) {
  console.error(`Modo inválido "${MODE}". Use "dev" ou "prod".`);
  process.exit(1);
}

const CLUB1_ID = 1; // fallback "Birdify Padrão" — sem domain cadastrado bate aqui
const CLUB2_DOMAIN = 'verify-originforge-tenant2.local';
const PLAYER_EMAIL = 'verify.originforge.player1@test.local';
const PASSWORD = 'birdify123';
const TOURNAMENT1_NAME = 'Verify OriginForge — Torneio Clube1';
const TOURNAMENT2_NAME = 'Verify OriginForge — Torneio Clube2';

const state = { club2Id: null, t1Id: null, t2Id: null, playerId: null };

async function withConn(fn) {
  const c = await mysql.createConnection(DB_CFG);
  try { return await fn(c); } finally { await c.end(); }
}

async function setup() {
  await withConn(async (c) => {
    const [ins] = await c.execute(
      `INSERT INTO clubs (name, domain, primary_color) VALUES (?, ?, '#22c55e')`,
      ['Verify OriginForge Club2', CLUB2_DOMAIN],
    );
    state.club2Id = ins.insertId;

    const [t1] = await c.execute(
      `INSERT INTO tournaments (club_id, name, start_date, status) VALUES (?, ?, CURDATE(), 'OPEN')`,
      [CLUB1_ID, TOURNAMENT1_NAME],
    );
    state.t1Id = t1.insertId;

    const [t2] = await c.execute(
      `INSERT INTO tournaments (club_id, name, start_date, status) VALUES (?, ?, CURDATE(), 'OPEN')`,
      [state.club2Id, TOURNAMENT2_NAME],
    );
    state.t2Id = t2.insertId;

    const hash = await bcrypt.hash(PASSWORD, 10);
    await c.execute(
      `INSERT INTO users (name, email, password_hash, gender, role)
       VALUES ('Verify OriginForge Player1', ?, ?, 'M', 'PLAYER')
       ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)`,
      [PLAYER_EMAIL, hash],
    );
    const [[p1]] = await c.execute(`SELECT id FROM users WHERE email=?`, [PLAYER_EMAIL]);
    state.playerId = p1.id;
  });
}

async function cleanup() {
  await withConn(async (c) => {
    if (state.t1Id) await c.execute(`DELETE FROM tournaments WHERE id=?`, [state.t1Id]);
    if (state.t2Id) await c.execute(`DELETE FROM tournaments WHERE id=?`, [state.t2Id]);
    if (state.club2Id) await c.execute(`DELETE FROM clubs WHERE id=?`, [state.club2Id]);
    await c.execute(`DELETE FROM users WHERE email=?`, [PLAYER_EMAIL]);
  });
}

async function loginToken(email, origin) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Login ${email} falhou: ${JSON.stringify(j)}`);
  return j.token;
}

async function listTournaments(token, origin) {
  const res = await fetch(`${BACKEND}/api/tournaments/list`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`GET /tournaments/list falhou: ${JSON.stringify(j)}`);
  return Array.isArray(j) ? j : (j.tournaments || []);
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log(`Backend: ${BACKEND} | Modo esperado: ${MODE === 'prod' ? 'PROD-LIKE (Origin deve ser ignorado)' : 'DEV (Origin deve sobrescrever, comportamento preservado)'}`);
  await setup();
  console.log(`Setup: club2=${state.club2Id}, torneio1=${state.t1Id} (Clube1), torneio2=${state.t2Id} (Clube2 — domain ${CLUB2_DOMAIN})`);

  try {
    // Login sem forjar nada — host real do backend local (localhost) não
    // bate com nenhum domain cadastrado → cai no fallback Clube 1.
    const token = await loginToken(PLAYER_EMAIL, null);

    // B1 — baseline: sem Origin forjado, deve ver só o torneio do Clube 1.
    const baseline = await listTournaments(token, null);
    const baselineHasT1 = baseline.some(t => t.id === state.t1Id);
    const baselineHasT2 = baseline.some(t => t.id === state.t2Id);
    check('B1 baseline (sem Origin forjado) → vê torneio do Clube 1, não do Clube 2',
      baselineHasT1 && !baselineHasT2,
      `t1=${baselineHasT1} t2=${baselineHasT2}`);

    // B2 — tentativa de exploit: mesmo token, Origin forjado pro Clube 2.
    const forged = await listTournaments(token, `http://${CLUB2_DOMAIN}`);
    const forgedHasT1 = forged.some(t => t.id === state.t1Id);
    const forgedHasT2 = forged.some(t => t.id === state.t2Id);

    if (MODE === 'prod') {
      check('B2 PROD-LIKE: Origin forjado é IGNORADO → continua vendo só Clube 1 (vazamento fechado)',
        forgedHasT1 && !forgedHasT2,
        `t1=${forgedHasT1} t2=${forgedHasT2}`);
    } else {
      check('B2 DEV: Origin forjado AINDA sobrescreve → vê torneio do Clube 2 (comportamento de teste preservado)',
        !forgedHasT1 && forgedHasT2,
        `t1=${forgedHasT1} t2=${forgedHasT2}`);
    }
  } finally {
    await cleanup();
    console.log('Cleanup: dados de teste removidos.');
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram.`);
  if (failed.length > 0) {
    console.log(MODE === 'prod'
      ? '\n⚠️  Rode o backend com NODE_ENV=production antes de testar o modo "prod".'
      : '\n⚠️  Rode o backend SEM NODE_ENV=production antes de testar o modo "dev".');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('ERRO FATAL:', err);
  cleanup().catch(() => {}).finally(() => process.exit(1));
});
