// Verificação runtime do painel admin de ajuste de tacadas.
// Cobre reason obrigatório, auditoria completa (insert/update/delete),
// invalidação de assinatura pós-edição, e o endpoint de histórico.
//
// Pré-requisitos:
//   - Backend rodando em http://localhost:3001 (VERIFY_BACKEND pra override)
//   - Frontend não é necessário (só REST + banco)
//   - Migration 2026_08_17_admin_score_audit.sql aplicada
//
// Como rodar:
//   cd scripts/verify && node admin_score_editor.js
//
// Sai com código 0 se todos os cenários passam, 1 se qualquer um falha.

const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const mysql = require('mysql2/promise');

const BACKEND = process.env.VERIFY_BACKEND || 'http://localhost:3001';
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const CLUB_ID = 1; // Birdify Padrão (fallback pra "localhost")
const ADMIN_EMAIL = 'verify.admin@test.local';
const CREATOR_EMAIL = 'verify.creator@test.local';
const ATHLETE2_EMAIL = 'verify.athlete2@test.local';
const PASSWORD = 'birdify123';

async function query(sql, params = []) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute(sql, params);
    return rows;
  } finally { await conn.end(); }
}

async function ensureTestUsers() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const rows = [
      ['Verify Admin',   ADMIN_EMAIL,    'ADMIN'],
      ['Verify Criador', CREATOR_EMAIL,  'PLAYER'],
      ['Verify Atleta2', ATHLETE2_EMAIL, 'PLAYER'],
    ];
    for (const [name, email, role] of rows) {
      await conn.execute(
        `INSERT INTO users (name, email, password_hash, gender, role)
         VALUES (?, ?, ?, 'M', ?)
         ON DUPLICATE KEY UPDATE
           password_hash=VALUES(password_hash),
           name=VALUES(name),
           role=VALUES(role)`,
        [name, email, hash, role],
      );
    }
    // Vincula admin ao clube 1 (requireAdmin precisa dessa linha)
    const [[adm]] = await conn.execute(`SELECT id FROM users WHERE email=?`, [ADMIN_EMAIL]);
    await conn.execute(
      `INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, ?)`,
      [adm.id, CLUB_ID]
    );
  } finally { await conn.end(); }
}

