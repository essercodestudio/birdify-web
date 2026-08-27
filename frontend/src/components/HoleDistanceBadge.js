// frontend/src/components/HoleDistanceBadge.js
// Renderiza uma pill por cor de tee preenchida no buraco (blue/white/yellow/red).
// Cada pill mostra a jarda com o fundo colorido do tee correspondente — padrão
// internacional de golfe. Buracos sem nenhuma jarda preenchida não renderizam nada.
//
// Prop opcional `slotMap` (course_yard_slot_map): quando presente e um slot está
// mapeado pra um tee dinâmico, a pill usa a cor do tee em vez da default. Título
// (tooltip) da pill vira o nome do tee. Se `slotMap` não vier, comportamento
// default preservado.
import React from "react";

const YARDS_PER_METER = 1.0936;

// Cores default de cada slot físico (fallback quando o admin não mapeou o
// slot pra um tee dinâmico). Sem `label` no fallback — o nome legado
// ("Branco/Preto/Azul/Verde") não corresponde a nenhum tee real, então
// não deve vazar como tooltip. Se mapeado, `collect()` sobrescreve
// com o nome do tee dinâmico.
const TEES = [
  { key: "yards_blue",   slot: "blue",   bg: "#0077b6", fg: "#ffffff", border: "#0077b6" },
  { key: "yards_white",  slot: "white",  bg: "#ffffff", fg: "#000000", border: "#cbd5e1" },
  { key: "yards_yellow", slot: "yellow", bg: "#eab308", fg: "#000000", border: "#eab308" },
  { key: "yards_red",    slot: "red",    bg: "#dc2626", fg: "#ffffff", border: "#dc2626" },
];

// Deriva foreground (preto/branco) a partir do brilho do bg. Evita amarelo com fg branco (ilegível).
function pickFg(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return "#000000";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#000000" : "#ffffff";
}

function collect(hole, slotMap) {
  if (!hole) return [];
  const out = [];
  for (const t of TEES) {
    const raw = Number(hole[t.key]);
    if (raw <= 0) continue;
    const mapping = slotMap?.[t.slot];
    if (mapping) {
      out.push({
        ...t,
        bg: mapping.color_hex,
        border: mapping.color_hex,
        fg: pickFg(mapping.color_hex),
        label: mapping.tee_name,
        value: Math.round(raw),
      });
    } else {
      out.push({ ...t, value: Math.round(raw) });
    }
  }
  // Fallback: se o clube guarda em metros (colunas raras) — mostra como se fosse tee único.
  if (out.length === 0) {
    const metersCandidates = [hole.meters, hole.metros, hole.distance_meters];
    for (const v of metersCandidates) {
      const n = Number(v);
      if (n > 0) {
        out.push({
          key: "yards_generic", bg: "#334155", fg: "#ffffff", border: "#334155",
          value: Math.round(n * YARDS_PER_METER),
        });
        break;
      }
    }
  }
  return out;
}

// compact = pills menores (default). Usado no scorecard (torneio + treino) onde
// o espaço lateral é apertado no mobile por causa dos botões ◀▶ de navegação.
export default function HoleDistanceBadge({ hole, compact = true, slotMap = null }) {
  const items = collect(hole, slotMap);
  if (items.length === 0) return null;

  const style = compact
    ? { padding: "2px 7px",  fontSize: 10, gap: 4 }
    : { padding: "3px 10px", fontSize: 12, gap: 6 };

  return (
    <span
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: style.gap,
        alignItems: "center",
        justifyContent: "center",
        maxWidth: "100%",
      }}
    >
      {items.map((t) => (
        <span
          key={t.key}
          title={t.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            backgroundColor: t.bg,
            color: t.fg,
            border: `1px solid ${t.border}`,
            padding: style.padding,
            borderRadius: 999,
            fontSize: style.fontSize,
            fontWeight: 700,
            letterSpacing: 0.3,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {t.value} jd
        </span>
      ))}
    </span>
  );
}
