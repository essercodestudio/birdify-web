// frontend/src/components/HoleDistanceBadge.js
// Badge de distância em jardas com cor por par (3=info azul, 4=verde, 5=gold).
// Se a coluna do banco estiver em metros (nome com "meters"/"metros"), converte pra jardas.
import React from "react";

const YARDS_PER_METER = 1.0936;

function pickDistance(hole) {
  if (!hole) return { value: 0, unit: "jd" };
  // Prioridade: primeira coluna com valor > 0 na ordem "trás pra frente"
  const yardsCandidates = [hole.yards_black, hole.yards_blue, hole.yards_white, hole.yards_yellow, hole.yards_red, hole.yards];
  for (const v of yardsCandidates) {
    const n = Number(v);
    if (n > 0) return { value: Math.round(n), unit: "jd" };
  }
  const metersCandidates = [hole.meters, hole.metros, hole.distance_meters];
  for (const v of metersCandidates) {
    const n = Number(v);
    if (n > 0) return { value: Math.round(n * YARDS_PER_METER), unit: "jd" };
  }
  return { value: 0, unit: "jd" };
}

function colorForPar(par) {
  const p = Number(par);
  if (p === 3) return "#38bdf8";
  if (p === 5) return "#eab308";
  return "#22c55e"; // par 4 (e default)
}

export default function HoleDistanceBadge({ hole }) {
  const { value, unit } = pickDistance(hole);
  if (!value) return null;
  const bg = colorForPar(hole?.par);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        backgroundColor: bg,
        color: "#fff",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 0.3,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {value} {unit}
    </span>
  );
}
