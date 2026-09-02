// Verificacao runtime do bug de contagem inflada no leaderboard multi-rodada
// (hotfix 2026-08-29 · torneio ASPIRANTES 116).
//
// Causa: subquery `ph` no getTournamentLeaderboard nao tinha GROUP BY. Como o
// Bloco D (2026-08-28) fez grupos serem por rodada, o mesmo user pode estar em
// N grupos do torneio, e a subquery devolvia N linhas por user. Cada linha
// multiplicava as linhas de scores → holes_played, total_strokes e score_to_par
// inflados na proporcao do numero de grupos.
//
// Este verify:
// 1. Cria torneio 2-round.
// 2. Coloca o mesmo user_id em 1 grupo em R1 E outro grupo em R2 (N=2).
// 3. Grava 18 scores em R1 e 18 scores em R2 pra esse user (via banco, sem passar
//    pela API — o objetivo aqui e testar a AGREGACAO, nao a gravacao).
// 4. Chama GET /api/leaderboard/tournament/:tid?round=1 e afirma:
//      holes_played === 18, total_strokes === 4*18 = 72
//    (sem o fix o valor viria 36 e 144)
// 5. Chama GET /api/leaderboard/tournament/:tid?round=all e afirma:
//      holes_played === 36, total_strokes === 144
//    (sem o fix o valor viria 72 e 288)
//
// Como rodar (backend precisa estar de pe em localhost:3001):
//   cd scripts/verify && node verify-leaderboard-multi-round-count.js

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

const PLAYER_EMAIL = 'verify.leaderboard.multi@test.local';
const PASSWORD = 'birdify123';
const CLUB_ID = 1;
const COURSE_ID = 10;

async function query(sql, params = []) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute(sql, params);
    return rows;
  } finally { await conn.end(); }
}

async function ensureUser() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(
      `INSERT INTO users (name, email, password_hash, gender, role)
       VALUES ('Verify Leaderboard Multi', ?, ?, 'M', 'PLAYER')
       ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)`,
      [PLAYER_EMAIL, hash],
    );
  } finally { await conn.end(); }
}

async function login(email) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Login falhou: ${JSON.stringify(j)}`);
  return { token: j.token, user: j.user };
}

async function bootstrap() {
  await ensureUser();
  const player = await login(PLAYER_EMAIL);
  const tag = `VLM${Date.now().toString().slice(-6)}`;

  const conn = await mysql.createConnection(DB_CFG);
  try {
    // Torneio 2-round
    const [t] = await conn.execute(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, status, format, total_rounds)
       VALUES (?, ?, CURDATE(), ?, 'OPEN', 'shotgun', 2)`,
      [CLUB_ID, `Verify Leaderboard Multi ${tag}`, COURSE_ID]
    );
    const tournamentId = t.insertId;

    // tournament_rounds: R1 hoje, R2 amanha
    await conn.execute(
      `INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id)
       VALUES (?, 1, CURDATE(), ?), (?, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?)`,
      [tournamentId, COURSE_ID, tournamentId, COURSE_ID]
    );

    // inscription (obrigatoria pra aparecer no leaderboard — JOIN inscriptions)
    await conn.execute(
      `INSERT INTO inscriptions (tournament_id, user_id, status)
       VALUES (?, ?, 'APPROVED')`,
      [tournamentId, player.user.id]
    );

    // Grupo em R1 com o player
    const [g1] = await conn.execute(
      `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole)
       VALUES (?, 1, ?, ?, 1)`,
      [tournamentId, `R1 Flight ${tag}`, `${tag}A`]
    );
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 10)`,
      [g1.insertId, player.user.id]
    );

    // Grupo em R2 com o MESMO player (isso e o gatilho do bug)
    const [g2] = await conn.execute(
      `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole)
       VALUES (?, 2, ?, ?, 1)`,
      [tournamentId, `R2 Flight ${tag}`, `${tag}B`]
    );
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 12)`,
      [g2.insertId, player.user.id]
    );

    // 18 scores em R1 + 18 em R2, todos strokes=4 pra soma facil de verificar
    const insertPairs = [];
    const params = [];
    for (let round of [1, 2]) {
      for (let h = 1; h <= 18; h++) {
        insertPairs.push('(?, ?, ?, ?, ?, ?)');
        params.push(tournamentId, player.user.id, player.user.id, h, round, 4);
      }
    }
    await conn.execute(
      `INSERT INTO scores (tournament_id, user_id, entity_ref, hole_number, round_number, strokes)
       VALUES ${insertPairs.join(', ')}`,
      params
    );

    return { tournamentId, player, tag };
  } finally { await conn.end(); }
}

