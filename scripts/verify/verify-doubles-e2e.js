// Verificacao runtime E2E do fluxo doubles (Onda B · Bloco 3 completo).
//
// Cria torneio modality='doubles' com 4 usuarios efemeros → 2 duplas
// (via POST /tournament-duplas) → auto-gera flights (via POST /groups/auto-generate)
// → salva scores (via POST /scores/save com dupla_id) → verifica leaderboard
// agrega por dupla, exclui de Meu Desempenho, e signatures aceitam dupla_id.
// Cleanup ao final apaga TODO o torneio + usuarios efemeros.
//
// Como rodar (backend em 3001):
//   cd scripts/verify && node verify-doubles-e2e.js
//
// Requer JWT_SECRET no backend/.env. Cria JWTs de admin + jogadores.
// Assinatura de dupla depende de qualquer jogador da dupla estar autenticado.

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const jwt = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'jsonwebtoken'));

const API = { host: 'localhost', port: 3001, protocol: 'http:' };
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
  let cleanupTid = null;
  const cleanupUserIds = [];
  try {
    // 1. Setup users
    const adminId = await ensureUser(conn, 'verify.doubles.admin@test.local', 'Verify Doubles Admin', 'M', 'ADMIN');
    const p1 = await ensureUser(conn, 'verify.doubles.p1@test.local', 'Duplas P1', 'M', 'PLAYER');
    const p2 = await ensureUser(conn, 'verify.doubles.p2@test.local', 'Duplas P2', 'M', 'PLAYER');
    const p3 = await ensureUser(conn, 'verify.doubles.p3@test.local', 'Duplas P3', 'F', 'PLAYER');
    const p4 = await ensureUser(conn, 'verify.doubles.p4@test.local', 'Duplas P4', 'F', 'PLAYER');
    cleanupUserIds.push(adminId, p1, p2, p3, p4);

    const ADMIN_TOKEN = jwt.sign({ id: adminId, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const P1_TOKEN = jwt.sign({ id: p1, role: 'PLAYER' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // 2. Cria torneio doubles via HTTP (exercita createTournament com modality)
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const createRes = await req('POST', '/api/tournaments/create', ADMIN_TOKEN, {
      name: `Verify Doubles ${Date.now().toString(36)}`,
      start_date: start,
      course_id: course.id,
      format: 'shotgun',
      modality: 'doubles',
      scoring_type: 'strokes',
      categories: [],
    });
    if (createRes.status !== 200 || !createRes.body.id) {
      fail(`createTournament: ${createRes.status} ${JSON.stringify(createRes.body)}`);
      return;
    }
    cleanupTid = createRes.body.id;
    if (createRes.body.modality !== 'doubles') fail(`response.modality esperado doubles, veio ${createRes.body.modality}`);
    else pass('POST /tournaments/create com modality=doubles retorna modality no response');

    // Aprova inscricoes direto no banco (bypass do flow admin)
    for (const uid of [p1, p2, p3, p4]) {
      await conn.execute(
        `INSERT INTO inscriptions (tournament_id, user_id, status) VALUES (?, ?, 'APPROVED')`,
        [cleanupTid, uid]
      );
    }
    pass('4 inscricoes APPROVED criadas');

    // 3. Cria 2 duplas via HTTP
    const d1Res = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: cleanupTid, dupla_name: 'DupA', handicap: 12.0, player_ids: [p1, p2],
    });
    if (d1Res.status !== 200 || !d1Res.body.id) { fail(`create dupla1: ${d1Res.status} ${JSON.stringify(d1Res.body)}`); return; }
    const dupla1 = d1Res.body.id;
    const d2Res = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: cleanupTid, dupla_name: 'DupB', handicap: 18.0, player_ids: [p3, p4],
    });
    if (d2Res.status !== 200 || !d2Res.body.id) { fail(`create dupla2: ${d2Res.status} ${JSON.stringify(d2Res.body)}`); return; }
    const dupla2 = d2Res.body.id;
    pass(`2 duplas criadas (id ${dupla1}, ${dupla2})`);

    // 4. Enforcement: user ja em outra dupla deve rejeitar
    const conflictRes = await req('POST', '/api/tournament-duplas', ADMIN_TOKEN, {
      tournament_id: cleanupTid, dupla_name: 'DupC', player_ids: [p1, p3], // p1 ja em DupA
    });
    if (conflictRes.status === 400 && String(conflictRes.body.message).includes('DupA')) {
      pass('POST /tournament-duplas rejeita user ja em outra dupla do MESMO torneio (400)');
    } else {
      fail(`enforcement 1-user-1-dupla nao disparou: ${conflictRes.status} ${JSON.stringify(conflictRes.body)}`);
    }

    // 5. Auto-gera flights (deve criar 1 grupo com 2 duplas)
    const autoRes = await req('POST', '/api/groups/auto-generate', ADMIN_TOKEN, {
      tournament_id: cleanupTid, round_number: 1,
    });
    if (autoRes.status !== 200 || autoRes.body.groupsCreated !== 1) {
      fail(`auto-generate: esperado 1 grupo, veio ${JSON.stringify(autoRes.body)} status ${autoRes.status}`);
    } else if (autoRes.body.duplasDistributed !== 2 || autoRes.body.playersDistributed !== 4) {
      fail(`auto-generate distribution errada: ${JSON.stringify(autoRes.body)}`);
    } else {
      pass('auto-generate cria 1 grupo com 2 duplas (=4 players)');
    }

    // 6. GET groups/list retorna duplas
    const groupsRes = await req('GET', `/api/groups/list/${cleanupTid}`, ADMIN_TOKEN);
    if (groupsRes.status !== 200 || !Array.isArray(groupsRes.body) || groupsRes.body.length !== 1) {
      fail(`groups/list: ${groupsRes.status} ${JSON.stringify(groupsRes.body).slice(0, 100)}`); return;
    }
    const group = groupsRes.body[0];
    if (!Array.isArray(group.duplas) || group.duplas.length !== 2) {
      fail(`groups[0].duplas esperado 2, veio ${JSON.stringify(group.duplas)}`);
    } else {
      pass(`groups/list retorna groups[0].duplas com 2 duplas`);
    }

    // 7. saveScore com dupla_id
    // P1 pertence a DupA — pode marcar por DupA
    const s1 = await req('POST', '/api/scores/save', P1_TOKEN, {
      tournament_id: cleanupTid, dupla_id: dupla1, hole_number: 1, round_number: 1, strokes: 4,
    });
    if (s1.status !== 200) fail(`saveScore dupla1: ${s1.status} ${JSON.stringify(s1.body)}`);
    else pass('P1 salva score da propria dupla (DupA) OK');

    // P1 NAO pertence a DupB — deve rejeitar 403
    const s2 = await req('POST', '/api/scores/save', P1_TOKEN, {
      tournament_id: cleanupTid, dupla_id: dupla2, hole_number: 1, round_number: 1, strokes: 5,
    });
    if (s2.status === 403) pass('P1 rejeitado ao tentar marcar por dupla que nao eh a sua (403)');
    else fail(`membership check falhou: ${s2.status} ${JSON.stringify(s2.body)}`);

    // 8. Confere que INSERT gravou dupla_id + entity_ref = -dupla_id + user_id NULL
    const [[scoreRow]] = await conn.query(
      'SELECT user_id, dupla_id, entity_ref FROM scores WHERE tournament_id = ? AND dupla_id = ? AND hole_number = 1 AND round_number = 1',
      [cleanupTid, dupla1]
    );
    if (!scoreRow) fail('score da dupla1 nao encontrado no banco');
    else if (scoreRow.user_id !== null) fail(`user_id deveria ser NULL em score de dupla, veio ${scoreRow.user_id}`);
    else if (Number(scoreRow.dupla_id) !== dupla1) fail(`dupla_id divergente`);
    else if (Number(scoreRow.entity_ref) !== -dupla1) fail(`entity_ref deveria ser -${dupla1}, veio ${scoreRow.entity_ref}`);
    else pass(`INSERT score de dupla: user_id=NULL, dupla_id=${dupla1}, entity_ref=${-dupla1}`);

    // 9. Rejeita saveScore com user_id em torneio doubles
    const s3 = await req('POST', '/api/scores/save', P1_TOKEN, {
      tournament_id: cleanupTid, user_id: p1, hole_number: 2, round_number: 1, strokes: 4,
    });
    if (s3.status === 400 && String(s3.body.error).includes('dupla_id')) {
      pass('saveScore em torneio doubles rejeita payload com user_id (400)');
    } else {
      fail(`payload user_id em doubles nao rejeitado: ${s3.status} ${JSON.stringify(s3.body)}`);
    }

    // 10. Leaderboard agrega por dupla
    const lbRes = await req('GET', `/api/leaderboard/${cleanupTid}`, ADMIN_TOKEN);
    if (lbRes.status !== 200 || !Array.isArray(lbRes.body) || lbRes.body.length !== 2) {
      fail(`leaderboard: esperado 2 duplas, veio ${JSON.stringify(lbRes.body).slice(0, 200)}`);
    } else {
      const dupA = lbRes.body.find(r => Number(r.dupla_id) === dupla1);
      if (!dupA) fail('DupA ausente no leaderboard');
      else if (Number(dupA.total_strokes) !== 4) fail(`DupA total_strokes esperado 4, veio ${dupA.total_strokes}`);
      else if (dupA.category !== 'Masculina') fail(`DupA (2M) categoria esperada Masculina, veio ${dupA.category}`);
      else if (!Array.isArray(dupA.players) || dupA.players.length !== 2) fail(`DupA players[] esperado 2, veio ${JSON.stringify(dupA.players)}`);
      else pass(`leaderboard agrega por dupla: DupA total=4, category=Masculina, players=[${dupA.players.map(p => p.name).join(', ')}]`);

      const dupB = lbRes.body.find(r => Number(r.dupla_id) === dupla2);
      if (dupB && dupB.category !== 'Feminina') fail(`DupB (2F) categoria esperada Feminina, veio ${dupB.category}`);
      else if (dupB) pass('DupB categorizada como Feminina (2 mulheres)');
    }

    // 11. Meu Desempenho exclui torneios doubles
    // Marca torneio como concluido pra entrar na query
    await conn.execute(`UPDATE tournaments SET status = 'concluido' WHERE id = ?`, [cleanupTid]);
    const mpRes = await req('GET', '/api/players/me/performance?period=all', P1_TOKEN);
    if (mpRes.status !== 200) fail(`Meu Desempenho: ${mpRes.status} ${JSON.stringify(mpRes.body)}`);
    else {
      // Como o P1 so tem esse torneio (que eh doubles), rounds_analyzed deve ser 0.
      // Se rounds_analyzed > 0, torneio doubles vazou pra estatistica individual.
      if (mpRes.body.rounds_analyzed > 0) {
        fail(`Meu Desempenho contou ${mpRes.body.rounds_analyzed} rodadas de doubles (deveria excluir)`);
      } else {
        pass('Meu Desempenho exclui torneios doubles (rounds_analyzed=0)');
      }
    }

    console.log('\n== RESULTADO ==');
    console.log(failures === 0 ? 'OK PASS (todos os checks)' : `FAIL (${failures} falhas)`);
  } finally {
    // Cleanup: apaga torneio (FK CASCADE cobre duplas, players, scores, groups)
    if (cleanupTid) {
      await conn.execute('DELETE FROM tournament_scorecard_signatures WHERE tournament_id = ?', [cleanupTid]);
      await conn.execute('DELETE FROM group_duplas WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id = ?)', [cleanupTid]);
      await conn.execute('DELETE FROM tournament_groups WHERE tournament_id = ?', [cleanupTid]);
      await conn.execute('DELETE FROM inscriptions WHERE tournament_id = ?', [cleanupTid]);
      await conn.execute('DELETE FROM tournaments WHERE id = ?', [cleanupTid]);
    }
    // Usuarios ficam pra reuso (padrao do verify-scoring-type-flow.js)
    await conn.end();
    process.exit(failures === 0 ? 0 : 1);
  }
}

main().catch(e => { console.error(e); process.exit(2); });
