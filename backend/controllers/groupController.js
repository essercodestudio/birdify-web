// backend/controllers/groupController.js
const db = require("../db");

// Função auxiliar para gerar código
function generateAccessCode(length = 5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

exports.createGroup = (req, res) => {
  const { tournament_id, group_name, starting_hole } = req.body;
  const access_code = generateAccessCode();

  const query = "INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole) VALUES (?, ?, ?, ?)";

  db.query(query, [tournament_id, group_name, access_code, starting_hole], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: "Grupo criado!", groupId: result.insertId, access_code });
    }
  );
};

// Listar Grupos COM Jogadores, Categoria, Sexo e Handicap
exports.getGroupsByTournament = (req, res) => {
  const { tournamentId } = req.params;

  const query = `
        SELECT 
            g.id as group_id, g.group_name, g.access_code, g.starting_hole,
            u.id as user_id, u.name as user_name, u.email, u.gender,
            gp.handicap,
            c.name as category_name
        FROM tournament_groups g
        LEFT JOIN group_players gp ON g.id = gp.group_id
        LEFT JOIN users u ON gp.user_id = u.id
        LEFT JOIN inscriptions i ON i.user_id = u.id AND i.tournament_id = g.tournament_id AND i.status = 'APPROVED'
        LEFT JOIN tournament_categories c ON i.category_id = c.id
        WHERE g.tournament_id = ?
        ORDER BY g.group_name, u.name
    `;

  db.query(query, [tournamentId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const groupsMap = {};

    results.forEach((row) => {
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          id: row.group_id, group_name: row.group_name, access_code: row.access_code, starting_hole: row.starting_hole, players: []
        };
      }

      if (row.user_id) {
        groupsMap[row.group_id].players.push({
          id: row.user_id, name: row.user_name, email: row.email, gender: row.gender || "M",
          handicap: row.handicap, category: row.category_name || "Sem Categoria"
        });
      }
    });

    res.json(Object.values(groupsMap));
  });
};

// Adicionar Jogador com Verificação
exports.addPlayerToGroup = (req, res) => {
  const { group_id, user_id } = req.body;

  const findTournamentQuery = "SELECT tournament_id FROM tournament_groups WHERE id = ?";

  db.query(findTournamentQuery, [group_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: "Grupo não encontrado" });

    const tournamentId = results[0].tournament_id;

    const checkPlayerQuery = `
            SELECT gp.user_id 
            FROM group_players gp
            JOIN tournament_groups tg ON gp.group_id = tg.id
            WHERE tg.tournament_id = ? AND gp.user_id = ?
        `;

    db.query(checkPlayerQuery, [tournamentId, user_id], (err, checkResults) => {
      if (err) return res.status(500).json({ error: err.message });

      if (checkResults.length > 0) {
        return res.status(400).json({ message: "⚠️ Este jogador já está inscrito em outro grupo deste torneio!" });
      }

      const insertQuery = "INSERT INTO group_players (group_id, user_id) VALUES (?, ?)";
      db.query(insertQuery, [group_id, user_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json({ message: "Jogador adicionado com sucesso!" });
      });
    });
  });
};

// --- FAXINA 1: Remover jogador do grupo E apagar seus scores fantasmas ---
exports.removePlayer = (req, res) => {
  const { groupId, userId } = req.params;

  if (!groupId || !userId) return res.status(400).json({ error: "ID do grupo ou do jogador não informados." });

  // Descobre o ID do torneio antes de apagar o jogador
  db.query("SELECT tournament_id FROM tournament_groups WHERE id = ?", [groupId], (err, tResults) => {
      if (err) return res.status(500).json({ error: err.message });
      const tId = tResults[0]?.tournament_id;

      // 1. Remove o jogador do grupo
      db.query("DELETE FROM group_players WHERE group_id = ? AND user_id = ?", [groupId, userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // 2. Apaga os scores antigos dele (Se existir o ID do torneio)
        if (tId) {
            db.query("DELETE FROM scores WHERE tournament_id = ? AND user_id = ?", [tId, userId], () => {
                res.status(200).json({ message: "Jogador e scores removidos com sucesso!" });
            });
        } else {
            res.status(200).json({ message: "Jogador removido com sucesso!" });
        }
      });
  });
};