const tokenCache = new Map();
async function loginAndGetToken(email) {
  if (tokenCache.has(email)) return tokenCache.get(email);
  await ensureTestUsers();
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Login ${email}: ${JSON.stringify(j)}`);
  const cached = { token: j.token, user: j.user };
  tokenCache.set(email, cached);
  return cached;
}

async function apiCall(method, path, token, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, body: j };
}

// ─── Fixtures ─────────────────────────────────────────────────────────
let seq = 0;
async function bootstrapTournament() {
  const creator = await loginAndGetToken(CREATOR_EMAIL);
  const athlete2 = await loginAndGetToken(ATHLETE2_EMAIL);
  const code = `AE${Date.now().toString().slice(-4)}${++seq}`;
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [t] = await conn.execute(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, status, format)
       VALUES (?, ?, CURDATE(), 10, 'OPEN', 'shotgun')`,
      [CLUB_ID, `Verify AE ${code}`]
    );
    const tournamentId = t.insertId;
    const [g] = await conn.execute(
      `INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole)
       VALUES (?, ?, ?, 1)`,
      [tournamentId, `Flight ${code}`, code]
    );
    const groupId = g.insertId;
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 10)`,
      [groupId, creator.user.id]
    );
    await conn.execute(
      `INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 15)`,
      [groupId, athlete2.user.id]
    );
    return { tournamentId, groupId, code, creator, athlete2 };
  } finally { await conn.end(); }
}

async function bootstrapTraining() {
  const creator = await loginAndGetToken(CREATOR_EMAIL);
  const athlete2 = await loginAndGetToken(ATHLETE2_EMAIL);
  await query(
    `DELETE FROM training_scores WHERE group_id IN (SELECT id FROM training_groups WHERE creator_id IN (?,?))`,
    [creator.user.id, athlete2.user.id]
  );
  await query(
    `DELETE FROM training_participants WHERE group_id IN (SELECT id FROM training_groups WHERE creator_id IN (?,?))`,
    [creator.user.id, athlete2.user.id]
  );
  await query(`DELETE FROM training_groups WHERE creator_id IN (?,?)`, [creator.user.id, athlete2.user.id]);

  const created = await apiCall('POST', '/training/create', creator.token, {
    course_id: 10, starting_hole: 1,
  });
  const groupId = created.body.groupId;
  await apiCall('POST', '/training/join', athlete2.token, { access_code: created.body.access_code });
  await apiCall('POST', '/training/save-handicaps', creator.token, {
    group_id: groupId,
    players_data: [
      { user_id: creator.user.id, handicap: 10 },
      { user_id: athlete2.user.id, handicap: 15 },
    ],
  });
  await apiCall('POST', '/training/start', creator.token, { group_id: groupId });
  return { groupId, creator, athlete2 };
}

// ─── Cenários ─────────────────────────────────────────────────────────

async function reasonMissingRejected() {
  console.log('\n=== reason ausente é rejeitado com 400 ===');
  const admin = await loginAndGetToken(ADMIN_EMAIL);
  const ctx = await bootstrapTournament();
  const res = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId,
    user_id: ctx.creator.user.id,
    hole_number: 1,
    strokes: 4,
    // reason ausente
  });
  const ok = res.status === 400 && /motivo/i.test(res.body.error || '');
  console.log(`  status=${res.status} body=${JSON.stringify(res.body)}`);
  console.log(`  ${ok ? '✅' : '❌'} 400 com mensagem sobre motivo`);
  // Score NÃO deve ter sido gravado
  const rows = await query(
    `SELECT strokes FROM scores WHERE tournament_id=? AND user_id=? AND hole_number=1`,
    [ctx.tournamentId, ctx.creator.user.id]
  );
  const scoreOk = rows.length === 0;
  console.log(`  ${scoreOk ? '✅' : '❌'} score não foi gravado apesar do 400`);
  return ok && scoreOk;
}

async function reasonTooShortRejected() {
  console.log('\n=== reason curto (<5 chars) é rejeitado com 400 ===');
  const admin = await loginAndGetToken(ADMIN_EMAIL);
  const ctx = await bootstrapTournament();
  const res = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId,
    user_id: ctx.creator.user.id,
    hole_number: 1,
    strokes: 4,
    reason: 'xy',
  });
  const ok = res.status === 400;
  console.log(`  status=${res.status} body=${JSON.stringify(res.body)}`);
  console.log(`  ${ok ? '✅' : '❌'} 400`);
  return ok;
}

async function auditInsertUpdateDelete() {
  console.log('\n=== audit grava insert → update → delete corretamente ===');
  const admin = await loginAndGetToken(ADMIN_EMAIL);
  const ctx = await bootstrapTournament();
  const uid = ctx.creator.user.id;

  // INSERT
  const r1 = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId, user_id: uid, hole_number: 5, strokes: 4,
    reason: 'correção pos-jogo do buraco 5',
  });
  if (r1.status !== 200 || r1.body.action !== 'insert' || r1.body.previous_strokes !== null || r1.body.new_strokes !== 4) {
    console.log(`  ❌ insert falhou: ${JSON.stringify(r1.body)}`);
    return false;
  }
  console.log(`  ✅ insert: audit #${r1.body.audit_id} previous=null new=4`);

  // UPDATE
  const r2 = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId, user_id: uid, hole_number: 5, strokes: 5,
    reason: 'ajuste apos revisao do cartao',
  });
  if (r2.status !== 200 || r2.body.action !== 'update' || r2.body.previous_strokes !== 4 || r2.body.new_strokes !== 5) {
    console.log(`  ❌ update falhou: ${JSON.stringify(r2.body)}`);
    return false;
  }
  console.log(`  ✅ update: audit #${r2.body.audit_id} previous=4 new=5`);

  // DELETE
  const r3 = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId, user_id: uid, hole_number: 5, strokes: null,
    reason: 'buraco jogado equivocadamente',
  });
  if (r3.status !== 200 || r3.body.action !== 'delete' || r3.body.previous_strokes !== 5 || r3.body.new_strokes !== null) {
    console.log(`  ❌ delete falhou: ${JSON.stringify(r3.body)}`);
    return false;
  }
  console.log(`  ✅ delete: audit #${r3.body.audit_id} previous=5 new=null`);

  // Confere no banco
  const audits = await query(
    `SELECT action, previous_strokes, new_strokes, reason FROM admin_score_audit
      WHERE tournament_id=? AND target_user_id=? AND hole_number=5
      ORDER BY id ASC`,
    [ctx.tournamentId, uid]
  );
  if (audits.length !== 3) {
    console.log(`  ❌ esperava 3 audits, veio ${audits.length}`);
    return false;
  }
  const okSeq =
    audits[0].action === 'insert' && audits[0].previous_strokes === null && audits[0].new_strokes === 4 &&
    audits[1].action === 'update' && audits[1].previous_strokes === 4 && audits[1].new_strokes === 5 &&
    audits[2].action === 'delete' && audits[2].previous_strokes === 5 && audits[2].new_strokes === null;
  if (!okSeq) {
    console.log(`  ❌ sequência do banco divergente: ${JSON.stringify(audits)}`);
    return false;
  }
  // Score final: buraco 5 não existe mais
  const scoresFinal = await query(
    `SELECT strokes FROM scores WHERE tournament_id=? AND user_id=? AND hole_number=5`,
    [ctx.tournamentId, uid]
  );
  if (scoresFinal.length !== 0) {
    console.log(`  ❌ score não foi deletado: ${JSON.stringify(scoresFinal)}`);
    return false;
  }
  console.log('  ✅ estado final no banco consistente');
  return true;
}

