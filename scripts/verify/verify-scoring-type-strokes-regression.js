// Verificação runtime: regressão do modo Tacadas (Onda A · Pontuação por
// Resultado). Confirma que torneios pré-existentes (scoring_type='strokes'
// implícito) NÃO mudaram de comportamento em NENHUMA das 3 telas afetadas
// pela feature:
//   1. Dashboard admin — toggle "Tacadas" ativo por default
//   2. AdminScoreEditor — matriz de inputs numéricos (não dropdown)
//   3. Leaderboard público — header PAR (não PTS)
//
// Também confere no backend: GET /tournaments/:id retorna scoring_type=strokes
// e result_points=[] pra torneios legados.
//
// Como rodar (backend em 3001 + frontend CRA em 3000):
//   cd scripts/verify && node verify-scoring-type-strokes-regression.js

const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const ADMIN_EMAIL = 'verify.admin@test.local';
const ADMIN_PWD   = 'verify123';
const OUT = __dirname;

let failures = 0;
const fail = (m) => { failures++; console.log('❌', m); };
const pass = (m) => console.log('✅', m);

async function ensureAdmin() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash(ADMIN_PWD, 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [ADMIN_EMAIL]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=? WHERE id=?',
        [hash, 'ADMIN', 'Verify Admin', id]);
    } else {
      const [r] = await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?,?,?,?,?)',
        ['Verify Admin', ADMIN_EMAIL, hash, 'ADMIN', 'M']
      );
      id = r.insertId;
    }
    await conn.execute('INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, 1)', [id]);
    return id;
  } finally { await conn.end(); }
}

async function pickStrokesTournament() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute(
      `SELECT t.id, t.name
         FROM tournaments t
        WHERE t.club_id=1 AND t.scoring_type='strokes'
        ORDER BY t.id DESC LIMIT 1`
    );
    if (!rows.length) throw new Error('nenhum torneio strokes no clube 1 pra testar regressão');
    return rows[0];
  } finally { await conn.end(); }
}

async function login(page, email, pwd) {
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pwd);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(url => !String(url).endsWith('/login'), { timeout: 15000 });
}

(async () => {
  await ensureAdmin();
  const tourn = await pickStrokesTournament();
  console.log(`torneio strokes escolhido: id=${tourn.id} "${tourn.name}"`);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });

  const shot = async (label) => {
    const file = path.join(OUT, `verify-scoring-type-strokes-regression__${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
  };

  try {
    // 1) Login admin + Dashboard (default form → toggle Tacadas ativo)
    console.log('== dashboard: toggle default "Tacadas" ativo ==');
    await login(page, ADMIN_EMAIL, ADMIN_PWD);
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await shot('01-dashboard');
    const btnTacBg = await page.getByRole('button', { name: /Tacadas.*menor soma/i }).first()
      .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => 'N/A');
    const btnPtsBg = await page.getByRole('button', { name: /Pontuação por Resultado/i }).first()
      .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => 'N/A');
    console.log(`toggle bg — Tacadas: ${btnTacBg} | Pontuação: ${btnPtsBg}`);
    if (!/rgb\(34,\s*197,\s*94\)/.test(btnTacBg)) fail('Tacadas deveria estar ATIVO (bg accent) por default');
    else pass('Dashboard toggle "Tacadas" ativo por default');

    // 2) Backend: GET /tournaments/:id de um strokes retorna result_points vazio
    console.log('== backend: GET /tournaments/:id (torneio strokes) ==');
    const backend = await page.evaluate(async (tid) => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const r = await fetch(`http://localhost:3001/api/tournaments/${tid}`, { headers: { Authorization: 'Bearer ' + token } });
      return { status: r.status, body: await r.json() };
    }, tourn.id);
    if (backend.status !== 200) fail(`GET /tournaments/${tourn.id} status=${backend.status}`);
    else if (backend.body.scoring_type !== 'strokes') fail(`scoring_type esperado strokes, veio ${backend.body.scoring_type}`);
    else if (!Array.isArray(backend.body.result_points) || backend.body.result_points.length !== 0)
      fail(`result_points deveria vir [] pra torneio strokes, veio ${JSON.stringify(backend.body.result_points)}`);
    else pass('GET /tournaments/:id: scoring_type=strokes, result_points=[]');

    // 3) AdminScoreEditor: matriz de inputs numéricos, zero selects
    console.log('== AdminScoreEditor: matriz numérica ==');
    await page.goto('http://localhost:3000/admin/ajustar-scores');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const sel = page.locator('select').first();
    await sel.waitFor({ timeout: 10000 });
    await sel.selectOption(String(tourn.id));
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('02-admin-editor');
    const numInputs = await page.locator('input[type="number"]').count();
    const tableSelects = await page.locator('table select').count();
    console.log(`matriz — <input type=number>: ${numInputs} | table <select>: ${tableSelects}`);
    if (numInputs < 10) fail(`esperava >=10 inputs numéricos, veio ${numInputs}`);
    if (tableSelects > 0) fail(`NÃO deveria ter <select> na matriz de torneio strokes, veio ${tableSelects}`);
    if (numInputs >= 10 && tableSelects === 0) pass('AdminScoreEditor: matriz numérica preservada');

    // 4) Leaderboard: header PAR (não PTS)
    console.log('== Leaderboard: coluna PAR (não PTS) ==');
    await page.goto(`http://localhost:3000/leaderboard/${tourn.id}?public=true`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('03-leaderboard');
    const hasPar = await page.getByText(/^PAR$/, { exact: true }).count();
    const hasPts = await page.getByText(/^PTS$/, { exact: true }).count();
    console.log(`header — PAR: ${hasPar} | PTS: ${hasPts}`);
    if (hasPar < 1) fail('esperava coluna PAR no leaderboard strokes');
    if (hasPts > 0) fail('NÃO deveria ter coluna PTS em torneio strokes');
    if (hasPar >= 1 && hasPts === 0) pass('Leaderboard: header PAR preservado');
  } finally {
    await browser.close();
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? '✅ PASS' : `❌ FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
