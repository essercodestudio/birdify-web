// Sugestão de tee por faixa de handicap (Bloco 4).
// Consome as regras retornadas por GET /api/courses/:id/tee-rules e o
// handicap declarado no lobby. Nada persistido; puro cálculo.

export const TEE_META = {
  white:  { label: "Branco", border: "#ddd",    bg: "#fff"    },
  yellow: { label: "Preto",  border: "#ffd700", bg: "#fffacd" },
  blue:   { label: "Azul",   border: "#3b82f6", bg: "#e6f2ff" },
  red:    { label: "Verde",  border: "#22c55e", bg: "#e8fbe8" },
};

// Aceita 'M', 'F', 'Masculino', 'Feminino', undefined, null, etc.
function normalizeGender(g) {
  if (!g) return null;
  const s = String(g).trim().toUpperCase();
  if (s === "M" || s === "MASCULINO") return "M";
  if (s === "F" || s === "FEMININO") return "F";
  return null;
}

/**
 * @param {number|string} handicap
 * @param {string|null} gender
 * @param {Array<{gender:string, tee_color:string, handicap_min:number, handicap_max:number}>} rules
 * @returns {{status:'match'|'out_of_range'|'no_rules', tee_color?:string, label?:string, meta?:object}}
 */
export function suggestTee(handicap, gender, rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { status: "no_rules" };
  }
  const hc = Number(handicap);
  if (!Number.isFinite(hc)) return { status: "no_rules" };

  const normGender = normalizeGender(gender);
  const applicable = rules.filter(
    (r) => r.gender === "ALL" || (normGender && r.gender === normGender),
  );
  if (applicable.length === 0) return { status: "no_rules" };

  const match = applicable.find(
    (r) => hc >= Number(r.handicap_min) && hc <= Number(r.handicap_max),
  );
  if (!match) return { status: "out_of_range" };

  const meta = TEE_META[match.tee_color] || {
    label: match.tee_color, border: "#94a3b8", bg: "#e5e7eb",
  };
  return { status: "match", tee_color: match.tee_color, label: meta.label, meta };
}
