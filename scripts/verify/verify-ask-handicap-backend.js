// Verificacao runtime do backend do commit 2.2 (ask_handicap).
//
// Escopo (backend puro — sem UI):
//   1. POST /api/tournaments/create SEM ask_handicap → default 1
//   2. POST /api/tournaments/create COM ask_handicap=0 → persiste 0
//   3. GET  /api/tournaments/:id → expoe ask_handicap
//   4. PUT  /api/tournaments/update/:id SEM ask_handicap → preserva atual
//   5. PUT  /api/tournaments/update/:id COM ask_handicap=1 → volta pra 1
//   6. Valores estranhos (null, string "xyz", 42) → cai no default 1
//
// Requisitos: backend rodando em localhost:3001 + banco de dev com migration 2.1 aplicada.
//
// Como rodar (do repo root):
//   cd scripts/verify && node verify-ask-handicap-backend.js

const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const BASE = 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const ADMIN_EMAIL = 'verify.askhandicap@test.local';
const ADMIN_PWD   = 'verify123';

let failures = 0;
const fail = (m) => { failures++; console.log('X', m); };
const pass = (m) => console.log('OK', m);

async function ensureAdmin() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash(ADMIN_PWD, 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [ADMIN_EMAIL]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=? WHERE id=?',
        [hash, 'ADMIN', 'Verify AskHandicap', id]);
    } else {
      const [r] = await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?,?,?,?,?)',
        ['Verify AskHandicap', ADMIN_EMAIL, hash, 'ADMIN', 'M']
      );
      id = r.insertId;
    }
    await conn.execute('INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, 1)', [id]);
    return id;
  } finally { await conn.end(); }
}

