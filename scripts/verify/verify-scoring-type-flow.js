// Verificação runtime end-to-end da feature Pontuação por Resultado (Onda A):
// seed → scorecard ResultPicker → offline/sync → leaderboard PONTOS →
// assinatura → invalidação pós-edição do admin.
//
// Cria um torneio NOVO scoring_type=result_points com config Stableford
// default, escala verify.player num grupo, exercita todo o fluxo, e ao
// final LIMPA o torneio e a assinatura (mas mantém os usuários pra reuso).
//
// Como rodar (backend em 3001 + frontend CRA em 3000):
//   cd scripts/verify && node verify-scoring-type-flow.js

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
const PLAYER_EMAIL = 'verify.player@test.local';
const PLAYER_PWD   = 'verify123';
const ADMIN_EMAIL  = 'verify.admin@test.local';
const ADMIN_PWD    = 'verify123';
const OUT = __dirname;

const DEFAULT_RP = {
  hio: 8, albatross: 6, eagle: 5, birdie: 3, par: 2, bogey: 1, double_bogey: 0, triple_bogey: -1,
};

let failures = 0;
const fail = (m) => { failures++; console.log('❌', m); };
const pass = (m) => console.log('✅', m);

async function ensureUser(email, name, role) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash('verify123', 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [email]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=? WHERE id=?', [hash, role, name, id]);
    } else {
      const [r] = await conn.execute('INSERT INTO users (name,email,password_hash,role,gender) VALUES (?,?,?,?,?)',
        [name, email, hash, role, 'M']);
      id = r.insertId;
    }
    if (role === 'ADMIN') await conn.execute('INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, 1)', [id]);
    return id;
  } finally { await conn.end(); }
}

async function seedTournament(playerId, adminId) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    if (!course) throw new Error('nenhum course no clube 1');
    const name = `Verify RP flow ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [t] = await conn.query(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, scoring_type, status)
       VALUES (1,?,?,?, 'shotgun', 1, 'result_points', 'OPEN')`,
      [name, start, course.id]);
    const tid = t.insertId;
    await conn.query(`INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?,1,?,?)`, [tid, start, course.id]);
    await conn.query(`INSERT INTO tournament_result_points (tournament_id,result_kind,points) VALUES ?`,
      [Object.entries(DEFAULT_RP).map(([k, v]) => [tid, k, v])]);
    await conn.query(`INSERT INTO tournament_categories (tournament_id, name) VALUES (?, 'Livre')`, [tid]);
    const [[cat]] = await conn.query(`SELECT id FROM tournament_categories WHERE tournament_id=? LIMIT 1`, [tid]);
    await conn.query(
      `INSERT INTO inscriptions (tournament_id,user_id,category_id,status) VALUES (?,?,?,'APPROVED'),(?,?,?,'APPROVED')`,
      [tid, playerId, cat.id, tid, adminId, cat.id]);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const [g] = await conn.query(
      `INSERT INTO tournament_groups (tournament_id,round_number,group_name,access_code,starting_hole) VALUES (?,1,'Flight Verify',?,1)`,
      [tid, code]);
    const gid = g.insertId;
    await conn.query(`INSERT INTO group_players (group_id,user_id,handicap) VALUES (?,?,10.0)`, [gid, playerId]);
    return { tid, gid, access_code: code, course_id: course.id };
  } finally { await conn.end(); }
}

async function cleanupTournament(tid) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    // FKs CASCADE cuidam do resto (scores, rounds, result_points, categories,
    // group_players via group, signatures via group, inscriptions).
    // tournament_groups precisa DELETE explícito antes pra assinaturas caírem.
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

async function login(page, email, pwd) {
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pwd);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(url => !String(url).endsWith('/login'), { timeout: 15000 });
}

