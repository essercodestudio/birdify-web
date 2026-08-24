// Sugestão de tee por faixa de handicap (Bloco 4, extendido no Bloco C).
// Consome as regras retornadas por GET /api/courses/:id/tee-rules — o
// backend faz JOIN com course_tees e devolve tee_name + color_hex reais.
// O util só decide qual regra aplicar; renderização visa direto o dado.
//
// Retro-compat: se por algum motivo (rollback futuro do backend) a rule
// não trouxer tee_name/color_hex mas trouxer tee_color legado, cai em
// fallback determinístico com labels PT-BR históricas.

const LEGACY_LABEL = {
  white: "Branco", yellow: "Amarelo", blue: "Azul", red: "Vermelho",
};
const LEGACY_HEX = {
  white: "#ffffff", yellow: "#eab308", blue: "#0077b6", red: "#dc2626",
};

function normalizeGender(g) {
  if (!g) return null;
  const s = String(g).trim().toUpperCase();
  if (s === "M" || s === "MASCULINO") return "M";
  if (s === "F" || s === "FEMININO") return "F";
  return null;
}

// Extrai nome/cor da rule, priorizando o formato novo (tee_name/color_hex)
// e caindo pro legado se ausente.
function displayFor(rule) {
  const name = rule.tee_name || LEGACY_LABEL[rule.tee_color] || "Tee";
  const hex  = rule.color_hex || LEGACY_HEX[rule.tee_color] || "#94a3b8";
  return { name, hex };
}

/**
 * @param {number|string} handicap
 * @param {string|null} gender
 * @param {Array<{gender:string, tee_name?:string, color_hex?:string, tee_color?:string, handicap_min:number, handicap_max:number}>} rules
 * @returns {{status:'match'|'out_of_range'|'no_rules', tee_name?:string, color_hex?:string}}
 */
export function suggestTee(handicap, gender, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return { status: "no_rules" };
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

  const { name, hex } = displayFor(match);
  return { status: "match", tee_name: name, color_hex: hex };
}