// --- FAXINA 2: Excluir grupo inteiro E apagar TODOS os scores daquele grupo ---
exports.deleteGroup = (req, res) => {
  const { id } = req.params;

  // Descobre o Torneio e quem estava no grupo antes de apagar tudo
  db.query("SELECT tournament_id FROM tournament_groups WHERE id = ?", [id], (err, tResults) => {
      if (err) return res.status(500).json({ error: err.message });
      const tId = tResults[0]?.tournament_id;

      db.query("SELECT user_id FROM group_players WHERE group_id = ?", [id], (err, pResults) => {
          const userIds = pResults.map(p => p.user_id);

          // 1. Apaga as ligações dos jogadores com o grupo
          db.query("DELETE FROM group_players WHERE group_id = ?", [id], () => {
            
            // 2. Apaga o grupo em si
            db.query("DELETE FROM tournament_groups WHERE id = ?", [id], (err) => {
              if (err) return res.status(500).json({ error: err.message });

              // 3. Efeito Cascata: Apaga os scores velhos de todos os jogadores do grupo deletado
              if (tId && userIds.length > 0) {
                  db.query("DELETE FROM scores WHERE tournament_id = ? AND user_id IN (?)", [tId, userIds], () => {
                      res.json({ message: "Grupo e scores excluídos!" });
                  });
              } else {
                  res.json({ message: "Grupo excluído!" });
              }
            });
          });
      });
  });
};

// Gerar Código do Painel
exports.generateCode = (req, res) => {
  const { group_id } = req.body;
  const code = generateAccessCode(4).toUpperCase();

  db.query("UPDATE tournament_groups SET access_code = ? WHERE id = ?", [code, group_id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ access_code: code });
    }
  );
};

// Entrar no Jogo (Validando código e jogador)
exports.joinGroup = (req, res) => {
  const { access_code, user_id } = req.body;

  if (!access_code) return res.status(400).json({ message: "Código não fornecido." });
  if (!user_id) return res.status(400).json({ message: "Usuário não identificado. Faça login novamente." });

  const cleanCode = access_code.trim().toUpperCase();

  const groupQuery = `
        SELECT g.*, t.name as tournament_name, c.name as course_name
        FROM tournament_groups g
        JOIN tournaments t ON g.tournament_id = t.id
        JOIN courses c ON t.course_id = c.id
        WHERE g.access_code = ?
    `;

  db.query(groupQuery, [cleanCode], (err, groupResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (groupResults.length === 0) return res.status(404).json({ message: "Código inválido ou não encontrado." });

    const group = groupResults[0];

    db.query("SELECT * FROM group_players WHERE group_id = ? AND user_id = ?", [group.id, user_id], (err, playerResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (playerResults.length === 0) {
        return res.status(403).json({ message: `Você não está escalado no grupo "${group.group_name}".` });
      }
      res.json({ group });
    });
  });
};

// Salvar os Handicaps do Grupo com Dupla Confirmação
exports.saveGroupHandicaps = (req, res) => {
  const { group_id, players_data } = req.body;
  let completed = 0;
  let hasError = false;

  if (!players_data || players_data.length === 0) return res.json({ message: "Nenhum jogador para atualizar." });

  players_data.forEach((player) => {
    db.query("UPDATE group_players SET handicap = ? WHERE group_id = ? AND user_id = ?", [player.handicap, group_id, player.user_id],
      (err) => {
        if (err) hasError = true;
        completed++;
        if (completed === players_data.length) {
          if (hasError) return res.status(500).json({ error: "Erro ao salvar handicaps." });
          res.json({ message: "Handicaps confirmados com sucesso!" });
        }
      }
    );
  });
};