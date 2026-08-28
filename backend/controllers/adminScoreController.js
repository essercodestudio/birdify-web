// backend/controllers/adminScoreController.js
// Endpoints exclusivos do admin pra corrigir tacadas manualmente em torneios e
// treinos. Toda leitura/escrita é filtrada por req.club.id — o admin não pode
// mexer em score de outro clube mesmo passando IDs válidos.
//
// ATENÇÃO: cada PUT é ATÔMICO — tudo dentro de uma transação:
//   1) leitura do valor anterior
//   2) UPSERT/DELETE do score
//   3) INSERT em admin_score_audit
//   4) (só torneios) invalidação de assinaturas ativas do grupo
// Se qualquer passo falhar, ROLLBACK. Assim score e audit nunca ficam
// dessincronizados e a assinatura invalidada sempre reflete uma edição real.
const db = require("../db");

const REASON_MIN = 5;
const REASON_MAX = 255;

// Valida e normaliza o reason obrigatório. Retorna null quando OK, ou um
// objeto { status, error } pra devolver ao client.
function validateReason(raw) {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) return { status: 400, error: "Motivo é obrigatório." };
  if (reason.length < REASON_MIN) {
    return { status: 400, error: `Motivo deve ter pelo menos ${REASON_MIN} caracteres.` };
  }
  if (reason.length > REASON_MAX) {
    return { status: 400, error: `Motivo deve ter no máximo ${REASON_MAX} caracteres.` };
  }
  return { reason };
}

// Deriva a ação (insert/update/delete) a partir do estado anterior/novo.
function deriveAction(previous, next) {
  const hadBefore = previous !== null && previous !== undefined;
  const hasNow    = next     !== null && next     !== undefined;
  if (!hadBefore && hasNow)  return "insert";
  if (hadBefore  && !hasNow) return "delete";
  return "update"; // hadBefore && hasNow
}

// ────────────────────────────────────────────────────────────────
// TORNEIOS
// ────────────────────────────────────────────────────────────────

