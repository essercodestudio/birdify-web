// Card 1080x1350 (Instagram 4:5) renderizado em canvas offscreen para virar
// imagem via html-to-image. Componente puro: só recebe dados prontos e desenha.
// Fica escondido em position:fixed left:-9999px enquanto o hook captura.
import React, { forwardRef } from "react";

const MARKETING_URL = process.env.REACT_APP_MARKETING_URL || "birdify.com.br";

const WIDTH  = 1080;
const HEIGHT = 1350;

const COLORS = {
  bg:        "#0f172a",
  card:      "#1e293b",
  cardLight: "#334155",
  textMain:  "#f8fafc",
  textMuted: "#94a3b8",
  divider:   "#334155",
  gold:      "#eab308",
  green:     "#4ade80",
  red:       "#ef4444",
  neutral:   "#cbd5e1",
};

function parBadgeColor(vsPar) {
  if (vsPar < 0) return { color: COLORS.green,   bg: "rgba(74,222,128,0.15)" };
  if (vsPar > 0) return { color: COLORS.red,     bg: "rgba(239,68,68,0.15)" };
  return           { color: COLORS.neutral, bg: "rgba(203,213,225,0.10)" };
}

function formatVsPar(vsPar) {
  if (vsPar === 0) return "E";
  return vsPar > 0 ? `+${vsPar}` : `${vsPar}`;
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last  = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const Divider = () => (
  <div style={{ height: 1, backgroundColor: COLORS.divider, margin: "40px 80px" }} />
);

const StatBlock = ({ value, label, color }) => (
  <div style={{ textAlign: "center", flex: 1 }}>
    <div style={{
      width: 88, height: 88, borderRadius: "50%",
      backgroundColor: color + "22",
      border: `3px solid ${color}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      margin: "0 auto 14px",
    }}>
      <span style={{ fontSize: 42, fontWeight: 900, color, lineHeight: 1 }}>{value}</span>
    </div>
    <div style={{
      fontSize: 18, fontWeight: 700, color: COLORS.textMuted,
      textTransform: "uppercase", letterSpacing: 1.5,
    }}>{label}</div>
  </div>
);

const ScorephotoCard = forwardRef(function ScorephotoCard(
  {
    playerName,
    playerPhotoUrl,
    clubName,
    clubLogoUrl,
    clubAccent = "#22c55e",
    mode = "training",         // 'training' | 'tournament'
    totalStrokes,
    vsPar,                      // number: -3, 0, +5
    stats = { eagles: 0, birdies: 0, pars: 0, bogeys: 0 },
    courseName,
    date,                       // string 'DD/MM/YYYY' ou Date
    tournamentName,
  },
  ref
) {
  const badge = parBadgeColor(vsPar);
  const modeLabel = mode === "tournament" ? "TORNEIO" : "TREINO DO DIA";
  const dateStr = date instanceof Date
    ? date.toLocaleDateString("pt-BR")
    : (date || new Date().toLocaleDateString("pt-BR"));

  return (
    <div
      ref={ref}
      style={{
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: COLORS.bg,
        color: COLORS.textMain,
        fontFamily: "'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header — logo clube + tag do modo */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "50px 60px 0",
      }}>
        <div style={{ height: 64, display: "flex", alignItems: "center" }}>
          {clubLogoUrl ? (
            <img
              src={clubLogoUrl}
              alt={clubName || ""}
              crossOrigin="anonymous"
              style={{ maxHeight: 64, maxWidth: 240, objectFit: "contain" }}
            />
          ) : (
            <span style={{
              fontSize: 22, fontWeight: 800, color: COLORS.textMain,
              letterSpacing: 1,
            }}>{clubName || ""}</span>
          )}
        </div>
        <div style={{
          padding: "10px 20px",
          borderRadius: 999,
          backgroundColor: clubAccent + "22",
          border: `2px solid ${clubAccent}`,
          fontSize: 18, fontWeight: 800, color: clubAccent,
          letterSpacing: 2,
        }}>
          {modeLabel}
        </div>
      </div>

      {/* Foto + nome */}
      <div style={{ textAlign: "center", marginTop: 60 }}>
        <div style={{
          width: 220, height: 220, borderRadius: "50%",
          margin: "0 auto 30px",
          border: `6px solid ${clubAccent}`,
          overflow: "hidden",
          backgroundColor: COLORS.card,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {playerPhotoUrl ? (
            <img
              src={playerPhotoUrl}
              alt={playerName}
              crossOrigin="anonymous"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span style={{ fontSize: 90, fontWeight: 900, color: clubAccent }}>
              {initials(playerName)}
            </span>
          )}
        </div>
        <div style={{
          fontSize: 44, fontWeight: 800, color: COLORS.textMain,
          padding: "0 60px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {playerName || "—"}
        </div>
      </div>

      <Divider />

      {/* Score gigante + vs par */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 180, fontWeight: 900, color: COLORS.textMain, lineHeight: 1 }}>
          {totalStrokes ?? "—"}
        </div>
        <div style={{
          fontSize: 20, fontWeight: 700, color: COLORS.textMuted,
          textTransform: "uppercase", letterSpacing: 3, marginTop: 8,
        }}>
          Tacadas
        </div>
        <div style={{
          display: "inline-block", marginTop: 24,
          padding: "12px 36px", borderRadius: 999,
          backgroundColor: badge.bg,
          border: `2px solid ${badge.color}`,
          fontSize: 40, fontWeight: 900, color: badge.color,
        }}>
          {formatVsPar(vsPar)} <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>VS PAR</span>
        </div>
      </div>

      <Divider />

      {/* Stats */}
      <div style={{ display: "flex", padding: "0 60px", gap: 12 }}>
        <StatBlock value={stats.eagles  || 0} label="Eagle+" color={COLORS.gold} />
        <StatBlock value={stats.birdies || 0} label="Birdies" color={COLORS.green} />
        <StatBlock value={stats.pars    || 0} label="Pares"   color={COLORS.neutral} />
        <StatBlock value={stats.bogeys  || 0} label="Bogey+"  color={COLORS.red} />
      </div>

      <Divider />

      {/* Campo + data + torneio */}
      <div style={{ padding: "0 80px", textAlign: "center" }}>
        {tournamentName && (
          <div style={{ fontSize: 26, fontWeight: 800, color: clubAccent, marginBottom: 14 }}>
            {tournamentName}
          </div>
        )}
        <div style={{ fontSize: 22, color: COLORS.textMain, marginBottom: 6 }}>
          {courseName || "Campo"}
        </div>
        <div style={{ fontSize: 18, color: COLORS.textMuted }}>
          {dateStr}
        </div>
      </div>

      {/* Rodapé — marca discreta */}
      <div style={{
        marginTop: "auto",
        padding: "24px 60px",
        borderTop: `1px solid ${COLORS.divider}`,
        display: "flex", justifyContent: "center", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 18, color: COLORS.textMuted, letterSpacing: 1 }}>
          Faça o seu em
        </span>
        <span style={{ fontSize: 18, fontWeight: 800, color: clubAccent, letterSpacing: 1 }}>
          {MARKETING_URL}
        </span>
      </div>
    </div>
  );
});

export default ScorephotoCard;
export { WIDTH as SCOREPHOTO_WIDTH, HEIGHT as SCOREPHOTO_HEIGHT };
