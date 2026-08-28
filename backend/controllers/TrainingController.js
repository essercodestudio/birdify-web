// SQL necessário para habilitar UPSERT atômico (rodar uma vez no banco):
// ALTER TABLE training_scores
//   ADD UNIQUE KEY uq_training_score (group_id, user_id, hole_number);

const crypto        = require("crypto");
const db            = require("../db");
const socketService = require("../services/socketService");

function generateCode(len = 3) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < len; i++)
    code += chars[crypto.randomInt(chars.length)];
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
    const { course_id, starting_hole } = req.body;
    const creator_id = req.user.id;
    const cid = clubId(req);

    if (await userAlreadyInGroup(creator_id, cid))
      return res.status(409).json({ message: "Você já está em um treino em andamento." });

    const [[course]] = await db.execute("SELECT name FROM courses WHERE id = ?", [course_id]);
    const courseName = course?.name || "Campo";
    const now = new Date();
    const dd   = String(now.getDate()).padStart(2, "0");
    const mm   = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const group_name = `Treino ${courseName} - ${dd}/${mm}/${yyyy}`;

    // Retry contra colisão do UNIQUE (access_code global, 36^3 = 46k combos).
    let access_code = null, groupId = null, attempts = 0;
    while (attempts < 20) {
      const candidate = generateCode();
      try {
        const [result] = await db.execute(
          `INSERT INTO training_groups (club_id, creator_id, course_id, group_name, access_code, starting_hole, status)
           VALUES (?, ?, ?, ?, ?, ?, 'aguardando')`,
          [cid, creator_id, course_id, group_name, candidate, starting_hole || 1],
        );
        access_code = candidate;
        groupId = result.insertId;
        break;
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") { attempts++; continue; }
        throw e;
      }
    }
    if (!groupId) return res.status(503).json({ error: "Não foi possível gerar código único. Tente novamente." });

    await db.execute(
      "INSERT INTO training_participants (group_id, user_id) VALUES (?, ?)",
      [groupId, creator_id],
    );

    res.json({ groupId, access_code, group_name, starting_hole: starting_hole || 1, course_id, creator_id });
  } catch (error) {
    console.error("Erro ao criar mesa de treino:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.joinTable = async (req, res) => {
  try {
    const { access_code } = req.body;
    const user_id = req.user.id;
    const cid     = clubId(req);
    const cleanCode = (access_code || "").trim().toUpperCase();

    const [groups] = await db.execute(
      `SELECT * FROM training_groups WHERE access_code = ? AND club_id = ?`,
      [cleanCode, cid],
    );

    if (groups.length === 0)
      return res.status(404).json({ message: "Código inválido." });
    if (groups[0].status === "ativo")
      return res.status(403).json({ message: "O treino já começou. A sala está trancada." });
    if (groups[0].status === "finalizado")
      return res.status(403).json({ message: "Este treino já foi finalizado." });
    if (groups[0].status === "cancelado")
      return res.status(403).json({ message: "Este treino foi cancelado." });

    const group = groups[0];

    const [existing] = await db.execute(
      "SELECT * FROM training_participants WHERE group_id = ? AND user_id = ?",
      [group.id, user_id],
    );

    if (existing.length === 0) {
      if (await userAlreadyInGroup(user_id, cid))
        return res.status(409).json({ message: "Você já está em um treino em andamento." });

      const [[{ cnt }]] = await db.execute(
        "SELECT COUNT(*) AS cnt FROM training_participants WHERE group_id = ?",
        [group.id],
      );
      if (cnt >= 4)
        return res.status(400).json({ message: "Mesa lotada! Máximo de 4 jogadores." });

      await db.execute(
        "INSERT INTO training_participants (group_id, user_id) VALUES (?, ?)",
        [group.id, user_id],
      );

      // Busca nome do jogador para broadcast
      const [[user]] = await db.execute("SELECT name FROM users WHERE id = ?", [user_id]);
      socketService.emitToRoom(`training:${group.id}`, "training:player_joined", {
        group_id: group.id, user_id, user_name: user?.name || "",
      });
    }

    res.json({ table: group });
  } catch (error) {
    console.error("Erro ao entrar na mesa:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.leaveGroup = async (req, res) => {
  try {
    const { group_id } = req.body;
    const user_id = req.user.id;

    const [groups] = await db.execute(
      "SELECT creator_id, status FROM training_groups WHERE id = ? AND club_id = ?",
      [group_id, clubId(req)],
    );

    if (groups.length === 0)
      return res.status(404).json({ message: "Grupo não encontrado." });
    if (groups[0].creator_id === user_id)
      return res.status(403).json({ message: "O criador não pode sair. Use Excluir Treino." });
    if (groups[0].status !== "aguardando")
      return res.status(403).json({ message: "Não é possível sair de um treino em andamento." });

    await db.execute(
      "DELETE FROM training_participants WHERE group_id = ? AND user_id = ?",
      [group_id, user_id],
    );

    res.json({ message: "Saiu do grupo." });
  } catch (error) {
    console.error("Erro ao sair do grupo:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Cancelar treino em qualquer etapa (aguardando OU ativo) — só o criador.
// 'finalizado' fica intocável (o cartão foi assinado e virou histórico do
// ranking); 'cancelado' é idempotente. Além do UPDATE, emitimos socket
// pros participantes saírem da tela sem precisar de F5.
exports.deleteGroup = async (req, res) => {
  try {
    const { group_id } = req.body;
    const creator_id = req.user.id;
    const cid = clubId(req);

    // Pega status atual pra dar mensagem específica em vez de 403 genérico
    const [rows] = await db.execute(
      "SELECT status FROM training_groups WHERE id = ? AND creator_id = ? AND club_id = ?",
      [group_id, creator_id, cid],
    );
    if (rows.length === 0)
      return res.status(403).json({ message: "Acesso negado ou treino não encontrado." });

    const currentStatus = rows[0].status;
    if (currentStatus === "finalizado")
      return res.status(409).json({ message: "Treino já finalizado não pode ser excluído." });
    if (currentStatus === "cancelado")
      return res.json({ message: "Treino já estava cancelado." });

    const [result] = await db.execute(
      `UPDATE training_groups SET status = 'cancelado'
       WHERE id = ? AND creator_id = ? AND club_id = ? AND status IN ('aguardando','ativo')`,
      [group_id, creator_id, cid],
    );

    if (result.affectedRows === 0)
      return res.status(409).json({ message: "Treino mudou de estado — recarregue a tela." });

    // Notifica sala aberta — jogador na tela do scorecard sai sem F5.
    // Ranking do dia também recalcula (o treino sai do IN ('ativo','finalizado')).
    socketService.emitToRoom(`training:${group_id}`, "training:cancelled", {
      group_id, by_creator: true,
    });
    socketService.emitToRoom("training:ranking", "training:ranking_updated", { group_id });

    res.json({ message: "Treino cancelado." });
  } catch (error) {
    console.error("Erro ao excluir treino:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
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
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// UPSERT atômico — elimina race condition do DELETE+INSERT anterior
exports.saveScore = async (req, res) => {
  // Força conversão para inteiro — MySQL2 pode enviar strings do body JSON
  // e o UNIQUE KEY (group_id, user_id, hole_number) falha silenciosamente com tipo errado
  const group_id    = Number(req.body.group_id);
  const user_id     = Number(req.body.user_id);   // jogador alvo do score
  const hole_number = Number(req.body.hole_number);
  const strokes     = Number(req.body.strokes);
  const caller_id   = req.user.id;                // quem está fazendo a requisição

  try {
    if (!group_id || !user_id || !hole_number || isNaN(strokes))
      return res.status(400).json({ error: "Dados incompletos ou inválidos." });

    // Garante que quem chama é participante do grupo (impede salvar scores em grupos alheios)
    const [[{ cnt }]] = await db.execute(
      "SELECT COUNT(*) AS cnt FROM training_participants WHERE group_id = ? AND user_id = ?",
      [group_id, caller_id],
    );
    if (cnt === 0) return res.status(403).json({ error: "Acesso negado." });

    await db.execute(
      `INSERT INTO training_scores (group_id, user_id, hole_number, strokes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE strokes = VALUES(strokes)`,
      [group_id, user_id, hole_number, strokes],
    );

    // savedAt permite ao cliente descartar broadcasts fora de ordem — quando
    // o usuário marca dois scores rápidos no mesmo (user, hole), o segundo
    // POST pode responder antes do primeiro chegar via socket e reverter o
    // valor. Comparando savedAt com o timestamp local do último clique, a UI
    // ignora o broadcast obsoleto.
    const savedAt = Date.now();
    socketService.emitToRoom(`training:${group_id}`, "training:score_saved", {
      group_id, user_id, hole_number, strokes, savedAt,
    });
    socketService.emitToRoom("training:ranking", "training:ranking_updated", { group_id });

    res.json({ ok: true, strokes, hole: hole_number, savedAt });
  } catch (error) {
    console.error("[saveScore] ERRO:", error.message, { group_id, user_id, hole_number, strokes });
    res.status(500).json({ error: "Erro interno no servidor." });
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
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Handicaps declarados na sala de espera — mesmo modelo do torneio: o criador
// informa o HC de cada atleta antes de iniciar. Alimenta o NET e as categorias
// (M1-M4 / F1-F3) do ranking do dia.
exports.saveHandicaps = async (req, res) => {
  const group_id = Number(req.body.group_id);
  const players_data = req.body.players_data;
  const caller_id = req.user.id;

  try {
    if (!group_id || !Array.isArray(players_data) || players_data.length === 0)
      return res.status(400).json({ error: "Dados incompletos." });

    const [groups] = await db.execute(
      "SELECT id FROM training_groups WHERE id = ? AND club_id = ?",
      [group_id, clubId(req)],
    );
    if (groups.length === 0)
      return res.status(404).json({ error: "Mesa não encontrada." });

    // Só participante do grupo pode salvar (mesma regra do saveScore)
    const [[{ cnt }]] = await db.execute(
      "SELECT COUNT(*) AS cnt FROM training_participants WHERE group_id = ? AND user_id = ?",
      [group_id, caller_id],
    );
    if (cnt === 0) return res.status(403).json({ error: "Acesso negado." });

    for (const p of players_data) {
      const hc = parseFloat(p.handicap);
      if (isNaN(hc) || hc < 0 || hc > 54)
        return res.status(400).json({ error: "Handicap inválido (0 a 54)." });
      await db.execute(
        "UPDATE training_participants SET handicap = ? WHERE group_id = ? AND user_id = ?",
        [hc, group_id, Number(p.user_id)],
      );
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Erro ao salvar handicaps do treino:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.startTraining = async (req, res) => {
  try {
    const { group_id } = req.body;
    const creator_id = req.user.id;

    const [result] = await db.execute(
      `UPDATE training_groups SET status = 'ativo'
       WHERE id = ? AND club_id = ? AND creator_id = ? AND status = 'aguardando'`,
      [group_id, clubId(req), creator_id],
    );

    if (result.affectedRows === 0)
      return res.status(400).json({ message: "Grupo não encontrado ou treino já iniciado." });

    socketService.emitToRoom(`training:${group_id}`, "training:started", { group_id });
    socketService.emitToRoom("training:ranking", "training:ranking_updated", { group_id });

    res.json({ message: "Treino iniciado!" });
  } catch (error) {
    console.error("Erro ao iniciar treino:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.finishTraining = async (req, res) => {
  const group_id   = Number(req.body.group_id);
  const creator_id = req.user.id;
  const cid        = clubId(req);

  try {
    if (!group_id) return res.status(400).json({ error: "group_id ausente." });

    // Bug B — 2026-08-13: validação server-side de completude. Antes o backend
    // só marcava status='finalizado' sem checar se todos os atletas tinham
    // marcado todos os buracos. Se algum passasse pela validação client-side
    // (skip por bug/manipulação), gravava treino incompleto no ranking.
    const [[group]] = await db.execute(
      "SELECT course_id FROM training_groups WHERE id = ? AND club_id = ? AND creator_id = ?",
      [group_id, cid, creator_id],
    );
    if (!group) {
      return res.status(403).json({ message: "Acesso negado ou treino não encontrado." });
    }

    const [[{ hole_count }]] = await db.execute(
      "SELECT COUNT(*) AS hole_count FROM holes WHERE course_id = ?",
      [group.course_id],
    );
    const expected = hole_count > 0 ? hole_count : 18;

    const [participants] = await db.execute(
      `SELECT tp.user_id, u.name,
              COUNT(ts.hole_number) AS holes_played
         FROM training_participants tp
         JOIN users u ON u.id = tp.user_id
         LEFT JOIN training_scores ts
                ON ts.group_id  = tp.group_id
               AND ts.user_id   = tp.user_id
               AND ts.hole_number BETWEEN 1 AND ?
        WHERE tp.group_id = ?
        GROUP BY tp.user_id, u.name`,
      [expected, group_id],
    );

    const missing = [];
    for (const p of participants) {
      if (Number(p.holes_played) < expected) {
        const [rows] = await db.execute(
          `SELECT hole_number FROM training_scores
            WHERE group_id = ? AND user_id = ? AND hole_number BETWEEN 1 AND ?`,
          [group_id, p.user_id, expected],
        );
        const have = new Set(rows.map(r => Number(r.hole_number)));
        const holes = [];
        for (let h = 1; h <= expected; h++) if (!have.has(h)) holes.push(h);
        missing.push({ user_id: p.user_id, name: p.name, missing_holes: holes });
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: "Treino incompleto — não pode ser finalizado.",
        expected_holes: expected,
        missing,
      });
    }

    const [result] = await db.execute(
      `UPDATE training_groups SET status = 'finalizado'
       WHERE id = ? AND club_id = ? AND creator_id = ?`,
      [group_id, cid, creator_id],
    );

    if (result.affectedRows === 0) {
      return res.status(403).json({ message: "Acesso negado ou treino não encontrado." });
    }

    socketService.emitToRoom(`training:${group_id}`, "training:finished", { group_id });
    socketService.emitToRoom("training:ranking", "training:ranking_updated", { group_id });

    res.json({ message: "Treino finalizado!" });
  } catch (error) {
    console.error("[finishTraining] ERRO:", error.message, { group_id, creator_id, cid });
    res.status(500).json({ error: "Erro interno no servidor." });
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

    res.json(rows.length > 0 ? { group_id: rows[0].group_id, status: rows[0].status } : { group_id: null });
  } catch (error) {
    console.error("Erro ao buscar grupo atual:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.getOpenLobbies = async (req, res) => {
  try {
    const { user_id } = req.query;
    const cid = clubId(req);
    const uid = user_id ? Number(user_id) : 0;

    const [rows] = await db.execute(
      `SELECT
         tg.id, tg.group_name, tg.access_code, tg.starting_hole,
         tg.course_id, tg.creator_id,
         u.name  AS creator_name,
         c.name  AS course_name,
         u2.id   AS player_id,
         u2.name AS player_name
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

    const lobbyMap = rows.reduce((acc, r) => {
      if (!acc.has(r.id)) {
        acc.set(r.id, {
          id: r.id, group_name: r.group_name, access_code: r.access_code,
          starting_hole: r.starting_hole, course_id: r.course_id,
          creator_id: r.creator_id, creator_name: r.creator_name,
          course_name: r.course_name, players: [],
        });
      }
      if (r.player_id) {
        const lobby = acc.get(r.id);
        if (!lobby.players.some((p) => p.id === r.player_id))
          lobby.players.push({ id: r.player_id, name: r.player_name });
      }
      return acc;
    }, new Map());

    const lobbies = Array.from(lobbyMap.values()).map((l) => ({ ...l, player_count: l.players.length }));
    res.json(lobbies);
  } catch (error) {
    console.error("Erro ao buscar lobbies:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Versão pública do ranking do dia — mesma agregação, sem dados pessoais
// sensíveis (gender/handicap). Alimenta a rota pública /treino/:groupId/ranking
// que qualquer pessoa (mesmo sem login) pode abrir pra acompanhar.
// Não expõe categorias por HCP (que dependem dos dois campos removidos).
exports.getDailyRankingPublic = async (req, res) => {
  try {
    const cid = clubId(req);

    const [ranking] = await db.execute(
      `SELECT
         tg.id                                                      AS group_id,
         tg.group_name,
         tg.course_id,
         tg.status                                                  AS group_status,
         u.id,
         u.name,
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
       GROUP BY tg.id, tg.group_name, tg.course_id, tg.status, u.id, u.name
       ORDER BY holes_played DESC, score_to_par ASC, tg.id ASC`,
      [cid],
    );

    const [holeScores] = await db.execute(
      `SELECT ts.user_id, ts.group_id, ts.hole_number, ts.strokes,
              COALESCE(h.par, ch.par, 4) AS hole_par
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

    let holesData = [];
    const courseId = ranking.find((r) => r.course_id)?.course_id;
    if (courseId) {
      try {
        const [holes] = await db.execute(
          "SELECT hole_number, par FROM holes WHERE course_id = ? ORDER BY hole_number",
          [courseId],
        );
        holesData = holes;
      } catch (_) {}
      if (holesData.length === 0) {
        try {
          const [choles] = await db.execute(
            "SELECT hole_number, par FROM course_holes WHERE course_id = ? ORDER BY hole_number",
            [courseId],
          );
          holesData = choles;
        } catch (_) {}
      }
    }

    const userGroupOrder = {};
    ranking.forEach((r) => {
      if (!userGroupOrder[r.id]) userGroupOrder[r.id] = [];
      if (!userGroupOrder[r.id].includes(r.group_id))
        userGroupOrder[r.id].push(r.group_id);
    });

    const labeledRanking = ranking.map((r) => {
      const groups = userGroupOrder[r.id];
      const training_label = groups.length > 1 ? `Treino ${groups.indexOf(r.group_id) + 1}` : null;
      return { ...r, training_label };
    });

    res.json({ ranking: labeledRanking, hole_scores: holeScores, holesData });
  } catch (error) {
    console.error("Erro ao buscar ranking diário público:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.getDailyRanking = async (req, res) => {
  try {
    const cid = clubId(req);

    const [ranking] = await db.execute(
      `SELECT
         tg.id                                                      AS group_id,
         tg.group_name,
         tg.course_id,
         tg.status                                                  AS group_status,
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
       GROUP BY tg.id, tg.group_name, tg.course_id, tg.status, u.id, u.name, u.gender, tp.handicap
       ORDER BY holes_played DESC, score_to_par ASC, tg.id ASC`,
      [cid],
    );

    const [holeScores] = await db.execute(
      `SELECT ts.user_id, ts.group_id, ts.hole_number, ts.strokes,
              COALESCE(h.par, ch.par, 4) AS hole_par
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

    let holesData = [];
    const courseId = ranking.find((r) => r.course_id)?.course_id;
    if (courseId) {
      try {
        const [holes] = await db.execute(
          "SELECT hole_number, par FROM holes WHERE course_id = ? ORDER BY hole_number",
          [courseId],
        );
        holesData = holes;
      } catch (_) {}

      if (holesData.length === 0) {
        try {
          const [choles] = await db.execute(
            "SELECT hole_number, par FROM course_holes WHERE course_id = ? ORDER BY hole_number",
            [courseId],
          );
          holesData = choles;
        } catch (_) {}
      }
    }

    const userGroupOrder = {};
    ranking.forEach((r) => {
      if (!userGroupOrder[r.id]) userGroupOrder[r.id] = [];
      if (!userGroupOrder[r.id].includes(r.group_id))
        userGroupOrder[r.id].push(r.group_id);
    });

    const labeledRanking = ranking.map((r) => {
      const groups = userGroupOrder[r.id];
      const training_label = groups.length > 1 ? `Treino ${groups.indexOf(r.group_id) + 1}` : null;
      return { ...r, training_label };
    });

    res.json({ ranking: labeledRanking, hole_scores: holeScores, holesData });
  } catch (error) {
    console.error("Erro ao buscar ranking diário:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
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
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.getPlayerHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const cid = clubId(req);

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
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
