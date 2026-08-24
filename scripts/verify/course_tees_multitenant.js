// Verificação runtime: isolamento multi-tenant + auth do CRUD de
// course_tees (Bloco B da feature "tees dinâmicos").
//
// Cenários:
//   T1 control: admin1 → POST tee em curso próprio → 201
//   T2 iso:     admin1 → POST tee em curso alheio (clube 2) → 404
//   T3 control: admin1 → PUT tee próprio → 200
//   T4 iso:     admin1 → PUT tee alheio (course 2, tee 2) → 404
//   T5 iso:     admin2 → PUT tee alheio (course 1, tee 1) → 404
//   T6 auth:    player → POST/PUT/DELETE → 403
//   T7 iso GET: admin1 → GET tees do curso alheio → 404
//   T8 delete:  admin1 → DELETE tee próprio → 200 + cascaded_rules_count = 1
//   T9 dup:     admin1 → POST tee duplicado (mesmo nome no mesmo course) → 409
//   T10 name:   admin1 → PUT com nome vazio → 400
//   T11 hex:    admin1 → POST com color_hex inválido → 400
//   T12 cross:  PUT tee-rules referenciando tee_id de outro course → 400
//
// Como rodar:  cd scripts/verify && node course_tees_multitenant.js

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = { host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };

const CLUB1_ID = 1;
const CLUB2_DOMAIN = 'verify-tenant2.local';
const ADMIN1_EMAIL = 'verify.tees.admin1@test.local';
const ADMIN2_EMAIL = 'verify.tees.admin2@test.local';
const PLAYER_EMAIL = 'verify.tees.player@test.local';
const PASSWORD = 'birdify123';

const state = { club2Id: null, courseAId: null, courseBId: null };

async function withConn(fn) {
  const c = await mysql.createConnection(DB_CFG);
  try { return await fn(c); } finally { await c.end(); }
}

async function setup() {
  await withConn(async (c) => {
    const [ins] = await c.execute(
      `INSERT INTO clubs (name, domain, primary_color) VALUES (?, ?, '#22c55e')`,
      ['Verify Tenant Tees', CLUB2_DOMAIN],
    );
    state.club2Id = ins.insertId;

    const [cA] = await c.execute(`INSERT INTO courses (club_id, name, city, state) VALUES (?, 'Course Tees A', 'SP','SP')`, [CLUB1_ID]);
    state.courseAId = cA.insertId;
    const [cB] = await c.execute(`INSERT INTO courses (club_id, name, city, state) VALUES (?, 'Course Tees B', 'SP','SP')`, [state.club2Id]);
    state.courseBId = cB.insertId;

    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const [name, email, role] of [
      ['Verify Tees Admin1',  ADMIN1_EMAIL,  'ADMIN'],
      ['Verify Tees Admin2',  ADMIN2_EMAIL,  'ADMIN'],
      ['Verify Tees Player',  PLAYER_EMAIL,  'PLAYER'],
    ]) {
      await c.execute(
        `INSERT INTO users (name, email, password_hash, gender, role) VALUES (?, ?, ?, 'M', ?)
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name)`,
        [name, email, hash, role],
      );
    }
    const [[a1]] = await c.execute(`SELECT id FROM users WHERE email=?`, [ADMIN1_EMAIL]);
    const [[a2]] = await c.execute(`SELECT id FROM users WHERE email=?`, [ADMIN2_EMAIL]);
    await c.execute(`INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`, [a1.id, CLUB1_ID]);
    await c.execute(`INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`, [a2.id, state.club2Id]);
  });
}

async function cleanup() {
  await withConn(async (c) => {
    if (state.courseAId) await c.execute(`DELETE FROM courses WHERE id=?`, [state.courseAId]);
    if (state.courseBId) await c.execute(`DELETE FROM courses WHERE id=?`, [state.courseBId]);
    if (state.club2Id)   await c.execute(`DELETE FROM clubs WHERE id=?`, [state.club2Id]);
    for (const email of [ADMIN1_EMAIL, ADMIN2_EMAIL, PLAYER_EMAIL]) {
      await c.execute(`DELETE FROM users WHERE email=?`, [email]);
    }
  });
}

