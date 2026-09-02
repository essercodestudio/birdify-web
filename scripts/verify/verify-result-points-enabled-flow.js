// Verificação runtime do Bloco 2 · Commit 2.3 — kinds liga/desliga por
// torneio (flag enabled em tournament_result_points).
//
// Cenários:
//   FASE A — feature nova:
//     1. Cria torneio result_points com HiO/Albatross/Eagle/Triple DESATIVADOS
//        (só Birdie/Par/Bogey/DoubleBogey ativos)
//     2. GET /tournaments/:id retorna enabled=0 nos 4 desativados
//     3. POST /scores/save com result_kind='hio' -> 400
//     4. POST /scores/save com result_kind='birdie' -> 200
//     5. Scorecard UI mostra APENAS 4 botões (só os ativos)
//     6. AdminScoreEditor dropdown mostra APENAS 4 opções + "—" pra apagar
//
//   FASE B — regressão Onda A:
//     7. Torneio result_points criado sem enabled (Onda A pura) -> tudo ativo
//        (default 1) -> Scorecard mostra 8 botões
//
//   FASE C — validação backend:
//     8. PUT /tournaments/:id/... com TODOS os 8 kinds enabled=0 -> 400
//        "Pelo menos um tipo de resultado precisa ficar ativo."
//
// Como rodar (backend em 3001 + frontend CRA em 3000):
//   cd scripts/verify && node verify-result-points-enabled-flow.js

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
const jwt = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'jsonwebtoken'));

const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const PLAYER = { email: 'verify.player.m@test.local', name: 'Verify Player M', pwd: 'verify123' };
const ADMIN  = { email: 'verify.admin@test.local',    name: 'Verify Admin',    pwd: 'verify123' };
const OUT = __dirname;

const DEFAULT_RP = {
  hio: 8, albatross: 6, eagle: 5, birdie: 3, par: 2, bogey: 1, double_bogey: 0, triple_bogey: -1,
};
// 4 desativados (kinds "aereos") + 4 ativos: birdie/par/bogey/double_bogey
const DISABLED_SET = new Set(['hio', 'albatross', 'eagle', 'triple_bogey']);

let failures = 0;
const fail = (m) => { failures++; console.log('X', m); };
const pass = (m) => console.log('OK', m);

async function ensureUser(email, name, role, gender) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash('verify123', 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [email]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=?, gender=? WHERE id=?', [hash, role, name, gender, id]);
    } else {
      const [r] = await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?,?,?,?,?)',
        [name, email, hash, role, gender]
      );
      id = r.insertId;
    }
    if (role === 'ADMIN') await conn.execute('INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, 1)', [id]);
    return id;
  } finally { await conn.end(); }
}

// Seed com controle explicito do enabled (4 desativados, 4 ativos)
async function seedTournamentPartialEnabled(playerId, adminId) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const name = `Verify RP-EN partial ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, scoring_type, status)
       VALUES (1,?,?,?, 'shotgun', 1, 'result_points', 'OPEN')`,
      [name, start, course.id]);
    const tid = t.insertId;
    await conn.query(`INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?,1,?,?)`, [tid, start, course.id]);
    // Config com enabled = 0 pros 4 aereos, 1 pro resto
    const rows = Object.entries(DEFAULT_RP).map(([k, v]) => [tid, k, v, DISABLED_SET.has(k) ? 0 : 1]);
    await conn.query(`INSERT INTO tournament_result_points (tournament_id,result_kind,points,enabled) VALUES ?`, [rows]);
    await conn.query(
      `INSERT INTO inscriptions (tournament_id,user_id,category_id,status) VALUES (?,?,NULL,'APPROVED'),(?,?,NULL,'APPROVED')`,
      [tid, playerId, tid, adminId]);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const [g] = await conn.query(
      `INSERT INTO tournament_groups (tournament_id,round_number,group_name,access_code,starting_hole) VALUES (?,1,'Flight EN',?,1)`,
      [tid, code]);
    const gid = g.insertId;
    await conn.query(`INSERT INTO group_players (group_id,user_id,handicap) VALUES (?,?,10.0)`, [gid, playerId]);
    return { tid, gid, access_code: code };
  } finally { await conn.end(); }
}

