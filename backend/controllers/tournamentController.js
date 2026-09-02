// backend/controllers/tournamentController.js
const db = require('../db');

// ─── Pontuação por Resultado (Onda A · Commit 2 · 2026-08-31) ────────────────
// Lista canônica dos resultados aceitos, na ordem "melhor → pior" (útil pra UI).
// Bate 1:1 com o ENUM de scores.result_kind e tournament_result_points.result_kind.
const RESULT_KINDS = ['hio', 'albatross', 'eagle', 'birdie', 'par', 'bogey', 'double_bogey', 'triple_bogey'];

// Defaults sugeridos (padrão Stableford básico). Aplicados apenas quando o admin
// liga scoring_type='result_points' e NÃO envia result_points no payload — assim
// o torneio já nasce com config válida e admin pode ajustar depois.
const DEFAULT_RESULT_POINTS = {
  hio: 8, albatross: 6, eagle: 5, birdie: 3, par: 2, bogey: 1, double_bogey: 0, triple_bogey: -1,
};

// Normaliza scoring_type — só aceita os 2 valores do ENUM. Qualquer outra coisa
// (undefined, null, string maliciosa) vira 'strokes', o default seguro.
function normalizeScoringType(raw) {
  return raw === 'result_points' ? 'result_points' : 'strokes';
}

// Normaliza flag enabled do payload. Aceita true/false, 1/0, undefined → 1 (default).
function normalizeEnabled(raw) {
  if (raw === undefined || raw === null) return 1;
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (raw === false || raw === 0 || raw === '0') return 0;
  return null; // sinaliza inválido pro caller
}

