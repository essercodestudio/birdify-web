// backend/controllers/courseTeeRulesController.js
//
// Regras de "faixa de handicap → tee" por campo.
// - GET  /api/courses/:id/tee-rules   → jogador+admin (requireAuth); devolve rules[] + warnings[]
// - PUT  /api/courses/:id/tee-rules   → admin (requireAdmin); bulk replace transacional
//
// Regras de validação:
//   overlap dentro do mesmo (course, gender)   → 400 (bloqueia)
//   gap entre faixas dentro do mesmo gender    → warning (não bloqueia)
//   'ALL' misturado com 'M'/'F' no mesmo campo → 400
//   min > max, ou fora de [0, 54.0]            → 400
//   tee_id ausente ou não pertence ao course   → 400
//
// FONTE DA VERDADE: `tee_id` (FK → course_tees). A coluna legada
// `tee_color` (ENUM, nullable) é preenchida por retro-compat quando o
// tee_name bater com um dos 4 nomes históricos ('Branco'/'Amarelo'/
// 'Azul'/'Vermelho') — rede de segurança pra rollback do backend novo
// (o código antigo lê tee_color e cai bem). Nomes customizados
// ('Championship', 'Sênior') gravam tee_color=NULL — código antigo não
// conseguiria ler; aceitável porque nomes customizados só existem no
// mundo novo. Ver TODO em [[project_todo_drop_tee_color]] pra dropar
// a coluna quando o backend novo estiver estável.
//
// Handicap é DECIMAL(4,1) — comparações usam step 0.1. Duas faixas são
// contíguas se A.max + 0.1 === B.min.

const db = require("../db");

const STEP = 0.1;
const HC_MIN = 0.0;
const HC_MAX = 54.0;
const GENDERS = ["M", "F", "ALL"];

// Mapa reverso pra derivar tee_color legado a partir do tee_name padrão.
// Se o tee_name for customizado (não bater), tee_color fica NULL.
const NAME_TO_LEGACY_COLOR = {
  "Branco":   "white",
  "Amarelo":  "yellow",
  "Azul":     "blue",
  "Vermelho": "red",
};

const round1 = (n) => Math.round(n * 10) / 10;

async function assertCourseInClub(courseId, clubId) {
  const [rows] = await db.execute(
    "SELECT id FROM courses WHERE id = ? AND club_id = ?",
    [courseId, clubId],
  );
  return rows.length > 0;
}

function detectGaps(rules) {
  const warnings = [];
  const byGender = new Map();
  for (const r of rules) {
    if (!byGender.has(r.gender)) byGender.set(r.gender, []);
    byGender.get(r.gender).push(r);
  }

  for (const [gender, list] of byGender) {
    const sorted = [...list].sort((a, b) => a.handicap_min - b.handicap_min);

    if (sorted[0].handicap_min > HC_MIN + STEP / 2) {
      warnings.push({
        type: "gap_at_start",
        gender,
        uncovered_min: HC_MIN,
        uncovered_max: round1(sorted[0].handicap_min - STEP),
      });
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b.handicap_min - a.handicap_max > STEP + STEP / 2) {
        warnings.push({
          type: "gap",
          gender,
          uncovered_min: round1(a.handicap_max + STEP),
          uncovered_max: round1(b.handicap_min - STEP),
        });
      }
    }
  }
  return warnings;
}

// Valida payload sem tocar no banco. Retorna { ok, normalized } ou { ok:false, error }.
// Não valida se tee_id pertence ao course — isso é checado em batch depois
// (uma query só, mais eficiente que N).
function validatePayload(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Payload deve ser um array de regras." };
  }

  const normalized = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {};
    const gender = String(r.gender || "").toUpperCase();
    const tee_id = Number(r.tee_id);
    const min = Number(r.handicap_min);
    const max = Number(r.handicap_max);
    const display_order = Number.isFinite(Number(r.display_order))
      ? Number(r.display_order)
      : 0;

    if (!GENDERS.includes(gender)) {
      return { ok: false, error: `Regra ${i + 1}: gender inválido "${r.gender}". Use M, F ou ALL.` };
    }
    if (!Number.isInteger(tee_id) || tee_id <= 0) {
      return { ok: false, error: `Regra ${i + 1}: tee_id obrigatório e numérico.` };
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { ok: false, error: `Regra ${i + 1}: handicap_min/max precisam ser numéricos.` };
    }
    if (min < HC_MIN || max > HC_MAX) {
      return { ok: false, error: `Regra ${i + 1}: handicap fora do intervalo permitido (${HC_MIN} a ${HC_MAX}).` };
    }
    if (min > max) {
      return { ok: false, error: `Regra ${i + 1}: handicap_min (${min}) maior que handicap_max (${max}).` };
    }

    normalized.push({
      gender,
      tee_id,
      handicap_min: round1(min),
      handicap_max: round1(max),
      display_order,
    });
  }

  const hasAll = normalized.some((r) => r.gender === "ALL");
  const hasGendered = normalized.some((r) => r.gender !== "ALL");
  if (hasAll && hasGendered) {
    return {
      ok: false,
      error: "Não misture regras 'ALL' com 'M'/'F' no mesmo campo — escolha um dos dois modelos.",
    };
  }

  // Overlap por gender (usa tee_id na mensagem — o cliente resolve pro nome depois)
  const byGender = new Map();
  for (const r of normalized) {
    if (!byGender.has(r.gender)) byGender.set(r.gender, []);
    byGender.get(r.gender).push(r);
  }
  for (const [gender, list] of byGender) {
    const sorted = [...list].sort((a, b) => a.handicap_min - b.handicap_min);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b.handicap_min <= a.handicap_max) {
        return {
          ok: false,
          error: `Sobreposição de faixas em ${gender}: tee_id ${a.tee_id} (${a.handicap_min}-${a.handicap_max}) e tee_id ${b.tee_id} (${b.handicap_min}-${b.handicap_max}). Um handicap não pode cair em dois tees.`,
        };
      }
    }
  }

  return { ok: true, normalized };
}

