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
    const { tournament_id, group_name, starting_hole, tee_time } = req.body;

    // Verifica se o torneio pertence ao clube antes de criar o grupo, e já pega o formato
    const [tournamentCheck] = await db.execute(
      'SELECT id, format FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    const format = tournamentCheck[0].format || 'shotgun';
    // Tee time: todos saem do buraco 1, horário obrigatório
    // Shotgun: horário nulo, buraco escolhível 1-18
    const hole = format === 'tee_time' ? 1 : Number(starting_hole) || 1;
    const time = format === 'tee_time' ? (tee_time || null) : null;

    if (format === 'tee_time' && !time) {
      return res.status(400).json({ error: 'Horário do grupo é obrigatório no formato tee time.' });
    }

    const access_code = generateAccessCode();

    const query = "INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole, tee_time) VALUES (?, ?, ?, ?, ?)";
    const [result] = await db.execute(query, [tournament_id, group_name, access_code, hole, time]);

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

// Atualiza starting_hole (shotgun) ou tee_time (tee_time) de um grupo já existente.
// Padrão de segurança igual ao resto: valida clube via JOIN antes de aceitar mudança.
exports.updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { starting_hole, tee_time } = req.body || {};

    const [rows] = await db.execute(
      `SELECT tg.id, t.format
       FROM tournament_groups tg
       JOIN tournaments t ON tg.tournament_id = t.id
       WHERE tg.id = ? AND t.club_id = ?`,
      [id, req.club.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado ou acesso negado.' });
    }

    const fields = [];
    const values = [];

    if (rows[0].format === 'tee_time') {
      // Só faz sentido editar tee_time; starting_hole fica travado em 1
      if (tee_time !== undefined) {
        fields.push('tee_time = ?');
        values.push(tee_time || null);
      }
    } else {
      // Shotgun: só faz sentido editar starting_hole; tee_time fica nulo
      if (starting_hole !== undefined) {
        const h = Number(starting_hole);
        if (!Number.isFinite(h) || h < 1 || h > 18) {
          return res.status(400).json({ error: 'Buraco de saída deve estar entre 1 e 18.' });
        }
        fields.push('starting_hole = ?');
        values.push(h);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
    }

    values.push(id);
    await db.execute(`UPDATE tournament_groups SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Grupo atualizado!' });
  } catch (error) {
    console.error('Erro ao atualizar grupo:', error);
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
        g.id as group_id, g.group_name, g.access_code, g.starting_hole, g.tee_time,
        u.id as user_id, u.name as user_name, u.email, u.gender,
        gp.handicap,
        c.name as category_name
      FROM tournament_groups g
      LEFT JOIN group_players gp ON g.id = gp.group_id
      LEFT JOIN users u ON gp.user_id = u.id
      LEFT JOIN inscriptions i ON i.user_id = u.id AND i.tournament_id = g.tournament_id AND i.status = 'APPROVED'
      LEFT JOIN tournament_categories c ON i.category_id = c.id
      WHERE g.tournament_id = ?
      ORDER BY g.tee_time IS NULL, g.tee_time ASC, g.starting_hole ASC, g.group_name ASC, u.name
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
          tee_time: row.tee_time ? String(row.tee_time).slice(0, 5) : null,
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

    // 3. Efeito Cascata: Apaga os scores velhos de todos os jogadores do grupo deletado.
    // Placeholders expandidos manualmente porque db.execute (prepared statement) NÃO
    // aceita array em cláusula IN(?) — passaria o array como parâmetro literal e
    // quebraria. Só era invisível antes porque grupos manuais nasciam vazios;
    // com auto-generate os grupos já vêm cheios e o DELETE dispara sempre.
    if (tId && userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM scores WHERE tournament_id = ? AND user_id IN (${placeholders})`,
        [tId, ...userIds]
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
    // user_id vem do token — o sócio só verifica a própria escalação no grupo.
    const user_id = req.user.id;
    const { access_code } = req.body;

    if (!access_code) {
      return res.status(400).json({ message: "Código não fornecido." });
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

// Sorteia inscritos APROVADOS em flights de 4, sobrescrevendo grupos existentes.
// Distribuição round-robin garante que a sobra vira flights menores balanceados
// (13 jogadores → 4+3+3+3, não 4+4+4+1).
//
// Buracos/horários dependem do formato do torneio:
// - shotgun:   distribui buracos sequenciais 1..N (Flight 1→buraco 1, Flight 2→2…)
// - tee_time:  todos saem do buraco 1, tee_time começa em tournaments.start_date
//              e avança 'interval_minutes' minutos por grupo.
exports.autoGenerateGroups = async (req, res) => {
  try {
    const { tournament_id, interval_minutes } = req.body;
    if (!tournament_id) {
      return res.status(400).json({ error: "tournament_id obrigatório." });
    }

    // 1. Torneio pertence ao clube? (pega format + start_date já pra usar depois)
    const [tCheck] = await db.execute(
      "SELECT id, format, start_date FROM tournaments WHERE id = ? AND club_id = ?",
      [tournament_id, req.club.id]
    );
    if (tCheck.length === 0) {
      return res.status(403).json({ error: "Torneio não encontrado ou acesso negado." });
    }
    const format = tCheck[0].format || 'shotgun';
    const startDate = tCheck[0].start_date; // Date ou string

    let intervalMin = 10;
    if (format === 'tee_time') {
      const raw = Number(interval_minutes);
      if (!Number.isFinite(raw) || raw < 1 || raw > 60) {
        return res.status(400).json({ error: "Intervalo entre grupos deve estar entre 1 e 60 minutos." });
      }
      intervalMin = raw;
    }

    // 2. Pegar aprovados
    const [approved] = await db.execute(
      `SELECT user_id FROM inscriptions
       WHERE tournament_id = ? AND status = 'APPROVED'`,
      [tournament_id]
    );
    if (approved.length === 0) {
      return res.status(400).json({ error: "Não há inscritos aprovados para sortear." });
    }

    // 3. Limpar scores antigos dos jogadores atualmente escalados (mesmo padrão do deleteGroup)
    await db.execute(
      `DELETE s FROM scores s
       JOIN group_players gp ON gp.user_id = s.user_id
       JOIN tournament_groups tg ON tg.id = gp.group_id
       WHERE tg.tournament_id = ? AND s.tournament_id = ?`,
      [tournament_id, tournament_id]
    );

    // 4. Apagar grupos existentes (FK group_players tem ON DELETE CASCADE)
    await db.execute(
      "DELETE FROM tournament_groups WHERE tournament_id = ?",
      [tournament_id]
    );

    // 5. Shuffle Fisher-Yates com crypto (mesmo RNG do generateAccessCode)
    const userIds = approved.map((a) => a.user_id);
    for (let i = userIds.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [userIds[i], userIds[j]] = [userIds[j], userIds[i]];
    }

    // 6. Distribuir round-robin
    const FLIGHT_SIZE = 4;
    const nFlights = Math.ceil(userIds.length / FLIGHT_SIZE);
    const flights = Array.from({ length: nFlights }, () => []);
    userIds.forEach((uid, idx) => {
      flights[idx % nFlights].push(uid);
    });

    // 6.5. Pré-calcular hora inicial pro modo tee_time (BRT, sem lib externa)
    let baseTeeHour = 8, baseTeeMin = 0;
    if (format === 'tee_time' && startDate) {
      const brt = new Date(startDate).toLocaleString('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const [h, m] = brt.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) { baseTeeHour = h; baseTeeMin = m; }
    }

    // 7. Criar grupos + escalar jogadores
    for (let i = 0; i < flights.length; i++) {
      const access_code = generateAccessCode();

      // Shotgun: distribui buracos 1..N (wrap com módulo se >18, evita conflito de FK)
      // Tee time: buraco 1 fixo, hora avança em cascata
      let hole = 1;
      let teeTime = null;
      if (format === 'tee_time') {
        const totalMin = baseTeeHour * 60 + baseTeeMin + i * intervalMin;
        const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
        const mm = String(totalMin % 60).padStart(2, '0');
        teeTime = `${hh}:${mm}:00`;
      } else {
        hole = ((i) % 18) + 1;
      }

      const [ins] = await db.execute(
        `INSERT INTO tournament_groups (tournament_id, group_name, access_code, starting_hole, tee_time)
         VALUES (?, ?, ?, ?, ?)`,
        [tournament_id, `Flight ${i + 1}`, access_code, hole, teeTime]
      );
      const groupId = ins.insertId;

      if (flights[i].length > 0) {
        const placeholders = flights[i].map(() => "(?, ?)").join(", ");
        const values = flights[i].flatMap((uid) => [groupId, uid]);
        await db.execute(
          `INSERT INTO group_players (group_id, user_id) VALUES ${placeholders}`,
          values
        );
      }
    }

    res.json({
      message: "Flights gerados com sucesso!",
      groupsCreated: nFlights,
      playersDistributed: userIds.length,
    });
  } catch (error) {
    console.error("Erro ao gerar flights automáticos:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
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