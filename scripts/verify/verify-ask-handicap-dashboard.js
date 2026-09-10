// Verificacao runtime do Dashboard admin (Fase 2 · Commit 2.3).
//
// Escopo (frontend puro — sem tocar em JoinGame/Scorecard/Leaderboard):
//   1. Dashboard renderiza a nova secao HANDICAP com 2 botoes (Pedir / Nao pedir)
//   2. Default = "Pedir handicap" ativo (bg accent)
//   3. Criar torneio SEM tocar no toggle → ask_handicap=1 no banco (comportamento historico)
//   4. Criar torneio marcando "Nao pedir handicap" → ask_handicap=0 no banco
//   5. Editar esse torneio → toggle hidrata em "Nao pedir handicap" ativo
//   6. Trocar de volta pra "Pedir handicap" e salvar → banco vai pra 1
//
// Requisitos: backend 3001 + frontend CRA 3000 + banco dev com migration 2.1.
//
// Como rodar:
//   cd scripts/verify && node verify-ask-handicap-dashboard.js

const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const ADMIN_EMAIL = 'verify.askhandicap@test.local';
const ADMIN_PWD   = 'verify123';
const OUT = __dirname;

let failures = 0;
const fail = (m) => { failures++; console.log('X', m); };
const pass = (m) => console.log('OK', m);

async function ensureAdmin() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const hash = await bcrypt.hash(ADMIN_PWD, 10);
    const [ex] = await conn.execute('SELECT id FROM users WHERE email=?', [ADMIN_EMAIL]);
    let id;
    if (ex.length) {
      id = ex[0].id;
      await conn.execute('UPDATE users SET password_hash=?, role=?, name=? WHERE id=?',
        [hash, 'ADMIN', 'Verify AskHandicap', id]);
    } else {
      const [r] = await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, gender) VALUES (?,?,?,?,?)',
        ['Verify AskHandicap', ADMIN_EMAIL, hash, 'ADMIN', 'M']
      );
      id = r.insertId;
    }
    await conn.execute('INSERT IGNORE INTO club_admins (user_id, club_id) VALUES (?, 1)', [id]);
    return id;
  } finally { await conn.end(); }
}

async function login(page) {
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PWD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(url => !String(url).endsWith('/login'), { timeout: 15000 });
}

// Preenche o formulario "Novo Torneio" com valores minimos validos.
// O usuario passa amanha+dias offset pra evitar conflito de data unique.
async function fillNewTournamentForm(page, name, dayOffset, courseName) {
  await page.locator('input[type="text"]').first().fill(name);

  // Course select: seleciona pelo value do <option> cujo texto bate parcial
  const courseSelect = page.locator('select').first();
  const options = await courseSelect.locator('option').evaluateAll(els =>
    els.map(o => ({ value: o.value, text: o.textContent || '' }))
  );
  const match = options.find(o => o.text.toLowerCase().includes(courseName.toLowerCase()));
  if (!match) throw new Error(`course "${courseName}" nao encontrado nas ${options.length} options`);
  await courseSelect.selectOption(match.value);

  // Data (datetime-local): amanha + offset dias, 12:00
  const d = new Date();
  d.setDate(d.getDate() + 1 + dayOffset);
  const dt = d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T').slice(0, 16);
  await page.locator('input[type="datetime-local"]').first().fill(dt);

  // Data limite de inscricao 1h antes da data do torneio. Preenchemos aqui pra
  // evitar o bug pre-existente do updateTournament (nn() nao trata '' em
  // datetime — HTTP 500 no PUT). Registrado em
  // [[project-todo-update-tournament-nn-empty-string]]. Sem essa workaround,
  // o teste 5 (edit + save) falha por motivo alheio ao commit atual.
  const deadline = new Date(d.getTime() - 60 * 60 * 1000);
  const dtDeadline = deadline.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T').slice(0, 16);
  await page.locator('input[type="datetime-local"]').nth(1).fill(dtDeadline);

  // Fluxo strokes+individual exige >=1 categoria (Dashboard.js:242). Clica na
  // "Masculino Gross (M0)" que e' a primeira do TOURNAMENT_CATEGORIES.
  await page.getByText('Masculino Gross (M0)').first().click();
}

