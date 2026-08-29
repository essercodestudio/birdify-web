// backend/controllers/adminController.js
const db = require("../db");
const ExcelJS = require("exceljs");

// Validador simples de cor hex (#RGB ou #RRGGBB)
const isHex = (s) => typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
// Validador de logo_url — aceita URLs http(s) ou caminhos relativos /uploads/...
const isSafeUrl = (s) => typeof s === "string" && (s === "" || /^(https?:\/\/|\/)/.test(s));

// GET /api/admin/dashboard
// Retorna KPIs consolidados do clube atual (req.club.id).
// Todas as queries filtram por club_id — nunca mistura dados entre clubes.
exports.getDashboardKPIs = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const [
      [ativosRows],
      [torneiosMesRows],
      [torneiosFuturosRows],
      [treinosMesRows],
      [receitaMesRows],
      [socioTotalRows],
      [topPlayersRows],
      [buracosDifRows],
    ] = await Promise.all([
      // 1. Sócios ativos (jogaram treino ou torneio nos últimos 30 dias)
      db.query(
        `SELECT COUNT(DISTINCT user_id) AS n FROM (
           SELECT DISTINCT i.user_id
             FROM inscriptions i
             JOIN tournaments t ON i.tournament_id = t.id
            WHERE t.club_id = ? AND t.start_date >= (NOW() - INTERVAL 30 DAY)
           UNION
           SELECT DISTINCT tp.user_id
             FROM training_participants tp
             JOIN training_groups tg ON tp.group_id = tg.id
            WHERE tg.club_id = ? AND tg.created_at >= (NOW() - INTERVAL 30 DAY)
         ) x`,
        [cid, cid]
      ),

      // 2. Torneios criados no mês corrente
      // Filtro NOT REGEXP: exclui fantasmas "Treino AAAA-MM-DD" gerados pelo cron
      // antigo (removido no Item 3). Sem o filtro, KPI infla com dados sujos.
      db.query(
        `SELECT COUNT(*) AS n FROM tournaments
          WHERE club_id = ?
            AND name NOT REGEXP '^Treino [0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND YEAR(start_date)  = YEAR(NOW())
            AND MONTH(start_date) = MONTH(NOW())`,
        [cid]
      ),

      // 3. Torneios futuros ativos
      db.query(
        `SELECT COUNT(*) AS n FROM tournaments
          WHERE club_id = ? AND start_date > NOW() AND status = 'ativo'
            AND name NOT REGEXP '^Treino [0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
        [cid]
      ),

      // 4. Treinos do dia nos últimos 30 dias
      db.query(
        `SELECT COUNT(*) AS n FROM training_groups
          WHERE club_id = ? AND created_at >= (NOW() - INTERVAL 30 DAY)`,
        [cid]
      ),

      // 5. Receita estimada do mês (fee × inscrições aprovadas de torneios do mês)
      db.query(
        `SELECT COALESCE(SUM(COALESCE(t.fee, 0)), 0) AS receita
           FROM inscriptions i
           JOIN tournaments t ON i.tournament_id = t.id
          WHERE t.club_id = ?
            AND i.status = 'APPROVED'
            AND YEAR(t.start_date)  = YEAR(NOW())
            AND MONTH(t.start_date) = MONTH(NOW())`,
        [cid]
      ),

      // 6. Total de sócios que já jogaram no clube (histórico)
      db.query(
        `SELECT COUNT(DISTINCT user_id) AS n FROM (
           SELECT DISTINCT i.user_id
             FROM inscriptions i
             JOIN tournaments t ON i.tournament_id = t.id
            WHERE t.club_id = ?
           UNION
           SELECT DISTINCT tp.user_id
             FROM training_participants tp
             JOIN training_groups tg ON tp.group_id = tg.id
            WHERE tg.club_id = ?
         ) x`,
        [cid, cid]
      ),

      // 7. Top 5 jogadores mais engajados (últimos 90 dias) — soma partidas de torneio + treino
      db.query(
        `SELECT u.id, u.name, COUNT(*) AS partidas
           FROM (
             SELECT i.user_id
               FROM inscriptions i
               JOIN tournaments t ON i.tournament_id = t.id
              WHERE t.club_id = ? AND t.start_date >= (NOW() - INTERVAL 90 DAY)
             UNION ALL
             SELECT tp.user_id
               FROM training_participants tp
               JOIN training_groups tg ON tp.group_id = tg.id
              WHERE tg.club_id = ? AND tg.created_at >= (NOW() - INTERVAL 90 DAY)
           ) x
           JOIN users u ON u.id = x.user_id
          GROUP BY u.id, u.name
          ORDER BY partidas DESC
          LIMIT 5`,
        [cid, cid]
      ),

      // 8. Buracos mais difíceis (score médio - par nos últimos torneios do clube)
      // Usa a tabela `scores` de torneio. Se não houver dados, retorna array vazio.
      db.query(
        `SELECT s.hole_number, ROUND(AVG(s.strokes), 2) AS media_tacadas, COUNT(*) AS amostras
           FROM scores s
           JOIN tournaments t ON s.tournament_id = t.id
          WHERE t.club_id = ?
          GROUP BY s.hole_number
          HAVING amostras >= 3
          ORDER BY media_tacadas DESC
          LIMIT 5`,
        [cid]
      ),
    ]);

    res.json({
      club_id: cid,
      updated_at: new Date().toISOString(),
      kpis: {
        socios_ativos_30d: Number(ativosRows[0]?.n || 0),
        socios_total: Number(socioTotalRows[0]?.n || 0),
        torneios_mes: Number(torneiosMesRows[0]?.n || 0),
        torneios_futuros: Number(torneiosFuturosRows[0]?.n || 0),
        treinos_30d: Number(treinosMesRows[0]?.n || 0),
        receita_estimada_mes: Number(receitaMesRows[0]?.receita || 0),
      },
      top_jogadores: topPlayersRows.map((r) => ({
        id: r.id,
        name: r.name,
        partidas: Number(r.partidas),
      })),
      buracos_dificeis: buracosDifRows.map((r) => ({
        hole: Number(r.hole_number),
        media_tacadas: Number(r.media_tacadas),
        amostras: Number(r.amostras),
      })),
    });
  } catch (error) {
    console.error("Erro ao gerar KPIs do dashboard admin:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/admin/me — preflight do frontend pra decidir se renderiza AdminRoute.
// Único endpoint sob /api/admin/ sem requireAdmin (usa requireAuth apenas), porque
// é justamente ele que responde a pergunta "sou admin deste clube?". Nunca dá 403:
// devolve { isAdminOfCurrentClub: false } pra player, admin sem vínculo, ou
// admin cujo req.club nem foi identificado.
exports.getMe = async (req, res) => {
  try {
    const clubId = req.club?.id || null;
    const clubInfo = clubId ? { id: clubId, name: req.club.name } : null;

    // Item 6 (2026-08-28): PLAYER também recebe admin_of=[] pra o front (RootRoute)
    // não ter que fazer branching por role. Só ADMIN chega a ter linhas em club_admins;
    // pra outros roles a query retorna vazio de qualquer forma.
    const [adminRows] = await db.query(
      `SELECT c.id, c.name, c.domain
         FROM club_admins ca
         JOIN clubs c ON c.id = ca.club_id
        WHERE ca.user_id = ?
        ORDER BY c.name ASC`,
      [req.user.id]
    );
    const adminOf = adminRows.map((r) => ({ id: r.id, name: r.name, domain: r.domain }));

    if (req.user.role !== "ADMIN" || !clubId) {
      return res.json({ isAdminOfCurrentClub: false, club: clubInfo, admin_of: adminOf });
    }

    const isAdminOfCurrentClub = adminOf.some((c) => c.id === clubId);
    return res.json({
      isAdminOfCurrentClub,
      club: clubInfo,
      admin_of: adminOf,
    });
  } catch (error) {
    console.error("Erro em GET /admin/me:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/admin/trainings/by-date — Item 1+2 (2026-08-28 tarde): tela
// AdminTrainings agrupa treinos por DIA (não por criador). 1 linha por
// DATE(created_at) com contagens agregadas. Substitui a aba "Treinos" que
// existia no Dashboard admin — agora essa listagem tem tela propria.
// Ordem: dia mais recente primeiro. Janela padrão 180 dias (?days=N ajusta).
exports.listTrainingsByDate = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 180, 1), 365);

    // GROUP BY e ORDER BY usam a MESMA expressao do SELECT (DATE_FORMAT), senao
    // MySQL 8 em only_full_group_by trata como colunas diferentes.
    const [rows] = await db.query(
      `SELECT
         DATE_FORMAT(tg.created_at, '%Y-%m-%d')                                                 AS date,
         COUNT(DISTINCT tg.id)                                                                  AS groups_count,
         COUNT(DISTINCT tp.user_id)                                                             AS players_count,
         SUM(CASE WHEN tg.status = 'ativo'       THEN 1 ELSE 0 END)                             AS status_ativo,
         SUM(CASE WHEN tg.status = 'aguardando'  THEN 1 ELSE 0 END)                             AS status_aguardando,
         SUM(CASE WHEN tg.status = 'finalizado'  THEN 1 ELSE 0 END)                             AS status_finalizado,
         SUM(CASE WHEN tg.status = 'cancelado'   THEN 1 ELSE 0 END)                             AS status_cancelado,
         -- MIN(tg.created_at) em vez de tg.created_at cru: satisfaz
         -- only_full_group_by (MySQL 8 default). Todas as rows deste grupo
         -- ja compartilham o mesmo DATE(created_at) por conta do GROUP BY
         -- DATE_FORMAT(...), entao MIN devolve um timestamp do mesmo dia.
         -- Bug corrigido 2026-08-29: sem isso a query inteira retorna
         -- ERROR 1055 e o endpoint devolve 500 — UI mostra "nenhum treino".
         (SELECT COUNT(*) FROM training_scores ts
            JOIN training_groups tg2 ON tg2.id = ts.group_id
           WHERE tg2.club_id = ?
             AND DATE(tg2.created_at) = DATE(MIN(tg.created_at)))                               AS scores_recorded,
         GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ' · ')                          AS courses
       FROM training_groups tg
       LEFT JOIN training_participants tp ON tp.group_id = tg.id
       LEFT JOIN courses c ON c.id = tg.course_id
       WHERE tg.club_id = ?
         AND tg.created_at >= (NOW() - INTERVAL ? DAY)
       GROUP BY DATE_FORMAT(tg.created_at, '%Y-%m-%d')
       ORDER BY DATE_FORMAT(tg.created_at, '%Y-%m-%d') DESC`,
      [cid, cid, days]
    );

    res.json(rows.map(r => ({
      date: r.date,
      groups_count: Number(r.groups_count || 0),
      players_count: Number(r.players_count || 0),
      scores_recorded: Number(r.scores_recorded || 0),
      status: {
        ativo:      Number(r.status_ativo || 0),
        aguardando: Number(r.status_aguardando || 0),
        finalizado: Number(r.status_finalizado || 0),
        cancelado:  Number(r.status_cancelado || 0),
      },
      courses: r.courses || "",
    })));
  } catch (error) {
    console.error("Erro ao listar treinos por data:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/admin/trainings/:date/export — Task #7 (2026-08-28 tarde): gera Excel
// com todos os treinos do clube naquele dia. 1 sheet por dia. Colunas Grupo |
// Jogador | HCP | B1-B18 | 1a Volta | 2a Volta | Total | vs Par. Grupos
// separados por linha vazia. Baseado no padrao do exportController mas
// simplificado — treino do dia nao tem categoria/desempate.
exports.exportTrainingsByDate = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      return res.status(400).json({ error: "Data invalida. Use YYYY-MM-DD." });
    }

    // 1. Treinos do dia (todos os cursos)
    const [groups] = await db.execute(
      `SELECT tg.id, tg.group_name, tg.access_code, tg.status, tg.course_id,
              c.name AS course_name
         FROM training_groups tg
         LEFT JOIN courses c ON c.id = tg.course_id
        WHERE tg.club_id = ?
          AND DATE(tg.created_at) = ?
        ORDER BY tg.course_id, tg.group_name, tg.id`,
      [cid, date]
    );

    if (groups.length === 0) {
      return res.status(404).json({ error: "Nenhum treino nessa data." });
    }

    // 2. Pra cada grupo, participantes + scores + pares do curso
    // Faz UMA query grande com todos os group_ids pra minimizar RTT.
    const groupIds = groups.map(g => g.id);
    const placeholders = groupIds.map(() => "?").join(",");

    const [participants] = await db.execute(
      `SELECT tp.group_id, tp.user_id, tp.handicap, u.name
         FROM training_participants tp
         JOIN users u ON u.id = tp.user_id
        WHERE tp.group_id IN (${placeholders})
        ORDER BY tp.group_id, u.name`,
      groupIds
    );

    const [scores] = await db.execute(
      `SELECT ts.group_id, ts.user_id, ts.hole_number, ts.strokes
         FROM training_scores ts
        WHERE ts.group_id IN (${placeholders})`,
      groupIds
    );

    // Pars por curso (pode ter cursos diferentes no mesmo dia — cada grupo usa
    // o seu). COALESCE holes -> course_holes -> 4 (mesmo padrao do ranking).
    const courseIds = [...new Set(groups.map(g => g.course_id).filter(Boolean))];
    const parsByCourse = {};
    for (const cid2 of courseIds) {
      const [rows] = await db.execute(
        `SELECT hole_number, par FROM holes WHERE course_id = ?`, [cid2]
      );
      let arr = rows;
      if (arr.length === 0) {
        const [rows2] = await db.execute(
          `SELECT hole_number, par FROM course_holes WHERE course_id = ?`, [cid2]
        );
        arr = rows2;
      }
      const map = Array(19).fill(4);
      arr.forEach(r => {
        const n = Number(r.hole_number);
        if (n >= 1 && n <= 18) map[n] = Number(r.par) || 4;
      });
      parsByCourse[cid2] = map;
    }

    // Indexa scores {group_id: {user_id: [null, s1, s2, ...s18]}}
    const scoreIdx = {};
    scores.forEach(s => {
      const gid = s.group_id, uid = s.user_id, hn = Number(s.hole_number);
      if (!scoreIdx[gid]) scoreIdx[gid] = {};
      if (!scoreIdx[gid][uid]) scoreIdx[gid][uid] = Array(19).fill(null);
      if (hn >= 1 && hn <= 18) scoreIdx[gid][uid][hn] = Number(s.strokes);
    });

    // Indexa participantes {group_id: [{user_id, name, handicap}...]}
    const partIdx = {};
    participants.forEach(p => {
      if (!partIdx[p.group_id]) partIdx[p.group_id] = [];
      partIdx[p.group_id].push(p);
    });

    // 3. Monta workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Birdify";
    const sheet = workbook.addWorksheet(`Treinos ${date}`);

    sheet.columns = [
      { header: "Grupo",    width: 24 },
      { header: "Campo",    width: 24 },
      { header: "Jogador",  width: 28 },
      { header: "HDC",      width: 6 },
      ...Array.from({ length: 9 }, (_, i) => ({ header: `B${i + 1}`, width: 5 })),
      { header: "1a Volta", width: 10 },
      ...Array.from({ length: 9 }, (_, i) => ({ header: `B${i + 10}`, width: 5 })),
      { header: "2a Volta", width: 10 },
      { header: "GROSS",    width: 8 },
      { header: "NET",      width: 8 },
      { header: "vs Par",   width: 8 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    for (const g of groups) {
      const pars = parsByCourse[g.course_id] || Array(19).fill(4);
      const parOut = pars.slice(1, 10).reduce((a, b) => a + b, 0);
      const parIn = pars.slice(10, 19).reduce((a, b) => a + b, 0);

      // Linha PAR do grupo
      const parRow = sheet.addRow([
        `${g.group_name || `Treino #${g.id}`} (${g.access_code})`,
        g.course_name || "-",
        "PAR",
        "",
        ...pars.slice(1, 10),
        parOut,
        ...pars.slice(10, 19),
        parIn,
        parOut + parIn,
        parOut + parIn,
        0,
      ]);
      parRow.font = { bold: true };
      parRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
      parRow.alignment = { horizontal: "center" };

      const players = partIdx[g.id] || [];
      for (const p of players) {
        const scoresArr = scoreIdx[g.id]?.[p.user_id] || Array(19).fill(null);
        let outSum = 0, inSum = 0;
        for (let i = 1; i <= 9; i++) outSum += Number(scoresArr[i] || 0);
        for (let i = 10; i <= 18; i++) inSum += Number(scoresArr[i] || 0);
        const gross = outSum + inSum;
        const hc = Number(p.handicap || 0);

        sheet.addRow([
          g.group_name || `Treino #${g.id}`,
          g.course_name || "-",
          p.name,
          hc,
          ...scoresArr.slice(1, 10).map(v => v ?? "-"),
          outSum || "-",
          ...scoresArr.slice(10, 19).map(v => v ?? "-"),
          inSum || "-",
          gross || "-",
          gross ? gross - hc : "-",
          gross ? gross - (parOut + parIn) : "-",
        ]).alignment = { horizontal: "center" };
      }

      sheet.addRow([]); // separador visual entre grupos
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="treinos_${date}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Erro ao exportar treinos por data:", error);
    res.status(500).json({ error: "Erro ao gerar Excel." });
  }
};

