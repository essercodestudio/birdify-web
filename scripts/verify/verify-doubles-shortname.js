// Verificacao runtime do formato compacto do nome da dupla.
//
// Onda B · Commit 3.16: nome exibido em todo lugar passa a ser
// "J. Silva / P. Santos" (util formatDuplaName). Backend recompoe no
// leaderboardController, exportController e adminScoreController; frontend
// tem o mesmo util. groupsController ja devolve players dentro de duplas
// (o frontend formata).
//
// Testa:
//   - GET /leaderboard/:tid retorna dupla_name compacto + players[]
//   - GET /admin/scores/tournament/:tid retorna groups[].players[].name compacto
//   - GET /groups/list/:tid retorna groups[].duplas[].players com nomes crus
//
// Como rodar (backend em 3001):
//   cd scripts/verify && node verify-doubles-shortname.js

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const jwt = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'jsonwebtoken'));
const { formatDuplaName, formatPlayerShort } = require(path.join(__dirname, '..', '..', 'backend', 'utils', 'duplaName'));

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
  // Util behavior sanity checks (unitario embutido, sem HTTP)
  const cases = [
    [['Joao Silva', 'Pedro Santos'], 'J. Silva / P. Santos'],
    [['Madonna', 'Prince'], 'Madonna / Prince'],       // 1 palavra so → fallback
    [['Ana Maria Souza', 'Bento Alencar'], 'A. Souza / B. Alencar'],
    [['  Carlos  ', 'Diego Neto'], 'Carlos / D. Neto'],
    [[null, 'Pedro Santos'], 'P. Santos'],
    [['', ''], ''],
  ];
  for (const [[a, b], expected] of cases) {
    const got = formatDuplaName(a, b);
    if (got === expected) pass(`formatDuplaName(${JSON.stringify(a)}, ${JSON.stringify(b)}) = "${got}"`);
    else fail(`formatDuplaName(${JSON.stringify(a)}, ${JSON.stringify(b)}) esperado "${expected}", veio "${got}"`);
  }

  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  let tid = null;
  try {
    const adminId = await ensureUser(conn, 'verify.short.admin@test.local', 'Verify Short Admin', 'M', 'ADMIN');
    const p1 = await ensureUser(conn, 'verify.short.p1@test.local', 'Joao Silva', 'M', 'PLAYER');
    const p2 = await ensureUser(conn, 'verify.short.p2@test.local', 'Pedro Santos', 'M', 'PLAYER');
    const p3 = await ensureUser(conn, 'verify.short.p3@test.local', 'Ana Maria Souza', 'F', 'PLAYER');
    const p4 = await ensureUser(conn, 'verify.short.p4@test.local', 'Bento Alencar', 'M', 'PLAYER');

    const ADMIN_TOKEN = jwt.sign({ id: adminId, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const cr = await req('POST', '/api/tournaments/create', ADMIN_TOKEN, {
      name: `Verify Short ${Date.now().toString(36)}`,
      start_date: start, course_id: course.id, format: 'shotgun',
      modality: 'doubles', scoring_type: 'strokes', categories: [],
    });
    if (cr.status !== 200) { fail(`create tournament: ${cr.status}`); return; }
    tid = cr.body.id;
    for (const uid of [p1, p2, p3, p4]) {
      await conn.execute(`INSERT INTO inscriptions (tournament_id, user_id, status) VALUES (?, ?, 'APPROVED')`, [tid, uid]);
    }

    // Cria 2 duplas com dupla_name LIVRE "Time Verde" e "Time Azul" pra provar
    // que backend reformata pro compacto no response, ignorando o livre.
    const d1 = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: tid, dupla_name: 'Time Verde', player_ids: [p1, p2],
    });
    const dupla1 = d1.body.id;
    const d2 = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: tid, dupla_name: 'Time Azul', player_ids: [p3, p4],
    });
    const dupla2 = d2.body.id;

    await req('POST', '/api/groups/auto-generate', ADMIN_TOKEN, { tournament_id: tid, round_number: 1 });

    // 1. Leaderboard reformata dupla_name pro compacto
    const lb = await req('GET', `/api/leaderboard/${tid}`, ADMIN_TOKEN);
    if (lb.status !== 200 || !Array.isArray(lb.body)) { fail(`leaderboard status ${lb.status}`); return; }
    const rowA = lb.body.find(r => Number(r.dupla_id) === dupla1);
    if (!rowA) fail('DupA nao apareceu no leaderboard');
    else {
      const expected = formatDuplaName('Joao Silva', 'Pedro Santos');
      if (rowA.dupla_name !== expected) fail(`leaderboard dupla_name esperado "${expected}", veio "${rowA.dupla_name}"`);
      else pass(`leaderboard dupla_name = "${expected}" (ignora "Time Verde" livre)`);
      if (!Array.isArray(rowA.players) || rowA.players.length !== 2) fail(`leaderboard players array com length errado: ${JSON.stringify(rowA.players)}`);
      else pass('leaderboard entrega players[] com 2 nomes crus');
    }

    // 2. AdminScoreEditor matriz devolve name compacto
    const mat = await req('GET', `/api/admin/scores/tournament/${tid}`, ADMIN_TOKEN);
    if (mat.status !== 200) { fail(`admin matrix status ${mat.status}`); return; }
    const allPlayers = (mat.body.groups || []).flatMap(g => g.players || []);
    const matDupA = allPlayers.find(p => Number(p.id) === dupla1);
    if (!matDupA) fail('DupA nao encontrada na matriz admin');
    else if (matDupA.name !== formatDuplaName('Joao Silva', 'Pedro Santos')) {
      fail(`admin matrix name esperado "${formatDuplaName('Joao Silva','Pedro Santos')}", veio "${matDupA.name}"`);
    } else {
      pass(`admin matrix name compacto = "${matDupA.name}"`);
    }
    if (!matDupA?.players || matDupA.players.length !== 2) fail('admin matrix players[] ausente');
    else pass('admin matrix entrega players[] com nomes crus');

    // 3. groups/list continua devolvendo players crus dentro de duplas
    const gl = await req('GET', `/api/groups/list/${tid}`, ADMIN_TOKEN);
    const anyDupla = (gl.body || []).flatMap(g => g.duplas || [])[0];
    if (!anyDupla) fail('groups/list sem duplas');
    else if (!Array.isArray(anyDupla.players) || anyDupla.players.length !== 2) fail('groups/list dupla sem players[]');
    else if (!anyDupla.players.every(p => p.name)) fail('groups/list players sem name');
    else pass(`groups/list dupla[0].players tem nomes crus: ${anyDupla.players.map(p => p.name).join(', ')}`);

    console.log('\n== RESULTADO ==');
    console.log(failures === 0 ? 'OK PASS (todos os checks)' : `FAIL (${failures} falhas)`);
  } finally {
    if (tid) {
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