async function pickCourseName() {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute('SELECT name FROM courses WHERE club_id=1 LIMIT 1');
    if (!rows.length) throw new Error('nenhum course no clube 1');
    return rows[0].name;
  } finally { await conn.end(); }
}

async function getLastTournamentByName(name) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    const [rows] = await conn.execute(
      'SELECT id, name, ask_handicap FROM tournaments WHERE name=? ORDER BY id DESC LIMIT 1',
      [name]
    );
    return rows[0] || null;
  } finally { await conn.end(); }
}

async function deleteTournamentById(id) {
  const conn = await mysql.createConnection(DB_CFG);
  try {
    await conn.execute('DELETE FROM tournament_categories WHERE tournament_id=?', [id]);
    await conn.execute('DELETE FROM tournament_rounds WHERE tournament_id=?', [id]);
    await conn.execute('DELETE FROM tournaments WHERE id=?', [id]);
  } finally { await conn.end(); }
}

// Devolve rgb() do background de um botao localizado por label parcial.
async function btnBg(page, textRegex) {
  return page.getByRole('button', { name: textRegex }).first()
    .evaluate(el => getComputedStyle(el).backgroundColor).catch(() => 'N/A');
}

const ACCENT = 'rgb(34, 197, 94)'; // theme.accent = #22c55e

