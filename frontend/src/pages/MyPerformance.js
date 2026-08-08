// frontend/src/pages/MyPerformance.js
// Análise de desempenho do jogador — média por tipo de par + ranking dos buracos
// mais difíceis + frase de insight. Consome GET /api/players/me/performance.
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import {
  LuArrowLeft,
  LuTarget,
  LuLightbulb,
  LuFlag,
  LuChevronDown,
} from "react-icons/lu";

const PERIOD_OPTIONS = [
  { value: "last20", label: "Últimas 20 rodadas" },
  { value: "month",  label: "Este mês" },
  { value: "season", label: "Esta temporada" },
  { value: "all",    label: "Todas as rodadas" },
];

// Cor do número principal baseada em quão longe do par: pareado/abaixo = accent,
// até 1 tacada acima = gold, mais que isso = danger. Mantém o padrão do scorecard.
function diffColor(theme, avgDiff) {
  if (avgDiff <= 0) return theme.accent;
  if (avgDiff <= 1) return theme.gold;
  return theme.danger;
}

function formatDiff(avgDiff) {
  if (avgDiff === 0) return "E";
  const sign = avgDiff > 0 ? "+" : "";
  return `${sign}${avgDiff.toFixed(1)}`;
}

function MyPerformance() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const loggedUser = getUser();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Filtro de período. Não persiste entre sessões (decisão de produto).
  const [period, setPeriod] = useState("last20");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);

  useEffect(() => {
    if (!loggedUser?.id) {
      navigate("/login", { replace: true });
      return;
    }
    setLoading(true);
    api
      .get(`/players/me/performance?period=${period}`)
      .then((res) => setData(res.data))
      .catch(() => setError("Erro ao carregar seu desempenho."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const { space, radius, shadow, text } = theme;

  const st = {
    page: {
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      fontFamily: theme.font,
      padding: `${space[4]}px ${space[4]}px ${space[6]}px`,
    },
    inner: { maxWidth: 560, margin: "0 auto" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: space[5],
      paddingBottom: space[4],
      borderBottom: `1px solid ${theme.border}`,
    },
    btnBack: {
      background: "transparent",
      color: theme.textMuted,
      border: "none",
      padding: `${space[2]}px ${space[3]}px`,
      borderRadius: radius.sm,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: space[2],
      fontWeight: 700,
      fontSize: 13,
      fontFamily: theme.font,
    },
    title: {
      ...text.h3,
      color: theme.textMain,
      display: "inline-flex",
      alignItems: "center",
      gap: space[2],
    },
    periodWrap: {
      position: "relative",
      display: "inline-block",
      marginBottom: space[4],
    },
    periodChip: {
      display: "inline-flex",
      alignItems: "center",
      gap: space[2],
      padding: `${space[2]}px ${space[3]}px`,
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.sm,
      color: theme.textMain,
      ...text.caption,
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: theme.font,
    },
    periodMenu: {
      position: "absolute",
      top: "calc(100% + 4px)",
      left: 0,
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.lg,
      minWidth: 200,
      zIndex: 50,
      overflow: "hidden",
    },
    periodItem: (active) => ({
      display: "block",
      width: "100%",
      textAlign: "left",
      background: active ? theme.accentSoft : "transparent",
      color: active ? theme.accent : theme.textMain,
      border: "none",
      padding: `${space[3]}px ${space[4]}px`,
      cursor: "pointer",
      fontFamily: theme.font,
      ...text.body,
      fontWeight: active ? 700 : 500,
    }),
    parGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: space[3],
      marginBottom: space[5],
    },
    parCard: {
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      padding: `${space[4]}px ${space[2]}px`,
      textAlign: "center",
    },
    parLabel: {
      ...text.overline,
      color: theme.textMuted,
      marginBottom: space[2],
    },
    parValue: {
      ...text.display,
      lineHeight: 1,
      marginBottom: space[1],
    },
    parCount: {
      ...text.caption,
      color: theme.textMuted,
    },
    sectionTitle: {
      ...text.overline,
      color: theme.textMuted,
      marginBottom: space[3],
      display: "flex",
      alignItems: "center",
      gap: space[2],
    },
    holeCard: {
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      padding: `${space[3]}px ${space[4]}px`,
      marginBottom: space[2],
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
    holeMain: {
      ...text.body,
      color: theme.textMain,
      fontWeight: 700,
    },
    holeMeta: {
      ...text.caption,
      color: theme.textMuted,
      marginTop: 2,
    },
    holeDiff: {
      ...text.h2,
      lineHeight: 1,
    },
    insightCard: {
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderLeft: `4px solid ${theme.accent}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      padding: space[4],
      marginTop: space[5],
      display: "flex",
      alignItems: "flex-start",
      gap: space[3],
    },
    empty: {
      textAlign: "center",
      color: theme.textMuted,
      padding: `${space[6]}px ${space[4]}px`,
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
    },
    noticeFoot: {
      ...text.caption,
      color: theme.textMuted,
      textAlign: "center",
      marginTop: space[5],
      padding: `${space[3]}px ${space[4]}px`,
      border: `1px dashed ${theme.border}`,
      borderRadius: radius.sm,
    },
  };

  const renderContent = () => {
    if (loading) {
      return <div style={{ ...st.empty, ...text.body }}>Carregando...</div>;
    }
    if (error) {
      return (
        <div style={{ ...st.empty, color: theme.danger }}>{error}</div>
      );
    }
    if (!data) return null;

    // Empty state: sem rodadas suficientes pra qualquer análise confiável.
    if (data.rounds_analyzed < 3) {
      return (
        <div style={st.empty}>
          <LuTarget size={32} color={theme.textMuted} style={{ marginBottom: space[3] }} />
          <div style={{ ...text.h3, color: theme.textMain, marginBottom: space[2] }}>
            Análise indisponível
          </div>
          <div style={{ ...text.body, color: theme.textMuted }}>
            Jogue pelo menos 3 rodadas para ver seu desempenho.
            {data.rounds_analyzed > 0 && (
              <>
                <br />
                Você tem <strong style={{ color: theme.textMain }}>{data.rounds_analyzed}</strong>{" "}
                {data.rounds_analyzed === 1 ? "rodada" : "rodadas"} finalizada
                {data.rounds_analyzed === 1 ? "" : "s"}.
              </>
            )}
          </div>
        </div>
      );
    }

    return (
      <>
        <div style={st.parGrid}>
          {data.by_par.map((p) => (
            <div key={p.par} style={st.parCard}>
              <div style={st.parLabel}>Par {p.par}</div>
              <div style={{ ...st.parValue, color: diffColor(theme, p.avg_diff) }}>
                {p.holes_count === 0 ? "—" : formatDiff(p.avg_diff)}
              </div>
              <div style={st.parCount}>
                {p.holes_count === 0
                  ? "sem dados"
                  : `${p.holes_count} ${p.holes_count === 1 ? "buraco" : "buracos"}`}
              </div>
            </div>
          ))}
        </div>

        {data.hardest_holes.length > 0 && (
          <>
            <div style={st.sectionTitle}>
              <LuFlag size={12} />
              Buracos mais difíceis
            </div>
            {data.hardest_holes.map((h, idx) => (
              <div key={`${h.course_name}-${h.hole_number}-${idx}`} style={st.holeCard}>
                <div>
                  <div style={st.holeMain}>
                    {h.course_name} · B{h.hole_number}
                  </div>
                  <div style={st.holeMeta}>
                    Par {h.par} · {h.rounds} {h.rounds === 1 ? "rodada" : "rodadas"} jogadas
                  </div>
                </div>
                <div style={{ ...st.holeDiff, color: diffColor(theme, h.avg_diff) }}>
                  {formatDiff(h.avg_diff)}
                </div>
              </div>
            ))}
          </>
        )}

        {data.insight && (
          <div style={st.insightCard}>
            <LuLightbulb size={20} color={theme.accent} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ ...text.body, color: theme.textMain }}>
              {data.insight.message}
            </div>
          </div>
        )}

        {data.min_rounds_notice && (
          <div style={st.noticeFoot}>
            Análise baseada em {data.rounds_analyzed}{" "}
            {data.rounds_analyzed === 1 ? "rodada" : "rodadas"} — vai afinar conforme você joga
            mais.
          </div>
        )}
      </>
    );
  };

  return (
    <div style={st.page}>
      <div style={st.inner}>
        <div style={st.header}>
          <button style={st.btnBack} onClick={() => navigate("/", { replace: true })}>
            <LuArrowLeft size={15} /> VOLTAR
          </button>
          <span style={st.title}>
            <LuTarget size={16} />
            Meu Desempenho
          </span>
        </div>

        <div style={st.periodWrap}>
          <button
            style={st.periodChip}
            onClick={() => setPeriodMenuOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={periodMenuOpen}
          >
            {PERIOD_OPTIONS.find((o) => o.value === period)?.label || "Últimas 20 rodadas"}
            <LuChevronDown size={14} />
          </button>
          {periodMenuOpen && (
            <>
              {/* Overlay invisível: fecha o menu ao clicar fora — mesmo padrão do PlayerHome */}
              <div
                onClick={() => setPeriodMenuOpen(false)}
                style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 49 }}
              />
              <div style={st.periodMenu} role="listbox">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="option"
                    aria-selected={period === opt.value}
                    style={st.periodItem(period === opt.value)}
                    onClick={() => {
                      setPeriod(opt.value);
                      setPeriodMenuOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {renderContent()}
      </div>
    </div>
  );
}

export default MyPerformance;
