// Verificação runtime end-to-end do fluxo do chip de sugestão de tee (Bloco 4).
//
// O componente <TeeSuggestionChip> é uma função pura de (handicap, gender, rules)
// → status ∈ {match, out_of_range, no_rules}, delegando ao util `suggestTee`.
// Este script prova as duas coisas que realmente precisam de runtime:
//
//   (a) o backend entrega os dados corretos ao lobby:
//       - POST /groups/join do torneio devolve course_id (necessário pro GET rules)
//       - GET /courses/:course_id/tee-rules devolve as regras cadastradas
//       - Campo sem regra devolve rules:[] (comportamento "no_rules")
//
//   (b) o util suggestTee, alimentado com esses dados reais, retorna o status
//       esperado pros 3 cenários aprovados no Bloco 4:
//           handicap dentro de faixa  → 'match'
//           handicap fora de todas    → 'out_of_range'
//           campo sem regra           → 'no_rules'
//
// Como rodar:  cd scripts/verify && node tee_suggestion_flow.js

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const mysql = require('mysql2/promise');

const { suggestTee } = require('../../frontend/src/utils/teeSuggestion');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const CLUB1_ID = 1;
const ADMIN_EMAIL = 'verify.teeflow.admin@test.local';
const PLAYER_EMAIL = 'verify.teeflow.player@test.local';
const PASSWORD = 'birdify123';
const ORIGIN = 'http://localhost:3000'; // origem que já passa no CORS

const state = { courseWithRulesId: null, courseNoRulesId: null, tournamentId: null, groupId: null, playerUserId: null, adminUserId: null };

async function withConn(fn) {
  const c = await mysql.createConnection(DB_CFG);
  try { return await fn(c); } finally { await c.end(); }
}

async function setup() {
  await withConn(async (c) => {
    // Curso 1: com regras. Curso 2: sem regras (cenário "no_rules").
    const [c1] = await c.execute(
      `INSERT INTO courses (club_id, name, city, state) VALUES (?, 'Verify Flow Course COM regra', 'SP', 'SP')`, [CLUB1_ID]);
    const [c2] = await c.execute(
      `INSERT INTO courses (club_id, name, city, state) VALUES (?, 'Verify Flow Course SEM regra', 'SP', 'SP')`, [CLUB1_ID]);
    state.courseWithRulesId = c1.insertId;
    state.courseNoRulesId = c2.insertId;

    // Auto-seed dos 4 tees padrão em AMBOS os cursos (o createCourse do
    // controller faria isso automaticamente; aqui inserimos via SQL direto).
    for (const cid of [state.courseWithRulesId, state.courseNoRulesId]) {
      await c.execute(
        `INSERT INTO course_tees (course_id, tee_name, color_hex, display_order) VALUES
         (?, 'Branco',   '#ffffff', 0),
         (?, 'Amarelo',  '#eab308', 1),
         (?, 'Azul',     '#0077b6', 2),
         (?, 'Vermelho', '#dc2626', 3)`,
        [cid, cid, cid, cid],
      );
    }

    // Regras APENAS no primeiro curso: M 0-8.5 Branco, M 8.6-18 Amarelo.
    // Referenciam course_tees.id (não mais ENUM). Player M com HC 5 → match=Branco;
    // HC 30 → out_of_range; curso sem regra → no_rules.
    const [[branco]]  = await c.execute(
      `SELECT id FROM course_tees WHERE course_id=? AND tee_name='Branco'`,
      [state.courseWithRulesId],
    );
    const [[amarelo]] = await c.execute(
      `SELECT id FROM course_tees WHERE course_id=? AND tee_name='Amarelo'`,
      [state.courseWithRulesId],
    );
    state.teeBrancoId  = branco.id;
    state.teeAmareloId = amarelo.id;
    await c.execute(
      `INSERT INTO course_tee_rules (course_id, gender, tee_color, tee_id, handicap_min, handicap_max, display_order) VALUES
       (?, 'M', 'white',  ?, 0.0, 8.5, 0),
       (?, 'M', 'yellow', ?, 8.6, 18.0, 1)`,
      [state.courseWithRulesId, branco.id, state.courseWithRulesId, amarelo.id],
    );

    // Usuários
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const [name, email, role, gender] of [
      ['Verify Flow Admin',  ADMIN_EMAIL,  'ADMIN',  'M'],
      ['Verify Flow Player', PLAYER_EMAIL, 'PLAYER', 'M'],
    ]) {
      await c.execute(
        `INSERT INTO users (name, email, password_hash, gender, role)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name), gender=VALUES(gender)`,
        [name, email, hash, gender, role],
      );
    }
    const [[adm]] = await c.execute(`SELECT id FROM users WHERE email=?`, [ADMIN_EMAIL]);
    const [[ply]] = await c.execute(`SELECT id FROM users WHERE email=?`, [PLAYER_EMAIL]);
    state.adminUserId = adm.id;
    state.playerUserId = ply.id;
    await c.execute(`INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`, [state.adminUserId, CLUB1_ID]);

    // Torneio + grupo no curso COM regras (fluxo JoinGame)
    const [t] = await c.execute(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, status, format)
       VALUES (?, 'Verify Flow Tournament', CURDATE(), ?, 'OPEN', 'shotgun')`,
      [CLUB1_ID, state.courseWithRulesId],
    );
    state.tournamentId = t.insertId;
    const accessCode = 'V' + Math.random().toString(36).slice(2, 5).toUpperCase();
    const [g] = await c.execute(
      `INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole)
       VALUES (?, 'Verify Group', ?, 1)`,
      [state.tournamentId, accessCode],
    );
    state.groupId = g.insertId;
    state.accessCode = accessCode;
    await c.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, NULL)`,
      [state.groupId, state.playerUserId],
    );
  });
}