(async () => {
  await ensureAdmin();
  const courseName = await pickCourseName();
  console.log(`admin seedado, course label esperado: "${courseName}"`);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`[dialog] ${d.message()}`); await d.accept(); });

  const shot = async (label) => {
    const file = path.join(OUT, `verify-ask-handicap-dashboard__${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
  };

  const createdIds = [];
  try {
    // 1) Login + Dashboard
    console.log('\n== 1. dashboard: nova secao HANDICAP renderiza + default "Pedir" ativo ==');
    await login(page);
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Aceita cookies pra tirar o banner de LGPD da frente da secao HANDICAP
    // (afeta so a screenshot; bg dos botoes ja e' verificado programaticamente).
    await page.getByRole('button', { name: /Entendido e Aceito/i }).click().catch(() => {});
    await page.waitForTimeout(300);
    await shot('01-dashboard-default');

    const btnPedir = await btnBg(page, /^Pedir handicap/i);
    const btnNao = await btnBg(page, /Nao pedir handicap/i);
    console.log(`toggle HANDICAP bg — Pedir: ${btnPedir} | Nao pedir: ${btnNao}`);
    if (btnPedir === 'N/A') fail('Botao "Pedir handicap" nao encontrado');
    else if (btnPedir !== ACCENT) fail(`"Pedir handicap" deveria estar ATIVO (bg accent), veio ${btnPedir}`);
    else pass('Dashboard toggle HANDICAP default "Pedir handicap" ativo');

    // 2) Criar torneio SEM tocar no toggle → banco=1
    console.log('\n== 2. criar torneio sem tocar → banco ask_handicap=1 ==');
    const name1 = `Verify HandicapDefault ${Date.now()}`;
    await fillNewTournamentForm(page, name1, 0, courseName);
    await page.getByRole('button', { name: /^(PUBLICAR TORNEIO|SALVAR ALTERA)/i }).click();
    await page.waitForTimeout(1500);
    const t1 = await getLastTournamentByName(name1);
    if (!t1) fail(`torneio "${name1}" nao aparece no banco`);
    else {
      createdIds.push(t1.id);
      if (Number(t1.ask_handicap) !== 1) fail(`ask_handicap esperado 1, veio ${t1.ask_handicap}`);
      else pass(`torneio criado sem tocar toggle → banco ask_handicap=1 (id=${t1.id})`);
    }

    // 3) Criar torneio clicando "Nao pedir handicap" → banco=0
    console.log('\n== 3. criar torneio marcando "Nao pedir" → banco ask_handicap=0 ==');
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const name2 = `Verify HandicapOff ${Date.now()}`;
    await fillNewTournamentForm(page, name2, 1, courseName);
    await page.getByRole('button', { name: /Nao pedir handicap/i }).click();
    await page.waitForTimeout(300);
    await shot('02-dashboard-nao-pedir-selecionado');
    const btnNao2 = await btnBg(page, /Nao pedir handicap/i);
    if (btnNao2 !== ACCENT) fail(`apos click, "Nao pedir" deveria estar ATIVO, bg=${btnNao2}`);
    else pass('click em "Nao pedir handicap" ativou o botao (bg accent)');
    await page.getByRole('button', { name: /^(PUBLICAR TORNEIO|SALVAR ALTERA)/i }).click();
    await page.waitForTimeout(1500);
    const t2 = await getLastTournamentByName(name2);
    if (!t2) fail(`torneio "${name2}" nao aparece no banco`);
    else {
      createdIds.push(t2.id);
      if (Number(t2.ask_handicap) !== 0) fail(`ask_handicap esperado 0, veio ${t2.ask_handicap}`);
      else pass(`torneio criado com "Nao pedir" → banco ask_handicap=0 (id=${t2.id})`);
    }

    // 4) Editar torneio 2 → toggle hidrata "Nao pedir" ativo
    if (t2) {
      console.log('\n== 4. editar torneio 2 → toggle hidrata "Nao pedir" ativo ==');
      await page.goto('http://localhost:3000/dashboard');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // Escopa o EDITAR no MESMO card que contem o nome do torneio (evita
      // pegar o EDITAR de outro torneio da lista). Usa xpath pra subir ate o
      // ancestor-div que abriga TAMBEM um botao EDITAR (o tournamentItem).
      const btnLoc = page.locator(
        `xpath=//*[contains(normalize-space(text()), "${name2}")]/ancestor::div[.//button[normalize-space(text())="EDITAR"]][1]//button[normalize-space(text())="EDITAR"]`
      ).first();
      await btnLoc.click();
      await page.waitForTimeout(1500);
      await shot('03-editando-torneio-nao-pedir');
      const btnNaoEdit = await btnBg(page, /Nao pedir handicap/i);
      console.log(`editando → "Nao pedir" bg=${btnNaoEdit}`);
      if (btnNaoEdit !== ACCENT) fail(`hidratacao errada: esperava "Nao pedir" ativo, bg=${btnNaoEdit}`);
      else pass('edit hidratou toggle "Nao pedir handicap" ativo');

      // 5) Trocar pra "Pedir" e salvar → banco vai pra 1
      console.log('\n== 5. troca pra "Pedir handicap", salva → banco=1 ==');
      await page.getByRole('button', { name: /^Pedir handicap/i }).click();
      await page.waitForTimeout(200);
      // Categoria ja hidratada pelo edit — nao precisa clicar de novo.
      await page.getByRole('button', { name: /^(PUBLICAR TORNEIO|SALVAR ALTERA)/i }).click();
      await page.waitForTimeout(1500);
      const t2b = await getLastTournamentByName(name2);
      if (!t2b) fail(`re-fetch de "${name2}" falhou`);
      else if (Number(t2b.ask_handicap) !== 1) fail(`apos edit, ask_handicap esperado 1, veio ${t2b.ask_handicap}`);
      else pass('edit trocou ask_handicap 0 → 1 corretamente');
    }
  } finally {
    console.log('\n== cleanup ==');
    for (const id of createdIds) {
      try { await deleteTournamentById(id); console.log(`deletado id=${id}`); } catch (e) { console.log(`X delete id=${id}:`, e.message); }
    }
    await browser.close();
  }

  console.log('\n== RESULTADO ==');
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures} falhas)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