// Seed sem coluna enabled no INSERT — usa default 1 (regressão Onda A)
async function seedTournamentDefaultEnabled(playerId, adminId) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    const name = `Verify RP-EN default ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, scoring_type, status)
       VALUES (1,?,?,?, 'shotgun', 1, 'result_points', 'OPEN')`,
      [name, start, course.id]);
    const tid = t.insertId;
    await conn.query(`INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?,1,?,?)`, [tid, start, course.id]);
    // INSERT sem enabled -> DEFAULT 1
    const rows = Object.entries(DEFAULT_RP).map(([k, v]) => [tid, k, v]);
    await conn.query(`INSERT INTO tournament_result_points (tournament_id,result_kind,points) VALUES ?`, [rows]);
    await conn.query(
      `INSERT INTO inscriptions (tournament_id,user_id,category_id,status) VALUES (?,?,NULL,'APPROVED')`,
      [tid, playerId]);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const [g] = await conn.query(
      `INSERT INTO tournament_groups (tournament_id,round_number,group_name,access_code,starting_hole) VALUES (?,1,'Flight Def',?,1)`,
      [tid, code]);
    const gid = g.insertId;
    await conn.query(`INSERT INTO group_players (group_id,user_id,handicap) VALUES (?,?,10.0)`, [gid, playerId]);
    return { tid, gid, access_code: code };
  } finally { await conn.end(); }
}

async function cleanupTournament(tid) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute(`DELETE FROM tournament_scorecard_signatures WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM group_players WHERE group_id IN (SELECT id FROM tournament_groups WHERE tournament_id=?)`, [tid]);
    await conn.execute(`DELETE FROM tournament_groups WHERE tournament_id=?`, [tid]);
    await conn.execute(`DELETE FROM tournaments WHERE id=?`, [tid]);
  } finally { await conn.end(); }
}