// Valida payload result_points do admin e devolve {pointsMap, enabledMap} ou erro.
// Aceita:
//   - undefined/null → aplica DEFAULT_RESULT_POINTS + todos enabled=1
//   - array [{result_kind, points, enabled?}] com todos os 8 kinds válidos e points inteiro
// Rejeita: kinds fora da lista canônica; points não-inteiro; entradas duplicadas;
//   enabled em formato inválido; TODOS os 8 kinds desativados (Scorecard ficaria vazio).
// A tabela é "tudo-ou-nada" — todos os 8 kinds precisam ter LINHA no banco (com valor
// de points), pra Scorecard nunca cair num result sem pontos configurados. O flag
// enabled apenas ESCONDE a opção no Scorecard/AdminEditor — o dado persiste.
// Bloco 2 · Commit 2.2 (2026-09-01): campo enabled ganhou suporte.
function buildResultPointsMap(raw) {
  if (raw === undefined || raw === null) {
    const enabledMap = {};
    RESULT_KINDS.forEach(k => { enabledMap[k] = 1; });
    return { pointsMap: { ...DEFAULT_RESULT_POINTS }, enabledMap };
  }
  if (!Array.isArray(raw)) return { error: 'result_points deve ser um array [{result_kind, points, enabled?}].' };

  const pointsMap = {};
  const enabledMap = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { error: 'Cada entrada de result_points deve ser um objeto {result_kind, points, enabled?}.' };
    }
    const kind = entry.result_kind;
    if (!RESULT_KINDS.includes(kind)) {
      return { error: `result_kind inválido: '${kind}'. Aceitos: ${RESULT_KINDS.join(', ')}.` };
    }
    if (kind in pointsMap) {
      return { error: `result_kind duplicado: '${kind}'.` };
    }
    const points = Number(entry.points);
    if (!Number.isInteger(points)) {
      return { error: `points de '${kind}' deve ser um inteiro.` };
    }
    const enabled = normalizeEnabled(entry.enabled);
    if (enabled === null) {
      return { error: `enabled de '${kind}' deve ser boolean (true/false).` };
    }
    pointsMap[kind] = points;
    enabledMap[kind] = enabled;
  }
  // Exige todos os 8 kinds — evita ScoreCard com botão "Birdie" sem pontos configurados.
  const missing = RESULT_KINDS.filter(k => !(k in pointsMap));
  if (missing.length > 0) {
    return { error: `result_points incompleto — faltam: ${missing.join(', ')}.` };
  }
  // Bloco 2: pelo menos 1 kind precisa estar enabled (senão o Scorecard fica
  // sem nenhum botão pra clicar). Defesa em profundidade — o admin também vê
  // aviso no Dashboard.
  const anyEnabled = RESULT_KINDS.some(k => enabledMap[k] === 1);
  if (!anyEnabled) {
    return { error: 'Pelo menos um tipo de resultado precisa ficar ativo.' };
  }
  return { pointsMap, enabledMap };
}

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

        // Onda A · commit 2: sempre expõe result_points[] no response. Torneio
        // 'strokes' vem com array vazio (Scorecard/Leaderboard ignoram); torneio
        // 'result_points' vem com 8 entradas na ordem canônica RESULT_KINDS pra
        // a UI de config renderizar sem se preocupar com faltas.
        // Bloco 2 · Commit 2.2: cada entrada agora inclui `enabled` (0|1).
        const [rpRows] = await db.execute(
            `SELECT result_kind, points, enabled FROM tournament_result_points WHERE tournament_id = ?`,
            [id]
        );
        const rpMap = Object.fromEntries(
            rpRows.map(r => [r.result_kind, { points: Number(r.points), enabled: Number(r.enabled) }])
        );
        tournament.result_points = RESULT_KINDS
            .filter(k => k in rpMap)
            .map(k => ({ result_kind: k, points: rpMap[k].points, enabled: rpMap[k].enabled }));

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
        // Onda A · commit 2: scoring_type ('strokes' | 'result_points') + result_points[]
        // Bloco 2 · Commit 2.2: buildResultPointsMap agora devolve pointsMap + enabledMap.
        const scoring_type = normalizeScoringType(req.body.scoring_type);
        const rpParse = scoring_type === 'result_points'
            ? buildResultPointsMap(req.body.result_points)
            : { pointsMap: null, enabledMap: null };
        if (rpParse.error) return res.status(400).json({ error: rpParse.error });

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
             (name, start_date, course_id, description, fee, payment_info, pix_key_type, whatsapp_contact, registration_deadline, format, total_rounds, scoring_type, club_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, start_date, course_id, nn(description), nn(fee), nn(payment_info), nn(pix_key_type), nn(whatsapp_contact), nn(registration_deadline), fmt, total_rounds, scoring_type, req.club.id]
        );
        const tournamentId = result.insertId;

        // Onda A · commit 2: se result_points, insere config. Se strokes, ignora
        // qualquer result_points que tenha vindo no payload — mantém a tabela limpa.
        // Bloco 2 · Commit 2.2: também grava enabled (default 1 se admin nao mandar).
        if (scoring_type === 'result_points' && rpParse.pointsMap) {
            const rpRows = RESULT_KINDS.map(k => [tournamentId, k, rpParse.pointsMap[k], rpParse.enabledMap[k]]);
            await conn.query(
                'INSERT INTO tournament_result_points (tournament_id, result_kind, points, enabled) VALUES ?',
                [rpRows]
            );
        }

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
        res.json({ message: 'Torneio criado!', id: tournamentId, total_rounds, scoring_type });
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
        // Onda A · commit 2: scoring_type — mesma lógica de total_rounds. Se veio
        // no body, respeita; senão mantém o atual. Assim admin editando outro campo
        // não flipa acidentalmente o torneio de 'result_points' pra 'strokes'.
        const scoring_type_input = req.body.scoring_type !== undefined
            ? normalizeScoringType(req.body.scoring_type)
            : undefined;
        // result_points: só interpretamos se scoring_type EFETIVO for 'result_points'
        // — resolução final abaixo depois de saber o valor efetivo.
        const rawRP = req.body.result_points;

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
            'SELECT id, total_rounds, scoring_type FROM tournaments WHERE id = ? AND club_id = ?',
            [id, req.club.id]
        );
        if (tRows.length === 0) {
            return res.status(404).json({ error: 'Torneio não encontrado ou acesso negado.' });
        }
        const currentTotalRounds = Number(tRows[0].total_rounds);
        const total_rounds = total_rounds_input !== undefined ? total_rounds_input : currentTotalRounds;
        // scoring_type efetivo: preferência ao input; senão mantém o atual.
        const scoring_type = scoring_type_input !== undefined ? scoring_type_input : (tRows[0].scoring_type || 'strokes');
        // Onda A · commit 2: interpreta result_points condicionalmente.
        //   - scoring_type efetivo é 'result_points':
        //       - se rawRP veio, valida e usa pra REPLACE
        //       - se rawRP NÃO veio E scoring_type mudou de 'strokes' pra 'result_points' agora,
        //         aplica defaults (torneio nasce com config válida)
        //       - se rawRP NÃO veio E scoring_type já era 'result_points', preserva config atual
        //         (não faz replace)
        //   - scoring_type efetivo é 'strokes': ignora rawRP; se veio, será limpo abaixo
        //     (admin trocou de 'result_points' pra 'strokes' — apagamos config antiga).
        // Bloco 2 · Commit 2.2: agora persistimos pointsMap E enabledMap juntos.
        let rpPointsForReplace = null;      // se != null, faz DELETE+INSERT
        let rpEnabledForReplace = null;     // acompanha rpPointsForReplace
        let clearResultPoints = false;      // se true, faz só DELETE
        if (scoring_type === 'result_points') {
            if (rawRP !== undefined) {
                const rpParse = buildResultPointsMap(rawRP);
                if (rpParse.error) return res.status(400).json({ error: rpParse.error });
                rpPointsForReplace = rpParse.pointsMap;
                rpEnabledForReplace = rpParse.enabledMap;
            } else if (tRows[0].scoring_type !== 'result_points') {
                // Torneio virou result_points AGORA sem admin mandar config — aplica defaults.
                rpPointsForReplace = { ...DEFAULT_RESULT_POINTS };
                rpEnabledForReplace = Object.fromEntries(RESULT_KINDS.map(k => [k, 1]));
            }
            // else: mantém config atual, não toca
        } else {
            // scoring_type virou 'strokes' — se antes era 'result_points', limpa config órfã.
            if (tRows[0].scoring_type === 'result_points') clearResultPoints = true;
        }

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
             whatsapp_contact=?, registration_deadline=?, format=?, total_rounds=?, scoring_type=?
             WHERE id=? AND club_id=?`,
            [name, start_date, course_id, nn(description), nn(fee), nn(payment_info), nn(pix_key_type),
             nn(whatsapp_contact), nn(registration_deadline), fmt, total_rounds, scoring_type, id, req.club.id]
        );

        // Onda A · commit 2 + Bloco 2 · Commit 2.2: replace atômico da config de
        // pontos (points + enabled), quando aplicável. Se rpPointsForReplace veio,
        // DELETE + INSERT dos 8 kinds. Se clearResultPoints, só DELETE (torneio
        // voltou pra 'strokes' e config antiga vira lixo).
        if (rpPointsForReplace) {
            await conn.execute('DELETE FROM tournament_result_points WHERE tournament_id = ?', [id]);
            const rpRows = RESULT_KINDS.map(k => [id, k, rpPointsForReplace[k], rpEnabledForReplace[k]]);
            await conn.query(
                'INSERT INTO tournament_result_points (tournament_id, result_kind, points, enabled) VALUES ?',
                [rpRows]
            );
        } else if (clearResultPoints) {
            await conn.execute('DELETE FROM tournament_result_points WHERE tournament_id = ?', [id]);
        }

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
        res.json({ message: 'Torneio atualizado com sucesso!', total_rounds, scoring_type });
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