async function cleanup(tag) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(
      `DELETE FROM tournaments WHERE name LIKE ?`,
      [`Verify Leaderboard Multi ${tag}%`]
    );
  } finally { await conn.end(); }
}

async function fetchLeaderboard(tid, roundParam) {
  const q = roundParam ? `?round=${roundParam}` : '';
  const res = await fetch(`${BACKEND}/api/leaderboard/${tid}${q}`);
  const j = await res.json();
  if (!res.ok) throw new Error(`API falhou: ${res.status} ${JSON.stringify(j)}`);
  return j;
}

function findPlayer(rows, userId) {
  return rows.find(r => Number(r.id) === Number(userId));
}

async function scenario1_round1(ctx) {
  console.log('\n=== Cenario 1: ?round=1 → holes_played=18, total_strokes=72 ===');
  const rows = await fetchLeaderboard(ctx.tournamentId, 1);
  const p = findPlayer(rows, ctx.player.user.id);
  if (!p) { console.log('  ❌ player nao encontrado no leaderboard'); return false; }
  console.log(`  holes_played=${p.holes_played} total_strokes=${p.total_strokes} handicap=${p.handicap}`);
  const passed = Number(p.holes_played) === 18 && Number(p.total_strokes) === 72;
  console.log(`  ${passed ? '✅' : '❌'} esperado 18/72, recebeu ${p.holes_played}/${p.total_strokes}`);
  return passed;
}

async function scenario2_round2(ctx) {
  console.log('\n=== Cenario 2: ?round=2 → holes_played=18, total_strokes=72 ===');
  const rows = await fetchLeaderboard(ctx.tournamentId, 2);
  const p = findPlayer(rows, ctx.player.user.id);
  if (!p) { console.log('  ❌ player nao encontrado'); return false; }
  console.log(`  holes_played=${p.holes_played} total_strokes=${p.total_strokes}`);
  const passed = Number(p.holes_played) === 18 && Number(p.total_strokes) === 72;
  console.log(`  ${passed ? '✅' : '❌'} esperado 18/72, recebeu ${p.holes_played}/${p.total_strokes}`);
  return passed;
}

async function scenario3_all(ctx) {
  console.log('\n=== Cenario 3: sem filtro (all) → holes_played=36, total_strokes=144 ===');
  const rows = await fetchLeaderboard(ctx.tournamentId, null);
  const p = findPlayer(rows, ctx.player.user.id);
  if (!p) { console.log('  ❌ player nao encontrado'); return false; }
  console.log(`  holes_played=${p.holes_played} total_strokes=${p.total_strokes}`);
  const passed = Number(p.holes_played) === 36 && Number(p.total_strokes) === 144;
  console.log(`  ${passed ? '✅' : '❌'} esperado 36/144, recebeu ${p.holes_played}/${p.total_strokes}`);
  return passed;
}

async function scenario4_handicapNotInflated(ctx) {
  console.log('\n=== Cenario 4: handicap exibido nao vem duplicado ===');
  // Handicap declarado 10 em R1 e 12 em R2. Com MAX() na subquery, sai 12 (nao 24, nao 22).
  const rows = await fetchLeaderboard(ctx.tournamentId, null);
  const p = findPlayer(rows, ctx.player.user.id);
  if (!p) { console.log('  ❌ player nao encontrado'); return false; }
  const hcp = Number(p.handicap);
  const passed = hcp === 12; // MAX de (10, 12)
  console.log(`  handicap=${hcp} — esperado 12 (MAX de 10 e 12)`);
  console.log(`  ${passed ? '✅' : '❌'}`);
  return passed;
}

(async () => {
  const results = {};
  let ctx;
  try {
    ctx = await bootstrap();
    console.log(`bootstrap ok: tournament=${ctx.tournamentId} user=${ctx.player.user.id}`);
    results.s1 = await scenario1_round1(ctx);
    results.s2 = await scenario2_round2(ctx);
    results.s3 = await scenario3_all(ctx);
    results.s4 = await scenario4_handicapNotInflated(ctx);
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