async function pickCourse() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    if (!rows.length) throw new Error('nenhum course no clube 1 pra teste');
    return rows[0].id;
  } finally { await conn.end(); }
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PWD }),
  });
  if (!res.ok) throw new Error(`login falhou: ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error('login sem token no response');
  return data.token;
}

// Data em BRT no futuro (amanha 12:00) — evita "data no passado".
function futureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T').slice(0, 16);
}

// registration_deadline: null (nao '') — updateTournament tem nn que so troca
// undefined por null; string vazia bate 'Incorrect datetime value'. Bug antigo
// alheio a este commit; evito reproduzi-lo no verify.
function makePayload(course_id, extra = {}) {
  return {
    name: `Verify AskHandicap ${Date.now()}`,
    start_date: futureDate(),
    course_id,
    description: null, fee: null, payment_info: null, pix_key_type: 'Chave Aleatoria',
    whatsapp_contact: null, registration_deadline: null,
    categories: [], sponsors: [],
    format: 'shotgun',
    total_rounds: 1,
    scoring_type: 'strokes',
    modality: 'individual',
    ...extra,
  };
}

async function apiPost(token, url, body) {
  return fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
async function apiPut(token, url, body) {
  return fetch(`${BASE}${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
async function apiGet(token, url) {
  return fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } });
}
async function apiDelete(token, url) {
  return fetch(`${BASE}${url}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

(async () => {
  await ensureAdmin();
  const courseId = await pickCourse();
  const token = await login();
  console.log(`admin logado, course_id=${courseId}`);

  const createdIds = [];
  const cleanup = async () => {
    for (const id of createdIds) {
      try { await apiDelete(token, `/api/tournaments/delete/${id}`); } catch {}
    }
  };

  try {
    // 1. Create SEM ask_handicap → default 1
    console.log('\n== 1. create sem ask_handicap → default 1 ==');
    let res = await apiPost(token, '/api/tournaments/create', makePayload(courseId));
    let body = await res.json();
    if (!res.ok) { fail(`create sem ask_handicap: HTTP ${res.status} ${JSON.stringify(body)}`); }
    else if (body.ask_handicap !== 1) fail(`response.ask_handicap esperado 1, veio ${body.ask_handicap}`);
    else pass('create sem ask_handicap → response.ask_handicap=1');
    createdIds.push(body.id);
    const id1 = body.id;

    let getRes = await apiGet(token, `/api/tournaments/${id1}`);
    let getBody = await getRes.json();
    if (Number(getBody.ask_handicap) !== 1) fail(`GET id1 esperado 1, veio ${getBody.ask_handicap}`);
    else pass('GET id1 → ask_handicap=1 (persistido)');

    // 2. Create COM ask_handicap=0 → persiste 0
    console.log('\n== 2. create com ask_handicap=0 ==');
    res = await apiPost(token, '/api/tournaments/create', makePayload(courseId, { ask_handicap: 0 }));
    body = await res.json();
    if (!res.ok) { fail(`create com 0: HTTP ${res.status} ${JSON.stringify(body)}`); }
    else if (body.ask_handicap !== 0) fail(`response.ask_handicap esperado 0, veio ${body.ask_handicap}`);
    else pass('create ask_handicap=0 → response.ask_handicap=0');
    createdIds.push(body.id);
    const id2 = body.id;

    getRes = await apiGet(token, `/api/tournaments/${id2}`);
    getBody = await getRes.json();
    if (Number(getBody.ask_handicap) !== 0) fail(`GET id2 esperado 0, veio ${getBody.ask_handicap}`);
    else pass('GET id2 → ask_handicap=0 (persistido)');

    // 3. Update SEM ask_handicap → preserva atual (0)
    console.log('\n== 3. update sem ask_handicap → preserva 0 ==');
    res = await apiPut(token, `/api/tournaments/update/${id2}`, makePayload(courseId, { name: 'Verify Renamed' }));
    body = await res.json();
    if (!res.ok) { fail(`update sem ask_handicap: HTTP ${res.status} ${JSON.stringify(body)}`); }
    getRes = await apiGet(token, `/api/tournaments/${id2}`);
    getBody = await getRes.json();
    if (Number(getBody.ask_handicap) !== 0) fail(`update sem campo → esperado preservar 0, veio ${getBody.ask_handicap}`);
    else pass('update sem ask_handicap preservou o atual (0)');

    // 4. Update COM ask_handicap=1 → volta pra 1
    console.log('\n== 4. update ask_handicap=1 → volta pra 1 ==');
    res = await apiPut(token, `/api/tournaments/update/${id2}`, makePayload(courseId, { ask_handicap: 1 }));
    body = await res.json();
    if (!res.ok) { fail(`update pra 1: HTTP ${res.status} ${JSON.stringify(body)}`); }
    getRes = await apiGet(token, `/api/tournaments/${id2}`);
    getBody = await getRes.json();
    if (Number(getBody.ask_handicap) !== 1) fail(`update pra 1 → veio ${getBody.ask_handicap}`);
    else pass('update ask_handicap=1 gravou 1');

    // 5. Create com valor estranho → cai no default 1
    console.log('\n== 5. valores estranhos caem no default 1 ==');
    for (const weird of [null, 'xyz', 42, {}]) {
      res = await apiPost(token, '/api/tournaments/create', makePayload(courseId, { ask_handicap: weird }));
      body = await res.json();
      if (!res.ok) { fail(`weird=${JSON.stringify(weird)}: HTTP ${res.status}`); continue; }
      createdIds.push(body.id);
      if (body.ask_handicap !== 1) fail(`weird=${JSON.stringify(weird)} → esperado default 1, veio ${body.ask_handicap}`);
      else pass(`weird=${JSON.stringify(weird)} → default 1 aplicado`);
    }

    // 6. Retrocompat: torneio pre-existente (criado antes da coluna) tem ask_handicap=1
    console.log('\n== 6. torneios pre-existentes → todos com ask_handicap=1 ==');
    const conn = await mysql.createConnection(DB_CFG);
    try {
      const [[{ n }]] = await conn.query(
        'SELECT COUNT(*) AS n FROM tournaments WHERE ask_handicap IS NULL OR ask_handicap NOT IN (0,1)'
      );
      if (n !== 0) fail(`${n} torneio(s) com ask_handicap invalido no banco`);
      else pass('0 torneios com ask_handicap invalido (backfill via DEFAULT OK)');
    } finally { await conn.end(); }
  } finally {
    console.log('\n== limpando torneios criados ==');
    await cleanup();
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
