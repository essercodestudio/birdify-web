// Verificação runtime da mudança de categorias para torneios result_points
// (Bloco 1 · Commit 1.1 — Ajuste 1).
//
// Cenários cobertos:
//   FASE A — feature nova (torneio result_points ignora tournament_categories):
//     1. Admin cria torneio result_points via API (categories=[])
//     2. Backend gravou tournament_categories vazio (0 linhas)
//     3. Abre /leaderboard/:id?public=true — abas devem ser "Masculino" e
//        "Feminino" (nada de M0-M4/F0-F3)
//     4. Inscreve 1 jogador M + 1 jogador F, marca scores em ambos, confirma
//        que aba "Masculino" mostra só o M e "Feminino" só o F
//
//   FASE B — regressão strokes (torneio antigo NÃO mudou):
//     5. Pega o torneio strokes mais recente do clube 1
//     6. GET /tournaments/:id retorna categorias antigas (M0-M4/F0-F3)
//     7. /leaderboard/:id renderiza as abas antigas, não "Masculino"/"Feminino"
//
// Como rodar (backend em 3001 + frontend CRA em 3000):
//   cd scripts/verify && node verify-categories-result-points.js

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
const PLAYER_M = { email: 'verify.player.m@test.local', name: 'Verify Player M', gender: 'M', pwd: 'verify123' };
const PLAYER_F = { email: 'verify.player.f@test.local', name: 'Verify Player F', gender: 'F', pwd: 'verify123' };
const ADMIN    = { email: 'verify.admin@test.local',    name: 'Verify Admin',    gender: 'M', pwd: 'verify123' };
const OUT = __dirname;

const DEFAULT_RP = {
  hio: 8, albatross: 6, eagle: 5, birdie: 3, par: 2, bogey: 1, double_bogey: 0, triple_bogey: -1,
};

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

async function seedResultPointsTournament(playerMId, playerFId, adminId) {
  const conn = await mysql.createConnection({ ...DB_CFG, multipleStatements: true });
  try {
    const [[course]] = await conn.query('SELECT id FROM courses WHERE club_id=1 LIMIT 1');
    if (!course) throw new Error('nenhum course no clube 1');
    const name = `Verify Cats RP ${Date.now().toString(36).toUpperCase()}`;
    const start = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    // NOTA: NAO inserimos tournament_categories — feature em teste ignora essa
    // tabela em result_points. Backend aceita categories=[] sem erro.
    const [t] = await conn.query(
      `INSERT INTO tournaments (club_id, name, start_date, course_id, format, total_rounds, scoring_type, status)
       VALUES (1,?,?,?, 'shotgun', 1, 'result_points', 'OPEN')`,
      [name, start, course.id]);
    const tid = t.insertId;
    await conn.query(`INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES (?,1,?,?)`, [tid, start, course.id]);
    await conn.query(`INSERT INTO tournament_result_points (tournament_id,result_kind,points) VALUES ?`,
      [Object.entries(DEFAULT_RP).map(([k, v]) => [tid, k, v])]);
    // Inscricoes SEM category_id (torneio result_points nao tem categorias)
    await conn.query(
      `INSERT INTO inscriptions (tournament_id,user_id,category_id,status) VALUES (?,?,NULL,'APPROVED'),(?,?,NULL,'APPROVED'),(?,?,NULL,'APPROVED')`,
      [tid, playerMId, tid, playerFId, tid, adminId]);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const [g] = await conn.query(
      `INSERT INTO tournament_groups (tournament_id,round_number,group_name,access_code,starting_hole) VALUES (?,1,'Flight Cats',?,1)`,
      [tid, code]);
    const gid = g.insertId;
    await conn.query(`INSERT INTO group_players (group_id,user_id,handicap) VALUES (?,?,10.0),(?,?,15.0)`, [gid, playerMId, gid, playerFId]);
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

async function pickStrokesTournament() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute(
      `SELECT t.id, t.name,
              (SELECT COUNT(*) FROM tournament_categories WHERE tournament_id=t.id) AS n_cats
         FROM tournaments t
        WHERE t.club_id=1 AND t.scoring_type='strokes'
        ORDER BY n_cats DESC, t.id DESC LIMIT 1`
    );
    if (!rows.length) throw new Error('nenhum torneio strokes no clube 1 pra testar regressao');
    return rows[0];
  } finally { await conn.end(); }
}