async function signatureInvalidatedAfterEdit() {
  console.log('\n=== edição pós-assinatura marca invalidated_at + reason ===');
  const admin = await loginAndGetToken(ADMIN_EMAIL);
  const ctx = await bootstrapTournament();

  // Preenche 18 buracos pros dois jogadores
  const conn = await mysql.createConnection(DB_CFG);
  try {
    for (let h = 1; h <= 18; h++) {
      await conn.execute(
        `INSERT INTO scores (tournament_id, user_id, hole_number, strokes) VALUES (?, ?, ?, 4)`,
        [ctx.tournamentId, ctx.creator.user.id, h]
      );
      await conn.execute(
        `INSERT INTO scores (tournament_id, user_id, hole_number, strokes) VALUES (?, ?, ?, 5)`,
        [ctx.tournamentId, ctx.athlete2.user.id, h]
      );
    }
  } finally { await conn.end(); }

  // Creator assina o cartão
  const sig = await apiCall('POST', '/scores/sign-card', ctx.creator.token, {
    tournament_id: ctx.tournamentId, group_id: ctx.groupId,
  });
  if (sig.status !== 200) {
    console.log(`  ❌ falha ao assinar: ${JSON.stringify(sig.body)}`);
    return false;
  }
  const [sigBefore] = await query(
    `SELECT invalidated_at, invalidated_reason FROM tournament_scorecard_signatures
      WHERE tournament_id=? AND group_id=?`,
    [ctx.tournamentId, ctx.groupId]
  );
  if (sigBefore.invalidated_at !== null) {
    console.log(`  ❌ assinatura já vinha invalidada: ${JSON.stringify(sigBefore)}`);
    return false;
  }
  console.log('  ✅ assinatura criada, ativa (invalidated_at=null)');

  // Admin edita score do buraco 3 do athlete2
  const put = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId,
    user_id: ctx.athlete2.user.id,
    hole_number: 3,
    strokes: 6,
    reason: 'jogador contestou score 5 no buraco 3',
  });
  if (put.status !== 200) {
    console.log(`  ❌ PUT admin falhou: ${JSON.stringify(put.body)}`);
    return false;
  }
  if (put.body.invalidated_signatures !== 1) {
    console.log(`  ❌ esperava invalidated_signatures=1, veio ${put.body.invalidated_signatures}`);
    return false;
  }

  // Assinatura ficou invalidada com motivo
  const [sigAfter] = await query(
    `SELECT invalidated_at, invalidated_reason FROM tournament_scorecard_signatures
      WHERE tournament_id=? AND group_id=?`,
    [ctx.tournamentId, ctx.groupId]
  );
  if (!sigAfter.invalidated_at) {
    console.log(`  ❌ invalidated_at continua null: ${JSON.stringify(sigAfter)}`);
    return false;
  }
  const reasonHasContext =
    /Verify Atleta2/.test(sigAfter.invalidated_reason || '') &&
    /buraco 3/.test(sigAfter.invalidated_reason || '') &&
    /jogador contestou/.test(sigAfter.invalidated_reason || '');
  if (!reasonHasContext) {
    console.log(`  ❌ invalidated_reason sem contexto esperado: ${sigAfter.invalidated_reason}`);
    return false;
  }
  console.log(`  ✅ assinatura marcada invalidada em ${sigAfter.invalidated_at}`);
  console.log(`  ✅ invalidated_reason: "${sigAfter.invalidated_reason.slice(0, 90)}..."`);

  // Segunda edição NÃO deve criar segunda invalidação (já está invalidated)
  const put2 = await apiCall('PUT', '/admin/scores/tournament', admin.token, {
    tournament_id: ctx.tournamentId,
    user_id: ctx.athlete2.user.id,
    hole_number: 4,
    strokes: 6,
    reason: 'segundo ajuste apos primeira invalidacao',
  });
  if (put2.body.invalidated_signatures !== 0) {
    console.log(`  ❌ segunda edição invalidou de novo (${put2.body.invalidated_signatures}); esperado 0`);
    return false;
  }
  console.log('  ✅ segunda edição não reinvalida (only-if-active respeitado)');

  // getSignature devolve os novos campos
  const sigApi = await apiCall('GET', `/scores/signature/${ctx.groupId}`, ctx.creator.token);
  if (sigApi.status !== 200 || !sigApi.body.invalidated_at || !sigApi.body.invalidated_reason) {
    console.log(`  ❌ /scores/signature não devolveu invalidação: ${JSON.stringify(sigApi.body)}`);
    return false;
  }
  console.log('  ✅ GET /scores/signature devolve invalidated_at/invalidated_reason');
  return true;
}