// GET /api/admin/trainings — lista treinos do clube atual (1 linha por training_group).
// LEGADO: alimentava a aba "Treinos do Dia" no Dashboard admin (Item 2 sessão
// anterior). Mantido pra retrocompatibilidade caso alguma consumer externa
// ainda dependa; a UI oficial agora usa /admin/trainings/by-date (agregado).
exports.listTrainings = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const [rows] = await db.execute(
      `SELECT
         tg.id,
         tg.group_name,
         tg.access_code,
         tg.status,
         tg.starting_hole,
         tg.created_at,
         tg.course_id,
         c.name AS course_name,
         u.name AS creator_name,
         (SELECT COUNT(*) FROM training_participants tp WHERE tp.group_id = tg.id) AS players_count,
         (SELECT COUNT(DISTINCT ts.hole_number) FROM training_scores ts WHERE ts.group_id = tg.id) AS holes_played_total
       FROM training_groups tg
       LEFT JOIN courses c ON c.id = tg.course_id
       LEFT JOIN users   u ON u.id = tg.creator_id
       WHERE tg.club_id = ?
       ORDER BY tg.created_at DESC
       LIMIT 200`,
      [cid]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro ao listar treinos (admin):", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/admin/club — retorna dados editáveis do clube atual
exports.getClub = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const [rows] = await db.execute(
      `SELECT id, name, domain, primary_color, background_color, logo_url
         FROM clubs WHERE id = ?`,
      [cid]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Clube não encontrado." });
    res.json(rows[0]);
  } catch (error) {
    console.error("Erro ao buscar dados do clube:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// PUT /api/admin/club — atualiza identidade visual do clube atual
exports.updateClub = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const { name, primary_color, background_color, logo_url } = req.body || {};

    if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.length > 100)) {
      return res.status(400).json({ error: "Nome inválido (2 a 100 caracteres)." });
    }
    if (primary_color !== undefined && !isHex(primary_color)) {
      return res.status(400).json({ error: "Cor primária inválida (use formato #RRGGBB)." });
    }
    if (background_color !== undefined && background_color !== "" && !isHex(background_color)) {
      return res.status(400).json({ error: "Cor de fundo inválida (use formato #RRGGBB)." });
    }
    if (logo_url !== undefined && !isSafeUrl(logo_url)) {
      return res.status(400).json({ error: "URL de logo inválida." });
    }

    // Monta UPDATE dinâmico com apenas campos enviados
    const fields = [];
    const values = [];
    if (name !== undefined)             { fields.push("name = ?");             values.push(name.trim()); }
    if (primary_color !== undefined)    { fields.push("primary_color = ?");    values.push(primary_color); }
    if (background_color !== undefined) { fields.push("background_color = ?"); values.push(background_color); }
    if (logo_url !== undefined)         { fields.push("logo_url = ?");         values.push(logo_url); }

    if (fields.length === 0) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }

    values.push(cid);
    const [result] = await db.execute(
      `UPDATE clubs SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Clube não encontrado." });
    }

    // Retorna estado atualizado
    const [rows] = await db.execute(
      `SELECT id, name, domain, primary_color, background_color, logo_url
         FROM clubs WHERE id = ?`,
      [cid]
    );
    res.json({ message: "Clube atualizado.", club: rows[0] });
  } catch (error) {
    console.error("Erro ao atualizar clube:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/admin/onboarding — checklist do que falta configurar
exports.getOnboardingChecklist = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const [[club]] = await db.query(
      `SELECT name, primary_color, logo_url FROM clubs WHERE id = ?`,
      [cid]
    );
    const [[{ n: courseCount }]] = await db.query(
      `SELECT COUNT(*) AS n FROM courses WHERE club_id = ?`,
      [cid]
    );
    const [[{ n: tournamentCount }]] = await db.query(
      // Filtro NOT REGEXP: fantasma "Treino AAAA-MM-DD" não conta como "torneio
      // criado" — senão a etapa "Criar primeiro torneio" do onboarding aparece
      // done pra clube que nunca criou nenhum real.
      `SELECT COUNT(*) AS n FROM tournaments
        WHERE club_id = ?
          AND name NOT REGEXP '^Treino [0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
      [cid]
    );
    const [[{ n: playerCount }]] = await db.query(
      `SELECT COUNT(DISTINCT user_id) AS n FROM (
         SELECT i.user_id FROM inscriptions i
           JOIN tournaments t ON i.tournament_id = t.id
          WHERE t.club_id = ?
         UNION
         SELECT tp.user_id FROM training_participants tp
           JOIN training_groups tg ON tp.group_id = tg.id
          WHERE tg.club_id = ?
       ) x`,
      [cid, cid]
    );

    // Config de tee times ativada?
    const [teeRows] = await db.query(
      `SELECT active, whatsapp_number FROM club_tee_settings WHERE club_id = ?`,
      [cid]
    );
    const teeConfigured = teeRows.length > 0 && teeRows[0].active && !!teeRows[0].whatsapp_number;

    const steps = [
      {
        id: "nome",
        label: "Definir nome do clube",
        done: !!(club?.name && club.name !== "Birdify Padrão"),
        link: "/admin/clube",
      },
      {
        id: "cor",
        label: "Escolher cor da marca",
        done: !!(club?.primary_color && club.primary_color !== "#22c55e"),
        link: "/admin/clube",
      },
      {
        id: "logo",
        label: "Enviar logo do clube",
        done: !!(club?.logo_url && club.logo_url.length > 0),
        link: "/admin/clube",
      },
      {
        id: "campo",
        label: "Cadastrar primeiro campo",
        done: courseCount > 0,
        link: "/courses",
      },
      {
        id: "torneio",
        label: "Criar primeiro torneio",
        done: tournamentCount > 0,
        link: "/dashboard",
      },
      {
        id: "tee",
        label: "Configurar reservas de tee time",
        done: teeConfigured,
        link: "/admin/tee-settings",
      },
      {
        id: "socio",
        label: "Primeiro sócio jogou",
        done: playerCount > 0,
        link: "/admin/kpis",
      },
    ];

    const totalSteps = steps.length;
    const completedSteps = steps.filter((s) => s.done).length;
    const percent = Math.round((completedSteps / totalSteps) * 100);

    res.json({
      club_id: cid,
      progress: { completed: completedSteps, total: totalSteps, percent },
      steps,
    });
  } catch (error) {
    console.error("Erro ao gerar checklist de onboarding:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
