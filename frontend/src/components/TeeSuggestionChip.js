// Chip de sugestão de tee mostrado abaixo do input de handicap no lobby
// (torneio + treino). Três comportamentos aprovados no Bloco 4:
//   match         → chip verde "🎯 Sugerido: <Cor>"
//   out_of_range  → chip cinza "Handicap fora das faixas — confirme com o starter"
//   no_rules      → não renderiza nada (feature silenciosamente desligada)
//
// O componente é auto-controlado: recebe handicap/gender/rules e decide.

import React from "react";
import { suggestTee } from "../utils/teeSuggestion";

export default function TeeSuggestionChip({ handicap, gender, rules }) {
  const s = suggestTee(handicap, gender, rules);
  if (s.status === "no_rules") return null;

  if (s.status === "out_of_range") {
    return (
      <div
        style={{
          marginTop: 6,
          padding: "4px 10px",
          borderRadius: 999,
          backgroundColor: "rgba(148,163,184,0.12)",
          border: "1px solid #475569",
          color: "#94a3b8",
          fontSize: 11,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          lineHeight: 1.3,
        }}
      >
        Handicap fora das faixas — confirme com o starter
      </div>
    );
  }

  // match
  return (
    <div
      style={{
        marginTop: 6,
        padding: "4px 10px",
        borderRadius: 999,
        backgroundColor: "rgba(34,197,94,0.14)",
        border: "1px solid #22c55e",
        color: "#22c55e",
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        lineHeight: 1.3,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: s.meta.bg,
          border: `2px solid ${s.meta.border}`,
        }}
      />
      Sugerido: Tee {s.label}
    </div>
  );
}
