// backend/controllers/tournamentController.js
const db = require('../db');

exports.listTournaments = async (req, res) => {
    try {
        // Pega o ID do jogador que a tela enviou para saber se ele já está inscrito
        const userId = req.query.user_id || 0; 

        // Filtro NOT REGEXP: esconde registros legados "Treino AAAA-MM-DD" gerados
        // pelo cron da meia-noite antes do fix do Item 3 (commit 67a5000). O cron
        // foi removido, mas as linhas ficaram na base — sem esse filtro elas
        // aparecem no PlayerHome como torneio aberto pra inscrição.
        const query = `
            SELECT t.*,
                   c.name as course_name, c.city as course_city, c.state as course_state,
                   (SELECT COUNT(*) FROM inscriptions i WHERE i.tournament_id = t.id AND i.user_id = ?) as is_subscribed
            FROM tournaments t
            LEFT JOIN courses c ON t.course_id = c.id
            WHERE t.club_id = ?
              AND t.name NOT REGEXP '^Treino [0-9]{4}-[0-9]{2}-[0-9]{2}$'
            ORDER BY t.start_date ASC
        `;
        
        const [results] = await db.execute(query, [userId, req.club.id]);
        res.json(results);
        
    } catch (error) {
        console.error('Erro ao listar torneios:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 2. BUSCAR UM TORNEIO ESPECÍFICO (Agora puxa categorias E patrocinadores limpos)
exports.getTournament = async (req, res) => {
    try {
        const { id } = req.params;
        
        const [tournamentResults] = await db.execute('SELECT * FROM tournaments WHERE id = ? AND club_id = ?', [id, req.club.id]);
        
        if (tournamentResults.length === 0) {
            return res.status(404).json({ message: "Torneio não encontrado ou acesso negado." });
        }

        const tournament = tournamentResults[0];

        // Remove a coluna de texto zoada (que gerava os colchetes [ e ])
        delete tournament.categories;

        // Busca as categorias corretas
        const [catResults] = await db.execute('SELECT name FROM tournament_categories WHERE tournament_id = ?', [id]);
        tournament.categories = catResults ? catResults.map(c => c.name) : [];

        // Busca os patrocinadores corretos
        const [sponResults] = await db.execute('SELECT name, image_url FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        tournament.sponsors = sponResults || [];

        // Item 5 · commit 2: sempre expõe rounds[] no response. Torneio single-round
        // vem com 1 item; multi-rodada com N. Frontend novo consome rounds; frontend
        // antigo ignora (nenhum campo antigo foi removido).
        const [roundRows] = await db.execute(
            `SELECT tr.round_number, tr.round_date, tr.course_id, c.name AS course_name
               FROM tournament_rounds tr
               LEFT JOIN courses c ON c.id = tr.course_id
              WHERE tr.tournament_id = ?
              ORDER BY tr.round_number ASC`,
            [id]
        );
        tournament.rounds = roundRows;

        res.json(tournament);
        
    } catch (error) {
        console.error('Erro ao buscar torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// ─── helpers de validação de data ────────────────────────────────────────────
// Sanidade de ano (evita 9999). O frontend recebe DATETIME em BRT como string
// "YYYY-MM-DDTHH:MM" sem sufixo de fuso — comparar como string é cronológico
// e evita bug de timezone do servidor (que pode estar em UTC).
function validateYear(dateStr) {
    const year = parseInt(String(dateStr || '').substring(0, 4));
    return !isNaN(year) && year >= 2020 && year <= 2035;
}

// ─── helpers de multi-rodada (Item 5 · commit 2 · 2026-08-28) ────────────────
// Normaliza total_rounds. Torneios legados/single-round: default 1.
function normalizeTotalRounds(raw) {
    const n = parseInt(raw);
    if (!Number.isFinite(n) || n < 1) return 1;
    if (n > 10) return 10; // hard cap defensivo — torneios reais raramente passam de 4
    return n;
}

// Valida o payload rounds[] contra total_rounds + escopo do clube. Retorna
// null se OK, ou { status, error } pra devolver ao client. As regras:
//   - length precisa === total_rounds
//   - round_number precisa ser sequencial 1..N sem gap
//   - round_date estritamente crescente (bloqueia R2 < R1, aprovado explicitamente)
//   - course_id de cada round precisa pertencer ao clube
async function validateRoundsPayload(rounds, totalRounds, clubId, dbConn) {
    if (totalRounds === 1) {
        // Aceita rounds ausente OU array de 1 elemento válido. Não impõe.
        if (rounds !== undefined && (!Array.isArray(rounds) || rounds.length !== 1)) {
            return { status: 400, error: 'Torneio single-round: envie rounds=[{...}] com 1 item ou omita o campo.' };
        }
        return null;
    }
    // total_rounds > 1: rounds obrigatório
    if (!Array.isArray(rounds) || rounds.length !== totalRounds) {
        return { status: 400, error: `Torneio de ${totalRounds} rodadas precisa de rounds[] com exatamente ${totalRounds} itens.` };
    }
    // Sequência 1..N + curso do clube + ordem crescente de round_date
    const sorted = [...rounds].sort((a, b) => Number(a.round_number) - Number(b.round_number));
    for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        const rn = Number(r.round_number);
        if (rn !== i + 1) {
            return { status: 400, error: `round_number precisa ser sequencial 1..${totalRounds} sem gaps.` };
        }
        if (!validateYear(r.round_date)) {
            return { status: 400, error: `round_number=${rn}: round_date inválida.` };
        }
        if (i > 0 && normDate(r.round_date) <= normDate(sorted[i - 1].round_date)) {
            return { status: 400, error: `Datas das rodadas precisam ser estritamente crescentes (R${rn} <= R${rn - 1}).` };
        }
        // Curso pertence ao clube?
        const [ck] = await dbConn.execute(
            'SELECT id FROM courses WHERE id = ? AND club_id = ?',
            [Number(r.course_id), clubId]
        );
        if (ck.length === 0) {
            return { status: 400, error: `round_number=${rn}: course_id ${r.course_id} não pertence a este clube.` };
        }
    }
    return null;
}

// "Agora" no formato YYYY-MM-DDTHH:MM em BRT (Birdify é BR-only).
function nowBRT() {
    return new Date()
        .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })
        .replace(' ', 'T').slice(0, 16);
}

// Normaliza a string do cliente pra formato comparável.
function normDate(d) {
    return String(d || '').slice(0, 16);
}

function isPast(dateStr) {
    if (!dateStr) return false;
    return normDate(dateStr) < nowBRT();
}

function deadlineBeforeStart(deadline, start) {
    if (!deadline || !start) return true;
    return normDate(deadline) < normDate(start);
}

// 3. CRIAR TORNEIO
exports.createTournament = async (req, res) => {
    const conn = await db.getConnection();
    try {
        const {
            name, start_date, course_id, description, fee, payment_info, pix_key_type,
            whatsapp_contact, registration_deadline, categories, sponsors, format, rounds
        } = req.body;
        const total_rounds = normalizeTotalRounds(req.body.total_rounds);

        if (!validateYear(start_date)) {
            return res.status(400).json({ error: 'Data do torneio inválida.' });
        }
        if (registration_deadline && !validateYear(registration_deadline)) {
            return res.status(400).json({ error: 'Data limite de inscrição inválida.' });
        }
        // Criação: não permite data no passado.
        if (isPast(start_date)) {
            return res.status(400).json({ error: 'A data do torneio deve ser futura.' });
        }
        if (registration_deadline && isPast(registration_deadline)) {
            return res.status(400).json({ error: 'A data limite de inscrição deve ser futura.' });
        }
        if (!deadlineBeforeStart(registration_deadline, start_date)) {
            return res.status(400).json({ error: 'A data limite de inscrição deve ser anterior à data do torneio.' });
        }
        const fmt = format === 'tee_time' ? 'tee_time' : 'shotgun';

        // Verifica se o campo pertence ao clube (single-round usa esse; multi valida por round)
        const [courseCheck] = await conn.execute(
            'SELECT id FROM courses WHERE id = ? AND club_id = ?',
            [course_id, req.club.id]
        );

        if (courseCheck.length === 0) {
            return res.status(403).json({ error: 'Campo não encontrado ou acesso negado.' });
        }

        // Item 5 · commit 2: se multi-rodada, valida payload rounds[] antes de tocar no DB.
        // Se single-round, valida também (aceita rounds ausente OU array de 1 item).
        const roundsErr = await validateRoundsPayload(rounds, total_rounds, req.club.id, conn);
        if (roundsErr) return res.status(roundsErr.status).json({ error: roundsErr.error });

        // Também valida: R1 tem que estar no futuro se rounds veio; a mesma regra de
        // start_date se aplica a cada round_date.
        if (Array.isArray(rounds)) {
            for (const r of rounds) {
                if (isPast(r.round_date)) {
                    return res.status(400).json({ error: `round_number=${r.round_number}: round_date no passado.` });
                }
            }
        }

        // Transação: torneio + rounds + categorias + patrocinadores. Se qualquer passo
        // falhar, ROLLBACK — não fica torneio sem rounds nem vice-versa.
        await conn.beginTransaction();

        // mysql2 recusa undefined em bind; MySQL recusa string vazia em coluna
        // datetime NULL. Normaliza os dois pra NULL de uma vez.
        const nn = (v) => (v === undefined || v === '' ? null : v);
        const [result] = await conn.execute(
            `INSERT INTO tournaments
             (name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline, format, total_rounds, club_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, start_date, course_id, nn(description), nn(fee), nn(payment_info), nn(pix_key_type), nn(whatsapp_contact), nn(registration_deadline), fmt, total_rounds, req.club.id]
        );
        const tournamentId = result.insertId;

        // tournament_rounds: se rounds veio, insere N; se não veio (single-round),
        // insere 1 R1 default (mesmo padrão do backfill da migration).
        const roundRows = Array.isArray(rounds) && rounds.length > 0
            ? rounds.map(r => [tournamentId, Number(r.round_number), r.round_date, Number(r.course_id)])
            : [[tournamentId, 1, start_date, Number(course_id)]];
        await conn.query(
            'INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES ?',
            [roundRows]
        );

        if (categories && categories.length > 0) {
            const catValues = categories.map(cat => [tournamentId, cat]);
            await conn.query('INSERT INTO tournament_categories (tournament_id, name) VALUES ?', [catValues]);
        }
        if (sponsors && sponsors.length > 0) {
            const sponValues = sponsors.map(s => [tournamentId, s.name, s.image_url]);
            await conn.query('INSERT INTO tournament_sponsors (tournament_id, name, image_url) VALUES ?', [sponValues]);
        }

        await conn.commit();
        res.json({ message: 'Torneio criado!', id: tournamentId, total_rounds });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('Erro ao criar torneio:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    } finally {
        conn.release();
    }
};

// 4. ATUALIZAR TORNEIO
exports.updateTournament = async (req, res) => {
    const conn = await db.getConnection();
    try {
        const { id } = req.params;
        const {
            name, start_date, course_id, description, fee, payment_info, pix_key_type,
            whatsapp_contact, registration_deadline, categories, sponsors, format, rounds
        } = req.body;
        // Se veio total_rounds no body, respeita; senão mantém o atual (não sobrescreve
        // torneio multi-rodada existente por acidente quando o admin só edita descrição).
        const rawTR = req.body.total_rounds;
        const total_rounds_input = rawTR === undefined ? undefined : normalizeTotalRounds(rawTR);

        if (!validateYear(start_date)) {
            return res.status(400).json({ error: 'Data do torneio inválida.' });
        }
        if (registration_deadline && !validateYear(registration_deadline)) {
            return res.status(400).json({ error: 'Data limite de inscrição inválida.' });
        }
        // Edição: não valida "data no passado" (permite editar torneio antigo pra
        // corrigir descrição, fee, etc). Só exige consistência entre as datas.
        if (!deadlineBeforeStart(registration_deadline, start_date)) {
            return res.status(400).json({ error: 'A data limite de inscrição deve ser anterior à data do torneio.' });
        }
        const fmt = format === 'tee_time' ? 'tee_time' : 'shotgun';

        // Escopo do clube + estado atual
        const [tRows] = await conn.execute(
            'SELECT id, total_rounds FROM tournaments WHERE id = ? AND club_id = ?',
            [id, req.club.id]
        );
        if (tRows.length === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }
        const currentTotalRounds = Number(tRows[0].total_rounds);
        const total_rounds = total_rounds_input !== undefined ? total_rounds_input : currentTotalRounds;

        // Verifica se o campo (do torneio single-round) pertence ao clube.
        // Pra multi-rodada, cada round é validado individualmente em validateRoundsPayload.
        const [courseCheck] = await conn.execute(
            'SELECT id FROM courses WHERE id = ? AND club_id = ?',
            [course_id, req.club.id]
        );
        if (courseCheck.length === 0) {
            return res.status(403).json({ error: 'Campo não encontrado ou acesso negado.' });
        }

        // Se veio rounds explícito OU se total_rounds vai mudar, valida payload.
        // Se admin só edita descrição (rounds ausente, total_rounds igual ao atual), não mexe em tournament_rounds.
        const willReplaceRounds = Array.isArray(rounds) || (total_rounds_input !== undefined && total_rounds_input !== currentTotalRounds);
        if (willReplaceRounds) {
            const roundsErr = await validateRoundsPayload(rounds, total_rounds, req.club.id, conn);
            if (roundsErr) return res.status(roundsErr.status).json({ error: roundsErr.error });
        }

        await conn.beginTransaction();

        const nn = (v) => (v === undefined ? null : v);
        await conn.execute(
            `UPDATE tournaments SET
             name=?, start_date=?, course_id=?, description=?, fee=?, payment_info=?, pix_key_type=?,
             whatsapp_contact=?, registration_deadline=?, format=?, total_rounds=?
             WHERE id=? AND club_id=?`,
            [name, start_date, course_id, nn(description), nn(fee), nn(payment_info), nn(pix_key_type),
             nn(whatsapp_contact), nn(registration_deadline), fmt, total_rounds, id, req.club.id]
        );

        if (willReplaceRounds) {
            // Replace atômico. NOTA: se já existirem scores gravados em rounds diferentes,
            // ON DELETE CASCADE do tournament_rounds NÃO apaga scores (scores tem FK direta
            // pra tournaments, não pra rounds). Scores continuam válidos com round_number
            // antigos — se o admin renumerar rodadas, isso pode desalinhar. Regra de
            // produto: replace de rounds só pra torneios AINDA sem scores gravados.
            const [[{ n: existingScores }]] = await conn.query(
                'SELECT COUNT(*) AS n FROM scores WHERE tournament_id = ?', [id]
            );
            if (existingScores > 0 && Array.isArray(rounds)) {
                await conn.rollback();
                return res.status(409).json({
                    error: 'Torneio já tem tacadas gravadas; não é possível reconfigurar as rodadas. Ajuste manualmente pelo painel /admin/ajustar-scores se necessário.',
                });
            }
            await conn.execute('DELETE FROM tournament_rounds WHERE tournament_id = ?', [id]);
            const roundRows = Array.isArray(rounds) && rounds.length > 0
                ? rounds.map(r => [id, Number(r.round_number), r.round_date, Number(r.course_id)])
                : [[id, 1, start_date, Number(course_id)]];
            await conn.query(
                'INSERT INTO tournament_rounds (tournament_id, round_number, round_date, course_id) VALUES ?',
                [roundRows]
            );
        }

        await conn.execute('DELETE FROM tournament_categories WHERE tournament_id = ?', [id]);
        if (categories && categories.length > 0) {
            const catValues = categories.map(cat => [id, cat]);
            await conn.query('INSERT INTO tournament_categories (tournament_id, name) VALUES ?', [catValues]);
        }
        await conn.execute('DELETE FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        if (sponsors && sponsors.length > 0) {
            const sponValues = sponsors.map(s => [id, s.name || 'Patrocinador', s.image_url || '']);
            await conn.query('INSERT INTO tournament_sponsors (tournament_id, name, image_url) VALUES ?', [sponValues]);
        }

        await conn.commit();
        res.json({ message: 'Torneio atualizado com sucesso!', total_rounds });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('Erro ao atualizar torneio:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    } finally {
        conn.release();
    }
};

// 5. EXCLUIR TORNEIO
exports.deleteTournament = async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica se o torneio pertence ao clube antes de excluir
        const [tournamentCheck] = await db.execute(
            'SELECT id FROM tournaments WHERE id = ? AND club_id = ?',
            [id, req.club.id]
        );
        
        if (tournamentCheck.length === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }

        // Executar todas as operações de exclusão em sequência (devido às dependências de chave estrangeira)
        
        // 1. Deletar scores
        await db.execute('DELETE FROM scores WHERE tournament_id = ?', [id]);
        
        // 2. Deletar group_players (precisa do tournament_id via tournament_groups)
        await db.execute(
            'DELETE gp FROM group_players gp JOIN tournament_groups tg ON gp.group_id = tg.id WHERE tg.tournament_id = ?', 
            [id]
        );
        
        // 3. Deletar grupos do torneio
        await db.execute('DELETE FROM tournament_groups WHERE tournament_id = ?', [id]);
        
        // 4. Deletar inscrições
        await db.execute('DELETE FROM inscriptions WHERE tournament_id = ?', [id]);
        
        // 5. Deletar categorias
        await db.execute('DELETE FROM tournament_categories WHERE tournament_id = ?', [id]);
        
        // 6. Deletar patrocinadores
        await db.execute('DELETE FROM tournament_sponsors WHERE tournament_id = ?', [id]);
        
        // 7. Finalmente, deletar o torneio
        const [result] = await db.execute('DELETE FROM tournaments WHERE id = ? AND club_id = ?', [id, req.club.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado.' });
        }
        
        res.json({ message: 'Torneio excluído com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao excluir torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};

// 6. ALTERAR STATUS DO TORNEIO (Concluir / Reabrir)
exports.toggleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // Vai receber 'ativo' ou 'concluido'
        
        // Validação básica
        if (!['ativo', 'concluido'].includes(status)) {
            return res.status(400).json({ 
                error: 'Status inválido. Use "ativo" ou "concluido".' 
            });
        }
        
        const [result] = await db.execute('UPDATE tournaments SET status = ? WHERE id = ? AND club_id = ?', [status, id, req.club.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }
        
        res.json({ message: `Torneio marcado como ${status} com sucesso!` });
        
    } catch (error) {
        console.error('Erro ao alterar status do torneio:', error);
        res.status(500).json({ 
            error: 'Erro interno no servidor.'
        });
    }
};