async function cleanup() {
  await withConn(async (c) => {
    if (state.tournamentId) await c.execute(`DELETE FROM tournaments WHERE id=?`, [state.tournamentId]);
    if (state.courseWithRulesId) await c.execute(`DELETE FROM courses WHERE id=?`, [state.courseWithRulesId]);
    if (state.courseNoRulesId) await c.execute(`DELETE FROM courses WHERE id=?`, [state.courseNoRulesId]);
    for (const email of [ADMIN_EMAIL, PLAYER_EMAIL]) {
      await c.execute(`DELETE FROM users WHERE email=?`, [email]);
    }
  });
}

async function loginToken(email) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Login ${email}: ${JSON.stringify(j)}`);
  return j.token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  console.log(`Setup: courseWithRules=${state.courseWithRulesId}, courseNoRules=${state.courseNoRulesId}, tournament=${state.tournamentId}, group=${state.groupId} (code=${state.accessCode})`);

  try {
    const playerToken = await loginToken(PLAYER_EMAIL);

    // ─── (a) Backend entrega dados corretos ao lobby ─────────────────
    // A1: joinGroup responde com course_id (mudança do groupController)
    const joinRes = await api('POST', `/groups/join`, playerToken, { access_code: state.accessCode });
    const groupCourseId = joinRes.body?.group?.course_id;
    check(
      'A1 POST /groups/join devolve course_id do torneio',
      joinRes.status === 200 && groupCourseId === state.courseWithRulesId,
      `status=${joinRes.status} course_id=${groupCourseId} esperado=${state.courseWithRulesId}`,
    );

    // A2: GET tee-rules do curso COM regra devolve exatamente as 2 regras cadastradas
    const rulesResWith = await api('GET', `/courses/${state.courseWithRulesId}/tee-rules`, playerToken);
    const rulesWith = rulesResWith.body?.rules;
    check(
      'A2 GET tee-rules do curso COM regra devolve 2 regras (white 0-8.5, yellow 8.6-18)',
      rulesResWith.status === 200
        && Array.isArray(rulesWith) && rulesWith.length === 2
        && rulesWith.some(r => r.tee_color === 'white'  && Number(r.handicap_min) === 0.0 && Number(r.handicap_max) === 8.5)
        && rulesWith.some(r => r.tee_color === 'yellow' && Number(r.handicap_min) === 8.6 && Number(r.handicap_max) === 18.0),
      `status=${rulesResWith.status} len=${rulesWith?.length}`,
    );

    // A2b (Bloco B): JOIN em course_tees traz tee_id/tee_name/color_hex junto de cada regra
    check(
      'A2b GET tee-rules devolve JOIN com course_tees (tee_id + tee_name + color_hex por regra)',
      Array.isArray(rulesWith) && rulesWith.length === 2
        && rulesWith.every(r => Number.isInteger(r.tee_id) && r.tee_id > 0)
        && rulesWith.some(r => r.tee_name === 'Branco'  && r.color_hex === '#ffffff')
        && rulesWith.some(r => r.tee_name === 'Amarelo' && r.color_hex === '#eab308'),
      JSON.stringify(rulesWith?.map(r => ({ n: r.tee_name, c: r.color_hex, id: r.tee_id }))),
    );

    // A3: GET tee-rules do curso SEM regra devolve rules:[]
    const rulesResNo = await api('GET', `/courses/${state.courseNoRulesId}/tee-rules`, playerToken);
    check(
      'A3 GET tee-rules do curso SEM regra devolve rules:[]',
      rulesResNo.status === 200 && Array.isArray(rulesResNo.body?.rules) && rulesResNo.body.rules.length === 0,
      `status=${rulesResNo.status} len=${rulesResNo.body?.rules?.length}`,
    );

    // ─── (b) Util suggestTee, alimentado com dados reais, decide certo ─
    const rulesReal = rulesResWith.body.rules;

    // B1: handicap dentro (5.0, M) → 'match' com tee Branco (color_hex real do banco)
    const b1 = suggestTee(5.0, 'M', rulesReal);
    check(
      "B1 Chip TORNEIO: HC 5.0 M com regras reais → status 'match' tee_name=Branco color_hex=#ffffff",
      b1.status === 'match' && b1.tee_name === 'Branco' && b1.color_hex === '#ffffff',
      JSON.stringify(b1),
    );

    // B2: handicap fora (30.0, M) → 'out_of_range' (nem Branco 0-8.5 nem Amarelo 8.6-18 cobrem)
    const b2 = suggestTee(30.0, 'M', rulesReal);
    check(
      "B2 Chip TORNEIO: HC 30.0 M fora das faixas → status 'out_of_range'",
      b2.status === 'out_of_range',
      JSON.stringify(b2),
    );

    // B3: mesmo player alimentado com rules:[] (campo sem regra) → 'no_rules' (chip não aparece)
    const b3 = suggestTee(5.0, 'M', rulesResNo.body.rules);
    check(
      "B3 Chip TREINO/TORNEIO: campo sem regra → status 'no_rules' (chip omitido)",
      b3.status === 'no_rules',
      JSON.stringify(b3),
    );

    // B4: normalização de gender ('Masculino' extenso, como vem de alguns registros)
    const b4 = suggestTee(5.0, 'Masculino', rulesReal);
    check(
      "B4 Chip: gender 'Masculino' (extenso) é normalizado pra 'M' → 'match' Branco",
      b4.status === 'match' && b4.tee_name === 'Branco',
      JSON.stringify(b4),
    );

    // B5: boundary — HC 8.5 (limite superior do Branco) e HC 8.6 (limite inferior do Amarelo)
    const b5a = suggestTee(8.5, 'M', rulesReal);
    const b5b = suggestTee(8.6, 'M', rulesReal);
    check(
      'B5 Boundaries inclusivos: HC 8.5 → Branco; HC 8.6 → Amarelo (sem overlap nem gap na fronteira)',
      b5a.status === 'match' && b5a.tee_name === 'Branco'
        && b5b.status === 'match' && b5b.tee_name === 'Amarelo',
      `8.5=${b5a.tee_name} 8.6=${b5b.tee_name}`,
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
