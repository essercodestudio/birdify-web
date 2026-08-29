// Verificacao runtime do endpoint GET /api/admin/trainings/by-date.
//
// Bug real (2026-08-29): a subquery correlacionada `scores_recorded` referenciava
// `tg.created_at` cru, mas o GROUP BY externo usava `DATE_FORMAT(tg.created_at,
// '%Y-%m-%d')`. Como MySQL 8 default tem `sql_mode=only_full_group_by`, a query
// inteira retornava ERROR 1055 e o endpoint respondia 500 — UI "AdminTrainings"
// mostrava "Nenhum treino registrado nos ultimos 180 dias" mesmo com treinos
// reais existindo no clube.
//
// Fix: `DATE(tg.created_at)` na subquery virou `DATE(MIN(tg.created_at))` — MIN
// e agregado valido, e como todas as rows do grupo compartilham mesmo DATE
// (por conta do GROUP BY DATE_FORMAT(...)), MIN devolve um timestamp do
// mesmo dia.
//
// Como rodar (backend precisa estar de pe em localhost:3001):
//   cd scripts/verify && node verify-admin-trainings-by-date.js

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

const ADMIN_EMAIL   = 'verify.trainingsbydate.admin@test.local';
const CREATOR_EMAIL = 'verify.trainingsbydate.creator@test.local';
const PASSWORD  = 'birdify123';
const CLUB_ID   = 1;
const COURSE_ID = 10;

async function query(sql, params = []) {
  const conn = await mysql.createConnection(DB_CFG);
  try { const [rows] = await conn.execute(sql, params); return rows; }
  finally { await conn.end(); }
}

async function ensureUsers() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const conn = await mysql.createConnection(DB_CFG);
  try {
    for (const [name, email, role] of [
      ['Verify Trainings-ByDate Admin',   ADMIN_EMAIL,   'ADMIN'],
      ['Verify Trainings-ByDate Creator', CREATOR_EMAIL, 'PLAYER'],
    ]) {
      await conn.execute(
        `INSERT INTO users (name, email, password_hash, gender, role)
         VALUES (?, ?, ?, 'M', ?)
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), name=VALUES(name), role=VALUES(role)`,
        [name, email, hash, role],
      );
    }
    const [[adm]] = await conn.execute('SELECT id FROM users WHERE email=?', [ADMIN_EMAIL]);
    await conn.execute(
      `INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`,
      [adm.id, CLUB_ID],
    );
  } finally { await conn.end(); }
}