exports.getTeeRules = async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!courseId) return res.status(400).json({ error: "ID de campo inválido." });

    if (!(await assertCourseInClub(courseId, req.club.id))) {
      return res.status(404).json({ error: "Campo não encontrado ou acesso negado." });
    }

    // JOIN com course_tees pra devolver dados de renderização (nome/cor)
    // junto da regra — o frontend não precisa fazer segunda query.
    const [rows] = await db.execute(
      `SELECT r.id, r.gender, r.tee_id, r.handicap_min, r.handicap_max, r.display_order,
              t.tee_name, t.color_hex
         FROM course_tee_rules r
         LEFT JOIN course_tees t ON t.id = r.tee_id
        WHERE r.course_id = ?
        ORDER BY r.gender, r.display_order, r.handicap_min`,
      [courseId],
    );

    const rules = rows.map((r) => ({
      id: r.id,
      gender: r.gender,
      tee_id: r.tee_id,
      tee_name: r.tee_name,
      color_hex: r.color_hex,
      // Retro-compat: frontend antigo (Bloco 4 pré-Bloco C) espera tee_color.
      // Deriva do tee_name pros 4 padrão; null se nome customizado.
      tee_color: NAME_TO_LEGACY_COLOR[r.tee_name] || null,
      handicap_min: Number(r.handicap_min),
      handicap_max: Number(r.handicap_max),
      display_order: r.display_order,
    }));

    res.json({ rules, warnings: detectGaps(rules) });
  } catch (err) {
    console.error("Erro ao listar tee rules:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Bulk replace transacional: apaga tudo do campo e insere o novo conjunto.
// Payload: { rules: [ { gender, tee_id, handicap_min, handicap_max, display_order? } ] }
// Array vazio = apaga todas as regras do campo.
exports.replaceTeeRules = async (req, res) => {
  const courseId = Number(req.params.id);
  if (!courseId) return res.status(400).json({ error: "ID de campo inválido." });

  if (!(await assertCourseInClub(courseId, req.club.id))) {
    return res.status(404).json({ error: "Campo não encontrado ou acesso negado." });
  }

  const validation = validatePayload(req.body?.rules);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const { normalized } = validation;

  // Cross-course guard: todo tee_id do payload precisa pertencer ao course_id
  // da URL. Uma query batch (evita N queries).
  if (normalized.length > 0) {
    const teeIds = [...new Set(normalized.map((r) => r.tee_id))];
    const placeholders = teeIds.map(() => "?").join(",");
    const [ownedRows] = await db.query(
      `SELECT id, tee_name FROM course_tees WHERE course_id = ? AND id IN (${placeholders})`,
      [courseId, ...teeIds],
    );
    const ownedIds = new Set(ownedRows.map((r) => r.id));
    const orphan = teeIds.find((id) => !ownedIds.has(id));
    if (orphan !== undefined) {
      return res.status(400).json({
        error: `tee_id ${orphan} não pertence ao campo ${courseId}.`,
      });
    }
    // Anota tee_name em cada regra normalized pra derivar tee_color legado no INSERT
    const nameById = new Map(ownedRows.map((r) => [r.id, r.tee_name]));
    for (const r of normalized) {
      r.legacyTeeColor = NAME_TO_LEGACY_COLOR[nameById.get(r.tee_id)] || null;
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute("DELETE FROM course_tee_rules WHERE course_id = ?", [courseId]);

    if (normalized.length > 0) {
      const values = normalized.map((r) => [
        courseId,
        r.gender,
        r.legacyTeeColor,
        r.tee_id,
        r.handicap_min,
        r.handicap_max,
        r.display_order,
      ]);
      await conn.query(
        `INSERT INTO course_tee_rules
           (course_id, gender, tee_color, tee_id, handicap_min, handicap_max, display_order)
         VALUES ?`,
        [values],
      );
    }

    await conn.commit();

    const [rows] = await db.execute(
      `SELECT r.id, r.gender, r.tee_id, r.handicap_min, r.handicap_max, r.display_order,
              t.tee_name, t.color_hex
         FROM course_tee_rules r
         LEFT JOIN course_tees t ON t.id = r.tee_id
        WHERE r.course_id = ?
        ORDER BY r.gender, r.display_order, r.handicap_min`,
      [courseId],
    );
    const rules = rows.map((r) => ({
      id: r.id,
      gender: r.gender,
      tee_id: r.tee_id,
      tee_name: r.tee_name,
      color_hex: r.color_hex,
      // Retro-compat: frontend antigo (Bloco 4 pré-Bloco C) espera tee_color.
      // Deriva do tee_name pros 4 padrão; null se nome customizado.
      tee_color: NAME_TO_LEGACY_COLOR[r.tee_name] || null,
      handicap_min: Number(r.handicap_min),
      handicap_max: Number(r.handicap_max),
      display_order: r.display_order,
    }));

    res.json({
      message: `${rules.length} regra(s) de tee salva(s).`,
      rules,
      warnings: detectGaps(rules),
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error("Erro ao gravar tee rules:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  } finally {
    conn.release();
  }
};