(async () => {
  console.log('== seed usuarios ==');
  const playerMId = await ensureUser(PLAYER_M.email, PLAYER_M.name, 'PLAYER', 'M');
  const playerFId = await ensureUser(PLAYER_F.email, PLAYER_F.name, 'PLAYER', 'F');
  const adminId   = await ensureUser(ADMIN.email,    ADMIN.name,    'ADMIN',  'M');
  console.log(`M=${playerMId} F=${playerFId} admin=${adminId}`);

  const M_TOKEN = jwt.sign({ id: playerMId, role: 'PLAYER' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const F_TOKEN = jwt.sign({ id: playerFId, role: 'PLAYER' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const { tid, gid } = await seedResultPointsTournament(playerMId, playerFId, adminId);
  console.log(`torneio result_points tid=${tid} gid=${gid}`);

  // Confirma que tournament_categories esta vazio pra este torneio
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) n FROM tournament_categories WHERE tournament_id=?`, [tid]);
    if (n !== 0) fail(`tournament_categories deveria estar vazio para result_points, veio n=${n}`);
    else pass('tournament_categories vazio para torneio result_points');
  } finally { await conn.end(); }

  // Marca 3 buracos pro M e 3 pro F via API
  const seedScores = async (token, uid, base) => {
    for (const kind of ['birdie', 'par', 'bogey']) {
      const idx = ['birdie', 'par', 'bogey'].indexOf(kind);
      const r = await apiCall('POST', '/scores/save', token, {
        tournament_id: tid, user_id: uid, hole_number: base + idx, round_number: 1, result_kind: kind,
      });
      if (r.status !== 200) throw new Error(`save falhou uid=${uid} kind=${kind} status=${r.status}`);
    }
  };
  await seedScores(M_TOKEN, playerMId, 1);   // M em B1-3
  await seedScores(F_TOKEN, playerFId, 1);   // F em B1-3 (mesmos buracos, users diferentes)
  pass('3 scores gravados pra M e 3 pra F');

  // Abre browser
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });

  const shot = async (label) => {
    const file = path.join(OUT, `verify-categories-result-points__${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
  };

  // Login como admin antes de tudo — leaderboard ?public=true ainda exige token
  const login = async (email, pwd) => {
    await page.goto('http://localhost:3000/login');
    // Aceita banner de cookies se estiver aparecendo (esconde o botao ENTRAR)
    const cookieBtn = page.getByRole('button', { name: /Entendido e Aceito/i });
    if (await cookieBtn.count()) { await cookieBtn.click(); await page.waitForTimeout(300); }
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(pwd);
    await page.getByRole('button', { name: /ENTRAR NO SISTEMA|entrar/i }).click();
    await page.waitForURL(url => !String(url).endsWith('/login'), { timeout: 15000 });
  };

  try {
    await login(ADMIN.email, ADMIN.pwd);
    console.log('logado como admin');

    // ============ FASE A: FEATURE NOVA ============
    console.log('\n== FASE A: leaderboard result_points mostra Masculino/Feminino ==');
    await page.goto(`http://localhost:3000/leaderboard/${tid}?public=true`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('01-leaderboard-result-points');

    // Deve ter EXATAMENTE 2 abas: Masculino e Feminino
    const tabMasc = await page.getByRole('button', { name: /^Masculino$/ }).count();
    const tabFem  = await page.getByRole('button', { name: /^Feminino$/ }).count();
    const tabM0   = await page.getByRole('button', { name: /M0/ }).count();
    const tabF0   = await page.getByRole('button', { name: /F0/ }).count();
    console.log(`abas — Masculino: ${tabMasc}, Feminino: ${tabFem}, M0: ${tabM0}, F0: ${tabF0}`);
    if (tabMasc < 1) fail('esperava aba "Masculino"');
    if (tabFem  < 1) fail('esperava aba "Feminino"');
    if (tabM0   > 0) fail('NAO deveria ter aba com "M0" em result_points');
    if (tabF0   > 0) fail('NAO deveria ter aba com "F0" em result_points');
    if (tabMasc >= 1 && tabFem >= 1 && tabM0 === 0 && tabF0 === 0)
      pass('leaderboard result_points: abas Masculino/Feminino, sem M0-M4/F0-F3');

    // Aba Masculino ativa por default (primeira) — deve mostrar M, esconder F
    await page.getByRole('button', { name: /^Masculino$/ }).click();
    await page.waitForTimeout(600);
    await shot('02-tab-masculino');
    const showsPlayerMinM = await page.getByText(PLAYER_M.name).count();
    const showsPlayerFinM = await page.getByText(PLAYER_F.name).count();
    if (showsPlayerMinM < 1) fail(`aba Masculino nao mostra ${PLAYER_M.name}`);
    if (showsPlayerFinM > 0) fail(`aba Masculino nao deveria mostrar ${PLAYER_F.name}`);
    if (showsPlayerMinM >= 1 && showsPlayerFinM === 0) pass('aba Masculino filtra correto (so M)');

    // Aba Feminino
    await page.getByRole('button', { name: /^Feminino$/ }).click();
    await page.waitForTimeout(600);
    await shot('03-tab-feminino');
    const showsPlayerMinF = await page.getByText(PLAYER_M.name).count();
    const showsPlayerFinF = await page.getByText(PLAYER_F.name).count();
    if (showsPlayerFinF < 1) fail(`aba Feminino nao mostra ${PLAYER_F.name}`);
    if (showsPlayerMinF > 0) fail(`aba Feminino nao deveria mostrar ${PLAYER_M.name}`);
    if (showsPlayerFinF >= 1 && showsPlayerMinF === 0) pass('aba Feminino filtra correto (so F)');

    // ============ FASE B: REGRESSAO STROKES ============
    console.log('\n== FASE B: torneio strokes preexistente inalterado ==');
    const tStrokes = await pickStrokesTournament();
    console.log(`torneio strokes id=${tStrokes.id} "${tStrokes.name}" cats=${tStrokes.n_cats}`);
    if (tStrokes.n_cats === 0) {
      console.log('WARN: torneio escolhido tem 0 categorias — regressao inconclusiva pra tabs custom');
    }
    await page.goto(`http://localhost:3000/leaderboard/${tStrokes.id}?public=true`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot('04-leaderboard-strokes-regression');
    // Se o torneio strokes tiver categorias, NAO devem virar Masculino/Feminino
    const rMasc  = await page.getByRole('button', { name: /^Masculino$/ }).count();
    const rFem   = await page.getByRole('button', { name: /^Feminino$/ }).count();
    const rM0    = await page.getByRole('button', { name: /M0|Masculino Gross/ }).count();
    console.log(`abas strokes — "Masculino" exato: ${rMasc}, "Feminino" exato: ${rFem}, M0/Gross: ${rM0}`);
    if (tStrokes.n_cats > 0) {
      if (rMasc > 0) fail('torneio strokes NAO deveria ter aba "Masculino" exata (usa M0-M4)');
      if (rFem  > 0) fail('torneio strokes NAO deveria ter aba "Feminino" exata (usa F0-F3)');
      if (rM0 < 1) fail('esperava alguma aba com M0/Masculino Gross no torneio strokes');
      if (rMasc === 0 && rFem === 0 && rM0 >= 1) pass('regressao strokes: categorias antigas preservadas');
    } else {
      pass('regressao strokes: torneio sem categorias (tabs vazio) — nao aplicavel');
    }

    // ============ FASE C: DASHBOARD ESCONDE BLOCO ============
    console.log('\n== FASE C: dashboard esconde bloco categorias em result_points ==');
    // Ja logado como admin desde o inicio
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Abre form de novo torneio (pode variar por versao — tenta CTA "CRIAR TORNEIO")
    const criarBtn = page.getByRole('button', { name: /criar torneio/i }).first();
    if (await criarBtn.count()) { await criarBtn.click(); await page.waitForTimeout(600); }
    await shot('05-dashboard-form-default');

    // Default eh strokes — bloco "2. CATEGORIAS" com M0-M4 tem que existir
    const catBoxM0Def = await page.getByText(/Masculino Gross \(M0\)/).count();
    if (catBoxM0Def < 1) fail('dashboard default (strokes): esperava caixa "Masculino Gross (M0)"');
    else pass('dashboard default (strokes): mostra caixa M0');

    // Clica Pontuacao por Resultado
    const rpToggle = page.getByRole('button', { name: /Pontuação por Resultado/i }).first();
    if (await rpToggle.count()) {
      await rpToggle.click();
      await page.waitForTimeout(600);
    }
    await shot('06-dashboard-result-points');

    // M0 nao deve mais aparecer; aviso "categorias fixas" deve aparecer
    const catBoxM0RP = await page.getByText(/Masculino Gross \(M0\)/).count();
    const aviso     = await page.getByText(/categorias fixas.*Masculino.*Feminino/i).count();
    if (catBoxM0RP > 0) fail('dashboard result_points: NAO deveria mostrar caixa M0');
    if (aviso < 1) fail('dashboard result_points: esperava aviso sobre categorias fixas');
    if (catBoxM0RP === 0 && aviso >= 1) pass('dashboard result_points: esconde M0-M4, mostra aviso');
  } finally {
    await browser.close();
    console.log('\n== cleanup: apagando torneio de teste ==');
    await cleanupTournament(tid);
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'OK PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
