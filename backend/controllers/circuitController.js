// backend/controllers/circuitController.js
const db = require('../db');
const { calculateCircuitRanking } = require('../services/CircuitService');

// ─── CIRCUITS ────────────────────────────────────────────────────────────────

exports.listCircuits = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM circuits WHERE club_id = ? ORDER BY created_at DESC',
      [req.club.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar circuitos:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.getCircuit = async (req, res) => {
  try {
    const { id } = req.params;

    const [circuits] = await db.execute(
      'SELECT * FROM circuits WHERE id = ? AND club_id = ?',
      [id, req.club.id]
    );
    if (!circuits.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    const [stages] = await db.execute(`
      SELECT cs.id, cs.stage_number, cs.tournament_id,
             t.name AS tournament_name, t.status AS tournament_status
      FROM circuit_stages cs
      JOIN tournaments t ON cs.tournament_id = t.id
      WHERE cs.circuit_id = ?
      ORDER BY cs.stage_number ASC
    `, [id]);

    const [rules] = await db.execute(
      'SELECT id, position, points FROM circuit_point_rules WHERE circuit_id = ? ORDER BY position ASC',
      [id]
    );

    res.json({ ...circuits[0], stages, rules });
  } catch (err) {
    console.error('Erro ao buscar circuito:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.createCircuit = async (req, res) => {
  try {
    const { name, description, total_stages, num_discards } = req.body;
    if (!name || !total_stages) {
      return res.status(400).json({ error: 'name e total_stages são obrigatórios.' });
    }
    const [result] = await db.execute(
      'INSERT INTO circuits (name, description, total_stages, num_discards, club_id) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, total_stages, Number(num_discards) || 0, req.club.id]
    );
    res.status(201).json({ message: 'Circuito criado!', id: result.insertId });
  } catch (err) {
    console.error('Erro ao criar circuito:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.updateCircuit = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, total_stages, num_discards } = req.body;
    const [result] = await db.execute(
      'UPDATE circuits SET name=?, description=?, total_stages=?, num_discards=? WHERE id=? AND club_id=?',
      [name, description || null, total_stages, Number(num_discards) || 0, id, req.club.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Circuito não encontrado.' });
    res.json({ message: 'Circuito atualizado!' });
  } catch (err) {
    console.error('Erro ao atualizar circuito:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.deleteCircuit = async (req, res) => {
  try {
    const { id } = req.params;
    const [check] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [id, req.club.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    await db.execute('DELETE FROM circuit_point_rules WHERE circuit_id = ?', [id]);
    await db.execute('DELETE FROM circuit_stages WHERE circuit_id = ?', [id]);
    await db.execute('DELETE FROM circuits WHERE id = ?', [id]);

    res.json({ message: 'Circuito excluído!' });
  } catch (err) {
    console.error('Erro ao excluir circuito:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── STAGES ──────────────────────────────────────────────────────────────────

exports.addStage = async (req, res) => {
  try {
    const { id: circuit_id } = req.params;
    const { tournament_id, stage_number } = req.body;

    if (!tournament_id || !stage_number) {
      return res.status(400).json({ error: 'tournament_id e stage_number são obrigatórios.' });
    }

    const [circuitCheck] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!circuitCheck.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    const [tournCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    if (!tournCheck.length) return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });

    const [result] = await db.execute(
      'INSERT INTO circuit_stages (circuit_id, tournament_id, stage_number) VALUES (?, ?, ?)',
      [circuit_id, tournament_id, stage_number]
    );
    res.status(201).json({ message: 'Etapa adicionada!', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Número de etapa ou torneio já vinculado a este circuito.' });
    }
    console.error('Erro ao adicionar etapa:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.removeStage = async (req, res) => {
  try {
    const { id: circuit_id, stageId } = req.params;

    const [circuitCheck] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!circuitCheck.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    const [result] = await db.execute(
      'DELETE FROM circuit_stages WHERE id = ? AND circuit_id = ?',
      [stageId, circuit_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Etapa não encontrada.' });

    res.json({ message: 'Etapa removida!' });
  } catch (err) {
    console.error('Erro ao remover etapa:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── POINT RULES ─────────────────────────────────────────────────────────────

exports.setRules = async (req, res) => {
  try {
    const { id: circuit_id } = req.params;
    const { rules } = req.body;

    const [circuitCheck] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!circuitCheck.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    if (!Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({ error: 'Envie um array de regras: [{ position, points }].' });
    }

    await db.execute('DELETE FROM circuit_point_rules WHERE circuit_id = ?', [circuit_id]);
    const values = rules.map(r => [circuit_id, Number(r.position), Number(r.points)]);
    await db.query('INSERT INTO circuit_point_rules (circuit_id, position, points) VALUES ?', [values]);

    res.json({ message: 'Regras de pontuação salvas!' });
  } catch (err) {
    console.error('Erro ao salvar regras:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── RANKING ─────────────────────────────────────────────────────────────────

exports.getCircuitRanking = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await calculateCircuitRanking(id, req.club.id);
    if (!result) return res.status(404).json({ error: 'Circuito não encontrado.' });
    res.json(result);
  } catch (err) {
    console.error('Erro ao calcular ranking do circuito:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── MANUAL POSITIONS (pódio após playoff) ───────────────────────────────────

exports.setManualPositions = async (req, res) => {
  try {
    const { id: circuit_id, stageId } = req.params;
    const { positions } = req.body; // [{ user_id, manual_position }]

    const [circuitCheck] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!circuitCheck.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    const [stageRows] = await db.execute(
      'SELECT tournament_id FROM circuit_stages WHERE id = ? AND circuit_id = ?',
      [stageId, circuit_id]
    );
    if (!stageRows.length) return res.status(404).json({ error: 'Etapa não encontrada.' });

    if (!Array.isArray(positions) || !positions.length) {
      return res.status(400).json({ error: 'Envie positions: [{ user_id, manual_position }].' });
    }

    const tournamentId = stageRows[0].tournament_id;

    for (const p of positions) {
      await db.execute(
        'UPDATE inscriptions SET manual_position = ? WHERE user_id = ? AND tournament_id = ?',
        [p.manual_position, p.user_id, tournamentId]
      );
    }

    res.json({ message: 'Pódio definido!' });
  } catch (err) {
    console.error('Erro ao salvar posições manuais:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── CLEAR MANUAL POSITIONS ──────────────────────────────────────────────────

exports.clearManualPositions = async (req, res) => {
  try {
    const { id: circuit_id, stageId } = req.params;

    const [circuitCheck] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!circuitCheck.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    const [stageRows] = await db.execute(
      'SELECT tournament_id FROM circuit_stages WHERE id = ? AND circuit_id = ?',
      [stageId, circuit_id]
    );
    if (!stageRows.length) return res.status(404).json({ error: 'Etapa não encontrada.' });

    await db.execute(
      'UPDATE inscriptions SET manual_position = NULL WHERE tournament_id = ?',
      [stageRows[0].tournament_id]
    );

    res.json({ message: 'Posições manuais removidas.' });
  } catch (err) {
    console.error('Erro ao limpar posições manuais:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── ADMIN SCORECARD EDIT ────────────────────────────────────────────────────

exports.adminEditScorecard = async (req, res) => {
  try {
    const { id: circuit_id, stageId } = req.params;
    const { user_id, hole_number, strokes } = req.body;

    if (!user_id || !hole_number || strokes == null) {
      return res.status(400).json({ error: 'user_id, hole_number e strokes são obrigatórios.' });
    }

    const [circuitCheck] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!circuitCheck.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    const [stageRows] = await db.execute(
      'SELECT tournament_id FROM circuit_stages WHERE id = ? AND circuit_id = ?',
      [stageId, circuit_id]
    );
    if (!stageRows.length) return res.status(404).json({ error: 'Etapa não encontrada.' });

    const tournamentId = stageRows[0].tournament_id;

    const [existing] = await db.execute(
      'SELECT id FROM scores WHERE user_id = ? AND tournament_id = ? AND hole_number = ?',
      [user_id, tournamentId, hole_number]
    );

    if (existing.length) {
      await db.execute(
        'UPDATE scores SET strokes = ? WHERE user_id = ? AND tournament_id = ? AND hole_number = ?',
        [strokes, user_id, tournamentId, hole_number]
      );
    } else {
      // Onda B · Bloco 3 · Commit B1.1: entity_ref obrigatoria (NOT NULL) em
      // scores. Modo individual (circuitos so usam esse) → entity_ref = user_id.
      await db.execute(
        'INSERT INTO scores (user_id, tournament_id, entity_ref, hole_number, strokes) VALUES (?, ?, ?, ?, ?)',
        [user_id, tournamentId, user_id, hole_number, strokes]
      );
    }

    res.json({ message: 'Tacada atualizada!' });
  } catch (err) {
    console.error('Erro ao editar scorecard:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// ─── SPONSORS (clube) ─────────────────────────────────────────────────────────

// Público — usado pela barra global de patrocínio no frontend
exports.listSponsorsPublic = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, name, logo_url, link_url FROM sponsors WHERE club_id = ? ORDER BY name ASC',
      [req.club.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar patrocinadores (público):', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.listSponsors = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM sponsors WHERE club_id = ? ORDER BY name ASC',
      [req.club.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar patrocinadores:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.createSponsor = async (req, res) => {
  try {
    const { name, logo_url, link_url } = req.body;
    if (!name) return res.status(400).json({ error: 'name é obrigatório.' });
    const [result] = await db.execute(
      'INSERT INTO sponsors (club_id, name, logo_url, link_url) VALUES (?, ?, ?, ?)',
      [req.club.id, name, logo_url || null, link_url || null]
    );
    res.status(201).json({ message: 'Patrocinador criado!', id: result.insertId });
  } catch (err) {
    console.error('Erro ao criar patrocinador:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.deleteSponsor = async (req, res) => {
  try {
    const { sponsorId } = req.params;
    const [result] = await db.execute(
      'DELETE FROM sponsors WHERE id = ? AND club_id = ?',
      [sponsorId, req.club.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Patrocinador não encontrado.' });
    await db.execute('DELETE FROM circuit_sponsors WHERE sponsor_id = ?', [sponsorId]);
    res.json({ message: 'Patrocinador excluído!' });
  } catch (err) {
    console.error('Erro ao excluir patrocinador:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.getCircuitSponsors = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.execute(`
      SELECT s.id, s.name, s.logo_url, s.link_url, cs.display_order
      FROM circuit_sponsors cs
      JOIN sponsors s ON cs.sponsor_id = s.id
      WHERE cs.circuit_id = ? AND s.club_id = ?
      ORDER BY cs.display_order ASC, s.name ASC
    `, [id, req.club.id]);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar patrocinadores do circuito:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.addCircuitSponsor = async (req, res) => {
  try {
    const { id: circuit_id } = req.params;
    const { sponsor_id, display_order } = req.body;
    if (!sponsor_id) return res.status(400).json({ error: 'sponsor_id é obrigatório.' });

    const [check] = await db.execute(
      'SELECT id FROM circuits WHERE id = ? AND club_id = ?',
      [circuit_id, req.club.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Circuito não encontrado.' });

    await db.execute(
      'INSERT IGNORE INTO circuit_sponsors (circuit_id, sponsor_id, display_order) VALUES (?, ?, ?)',
      [circuit_id, sponsor_id, display_order || 0]
    );
    res.status(201).json({ message: 'Patrocinador vinculado!' });
  } catch (err) {
    console.error('Erro ao vincular patrocinador:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

exports.removeCircuitSponsor = async (req, res) => {
  try {
    const { id: circuit_id, sponsorId } = req.params;
    const [result] = await db.execute(
      'DELETE FROM circuit_sponsors WHERE circuit_id = ? AND sponsor_id = ?',
      [circuit_id, sponsorId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Vínculo não encontrado.' });
    res.json({ message: 'Patrocinador desvinculado!' });
  } catch (err) {
    console.error('Erro ao desvincular patrocinador:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