async function loginToken(email, origin) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Login ${email}: ${JSON.stringify(j)}`);
  return j.token;
}

async function api(method, path, token, body, origin) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: parsed };
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log(`Backend: ${BACKEND}`);
  await setup();
  console.log(`Setup: club2=${state.club2Id}, courseA=${state.courseAId}, courseB=${state.courseBId}`);

  try {
    const originClub1 = 'http://localhost';
    const originClub2 = `http://${CLUB2_DOMAIN}`;
    const admin1 = await loginToken(ADMIN1_EMAIL, originClub1);
    const admin2 = await loginToken(ADMIN2_EMAIL, originClub2);
    const player = await loginToken(PLAYER_EMAIL, originClub1);

    // Semear tees nos 2 cursos manualmente pra evitar depender do auto-seed do createCourse
    // (o INSERT feito no setup foi via SQL direto, sem passar pelo controller).
    await withConn(async (c) => {
      await c.execute(`INSERT INTO course_tees (course_id, tee_name, color_hex, display_order) VALUES (?, 'Semente A', '#111111', 0)`, [state.courseAId]);
      await c.execute(`INSERT INTO course_tees (course_id, tee_name, color_hex, display_order) VALUES (?, 'Semente B', '#222222', 0)`, [state.courseBId]);
    });
    const [rowsA] = await (await mysql.createConnection(DB_CFG)).execute(`SELECT id FROM course_tees WHERE course_id=?`, [state.courseAId]);
    const [rowsB] = await (await mysql.createConnection(DB_CFG)).execute(`SELECT id FROM course_tees WHERE course_id=?`, [state.courseBId]);
    const teeA_seed = rowsA[0].id;
    const teeB_seed = rowsB[0].id;

    // T1 — control: admin1 cria tee no curso próprio
    const t1 = await api('POST', `/courses/${state.courseAId}/tees`, admin1, { tee_name: 'Championship', color_hex: '#000000' }, originClub1);
    check('T1 admin1 → POST tee em curso próprio (A) → 201', t1.status === 201 && t1.body.id > 0, `status=${t1.status} body=${JSON.stringify(t1.body)}`);
    const newTeeAId = t1.body.id;

    // T2 — iso: admin1 tentando POST em curso do clube 2
    const t2 = await api('POST', `/courses/${state.courseBId}/tees`, admin1, { tee_name: 'Invasor', color_hex: '#ff00ff' }, originClub1);
    check('T2 admin1 → POST em curso alheio (B) → 404', t2.status === 404, `got ${t2.status}`);

    // T3 — control: admin1 PUT tee próprio
    const t3 = await api('PUT', `/courses/${state.courseAId}/tees/${newTeeAId}`, admin1, { tee_name: 'Championship Nova', color_hex: '#123456' }, originClub1);
    check('T3 admin1 → PUT tee próprio → 200 com dados atualizados',
      t3.status === 200 && t3.body.tee_name === 'Championship Nova' && t3.body.color_hex === '#123456',
      `status=${t3.status} body=${JSON.stringify(t3.body)}`);

    // T4 — iso: admin1 PUT tee do curso B (não pertence)
    const t4 = await api('PUT', `/courses/${state.courseBId}/tees/${teeB_seed}`, admin1, { tee_name: 'Roubado' }, originClub1);
    check('T4 admin1 → PUT tee de curso alheio (B) → 404', t4.status === 404, `got ${t4.status}`);

    // T5 — iso reversa: admin2 PUT tee do curso A
    const t5 = await api('PUT', `/courses/${state.courseAId}/tees/${teeA_seed}`, admin2, { tee_name: 'Contra' }, originClub2);
    check('T5 admin2 → PUT tee de curso do clube 1 (A) → 404', t5.status === 404, `got ${t5.status}`);

    // T6 — auth: player (não-admin) tentando POST/PUT/DELETE
    const t6a = await api('POST',   `/courses/${state.courseAId}/tees`, player, { tee_name: 'X', color_hex: '#aaaaaa' }, originClub1);
    const t6b = await api('PUT',    `/courses/${state.courseAId}/tees/${teeA_seed}`, player, { tee_name: 'X' }, originClub1);
    const t6c = await api('DELETE', `/courses/${state.courseAId}/tees/${teeA_seed}`, player, null, originClub1);
    check('T6 player não-admin → POST/PUT/DELETE tee → 403 nos 3',
      t6a.status === 403 && t6b.status === 403 && t6c.status === 403,
      `POST=${t6a.status} PUT=${t6b.status} DELETE=${t6c.status}`);

    // T7 — iso GET: admin1 pedindo GET tees do curso alheio
    const t7 = await api('GET', `/courses/${state.courseBId}/tees`, admin1, null, originClub1);
    check('T7 admin1 → GET tees do curso alheio (B) → 404', t7.status === 404, `got ${t7.status}`);

    // T8 — delete cascateando 1 regra: cria regra apontando pro newTeeAId, deleta, confirma cascaded_rules_count=1
    await withConn(async (c) => {
      await c.execute(
        `INSERT INTO course_tee_rules (course_id, gender, tee_color, tee_id, handicap_min, handicap_max, display_order)
         VALUES (?, 'M', NULL, ?, 0.0, 8.5, 0)`,
        [state.courseAId, newTeeAId],
      );
    });
    const t8 = await api('DELETE', `/courses/${state.courseAId}/tees/${newTeeAId}`, admin1, null, originClub1);
    check('T8 admin1 → DELETE tee próprio (com 1 regra) → 200 + cascaded_rules_count=1',
      t8.status === 200 && t8.body.deleted === true && t8.body.cascaded_rules_count === 1,
      `status=${t8.status} body=${JSON.stringify(t8.body)}`);

    // T9 — duplicidade: criar 2 tees com mesmo nome no mesmo campo (bate UNIQUE)
    const t9a = await api('POST', `/courses/${state.courseAId}/tees`, admin1, { tee_name: 'DupTest', color_hex: '#333333' }, originClub1);
    const t9b = await api('POST', `/courses/${state.courseAId}/tees`, admin1, { tee_name: 'DupTest', color_hex: '#444444' }, originClub1);
    check('T9 nome duplicado no mesmo campo → 1º 201, 2º 409',
      t9a.status === 201 && t9b.status === 409,
      `1st=${t9a.status} 2nd=${t9b.status} body2nd=${JSON.stringify(t9b.body)}`);

    // T10 — nome vazio (trim)
    const t10 = await api('PUT', `/courses/${state.courseAId}/tees/${teeA_seed}`, admin1, { tee_name: '   ' }, originClub1);
    check('T10 tee_name em branco (só espaços) → 400', t10.status === 400, `got ${t10.status}`);

    // T11 — color_hex inválido
    const t11 = await api('POST', `/courses/${state.courseAId}/tees`, admin1, { tee_name: 'HexBad', color_hex: 'nao-e-hex' }, originClub1);
    check('T11 color_hex inválido → 400', t11.status === 400, `got ${t11.status}`);

    // T13-T15 (Bloco C) — rules_count no GET pra alimentar o confirm do delete.
    // Seed extra: nova regra apontando pro tee semente do course A.
    await withConn(async (c) => {
      await c.execute(
        `INSERT INTO course_tee_rules (course_id, gender, tee_color, tee_id, handicap_min, handicap_max, display_order)
         VALUES (?, 'M', NULL, ?, 10.0, 20.0, 0), (?, 'F', NULL, ?, 20.1, 30.0, 1)`,
        [state.courseAId, teeA_seed, state.courseAId, teeA_seed],
      );
    });
    const t13 = await api('GET', `/courses/${state.courseAId}/tees`, admin1, null, originClub1);
    const teeSeedInList = t13.body?.tees?.find((t) => t.id === teeA_seed);
    const otherTees = t13.body?.tees?.filter((t) => t.id !== teeA_seed) || [];
    check(
      'T13 GET /tees devolve rules_count por tee (semente com 2 regras)',
      t13.status === 200 && teeSeedInList && teeSeedInList.rules_count === 2,
      `status=${t13.status} seed_rules=${teeSeedInList?.rules_count}`,
    );
    check(
      'T14 GET /tees devolve rules_count = 0 pros tees sem regra',
      otherTees.length > 0 && otherTees.every((t) => t.rules_count === 0),
      `outros=${otherTees.map((t) => `${t.tee_name}:${t.rules_count}`).join(',')}`,
    );

    // T15 — texto do confirm (o cliente escolhe usando rules_count do state).
    // Reproduzimos aqui a mesma decisão que o frontend faz:
    const teeWithRules = teeSeedInList;
    const teeWithoutRules = otherTees[0];
    const msgWith = teeWithRules.rules_count > 0
      ? `Apagar tee "${teeWithRules.tee_name}"? Isso remove ${teeWithRules.rules_count} regra(s) de handicap que apontam pra ele. Continuar?`
      : `Apagar tee "${teeWithRules.tee_name}"?`;
    const msgWithout = teeWithoutRules.rules_count > 0
      ? `Apagar tee "${teeWithoutRules.tee_name}"? Isso remove ${teeWithoutRules.rules_count} regra(s) de handicap que apontam pra ele. Continuar?`
      : `Apagar tee "${teeWithoutRules.tee_name}"?`;
    check(
      'T15 Texto do confirm — variante COM regras cita a contagem',
      msgWith.includes('remove 2 regra(s)') && msgWith.includes(teeWithRules.tee_name),
      msgWith,
    );
    check(
      'T15b Texto do confirm — variante SEM regras é enxuto (sem citar contagem)',
      !msgWithout.includes('regra(s)') && msgWithout.includes(teeWithoutRules.tee_name),
      msgWithout,
    );

    // T12 — cross-course: PUT tee-rules do curso A referenciando tee_id do curso B
    const t12 = await api('PUT', `/courses/${state.courseAId}/tee-rules`, admin1,
      { rules: [{ gender: 'M', tee_id: teeB_seed, handicap_min: 0, handicap_max: 8.5 }] },
      originClub1);
    check('T12 PUT tee-rules apontando pra tee_id de OUTRO course → 400',
      t12.status === 400 && String(t12.body.error || '').includes('não pertence'),
      `status=${t12.status} body=${JSON.stringify(t12.body)}`);

    // T16 — DELETE tee SEM regras → cascaded_rules_count=0.
    // Reusa o "DupTest" criado no T9a que não tem nenhuma regra apontando.
    const t9aTeeId = t9a.body?.id;
    const t16 = await api('DELETE', `/courses/${state.courseAId}/tees/${t9aTeeId}`, admin1, null, originClub1);
    check('T16 DELETE tee SEM regras → 200 + cascaded_rules_count=0',
      t16.status === 200 && t16.body?.deleted === true && t16.body?.cascaded_rules_count === 0,
      `status=${t16.status} body=${JSON.stringify(t16.body)}`);

  } finally {
    await cleanup();
    console.log('Cleanup: dados de teste removidos.');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  cleanup().catch(() => {}).finally(() => process.exit(1));
});
