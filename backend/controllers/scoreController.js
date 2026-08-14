// backend/controllers/scoreController.js
const db = require("../db");

// Salvar (ou atualizar) o score de um buraco com Faxina Automática!
exports.saveScore = async (req, res) => {
  try {
    const { tournament_id, user_id, hole_number, strokes } = req.body;

    // Validação básica dos dados
    if (!tournament_id || !user_id || !hole_number || strokes === undefined) {
      return res.status(400).json({ 
        error: 'Dados incompletos. Envie tournament_id, user_id, hole_number e strokes.' 
      });
    }

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    // Autorização de posse (espelha TrainingController.saveScore): o user_id do
    // body é o jogador alvo (colega no cartão), mas quem CHAMA precisa estar
    // escalado num grupo deste torneio. Impede lançar score em torneio alheio.
    const caller_id = req.user.id;
    const [membership] = await db.execute(
      `SELECT 1 FROM group_players gp
         JOIN tournament_groups tg ON gp.group_id = tg.id
        WHERE tg.tournament_id = ? AND gp.user_id = ?
        LIMIT 1`,
      [tournament_id, caller_id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ error: 'Acesso negado. Você não participa deste torneio.' });
    }

    // 1. PRIMEIRO PASSO: Deleta qualquer pontuação velha ou duplicada desse jogador nesse buraco
    const deleteQuery =
      "DELETE FROM scores WHERE tournament_id = ? AND user_id = ? AND hole_number = ?";

    await db.execute(deleteQuery, [tournament_id, user_id, hole_number]);

    // 2. SEGUNDO PASSO: Insere a pontuação nova e exata, garantindo que seja a ÚNICA!
    const insertQuery =
      "INSERT INTO scores (tournament_id, user_id, hole_number, strokes) VALUES (?, ?, ?, ?)";

    await db.execute(insertQuery, [tournament_id, user_id, hole_number, strokes]);
    
    res.json({ 
      message: "Score salvo limpo e sem duplicar!", 
      strokes,
      hole: hole_number
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
exports.signCard = async (req, res) => {
  try {
    const tournament_id = Number(req.body.tournament_id);
    const group_id      = Number(req.body.group_id);
    const caller_id     = req.user.id;

    if (!tournament_id || !group_id) {
      return res.status(400).json({ error: 'Dados incompletos. Envie tournament_id e group_id.' });
    }

    // Escopo do clube via tournament (impede assinar cartão de torneio alheio)
    const [tournamentCheck] = await db.execute(
      'SELECT id, course_id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    const courseId = tournamentCheck[0].course_id;

    // Caller precisa estar escalado no grupo (mesmo padrão do saveScore)
    const [membership] = await db.execute(
      `SELECT 1 FROM group_players
        WHERE group_id = ? AND user_id = ? LIMIT 1`,
      [group_id, caller_id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ error: 'Acesso negado. Você não participa deste grupo.' });
    }

    // Confirma que o grupo pertence ao torneio recebido
    const [groupCheck] = await db.execute(
      'SELECT id FROM tournament_groups WHERE id = ? AND tournament_id = ?',
      [group_id, tournament_id]
    );
    if (groupCheck.length === 0) {
      return res.status(400).json({ error: 'Grupo não pertence ao torneio informado.' });
    }

    // Quantidade real de buracos do course. Fallback 18 caso o course não tenha
    // holes cadastrados (evita bloquear assinatura por falta de dado de campo).
    const [[{ hole_count }]] = await db.execute(
      'SELECT COUNT(*) AS hole_count FROM holes WHERE course_id = ?',
      [courseId]
    );
    const expected = hole_count > 0 ? hole_count : 18;

    // Jogadores do grupo + contagem de scores por jogador
    const [players] = await db.execute(
      `SELECT gp.user_id, u.name,
              COUNT(s.hole_number) AS holes_played
         FROM group_players gp
         JOIN users u ON u.id = gp.user_id
         LEFT JOIN scores s
                ON s.tournament_id = ?
               AND s.user_id       = gp.user_id
               AND s.hole_number BETWEEN 1 AND ?
        WHERE gp.group_id = ?
        GROUP BY gp.user_id, u.name`,
      [tournament_id, expected, group_id]
    );

    // Detecta quem está incompleto e QUAIS buracos faltam (pra UI mostrar).
    const missing = [];
    for (const p of players) {
      if (Number(p.holes_played) < expected) {
        const [rows] = await db.execute(
          `SELECT hole_number FROM scores
            WHERE tournament_id = ? AND user_id = ? AND hole_number BETWEEN 1 AND ?`,
          [tournament_id, p.user_id, expected]
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

    // OK, tudo completo — grava assinatura (idempotente via UNIQUE KEY)
    await db.execute(
      `INSERT INTO tournament_scorecard_signatures (tournament_id, group_id, user_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE signed_at = CURRENT_TIMESTAMP`,
      [tournament_id, group_id, caller_id]
    );

    const [[sig]] = await db.execute(
      `SELECT signed_at FROM tournament_scorecard_signatures
        WHERE tournament_id = ? AND group_id = ? AND user_id = ?`,
      [tournament_id, group_id, caller_id]
    );

    res.json({ ok: true, signed_at: sig.signed_at });
  } catch (error) {
    console.error('[signCard] Erro:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Retorna se o grupo já foi assinado (por qualquer usuário) — usado pra UI mostrar
// estado "Cartão Assinado em <data>" caso o usuário volte à tela depois de assinar.
exports.getSignature = async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const [rows] = await db.execute(
      `SELECT s.signed_at, s.user_id, u.name AS signed_by_name
         FROM tournament_scorecard_signatures s
         JOIN users u ON u.id = s.user_id
         JOIN tournament_groups tg ON tg.id = s.group_id
         JOIN tournaments t ON t.id = tg.tournament_id
        WHERE s.group_id = ? AND t.club_id = ?
        ORDER BY s.signed_at DESC LIMIT 1`,
      [groupId, req.club.id]
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

    const query =
      "SELECT user_id, hole_number, strokes FROM scores WHERE tournament_id = ?";

    const [results] = await db.execute(query, [tournamentId]);
    
    res.json(results);
    
  } catch (error) {
    console.error('Erro ao buscar scores:', error);
    res.status(500).json({ 
      error: 'Erro interno no servidor.'
    });
  }
};