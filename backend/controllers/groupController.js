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

  const query =
    "INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole) VALUES (?, ?, ?, ?)";

  db.query(
    query,
    [tournament_id, group_name, access_code, starting_hole],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        message: "Grupo criado!",
        groupId: result.insertId,
        access_code,
      });
    },
  );
};

// --- CORREÇÃO: Listar Grupos COM Jogadores, Categoria, Sexo e Handicap ---
exports.getGroupsByTournament = (req, res) => {
  const { tournamentId } = req.params;

  // O LEFT JOIN agora busca o Sexo (u.gender), o Handicap (gp.handicap) e a Categoria (c.name)
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
          id: row.group_id,
          group_name: row.group_name,
          access_code: row.access_code,
          starting_hole: row.starting_hole,
          players: [],
        };
      }

      // Se a linha tiver um jogador, adicionamos com todas as infos pro Excel
      if (row.user_id) {
        groupsMap[row.group_id].players.push({
          id: row.user_id,
          name: row.user_name,
          email: row.email,
          gender: row.gender || "M", // Puxa o sexo do banco
          handicap: row.handicap || 0, // Puxa o handicap
          category: row.category_name || "Sem Categoria", // Puxa o nome da categoria
        });
      }
    });

    res.json(Object.values(groupsMap));
  });
};
// --- CORREÇÃO 2: Adicionar Jogador com Verificação ---
exports.addPlayerToGroup = (req, res) => {
  const { group_id, user_id } = req.body;

  // 1. Descobrir qual é o Torneio desse grupo
  const findTournamentQuery =
    "SELECT tournament_id FROM tournament_groups WHERE id = ?";

  db.query(findTournamentQuery, [group_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0)
      return res.status(404).json({ message: "Grupo não encontrado" });

    const tournamentId = results[0].tournament_id;

    // 2. Verificar se o jogador já está em QUALQUER grupo deste torneio
    const checkPlayerQuery = `
            SELECT gp.user_id 
            FROM group_players gp
            JOIN tournament_groups tg ON gp.group_id = tg.id
            WHERE tg.tournament_id = ? AND gp.user_id = ?
        `;

    db.query(checkPlayerQuery, [tournamentId, user_id], (err, checkResults) => {
      if (err) return res.status(500).json({ error: err.message });

      if (checkResults.length > 0) {
        return res.status(400).json({
          message:
            "⚠️ Este jogador já está inscrito em outro grupo deste torneio!",
        });
      }

      // 3. Se não estiver, adiciona
      const insertQuery =
        "INSERT INTO group_players (group_id, user_id, handicap) VALUES (?, ?, 0)";
      db.query(insertQuery, [group_id, user_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json({ message: "Jogador adicionado com sucesso!" });
      });
    });
  });
};
// ... (código anterior)

// 1. Remover um Jogador do Grupo
exports.removePlayerFromGroup = (req, res) => {
  const { group_id, user_id } = req.body;

  const query = "DELETE FROM group_players WHERE group_id = ? AND user_id = ?";

  db.query(query, [group_id, user_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json({ message: "Jogador removido do grupo." });
  });
};

// 2. Apagar o Grupo Inteiro
exports.deleteGroup = (req, res) => {
  const { id } = req.params;

  // Como configuramos "ON DELETE CASCADE" no banco, ao apagar o grupo,
  // o MySQL apaga automaticamente as ligações dos jogadores.
  const query = "DELETE FROM tournament_groups WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json({ message: "Grupo excluído com sucesso." });
  });
};

// EXCLUIR GRUPO INTEIRO
exports.deleteGroup = (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM group_players WHERE group_id = ?", [id], () => {
    db.query("DELETE FROM tournament_groups WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Grupo excluído!" });
    });
  });
};