(async () => {
  console.log('== seed usuários + torneio result_points ==');
  const playerId = await ensureUser(PLAYER_EMAIL, 'Verify Player', 'PLAYER');
  const adminId  = await ensureUser(ADMIN_EMAIL,  'Verify Admin',  'ADMIN');
  const { tid, gid, access_code } = await seedTournament(playerId, adminId);
  console.log(`tid=${tid} gid=${gid} access_code=${access_code}`);

  const PLAYER_TOKEN = jwt.sign({ id: playerId, role: 'PLAYER' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const ADMIN_TOKEN  = jwt.sign({ id: adminId,  role: 'ADMIN'  }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });

  const shot = async (label) => {
    const file = path.join(OUT, `verify-scoring-type-flow__${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
  };

  try {
    // ── FLUXO SCORECARD + OFFLINE ────────────────────────────────────────
    console.log('\n== FASE 1: scorecard ResultPicker + 3 online + 3 offline + sync ==');
    await login(page, PLAYER_EMAIL, PLAYER_PWD);
    await page.getByRole('button', { name: /Entrar na Partida/i }).first().click();
    await page.waitForSelector('input[placeholder="A1B2"]', { timeout: 5000 });
    await page.locator('input[placeholder="A1B2"]').fill(access_code);
    await page.getByRole('button', { name: /COMEÇAR PARTIDA/i }).click();
    await page.waitForSelector('input[type="number"]', { timeout: 10000 });
    await page.getByRole('button', { name: /CONFIRMAR/i }).click();
    await page.waitForURL(new RegExp(`/scorecard/${gid}`), { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot('01-scorecard-hole1');

    // ResultPicker presente
    const btnBirdie = await page.getByRole('button', { name: /^Birdie/i }).count();
    const btnMinus  = await page.getByRole('button', { name: /^-$/ }).count();
    if (btnBirdie < 1) fail('ResultPicker (Birdie) ausente');
    if (btnMinus > 0) fail('+/- NÃO deveria aparecer em result_points');
    if (btnBirdie >= 1 && btnMinus === 0) pass('Scorecard: ResultPicker visível, +/- ausente');

    // 3 online: B1=Birdie, B2=Par, B3=Bogey
    for (const kind of ['Birdie', 'Par', 'Bogey']) {
      await page.getByRole('button', { name: new RegExp(`^${kind}`, 'i') }).first().click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /▶/ }).click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1500); // debounce + sync
    const svr3 = await apiCall('GET', `/scores/list/${tid}?round=1`, PLAYER_TOKEN);
    const online = { 1: 'birdie', 2: 'par', 3: 'bogey' };
    for (const [h, expected] of Object.entries(online)) {
      const s = svr3.body.find(x => x.hole_number === +h && x.user_id === playerId);
      if (!s || s.result_kind !== expected) fail(`B${h} online esperado ${expected}, veio ${JSON.stringify(s)}`);
    }
    pass('3 buracos online gravados corretamente (Birdie/Par/Bogey)');

    // 3 offline
    await ctx.setOffline(true);
    for (const kind of ['Birdie', 'Par', 'Bogey']) {
      await page.getByRole('button', { name: new RegExp(`^${kind}`, 'i') }).first().click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /▶/ }).click();
      await page.waitForTimeout(400);
    }
    await shot('02-scorecard-b6-offline');
    // Confere que servidor ainda NÃO tem B4-B6
    const svrOff = await apiCall('GET', `/scores/list/${tid}?round=1`, PLAYER_TOKEN);
    if (svrOff.body.some(s => s.hole_number >= 4)) fail('scores B4+ vazaram durante offline');
    else pass('offline OK — B4-B6 na fila local, servidor sem eles');

    // Reconecta + aguarda sync
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    let synced = false;
    for (let i = 0; i < 15; i++) {
      const s = await apiCall('GET', `/scores/list/${tid}?round=1`, PLAYER_TOKEN);
      if ([4, 5, 6].every(h => s.body.find(x => x.hole_number === h))) { synced = true; break; }
      await page.waitForTimeout(1000);
    }
    if (!synced) fail('sync não drenou B4-B6 em 15s');
    else pass('reconexão + sync OK — B4-B6 chegaram ao servidor');

    // Leaderboard PONTOS
    await page.goto(`http://localhost:3000/leaderboard/${tid}?public=true`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot('03-leaderboard-pontos');
    const hasPts = await page.getByText(/^PTS$/, { exact: true }).count();
    const hasPar = await page.getByText(/^PAR$/, { exact: true }).count();
    if (hasPts < 1) fail('esperava coluna PTS');
    if (hasPar > 0) fail('NÃO deveria ter coluna PAR em result_points');
    if (hasPts >= 1 && hasPar === 0) pass('Leaderboard: coluna PTS presente');
    const lb = await apiCall('GET', `/leaderboard/${tid}`, PLAYER_TOKEN);
    const me = lb.body.find(p => Number(p.id) === playerId);
    if (!me || Number(me.total_points) !== 12) fail(`total_points esperado 12, veio ${me?.total_points}`);
    else pass('total_points=12 (2×Birdie + 2×Par + 2×Bogey)');

    // ── FLUXO ASSINATURA + INVALIDAÇÃO ──────────────────────────────────
    console.log('\n== FASE 2: completar 18 + assinar + admin edita + invalidação ==');
    // Preenche B7-B18 via API pra ir direto ao ponto
    const kinds = ['birdie','par','bogey','birdie','par','bogey','birdie','par','bogey','par','par','birdie'];
    for (let i = 0; i < 12; i++) {
      const r = await apiCall('POST', '/scores/save', PLAYER_TOKEN, {
        tournament_id: tid, user_id: playerId, hole_number: i + 7, round_number: 1, result_kind: kinds[i],
      });
      if (r.status !== 200) { fail(`B${i+7} save falhou`); return; }
    }
    pass('B7-B18 preenchidos via API');

    // Assinar
    const sign = await apiCall('POST', '/scores/sign-card', PLAYER_TOKEN,
      { tournament_id: tid, group_id: gid, round_number: 1 });
    if (sign.status !== 200 || !sign.body?.ok) fail(`sign-card falhou: ${JSON.stringify(sign)}`);
    else pass(`sign-card OK, signed_at=${sign.body.signed_at}`);

    // Banner verde na UI
    await page.goto(`http://localhost:3000/scorecard/${gid}`);
    await page.waitForTimeout(2000);
    const voltar = page.getByRole('button', { name: /Voltar e Editar/i });
    if (await voltar.count()) { await voltar.click(); await page.waitForTimeout(1500); }
    await shot('04-scorecard-assinado');
    const bA = await page.getByText(/Cartão assinado/i).count();
    if (bA < 1) fail('banner "Cartão assinado" ausente');
    else pass('banner verde "Cartão assinado" visível');

    // Admin edita B1 (birdie→par)
    const edit = await apiCall('PUT', '/admin/scores/tournament', ADMIN_TOKEN, {
      tournament_id: tid, user_id: playerId, hole_number: 1, round_number: 1,
      result_kind: 'par', reason: 'verify-scoring-type-flow: teste de invalidação',
    });
    if (edit.status !== 200 || !edit.body?.ok) fail(`admin edit falhou: ${JSON.stringify(edit)}`);
    else if (edit.body.previous_result_kind !== 'birdie' || edit.body.new_result_kind !== 'par')
      fail(`audit kinds inesperados: prev=${edit.body.previous_result_kind} new=${edit.body.new_result_kind}`);
    else if (Number(edit.body.invalidated_signatures) < 1)
      fail('esperava >=1 assinatura invalidada');
    else pass(`admin edit OK: prev=birdie→new=par, assinaturas invalidadas=${edit.body.invalidated_signatures}`);

    // Banner vermelho
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2000);
    const voltar2 = page.getByRole('button', { name: /Voltar e Editar/i });
    if (await voltar2.count()) { await voltar2.click(); await page.waitForTimeout(1500); }
    await shot('05-scorecard-invalidado');
    const bI = await page.getByText(/Cartão invalidado/i).count();
    if (bI < 1) fail('banner "Cartão invalidado" NÃO apareceu após edit do admin');
    else pass('banner vermelho "Cartão invalidado" visível');

    // Audit trail
    const audit = await apiCall('GET', `/admin/scores/audit?context=tournament&event_id=${tid}&limit=5`, ADMIN_TOKEN);
    const last = audit.body?.[0];
    if (!last) fail('nenhum audit encontrado');
    else if (last.previous_result_kind !== 'birdie' || last.new_result_kind !== 'par')
      fail(`audit trail kinds inesperados`);
    else pass(`audit trail OK: strokes ${last.previous_strokes}→${last.new_strokes} kind ${last.previous_result_kind}→${last.new_result_kind}`);
  } finally {
    await browser.close();
    console.log('\n== cleanup: apagando torneio de teste ==');
    await cleanupTournament(tid);
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? '✅ PASS' : `❌ FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
