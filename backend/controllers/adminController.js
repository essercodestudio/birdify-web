// backend/controllers/adminController.js
const db = require("../db");

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
      db.query(
        `SELECT COUNT(*) AS n FROM tournaments
          WHERE club_id = ?
            AND YEAR(start_date)  = YEAR(NOW())
            AND MONTH(start_date) = MONTH(NOW())`,
        [cid]
      ),

      // 3. Torneios futuros ativos
      db.query(
        `SELECT COUNT(*) AS n FROM tournaments
          WHERE club_id = ? AND start_date > NOW() AND status = 'ativo'`,
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

    if (req.user.role !== "ADMIN" || !clubId) {
      return res.json({ isAdminOfCurrentClub: false, club: clubInfo });
    }

    const [rows] = await db.query(
      "SELECT 1 FROM club_admins WHERE user_id = ? AND club_id = ? LIMIT 1",
      [req.user.id, clubId]
    );
    return res.json({
      isAdminOfCurrentClub: rows.length > 0,
      club: clubInfo,
    });
  } catch (error) {
    console.error("Erro em GET /admin/me:", error);
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
      `SELECT COUNT(*) AS n FROM tournaments WHERE club_id = ?`,
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
