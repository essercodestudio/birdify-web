// Verificacao runtime do fluxo INLINE de duplas no TournamentManager.
//
// Onda B · Commit 3.15: substitui AdminDuplasManager. Admin cria dupla e escala
// no grupo em 1 clique via POST /tournament-duplas + POST /groups/add-dupla.
// Testa:
//   - Grupo manual vazio + POST /groups/add-dupla funciona
//   - Duplicata na mesma rodada rejeita
//   - Dupla de outro torneio rejeita
//   - DELETE /groups/remove-dupla apaga scores da rodada
//   - GET /groups/list retorna groups[].duplas com nome dos jogadores
//
// Como rodar (backend em 3001):
//   cd scripts/verify && node verify-doubles-inline-flow.js

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const jwt = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'jsonwebtoken'));

const API = { host: 'localhost', port: 3001 };
const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};

let failures = 0;
const fail = (m) => { failures++; console.log('X', m); };
const pass = (m) => console.log('OK', m);

function req(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: API.host, port: API.port, path: urlPath, method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'localhost',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks || '{}'); } catch { parsed = chunks; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function ensureUser(conn, email, name, gender, role) {
  const hash = await bcrypt.hash('verify123', 10);
  const [ex] = await conn.execute('SELECT id FROM users WHERE email = ?', [email]);
  let id;
  if (ex.length) {
    id = ex[0].id;
    await conn.execute('UPDATE users SET password_hash=?, role=?, name=?, gender=? WHERE id=?', [hash, role, name, gender, id]);
  } else {
    const [r] = await conn.execute(
      'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?, ?, ?, ?, ?)',
      [name, email, hash, role, gender]
    );
    id = r.insertId;
  }
  if (role === 'ADMIN') {
    await conn.execute('INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, 1)', [id]);
  }
  return id;
}

async function main() {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  let tid1 = null, tid2 = null;
  try {
    const adminId = await ensureUser(conn, 'verify.inline.admin@test.local', 'Verify Inline Admin', 'M', 'ADMIN');
    const p1 = await ensureUser(conn, 'verify.inline.p1@test.local', 'Inline P1', 'M', 'PLAYER');
    const p2 = await ensureUser(conn, 'verify.inline.p2@test.local', 'Inline P2', 'M', 'PLAYER');
    const p3 = await ensureUser(conn, 'verify.inline.p3@test.local', 'Inline P3', 'F', 'PLAYER');
    const p4 = await ensureUser(conn, 'verify.inline.p4@test.local', 'Inline P4', 'F', 'PLAYER');

    const ADMIN_TOKEN = jwt.sign({ id: adminId, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

    // Torneio 1 — doubles, onde vamos exercitar o fluxo inline
    const cr1 = await req('POST', '/api/tournaments/create', ADMIN_TOKEN, {
      name: `Verify Inline T1 ${Date.now().toString(36)}`,
      start_date: start, course_id: course.id, format: 'shotgun',
      modality: 'doubles', scoring_type: 'strokes', categories: [],
    });
    if (cr1.status !== 200 || !cr1.body.id) { fail(`create T1: ${cr1.status}`); return; }
    tid1 = cr1.body.id;

    // Torneio 2 — outro doubles pra testar cross-tenant/dupla-de-outro-torneio
    const cr2 = await req('POST', '/api/tournaments/create', ADMIN_TOKEN, {
      name: `Verify Inline T2 ${Date.now().toString(36)}`,
      start_date: start, course_id: course.id, format: 'shotgun',
      modality: 'doubles', scoring_type: 'strokes', categories: [],
    });
    if (cr2.status !== 200 || !cr2.body.id) { fail(`create T2: ${cr2.status}`); return; }
    tid2 = cr2.body.id;

    for (const uid of [p1, p2, p3, p4]) {
      await conn.execute(`INSERT INTO inscriptions (tournament_id, user_id, status) VALUES (?, ?, 'APPROVED')`, [tid1, uid]);
    }
    // Cria grupo manual vazio na R1 do torneio 1
    const g1 = await req('POST', '/api/groups/create', ADMIN_TOKEN, {
      tournament_id: tid1, round_number: 1, group_name: 'Flight Inline 1', starting_hole: 1,
    });
    if (g1.status !== 201 || !g1.body.groupId) { fail(`create group manual: ${g1.status} ${JSON.stringify(g1.body)}`); return; }
    const groupId = g1.body.groupId;
    pass('grupo manual criado vazio (Flight Inline 1)');

    // Segundo grupo na mesma rodada — pra testar "dupla ja em outro flight da rodada"
    const g2 = await req('POST', '/api/groups/create', ADMIN_TOKEN, {
      tournament_id: tid1, round_number: 1, group_name: 'Flight Inline 2', starting_hole: 2,
    });
    if (g2.status !== 201) { fail(`create group 2: ${g2.status}`); return; }
    const groupId2 = g2.body.groupId;

    // Cria dupla via POST /tournament-duplas (fluxo inline: front chama isso)
    const d1 = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: tid1, dupla_name: 'Inline P1 & Inline P2', player_ids: [p1, p2],
    });
    if (d1.status !== 200 || !d1.body.id) { fail(`create dupla1: ${d1.status} ${JSON.stringify(d1.body)}`); return; }
    const duplaA = d1.body.id;
    pass('POST /tournament-duplas criou dupla');

    // Escala dupla no grupo — endpoint NOVO
    const add1 = await req('POST', '/api/groups/add-dupla', ADMIN_TOKEN, {
      group_id: groupId, dupla_id: duplaA,
    });
    if (add1.status !== 200) fail(`POST /groups/add-dupla success: ${add1.status} ${JSON.stringify(add1.body)}`);
    else pass('POST /groups/add-dupla vinculou dupla ao grupo');

    // Duplicata: tentar adicionar mesma dupla em OUTRO grupo da mesma rodada
    const dup = await req('POST', '/api/groups/add-dupla', ADMIN_TOKEN, {
      group_id: groupId2, dupla_id: duplaA,
    });
    if (dup.status === 400 && String(dup.body.message).toLowerCase().includes('outro flight')) {
      pass('POST /groups/add-dupla rejeita dupla ja em outro flight da mesma rodada (400)');
    } else {
      fail(`duplicata rodada nao rejeitada: ${dup.status} ${JSON.stringify(dup.body)}`);
    }

    // Dupla de OUTRO torneio -> deve rejeitar
    // Cria dupla no torneio 2
    const dExt = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: tid2, dupla_name: 'Externa', player_ids: [p3, p4],
    });
    if (dExt.status !== 200) fail(`create dupla externa: ${dExt.status}`);
    const duplaExterna = dExt.body.id;
    const cross = await req('POST', '/api/groups/add-dupla', ADMIN_TOKEN, {
      group_id: groupId, dupla_id: duplaExterna,
    });
    if (cross.status === 400 && String(cross.body.message).toLowerCase().includes('este torneio')) {
      pass('POST /groups/add-dupla rejeita dupla de outro torneio (400)');
    } else {
      fail(`cross-tournament nao rejeitado: ${cross.status} ${JSON.stringify(cross.body)}`);
    }

    // Grupo NAO doubles -> deve rejeitar (mas T2 e doubles, entao aqui skippamos esse check)

    // GET /groups/list retorna duplas com nomes dos jogadores
    const gl = await req('GET', `/api/groups/list/${tid1}?round=1`, ADMIN_TOKEN);
    if (gl.status !== 200 || !Array.isArray(gl.body)) { fail(`groups/list: ${gl.status}`); return; }
    const grp = gl.body.find(g => g.id === groupId);
    if (!grp) fail('grupo inline nao encontrado no list');
    else if (!Array.isArray(grp.duplas) || grp.duplas.length !== 1) fail(`duplas esperado 1, veio ${JSON.stringify(grp.duplas)}`);
    else if (!grp.duplas[0].players || grp.duplas[0].players.length !== 2) fail('players dentro da dupla ausentes');
    else pass('GET /groups/list retorna dupla com 2 players dentro');

    // Insere score direto pra dupla e depois testa DELETE remove-dupla apagar
    await conn.execute(
      `INSERT INTO scores (tournament_id, user_id, dupla_id, entity_ref, hole_number, round_number, strokes)
       VALUES (?, NULL, ?, ?, 1, 1, 5)`,
      [tid1, duplaA, -duplaA]
    );
    const del = await req('DELETE', `/api/groups/remove-dupla/${groupId}/${duplaA}`, ADMIN_TOKEN);
    if (del.status !== 200) fail(`DELETE remove-dupla: ${del.status} ${JSON.stringify(del.body)}`);
    else pass('DELETE /groups/remove-dupla OK');

    const [scoreLeft] = await conn.execute(
      `SELECT COUNT(*) AS n FROM scores WHERE tournament_id = ? AND dupla_id = ? AND round_number = 1`,
      [tid1, duplaA]
    );
    if (Number(scoreLeft[0].n) !== 0) fail(`scores da rodada NAO apagados apos remove-dupla (${scoreLeft[0].n} restantes)`);
    else pass('DELETE remove-dupla apagou scores da rodada da dupla removida');

    const [gdLeft] = await conn.execute(
      `SELECT COUNT(*) AS n FROM group_duplas WHERE group_id = ? AND dupla_id = ?`,
      [groupId, duplaA]
    );
    if (Number(gdLeft[0].n) !== 0) fail('group_duplas ainda contem a dupla removida');
    else pass('group_duplas limpo apos remove-dupla');

    console.log('\n== RESULTADO ==');
    console.log(failures === 0 ? 'OK PASS (todos os checks)' : `FAIL (${failures} falhas)`);
  } finally {
    for (const tid of [tid1, tid2].filter(Boolean)) {
      await conn.execute('DELETE FROM scores WHERE tournament_id = ?', [tid]);
      await conn.execute('DELETE FROM group_duplas WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id = ?)', [tid]);
      await conn.execute('DELETE FROM tournament_groups WHERE tournament_id = ?', [tid]);
      await conn.execute('DELETE FROM tournament_dupla_players WHERE dupla_id IN (SELECT id FROM tournament_duplas WHERE tournament_id = ?)', [tid]);
      await conn.execute('DELETE FROM tournament_duplas WHERE tournament_id = ?', [tid]);
      await conn.execute('DELETE FROM inscriptions WHERE tournament_id = ?', [tid]);
      await conn.execute('DELETE FROM tournaments WHERE id = ?', [tid]);
    }
    await conn.end();
    process.exit(failures === 0 ? 0 : 1);
  }
}

main().catch(e => { console.error(e); process.exit(2); });
