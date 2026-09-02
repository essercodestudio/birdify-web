// backend/controllers/tournamentDuplaController.js
//
// Onda B · Bloco 3 · Commit 3.2 (2026-09-02).
// CRUD de duplas em torneios modality='doubles'. Multi-tenant via req.club.id.
// Enforcement:
//   - dupla pertence a torneio do clube (evita vazamento cross-tenant)
//   - 1 user em 1 dupla POR torneio (via SELECT antes do INSERT; PRIMARY KEY
//     composto (dupla_id, user_id) só evita mesmo user 2x na mesma dupla)
//   - dupla só pode existir em torneio com modality='doubles' (validação
//     na criação)
const db = require("../db");

// Helper: confirma que o torneio pertence ao clube E é doubles. Retorna
// { ok: true, tournament } ou { ok: false, status, message }.
async function assertTournamentIsDoubles(tournamentId, clubId) {
  const [rows] = await db.execute(
    "SELECT id, modality FROM tournaments WHERE id = ? AND club_id = ?",
    [tournamentId, clubId]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, message: "Torneio não encontrado ou acesso negado." };
  }
  if (rows[0].modality !== "doubles") {
    return { ok: false, status: 400, message: "Torneio não é modality='doubles'." };
  }
  return { ok: true, tournament: rows[0] };
}

// Helper: confirma que a dupla pertence a torneio do clube. Retorna
// { ok: true, dupla, tournament } ou { ok: false, status, message }.
async function assertDuplaAccess(duplaId, clubId) {
  const [rows] = await db.execute(
    `SELECT d.id, d.tournament_id, d.dupla_name, d.handicap,
            t.modality, t.club_id
       FROM tournament_duplas d
       JOIN tournaments t ON t.id = d.tournament_id
      WHERE d.id = ? AND t.club_id = ?`,
    [duplaId, clubId]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, message: "Dupla não encontrada ou acesso negado." };
  }
  return { ok: true, dupla: rows[0] };
}