// --- FUNÇÃO CORRIGIDA: Remover jogador do grupo ---
exports.removePlayer = (req, res) => {
  // Puxando os dados da URL (params) e não do body
  const { groupId, userId } = req.params;

  if (!groupId || !userId) {
    return res
      .status(400)
      .json({ error: "ID do grupo ou do jogador não informados." });
  }

  const query = "DELETE FROM group_players WHERE group_id = ? AND user_id = ?";

  db.query(query, [groupId, userId], (err, result) => {
    if (err) {
      console.error("Erro ao remover jogador SQL:", err);
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ message: "Jogador removido com sucesso!" });
  });
};
// --- FUNÇÃO NOVA: Para o botão "Gerar Código" do Painel ---
exports.generateCode = (req, res) => {
  const { group_id } = req.body;
  // Usa a sua função auxiliar lá de cima para gerar 4 letras/números
  const code = generateAccessCode(4).toUpperCase();

  db.query(
    "UPDATE tournament_groups SET access_code = ? WHERE id = ?",
    [code, group_id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ access_code: code });
    },
  );
};

// --- FUNÇÃO BLINDADA E DEFINITIVA: Para o jogador entrar no jogo ---
exports.joinGroup = (req, res) => {
  const { access_code, user_id } = req.body;

  if (!access_code) {
    return res.status(400).json({ message: "Código não fornecido." });
  }
  if (!user_id) {
    return res
      .status(400)
      .json({ message: "Usuário não identificado. Faça login novamente." });
  }

  const cleanCode = access_code.trim().toUpperCase();

  // 1. Primeiro, buscamos qual é o grupo que tem esse código
  const groupQuery = `
        SELECT g.*, t.name as tournament_name, c.name as course_name
        FROM tournament_groups g
        JOIN tournaments t ON g.tournament_id = t.id
        JOIN courses c ON t.course_id = c.id
        WHERE g.access_code = ?
    `;

  db.query(groupQuery, [cleanCode], (err, groupResults) => {
    if (err) return res.status(500).json({ error: err.message });

    // Se a lista vier vazia, o código não existe.
    if (groupResults.length === 0) {
      return res
        .status(404)
        .json({ message: "Código inválido ou não encontrado." });
    }

    const group = groupResults[0];

    // 2. Agora, verificamos se o ID do jogador está CADASTRADO neste grupo exato
    const checkPlayerQuery = `SELECT * FROM group_players WHERE group_id = ? AND user_id = ?`;

    db.query(checkPlayerQuery, [group.id, user_id], (err, playerResults) => {
      if (err) return res.status(500).json({ error: err.message });

      // Se vier vazio, o código do grupo existe, mas o jogador NÃO FAZ PARTE dele.
      if (playerResults.length === 0) {
        return res.status(403).json({
          message: `Você digitou o código do grupo "${group.group_name}", mas você não está escalado nele. Verifique com o organizador.`,
        });
      }

      // 3. Tudo certo! O jogador está no grupo. Libera a entrada.
      res.json({ group });
    });
  });
};
// --- NOVA FUNÇÃO: Salvar os Handicaps do Grupo com Dupla Confirmação ---
exports.saveGroupHandicaps = (req, res) => {
  const { group_id, players_data } = req.body;
  let completed = 0;
  let hasError = false;

  if (!players_data || players_data.length === 0) {
    return res.json({ message: "Nenhum jogador para atualizar." });
  }

  // Atualiza o handicap de cada jogador do grupo
  players_data.forEach((player) => {
    db.query(
      "UPDATE group_players SET handicap = ? WHERE group_id = ? AND user_id = ?",
      [player.handicap, group_id, player.user_id],
      (err) => {
        if (err) hasError = true;
        completed++;
        // Quando terminar de atualizar todos, devolve a resposta
        if (completed === players_data.length) {
          if (hasError)
            return res.status(500).json({ error: "Erro ao salvar handicaps." });
          res.json({ message: "Handicaps confirmados com sucesso!" });
        }
      },
    );
  });
};
