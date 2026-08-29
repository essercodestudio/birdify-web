// backend/controllers/groupController.js
const crypto = require("crypto");
const db = require("../db");
const ExcelJS = require('exceljs');

// Função auxiliar para gerar código
function generateAccessCode(length = 4) {
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
    // Bloco D · commit 2: round_number opcional (default 1 = comportamento antigo).
    // Frontend antigo que nao envia continua funcionando exatamente como antes.
    const roundNumber = Number(req.body.round_number) || 1;

    // Pega format + total_rounds pra validar o round contra o teto do torneio
    const [tournamentCheck] = await db.execute(
      'SELECT id, format, total_rounds FROM tournaments WHERE id = ? AND club_id = ?',
      [tournament_id, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    const totalRounds = Number(tournamentCheck[0].total_rounds) || 1;
    if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > totalRounds) {
      return res.status(400).json({
        error: `Rodada invalida: torneio tem ${totalRounds} rodada(s), tentou criar grupo na R${roundNumber}.`,
      });
    }

    const format = tournamentCheck[0].format || 'shotgun';
    // Tee time: todos saem do buraco 1, horário obrigatório
    // Shotgun: horário nulo, buraco escolhível 1-18
    const hole = format === 'tee_time' ? 1 : Number(starting_hole) || 1;
    const time = format === 'tee_time' ? (tee_time || null) : null;

    if (format === 'tee_time' && !time) {
      return res.status(400).json({ error: 'Horário do grupo é obrigatório no formato tee time.' });
    }

    // Retry contra colisão do UNIQUE access_code (36^4 = 1.6M combos, mas o UNIQUE é global)
    let access_code = null, insertId = null, attempts = 0;
    while (attempts < 20) {
      const candidate = generateAccessCode();
      try {
        const [result] = await db.execute(
          "INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole, tee_time) VALUES (?, ?, ?, ?, ?, ?)",
          [tournament_id, roundNumber, group_name, candidate, hole, time]
        );
        access_code = candidate;
        insertId = result.insertId;
        break;
      } catch (e) {
        // UNIQUE em access_code OU em (tournament_id, round_number, group_name)
        if (e.code === "ER_DUP_ENTRY") {
          if (String(e.message).includes('uk_tgroup_round_name')) {
            return res.status(409).json({ error: `Ja existe um grupo com esse nome na R${roundNumber}.` });
          }
          attempts++; continue;
        }
        throw e;
      }
    }
    if (!insertId) {
      return res.status(503).json({ error: "Não foi possível gerar código único. Tente novamente." });
    }

    res.status(201).json({
      message: "Grupo criado!",
      groupId: insertId,
      access_code,
      round_number: roundNumber,
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
// Bloco D · commit 2: aceita ?round=N opcional (filtra por rodada).
// Sem o param retorna todos os rounds (compat com callers antigos).
// SEMPRE inclui round_number no response — frontend novo usa pra saber
// em qual rodada esta o grupo (Scorecard.js currentRound).
exports.getGroupsByTournament = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const roundFilter = req.query.round ? Number(req.query.round) : null;
    if (roundFilter !== null && (!Number.isInteger(roundFilter) || roundFilter < 1)) {
      return res.status(400).json({ error: 'round invalido.' });
    }

    // Verifica se o torneio pertence ao clube
    const [tournamentCheck] = await db.execute(
      'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
      [tournamentId, req.club.id]
    );

    if (tournamentCheck.length === 0) {
      return res.status(403).json({ error: 'Torneio não encontrado ou acesso negado.' });
    }

    const params = [tournamentId];
    let roundWhere = '';
    if (roundFilter !== null) {
      roundWhere = ' AND g.round_number = ?';
      params.push(roundFilter);
    }

    const query = `
      SELECT
        g.id as group_id, g.round_number, g.group_name, g.access_code,
        g.starting_hole, g.tee_time,
        u.id as user_id, u.name as user_name, u.email, u.gender,
        gp.handicap,
        c.name as category_name
      FROM tournament_groups g
      LEFT JOIN group_players gp ON g.id = gp.group_id
      LEFT JOIN users u ON gp.user_id = u.id
      LEFT JOIN inscriptions i ON i.user_id = u.id AND i.tournament_id = g.tournament_id AND i.status = 'APPROVED'
      LEFT JOIN tournament_categories c ON i.category_id = c.id
      WHERE g.tournament_id = ?${roundWhere}
      ORDER BY g.round_number ASC, g.tee_time IS NULL, g.tee_time ASC, g.starting_hole ASC, g.group_name ASC, u.name
    `;

    const [results] = await db.execute(query, params);

    const groupsMap = {};

    results.forEach((row) => {
      if (!groupsMap[row.group_id]) {
        groupsMap[row.group_id] = {
          id: row.group_id,
          round_number: Number(row.round_number) || 1,
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
// Bloco D · commit 2: duplicata agora e verificada POR RODADA — o mesmo
// jogador pode estar em grupos diferentes em rodadas diferentes (essencial
// pro re-seeding entre R1 e R2). Continua bloqueado 2 grupos na MESMA
// rodada porque uma rodada = 1 partida por atleta.
exports.addPlayerToGroup = async (req, res) => {
  try {
    const { group_id, user_id } = req.body;

    // 1. Pega tournament_id + round_number do grupo alvo (com validacao de clube)
    const [groupResults] = await db.execute(
      `SELECT tg.tournament_id, tg.round_number
         FROM tournament_groups tg
         JOIN tournaments t ON tg.tournament_id = t.id
        WHERE tg.id = ? AND t.club_id = ?`,
      [group_id, req.club.id]
    );

    if (groupResults.length === 0) {
      return res.status(404).json({ message: "Grupo não encontrado ou acesso negado." });
    }

    const { tournament_id: tournamentId, round_number: roundNumber } = groupResults[0];

    // 2. Duplicata SO na mesma rodada
    const [checkResults] = await db.execute(
      `SELECT gp.user_id
         FROM group_players gp
         JOIN tournament_groups tg ON gp.group_id = tg.id
        WHERE tg.tournament_id = ? AND tg.round_number = ? AND gp.user_id = ?`,
      [tournamentId, roundNumber, user_id]
    );

    if (checkResults.length > 0) {
      return res.status(400).json({
        message: `Este jogador ja esta em outro grupo da R${roundNumber} deste torneio.`
      });
    }

    // 3. Adicionar jogador ao grupo
    await db.execute(
      "INSERT INTO group_players (group_id, user_id) VALUES (?, ?)",
      [group_id, user_id]
    );

    res.status(200).json({ message: "Jogador adicionado com sucesso!" });

  } catch (error) {
    console.error('Erro ao adicionar jogador:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// --- FAXINA 1: Remover jogador do grupo E apagar seus scores fantasmas ---
// Bloco D · commit 2: apaga scores SO da rodada do grupo removido. Se o
// jogador esta em R1 e R2 e o admin remove ele do grupo da R2, os scores
// da R1 continuam preservados.
exports.removePlayer = async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    if (!groupId || !userId) {
      return res.status(400).json({ error: "ID do grupo ou do jogador não informados." });
    }

    const [tResults] = await db.execute(
      `SELECT tg.tournament_id, tg.round_number
         FROM tournament_groups tg
         JOIN tournaments t ON tg.tournament_id = t.id
        WHERE tg.id = ? AND t.club_id = ?`,
      [groupId, req.club.id]
    );

    if (tResults.length === 0) {
      return res.status(404).json({ error: "Grupo não encontrado ou acesso negado." });
    }

    const tId = tResults[0].tournament_id;
    const round = tResults[0].round_number;

    // 1. Remove o jogador do grupo
    await db.execute(
      "DELETE FROM group_players WHERE group_id = ? AND user_id = ?",
      [groupId, userId]
    );

    // 2. Apaga scores DESSA RODADA especifica (nao mais do torneio inteiro)
    if (tId) {
      await db.execute(
        "DELETE FROM scores WHERE tournament_id = ? AND user_id = ? AND round_number = ?",
        [tId, userId, round]
      );
      res.status(200).json({ message: "Jogador e scores da rodada removidos com sucesso!" });
    } else {
      res.status(200).json({ message: "Jogador removido com sucesso!" });
    }

  } catch (error) {
    console.error('Erro ao remover jogador:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

// --- FAXINA 2: Excluir grupo inteiro E apagar TODOS os scores daquele grupo ---
// Bloco D · commit 2: apaga scores SO da rodada do grupo (nao mais do torneio
// inteiro). Sem isso, apagar grupo da R2 apagaria scores da R1 dos mesmos
// jogadores por engano.
exports.deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const [tResults] = await db.execute(
      `SELECT tg.tournament_id, tg.round_number
         FROM tournament_groups tg
         JOIN tournaments t ON tg.tournament_id = t.id
        WHERE tg.id = ? AND t.club_id = ?`,
      [id, req.club.id]
    );

    if (tResults.length === 0) {
      return res.status(404).json({ error: "Grupo não encontrado ou acesso negado." });
    }

    const tId = tResults[0].tournament_id;
    const round = tResults[0].round_number;

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

    // 3. Apaga scores DESSA RODADA especifica pros jogadores que estavam no grupo.
    if (tId && userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM scores WHERE tournament_id = ? AND round_number = ? AND user_id IN (${placeholders})`,
        [tId, round, ...userIds]
      );
      res.json({ message: "Grupo e scores da rodada excluídos!" });
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
    
    let code = null, attempts = 0;
    while (attempts < 20) {
      const candidate = generateAccessCode().toUpperCase();
      try {
        const [result] = await db.execute(
          "UPDATE tournament_groups SET access_code = ? WHERE id = ?",
          [candidate, group_id]
        );
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'Grupo não encontrado.' });
        }
        code = candidate;
        break;
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") { attempts++; continue; }
        throw e;
      }
    }
    if (!code) return res.status(503).json({ error: "Não foi possível gerar código único. Tente novamente." });

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
    // Bloco D · commit 2: g.round_number ja vem via g.* — Scorecard.js usa isso
    // pra saber em qual rodada esta o grupo (fim do autodescoberta por data BRT
    // pra grupos que declaram round explicitamente).
    const groupQuery = `
      SELECT g.*, t.name as tournament_name, c.name as course_name, c.id as course_id
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
    // Bloco D · commit 2: round_number opcional (default 1). Torneio single-round
    // continua funcionando exatamente igual. Multi-round: admin gera SO os
    // grupos daquela rodada — R2 nao apaga R1.
    const roundNumber = Number(req.body.round_number) || 1;

    if (!tournament_id) {
      return res.status(400).json({ error: "tournament_id obrigatório." });
    }

    // 1. Torneio pertence ao clube? (pega format + start_date + total_rounds)
    const [tCheck] = await db.execute(
      "SELECT id, format, start_date, total_rounds FROM tournaments WHERE id = ? AND club_id = ?",
      [tournament_id, req.club.id]
    );
    if (tCheck.length === 0) {
      return res.status(403).json({ error: "Torneio não encontrado ou acesso negado." });
    }
    const format = tCheck[0].format || 'shotgun';
    const startDate = tCheck[0].start_date; // Date ou string
    const totalRounds = Number(tCheck[0].total_rounds) || 1;

    if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > totalRounds) {
      return res.status(400).json({
        error: `Rodada invalida: torneio tem ${totalRounds} rodada(s), tentou gerar grupos na R${roundNumber}.`,
      });
    }

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

    // 3. Limpar scores DA RODADA especificada, so pros jogadores escalados nela.
    // Isso preserva scores de outras rodadas (R2 auto-generate nao apaga R1).
    await db.execute(
      `DELETE s FROM scores s
         JOIN group_players gp ON gp.user_id = s.user_id
         JOIN tournament_groups tg ON tg.id = gp.group_id
        WHERE tg.tournament_id = ?
          AND tg.round_number = ?
          AND s.tournament_id = ?
          AND s.round_number = ?`,
      [tournament_id, roundNumber, tournament_id, roundNumber]
    );

    // 4. Apagar grupos existentes DESSA RODADA (FK group_players CASCADE)
    await db.execute(
      "DELETE FROM tournament_groups WHERE tournament_id = ? AND round_number = ?",
      [tournament_id, roundNumber]
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

      // Retry contra colisão do UNIQUE access_code
      // Nome do flight: single-round mantem "Flight N" (compat); multi-round
      // prefixa "R{N} · Flight N" pra tornar visualmente distinto entre rodadas
      // (imprescindivel pra passar o UNIQUE uk_tgroup_round_name se o mesmo
      // "Flight 1" existir em R1 e R2... espera, o UNIQUE ja permite pq inclui
      // round_number. O prefixo e cosmetico — leitura mais facil pro admin).
      const flightName = totalRounds > 1 ? `R${roundNumber} · Flight ${i + 1}` : `Flight ${i + 1}`;
      let groupId = null, attempts = 0;
      while (attempts < 20) {
        const candidate = generateAccessCode();
        try {
          const [ins] = await db.execute(
            `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole, tee_time)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tournament_id, roundNumber, flightName, candidate, hole, teeTime]
          );
          groupId = ins.insertId;
          break;
        } catch (e) {
          if (e.code === "ER_DUP_ENTRY") { attempts++; continue; }
          throw e;
        }
      }
      if (!groupId) {
        return res.status(503).json({ error: "Não foi possível gerar códigos únicos pra todos os flights. Tente novamente." });
      }

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
      round_number: roundNumber,
    });
  } catch (error) {
    console.error("Erro ao gerar flights automáticos:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// ==========================================
// RE-SEEDING AUTOMATICO ENTRE RODADAS (Bloco D · commit 3)
// ==========================================
// POST /groups/generate-from-standings
// Body: { tournament_id, round_number, interval_minutes? }
//
// Regra: gera grupos da rodada N pela classificacao ABSOLUTA de R(N-1).
// Melhor gross (menor soma) → grupo 1, proximos 4 → grupo 2, e assim por diante.
// Aprovados que NAO completaram R(N-1) (buracos faltando) sao excluidos do
// re-seeding — nao dando pra rankear quem nao jogou.
//
// D3 aprovado: nao considera categorias — so posicao geral no ABSOLUTO.
//
// Substitui grupos + scores DA RODADA N atual, preserva rodadas anteriores.
exports.generateFromStandings = async (req, res) => {
  try {
    const { tournament_id, interval_minutes } = req.body;
    const roundNumber = Number(req.body.round_number);

    if (!tournament_id || !Number.isInteger(roundNumber) || roundNumber < 2) {
      return res.status(400).json({ error: "round_number deve ser inteiro >= 2 (rodada 1 usa /groups/auto-generate)." });
    }

    // 1. Torneio + total_rounds do clube
    const [tCheck] = await db.execute(
      "SELECT id, format, total_rounds FROM tournaments WHERE id = ? AND club_id = ?",
      [tournament_id, req.club.id]
    );
    if (tCheck.length === 0) {
      return res.status(403).json({ error: "Torneio não encontrado ou acesso negado." });
    }
    const totalRounds = Number(tCheck[0].total_rounds) || 1;
    if (roundNumber > totalRounds) {
      return res.status(400).json({
        error: `Rodada invalida: torneio tem ${totalRounds} rodada(s), tentou re-seed R${roundNumber}.`,
      });
    }
    const format = tCheck[0].format || 'shotgun';

    // 2. course_id + round_date de R(N-1) e da propria N (via tournament_rounds)
    const prevRound = roundNumber - 1;
    const [prevRoundRow] = await db.execute(
      "SELECT round_number, round_date, course_id FROM tournament_rounds WHERE tournament_id = ? AND round_number = ?",
      [tournament_id, prevRound]
    );
    if (prevRoundRow.length === 0) {
      return res.status(400).json({ error: `Rodada anterior (R${prevRound}) nao cadastrada em tournament_rounds.` });
    }
    const prevCourseId = prevRoundRow[0].course_id;

    const [thisRoundRow] = await db.execute(
      "SELECT round_number, round_date, course_id FROM tournament_rounds WHERE tournament_id = ? AND round_number = ?",
      [tournament_id, roundNumber]
    );
    if (thisRoundRow.length === 0) {
      return res.status(400).json({ error: `Rodada alvo (R${roundNumber}) nao cadastrada em tournament_rounds.` });
    }
    const thisRoundDate = thisRoundRow[0].round_date;

    // 3. Descobrir quantos buracos tem o curso da R(N-1) — pra determinar completude
    const [holesRaw] = await db.execute(
      "SELECT COUNT(*) AS n FROM holes WHERE course_id = ?", [prevCourseId]
    );
    let expectedHoles = Number(holesRaw[0]?.n || 0);
    if (expectedHoles === 0) {
      const [ch] = await db.execute("SELECT COUNT(*) AS n FROM course_holes WHERE course_id = ?", [prevCourseId]);
      expectedHoles = Number(ch[0]?.n || 0);
    }
    if (expectedHoles === 0) expectedHoles = 18; // fallback padrao

    let intervalMin = 10;
    if (format === 'tee_time') {
      const raw = Number(interval_minutes);
      if (!Number.isFinite(raw) || raw < 1 || raw > 60) {
        return res.status(400).json({ error: "Intervalo entre grupos deve estar entre 1 e 60 minutos." });
      }
      intervalMin = raw;
    }

    // 4. Aprovados que COMPLETARAM R(N-1), ordenados por soma de strokes ASC
    const [standings] = await db.execute(
      `SELECT s.user_id,
              SUM(s.strokes)                                             AS gross,
              COUNT(DISTINCT s.hole_number)                              AS holes_played
         FROM scores s
         JOIN inscriptions i
           ON i.tournament_id = s.tournament_id AND i.user_id = s.user_id AND i.status = 'APPROVED'
        WHERE s.tournament_id = ?
          AND s.round_number  = ?
          AND s.hole_number BETWEEN 1 AND ?
        GROUP BY s.user_id
       HAVING holes_played = ?
        ORDER BY gross ASC, s.user_id ASC`,
      [tournament_id, prevRound, expectedHoles, expectedHoles]
    );

    if (standings.length === 0) {
      return res.status(400).json({
        error: `Nenhum jogador aprovado completou R${prevRound} (${expectedHoles} buracos). Re-seeding automatico exige classificacao completa.`,
      });
    }

    // 5. Apagar grupos + scores da R(N) atual (auto-generate estilo por rodada)
    await db.execute(
      `DELETE s FROM scores s
         JOIN group_players gp ON gp.user_id = s.user_id
         JOIN tournament_groups tg ON tg.id = gp.group_id
        WHERE tg.tournament_id = ?
          AND tg.round_number = ?
          AND s.tournament_id = ?
          AND s.round_number = ?`,
      [tournament_id, roundNumber, tournament_id, roundNumber]
    );
    await db.execute(
      "DELETE FROM tournament_groups WHERE tournament_id = ? AND round_number = ?",
      [tournament_id, roundNumber]
    );

    // 6. Agrupa de 4 em 4 sequencialmente na ordem do standings
    const FLIGHT_SIZE = 4;
    const nFlights = Math.ceil(standings.length / FLIGHT_SIZE);
    const flights = Array.from({ length: nFlights }, () => []);
    standings.forEach((s, idx) => {
      flights[Math.floor(idx / FLIGHT_SIZE)].push(s.user_id);
    });

    // 7. Pre-calcular hora inicial da rodada N pro modo tee_time (BRT)
    let baseTeeHour = 8, baseTeeMin = 0;
    if (format === 'tee_time' && thisRoundDate) {
      const brt = new Date(thisRoundDate).toLocaleString('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const [h, m] = brt.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) { baseTeeHour = h; baseTeeMin = m; }
    }

    // 8. Criar grupos + escalar jogadores
    for (let i = 0; i < flights.length; i++) {
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

      const flightName = `R${roundNumber} · Flight ${i + 1}`;
      let groupId = null, attempts = 0;
      while (attempts < 20) {
        const candidate = generateAccessCode();
        try {
          const [ins] = await db.execute(
            `INSERT INTO tournament_groups (tournament_id, round_number, group_name, access_code, starting_hole, tee_time)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tournament_id, roundNumber, flightName, candidate, hole, teeTime]
          );
          groupId = ins.insertId;
          break;
        } catch (e) {
          if (e.code === "ER_DUP_ENTRY") { attempts++; continue; }
          throw e;
        }
      }
      if (!groupId) {
        return res.status(503).json({ error: "Não foi possível gerar códigos únicos pra todos os flights." });
      }

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
      message: `Re-seeding R${roundNumber} concluido.`,
      round_number: roundNumber,
      groups_created: nFlights,
      players_seeded: standings.length,
      based_on_round: prevRound,
      expected_holes: expectedHoles,
    });
  } catch (error) {
    console.error("Erro no re-seeding:", error);
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

    // Bloco D · commit 2: inclui round_number no SELECT + ORDER BY, e prefixa
    // colunas do Excel com Rodada. Torneio single-round mostra apenas "R1".
    const query = `
      SELECT
        g.round_number,
        g.starting_hole as hole,
        g.group_name as time_or_group,
        g.access_code,
        u.name as player_name,
        u.gender,
        c.name as category_name,
        t.name as tournament_name,
        t.total_rounds
      FROM tournament_groups g
      JOIN tournaments t ON g.tournament_id = t.id
      JOIN group_players gp ON g.id = gp.group_id
      JOIN users u ON gp.user_id = u.id
      LEFT JOIN inscriptions i ON i.user_id = u.id AND i.tournament_id = g.tournament_id AND i.status = 'APPROVED'
      LEFT JOIN tournament_categories c ON i.category_id = c.id
      WHERE g.tournament_id = ?
      ORDER BY g.round_number ASC, CAST(g.starting_hole AS UNSIGNED) ASC, g.group_name ASC, u.name ASC
    `;

    const [results] = await db.execute(query, [tournamentId]);
    
    if (results.length === 0) {
      return res.status(404).json({ message: "Nenhum grupo encontrado." });
    }

    const tournamentName = results[0].tournament_name;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Saídas - Draw');

    // Configura as colunas
    const totalRounds = Number(results[0].total_rounds) || 1;
    sheet.columns = [
      ...(totalRounds > 1 ? [{ header: 'Rodada', key: 'round', width: 8 }] : []),
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

    let currentGroupKey = null;

    results.forEach(row => {
      // Chave inclui round pra separar visualmente grupos de rodadas distintas
      const groupKey = `${row.round_number}-${row.hole}-${row.time_or_group}`;

      // A MÁGICA DE PULAR LINHA: Se o grupo mudou, insere uma linha vazia!
      if (currentGroupKey !== null && currentGroupKey !== groupKey) {
        sheet.addRow([]);
      }
      currentGroupKey = groupKey;

      const rowData = {
        hole: row.hole || '-',
        time: row.time_or_group || '-',
        code: row.access_code || '-',
        player: row.player_name || 'Desconhecido',
        cat: row.category_name || 'Sem Categoria',
        gender: row.gender === 'M' || row.gender === 'Masculino' ? 'Masc' : 'Fem'
      };
      if (totalRounds > 1) rowData.round = `R${row.round_number}`;

      const newRow = sheet.addRow(rowData);

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