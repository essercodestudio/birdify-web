// frontend/src/components/HoleDistanceBadge.js
// Renderiza uma pill por cor de tee preenchida no buraco (blue/white/yellow/red).
// Cada pill mostra a jarda com o fundo colorido do tee correspondente — padrão
// internacional de golfe. Buracos sem nenhuma jarda preenchida não renderizam nada.
import React from "react";

const YARDS_PER_METER = 1.0936;

// Cores oficiais dos tees no golfe.
const TEES = [
  { key: "yards_blue",   bg: "#0077b6", fg: "#ffffff", border: "#0077b6" },
  { key: "yards_white",  bg: "#ffffff", fg: "#000000", border: "#cbd5e1" },
  { key: "yards_yellow", bg: "#eab308", fg: "#000000", border: "#eab308" },
  { key: "yards_red",    bg: "#dc2626", fg: "#ffffff", border: "#dc2626" },
];

function collect(hole) {
  if (!hole) return [];
  const out = [];
  for (const t of TEES) {
    const raw = Number(hole[t.key]);
    if (raw > 0) out.push({ ...t, value: Math.round(raw) });
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
export default function HoleDistanceBadge({ hole, compact = true }) {
  const items = collect(hole);
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