async function login(email) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Login falhou (${email}): ${JSON.stringify(j)}`);
  return { token: j.token, user: j.user };
}

async function bootstrap() {
  await ensureUsers();
  const admin   = await login(ADMIN_EMAIL);
  const creator = await login(CREATOR_EMAIL);

  // access_code em prod e varchar(10) (SCHEMA.sql diz 20 mas divergiu). Mantendo tag curto.
  const tag = `VT${Date.now().toString(36).slice(-6)}`;
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // Cria 2 training_groups do DIA (created_at = NOW()) pra provar que a
    // agregacao por data retorna groups_count=2 quando o fix esta ativo.
    const [g1] = await conn.execute(
      `INSERT INTO training_groups (group_name, access_code, course_id, club_id, creator_id, status, starting_hole, created_at)
       VALUES (?, ?, ?, ?, ?, 'finalizado', 1, NOW())`,
      [`Verify TBD ${tag} A`, `${tag}A`, COURSE_ID, CLUB_ID, creator.user.id],
    );
    const [g2] = await conn.execute(
      `INSERT INTO training_groups (group_name, access_code, course_id, club_id, creator_id, status, starting_hole, created_at)
       VALUES (?, ?, ?, ?, ?, 'ativo', 1, NOW())`,
      [`Verify TBD ${tag} B`, `${tag}B`, COURSE_ID, CLUB_ID, creator.user.id],
    );

    // Participante + 3 scores no grupo A pra alimentar scores_recorded
    await conn.execute(
      `INSERT INTO training_participants (group_id, user_id, handicap)
       VALUES (?, ?, 10)`,
      [g1.insertId, creator.user.id],
    );
    for (let h = 1; h <= 3; h++) {
      await conn.execute(
        `INSERT INTO training_scores (group_id, user_id, hole_number, strokes)
         VALUES (?, ?, ?, 4)`,
        [g1.insertId, creator.user.id, h],
      );
    }

    return { admin, creator, tag, groupIds: [g1.insertId, g2.insertId] };
  } finally { await conn.end(); }
}

async function cleanup(tag) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(
      `DELETE FROM training_groups WHERE group_name LIKE ?`,
      [`Verify TBD ${tag}%`],
    );
  } finally { await conn.end(); }
}

async function fetchByDate(token) {
  const res = await fetch(`${BACKEND}/api/admin/trainings/by-date`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const j = await res.json().catch(() => null);
  return { status: res.status, body: j };
}

async function scenario1_returns200(ctx) {
  console.log('\n=== Cenario 1: endpoint responde 200 (nao 500 do sql_mode) ===');
  const r = await fetchByDate(ctx.admin.token);
  console.log(`  status=${r.status}`);
  const passed = r.status === 200 && Array.isArray(r.body);
  console.log(`  ${passed ? '✅' : '❌'} esperado 200 + array`);
  if (!passed) console.log(`  body:`, JSON.stringify(r.body).slice(0, 200));
  return passed;
}

async function scenario2_hasTodayEntry(ctx) {
  console.log('\n=== Cenario 2: response contem entrada do dia com os 2 grupos criados ===');
  const r = await fetchByDate(ctx.admin.token);
  if (r.status !== 200 || !Array.isArray(r.body)) {
    console.log(`  ❌ endpoint nao retornou 200/array (status=${r.status})`);
    return false;
  }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const todayEntry = r.body.find(e => e.date === today);
  if (!todayEntry) {
    console.log(`  ❌ nao achou entrada com date=${today}. Recebidas:`, r.body.map(e => e.date));
    return false;
  }
  console.log(`  entrada de hoje:`, JSON.stringify(todayEntry));
  // >= 2 porque outros treinos do dia podem existir em ambientes com dado pre-existente
  const passed = todayEntry.groups_count >= 2 && todayEntry.scores_recorded >= 3;
  console.log(`  ${passed ? '✅' : '❌'} esperado groups_count>=2 (temos 2) e scores_recorded>=3 (gravamos 3)`);
  return passed;
}

async function scenario3_statusBreakdown(ctx) {
  console.log('\n=== Cenario 3: breakdown de status (ativo + finalizado) contem os 2 novos ===');
  const r = await fetchByDate(ctx.admin.token);
  if (r.status !== 200 || !Array.isArray(r.body)) {
    console.log(`  ❌ endpoint nao retornou 200/array (status=${r.status})`);
    return false;
  }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const todayEntry = r.body.find(e => e.date === today);
  if (!todayEntry) { console.log('  ❌ sem entrada de hoje'); return false; }
  console.log(`  status:`, JSON.stringify(todayEntry.status));
  const passed = todayEntry.status.ativo >= 1 && todayEntry.status.finalizado >= 1;
  console.log(`  ${passed ? '✅' : '❌'} esperado ativo>=1 (temos 1) e finalizado>=1 (temos 1)`);
  return passed;
}

(async () => {
  const results = {};
  let ctx;
  try {
    ctx = await bootstrap();
    console.log(`bootstrap ok: admin=${ctx.admin.user.id} creator=${ctx.creator.user.id} groups=${ctx.groupIds.join(',')}`);
    results.s1 = await scenario1_returns200(ctx);
    results.s2 = await scenario2_hasTodayEntry(ctx);
    results.s3 = await scenario3_statusBreakdown(ctx);
  } catch (e) {
    console.error('ERRO:', e);
    results.error = e.message;
  } finally {
    if (ctx?.tag) await cleanup(ctx.tag).catch(() => {});
  }
  console.log('\n=== RESULTADO ===');
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every(v => v === true) ? 0 : 1);
})();
