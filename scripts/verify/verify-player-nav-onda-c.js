// Verificacao runtime do fluxo bottom-nav do jogador (Onda C).
//
// Escopo (regressao para a Onda C — Fases C.1..C.6):
//   C.1. Bottom nav aparece com 4 abas (Inicio/Torneios/Rankings/Mais)
//        pra jogador; NAO aparece pra admin em /dashboard.
//   C.2. Aba MAIS lista Meu Perfil, Historico, Meu Desempenho, Sair.
//        Clique em Meu Perfil abre modal.
//   C.3. Aba RANKINGS lista os circuitos do clube atual (multi-tenant
//        via req.club.id no backend). Clique navega pra /ranking/:id.
//   C.4. Aba TORNEIOS lista os torneios com tabs Abertos/Concluidos.
//        Clique num aberto navega pra /torneios/:id.
//   C.5. Admin no Dashboard tem a secao 5 "CONTEUDO DO EVENTO" com
//        upload de capa (so em edicao) + 5 textareas.
//   C.6. TournamentDetail rico: torneio COM capa/conteudo mostra hero +
//        4 accordions expansiveis; torneio LEGADO (sem C.5 fields)
//        mostra "SEM CAPA" e ZERO accordions (fallback silencioso).
//
// Requisitos: backend 3001 + frontend CRA 3000 + banco dev.
// Este script cria os proprios dados (torneio rich + legacy) via API e
// limpa no final (DELETE + remove arquivo do disco LOCAL).
//
// Como rodar:
//   cd scripts/verify && node verify-player-nav-onda-c.js

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const DB_CFG = {
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
};
const BASE = 'http://localhost:3000';
const API = 'http://localhost:3001/api';
const PLAYER = { email: 'verify.player@test.local', password: 'verify123' };
const ADMIN  = { email: 'verify.admin@test.local',  password: 'verify123' };
const OUT = __dirname;

let failures = 0;
const rec = (name, ok, extra = '') => {
  if (ok) { console.log(`PASS — ${name}`); }
  else { console.log(`FAIL — ${name}${extra ? ' · ' + extra : ''}`); failures++; }
};

async function seedUsers(conn) {
  // Cria (ou atualiza senha de) verify.player + verify.admin do clube 1.
  // Mesmo padrao dos outros verify-*.js — idempotente.
  const hash = bcrypt.hashSync(PLAYER.password, 10);
  for (const [email, role] of [[PLAYER.email, 'PLAYER'], [ADMIN.email, 'ADMIN']]) {
    const [rows] = await conn.execute('SELECT id FROM users WHERE email=?', [email]);
    if (rows.length === 0) {
      await conn.execute(
        'INSERT INTO users (name, email, password_hash, role, club_id) VALUES (?,?,?,?,1)',
        [`Verify ${role}`, email, hash, role],
      );
    } else {
      await conn.execute('UPDATE users SET password_hash=? WHERE email=?', [hash, email]);
    }
  }
  const [[admin]] = await conn.execute('SELECT id FROM users WHERE email=?', [ADMIN.email]);
  const [ca] = await conn.execute(
    'SELECT 1 FROM club_admins WHERE user_id=? AND club_id=1 LIMIT 1', [admin.id]);
  if (ca.length === 0) {
    await conn.execute('INSERT INTO club_admins (user_id, club_id) VALUES (?,1)', [admin.id]);
  }
}

async function apiLogin(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).token;
}

async function dismissLGPD(page) {
  const btn = page.getByRole('button', { name: /entendido e aceito/i });
  if ((await btn.count()) > 0) { try { await btn.first().click({ timeout: 2000 }); } catch (_) {} }
}
async function loginUI(page, creds) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await dismissLGPD(page);
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').fill(creds.password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForLoadState('networkidle');
  await dismissLGPD(page);
}

async function waitActiveTab(page, expectedHref) {
  try {
    await page.waitForFunction((href) => {
      const el = document.querySelector('nav[aria-label="Navegação do jogador"] a[aria-current="page"]');
      return el && el.getAttribute('href') === href;
    }, expectedHref, { timeout: 3000 });
    return true;
  } catch (_) { return false; }
}

