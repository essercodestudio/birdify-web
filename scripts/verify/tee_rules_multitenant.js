// Verificação runtime: isolamento multi-tenant do endpoint
// PUT/GET /api/courses/:id/tee-rules (Bloco 2 da feature "faixa de tee").
//
// Cenários:
//   T1 (control): Admin do clube 1 → PUT no curso do clube 1 → 200
//   T2 (isolation): Admin do clube 1 → PUT no curso do clube 2 → 404
//   T3 (control): Admin do clube 2 → PUT no curso do clube 2 → 200
//   T4 (isolation reverse): Admin do clube 2 → PUT no curso do clube 1 → 404
//   T5 (auth): Player (não-admin) do clube 1 → PUT no curso do clube 1 → 403
//   T6 (GET isolation): Admin do clube 1 → GET tee-rules do curso do clube 2 → 404
//
// Como o middleware "Detetive de Domínios" resolve req.club pelo hostname
// (com Origin sobrescrevendo), o admin do clube 2 sinaliza tenant via
// `Origin: http://verify-tenant2.local`. Um clube com esse domain é criado
// no setup e removido no cleanup.
//
// Pré-requisitos:
//   - Backend rodando em http://localhost:3001 (VERIFY_BACKEND pra override)
//   - Migration 2026_08_21_course_tee_rules.sql aplicada
//
// Como rodar:  cd scripts/verify && node tee_rules_multitenant.js
// Sai 0 se todos os cenários passam, 1 se qualquer um falha.

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

const CLUB1_ID = 1;                          // fallback "Birdify Padrão"
const CLUB2_DOMAIN = 'verify-tenant2.local'; // criamos e removemos
const ADMIN1_EMAIL = 'verify.tee.admin1@test.local';
const ADMIN2_EMAIL = 'verify.tee.admin2@test.local';
const PLAYER1_EMAIL = 'verify.tee.player1@test.local';
const PASSWORD = 'birdify123';

const state = {
  club2Id: null,
  courseAId: null, // clube 1
  courseBId: null, // clube 2
  admin1UserId: null,
  admin2UserId: null,
  player1UserId: null,
};

async function withConn(fn) {
  const c = await mysql.createConnection(DB_CFG);
  try { return await fn(c); } finally { await c.end(); }
}

async function setup() {
  await withConn(async (c) => {
    // Clube 2 novo
    const [ins] = await c.execute(
      `INSERT INTO clubs (name, domain, primary_color) VALUES (?, ?, '#22c55e')`,
      ['Verify Tenant 2', CLUB2_DOMAIN],
    );
    state.club2Id = ins.insertId;

    // Curso A no clube 1, Curso B no clube 2
    const [cA] = await c.execute(
      `INSERT INTO courses (club_id, name, city, state) VALUES (?, 'Verify Course A', 'Cidade', 'SP')`,
      [CLUB1_ID],
    );
    state.courseAId = cA.insertId;
    const [cB] = await c.execute(
      `INSERT INTO courses (club_id, name, city, state) VALUES (?, 'Verify Course B', 'Cidade', 'SP')`,
      [state.club2Id],
    );
    state.courseBId = cB.insertId;

    // Usuários (idempotente)
    const hash = await bcrypt.hash(PASSWORD, 10);
    const users = [
      ['Verify Tee Admin1',  ADMIN1_EMAIL,  'ADMIN'],
      ['Verify Tee Admin2',  ADMIN2_EMAIL,  'ADMIN'],
      ['Verify Tee Player1', PLAYER1_EMAIL, 'PLAYER'],
    ];
    for (const [name, email, role] of users) {
      await c.execute(
        `INSERT INTO users (name, email, password_hash, gender, role)
         VALUES (?, ?, ?, 'M', ?)
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name)`,
        [name, email, hash, role],
      );
    }
    const [[a1]] = await c.execute(`SELECT id FROM users WHERE email=?`, [ADMIN1_EMAIL]);
    const [[a2]] = await c.execute(`SELECT id FROM users WHERE email=?`, [ADMIN2_EMAIL]);
    const [[p1]] = await c.execute(`SELECT id FROM users WHERE email=?`, [PLAYER1_EMAIL]);
    state.admin1UserId = a1.id;
    state.admin2UserId = a2.id;
    state.player1UserId = p1.id;

    // Vínculos club_admins
    await c.execute(`INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`, [state.admin1UserId, CLUB1_ID]);
    await c.execute(`INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`, [state.admin2UserId, state.club2Id]);

    // Auto-seed manual dos 4 tees padrão nos dois cursos (o createCourse do
    // controller faria isso automaticamente, mas aqui inserimos courses via
    // SQL direto pra evitar dependência de HTTP/auth durante o setup).
    for (const cid of [state.courseAId, state.courseBId]) {
      await c.execute(
        `INSERT INTO course_tees (course_id, tee_name, color_hex, display_order) VALUES
         (?, 'Branco',   '#ffffff', 0),
         (?, 'Amarelo',  '#eab308', 1),
         (?, 'Azul',     '#0077b6', 2),
         (?, 'Vermelho', '#dc2626', 3)`,
        [cid, cid, cid, cid],
      );
    }
  });
}