exports.listTournaments = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT t.id, t.name, t.start_date, t.course_id, t.total_rounds, c.name AS course_name
         FROM tournaments t
         LEFT JOIN courses c ON c.id = t.course_id
        WHERE t.club_id = ?
        ORDER BY t.start_date DESC, t.id DESC`,
      [req.club.id]
    );
    res.json(rows);
  } catch (error) {
    console.error("[admin listTournaments] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.getTournamentMatrix = async (req, res) => {
  try {
    const tournamentId = Number(req.params.tournamentId);
    if (!tournamentId) return res.status(400).json({ error: "tournament_id inválido." });

    const [[tournament]] = await db.execute(
      `SELECT id, name, start_date, course_id, total_rounds
         FROM tournaments
        WHERE id = ? AND club_id = ?`,
      [tournamentId, req.club.id]
    );
    if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });

    const [holesRaw] = await db.execute(
      `SELECT hole_number, par FROM holes WHERE course_id = ? ORDER BY hole_number`,
      [tournament.course_id]
    );
    let holes = holesRaw;
    if (holes.length === 0) {
      const [ch] = await db.execute(
        `SELECT hole_number, par FROM course_holes WHERE course_id = ? ORDER BY hole_number`,
        [tournament.course_id]
      );
      holes = ch;
    }
    if (holes.length === 0) {
      holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4 }));
    }

    const [groupRows] = await db.execute(
      `SELECT tg.id AS group_id, tg.group_name, tg.starting_hole, tg.tee_time,
              u.id AS user_id, u.name AS user_name
         FROM tournament_groups tg
         LEFT JOIN group_players gp ON gp.group_id = tg.id
         LEFT JOIN users u ON u.id = gp.user_id
        WHERE tg.tournament_id = ?
        ORDER BY tg.id ASC, u.name ASC`,
      [tournamentId]
    );

    const groups = [];
    const gmap = new Map();
    for (const r of groupRows) {
      if (!gmap.has(r.group_id)) {
        const g = {
          id: r.group_id,
          name: r.group_name,
          starting_hole: r.starting_hole,
          tee_time: r.tee_time,
          players: [],
        };
        gmap.set(r.group_id, g);
        groups.push(g);
      }
      if (r.user_id) {
        gmap.get(r.group_id).players.push({ id: r.user_id, name: r.user_name });
      }
    }

    const [scores] = await db.execute(
      `SELECT user_id, hole_number, round_number, strokes
         FROM scores
        WHERE tournament_id = ?`,
      [tournamentId]
    );

    // Item 5 · commit 2: expõe total_rounds + rounds[] pra tela editor decidir
    // se mostra seletor de round e valida contra a lista.
    const [roundRows] = await db.execute(
      `SELECT round_number, round_date, course_id
         FROM tournament_rounds
        WHERE tournament_id = ?
        ORDER BY round_number ASC`,
      [tournamentId]
    );

    res.json({ tournament, holes, groups, scores, rounds: roundRows });
  } catch (error) {
    console.error("[admin getTournamentMatrix] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Item 5 · commit 2 (2026-08-28): aceita round_number no payload (default 1).
// Valida contra total_rounds. Toda leitura/escrita/audit/invalidação filtra por
// round — assinatura de R1 continua válida mesmo se admin editar R2 e vice-versa.
exports.upsertTournamentScore = async (req, res) => {
  const tournament_id = Number(req.body.tournament_id);
  const user_id       = Number(req.body.user_id);
  const hole_number   = Number(req.body.hole_number);
  const round_number  = req.body.round_number !== undefined ? Number(req.body.round_number) : 1;
  const strokesRaw    = req.body.strokes;

  if (!tournament_id || !user_id || !hole_number) {
    return res.status(400).json({ error: "Dados incompletos." });
  }
  if (!Number.isInteger(round_number) || round_number < 1) {
    return res.status(400).json({ error: "round_number inválido." });
  }

  const reasonCheck = validateReason(req.body.reason);
  if (reasonCheck.error) return res.status(reasonCheck.status).json({ error: reasonCheck.error });
  const reason = reasonCheck.reason;

  const willDelete = (strokesRaw === null || strokesRaw === undefined || strokesRaw === "");
  const newStrokes = willDelete ? null : Number(strokesRaw);
  if (!willDelete && (!Number.isInteger(newStrokes) || newStrokes < 1 || newStrokes > 20)) {
    return res.status(400).json({ error: "Tacadas devem ser inteiro entre 1 e 20." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Escopo do clube + total_rounds + nome do jogador (pra compor invalidated_reason)
    const [tRows] = await conn.execute(
      `SELECT t.id, t.total_rounds, u.name AS target_name
         FROM tournaments t
         JOIN users u ON u.id = ?
        WHERE t.id = ? AND t.club_id = ?`,
      [user_id, tournament_id, req.club.id]
    );
    if (tRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Torneio não encontrado." });
    }
    const totalRounds = Number(tRows[0].total_rounds) || 1;
    if (round_number > totalRounds) {
      await conn.rollback();
      return res.status(400).json({
        error: `Rodada inválida: torneio tem ${totalRounds} rodada(s), tentou editar R${round_number}.`,
      });
    }
    const targetName = tRows[0].target_name;

    // Jogador precisa estar escalado em algum grupo do torneio
    const [membership] = await conn.execute(
      `SELECT tg.id AS group_id
         FROM group_players gp
         JOIN tournament_groups tg ON tg.id = gp.group_id
        WHERE tg.tournament_id = ? AND gp.user_id = ?`,
      [tournament_id, user_id]
    );
    if (membership.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: "Jogador não pertence a este torneio." });
    }
    const affectedGroupIds = membership.map(r => r.group_id);

    // Valor anterior POR ROUND (pra audit — R1 e R2 são scores independentes)
    const [prevRows] = await conn.execute(
      `SELECT strokes FROM scores
        WHERE tournament_id = ? AND user_id = ? AND hole_number = ? AND round_number = ?`,
      [tournament_id, user_id, hole_number, round_number]
    );
    const previousStrokes = prevRows.length ? Number(prevRows[0].strokes) : null;

    const action = deriveAction(previousStrokes, newStrokes);
    if (previousStrokes === newStrokes) {
      await conn.rollback();
      return res.status(200).json({ ok: true, noop: true });
    }

    // Mutação — DELETE ou UPSERT via uk_score 4-col
    if (willDelete) {
      await conn.execute(
        `DELETE FROM scores WHERE tournament_id = ? AND user_id = ? AND hole_number = ? AND round_number = ?`,
        [tournament_id, user_id, hole_number, round_number]
      );
    } else {
      await conn.execute(
        `INSERT INTO scores (tournament_id, user_id, hole_number, round_number, strokes)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE strokes = VALUES(strokes)`,
        [tournament_id, user_id, hole_number, round_number, newStrokes]
      );
    }

    // Audit — inclui round_number (coluna NULLABLE; envio null pra torneios legados
    // ainda pra manter o comportamento antigo? Não: agora todo torneio tem >=1 round,
    // então sempre gravo o número. NULL fica reservado a treinos onde não se aplica.)
    const [auditResult] = await conn.execute(
      `INSERT INTO admin_score_audit
         (club_id, admin_user_id, context, tournament_id, training_group_id,
          target_user_id, hole_number, round_number, previous_strokes, new_strokes, action, reason)
       VALUES (?, ?, 'tournament', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.club.id, req.user.id, tournament_id,
        user_id, hole_number, round_number, previousStrokes, newStrokes, action, reason,
      ]
    );
    const auditId = auditResult.insertId;

    // Invalidar assinaturas ativas SÓ desta rodada — R1 continua válida se admin
    // editar R2. Sem esse filtro por round, uma correção em R3 invalidaria R1 e R2
    // que já estavam legitimamente assinadas.
    let invalidatedCount = 0;
    if (affectedGroupIds.length > 0) {
      const invalidatedReason =
        `Score R${round_number} do jogador ${targetName} (id=${user_id}) buraco ${hole_number} ` +
        `alterado por admin (id=${req.user.id}) em ${new Date().toISOString()} ` +
        `(audit #${auditId}). Motivo: ${reason}`;
      const truncatedReason = invalidatedReason.slice(0, 500);
      const placeholders = affectedGroupIds.map(() => "?").join(",");
      const [invRes] = await conn.query(
        `UPDATE tournament_scorecard_signatures
            SET invalidated_at = NOW(),
                invalidated_reason = ?
          WHERE tournament_id = ?
            AND round_number = ?
            AND group_id IN (${placeholders})
            AND invalidated_at IS NULL`,
        [truncatedReason, tournament_id, round_number, ...affectedGroupIds]
      );
      invalidatedCount = invRes.affectedRows || 0;
    }

    await conn.commit();
    res.json({
      ok: true,
      action,
      round_number,
      previous_strokes: previousStrokes,
      new_strokes: newStrokes,
      audit_id: auditId,
      invalidated_signatures: invalidatedCount,
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[admin upsertTournamentScore] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────────
// TREINOS
// ────────────────────────────────────────────────────────────────

exports.listTrainings = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT tg.id, tg.group_name, tg.status, tg.starting_hole,
              tg.course_id, tg.created_at, c.name AS course_name
         FROM training_groups tg
         LEFT JOIN courses c ON c.id = tg.course_id
        WHERE tg.club_id = ?
          AND tg.created_at >= (NOW() - INTERVAL 30 DAY)
        ORDER BY tg.created_at DESC, tg.id DESC`,
      [req.club.id]
    );
    res.json(rows);
  } catch (error) {
    console.error("[admin listTrainings] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.getTrainingMatrix = async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!groupId) return res.status(400).json({ error: "group_id inválido." });

    const [[group]] = await db.execute(
      `SELECT id, group_name, status, starting_hole, course_id, created_at
         FROM training_groups
        WHERE id = ? AND club_id = ?`,
      [groupId, req.club.id]
    );
    if (!group) return res.status(404).json({ error: "Treino não encontrado." });

    const [holesRaw] = await db.execute(
      `SELECT hole_number, par FROM holes WHERE course_id = ? ORDER BY hole_number`,
      [group.course_id]
    );
    let holes = holesRaw;
    if (holes.length === 0) {
      const [ch] = await db.execute(
        `SELECT hole_number, par FROM course_holes WHERE course_id = ? ORDER BY hole_number`,
        [group.course_id]
      );
      holes = ch;
    }
    if (holes.length === 0) {
      holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4 }));
    }

    const [players] = await db.execute(
      `SELECT u.id, u.name
         FROM training_participants tp
         JOIN users u ON u.id = tp.user_id
        WHERE tp.group_id = ?
        ORDER BY u.name ASC`,
      [groupId]
    );

    const [scores] = await db.execute(
      `SELECT user_id, hole_number, strokes
         FROM training_scores
        WHERE group_id = ?`,
      [groupId]
    );

    res.json({ group, holes, players, scores });
  } catch (error) {
    console.error("[admin getTrainingMatrix] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.upsertTrainingScore = async (req, res) => {
  const group_id    = Number(req.body.group_id);
  const user_id     = Number(req.body.user_id);
  const hole_number = Number(req.body.hole_number);
  const strokesRaw  = req.body.strokes;

  if (!group_id || !user_id || !hole_number) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  const reasonCheck = validateReason(req.body.reason);
  if (reasonCheck.error) return res.status(reasonCheck.status).json({ error: reasonCheck.error });
  const reason = reasonCheck.reason;

  const willDelete = (strokesRaw === null || strokesRaw === undefined || strokesRaw === "");
  const newStrokes = willDelete ? null : Number(strokesRaw);
  if (!willDelete && (!Number.isInteger(newStrokes) || newStrokes < 1 || newStrokes > 20)) {
    return res.status(400).json({ error: "Tacadas devem ser inteiro entre 1 e 20." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [gRows] = await conn.execute(
      `SELECT id FROM training_groups WHERE id = ? AND club_id = ?`,
      [group_id, req.club.id]
    );
    if (gRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Treino não encontrado." });
    }

    const [membership] = await conn.execute(
      `SELECT 1 FROM training_participants WHERE group_id = ? AND user_id = ? LIMIT 1`,
      [group_id, user_id]
    );
    if (membership.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: "Jogador não pertence a este treino." });
    }

    const [prevRows] = await conn.execute(
      `SELECT strokes FROM training_scores
        WHERE group_id = ? AND user_id = ? AND hole_number = ?`,
      [group_id, user_id, hole_number]
    );
    const previousStrokes = prevRows.length ? Number(prevRows[0].strokes) : null;

    const action = deriveAction(previousStrokes, newStrokes);
    if (previousStrokes === newStrokes) {
      await conn.rollback();
      return res.status(200).json({ ok: true, noop: true });
    }

    if (willDelete) {
      await conn.execute(
        `DELETE FROM training_scores WHERE group_id = ? AND user_id = ? AND hole_number = ?`,
        [group_id, user_id, hole_number]
      );
    } else {
      await conn.execute(
        `INSERT INTO training_scores (group_id, user_id, hole_number, strokes)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE strokes = VALUES(strokes)`,
        [group_id, user_id, hole_number, newStrokes]
      );
    }

    const [auditResult] = await conn.execute(
      `INSERT INTO admin_score_audit
         (club_id, admin_user_id, context, tournament_id, training_group_id,
          target_user_id, hole_number, previous_strokes, new_strokes, action, reason)
       VALUES (?, ?, 'training', NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.club.id, req.user.id, group_id,
        user_id, hole_number, previousStrokes, newStrokes, action, reason,
      ]
    );

    await conn.commit();
    res.json({
      ok: true,
      action,
      previous_strokes: previousStrokes,
      new_strokes: newStrokes,
      audit_id: auditResult.insertId,
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[admin upsertTrainingScore] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────────
// HISTÓRICO DE EDIÇÕES
// ────────────────────────────────────────────────────────────────
// GET /admin/scores/audit?context=tournament&event_id=123&limit=100
// context obrigatório; event_id opcional (se omitido, lista todos do clube)
exports.listAudit = async (req, res) => {
  try {
    const context = req.query.context;
    if (context && !["tournament", "training"].includes(context)) {
      return res.status(400).json({ error: "context deve ser 'tournament' ou 'training'." });
    }
    const eventId = req.query.event_id ? Number(req.query.event_id) : null;
    const limit = Math.min(Number(req.query.limit) || 200, 500);

    const where = ["a.club_id = ?"];
    const params = [req.club.id];
    if (context) { where.push("a.context = ?"); params.push(context); }
    if (eventId) {
      if (context === "training") { where.push("a.training_group_id = ?"); params.push(eventId); }
      else if (context === "tournament") { where.push("a.tournament_id = ?"); params.push(eventId); }
    }

    const [rows] = await db.query(
      `SELECT a.id, a.context, a.tournament_id, a.training_group_id,
              a.target_user_id, tu.name AS target_name,
              a.admin_user_id, au.name AS admin_name,
              a.hole_number, a.previous_strokes, a.new_strokes,
              a.action, a.reason, a.created_at,
              t.name AS tournament_name,
              tg.group_name AS training_group_name
         FROM admin_score_audit a
         JOIN users tu ON tu.id = a.target_user_id
         JOIN users au ON au.id = a.admin_user_id
         LEFT JOIN tournaments t     ON t.id  = a.tournament_id
         LEFT JOIN training_groups tg ON tg.id = a.training_group_id
        WHERE ${where.join(" AND ")}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit}`,
      params
    );

    res.json(rows);
  } catch (error) {
    console.error("[admin listAudit] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