(async () => {
  let conn;
  const created = [];
  const coverFiles = [];
  try {
    conn = await mysql.createConnection(DB_CFG);
    await seedUsers(conn);

    const adminToken = await apiLogin(ADMIN.email, ADMIN.password);
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const deadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');

    // Torneio RICH (com todos os campos C.5 + capa) e LEGACY (so description)
    const mkBody = (name, extras = {}) => JSON.stringify({
      name, start_date: future, course_id: 10, format: 'shotgun',
      categories: ['M1'], sponsors: [], ...extras,
    });
    const uniq = 'OC-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const richBody = mkBody(`Verify OndaC RICH ${uniq}`, {
      description: 'desc legada',
      event_summary: 'Verify OndaC: summary rico',
      info_content: 'Verify OndaC: info body',
      schedule_content: 'Verify OndaC: programacao',
      prizes_content: 'Verify OndaC: premiacao',
      rules_content: 'Verify OndaC: regulamento',
      registration_deadline: deadline,
      fee: 'R$ 200,00', payment_info: 'pix@t.c', pix_key_type: 'E-mail',
      whatsapp_contact: '5511999998888',
    });
    const legacyBody = mkBody(`Verify OndaC LEGACY ${uniq}`, { description: 'desc legada apenas' });

    const rich = await (await fetch(`${API}/tournaments/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: richBody,
    })).json();
    const legacy = await (await fetch(`${API}/tournaments/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: legacyBody,
    })).json();
    if (!rich.id || !legacy.id) throw new Error(`create falhou rich=${JSON.stringify(rich)} legacy=${JSON.stringify(legacy)}`);
    created.push(rich.id, legacy.id);

    // Cria JPEG minimo + upload de capa no RICH
    const coverSrc = path.join(OUT, 'verify-player-nav-onda-c-cover.jpg');
    fs.writeFileSync(coverSrc, Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z',
      'base64'));
    const coverWin = execSync(`cygpath -w "${coverSrc}"`).toString().trim();
    execSync(`curl -s -X POST "${API}/tournaments/${rich.id}/cover" -H "Authorization: Bearer ${adminToken}" -F "cover=@${coverWin};type=image/jpeg"`, { stdio: 'pipe' });
    coverFiles.push(path.join(__dirname, '..', '..', 'backend', 'public', 'uploads', 'tournaments', '1', `${rich.id}.jpg`));

    // ─── Browser ─────────────────────────────────────────────────
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

    // ═══ Player: bottom nav ═══
    await loginUI(page, PLAYER);
    await page.waitForURL(`${BASE}/`, { timeout: 10000 });
    await page.waitForSelector('nav[aria-label="Navegação do jogador"]', { timeout: 5000 });

    const abas = await page.locator('nav[aria-label="Navegação do jogador"] a').count();
    rec('C.1 bottom nav com 4 abas', abas === 4, `count=${abas}`);
    rec('C.1 aba Início ativa em /', await waitActiveTab(page, '/'));

    // ═══ C.4 Aba Torneios ═══
    await page.locator('nav[aria-label="Navegação do jogador"] a', { hasText: 'Torneios' }).click();
    await page.waitForURL(`${BASE}/torneios`);
    rec('C.4 aba Torneios ativa', await waitActiveTab(page, '/torneios'));
    rec('C.4 tabs Abertos/Concluídos visíveis',
      (await page.getByRole('button', { name: /^abertos$/i }).count()) >= 1);

    // ═══ C.6 Torneio RICH (com capa/conteúdo) ═══
    await page.goto(`${BASE}/torneios/${rich.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    rec('C.6 RICH hero com <img> capa', (await page.locator('img[alt="Capa do torneio"]').count()) === 1);
    rec('C.6 RICH event_summary aparece', (await page.getByText(/summary rico/).count()) >= 1);
    rec('C.6 RICH 4 accordions renderizam',
      (await page.getByRole('button', { name: /informações do torneio/i }).count())
      + (await page.getByRole('button', { name: /programação/i }).count())
      + (await page.getByRole('button', { name: /premiação/i }).count())
      + (await page.getByRole('button', { name: /regulamento/i }).count()) === 4);
    await page.getByRole('button', { name: /informações do torneio/i }).click();
    await page.waitForTimeout(300);
    rec('C.6 RICH accordion expande e mostra conteúdo',
      (await page.getByText(/info body/).count()) === 1);
    await page.screenshot({ path: path.join(OUT, 'verify-player-nav-onda-c__01-detail-rich.png') });

    // ═══ C.6 Torneio LEGACY (fallback) ═══
    await page.goto(`${BASE}/torneios/${legacy.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    rec('C.6 LEGACY placeholder "SEM CAPA"', (await page.getByText(/^SEM CAPA$/).count()) === 1);
    rec('C.6 LEGACY fallback pra description', (await page.getByText(/desc legada apenas/).count()) >= 1);
    rec('C.6 LEGACY zero accordions',
      (await page.getByRole('button', { name: /informações do torneio/i }).count())
      + (await page.getByRole('button', { name: /programação/i }).count())
      + (await page.getByRole('button', { name: /premiação/i }).count())
      + (await page.getByRole('button', { name: /regulamento/i }).count()) === 0);

    // ═══ C.4 Voltar pra Torneios via botão ═══
    await page.getByRole('button', { name: /voltar/i }).click();
    await page.waitForURL(`${BASE}/torneios`);
    rec('C.4 botão Voltar navega /torneios', page.url().endsWith('/torneios'));

    // ═══ C.3 Aba Rankings ═══
    await page.locator('nav[aria-label="Navegação do jogador"] a', { hasText: 'Rankings' }).click();
    await page.waitForURL(`${BASE}/rankings`);
    rec('C.3 aba Rankings ativa', await waitActiveTab(page, '/rankings'));
    rec('C.3 título "Rankings" visível', (await page.locator('h1', { hasText: /^rankings$/i }).count()) === 1);
    await page.screenshot({ path: path.join(OUT, 'verify-player-nav-onda-c__02-rankings.png') });

    // ═══ C.2 Aba Mais ═══
    await page.locator('nav[aria-label="Navegação do jogador"] a', { hasText: 'Mais' }).click();
    await page.waitForURL(`${BASE}/mais`);
    rec('C.2 aba Mais ativa', await waitActiveTab(page, '/mais'));
    rec('C.2 Meu Perfil visível', (await page.getByRole('button', { name: /meu perfil/i }).count()) >= 1);
    rec('C.2 Sair da Conta visível', (await page.getByRole('button', { name: /sair da conta/i }).count()) >= 1);
    await page.getByRole('button', { name: /meu perfil/i }).first().click();
    await page.waitForTimeout(400);
    rec('C.2 clique Meu Perfil abre modal', (await page.locator('h2', { hasText: /^meu perfil$/i }).count()) >= 1);
    await page.screenshot({ path: path.join(OUT, 'verify-player-nav-onda-c__03-mais.png') });

    // ═══ C.1 Admin em /dashboard: nav NÃO aparece ═══
    await ctx.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await loginUI(page, ADMIN);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    rec('C.1 admin em /dashboard: bottom nav do jogador NÃO aparece',
      (await page.locator('nav[aria-label="Navegação do jogador"]').count()) === 0);

    // ═══ C.5 Dashboard admin: seção 5 "CONTEÚDO DO EVENTO" ═══
    // Dashboard tem várias seções — precisa aguardar render completo do form.
    await page.waitForTimeout(1000);
    // "CONTEÚDO" tem 'Ú' — escapado com \S ao invés de "." pra evitar
    // ambiguidade (o . matcha qualquer char, inclusive espaço, o que
    // funciona; mas \S é mais explícito).
    const sec5 = await page.locator('div', { hasText: /5\.\s+CONTE\S+DO DO EVENTO/i }).count();
    rec('C.5 Dashboard: seção "5. CONTEÚDO DO EVENTO" presente', sec5 >= 1, `count=${sec5}`);

    await browser.close();
  } catch (e) {
    console.log('FATAL:', e.message);
    console.log(e.stack);
    failures++;
  } finally {
    // Cleanup LOCAL: DELETE torneios + remove arquivos
    try {
      const adminToken = await apiLogin(ADMIN.email, ADMIN.password);
      for (const id of created) {
        await fetch(`${API}/tournaments/delete/${id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
      for (const f of coverFiles) { if (fs.existsSync(f)) fs.unlinkSync(f); }
      const src = path.join(OUT, 'verify-player-nav-onda-c-cover.jpg');
      if (fs.existsSync(src)) fs.unlinkSync(src);
    } catch (e) { console.log('Cleanup failed:', e.message); }
    if (conn) await conn.end();

    console.log(`\n===== ${failures === 0 ? 'OK' : 'FAILURES=' + failures} =====`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
