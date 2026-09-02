// backend/controllers/scoreController.js
const db = require("../db");
const { deriveStrokesFromResult, fetchPar, RESULT_KINDS, getEnabledKinds } = require("../services/resultKindHelpers");

// Salvar (ou atualizar) o score de um buraco.
// Item 5 · commit 2 (2026-08-28): aceita round_number no payload (default 1).
// Grava via UPSERT atômico usando uk_score(tournament_id,user_id,hole_number,round_number)
// — antes era DELETE+INSERT (janela de race). Como uk_score agora inclui round_number,
// o UPSERT resolve tanto single-round (round=1) quanto multi-rodada corretamente.
exports.saveScore = async (req, res) => {
  try {
    const { tournament_id, user_id, hole_number } = req.body;
    const round_number = req.body.round_number !== undefined ? Number(req.body.round_number) : 1;
    // Onda A · commit 3: em torneios strokes o payload traz strokes; em torneios
    // result_points traz result_kind (strokes é DERIVADO server-side pra evitar
    // qualquer chance de o client mandar strokes divergente do resultado escolhido).
    const strokesRaw = req.body.strokes;
    const resultKindRaw = req.body.result_kind;

    // Validação básica dos dados (strokes/result_kind checados abaixo por modo)
    if (!tournament_id || !user_id || !hole_number) {
      return res.status(400).json({
        error: 'Dados incompletos. Envie tournament_id, user_id e hole_number.'
      });
    }
    if (!Number.isInteger(round_number) || round_number < 1) {
      return res.status(400).json({ error: 'round_number inválido.' });
    }

    // Verifica se o torneio pertence ao clube + pega total_rounds e scoring_type
    const [tournamentCheck] = await db.execute(
      'SELECT id, total_rounds, scoring_type FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;
    const scoringType = tournamentCheck[0].scoring_type || 'strokes';
    if (round_number > totalRounds) {
      return res.status(400).json({
        error: `Rodada inválida: torneio tem ${totalRounds} rodada(s), tentou gravar em R${round_number}.`,
      });
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

    // Autorização de posse (espelha TrainingController.saveScore): o user_id do
    // body é o jogador alvo (colega no cartão), mas quem CHAMA precisa estar
    // escalado num grupo deste torneio.
    //
    // Bloco D · hotfix 2026-08-29: agora o membership inclui tg.round_number.
    // Um jogador do grupo de R1 nao pode gravar em R2 (mesmo com curl direto),
    // pois grupos por rodada podem ser DIFERENTES apos re-seeding. Se o caller
    // esta num grupo com round_number = payload.round_number, permite; senao
    // 403. Torneio single-round: todos os grupos tem round=1, comportamento
    // antigo preservado.
    const caller_id = req.user.id;
    const [membership] = await db.execute(
      `SELECT 1 FROM group_players gp
         JOIN tournament_groups tg ON gp.group_id = tg.id
        WHERE tg.tournament_id = ? AND gp.user_id = ? AND tg.round_number = ?
        LIMIT 1`,
      [tournament_id, caller_id, round_number]
    );
    if (membership.length === 0) {
      return res.status(403).json({
        error: `Acesso negado. Você não pertence a um grupo da rodada ${round_number} deste torneio.`,
      });
    }

    // UPSERT atômico via uk_score_v2(tournament_id, entity_ref, hole_number, round_number).
    // Substitui o antigo DELETE+INSERT — agora que o uk cobre round_number,
    // ON DUPLICATE KEY UPDATE resolve nativamente e sem race.
    // Onda A · commit 3: grava result_kind também (NULL em torneio strokes).
    // Onda B · Bloco 3 · Commit B1.1 (2026-09-01): entity_ref = user_id em modo
    // individual (todo torneio hoje). Modo doubles (com dupla_id) chega no B1.3.
    const entityRef = user_id;
    await db.execute(
      `INSERT INTO scores (tournament_id, user_id, entity_ref, hole_number, round_number, strokes, result_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE strokes = VALUES(strokes), result_kind = VALUES(result_kind)`,
      [tournament_id, user_id, entityRef, hole_number, round_number, finalStrokes, finalResultKind]
    );

    res.json({
      message: "Score salvo!",
      strokes: finalStrokes,
      result_kind: finalResultKind,
      hole: hole_number,
      round_number,
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

    // Escopo do clube via tournament + pega total_rounds. Se rodada específica veio,
    // usa o course_id da tournament_rounds daquela rodada (pra torneios multi que
    // rodam em campos diferentes por dia).
    const [tournamentCheck] = await db.execute(
      'SELECT id, course_id, total_rounds FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;
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

    // Caller precisa estar escalado no grupo (mesmo padrão do saveScore)
    const [membership] = await db.execute(
      `SELECT 1 FROM group_players
        WHERE group_id = ? AND user_id = ? LIMIT 1`,
      [group_id, caller_id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ error: 'Acesso negado. Você não participa deste grupo.' });
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

    // Jogadores do grupo + contagem de scores por jogador NESTA rodada
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

    // Detecta quem está incompleto e QUAIS buracos faltam (pra UI mostrar) — nesta rodada
    const missing = [];
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

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Cartão incompleto — não pode ser assinado.',
        expected_holes: expected,
        missing,
      });
    }

    // OK, tudo completo — grava assinatura por (tournament, group, user, round).
    // uk_sig 4-col garante idempotência: assinar 2x na mesma round → só atualiza signed_at.
    await db.execute(
      `INSERT INTO tournament_scorecard_signatures (tournament_id, group_id, user_id, round_number)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE signed_at = CURRENT_TIMESTAMP,
                               invalidated_at = NULL,
                               invalidated_reason = NULL`,
      [tournament_id, group_id, caller_id, round_number]
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
    const [results] = await db.execute(
      `SELECT user_id, hole_number, round_number, strokes, result_kind FROM scores WHERE tournament_id = ?${whereRound}`,
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