async function trainingAudit() {
  console.log('\n=== treino: audit grava e status/finalização não interferem ===');
  const admin = await loginAndGetToken(ADMIN_EMAIL);
  const ctx = await bootstrapTraining();

  const put = await apiCall('PUT', '/admin/scores/training', admin.token, {
    group_id: ctx.groupId,
    user_id: ctx.creator.user.id,
    hole_number: 7,
    strokes: 3,
    reason: 'ajuste do treino no buraco 7',
  });
  if (put.status !== 200 || put.body.action !== 'insert' || put.body.new_strokes !== 3) {
    console.log(`  ❌ PUT training falhou: ${JSON.stringify(put.body)}`);
    return false;
  }
  const [row] = await query(
    `SELECT strokes FROM training_scores WHERE group_id=? AND user_id=? AND hole_number=7`,
    [ctx.groupId, ctx.creator.user.id]
  );
  if (!row || Number(row.strokes) !== 3) {
    console.log(`  ❌ score de treino não gravado: ${JSON.stringify(row)}`);
    return false;
  }
  const audits = await query(
    `SELECT context, action, new_strokes, reason FROM admin_score_audit
      WHERE training_group_id=? AND target_user_id=? AND hole_number=7`,
    [ctx.groupId, ctx.creator.user.id]
  );
  if (audits.length !== 1 || audits[0].context !== 'training' || audits[0].action !== 'insert') {
    console.log(`  ❌ audit de treino divergente: ${JSON.stringify(audits)}`);
    return false;
  }
  console.log('  ✅ audit de treino gravado corretamente');
  return true;
}

async function listAudit() {
  console.log('\n=== GET /admin/scores/audit lista edições do clube ===');
  const admin = await loginAndGetToken(ADMIN_EMAIL);
  const res = await apiCall('GET', '/admin/scores/audit?limit=10', admin.token);
  if (res.status !== 200 || !Array.isArray(res.body)) {
    console.log(`  ❌ resposta inesperada: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    return false;
  }
  if (res.body.length === 0) {
    console.log('  ❌ esperava audits dos cenários anteriores; lista veio vazia');
    return false;
  }
  const first = res.body[0];
  const hasFields =
    'context' in first && 'admin_name' in first && 'target_name' in first &&
    'hole_number' in first && 'previous_strokes' in first && 'new_strokes' in first &&
    'action' in first && 'reason' in first && 'created_at' in first;
  if (!hasFields) {
    console.log(`  ❌ registro sem campos esperados: ${JSON.stringify(first)}`);
    return false;
  }
  console.log(`  ✅ retornou ${res.body.length} audits com todos os campos; mais recente: ${first.admin_name} → ${first.target_name} buraco ${first.hole_number} (${first.action})`);
  return true;
}

(async () => {
  const results = {};
  try {
    results.reasonMissingRejected      = await reasonMissingRejected();
    results.reasonTooShortRejected     = await reasonTooShortRejected();
    results.auditInsertUpdateDelete    = await auditInsertUpdateDelete();
    results.signatureInvalidated       = await signatureInvalidatedAfterEdit();
    results.trainingAudit              = await trainingAudit();
    results.listAudit                  = await listAudit();
  } catch (e) {
    console.error('ERRO:', e);
    results.error = e.message;
  }
  console.log('\n=== RESULTADO ===');
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every(v => v === true) ? 0 : 1);
})();
