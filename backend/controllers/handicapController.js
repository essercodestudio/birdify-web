// backend/controllers/handicapController.js
const db = require("../db");
const whs = require("../services/whsService");

// ─── helpers ──────────────────────────────────────────────────────────

// Busca o tee (color + gender) e retorna {course_rating, slope_rating, course_par}.
// Se não houver cadastro específico, retorna null.
async function getTeeConfig(courseId, teeColor, gender) {
  const [rows] = await db.execute(
    `SELECT course_rating, slope_rating, course_par
       FROM course_tees
      WHERE course_id = ? AND tee_color = ? AND gender = ?
      LIMIT 1`,
    [courseId, teeColor, gender]
  );
  return rows[0] || null;
}

// Cor de tee sugerida por gênero (fallback quando o clube não define)
// Segue a memória de torneios: M usa branco (para categorias mais altas), F usa verde.
function suggestTeeColor(gender) {
  return gender === "F" ? "red" : "white";
}

// Busca os 18 pares (hole_number, par) de um campo.
async function getHolesPar(courseId) {
  const [rows] = await db.execute(
    `SELECT hole_number, par FROM holes WHERE course_id = ? ORDER BY hole_number ASC`,
    [courseId]
  );
  return rows;
}

// Processa 1 rodada (torneio ou treino) para 1 usuário: calcula differential
// e faz UPSERT em handicap_rounds.
// scoresByHole: [{hole_number, strokes}], pars: [{hole_number, par}]
async function processRound({
  clubId, userId, courseId, roundType, roundSourceId, roundDate,
  teeColor, gender, scoresByHole, pars,
}) {
  // Junta scores + par por buraco
  const parMap = new Map(pars.map((p) => [p.hole_number, p.par]));
  const enriched = scoresByHole
    .filter((s) => parMap.has(s.hole_number))
    .map((s) => ({
      hole_number: s.hole_number,
      strokes: Number(s.strokes),
      par: parMap.get(s.hole_number),
    }));

  // Precisa de 18 buracos completos com strokes > 0
  if (enriched.length < 18) return { processed: false, reason: "not_18_holes" };
  if (enriched.some((s) => !s.strokes || s.strokes <= 0)) return { processed: false, reason: "incomplete_scores" };

  const tee = await getTeeConfig(courseId, teeColor, gender);
  if (!tee) return { processed: false, reason: "no_tee_rating" };

  // HI atual (pré-rodada) do usuário nesse clube
  const [uhRows] = await db.execute(
    `SELECT handicap_index FROM user_handicap WHERE user_id = ? AND club_id = ?`,
    [userId, clubId]
  );
  const previousHi = uhRows[0]?.handicap_index != null ? Number(uhRows[0].handicap_index) : null;

  // Course Handicap pré-rodada (usado no Adjusted Gross)
  const ch = whs.courseHandicap(previousHi, tee.slope_rating, tee.course_rating, tee.course_par);

  const gross = enriched.reduce((sum, s) => sum + s.strokes, 0);
  const adjusted = whs.adjustedGrossScore(enriched, ch);
  const differential = whs.scoreDifferential(adjusted, tee.course_rating, tee.slope_rating, 0);

  await db.execute(
    `INSERT INTO handicap_rounds
       (club_id, user_id, course_id, round_date, round_type, round_source_id,
        tee_color, gender, gross_score, adjusted_gross,
        course_rating, slope_rating, course_par, differential, handicap_at_round, is_valid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
        round_date = VALUES(round_date),
        tee_color = VALUES(tee_color),
        gender = VALUES(gender),
        gross_score = VALUES(gross_score),
        adjusted_gross = VALUES(adjusted_gross),
        course_rating = VALUES(course_rating),
        slope_rating = VALUES(slope_rating),
        course_par = VALUES(course_par),
        differential = VALUES(differential),
        handicap_at_round = VALUES(handicap_at_round)`,
    [
      clubId, userId, courseId, roundDate, roundType, roundSourceId,
      teeColor, gender, gross, adjusted,
      tee.course_rating, tee.slope_rating, tee.course_par, differential,
      previousHi,
    ]
  );

  return { processed: true, differential, gross, adjusted };
}

