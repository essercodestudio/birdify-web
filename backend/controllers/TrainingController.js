const db = require("../db");

function generateCode(len = 5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < len; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const clubId = (req) => req.club?.id || 1;

async function userAlreadyInGroup(userId, cid) {
  const [[{ cnt }]] = await db.execute(
    `SELECT COUNT(*) AS cnt
     FROM training_groups tg
     JOIN training_participants tp ON tp.group_id = tg.id
     WHERE tp.user_id = ? AND tg.club_id = ?
       AND DATE(tg.created_at) = CURDATE()
       AND tg.status IN ('aguardando', 'ativo')`,
    [userId, cid],
  );
  return cnt > 0;
}

exports.createTable = async (req, res) => {
  try {
    const { creator_id, course_id, starting_hole } = req.body;
    const cid = clubId(req);

    if (await userAlreadyInGroup(creator_id, cid))
      return res
        .status(409)
        .json({ message: "Você já está em um treino em andamento." });

    const [[course]] = await db.execute(
      "SELECT name FROM courses WHERE id = ?",
      [course_id],
    );
    const courseName = course?.name || "Campo";
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const group_name = `Treino ${courseName} - ${dd}/${mm}/${yyyy}`;

    const access_code = generateCode();
    const [result] = await db.execute(
      `INSERT INTO training_groups (club_id, creator_id, course_id, group_name, access_code, starting_hole, status)
       VALUES (?, ?, ?, ?, ?, ?, 'aguardando')`,
      [cid, creator_id, course_id, group_name, access_code, starting_hole || 1],
    );

    const groupId = result.insertId;
    await db.execute(
      "INSERT INTO training_participants (group_id, user_id) VALUES (?, ?)",
      [groupId, creator_id],
    );

    res.json({
      groupId,
      access_code,
      group_name,
      starting_hole: starting_hole || 1,
      course_id,
      creator_id,
    });
  } catch (error) {
    console.error("Erro ao criar mesa de treino:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.joinTable = async (req, res) => {
  try {
    const { access_code, user_id } = req.body;
    const cid = clubId(req);
    const cleanCode = (access_code || "").trim().toUpperCase();

    const [groups] = await db.execute(
      `SELECT * FROM training_groups WHERE access_code = ? AND club_id = ?`,
      [cleanCode, cid],
    );

    if (groups.length === 0)
      return res.status(404).json({ message: "Código inválido." });
    if (groups[0].status === "ativo")
      return res
        .status(403)
        .json({ message: "O treino já começou. A sala está trancada." });
    if (groups[0].status === "finalizado")
      return res
        .status(403)
        .json({ message: "Este treino já foi finalizado." });
    if (groups[0].status === "cancelado")
      return res.status(403).json({ message: "Este treino foi cancelado." });

    const group = groups[0];

    const [existing] = await db.execute(
      "SELECT * FROM training_participants WHERE group_id = ? AND user_id = ?",
      [group.id, user_id],
    );

    if (existing.length === 0) {
      if (await userAlreadyInGroup(user_id, cid))
        return res
          .status(409)
          .json({ message: "Você já está em um treino em andamento." });

      const [[{ cnt }]] = await db.execute(
        "SELECT COUNT(*) AS cnt FROM training_participants WHERE group_id = ?",
        [group.id],
      );
      if (cnt >= 4)
        return res
          .status(400)
          .json({ message: "Mesa lotada! Máximo de 4 jogadores." });

      await db.execute(
        "INSERT INTO training_participants (group_id, user_id) VALUES (?, ?)",
        [group.id, user_id],
      );
    }

    res.json({ table: group });
  } catch (error) {
    console.error("Erro ao entrar na mesa:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.leaveGroup = async (req, res) => {
  try {
    const { group_id, user_id } = req.body;

    const [groups] = await db.execute(
      "SELECT creator_id, status FROM training_groups WHERE id = ? AND club_id = ?",
      [group_id, clubId(req)],
    );

    if (groups.length === 0)
      return res.status(404).json({ message: "Grupo não encontrado." });
    if (groups[0].creator_id === user_id)
      return res
        .status(403)
        .json({ message: "O criador não pode sair. Use Excluir Treino." });
    if (groups[0].status !== "aguardando")
      return res
        .status(403)
        .json({ message: "Não é possível sair de um treino em andamento." });

    await db.execute(
      "DELETE FROM training_participants WHERE group_id = ? AND user_id = ?",
      [group_id, user_id],
    );

    res.json({ message: "Saiu do grupo." });
  } catch (error) {
    console.error("Erro ao sair do grupo:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    const { group_id, creator_id } = req.body;

    const [result] = await db.execute(
      `UPDATE training_groups SET status = 'cancelado'
       WHERE id = ? AND creator_id = ? AND club_id = ? AND status = 'aguardando'`,
      [group_id, creator_id, clubId(req)],
    );

    if (result.affectedRows === 0)
      return res
        .status(403)
        .json({ message: "Acesso negado ou treino já iniciado." });

    res.json({ message: "Treino cancelado." });
  } catch (error) {
    console.error("Erro ao excluir treino:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getTableDetails = async (req, res) => {
  try {
    const { groupId } = req.params;

    const [groups] = await db.execute(
      "SELECT * FROM training_groups WHERE id = ? AND club_id = ?",
      [groupId, clubId(req)],
    );

    if (groups.length === 0)
      return res.status(404).json({ message: "Mesa não encontrada." });

    const [participants] = await db.execute(
      `SELECT u.id, u.name, u.gender, COALESCE(tp.handicap, 0) AS handicap
       FROM training_participants tp
       JOIN users u ON tp.user_id = u.id
       WHERE tp.group_id = ?
       ORDER BY tp.joined_at ASC`,
      [groupId],
    );

    res.json({ ...groups[0], players: participants });
  } catch (error) {
    console.error("Erro ao buscar mesa:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.saveScore = async (req, res) => {
  try {
    const { group_id, user_id, hole_number, strokes } = req.body;

    if (!group_id || !user_id || !hole_number || strokes === undefined)
      return res.status(400).json({ error: "Dados incompletos." });

    await db.execute(
      "DELETE FROM training_scores WHERE group_id = ? AND user_id = ? AND hole_number = ?",
      [group_id, user_id, hole_number],
    );
    await db.execute(
      "INSERT INTO training_scores (group_id, user_id, hole_number, strokes) VALUES (?, ?, ?, ?)",
      [group_id, user_id, hole_number, strokes],
    );

    res.json({ message: "Score salvo!", strokes, hole: hole_number });
  } catch (error) {
    console.error("Erro ao salvar score de treino:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getScores = async (req, res) => {
  try {
    const { groupId } = req.params;
    const [results] = await db.execute(
      "SELECT user_id, hole_number, strokes FROM training_scores WHERE group_id = ?",
      [groupId],
    );
    res.json(results);
  } catch (error) {
    console.error("Erro ao buscar scores de treino:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.startTraining = async (req, res) => {
  try {
    const { group_id } = req.body;

    const [result] = await db.execute(
      `UPDATE training_groups SET status = 'ativo'
       WHERE id = ? AND club_id = ? AND status = 'aguardando'`,
      [group_id, clubId(req)],
    );

    if (result.affectedRows === 0)
      return res
        .status(400)
        .json({ message: "Grupo não encontrado ou treino já iniciado." });

    res.json({ message: "Treino iniciado!" });
  } catch (error) {
    console.error("Erro ao iniciar treino:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.finishTraining = async (req, res) => {
  try {
    const { group_id, creator_id } = req.body;

    // Verifica se quem está finalizando é realmente o criador
    const whereCreator = creator_id ? "AND creator_id = ?" : "";
    const params = creator_id
      ? [group_id, clubId(req), creator_id]
      : [group_id, clubId(req)];

    const [result] = await db.execute(
      `UPDATE training_groups SET status = 'finalizado'
       WHERE id = ? AND club_id = ? ${whereCreator}`,
      params,
    );

    if (result.affectedRows === 0)
      return res
        .status(403)
        .json({ message: "Acesso negado ou treino não encontrado." });

    res.json({ message: "Treino finalizado!" });
  } catch (error) {
    console.error("Erro ao finalizar treino:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getCurrentGroup = async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.json({ group_id: null });

    const [rows] = await db.execute(
      `SELECT tg.id AS group_id, tg.status
       FROM training_groups tg
       JOIN training_participants tp ON tp.group_id = tg.id
       WHERE tp.user_id = ? AND tg.club_id = ?
         AND DATE(tg.created_at) = CURDATE()
         AND tg.status IN ('aguardando', 'ativo')
       ORDER BY tg.created_at DESC
       LIMIT 1`,
      [user_id, clubId(req)],
    );

    res.json(
      rows.length > 0
        ? { group_id: rows[0].group_id, status: rows[0].status }
        : { group_id: null },
    );
  } catch (error) {
    console.error("Erro ao buscar grupo atual:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getOpenLobbies = async (req, res) => {
  try {
    const { user_id } = req.query;
    const cid = clubId(req);
    const uid = user_id ? Number(user_id) : 0;

    // NOT EXISTS é mais seguro que NOT IN com subquery (evita bug de NULL no MySQL)
    const [rows] = await db.execute(
      `SELECT
         tg.id,
         tg.group_name,
         tg.access_code,
         tg.starting_hole,
         tg.course_id,
         tg.creator_id,
         u.name   AS creator_name,
         c.name   AS course_name,
         u2.id    AS player_id,
         u2.name  AS player_name
       FROM training_groups tg
       JOIN  users u  ON u.id = tg.creator_id
       LEFT JOIN courses c  ON c.id = tg.course_id
       LEFT JOIN training_participants tp ON tp.group_id = tg.id
       LEFT JOIN users u2 ON u2.id = tp.user_id
       WHERE tg.club_id = ?
         AND DATE(tg.created_at) = CURDATE()
         AND tg.status = 'aguardando'
         AND NOT EXISTS (
           SELECT 1 FROM training_participants tp2
           WHERE tp2.group_id = tg.id AND tp2.user_id = ?
         )
       ORDER BY tg.created_at DESC, tp.joined_at ASC`,
      [cid, uid],
    );

    // Agrupa os jogadores por lobby no backend — zero duplicatas no React
    const lobbyMap = rows.reduce((acc, r) => {
      if (!acc.has(r.id)) {
        acc.set(r.id, {
          id: r.id,
          group_name: r.group_name,
          access_code: r.access_code,
          starting_hole: r.starting_hole,
          course_id: r.course_id,
          creator_id: r.creator_id,
          creator_name: r.creator_name,
          course_name: r.course_name,
          players: [],
        });
      }
      if (r.player_id) {
        const lobby = acc.get(r.id);
        if (!lobby.players.some((p) => p.id === r.player_id)) {
          lobby.players.push({ id: r.player_id, name: r.player_name });
        }
      }
      return acc;
    }, new Map());

    const lobbies = Array.from(lobbyMap.values()).map((l) => ({
      ...l,
      player_count: l.players.length,
    }));

    res.json(lobbies);
  } catch (error) {
    console.error("Erro ao buscar lobbies:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getDailyRanking = async (req, res) => {
  try {
    const cid = clubId(req);

    // Query principal com fallback de par: tenta holes, depois course_holes, default 4
    const [ranking] = await db.execute(
      `SELECT
         tg.id                                                      AS group_id,
         tg.group_name,
         tg.course_id,
         u.id,
         u.name,
         u.gender,
         COALESCE(tp.handicap, 0)                                   AS handicap,
         COALESCE(SUM(ts.strokes), 0)                               AS total_strokes,
         COUNT(DISTINCT ts.hole_number)                             AS holes_played,
         COALESCE(SUM(ts.strokes - COALESCE(h.par, ch.par, 4)), 0) AS score_to_par
       FROM training_groups tg
       JOIN  training_participants tp ON tp.group_id = tg.id
       JOIN  users u  ON u.id = tp.user_id
       LEFT JOIN training_scores ts
         ON ts.group_id = tg.id AND ts.user_id = u.id
       LEFT JOIN holes h
         ON h.course_id = tg.course_id AND h.hole_number = ts.hole_number
       LEFT JOIN course_holes ch
         ON ch.course_id = tg.course_id AND ch.hole_number = ts.hole_number
       WHERE tg.club_id = ?
         AND DATE(tg.created_at) = CURDATE()
         AND tg.status IN ('ativo', 'finalizado')
       GROUP BY tg.id, tg.group_name, tg.course_id, u.id, u.name, u.gender, tp.handicap
       ORDER BY holes_played DESC, score_to_par ASC, tg.id ASC`,
      [cid],
    );

    // Score por buraco para o acordeão do frontend
    const [holeScores] = await db.execute(
      `SELECT ts.user_id, ts.group_id, ts.hole_number, ts.strokes,
              COALESCE(h.par, ch.par, 4) AS par
       FROM training_scores ts
       JOIN training_groups tg ON ts.group_id = tg.id
       LEFT JOIN holes h
         ON h.course_id = tg.course_id AND h.hole_number = ts.hole_number
       LEFT JOIN course_holes ch
         ON ch.course_id = tg.course_id AND ch.hole_number = ts.hole_number
       WHERE tg.club_id = ?
         AND DATE(tg.created_at) = CURDATE()
         AND tg.status IN ('ativo', 'finalizado')`,
      [cid],
    );

    // Dados dos buracos do campo (par de cada buraco) — tenta holes, depois course_holes
    let holesData = [];
    const courseId = ranking.find((r) => r.course_id)?.course_id;
    if (courseId) {
      try {
        const [holes] = await db.execute(
          "SELECT hole_number, par FROM holes WHERE course_id = ? ORDER BY hole_number",
          [courseId],
        );
        holesData = holes;
      } catch (_) {
        /* tabela holes não existe */
      }

      if (holesData.length === 0) {
        try {
          const [choles] = await db.execute(
            "SELECT hole_number, par FROM course_holes WHERE course_id = ? ORDER BY hole_number",
            [courseId],
          );
          holesData = choles;
        } catch (_) {
          /* tabela course_holes não existe */
        }
      }
    }

    // Monta training_label SOMENTE quando o mesmo atleta jogou > 1 vez no dia.
    // group_ids já vêm em ordem ASC (mais antigo = menor id = Treino 1).
    const userGroupOrder = {};
    ranking.forEach((r) => {
      if (!userGroupOrder[r.id]) userGroupOrder[r.id] = [];
      if (!userGroupOrder[r.id].includes(r.group_id))
        userGroupOrder[r.id].push(r.group_id);
    });
    const labeledRanking = ranking.map((r) => {
      const groups = userGroupOrder[r.id];
      // training_label null = jogador único → frontend não exibe nenhuma tag
      const training_label =
        groups.length > 1 ? `Treino ${groups.indexOf(r.group_id) + 1}` : null;
      return { ...r, training_label };
    });

    res.json({ ranking: labeledRanking, hole_scores: holeScores, holesData });
  } catch (error) {
    console.error("Erro ao buscar ranking diário:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getTrainingScorecard = async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    let rows = [];
    try {
      const [r] = await db.execute(
        `SELECT ts.hole_number, ts.strokes, COALESCE(h.par, ch.par, 4) AS par
         FROM training_scores ts
         JOIN training_groups tg ON tg.id = ts.group_id
         LEFT JOIN holes h        ON h.course_id = tg.course_id  AND h.hole_number = ts.hole_number
         LEFT JOIN course_holes ch ON ch.course_id = tg.course_id AND ch.hole_number = ts.hole_number
         WHERE ts.group_id = ? AND ts.user_id = ?
         ORDER BY ts.hole_number ASC`,
        [groupId, userId],
      );
      rows = r;
    } catch (_) {
      const [r] = await db.execute(
        `SELECT hole_number, strokes, 4 AS par FROM training_scores
         WHERE group_id = ? AND user_id = ? ORDER BY hole_number ASC`,
        [groupId, userId],
      );
      rows = r;
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPlayerHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const cid = clubId(req);

    // Tenta com holes/course_holes; se a tabela não existir cai no fallback sem score_to_par
    let trainings = [];
    try {
      const [rows] = await db.execute(
        `SELECT
           tg.id,
           tg.group_name,
           DATE_FORMAT(tg.created_at, '%d/%m/%Y')                     AS date,
           COALESCE(SUM(ts.strokes), 0)                               AS total_strokes,
           COUNT(DISTINCT ts.hole_number)                             AS holes_played,
           COALESCE(SUM(ts.strokes - COALESCE(h.par, ch.par, 4)), 0) AS score_to_par
         FROM training_groups tg
         JOIN  training_participants tp ON tp.group_id = tg.id AND tp.user_id = ?
         LEFT JOIN training_scores ts  ON ts.group_id = tg.id AND ts.user_id = ?
         LEFT JOIN holes h             ON h.course_id = tg.course_id AND h.hole_number = ts.hole_number
         LEFT JOIN course_holes ch     ON ch.course_id = tg.course_id AND ch.hole_number = ts.hole_number
         WHERE tg.club_id = ? AND tg.status = 'finalizado'
         GROUP BY tg.id, tg.group_name, tg.created_at
         ORDER BY tg.created_at DESC`,
        [userId, userId, cid],
      );
      trainings = rows;
    } catch (_) {
      const [rows] = await db.execute(
        `SELECT
           tg.id,
           tg.group_name,
           DATE_FORMAT(tg.created_at, '%d/%m/%Y') AS date,
           COALESCE(SUM(ts.strokes), 0)           AS total_strokes,
           COUNT(DISTINCT ts.hole_number)         AS holes_played,
           0                                      AS score_to_par
         FROM training_groups tg
         JOIN  training_participants tp ON tp.group_id = tg.id AND tp.user_id = ?
         LEFT JOIN training_scores ts  ON ts.group_id = tg.id AND ts.user_id = ?
         WHERE tg.club_id = ? AND tg.status = 'finalizado'
         GROUP BY tg.id, tg.group_name, tg.created_at
         ORDER BY tg.created_at DESC`,
        [userId, userId, cid],
      );
      trainings = rows;
    }

    let tournaments = [];
    try {
      const [rows] = await db.execute(
        `SELECT
           t.id,
           t.name,
           COALESCE(DATE_FORMAT(t.date, '%d/%m/%Y'), DATE_FORMAT(t.created_at, '%d/%m/%Y')) AS date
         FROM tournaments t
         JOIN inscriptions i ON i.tournament_id = t.id AND i.user_id = ?
         WHERE t.club_id = ? AND t.status = 'finalizado'
         ORDER BY t.id DESC`,
        [userId, cid],
      );
      tournaments = rows;
    } catch (_) {}

    res.json({ trainings, tournaments });
  } catch (error) {
    console.error("Erro ao buscar histórico:", error);
    res.status(500).json({ error: error.message });
  }
};