async function cleanup() {
  await withConn(async (c) => {
    // FKs: course_tee_rules e club_admins caem em CASCADE ao remover course/club.
    if (state.courseAId) await c.execute(`DELETE FROM courses WHERE id=?`, [state.courseAId]);
    if (state.courseBId) await c.execute(`DELETE FROM courses WHERE id=?`, [state.courseBId]);
    if (state.club2Id)   await c.execute(`DELETE FROM clubs   WHERE id=?`, [state.club2Id]);
    for (const email of [ADMIN1_EMAIL, ADMIN2_EMAIL, PLAYER1_EMAIL]) {
      await c.execute(`DELETE FROM users WHERE email=?`, [email]);
    }
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

async function api(method, path, token, body, origin) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// Depois do Bloco B, as regras referenciam course_tees.id (não mais tee_color ENUM).
// Cada course tem os 4 tees padrão seedados pela migration; buscamos os IDs no runtime.
async function sampleRulesFor(courseId) {
  const c = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await c.execute(
      `SELECT id, tee_name FROM course_tees WHERE course_id = ? AND tee_name IN ('Branco','Amarelo') ORDER BY display_order`,
      [courseId],
    );
    const branco = rows.find(r => r.tee_name === 'Branco');
    const amarelo = rows.find(r => r.tee_name === 'Amarelo');
    if (!branco || !amarelo) throw new Error(`Tees padrão não encontrados no course ${courseId} — auto-seed do createCourse falhou?`);
    return { rules: [
      { gender: 'M', tee_id: branco.id,  handicap_min: 0,   handicap_max: 8.5 },
      { gender: 'M', tee_id: amarelo.id, handicap_min: 8.6, handicap_max: 18.0 },
    ]};
  } finally { await c.end(); }
}

async function main() {
  console.log(`Backend: ${BACKEND}`);
  await setup();
  console.log(`Setup: club2=${state.club2Id}, courseA=${state.courseAId}, courseB=${state.courseBId}`);

  try {
    // Origin 'http://localhost' → clube 1 (fallback)
    // Origin `http://${CLUB2_DOMAIN}` → clube 2
    const originClub1 = 'http://localhost';
    const originClub2 = `http://${CLUB2_DOMAIN}`;

    const admin1 = await loginToken(ADMIN1_EMAIL, originClub1);
    const admin2 = await loginToken(ADMIN2_EMAIL, originClub2);
    const player1 = await loginToken(PLAYER1_EMAIL, originClub1);

    // Payloads dinâmicos: tee_id de cada regra vem do próprio course.
    const rulesA = await sampleRulesFor(state.courseAId);
    const rulesB = await sampleRulesFor(state.courseBId);

    // T1 — control: admin1 no curso A (próprio)
    const t1 = await api('PUT', `/courses/${state.courseAId}/tee-rules`, admin1, rulesA, originClub1);
    check('T1 admin1 → PUT curso próprio (A) → 200', t1.status === 200, `got ${t1.status}`);

    // T2 — isolation: admin1 tentando curso B (do clube 2)
    const t2 = await api('PUT', `/courses/${state.courseBId}/tee-rules`, admin1, rulesB, originClub1);
    check('T2 admin1 → PUT curso alheio (B do clube 2) → 404', t2.status === 404, `got ${t2.status} body=${JSON.stringify(t2.body)}`);

    // T3 — control: admin2 no curso B (próprio)
    const t3 = await api('PUT', `/courses/${state.courseBId}/tee-rules`, admin2, rulesB, originClub2);
    check('T3 admin2 → PUT curso próprio (B) → 200', t3.status === 200, `got ${t3.status}`);

    // T4 — isolation reverse: admin2 tentando curso A (do clube 1)
    const t4 = await api('PUT', `/courses/${state.courseAId}/tee-rules`, admin2, rulesA, originClub2);
    check('T4 admin2 → PUT curso alheio (A do clube 1) → 404', t4.status === 404, `got ${t4.status} body=${JSON.stringify(t4.body)}`);

    // T5 — auth: player1 (não-admin) tentando qualquer PUT
    const t5 = await api('PUT', `/courses/${state.courseAId}/tee-rules`, player1, rulesA, originClub1);
    check('T5 player1 (não-admin) → PUT → 403', t5.status === 403, `got ${t5.status} body=${JSON.stringify(t5.body)}`);

    // T6 — GET isolation
    const t6 = await api('GET', `/courses/${state.courseBId}/tee-rules`, admin1, null, originClub1);
    check('T6 admin1 → GET tee-rules do curso alheio (B) → 404', t6.status === 404, `got ${t6.status} body=${JSON.stringify(t6.body)}`);

    // Sanity extra: admin1 lendo curso próprio depois do PUT →
    // regras batem + JOIN devolve tee_name/color_hex dos course_tees.
    const sanity = await api('GET', `/courses/${state.courseAId}/tee-rules`, admin1, null, originClub1);
    const rules = Array.isArray(sanity.body?.rules) ? sanity.body.rules : [];
    const hasBranco  = rules.some(r => r.tee_name === 'Branco'  && r.color_hex === '#ffffff');
    const hasAmarelo = rules.some(r => r.tee_name === 'Amarelo' && r.color_hex === '#eab308');
    check(
      'Sanity admin1 GET curso próprio (A) → 200 com 2 regras e JOIN em course_tees (tee_name/color_hex)',
      sanity.status === 200 && rules.length === 2 && hasBranco && hasAmarelo,
      `status=${sanity.status} rules=${rules.length} branco=${hasBranco} amarelo=${hasAmarelo}`,
    );
  } finally {
    await cleanup();
    console.log('Cleanup: dados de teste removidos.');
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passaram.`);
  if (failed.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('ERRO FATAL:', err);
  cleanup().catch(() => {}).finally(() => process.exit(1));
});
