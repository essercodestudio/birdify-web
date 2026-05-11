// backend/controllers/groupController.js
const crypto = require("crypto");
const db = require("../db");
const ExcelJS = require('exceljs');

// Função auxiliar para gerar código
function generateAccessCode(length = 5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

exports.createGroup = async (req, res) => {
  try {
    const { tournament_id, group_name, starting_hole } = req.body;
    
    // Verifica se o torneio pertence ao clube antes de criar o grupo
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }
    
    const access_code = generateAccessCode();

    const query = "INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole) VALUES (?, ?, ?, ?)";
    const [result] = await db.execute(query, [tournament_id, group_name, access_code, starting_hole]);
    
    res.status(201).json({ 
      message: "Grupo criado!", 
      groupId: result.insertId, 
      access_code 
    });
  } catch (error) {
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Listar Grupos COM Jogadores, Categoria, Sexo e Handicap
exports.getGroupsByTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

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

    const [results] = await db.execute(query, [tournamentId]);

    const groupsMap = {};

    results.forEach((row) => {
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          id: row.group_id, 
          group_name: row.group_name, 
          access_code: row.access_code, 
          starting_hole: row.starting_hole, 
          players: []
        };
      }

      if (row.user_id) {
        groupsMap[row.group_id].players.push({
          id: row.user_id, 
          name: row.user_name, 
          email: row.email, 
          gender: row.gender || "M",
          handicap: row.handicap, 
          category: row.category_name || "Sem Categoria"
        });
      }
    });

    res.json(Object.values(groupsMap));
  } catch (error) {
    console.error('Erro ao listar grupos:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Adicionar Jogador com Verificação
exports.addPlayerToGroup = async (req, res) => {
  try {
    const { group_id, user_id } = req.body;

    // 1. Verificar se o grupo existe, pegar o tournament_id E verificar se pertence ao clube
    const findTournamentQuery = `
      SELECT tg.tournament_id 
      FROM tournament_groups tg
      JOIN tournaments t ON tg.tournament_id = t.id
      WHERE tg.id = ? AND t.club_id = ?
    `;
    const [groupResults] = await db.execute(findTournamentQuery, [group_id, req.club.id]);
    
    if (groupResults.length === 0) {
      return res.status(404).json({ message: "Grupo não encontrado ou acesso negado." });
    }

    const tournamentId = groupResults[0].tournament_id;

    // 2. Verificar se o jogador já está em outro grupo neste torneio
    const checkPlayerQuery = `
      SELECT gp.user_id 
      FROM group_players gp
      JOIN tournament_groups tg ON gp.group_id = tg.id
      WHERE tg.tournament_id = ? AND gp.user_id = ?
    `;

    const [checkResults] = await db.execute(checkPlayerQuery, [tournamentId, user_id]);

    if (checkResults.length > 0) {
      return res.status(400).json({ 
        message: "⚠️ Este jogador já está inscrito em outro grupo deste torneio!" 
      });
    }

    // 3. Adicionar jogador ao grupo
    const insertQuery = "INSERT INTO group_players (group_id, user_id) VALUES (?, ?)";
    await db.execute(insertQuery, [group_id, user_id]);
    
    res.status(200).json({ message: "Jogador adicionado com sucesso!" });
    
  } catch (error) {
    console.error('Erro ao adicionar jogador:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// --- FAXINA 1: Remover jogador do grupo E apagar seus scores fantasmas ---
exports.removePlayer = async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    if (!groupId || !userId) {
      return res.status(400).json({ error: "ID do grupo ou do jogador não informados." });
    }

    // Descobre o ID do torneio antes de apagar o jogador E verifica se pertence ao clube
    const [tResults] = await db.execute(
      `SELECT tg.tournament_id 
       FROM tournament_groups tg
       JOIN tournaments t ON tg.tournament_id = t.id
       WHERE tg.id = ? AND t.club_id = ?`, 
      [groupId, req.club.id]
    );
    
    if (tResults.length === 0) {
      return res.status(404).json({ error: "Grupo não encontrado ou acesso negado." });
    }
    
    const tId = tResults[0]?.tournament_id;

    // 1. Remove o jogador do grupo
    await db.execute(
      "DELETE FROM group_players WHERE group_id = ? AND user_id = ?", 
      [groupId, userId]
    );
    
    // 2. Apaga os scores antigos dele (Se existir o ID do torneio)
    if (tId) {
      await db.execute(
        "DELETE FROM scores WHERE tournament_id = ? AND user_id = ?", 
        [tId, userId]
      );
      res.status(200).json({ message: "Jogador e scores removidos com sucesso!" });
    } else {
      res.status(200).json({ message: "Jogador removido com sucesso!" });
    }
    
  } catch (error) {
    console.error('Erro ao remover jogador:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// --- FAXINA 2: Excluir grupo inteiro E apagar TODOS os scores daquele grupo ---
exports.deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Descobre o Torneio e quem estava no grupo antes de apagar tudo E verifica se pertence ao clube
    const [tResults] = await db.execute(
      `SELECT tg.tournament_id 
       FROM tournament_groups tg
       JOIN tournaments t ON tg.tournament_id = t.id
       WHERE tg.id = ? AND t.club_id = ?`, 
      [id, req.club.id]
    );
    
    if (tResults.length === 0) {
      return res.status(404).json({ error: "Grupo não encontrado ou acesso negado." });
    }
    
    const tId = tResults[0]?.tournament_id;

    // Busca os jogadores do grupo
    const [pResults] = await db.execute(
      "SELECT user_id FROM group_players WHERE group_id = ?", 
      [id]
    );
    
    const userIds = pResults.map(p => p.user_id);

    // 1. Apaga as ligações dos jogadores com o grupo
    await db.execute("DELETE FROM group_players WHERE group_id = ?", [id]);

    // 2. Apaga o grupo em si
    const [result] = await db.execute("DELETE FROM tournament_groups WHERE id = ?", [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado.' });
    }

    // 3. Efeito Cascata: Apaga os scores velhos de todos os jogadores do grupo deletado
    if (tId && userIds.length > 0) {
      await db.execute(
        "DELETE FROM scores WHERE tournament_id = ? AND user_id IN (?)", 
        [tId, userIds]
      );
      res.json({ message: "Grupo e scores excluídos!" });
    } else {
      res.json({ message: "Grupo excluído!" });
    }
    
  } catch (error) {
    console.error('Erro ao excluir grupo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Gerar Código do Painel
exports.generateCode = async (req, res) => {
  try {
    const { group_id } = req.body;
    
    // Verifica se o grupo pertence a um torneio do clube
    const [groupCheck] = await db.execute(
      `SELECT tg.id 
       FROM tournament_groups tg
       JOIN tournaments t ON tg.tournament_id = t.id
       WHERE tg.id = ? AND t.club_id = ?`,
      [group_id, req.club.id]
    );
    
    if (groupCheck.length === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado ou acesso negado.' });
    }
    
    const code = generateAccessCode(4).toUpperCase();

    const [result] = await db.execute(
      "UPDATE tournament_groups SET access_code = ? WHERE id = ?", 
      [code, group_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado.' });
    }
    
    res.json({ access_code: code });
    
  } catch (error) {
    console.error('Erro ao gerar código:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Entrar no Jogo (Validando código e jogador)
exports.joinGroup = async (req, res) => {
  try {
    const { access_code, user_id } = req.body;

    if (!access_code) {
      return res.status(400).json({ message: "Código não fornecido." });
    }
    
    if (!user_id) {
      return res.status(400).json({ message: "Usuário não identificado. Faça login novamente." });
    }

    const cleanCode = access_code.trim().toUpperCase();

    // NOTA: joinGroup NÃO recebe req.club.id porque o jogador está acessando via código público
    // Esta rota é pública por natureza (jogadores entrando com código)
    const groupQuery = `
      SELECT g.*, t.name as tournament_name, c.name as course_name
      FROM tournament_groups g
      JOIN tournaments t ON g.tournament_id = t.id
      JOIN courses c ON t.course_id = c.id
      WHERE g.access_code = ?
    `;

    const [groupResults] = await db.execute(groupQuery, [cleanCode]);
    
    if (groupResults.length === 0) {
      return res.status(404).json({ message: "Código inválido ou não encontrado." });
    }

    const group = groupResults[0];

    const [playerResults] = await db.execute(
      "SELECT * FROM group_players WHERE group_id = ? AND user_id = ?", 
      [group.id, user_id]
    );
    
    if (playerResults.length === 0) {
      return res.status(403).json({ 
        message: `Você não está escalado no grupo "${group.group_name}".` 
      });
    }
    
    res.json({ group });
    
  } catch (error) {
    console.error('Erro ao entrar no grupo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// Salvar os Handicaps do Grupo com Dupla Confirmação
exports.saveGroupHandicaps = async (req, res) => {
  try {
    const { group_id, players_data } = req.body;

    if (!players_data || players_data.length === 0) {
      return res.json({ message: "Nenhum jogador para atualizar." });
    }
    
    // Verifica se o grupo pertence a um torneio do clube
    const [groupCheck] = await db.execute(
      `SELECT tg.id 
       FROM tournament_groups tg
       JOIN tournaments t ON tg.tournament_id = t.id
       WHERE tg.id = ? AND t.club_id = ?`,
      [group_id, req.club.id]
    );
    
    if (groupCheck.length === 0) {
      return res.status(403).json({ error: 'Grupo não encontrado ou acesso negado.' });
    }

    // Usando Promise.all para atualizar todos os handicaps em paralelo
    const updatePromises = players_data.map(async (player) => {
      await db.execute(
        "UPDATE group_players SET handicap = ? WHERE group_id = ? AND user_id = ?",
        [player.handicap, group_id, player.user_id]
      );
    });

    await Promise.all(updatePromises);
    
    res.json({ message: "Handicaps confirmados com sucesso!" });
    
  } catch (error) {
    console.error('Erro ao salvar handicaps:', error);
    res.status(500).json({ error: "Erro ao salvar handicaps." });
  }
};

// ==========================================
// MÁGICA DO EXCEL: EXPORTAR TEE SHEET (DRAW)
// ==========================================
exports.exportGroupsToExcel = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );
    
    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    const query = `
      SELECT 
        g.starting_hole as hole, 
        g.group_name as time_or_group, 
        g.access_code,
        u.name as player_name, 
        u.gender, 
        c.name as category_name,
        t.name as tournament_name
      FROM tournament_groups g
      JOIN tournaments t ON g.tournament_id = t.id
      JOIN group_players gp ON g.id = gp.group_id
      JOIN users u ON gp.user_id = u.id
      LEFT JOIN inscriptions i ON i.user_id = u.id AND i.tournament_id = g.tournament_id AND i.status = 'APPROVED'
      LEFT JOIN tournament_categories c ON i.category_id = c.id
      WHERE g.tournament_id = ?
      ORDER BY CAST(g.starting_hole AS UNSIGNED) ASC, g.group_name ASC, u.name ASC
    `;

    const [results] = await db.execute(query, [tournamentId]);
    
    if (results.length === 0) {
      return res.status(404).json({ message: "Nenhum grupo encontrado." });
    }

    const tournamentName = results[0].tournament_name;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Saídas - Draw');

    // Configura as colunas
    sheet.columns = [
      { header: 'Buraco', key: 'hole', width: 10 },
      { header: 'Horário / Grupo', key: 'time', width: 20 },
      { header: 'Cód. Acesso', key: 'code', width: 15 },
      { header: 'Jogador', key: 'player', width: 35 },
      { header: 'Categoria', key: 'cat', width: 25 },
      { header: 'Sexo', key: 'gender', width: 10 }
    ];

    // Estilo do Cabeçalho Preto Padrão Birdify
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { 
      type: 'pattern', 
      pattern: 'solid', 
      fgColor: { argb: 'FF0f172a' } 
    };
    sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    let currentHoleAndGroup = null;

    results.forEach(row => {
      let holeGroupCombo = `${row.hole}-${row.time_or_group}`;
      
      // A MÁGICA DE PULAR LINHA: Se o grupo mudou, insere uma linha vazia!
      if (currentHoleAndGroup !== null && currentHoleAndGroup !== holeGroupCombo) {
        sheet.addRow([]); 
      }
      currentHoleAndGroup = holeGroupCombo;

      const newRow = sheet.addRow({
        hole: row.hole || '-',
        time: row.time_or_group || '-',
        code: row.access_code || '-',
        player: row.player_name || 'Desconhecido',
        cat: row.category_name || 'Sem Categoria',
        gender: row.gender === 'M' || row.gender === 'Masculino' ? 'Masc' : 'Fem'
      });

      // Centraliza tudo, exceto o nome do jogador
      newRow.alignment = { horizontal: 'center', vertical: 'middle' };
      newRow.getCell('player').alignment = { horizontal: 'left', vertical: 'middle' };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Draw_${tournamentName.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx"`);
    
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Erro ao exportar Excel:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};