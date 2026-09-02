// backend/controllers/scoreController.js
const db = require("../db");
const { deriveStrokesFromResult, fetchPar, RESULT_KINDS, getEnabledKinds } = require("../services/resultKindHelpers");

// Salvar (ou atualizar) o score de um buraco.
// Item 5 · commit 2 (2026-08-28): aceita round_number no payload (default 1).
// Grava via UPSERT atômico usando uk_score_v2(tournament_id,entity_ref,hole_number,round_number)
// — antes era DELETE+INSERT (janela de race). Bloco 3 · commit 3.1 substituiu uk_score
// (4-col em user_id) por uk_score_v2 (4-col em entity_ref) pra permitir doubles.
exports.saveScore = async (req, res) => {
  try {
    const { tournament_id, hole_number } = req.body;
    // Onda B · Bloco 3 · Commit 3.3: em torneio doubles o payload traz dupla_id
    // (nao user_id). user_id no body é ignorado nesse caso — dono do score é a
    // dupla. Em torneio individual (comportamento antigo), user_id continua
    // obrigatório.
    const user_id_raw = req.body.user_id;
    const dupla_id_raw = req.body.dupla_id;
    const round_number = req.body.round_number !== undefined ? Number(req.body.round_number) : 1;
    // Onda A · commit 3: em torneios strokes o payload traz strokes; em torneios
    // result_points traz result_kind (strokes é DERIVADO server-side pra evitar
    // qualquer chance de o client mandar strokes divergente do resultado escolhido).
    const strokesRaw = req.body.strokes;
    const resultKindRaw = req.body.result_kind;

    // Validação básica (dono verificado depois de saber a modality)
    if (!tournament_id || !hole_number) {
      return res.status(400).json({
        error: 'Dados incompletos. Envie tournament_id e hole_number.'
      });
    }
    if (!Number.isInteger(round_number) || round_number < 1) {
      return res.status(400).json({ error: 'round_number inválido.' });
    }

    // Verifica se o torneio pertence ao clube + pega total_rounds, scoring_type, modality
    const [tournamentCheck] = await db.execute(
      'SELECT id, total_rounds, scoring_type, modality FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;
    const scoringType = tournamentCheck[0].scoring_type || 'strokes';
    const modality = tournamentCheck[0].modality || 'individual';
    if (round_number > totalRounds) {
      return res.status(400).json({
        error: `Rodada inválida: torneio tem ${totalRounds} rodada(s), tentou gravar em R${round_number}.`,
      });
    }

    // Onda B · Commit 3.3: valida payload por modality e resolve dono do score.
    // ownerUserId + ownerDuplaId são XOR: exatamente um é !=null. entityRef é
    // o valor de bookkeeping do UNIQUE uk_score_v2 (user_id positivo, -dupla_id
    // negativo — namespaces não colidem).
    let ownerUserId = null;
    let ownerDuplaId = null;
    let entityRef;
    if (modality === 'doubles') {
      const did = Number(dupla_id_raw);
      if (!Number.isInteger(did) || did < 1) {
        return res.status(400).json({
          error: 'Torneio em Duplas — envie dupla_id (não user_id).',
        });
      }
      // Confirma dupla pertence a esse torneio (defesa contra dupla_id de outro torneio)
      const [duplaCheck] = await db.execute(
        'SELECT id FROM tournament_duplas WHERE id = ? AND tournament_id = ?',
        [did, tournament_id]
      );
      if (duplaCheck.length === 0) {
        return res.status(400).json({ error: 'Dupla não pertence a este torneio.' });
      }
      ownerDuplaId = did;
      entityRef = -did;
    } else {
      const uid = Number(user_id_raw);
      if (!Number.isInteger(uid) || uid < 1) {
        return res.status(400).json({
          error: 'Torneio individual — envie user_id.',
        });
      }
      ownerUserId = uid;
      entityRef = uid;
    }

    // Onda A · commit 3: modo de marcação define o que o payload precisa e como
    // derivar. finalStrokes/finalResultKind são o que vai gravado em `scores`.
    let finalStrokes = null;
    let finalResultKind = null;
    if (scoringType === 'result_points') {
      if (!RESULT_KINDS.includes(resultKindRaw)) {
        return res.status(400).json({
          error: `Torneio em modo Pontuação por Resultado — envie result_kind (${RESULT_KINDS.join(', ')}).`,
        });
      }
      // Bloco 2 · Commit 2.2 (2026-09-01): rejeita result_kind que o admin
      // desativou (enabled=0) no torneio — defesa contra frontend antigo ou
      // curl direto que ignora o filtro do ResultPicker. Regra de produto:
      // scores JA gravados com aquele kind seguem contando pontos; apenas
      // ESCRITA nova é bloqueada.
      const enabledKinds = await getEnabledKinds(db, tournament_id);
      if (!enabledKinds.has(resultKindRaw)) {
        return res.status(400).json({
          error: `Resultado '${resultKindRaw}' está desativado neste torneio.`,
        });
      }
      const par = await fetchPar(db, tournament_id, round_number, hole_number);
      const derived = deriveStrokesFromResult(par, resultKindRaw);
      if (derived.error) return res.status(400).json({ error: derived.error });
      finalStrokes = derived.strokes;
      finalResultKind = resultKindRaw;
    } else {
      // Modo strokes — comportamento antigo. Ignora result_kind se vier.
      const s = Number(strokesRaw);
      if (!Number.isInteger(s) || s < 1 || s > 20) {
        return res.status(400).json({ error: 'strokes obrigatório (inteiro entre 1 e 20) em torneio por tacadas.' });
      }
      finalStrokes = s;
      finalResultKind = null;
    }

    // Autorização de posse — caller precisa estar escalado num grupo da rodada.
    // Individual: via group_players. Doubles: via tournament_dupla_players +
    // group_duplas — caller precisa pertencer à MESMA dupla que ele está tentando
    // marcar (não pode marcar por dupla que não é a sua).
    //
    // Bloco D · hotfix 2026-08-29: membership inclui tg.round_number. Um jogador
    // do grupo de R1 nao pode gravar em R2 (mesmo com curl direto).
    const caller_id = req.user.id;
    let membership;
    if (modality === 'doubles') {
      [membership] = await db.execute(
        `SELECT 1 FROM tournament_dupla_players tdp
           JOIN group_duplas gd ON gd.dupla_id = tdp.dupla_id
           JOIN tournament_groups tg ON tg.id = gd.group_id
          WHERE tg.tournament_id = ?
            AND tdp.user_id = ?
            AND tdp.dupla_id = ?
            AND tg.round_number = ?
          LIMIT 1`,
        [tournament_id, caller_id, ownerDuplaId, round_number]
      );
    } else {
      [membership] = await db.execute(
        `SELECT 1 FROM group_players gp
           JOIN tournament_groups tg ON gp.group_id = tg.id
          WHERE tg.tournament_id = ? AND gp.user_id = ? AND tg.round_number = ?
          LIMIT 1`,
        [tournament_id, caller_id, round_number]
      );
    }
    if (membership.length === 0) {
      return res.status(403).json({
        error: modality === 'doubles'
          ? `Acesso negado. Você não pertence à dupla escalada nesta rodada.`
          : `Acesso negado. Você não pertence a um grupo da rodada ${round_number} deste torneio.`,
      });
    }

    // UPSERT atômico via uk_score_v2(tournament_id, entity_ref, hole_number, round_number).
    // Onda B · Commit 3.3: user_id XOR dupla_id — exatamente um é !=null.
    // entity_ref = user_id (individual) ou -dupla_id (doubles). Namespaces
    // separados garantem UNIQUE consistente.
    await db.execute(
      `INSERT INTO scores (tournament_id, user_id, dupla_id, entity_ref, hole_number, round_number, strokes, result_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE strokes = VALUES(strokes), result_kind = VALUES(result_kind)`,
      [tournament_id, ownerUserId, ownerDuplaId, entityRef, hole_number, round_number, finalStrokes, finalResultKind]
    );

    res.json({
      message: "Score salvo!",
      strokes: finalStrokes,
      result_kind: finalResultKind,
      hole: hole_number,
      round_number,
      dupla_id: ownerDuplaId,
      user_id: ownerUserId,
    });

  } catch (error) {
    console.error('Erro ao salvar score:', error);
    res.status(500).json({
      error: 'Erro interno no servidor.'
    });
  }
};

// Assinar cartão oficial do grupo: valida server-side que todos os group_players têm
// score em TODOS os buracos do course, e grava assinatura em tournament_scorecard_signatures.
// Antes, "Assinar Cartão" era só ação de UI — sem prova. Bug B — fix 2026-08-13.
// Item 5 · commit 2 (2026-08-28): assinatura POR RODADA — cada round tem seu cartão.
// round_number opcional (default 1). uk_sig 4-col permite N assinaturas por grupo.
exports.signCard = async (req, res) => {
  try {
    const tournament_id = Number(req.body.tournament_id);
    const group_id      = Number(req.body.group_id);
    const round_number  = req.body.round_number !== undefined ? Number(req.body.round_number) : 1;
    const caller_id     = req.user.id;

    if (!tournament_id || !group_id) {
      return res.status(400).json({ error: 'Dados incompletos. Envie tournament_id e group_id.' });
    }
    if (!Number.isInteger(round_number) || round_number < 1) {
      return res.status(400).json({ error: 'round_number inválido.' });
    }

    // Escopo do clube via tournament + pega total_rounds + modality. Se rodada específica veio,
    // usa o course_id da tournament_rounds daquela rodada (pra torneios multi que
    // rodam em campos diferentes por dia).
    const [tournamentCheck] = await db.execute(
      'SELECT id, course_id, total_rounds, modality FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;
    const modality = tournamentCheck[0].modality || 'individual';
    if (round_number > totalRounds) {
      return res.status(400).json({ error: `Rodada inválida: torneio tem ${totalRounds} rodada(s).` });
    }
    let courseId = tournamentCheck[0].course_id;
    if (totalRounds > 1) {
      const [[roundRow]] = await db.execute(
        'SELECT course_id FROM tournament_rounds WHERE tournament_id = ? AND round_number = ?',
        [tournament_id, round_number]
      );
      if (roundRow) courseId = roundRow.course_id;
    }

    // Caller precisa estar escalado no grupo. Individual: group_players.
    // Doubles: tournament_dupla_players de uma dupla que está em group_duplas
    // desse grupo. Também resolve callerDuplaId pra gravar na assinatura.
    let callerDuplaId = null;
    if (modality === 'doubles') {
      const [duplaMembership] = await db.execute(
        `SELECT gd.dupla_id
           FROM group_duplas gd
           JOIN tournament_dupla_players tdp ON tdp.dupla_id = gd.dupla_id
          WHERE gd.group_id = ? AND tdp.user_id = ?
          LIMIT 1`,
        [group_id, caller_id]
      );
      if (duplaMembership.length === 0) {
        return res.status(403).json({ error: 'Acesso negado. Você não participa deste grupo.' });
      }
      callerDuplaId = duplaMembership[0].dupla_id;
    } else {
      const [membership] = await db.execute(
        `SELECT 1 FROM group_players
          WHERE group_id = ? AND user_id = ? LIMIT 1`,
        [group_id, caller_id]
      );
      if (membership.length === 0) {
        return res.status(403).json({ error: 'Acesso negado. Você não participa deste grupo.' });
      }
    }

    // Confirma que o grupo pertence ao torneio recebido E que a rodada bate.
    // Bloco D · hotfix 2026-08-29: se payload.round_number != tg.round_number,
    // 403 — impede assinar cartao "de outra rodada" via requisicao forcada.
    const [groupCheck] = await db.execute(
      'SELECT id, round_number FROM tournament_groups WHERE id = ? AND tournament_id = ?',
      [group_id, tournament_id]
    );
    if (groupCheck.length === 0) {
      return res.status(400).json({ error: 'Grupo não pertence ao torneio informado.' });
    }
    if (Number(groupCheck[0].round_number) !== round_number) {
      return res.status(403).json({
        error: `Rodada divergente: grupo pertence a R${groupCheck[0].round_number}, tentou assinar em R${round_number}.`,
      });
    }

    // Quantidade real de buracos do course. Fallback 18 caso o course não tenha
    // holes cadastrados (evita bloquear assinatura por falta de dado de campo).
    const [[{ hole_count }]] = await db.execute(
      'SELECT COUNT(*) AS hole_count FROM holes WHERE course_id = ?',
      [courseId]
    );
    const expected = hole_count > 0 ? hole_count : 18;

    // Onda B · Commit 3.4: verificação de completude bifurca por modality.
    // Doubles: cada dupla escalada no grupo precisa ter score em todos os buracos
    // (uma linha por dupla × buraco). Individual: mesma coisa por user_id.
    const missing = [];
    if (modality === 'doubles') {
      const [duplas] = await db.execute(
        `SELECT gd.dupla_id, d.dupla_name,
                COUNT(s.hole_number) AS holes_played
           FROM group_duplas gd
           JOIN tournament_duplas d ON d.id = gd.dupla_id
           LEFT JOIN scores s
                  ON s.tournament_id = ?
                 AND s.dupla_id      = gd.dupla_id
                 AND s.round_number  = ?
                 AND s.hole_number BETWEEN 1 AND ?
          WHERE gd.group_id = ?
          GROUP BY gd.dupla_id, d.dupla_name`,
        [tournament_id, round_number, expected, group_id]
      );
      for (const d of duplas) {
        if (Number(d.holes_played) < expected) {
          const [rows] = await db.execute(
            `SELECT hole_number FROM scores
              WHERE tournament_id = ? AND dupla_id = ? AND round_number = ? AND hole_number BETWEEN 1 AND ?`,
            [tournament_id, d.dupla_id, round_number, expected]
          );
          const have = new Set(rows.map(r => Number(r.hole_number)));
          const holes = [];
          for (let h = 1; h <= expected; h++) if (!have.has(h)) holes.push(h);
          missing.push({ dupla_id: d.dupla_id, name: d.dupla_name, missing_holes: holes });
        }
      }
    } else {
      const [players] = await db.execute(
        `SELECT gp.user_id, u.name,
                COUNT(s.hole_number) AS holes_played
           FROM group_players gp
           JOIN users u ON u.id = gp.user_id
           LEFT JOIN scores s
                  ON s.tournament_id = ?
                 AND s.user_id       = gp.user_id
                 AND s.round_number  = ?
                 AND s.hole_number BETWEEN 1 AND ?
          WHERE gp.group_id = ?
          GROUP BY gp.user_id, u.name`,
        [tournament_id, round_number, expected, group_id]
      );
      for (const p of players) {
        if (Number(p.holes_played) < expected) {
          const [rows] = await db.execute(
            `SELECT hole_number FROM scores
              WHERE tournament_id = ? AND user_id = ? AND round_number = ? AND hole_number BETWEEN 1 AND ?`,
            [tournament_id, p.user_id, round_number, expected]
          );
          const have = new Set(rows.map(r => Number(r.hole_number)));
          const holes = [];
          for (let h = 1; h <= expected; h++) if (!have.has(h)) holes.push(h);
          missing.push({ user_id: p.user_id, name: p.name, missing_holes: holes });
        }
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Cartão incompleto — não pode ser assinado.',
        expected_holes: expected,
        missing,
      });
    }

    // OK, tudo completo — grava assinatura por (tournament, group, user, round).
    // uk_sig 4-col garante idempotência: assinar 2x na mesma round → só atualiza signed_at.
    // Onda B · Commit 3.4: em torneio doubles, user_id continua sendo o caller
    // (rastreio de QUEM apertou), dupla_id carrega a identidade da assinatura
    // (decisão 5: qualquer jogador da dupla assina em nome dela).
    await db.execute(
      `INSERT INTO tournament_scorecard_signatures (tournament_id, group_id, user_id, dupla_id, round_number)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE signed_at = CURRENT_TIMESTAMP,
                               invalidated_at = NULL,
                               invalidated_reason = NULL,
                               dupla_id = VALUES(dupla_id)`,
      [tournament_id, group_id, caller_id, callerDuplaId, round_number]
    );

    const [[sig]] = await db.execute(
      `SELECT signed_at FROM tournament_scorecard_signatures
        WHERE tournament_id = ? AND group_id = ? AND user_id = ? AND round_number = ?`,
      [tournament_id, group_id, caller_id, round_number]
    );

    res.json({ ok: true, signed_at: sig.signed_at, round_number });
  } catch (error) {
    console.error('[signCard] Erro:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Retorna se o grupo já foi assinado — usado pra UI mostrar estado "Cartão Assinado".
// Item 5 · commit 2: query param ?round=N filtra a rodada (default 1). Formato
// mantido igual (objeto único ou null) pra frontend antigo não quebrar.
exports.getSignature = async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const round_number = req.query.round !== undefined ? Number(req.query.round) : 1;
    if (!Number.isInteger(round_number) || round_number < 1) {
      return res.status(400).json({ error: 'round inválido.' });
    }
    const [rows] = await db.execute(
      `SELECT s.signed_at, s.user_id, u.name AS signed_by_name,
              s.invalidated_at, s.invalidated_reason, s.round_number
         FROM tournament_scorecard_signatures s
         JOIN users u ON u.id = s.user_id
         JOIN tournament_groups tg ON tg.id = s.group_id
         JOIN tournaments t ON t.id = tg.tournament_id
        WHERE s.group_id = ? AND s.round_number = ? AND t.club_id = ?
        ORDER BY s.signed_at DESC LIMIT 1`,
      [groupId, round_number, req.club.id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    console.error('[getSignature] Erro:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Carregar todos os scores do torneio (para preencher o cartão)
exports.getScores = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    if (!tournamentId) {
      return res.status(400).json({ 
        error: 'ID do torneio não fornecido.' 
      });
    }

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    // Item 5 · commit 2: retorna round_number pra frontend novo distinguir.
    // Frontend antigo ignora — comportamento inalterado pra torneio single-round
    // (todas as linhas têm round_number=1). Opcional filtrar por ?round=N.
    const round = req.query.round;
    const params = [tournamentId];
    let whereRound = '';
    if (round !== undefined && round !== '' && round !== 'all') {
      const rn = Number(round);
      if (!Number.isInteger(rn) || rn < 1) {
        return res.status(400).json({ error: 'round inválido.' });
      }
      whereRound = ' AND round_number = ?';
      params.push(rn);
    }
    // Onda A · commit 3: retorna result_kind (NULL em torneios strokes). Frontend
    // novo consome pra pré-selecionar o botão certo no ResultPicker; frontend
    // antigo ignora o campo, comportamento inalterado.
    // Onda B · Commit 3.3: retorna dupla_id (NULL em torneios individuais).
    // Frontend antigo ignora o campo. Torneio doubles vem só com dupla_id
    // preenchido e user_id NULL.
    const [results] = await db.execute(
      `SELECT user_id, dupla_id, hole_number, round_number, strokes, result_kind FROM scores WHERE tournament_id = ?${whereRound}`,
      params
    );

    res.json(results);
    
  } catch (error) {
    console.error('Erro ao buscar scores:', error);
    res.status(500).json({ 
      error: 'Erro interno no servidor.'
    });
  }
};