// Recalcula o HI de 1 usuário nesse clube com base nas rodadas em handicap_rounds.
async function recalcUserHandicap(clubId, userId, gender = "M") {
  const [rounds] = await db.execute(
    `SELECT round_date, differential, handicap_at_round
       FROM handicap_rounds
      WHERE user_id = ? AND club_id = ? AND is_valid = 1
      ORDER BY round_date DESC, id DESC
      LIMIT 20`,
    [userId, clubId]
  );

  const profile = whs.calculateHandicapProfile(rounds, gender);

  await db.execute(
    `INSERT INTO user_handicap
       (user_id, club_id, handicap_index, low_handicap_index, rounds_count)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       handicap_index = VALUES(handicap_index),
       low_handicap_index = VALUES(low_handicap_index),
       rounds_count = VALUES(rounds_count)`,
    [userId, clubId, profile.handicap_index, profile.low_handicap_index, profile.rounds_count]
  );

  return profile;
}

// ─── ENDPOINTS ────────────────────────────────────────────────────────

// GET /api/handicap/me
exports.getMyHandicap = async (req, res) => {
  try {
    const cid = req.club?.id;
    const userId = req.user?.id;

    const [[gh]] = await db.query(`SELECT gender FROM users WHERE id = ?`, [userId]);
    const gender = gh?.gender || "M";

    const [uh] = await db.execute(
      `SELECT handicap_index, low_handicap_index, rounds_count, last_calculated_at
         FROM user_handicap WHERE user_id = ? AND club_id = ?`,
      [userId, cid]
    );

    const [rounds] = await db.execute(
      `SELECT hr.id, hr.round_date, hr.round_type, hr.tee_color, hr.gross_score,
              hr.adjusted_gross, hr.course_rating, hr.slope_rating, hr.course_par,
              hr.differential, hr.handicap_at_round,
              c.id AS course_id, c.name AS course_name
         FROM handicap_rounds hr
         JOIN courses c ON hr.course_id = c.id
        WHERE hr.user_id = ? AND hr.club_id = ? AND hr.is_valid = 1
        ORDER BY hr.round_date DESC, hr.id DESC
        LIMIT 20`,
      [userId, cid]
    );

    // Identifica quais rounds ENTRARAM no cálculo (menores differentials)
    const n = rounds.length;
    let countUsed = 0;
    if (n >= 20) countUsed = 8;
    else if (n === 19) countUsed = 7;
    else if (n >= 17) countUsed = 6;
    else if (n >= 15) countUsed = 5;
    else if (n >= 12) countUsed = 4;
    else if (n >= 9)  countUsed = 3;
    else if (n >= 6)  countUsed = 2;
    else if (n >= 3)  countUsed = 1;

    const sortedDiffs = rounds
      .map((r) => Number(r.differential))
      .slice()
      .sort((a, b) => a - b)
      .slice(0, countUsed);
    const usedSet = new Set(sortedDiffs);

    const roundsWithFlag = rounds.map((r) => ({
      ...r,
      differential: Number(r.differential),
      used_in_calc: usedSet.has(Number(r.differential)),
    }));

    res.json({
      user_id: userId,
      gender,
      handicap_index: uh[0]?.handicap_index != null ? Number(uh[0].handicap_index) : null,
      low_handicap_index: uh[0]?.low_handicap_index != null ? Number(uh[0].low_handicap_index) : null,
      rounds_count: uh[0]?.rounds_count ?? rounds.length,
      last_calculated_at: uh[0]?.last_calculated_at || null,
      recent_rounds: roundsWithFlag,
    });
  } catch (error) {
    console.error("Erro getMyHandicap:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/handicap/course-handicap?course_id=X&tee_color=white
exports.getCourseHandicap = async (req, res) => {
  try {
    const cid = req.club?.id;
    const userId = req.user?.id;
    const { course_id, tee_color } = req.query;
    if (!course_id) return res.status(400).json({ error: "course_id obrigatório." });

    const [[gh]] = await db.query(`SELECT gender FROM users WHERE id = ?`, [userId]);
    const gender = gh?.gender || "M";
    const color = tee_color || suggestTeeColor(gender);

    const [uh] = await db.execute(
      `SELECT handicap_index FROM user_handicap WHERE user_id = ? AND club_id = ?`,
      [userId, cid]
    );
    const hi = uh[0]?.handicap_index != null ? Number(uh[0].handicap_index) : null;

    const tee = await getTeeConfig(course_id, color, gender);
    if (!tee) return res.status(404).json({ error: "Tee não cadastrado. Peça ao admin do clube pra cadastrar." });

    const ch = whs.courseHandicap(hi, tee.slope_rating, tee.course_rating, tee.course_par);

    res.json({
      handicap_index: hi,
      course_id: Number(course_id),
      tee_color: color,
      gender,
      course_rating: Number(tee.course_rating),
      slope_rating: Number(tee.slope_rating),
      course_par: Number(tee.course_par),
      course_handicap: ch,
    });
  } catch (error) {
    console.error("Erro getCourseHandicap:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// POST /api/handicap/recalculate-mine — o próprio sócio reprocessa TODAS as rodadas dele
// e recalcula HI. Roda pesado, mas tá limitado ao 1 usuário.
exports.recalculateMine = async (req, res) => {
  try {
    const cid = req.club?.id;
    const userId = req.user?.id;
    const result = await recalculateAllForUser(cid, userId);
    res.json({ message: "Handicap recalculado.", ...result });
  } catch (error) {
    console.error("Erro recalculateMine:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// POST /api/admin/handicap/recalculate-all — admin dispara pra todos os sócios do clube
// Usado quando: mudou CR/SR de tee, importou histórico, ou pra atualização em massa.
exports.recalculateAll = async (req, res) => {
  try {
    const cid = req.club?.id;
    // Pega todos os usuários que já jogaram no clube
    const [users] = await db.query(
      `SELECT DISTINCT user_id FROM (
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

    let processed = 0;
    let failed = 0;
    for (const u of users) {
      try {
        await recalculateAllForUser(cid, u.user_id);
        processed++;
      } catch (e) {
        console.error(`Erro reprocessando user ${u.user_id}:`, e.message);
        failed++;
      }
    }

    res.json({ message: "Recálculo em massa concluído.", processed, failed, total: users.length });
  } catch (error) {
    console.error("Erro recalculateAll:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Função privada: reprocessa todas rodadas válidas do usuário e recalcula HI.
async function recalculateAllForUser(clubId, userId) {
  const [[u]] = await db.query(`SELECT gender FROM users WHERE id = ?`, [userId]);
  const gender = u?.gender || "M";

  // 1. TORNEIOS: para cada torneio 'concluido' onde ele tem 18 scores, processa
  const [tournaments] = await db.query(
    `SELECT t.id AS tournament_id, t.course_id, t.start_date
       FROM tournaments t
       JOIN scores s ON s.tournament_id = t.id AND s.user_id = ?
      WHERE t.club_id = ? AND t.status = 'concluido'
      GROUP BY t.id, t.course_id, t.start_date
      HAVING COUNT(DISTINCT s.hole_number) >= 18`,
    [userId, clubId]
  );
  for (const t of tournaments) {
    const [scores] = await db.execute(
      `SELECT hole_number, strokes FROM scores
        WHERE tournament_id = ? AND user_id = ?
        ORDER BY hole_number ASC`,
      [t.tournament_id, userId]
    );
    const pars = await getHolesPar(t.course_id);
    await processRound({
      clubId, userId, courseId: t.course_id,
      roundType: "tournament", roundSourceId: t.tournament_id,
      roundDate: t.start_date,
      teeColor: suggestTeeColor(gender), gender,
      scoresByHole: scores, pars,
    });
  }

  // 2. TREINOS: grupos 'finalizado' de 18 buracos completos onde ele tem scores
  const [trainings] = await db.query(
    `SELECT tg.id AS group_id, tg.course_id, tg.created_at
       FROM training_groups tg
       JOIN training_scores ts ON ts.group_id = tg.id AND ts.user_id = ?
      WHERE tg.club_id = ? AND tg.status = 'finalizado'
      GROUP BY tg.id, tg.course_id, tg.created_at
      HAVING COUNT(DISTINCT ts.hole_number) >= 18`,
    [userId, clubId]
  );
  for (const g of trainings) {
    const [scores] = await db.execute(
      `SELECT hole_number, strokes FROM training_scores
        WHERE group_id = ? AND user_id = ?
        ORDER BY hole_number ASC`,
      [g.group_id, userId]
    );
    const pars = await getHolesPar(g.course_id);
    await processRound({
      clubId, userId, courseId: g.course_id,
      roundType: "training", roundSourceId: g.group_id,
      roundDate: g.created_at.toISOString().slice(0, 10),
      teeColor: suggestTeeColor(gender), gender,
      scoresByHole: scores, pars,
    });
  }

  return await recalcUserHandicap(clubId, userId, gender);
}

// ─── ADMIN endpoints ──────────────────────────────────────────────────

// GET /api/admin/handicap/list — lista sócios com HI atual
exports.listAllHandicaps = async (req, res) => {
  try {
    const cid = req.club?.id;
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.gender,
              uh.handicap_index, uh.low_handicap_index, uh.rounds_count, uh.last_calculated_at
         FROM user_handicap uh
         JOIN users u ON u.id = uh.user_id
        WHERE uh.club_id = ?
        ORDER BY uh.handicap_index ASC
        LIMIT 500`,
      [cid]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro listAllHandicaps:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// ─── CRUD de course_tees ──────────────────────────────────────────────

// GET /api/admin/course-tees/:courseId — lista tees cadastrados
exports.listCourseTees = async (req, res) => {
  try {
    const cid = req.club?.id;
    const { courseId } = req.params;

    const [[course]] = await db.query(
      `SELECT id FROM courses WHERE id = ? AND club_id = ?`,
      [courseId, cid]
    );
    if (!course) return res.status(404).json({ error: "Campo não encontrado." });

    const [rows] = await db.execute(
      `SELECT id, tee_color, gender, course_rating, slope_rating, course_par
         FROM course_tees WHERE course_id = ? ORDER BY tee_color, gender`,
      [courseId]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro listCourseTees:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// PUT /api/admin/course-tees/:courseId — upsert em lote
// body: { tees: [{ tee_color, gender, course_rating, slope_rating, course_par }] }
exports.saveCourseTees = async (req, res) => {
  try {
    const cid = req.club?.id;
    const { courseId } = req.params;
    const { tees = [] } = req.body || {};

    const [[course]] = await db.query(
      `SELECT id FROM courses WHERE id = ? AND club_id = ?`,
      [courseId, cid]
    );
    if (!course) return res.status(404).json({ error: "Campo não encontrado." });

    const VALID_COLORS = ["white", "black", "blue", "red", "yellow", "green"];
    const VALID_GENDERS = ["M", "F"];

    for (const t of tees) {
      if (!VALID_COLORS.includes(t.tee_color)) {
        return res.status(400).json({ error: `Cor de tee inválida: ${t.tee_color}` });
      }
      if (!VALID_GENDERS.includes(t.gender)) {
        return res.status(400).json({ error: `Gênero inválido: ${t.gender}` });
      }
      const cr = Number(t.course_rating);
      const sr = Number(t.slope_rating);
      const par = Number(t.course_par || 72);
      if (!(cr > 55 && cr < 85)) {
        return res.status(400).json({ error: `Course Rating fora do intervalo (55-85): ${t.course_rating}` });
      }
      if (!(sr >= 55 && sr <= 155)) {
        return res.status(400).json({ error: `Slope Rating fora do intervalo (55-155): ${t.slope_rating}` });
      }
      if (!(par >= 60 && par <= 80)) {
        return res.status(400).json({ error: `Par do campo fora do intervalo (60-80): ${t.course_par}` });
      }

      await db.execute(
        `INSERT INTO course_tees (course_id, tee_color, gender, course_rating, slope_rating, course_par)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            course_rating = VALUES(course_rating),
            slope_rating = VALUES(slope_rating),
            course_par = VALUES(course_par)`,
        [courseId, t.tee_color, t.gender, cr, sr, par]
      );
    }

    const [saved] = await db.execute(
      `SELECT id, tee_color, gender, course_rating, slope_rating, course_par
         FROM course_tees WHERE course_id = ? ORDER BY tee_color, gender`,
      [courseId]
    );
    res.json({ message: "Tees salvos.", tees: saved });
  } catch (error) {
    console.error("Erro saveCourseTees:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// DELETE /api/admin/course-tees/:id
exports.deleteCourseTee = async (req, res) => {
  try {
    const cid = req.club?.id;
    const { id } = req.params;
    const [[row]] = await db.query(
      `SELECT ct.id
         FROM course_tees ct
         JOIN courses c ON ct.course_id = c.id
        WHERE ct.id = ? AND c.club_id = ?`,
      [id, cid]
    );
    if (!row) return res.status(404).json({ error: "Tee não encontrado." });

    await db.execute(`DELETE FROM course_tees WHERE id = ?`, [id]);
    res.json({ message: "Tee removido.", id: Number(id) });
  } catch (error) {
    console.error("Erro deleteCourseTee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
