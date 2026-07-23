// frontend/src/hooks/useBirdifyTheme.js
// Retorna a paleta unificada do Birdify, substituindo accent e bg pelas cores
// dinâmicas do clube (white-label) quando definidas.
//
// Como usar:
//   const theme = useBirdifyTheme();
//   <div style={{ backgroundColor: theme.card, color: theme.textMain }}>...
//
// theme.accent = cor primária do clube (fallback verde #22c55e)
// theme.bg     = cor de fundo do clube (fallback #0f172a)
// theme.accentContrast = cor do texto ideal sobre theme.accent (branco ou preto)
import { useContext, useMemo } from "react";
import { ThemeContext } from "../App";

// ── Design tokens (aprovados na auditoria de identidade visual) ──────────────
// Tipografia: objetos prontos pra spread — <h1 style={{ ...theme.text.h1 }}>.
// display (800) é só pra números grandes (score, HI); h1 (700) é título de
// página — pesos separados de propósito pra não competirem na mesma tela.
const TEXT = {
  display:  { fontSize: 32, fontWeight: 800, lineHeight: 1.15 },
  h1:       { fontSize: 24, fontWeight: 700, lineHeight: 1.2 },
  h2:       { fontSize: 20, fontWeight: 700, lineHeight: 1.25 },
  h3:       { fontSize: 16, fontWeight: 700, lineHeight: 1.3 },
  body:     { fontSize: 14, lineHeight: 1.5 },
  caption:  { fontSize: 12, lineHeight: 1.4 },
  overline: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 },
};

// Escala de espaçamento: usar sempre um destes valores (px).
// space[1]=4, space[2]=8, space[3]=12, space[4]=16, space[5]=24, space[6]=32, space[7]=48
const SPACE = [0, 4, 8, 12, 16, 24, 32, 48];

// Raio: sm = botões/inputs/chips, md = cards/modais, pill = badges redondos.
const RADIUS = { sm: 8, md: 12, pill: 999 };

// Sombra: só dois níveis. sm = cards; lg = modais/drawer/toast. Sem glow colorido.
const SHADOW = {
  sm: "0 1px 3px rgba(0, 0, 0, 0.3)",
  lg: "0 12px 32px rgba(0, 0, 0, 0.45)",
};

const FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif";

// Paleta base — todas as telas usam esse conjunto.
const BASE = {
  bg:         "#0f172a",
  card:       "#1e293b",
  cardLight:  "#334155",
  border:     "#334155",
  accent:     "#22c55e",
  gold:       "#eab308",
  info:       "#38bdf8",
  danger:     "#ef4444",
  textMain:   "#f8fafc",
  textMuted:  "#94a3b8",
  whatsapp:   "#25D366",
  // Cores especificamente auxiliares que NÃO são o "accent" — não substituídas.
  chartAreaFrom: "rgba(34,197,94,0.4)",
  chartAreaTo:   "rgba(34,197,94,0)",
};

// Retorna preto ou branco baseado no brilho da cor hex.
// Uso: pra escolher a cor do texto de um botão preenchido com a cor do clube.
function pickContrast(hex) {
  if (!hex || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return "#000";
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived brightness (ITU-R BT.601)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "#000" : "#fff";
}

// Gera versão "alpha" do accent (usada em overlays sutis)
function accentAlpha(hex, alpha) {
  let h = (hex || "#22c55e").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function useBirdifyTheme() {
  const club = useContext(ThemeContext);

  return useMemo(() => {
    const accent = club?.primary_color || BASE.accent;
    const bg = club?.background_color || BASE.bg;
    return {
      ...BASE,
      font: FONT,
      text: TEXT,
      space: SPACE,
      radius: RADIUS,
      shadow: SHADOW,
      accent,
      bg,
      accentContrast: pickContrast(accent),
      accentSoft: accentAlpha(accent, 0.15),
      accentSofter: accentAlpha(accent, 0.08),
      chartAreaFrom: accentAlpha(accent, 0.4),
      chartAreaTo: accentAlpha(accent, 0),
    };
  }, [club?.primary_color, club?.background_color]);
}
