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
const { deriveStrokesFromResult, fetchPar, RESULT_KINDS, getEnabledKinds } = require("../services/resultKindHelpers");

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
    // Filtro NOT REGEXP: ver comentário em tournamentController.listTournaments.
    // Editor de tacadas nunca deve oferecer fantasma "Treino AAAA-MM-DD" pra edição.
    const [rows] = await db.execute(
      `SELECT t.id, t.name, t.start_date, t.course_id, t.total_rounds, c.name AS course_name
         FROM tournaments t
         LEFT JOIN courses c ON c.id = t.course_id
        WHERE t.club_id = ?
          AND t.name NOT REGEXP '^Treino [0-9]{4}-[0-9]{2}-[0-9]{2}$'
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
      `SELECT id, name, start_date, course_id, total_rounds, scoring_type, modality
         FROM tournaments
        WHERE id = ? AND club_id = ?`,
      [tournamentId, req.club.id]
    );
    if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
    const modalityMat = tournament.modality || 'individual';

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

    // Onda B · Commit 3.12: matriz bifurca por modality. Doubles retorna
    // groups[].duplas (id, name = dupla_name) em vez de players[]; scores
    // trazem dupla_id no lugar de user_id.
    // Commit 3.16: name passa a ser o formato compacto ("J. Silva / P. Santos")
    // computado a partir dos jogadores da dupla, nao mais dupla_name livre.
    const groups = [];
    const gmap = new Map();
    if (modalityMat === 'doubles') {
      const { formatDuplaFromPlayers } = require('../utils/duplaName');
      // 1. Coleta grupos + duplas escaladas
      const [groupRows] = await db.execute(
        `SELECT tg.id AS group_id, tg.group_name, tg.starting_hole, tg.tee_time,
                d.id AS dupla_id, d.dupla_name
           FROM tournament_groups tg
           LEFT JOIN group_duplas gd ON gd.group_id = tg.id
           LEFT JOIN tournament_duplas d ON d.id = gd.dupla_id
          WHERE tg.tournament_id = ?
          ORDER BY tg.id ASC, d.dupla_name ASC`,
        [tournamentId]
      );
      // 2. Coleta players das duplas envolvidas (2 nomes por dupla)
      const duplaIdsMat = [...new Set(groupRows.filter(r => r.dupla_id).map(r => r.dupla_id))];
      const playersByDuplaMat = new Map();
      if (duplaIdsMat.length > 0) {
        const placeholdersMat = duplaIdsMat.map(() => '?').join(',');
        const [pRowsMat] = await db.execute(
          `SELECT tdp.dupla_id, u.name
             FROM tournament_dupla_players tdp
             JOIN users u ON u.id = tdp.user_id
            WHERE tdp.dupla_id IN (${placeholdersMat})
            ORDER BY u.name`,
          duplaIdsMat
        );
        for (const p of pRowsMat) {
          if (!playersByDuplaMat.has(p.dupla_id)) playersByDuplaMat.set(p.dupla_id, []);
          playersByDuplaMat.get(p.dupla_id).push({ name: p.name });
        }
      }
      for (const r of groupRows) {
        if (!gmap.has(r.group_id)) {
          const g = {
            id: r.group_id, name: r.group_name,
            starting_hole: r.starting_hole, tee_time: r.tee_time,
            players: [], // vazio em doubles
          };
          gmap.set(r.group_id, g);
          groups.push(g);
        }
        if (r.dupla_id) {
          const players = playersByDuplaMat.get(r.dupla_id) || [];
          const shortName = formatDuplaFromPlayers(players) || r.dupla_name;
          gmap.get(r.group_id).players.push({
            id: r.dupla_id, name: shortName, is_dupla: true, players,
          });
        }
      }
    } else {
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
      for (const r of groupRows) {
        if (!gmap.has(r.group_id)) {
          const g = {
            id: r.group_id, name: r.group_name,
            starting_hole: r.starting_hole, tee_time: r.tee_time,
            players: [],
          };
          gmap.set(r.group_id, g);
          groups.push(g);
        }
        if (r.user_id) {
          gmap.get(r.group_id).players.push({ id: r.user_id, name: r.user_name });
        }
      }
    }

    // Scores: em doubles envia dupla_id como "user_id" no response pra frontend
    // usar a mesma chave de indexacao. Preserva o campo original tambem.
    const scoreSelectField = modalityMat === 'doubles'
      ? 'dupla_id AS user_id, dupla_id'
      : 'user_id';
    const [scores] = await db.execute(
      `SELECT ${scoreSelectField}, hole_number, round_number, strokes, result_kind
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

    // Onda A · commit 3: expõe result_points[] pra AdminScoreEditor renderizar
    // dropdown de resultados quando scoring_type='result_points'. Torneio strokes
    // vem com array vazio — editor ignora.
    // Bloco 2 · Commit 2.2 (2026-09-01): cada linha traz enabled — editor esconde
    // opções desativadas do dropdown.
    const [rpRows] = await db.execute(
      `SELECT result_kind, points, enabled FROM tournament_result_points WHERE tournament_id = ?`,
      [tournamentId]
    );

    res.json({ tournament, holes, groups, scores, rounds: roundRows, result_points: rpRows });
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
  // Onda B · Commit 3.3: em torneio doubles o admin edita cell por dupla_id;
  // em individual continua por user_id. XOR obrigatório no payload.
  const user_id_raw   = req.body.user_id;
  const dupla_id_raw  = req.body.dupla_id;
  const hole_number   = Number(req.body.hole_number);
  const round_number  = req.body.round_number !== undefined ? Number(req.body.round_number) : 1;
  const strokesRaw    = req.body.strokes;
  // Onda A · commit 3: em torneios result_points o admin edita o RESULTADO;
  // strokes é derivado server-side. Se for delete (limpar célula), aceita
  // strokes vazio OU result_kind vazio — ambos indicam "apaga a linha".
  const resultKindRaw = req.body.result_kind;

  if (!tournament_id || !hole_number) {
    return res.status(400).json({ error: "Dados incompletos." });
  }
  if (!Number.isInteger(round_number) || round_number < 1) {
    return res.status(400).json({ error: "round_number inválido." });
  }

  const reasonCheck = validateReason(req.body.reason);
  if (reasonCheck.error) return res.status(reasonCheck.status).json({ error: reasonCheck.error });
  const reason = reasonCheck.reason;

  // willDelete unificado: strokes vazio OU result_kind vazio (quando aplicável)
  // significam limpar a célula. A validação por modo acontece depois de saber
  // o scoring_type do torneio (dentro da transação, já com conn).
  const strokesEmpty = (strokesRaw === null || strokesRaw === undefined || strokesRaw === "");
  const resultKindEmpty = (resultKindRaw === null || resultKindRaw === undefined || resultKindRaw === "");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Escopo do clube + total_rounds + scoring_type + modality. Nome do alvo
    // (jogador OU dupla) resolvido depois da bifurcação por modality.
    const [tRows] = await conn.execute(
      `SELECT id, total_rounds, scoring_type, modality
         FROM tournaments WHERE id = ? AND club_id = ?`,
      [tournament_id, req.club.id]
    );
    if (tRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Torneio não encontrado." });
    }
    const totalRounds = Number(tRows[0].total_rounds) || 1;
    const scoringType = tRows[0].scoring_type || 'strokes';
    const modality = tRows[0].modality || 'individual';
    if (round_number > totalRounds) {
      await conn.rollback();
      return res.status(400).json({
        error: `Rodada inválida: torneio tem ${totalRounds} rodada(s), tentou editar R${round_number}.`,
      });
    }

    // Onda B · Commit 3.3: resolve dono XOR + nome do alvo.
    let ownerUserId = null;
    let ownerDuplaId = null;
    let entityRef;
    let targetName;
    if (modality === 'doubles') {
      const did = Number(dupla_id_raw);
      if (!Number.isInteger(did) || did < 1) {
        await conn.rollback();
        return res.status(400).json({ error: 'Torneio em Duplas — envie dupla_id.' });
      }
      const [duplaRows] = await conn.execute(
        `SELECT dupla_name FROM tournament_duplas WHERE id = ? AND tournament_id = ?`,
        [did, tournament_id]
      );
      if (duplaRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Dupla não pertence a este torneio.' });
      }
      ownerDuplaId = did;
      entityRef = -did;
      targetName = duplaRows[0].dupla_name;
    } else {
      const uid = Number(user_id_raw);
      if (!Number.isInteger(uid) || uid < 1) {
        await conn.rollback();
        return res.status(400).json({ error: 'Torneio individual — envie user_id.' });
      }
      const [uRows] = await conn.execute('SELECT name FROM users WHERE id = ?', [uid]);
      if (uRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Jogador não encontrado.' });
      }
      ownerUserId = uid;
      entityRef = uid;
      targetName = uRows[0].name;
    }

    // Onda A · commit 3: valida payload por modo E deriva newStrokes/newResultKind.
    // Delete unificado: nos dois modos, campo vazio = limpar célula.
    let willDelete;
    let newStrokes = null;
    let newResultKind = null;
    if (scoringType === 'result_points') {
      willDelete = resultKindEmpty;
      if (!willDelete) {
        if (!RESULT_KINDS.includes(resultKindRaw)) {
          await conn.rollback();
          return res.status(400).json({
            error: `Torneio em Pontuação por Resultado — envie result_kind (${RESULT_KINDS.join(', ')}) ou vazio pra apagar.`,
          });
        }
        // Bloco 2 · Commit 2.2 (2026-09-01): rejeita result_kind desativado.
        // Vale pra edição do admin igual pra save do jogador — nao dá pra
        // corrigir um score PARA um resultado que o proprio torneio nao aceita.
        // Delete de célula (resultKindEmpty=true) continua permitido: apagar
        // dado antigo é sempre válido, mesmo se o kind tiver sido desativado.
        const enabledKinds = await getEnabledKinds(conn, tournament_id);
        if (!enabledKinds.has(resultKindRaw)) {
          await conn.rollback();
          return res.status(400).json({
            error: `Resultado '${resultKindRaw}' está desativado neste torneio.`,
          });
        }
        const par = await fetchPar(conn, tournament_id, round_number, hole_number);
        const derived = deriveStrokesFromResult(par, resultKindRaw);
        if (derived.error) {
          await conn.rollback();
          return res.status(400).json({ error: derived.error });
        }
        newStrokes = derived.strokes;
        newResultKind = resultKindRaw;
      }
    } else {
      // Modo strokes — comportamento antigo (ignora result_kind).
      willDelete = strokesEmpty;
      if (!willDelete) {
        const s = Number(strokesRaw);
        if (!Number.isInteger(s) || s < 1 || s > 20) {
          await conn.rollback();
          return res.status(400).json({ error: "Tacadas devem ser inteiro entre 1 e 20." });
        }
        newStrokes = s;
      }
    }

    // Alvo (jogador OU dupla) precisa estar escalado em algum grupo do torneio.
    // Individual: via group_players. Doubles: via group_duplas.
    let membership;
    if (modality === 'doubles') {
      [membership] = await conn.execute(
        `SELECT tg.id AS group_id
           FROM group_duplas gd
           JOIN tournament_groups tg ON tg.id = gd.group_id
          WHERE tg.tournament_id = ? AND gd.dupla_id = ?`,
        [tournament_id, ownerDuplaId]
      );
    } else {
      [membership] = await conn.execute(
        `SELECT tg.id AS group_id
           FROM group_players gp
           JOIN tournament_groups tg ON tg.id = gp.group_id
          WHERE tg.tournament_id = ? AND gp.user_id = ?`,
        [tournament_id, ownerUserId]
      );
    }
    if (membership.length === 0) {
      await conn.rollback();
      return res.status(400).json({
        error: modality === 'doubles'
          ? "Dupla não escalada em grupo deste torneio."
          : "Jogador não pertence a este torneio.",
      });
    }
    const affectedGroupIds = membership.map(r => r.group_id);

    // Valor anterior POR ROUND (pra audit). Filtra por user_id OU dupla_id
    // dependendo da modality — uk_score_v2 usa entity_ref mas a query
    // segue clara filtrando pelo dono real.
    const prevWhere = modality === 'doubles'
      ? 'tournament_id = ? AND dupla_id = ? AND hole_number = ? AND round_number = ?'
      : 'tournament_id = ? AND user_id = ? AND hole_number = ? AND round_number = ?';
    const prevOwner = modality === 'doubles' ? ownerDuplaId : ownerUserId;
    const [prevRows] = await conn.execute(
      `SELECT strokes, result_kind FROM scores WHERE ${prevWhere}`,
      [tournament_id, prevOwner, hole_number, round_number]
    );
    const previousStrokes = prevRows.length ? Number(prevRows[0].strokes) : null;
    const previousResultKind = prevRows.length ? (prevRows[0].result_kind || null) : null;

    const action = deriveAction(previousStrokes, newStrokes);
    // No-op agora considera os dois campos por modo. Em torneio strokes o
    // result_kind é sempre NULL, então basta comparar strokes (comportamento
    // antigo). Em torneio result_points, comparação por kind é o que importa
    // — se admin re-seleciona o mesmo resultado, é no-op.
    const isNoop = scoringType === 'result_points'
      ? (previousResultKind === newResultKind && previousStrokes === newStrokes)
      : (previousStrokes === newStrokes);
    if (isNoop) {
      await conn.rollback();
      return res.status(200).json({ ok: true, noop: true });
    }

    // Mutação — DELETE ou UPSERT via uk_score_v2 4-col (entity_ref).
    // Onda B · Commit 3.3: DELETE agora filtra por dupla_id em torneio doubles.
    // UPSERT carrega user_id XOR dupla_id conforme modality.
    if (willDelete) {
      await conn.execute(
        `DELETE FROM scores WHERE ${prevWhere}`,
        [tournament_id, prevOwner, hole_number, round_number]
      );
    } else {
      await conn.execute(
        `INSERT INTO scores (tournament_id, user_id, dupla_id, entity_ref, hole_number, round_number, strokes, result_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE strokes = VALUES(strokes), result_kind = VALUES(result_kind)`,
        [tournament_id, ownerUserId, ownerDuplaId, entityRef, hole_number, round_number, newStrokes, newResultKind]
      );
    }

    // Audit — inclui round_number + previous/new result_kind + target_dupla_id.
    // Onda B · Commit 3.3: target_user_id preenchido em individual, target_dupla_id
    // preenchido em doubles. FK ON DELETE SET NULL preserva histórico.
    const [auditResult] = await conn.execute(
      `INSERT INTO admin_score_audit
         (club_id, admin_user_id, context, tournament_id, training_group_id,
          target_user_id, target_dupla_id, hole_number, round_number,
          previous_strokes, previous_result_kind, new_strokes, new_result_kind,
          action, reason)
       VALUES (?, ?, 'tournament', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.club.id, req.user.id, tournament_id,
        ownerUserId, ownerDuplaId, hole_number, round_number,
        previousStrokes, previousResultKind, newStrokes, newResultKind,
        action, reason,
      ]
    );
    const auditId = auditResult.insertId;

    // Invalidar assinaturas ativas SÓ desta rodada — R1 continua válida se admin
    // editar R2. Sem esse filtro por round, uma correção em R3 invalidaria R1 e R2
    // que já estavam legitimamente assinadas.
    let invalidatedCount = 0;
    if (affectedGroupIds.length > 0) {
      const targetLabel = modality === 'doubles'
        ? `dupla ${targetName} (id=${ownerDuplaId})`
        : `jogador ${targetName} (id=${ownerUserId})`;
      const invalidatedReason =
        `Score R${round_number} do ${targetLabel} buraco ${hole_number} ` +
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
      previous_result_kind: previousResultKind,
      new_strokes: newStrokes,
      new_result_kind: newResultKind,
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
    // ?date=YYYY-MM-DD (opcional): quando presente, ignora a janela de 30 dias e
    // filtra por DATE(created_at) exato. Usado pelo botao "Ajustar Tacadas" no
    // AdminTrainings (cards por data) — abre o editor ja pre-filtrado.
    const dateFilter = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : null;

    const params = [req.club.id];
    let where = "tg.club_id = ?";
    if (dateFilter) {
      where += " AND DATE(tg.created_at) = ?";
      params.push(dateFilter);
    } else {
      where += " AND tg.created_at >= (NOW() - INTERVAL 30 DAY)";
    }

    const [rows] = await db.execute(
      `SELECT tg.id, tg.group_name, tg.status, tg.starting_hole,
              tg.course_id, tg.created_at, c.name AS course_name
         FROM training_groups tg
         LEFT JOIN courses c ON c.id = tg.course_id
        WHERE ${where}
        ORDER BY tg.created_at DESC, tg.id DESC`,
      params
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
              a.hole_number, a.round_number,
              a.previous_strokes, a.previous_result_kind,
              a.new_strokes, a.new_result_kind,
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
