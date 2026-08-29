// Verificacao runtime do bug de bounds de rodada (Bloco D · hotfix 2026-08-29):
// jogador de um grupo de R1 conseguia gravar score em R2/R3 (mesmo o grupo
// dele em R1 sendo diferente do grupo em R2 apos re-seeding). Bug observado
// no torneio ASPIRANTES: mesmo user marcou strokes diferentes no mesmo buraco
// em R1/R2/R3.
//
// Cenarios (todos via API direta — bug e de backend, frontend so amplifica):
//   1. save R2 por jogador de R1  → 403
//   2. sign-card R2 no grupo de R1 → 403
//   3. save R1 pelo mesmo jogador  → 200 (nao-regressao)
//
// Como rodar (backend precisa estar de pe em localhost:3001):
//   cd scripts/verify && node verify-round-boundary.js

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

const R1_PLAYER_EMAIL = 'verify.round.r1@test.local';
const R2_PLAYER_EMAIL = 'verify.round.r2@test.local';
const PASSWORD = 'birdify123';
const CLUB_ID = 1;
const COURSE_ID = 10; // mesmo course usado pelos outros verifies

async function query(sql, params = []) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute(sql, params);
    return rows;
  } finally { await conn.end(); }
}

async function ensureUsers() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const conn = await mysql.createConnection(DB_CFG);
  try {
    for (const [name, email] of [
      ['Verify Round R1', R1_PLAYER_EMAIL],
      ['Verify Round R2', R2_PLAYER_EMAIL],
    ]) {
      await conn.execute(
        `INSERT INTO users (name, email, password_hash, gender, role)
         VALUES (?, ?, ?, 'M', 'PLAYER')
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), name=VALUES(name)`,
        [name, email, hash],
      );
    }
  } finally { await conn.end(); }
}

async function login(email) {
  let res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status === 401 || res.status === 404) {
    await ensureUsers();
    res = await fetch(`${BACKEND}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
  }
  const j = await res.json();
  if (!res.ok) throw new Error(`Login ${email} falhou: ${JSON.stringify(j)}`);
  return { token: j.token, user: j.user };
}

async function bootstrap() {
  await ensureUsers();
  const r1 = await login(R1_PLAYER_EMAIL);
  const r2 = await login(R2_PLAYER_EMAIL);

  const tag = `VRB${Date.now().toString().slice(-6)}`;
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // Torneio com 2 rodadas
    const [t] = await conn.execute(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, status, format, total_rounds)
       VALUES (?, ?, CURDATE(), ?, 'OPEN', 'shotgun', 2)`,
      [CLUB_ID, `Verify Round Bounds ${tag}`, COURSE_ID]
    );
    const tournamentId = t.insertId;

    // tournament_rounds: R1 hoje, R2 amanha, mesmo course
    await conn.execute(
      `INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
       VALUES (?, 1, CURDATE(), ?), (?, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?)`,
      [tournamentId, COURSE_ID, tournamentId, COURSE_ID]
    );

    // Grupo em R1 com r1player
    const [g1] = await conn.execute(
      `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole)
       VALUES (?, 1, ?, ?, 1)`,
      [tournamentId, `R1 Flight ${tag}`, `${tag}A`]
    );
    const groupR1Id = g1.insertId;
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 10)`,
      [groupR1Id, r1.user.id]
    );

    // Grupo em R2 com r2player (r1player NAO participa de R2 — simula re-seeding)
    const [g2] = await conn.execute(
      `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole)
       VALUES (?, 2, ?, ?, 1)`,
      [tournamentId, `R2 Flight ${tag}`, `${tag}B`]
    );
    const groupR2Id = g2.insertId;
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 12)`,
      [groupR2Id, r2.user.id]
    );

    return { tournamentId, groupR1Id, groupR2Id, r1, r2, tag };
  } finally { await conn.end(); }
}

async function cleanup(tag) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(
      `DELETE FROM tournaments WHERE name LIKE ?`,
      [`Verify Round Bounds ${tag}%`]
    );
  } finally { await conn.end(); }
}

async function post(path, token, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function scenario1_saveOutOfRound(ctx) {
  console.log('\n=== Cenario 1: save R2 por jogador de R1 (deve 403) ===');
  const r = await post('/api/scores/save', ctx.r1.token, {
    tournament_id: ctx.tournamentId,
    user_id: ctx.r1.user.id,
    hole_number: 1,
    strokes: 4,
    round_number: 2,
  });
  console.log(`  status=${r.status} body=${JSON.stringify(r.body)}`);
  const passed = r.status === 403;
  console.log(`  ${passed ? '✅' : '❌'} esperado 403, recebeu ${r.status}`);
  return passed;
}

async function scenario2_signCardOutOfRound(ctx) {
  console.log('\n=== Cenario 2: sign-card R2 no grupo de R1 (deve 403) ===');
  const r = await post('/api/scores/sign-card', ctx.r1.token, {
    tournament_id: ctx.tournamentId,
    group_id: ctx.groupR1Id,
    round_number: 2,
  });
  console.log(`  status=${r.status} body=${JSON.stringify(r.body)}`);
  const passed = r.status === 403;
  console.log(`  ${passed ? '✅' : '❌'} esperado 403, recebeu ${r.status}`);
  return passed;
}

async function scenario3_saveInOwnRound(ctx) {
  console.log('\n=== Cenario 3: save R1 pelo jogador de R1 (nao-regressao, deve 200) ===');
  const r = await post('/api/scores/save', ctx.r1.token, {
    tournament_id: ctx.tournamentId,
    user_id: ctx.r1.user.id,
    hole_number: 1,
    strokes: 4,
    round_number: 1,
  });
  console.log(`  status=${r.status} body=${JSON.stringify(r.body)}`);
  const passed = r.status === 200;
  // Confirma no banco pra ter certeza absoluta
  const rows = await query(
    `SELECT strokes, round_number FROM scores
     WHERE tournament_id=? AND user_id=? AND hole_number=1`,
    [ctx.tournamentId, ctx.r1.user.id]
  );
  console.log(`  db.scores=${JSON.stringify(rows)}`);
  const dbOk = rows.length === 1 && Number(rows[0].round_number) === 1 && Number(rows[0].strokes) === 4;
  const finalPassed = passed && dbOk;
  console.log(`  ${finalPassed ? '✅' : '❌'} esperado 200 + linha unica em R1, recebeu ${r.status} + ${rows.length} linha(s)`);
  return finalPassed;
}

(async () => {
  const results = {};
  let ctx;
  try {
    ctx = await bootstrap();
    console.log(`bootstrap ok: tournament=${ctx.tournamentId} groupR1=${ctx.groupR1Id} groupR2=${ctx.groupR2Id}`);
    results.s1 = await scenario1_saveOutOfRound(ctx);
    results.s2 = await scenario2_signCardOutOfRound(ctx);
    results.s3 = await scenario3_saveInOwnRound(ctx);
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
