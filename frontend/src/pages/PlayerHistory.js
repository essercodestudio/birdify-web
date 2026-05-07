import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { ThemeContext } from "../App";

const TABS = ["Treinos", "Torneios"];

const holeBoxStyle = (strokes, par) => {
  if (!strokes)
    return { bg: "rgba(51,65,85,0.5)", color: "#64748b", border: "#334155" };
  const diff = strokes - par;
  if (strokes === 1 || diff <= -2)
    return { bg: "rgba(234,179,8,0.18)", color: "#eab308", border: "#eab308" };
  if (diff === -1)
    return { bg: "rgba(74,222,128,0.15)", color: "#4ade80", border: "#4ade80" };
  if (diff === 0)
    return {
      bg: "rgba(203,213,225,0.07)",
      color: "#cbd5e1",
      border: "#475569",
    };
  return { bg: "rgba(239,68,68,0.15)", color: "#ef4444", border: "#ef4444" };
};

function HoleGrid({ holes, from, to }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(9, 1fr)",
        gap: "3px",
        marginBottom: "8px",
      }}
    >
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((num) => {
        const h = holes.find((x) => x.hole_number === num);
        const { bg, color, border } = holeBoxStyle(h?.strokes, h?.par ?? 4);
        return (
          <div
            key={num}
            style={{
              backgroundColor: bg,
              border: `1px solid ${border}`,
              borderRadius: "5px",
              padding: "4px 1px",
              textAlign: "center",
            }}
          >
            <div
              style={{ fontSize: "8px", color: "#94a3b8", fontWeight: "bold" }}
            >
              B{num}
            </div>
            <div style={{ fontSize: "7px", color: "#94a3b8" }}>
              P{h?.par ?? 4}
            </div>
            <div style={{ fontSize: "13px", fontWeight: "900", color }}>
              {h?.strokes || "-"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScorecardAccordion({ holes }) {
  const textMuted = "#94a3b8";
  const cardLight = "#334155";
  return (
    <div style={{ padding: "12px 0 4px" }}>
      <div
        style={{
          fontSize: "9px",
          color: textMuted,
          fontWeight: "bold",
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "6px",
        }}
      >
        IDA — FRONT 9
      </div>
      <HoleGrid holes={holes} from={1} to={9} />
      <div
        style={{
          fontSize: "9px",
          color: textMuted,
          fontWeight: "bold",
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "6px",
        }}
      >
        VOLTA — BACK 9
      </div>
      <HoleGrid holes={holes} from={10} to={18} />
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          marginTop: "10px",
          paddingTop: "8px",
          borderTop: `1px solid ${cardLight}`,
        }}
      >
        {[
          { color: "#eab308", label: "Eagle / HiO" },
          { color: "#4ade80", label: "Birdie" },
          { color: "#ffffff", label: "Par" },
          { color: "#ef4444", label: "Bogey+" },
        ].map(({ color, label }) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                backgroundColor: color,
              }}
            />
            <span style={{ fontSize: "9px", color: textMuted }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerHistory() {
  const navigate = useNavigate();
  const clubTheme = useContext(ThemeContext);
  const loggedUser = JSON.parse(localStorage.getItem("user") || "null");

  const accent = clubTheme?.primary_color || "#22c55e";
  const theme = {
    bg: "#0f172a",
    card: "#1e293b",
    cardLight: "#334155",
    accent,
    gold: "#eab308",
    textMain: "#f8fafc",
    textMuted: "#94a3b8",
    danger: "#ef4444",
  };

  const [activeTab, setActiveTab] = useState("Treinos");
  const [trainings, setTrainings] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [scorecards, setScorecards] = useState({});
  const [loadingCard, setLoadingCard] = useState(null);

  useEffect(() => {
    if (!loggedUser?.id) {
      navigate("/login", { replace: true });
      return;
    }
    api
      .get(`/training/history/${loggedUser.id}`)
      .then((res) => {
        setTrainings(res.data.trainings || []);
        setTournaments(res.data.tournaments || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTraining = async (groupId) => {
    const key = `t_${groupId}`;
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    setExpandedId(key);
    if (scorecards[key]) return;
    setLoadingCard(key);
    try {
      const res = await api.get(
        `/training/scorecard/${groupId}/${loggedUser.id}`,
      );
      setScorecards((prev) => ({ ...prev, [key]: res.data }));
    } catch {}
    setLoadingCard(null);
  };

  const toggleTournament = async (tournamentId) => {
    const key = `c_${tournamentId}`;
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    setExpandedId(key);
    if (scorecards[key]) return;
    setLoadingCard(key);
    try {
      const res = await api.get(
        `/leaderboard/details/${tournamentId}/${loggedUser.id}`,
      );
      setScorecards((prev) => ({ ...prev, [key]: res.data }));
    } catch {}
    setLoadingCard(null);
  };

  const formatPar = (val) => {
    const n = parseInt(val || 0);
    if (n === 0) return { label: "E", color: "#cbd5e1" };
    if (n < 0) return { label: `${n}`, color: "#4ade80" };
    return { label: `+${n}`, color: theme.danger };
  };

  const st = {
    page: {
      padding: "20px 16px",
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      fontFamily: "'Segoe UI', Roboto, sans-serif",
    },
    inner: { maxWidth: "480px", margin: "0 auto" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "24px",
      paddingBottom: "16px",
      borderBottom: `1px solid ${theme.cardLight}`,
    },
    btnBack: {
      backgroundColor: "transparent",
      color: theme.gold,
      border: `1px solid ${theme.gold}`,
      padding: "8px 16px",
      borderRadius: "8px",
      fontWeight: "bold",
      cursor: "pointer",
      fontSize: "13px",
    },
    tabs: { display: "flex", gap: "8px", marginBottom: "20px" },
    tabBtn: (active) => ({
      flex: 1,
      padding: "12px 6px",
      borderRadius: "10px",
      border: "none",
      fontSize: "13px",
      fontWeight: "bold",
      cursor: "pointer",
      backgroundColor: active ? accent : theme.card,
      color: active ? "#000" : theme.textMuted,
      boxShadow: active ? `0 4px 12px -2px ${accent}44` : "none",
    }),
    card: {
      backgroundColor: theme.card,
      borderRadius: "14px",
      marginBottom: "10px",
      border: `1px solid ${theme.cardLight}`,
      overflow: "hidden",
    },
    cardRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 18px",
      cursor: "pointer",
    },
    empty: {
      textAlign: "center",
      color: theme.textMuted,
      fontSize: "14px",
      padding: "40px 0",
    },
  };

  const renderAccordion = (key) => {
    if (expandedId !== key) return null;
    const holes = scorecards[key];
    return (
      <div
        style={{
          padding: "0 14px 14px",
          borderTop: `1px solid ${theme.cardLight}`,
        }}
      >
        {loadingCard === key ? (
          <p
            style={{
              color: theme.textMuted,
              fontSize: "13px",
              textAlign: "center",
              padding: "16px 0",
            }}
          >
            Carregando...
          </p>
        ) : holes ? (
          <ScorecardAccordion holes={holes} />
        ) : (
          <p
            style={{
              color: theme.textMuted,
              fontSize: "13px",
              textAlign: "center",
              padding: "16px 0",
            }}
          >
            Sem dados de buraco.
          </p>
        )}
      </div>
    );
  };

  return (
    <div style={st.page}>
      <div style={st.inner}>
        <div style={st.header}>
          <button
            style={st.btnBack}
            onClick={() => navigate("/", { replace: true })}
          >
            ⬅ VOLTAR
          </button>
          <span
            style={{
              fontSize: "15px",
              fontWeight: "bold",
              color: theme.textMain,
            }}
          >
            📊 Meu Histórico
          </span>
        </div>

        <div style={st.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab}
              style={st.tabBtn(activeTab === tab)}
              onClick={() => {
                setActiveTab(tab);
                setExpandedId(null);
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading && <p style={st.empty}>Carregando...</p>}

        {!loading &&
          activeTab === "Treinos" &&
          (trainings.length === 0 ? (
            <p style={st.empty}>Nenhum treino finalizado ainda.</p>
          ) : (
            trainings.map((t) => {
              const key = `t_${t.id}`;
              const isOpen = expandedId === key;
              const { label, color } = formatPar(t.score_to_par);
              return (
                <div key={t.id} style={st.card}>
                  <div style={st.cardRow} onClick={() => toggleTraining(t.id)}>
                    <div>
                      <div
                        style={{
                          fontWeight: "700",
                          fontSize: "15px",
                          color: theme.textMain,
                          marginBottom: "4px",
                        }}
                      >
                        {t.group_name}
                      </div>
                      <div style={{ fontSize: "11px", color: theme.textMuted }}>
                        {t.date} · {t.holes_played} buracos · toque para ver
                        cartão {isOpen ? "▲" : "▼"}
                      </div>
                    </div>
                    <div
                      style={{
                        textAlign: "right",
                        flexShrink: 0,
                        marginLeft: "12px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "22px",
                          fontWeight: "900",
                          color: "#fff",
                        }}
                      >
                        {t.total_strokes || "—"}
                      </div>
                      <div
                        style={{ fontSize: "13px", fontWeight: "bold", color }}
                      >
                        {label}
                      </div>
                    </div>
                  </div>
                  {renderAccordion(key)}
                </div>
              );
            })
          ))}

        {!loading &&
          activeTab === "Torneios" &&
          (tournaments.length === 0 ? (
            <p style={st.empty}>Nenhum torneio finalizado ainda.</p>
          ) : (
            tournaments.map((t) => {
              const key = `c_${t.id}`;
              const isOpen = expandedId === key;
              return (
                <div key={t.id} style={st.card}>
                  <div
                    style={st.cardRow}
                    onClick={() => toggleTournament(t.id)}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: "700",
                          fontSize: "15px",
                          color: theme.textMain,
                          marginBottom: "4px",
                        }}
                      >
                        {t.name}
                      </div>
                      <div style={{ fontSize: "11px", color: theme.textMuted }}>
                        {t.date} · toque para ver cartão {isOpen ? "▲" : "▼"}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: accent,
                        fontWeight: "700",
                        flexShrink: 0,
                        marginLeft: "12px",
                      }}
                    >
                      FINALIZADO
                    </div>
                  </div>
                  {renderAccordion(key)}
                </div>
              );
            })
          ))}

        <div style={{ height: "40px" }} />
      </div>
    </div>
  );
}

export default PlayerHistory;