// GET /api/tournament-duplas/tournament/:tournamentId
// Lista todas as duplas de um torneio doubles + os 2 jogadores (nome, id)
// de cada dupla. Retorna [] se torneio existe mas ainda não tem duplas.
exports.listDuplas = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const check = await assertTournamentIsDoubles(tournamentId, req.club.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const [duplas] = await db.execute(
      `SELECT d.id, d.dupla_name, d.handicap, d.created_at
         FROM tournament_duplas d
        WHERE d.tournament_id = ?
        ORDER BY d.dupla_name`,
      [tournamentId]
    );
    if (duplas.length === 0) return res.json([]);

    const duplaIds = duplas.map((d) => d.id);
    const placeholders = duplaIds.map(() => "?").join(",");
    const [players] = await db.execute(
      `SELECT tdp.dupla_id, u.id AS user_id, u.name
         FROM tournament_dupla_players tdp
         JOIN users u ON u.id = tdp.user_id
        WHERE tdp.dupla_id IN (${placeholders})`,
      duplaIds
    );

    // Agrupa jogadores por dupla_id
    const byDupla = players.reduce((acc, p) => {
      (acc[p.dupla_id] = acc[p.dupla_id] || []).push({ user_id: p.user_id, name: p.name });
      return acc;
    }, {});
    const result = duplas.map((d) => ({ ...d, players: byDupla[d.id] || [] }));
    res.json(result);
  } catch (err) {
    console.error("Erro ao listar duplas:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// POST /api/tournament-duplas
// Body: { tournament_id, dupla_name, handicap?, player_ids?: [uid1, uid2] }
// Cria dupla + (opcionalmente) associa 1 ou 2 jogadores. Valida que os
// jogadores ainda não estão em outra dupla do MESMO torneio.
exports.createDupla = async (req, res) => {
  const { tournament_id, dupla_name, handicap, player_ids } = req.body;
  if (!tournament_id || !dupla_name || String(dupla_name).trim() === "") {
    return res.status(400).json({ message: "tournament_id e dupla_name são obrigatórios." });
  }
  const check = await assertTournamentIsDoubles(tournament_id, req.club.id);
  if (!check.ok) return res.status(check.status).json({ message: check.message });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Se player_ids veio, valida que nenhum já está em outra dupla desse torneio
    if (Array.isArray(player_ids) && player_ids.length > 0) {
      if (player_ids.length > 2) {
        await conn.rollback();
        return res.status(400).json({ message: "Dupla tem no máximo 2 jogadores." });
      }
      const uniq = [...new Set(player_ids.map(Number))];
      if (uniq.length !== player_ids.length) {
        await conn.rollback();
        return res.status(400).json({ message: "Jogador duplicado na dupla." });
      }
      const placeholders = uniq.map(() => "?").join(",");
      const [conflict] = await conn.execute(
        `SELECT tdp.user_id, u.name, d.dupla_name
           FROM tournament_dupla_players tdp
           JOIN tournament_duplas d ON d.id = tdp.dupla_id
           JOIN users u ON u.id = tdp.user_id
          WHERE d.tournament_id = ? AND tdp.user_id IN (${placeholders})`,
        [tournament_id, ...uniq]
      );
      if (conflict.length > 0) {
        await conn.rollback();
        const c = conflict[0];
        return res.status(400).json({
          message: `Jogador '${c.name}' já está na dupla '${c.dupla_name}' deste torneio.`,
        });
      }
    }

    const [result] = await conn.execute(
      `INSERT INTO tournament_duplas (tournament_id, dupla_name, handicap)
       VALUES (?, ?, ?)`,
      [tournament_id, String(dupla_name).trim(), handicap == null ? null : handicap]
    );
    const duplaId = result.insertId;

    if (Array.isArray(player_ids) && player_ids.length > 0) {
      for (const uid of player_ids) {
        await conn.execute(
          `INSERT INTO tournament_dupla_players (dupla_id, user_id) VALUES (?, ?)`,
          [duplaId, Number(uid)]
        );
      }
    }
    await conn.commit();
    res.json({ id: duplaId, tournament_id, dupla_name, handicap: handicap ?? null });
  } catch (err) {
    await conn.rollback();
    console.error("Erro ao criar dupla:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  } finally {
    conn.release();
  }
};

// PUT /api/tournament-duplas/:id
// Body: { dupla_name?, handicap? }
exports.updateDupla = async (req, res) => {
  try {
    const { id } = req.params;
    const { dupla_name, handicap } = req.body;
    const check = await assertDuplaAccess(id, req.club.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const fields = [];
    const params = [];
    if (dupla_name !== undefined) {
      if (String(dupla_name).trim() === "") {
        return res.status(400).json({ message: "dupla_name vazio." });
      }
      fields.push("dupla_name = ?");
      params.push(String(dupla_name).trim());
    }
    if (handicap !== undefined) {
      fields.push("handicap = ?");
      params.push(handicap == null ? null : handicap);
    }
    if (fields.length === 0) return res.json({ ok: true, noop: true });

    params.push(id);
    await db.execute(`UPDATE tournament_duplas SET ${fields.join(", ")} WHERE id = ?`, params);
    res.json({ ok: true, id: Number(id) });
  } catch (err) {
    console.error("Erro ao atualizar dupla:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// DELETE /api/tournament-duplas/:id
// FK CASCADE cobre tournament_dupla_players + group_duplas + scores.
exports.deleteDupla = async (req, res) => {
  try {
    const { id } = req.params;
    const check = await assertDuplaAccess(id, req.club.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    await db.execute(`DELETE FROM tournament_duplas WHERE id = ?`, [id]);
    res.json({ ok: true, id: Number(id) });
  } catch (err) {
    console.error("Erro ao deletar dupla:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// POST /api/tournament-duplas/:id/players
// Body: { user_id }
// Adiciona 1 jogador na dupla. Rejeita se dupla já tem 2 jogadores OU
// se user já está em outra dupla do MESMO torneio.
exports.addPlayer = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ message: "user_id obrigatório." });

    const check = await assertDuplaAccess(id, req.club.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    // Já tem 2 jogadores?
    const [[{ n: count }]] = await db.query(
      `SELECT COUNT(*) n FROM tournament_dupla_players WHERE dupla_id = ?`,
      [id]
    );
    if (count >= 2) {
      return res.status(400).json({ message: "Dupla já tem 2 jogadores." });
    }

    // User já está em outra dupla do MESMO torneio?
    const [conflict] = await db.execute(
      `SELECT d.dupla_name
         FROM tournament_dupla_players tdp
         JOIN tournament_duplas d ON d.id = tdp.dupla_id
        WHERE d.tournament_id = ? AND tdp.user_id = ?`,
      [check.dupla.tournament_id, user_id]
    );
    if (conflict.length > 0) {
      return res.status(400).json({
        message: `Jogador já está na dupla '${conflict[0].dupla_name}' deste torneio.`,
      });
    }

    await db.execute(
      `INSERT INTO tournament_dupla_players (dupla_id, user_id) VALUES (?, ?)`,
      [id, Number(user_id)]
    );
    res.json({ ok: true, dupla_id: Number(id), user_id: Number(user_id) });
  } catch (err) {
    console.error("Erro ao adicionar jogador na dupla:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// DELETE /api/tournament-duplas/:id/players/:userId
exports.removePlayer = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const check = await assertDuplaAccess(id, req.club.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const [result] = await db.execute(
      `DELETE FROM tournament_dupla_players WHERE dupla_id = ? AND user_id = ?`,
      [id, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Jogador não estava na dupla." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover jogador da dupla:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