function apiCall(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost', port: 3001, path: `/api${apiPath}`, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('== seed usuarios ==');
  const playerId = await ensureUser(PLAYER.email, PLAYER.name, 'PLAYER', 'M');
  const adminId  = await ensureUser(ADMIN.email,  ADMIN.name,  'ADMIN',  'M');
  console.log(`player=${playerId} admin=${adminId}`);
  const PLAYER_TOKEN = jwt.sign({ id: playerId, role: 'PLAYER' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const ADMIN_TOKEN  = jwt.sign({ id: adminId,  role: 'ADMIN'  }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // ============ FASE A: FEATURE NOVA ============
  console.log('\n== FASE A: torneio com 4 kinds desativados ==');
  const { tid: tidA, gid: gidA, access_code: codeA } = await seedTournamentPartialEnabled(playerId, adminId);
  console.log(`tidA=${tidA} gidA=${gidA} code=${codeA}`);

  // 1) GET /tournaments/:id retorna enabled=0 nos 4 desativados
  const tRes = await apiCall('GET', `/tournaments/${tidA}`, ADMIN_TOKEN);
  if (tRes.status !== 200) fail(`GET /tournaments/${tidA} status=${tRes.status}`);
  else {
    const rps = tRes.body.result_points || [];
    if (rps.length !== 8) fail(`esperava 8 rows em result_points, veio ${rps.length}`);
    let okEnabled = true;
    for (const rp of rps) {
      const expected = DISABLED_SET.has(rp.result_kind) ? 0 : 1;
      if (Number(rp.enabled) !== expected) {
        fail(`kind=${rp.result_kind}: enabled esperado ${expected}, veio ${rp.enabled}`);
        okEnabled = false;
      }
    }
    if (okEnabled && rps.length === 8) pass('GET /tournaments/:id retorna enabled=1/0 correto para cada kind');
  }

  // 2) POST /scores/save com kind DESATIVADO (hio) -> 400
  const rBad = await apiCall('POST', '/scores/save', PLAYER_TOKEN, {
    tournament_id: tidA, user_id: playerId, hole_number: 1, round_number: 1, result_kind: 'hio',
  });
  if (rBad.status !== 400) fail(`saveScore hio: esperava 400, veio ${rBad.status}: ${JSON.stringify(rBad.body)}`);
  else if (!String(rBad.body?.error || '').includes("desativado")) fail(`erro esperava 'desativado', veio '${rBad.body?.error}'`);
  else pass('saveScore rejeita kind desativado com 400 + mensagem clara');

  // 3) POST /scores/save com kind ATIVO (birdie) -> 200
  const rOk = await apiCall('POST', '/scores/save', PLAYER_TOKEN, {
    tournament_id: tidA, user_id: playerId, hole_number: 1, round_number: 1, result_kind: 'birdie',
  });
  if (rOk.status !== 200) fail(`saveScore birdie: esperava 200, veio ${rOk.status}: ${JSON.stringify(rOk.body)}`);
  else pass('saveScore aceita kind ativo (birdie)');

  // 4) admin edit com kind desativado -> 400
  const rEdit = await apiCall('PUT', '/admin/scores/tournament', ADMIN_TOKEN, {
    tournament_id: tidA, user_id: playerId, hole_number: 1, round_number: 1,
    result_kind: 'eagle', reason: 'verify-enabled: tentar setar kind desativado',
  });
  if (rEdit.status !== 400) fail(`admin edit eagle: esperava 400, veio ${rEdit.status}`);
  else if (!String(rEdit.body?.error || '').includes("desativado")) fail(`admin edit erro: '${rEdit.body?.error}'`);
  else pass('admin editTournamentScore rejeita kind desativado com 400');

  // ============ FASE B: REGRESSAO ONDA A (sem enabled = default 1) ============
  console.log('\n== FASE B: torneio result_points sem enabled (regressao Onda A) ==');
  const { tid: tidB } = await seedTournamentDefaultEnabled(playerId, adminId);
  console.log(`tidB=${tidB}`);
  const tResB = await apiCall('GET', `/tournaments/${tidB}`, ADMIN_TOKEN);
  const rpsB = tResB.body?.result_points || [];
  const allEnabledB = rpsB.length === 8 && rpsB.every(r => Number(r.enabled) === 1);
  if (!allEnabledB) fail(`regressao: esperava todos 8 kinds enabled=1, veio ${JSON.stringify(rpsB.map(r => [r.result_kind, r.enabled]))}`);
  else pass('regressao Onda A: torneio sem enabled -> default 1 pra todos os 8 kinds');
  // saveScore de qualquer kind deve funcionar
  const rHioOk = await apiCall('POST', '/scores/save', PLAYER_TOKEN, {
    tournament_id: tidB, user_id: playerId, hole_number: 1, round_number: 1, result_kind: 'hio',
  });
  if (rHioOk.status !== 200) fail(`regressao: saveScore hio em torneio default esperava 200, veio ${rHioOk.status}`);
  else pass('regressao: saveScore hio aceito em torneio sem restricao');

  // ============ FASE C: VALIDACAO BACKEND — todos desativados ============
  console.log('\n== FASE C: rejeita config com TODOS kinds desativados ==');
  const rAllOff = await apiCall('PUT', `/tournaments/update/${tidA}`, ADMIN_TOKEN, {
    name: `Verify AllOff ${Date.now()}`,
    start_date: new Date(Date.now() + 30 * 3600 * 1000).toISOString().slice(0, 16),
    course_id: 10, // Pine Hill do clube 1
    format: 'shotgun',
    scoring_type: 'result_points',
    result_points: Object.entries(DEFAULT_RP).map(([k, v]) => ({ result_kind: k, points: v, enabled: 0 })),
    categories: [],
  });
  if (rAllOff.status !== 400) fail(`config all-off: esperava 400, veio ${rAllOff.status}: ${JSON.stringify(rAllOff.body)}`);
  else if (!String(rAllOff.body?.error || '').match(/pelo menos um/i)) fail(`erro nao inclui 'pelo menos um': '${rAllOff.body?.error}'`);
  else pass('backend rejeita config com todos os 8 kinds desativados');

  // ============ FASE D: UI SCORECARD + ADMIN EDITOR ============
  console.log('\n== FASE D: Scorecard mostra so 4 botoes, AdminScoreEditor so 4 opcoes ==');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });

  const shot = async (label) => {
    const file = path.join(OUT, `verify-result-points-enabled-flow__${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
  };

  const login = async (email, pwd) => {
    await page.goto('http://localhost:3000/login');
    const cookieBtn = page.getByRole('button', { name: /Entendido e Aceito/i });
    if (await cookieBtn.count()) { await cookieBtn.click(); await page.waitForTimeout(300); }
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(pwd);
    await page.getByRole('button', { name: /ENTRAR NO SISTEMA|entrar/i }).click();
    await page.waitForURL(url => !String(url).endsWith('/login'), { timeout: 15000 });
  };

  try {
    // Player entra no scorecard do torneio A (4 kinds desativados)
    await login(PLAYER.email, PLAYER.pwd);
    await page.getByRole('button', { name: /Entrar na Partida/i }).first().click();
    await page.waitForSelector('input[placeholder="A1B2"]', { timeout: 5000 });
    await page.locator('input[placeholder="A1B2"]').fill(codeA);
    await page.getByRole('button', { name: /COMEÇAR PARTIDA/i }).click();
    await page.waitForSelector('input[type="number"]', { timeout: 10000 });
    await page.getByRole('button', { name: /CONFIRMAR/i }).click();
    await page.waitForURL(new RegExp(`/scorecard/${gidA}`), { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('01-scorecard-partial');

    // Contar botoes por kind — o Scorecard usa labels curtos (HiO/Dbl Bogey/Tpl Bogey)
    // e cada botao tem 2 divs (label + "Npt"), entao accessible name eh tipo "Par 2pt".
    // Regex pega prefixo com espaco+dig (aceita "3pt" ou negativo).
    const btnBirdie = await page.getByRole('button', { name: /^Birdie \-?\d/i }).count();
    const btnPar    = await page.getByRole('button', { name: /^Par \-?\d/i }).count();
    const btnBogey  = await page.getByRole('button', { name: /^Bogey \-?\d/i }).count();
    const btnDouble = await page.getByRole('button', { name: /^Dbl Bogey \-?\d/i }).count();
    const btnHio    = await page.getByRole('button', { name: /^HiO \-?\d/i }).count();
    const btnAlba   = await page.getByRole('button', { name: /^Albatross \-?\d/i }).count();
    const btnEagle  = await page.getByRole('button', { name: /^Eagle \-?\d/i }).count();
    const btnTriple = await page.getByRole('button', { name: /^Tpl Bogey \-?\d/i }).count();
    console.log(`botoes ativos: Birdie=${btnBirdie} Par=${btnPar} Bogey=${btnBogey} Double=${btnDouble}`);
    console.log(`botoes desativados esperados: HiO=${btnHio} Alba=${btnAlba} Eagle=${btnEagle} Triple=${btnTriple}`);
    if (btnBirdie < 1 || btnPar < 1 || btnBogey < 1 || btnDouble < 1)
      fail('Scorecard nao mostrou todos os 4 kinds ATIVOS');
    if (btnHio > 0 || btnAlba > 0 || btnEagle > 0 || btnTriple > 0)
      fail('Scorecard mostrou kind(s) DESATIVADOS que deveriam sumir');
    if (btnBirdie >= 1 && btnPar >= 1 && btnBogey >= 1 && btnDouble >= 1
        && btnHio === 0 && btnAlba === 0 && btnEagle === 0 && btnTriple === 0)
      pass('Scorecard filtra ResultPicker: 4 kinds ativos visiveis, 4 desativados ausentes');

    // Admin editor
    await page.goto('http://localhost:3000/dashboard'); await page.waitForTimeout(300);
    await login(ADMIN.email, ADMIN.pwd);
    await page.goto('http://localhost:3000/admin/ajustar-scores');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const sel = page.locator('select').first();
    await sel.waitFor({ timeout: 10000 });
    await sel.selectOption(String(tidA));
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('02-admin-editor-partial');
    // Conta options do primeiro <select> da matriz (excluindo o de escolher torneio no topo)
    const cellSelects = page.locator('table select');
    const nCellSelects = await cellSelects.count();
    if (nCellSelects === 0) fail('AdminScoreEditor: nenhum <select> na matriz — torneio deveria estar em result_points');
    else {
      const options = await cellSelects.first().locator('option').allTextContents();
      console.log(`options 1o dropdown: ${JSON.stringify(options)}`);
      // Esperado: "—" + Birdie + Par + Bogey + Double Bogey (5 total)
      const hasHioOpt   = options.some(o => /Hole in One/i.test(o));
      const hasAlbaOpt  = options.some(o => /Albatross/i.test(o));
      const hasEagleOpt = options.some(o => /Eagle/i.test(o));
      const hasTripleOpt= options.some(o => /Triple Bogey/i.test(o));
      const hasBirdieOpt= options.some(o => /Birdie/i.test(o));
      if (hasHioOpt || hasAlbaOpt || hasEagleOpt || hasTripleOpt)
        fail(`dropdown mostrou kinds desativados: ${JSON.stringify(options)}`);
      if (!hasBirdieOpt) fail(`dropdown nao mostrou Birdie: ${JSON.stringify(options)}`);
      if (!hasHioOpt && !hasAlbaOpt && !hasEagleOpt && !hasTripleOpt && hasBirdieOpt)
        pass('AdminScoreEditor dropdown filtra: 4 opcoes ativas + "—", 4 desativados ausentes');
    }
  } finally {
    await browser.close();
    console.log('\n== cleanup ==');
    await cleanupTournament(tidA);
    await cleanupTournament(tidB);
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'OK PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
