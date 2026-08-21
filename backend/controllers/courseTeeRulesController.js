// backend/controllers/courseTeeRulesController.js
//
// Regras de "faixa de handicap → cor de tee" por campo.
// - GET  /api/courses/:id/tee-rules   → jogador+admin (requireAuth); devolve rules[] + warnings[]
// - PUT  /api/courses/:id/tee-rules   → admin (requireAdmin); bulk replace transacional
//
// Regras de validação:
//   overlap dentro do mesmo (course, gender)  → 400 (bloqueia)
//   gap entre faixas dentro do mesmo gender   → warning (não bloqueia)
//   'ALL' misturado com 'M'/'F' no mesmo campo → 400
//   min > max, ou fora de [0, 54.0]           → 400
//   gender/tee_color fora do enum              → 400
//
// Handicap é DECIMAL(4,1) — comparações usam step 0.1. Duas faixas são
// consideradas contíguas se A.max + 0.1 === B.min.

const db = require("../db");

const STEP = 0.1;
const HC_MIN = 0.0;
const HC_MAX = 54.0;
const GENDERS = ["M", "F", "ALL"];
const COLORS = ["white", "yellow", "blue", "red"];

// Trunca ruído de float pra 1 casa (DECIMAL(4,1) é a granularidade real).
const round1 = (n) => Math.round(n * 10) / 10;

// Confirma que o campo pertence ao clube do request (multi-tenant guard).
async function assertCourseInClub(courseId, clubId) {
  const [rows] = await db.execute(
    "SELECT id FROM courses WHERE id = ? AND club_id = ?",
    [courseId, clubId],
  );
  return rows.length > 0;
}

// Detecta gaps por gênero. NÃO reporta "gap final" (raro admin fechar até 54).
// Reporta:
//   - gap inicial: se a menor faixa começa acima de 0.0
//   - gaps internos: entre faixas consecutivas com espaço > 0.1
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

// Valida payload. Retorna { ok:true, normalized } ou { ok:false, error }.
function validatePayload(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Payload deve ser um array de regras." };
  }

  const normalized = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {};
    const gender = String(r.gender || "").toUpperCase();
    const tee_color = String(r.tee_color || "").toLowerCase();
    const min = Number(r.handicap_min);
    const max = Number(r.handicap_max);
    const display_order = Number.isFinite(Number(r.display_order))
      ? Number(r.display_order)
      : 0;

    if (!GENDERS.includes(gender)) {
      return { ok: false, error: `Regra ${i + 1}: gender inválido "${r.gender}". Use M, F ou ALL.` };
    }
    if (!COLORS.includes(tee_color)) {
      return { ok: false, error: `Regra ${i + 1}: tee_color inválido "${r.tee_color}". Use white, yellow, blue ou red.` };
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
      tee_color,
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
          error: `Sobreposição de faixas em ${gender}: ${a.tee_color} (${a.handicap_min}-${a.handicap_max}) e ${b.tee_color} (${b.handicap_min}-${b.handicap_max}). Um handicap não pode cair em dois tees.`,
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

    const [rows] = await db.execute(
      `SELECT id, gender, tee_color, handicap_min, handicap_max, display_order
         FROM course_tee_rules
        WHERE course_id = ?
        ORDER BY gender, display_order, handicap_min`,
      [courseId],
    );

    const rules = rows.map((r) => ({
      id: r.id,
      gender: r.gender,
      tee_color: r.tee_color,
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
// Payload: { rules: [ { gender, tee_color, handicap_min, handicap_max, display_order? } ] }
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

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute("DELETE FROM course_tee_rules WHERE course_id = ?", [courseId]);

    if (normalized.length > 0) {
      const values = normalized.map((r) => [
        courseId,
        r.gender,
        r.tee_color,
        r.handicap_min,
        r.handicap_max,
        r.display_order,
      ]);
      await conn.query(
        `INSERT INTO course_tee_rules
           (course_id, gender, tee_color, handicap_min, handicap_max, display_order)
         VALUES ?`,
        [values],
      );
    }

    await conn.commit();

    const [rows] = await db.execute(
      `SELECT id, gender, tee_color, handicap_min, handicap_max, display_order
         FROM course_tee_rules
        WHERE course_id = ?
        ORDER BY gender, display_order, handicap_min`,
      [courseId],
    );
    const rules = rows.map((r) => ({
      id: r.id,
      gender: r.gender,
      tee_color: r.tee_color,
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
