// frontend/src/pages/Handicap.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { LuFlag, LuArrowLeft, LuChartBar, LuRefreshCw, LuTriangleAlert } from "react-icons/lu";

const TEE_LABEL = {
  white:  "Branco",
  black:  "Preto",
  blue:   "Azul",
  yellow: "Amarelo",
  green:  "Verde",
  red:    "Vermelho",
};

const fmtDate = (d) => {
  if (!d) return "";
  const raw = typeof d === "string" ? d : new Date(d).toISOString();
  const [y, m, day] = raw.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

const fmtHI = (v) => (v == null ? "—" : Number(v).toFixed(1));

function Handicap() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recalculating, setRecalculating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get("/handicap/me");
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || "Erro ao carregar handicap.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getUser()) { navigate("/login"); return; }
    load();
  }, [navigate, load]);

  const handleRecalculate = async () => {
    if (!window.confirm("Recalcular seu handicap? Isso vai reprocessar todas as suas rodadas de 18 buracos completas.")) return;
    setRecalculating(true);
    try {
      await api.post("/handicap/recalculate-mine");
      await load();
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao recalcular.");
    } finally {
      setRecalculating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando handicap...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 40 }}>
        <div style={{ maxWidth: 500, margin: "0 auto", backgroundColor: theme.card, padding: 24, borderRadius: 12 }}>
          <h2 style={{ color: theme.danger }}>Erro</h2>
          <p style={{ color: theme.textMuted }}>{error}</p>
          <button onClick={() => navigate("/player")} style={{ marginTop: 16, padding: "10px 20px", backgroundColor: theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const hi = data?.handicap_index;
  const rounds = data?.recent_rounds || [];
  const usedCount = rounds.filter((r) => r.used_in_calc).length;

  // Gráfico simples de evolução: usa handicap_at_round
  const chartData = rounds
    .slice()
    .reverse()
    .filter((r) => r.handicap_at_round != null)
    .map((r) => Number(r.handicap_at_round));

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <LuFlag size={24} color={theme.accent} />
              Meu Handicap WHS
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              World Handicap System
            </p>
          </div>
          <button onClick={() => navigate("/player")} style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMuted, border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <LuArrowLeft size={16} />
            Voltar
          </button>
        </div>

        {/* Certificado */}
        <div style={{ backgroundColor: theme.card, border: `2px solid ${theme.accent}`, borderRadius: 16, padding: 30, marginBottom: 20, textAlign: "center" }}>
          <div style={{ color: theme.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>
            Handicap Index
          </div>
          <div style={{ fontSize: 72, fontWeight: 900, color: theme.accent, lineHeight: 1 }}>
            {fmtHI(hi)}
          </div>
          {data?.low_handicap_index != null && data.low_handicap_index !== hi && (
            <div style={{ color: theme.textMuted, fontSize: 13, marginTop: 8 }}>
              Low HI: <b style={{ color: theme.info }}>{fmtHI(data.low_handicap_index)}</b>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12, marginTop: 20, fontSize: 12, color: theme.textMuted }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <LuChartBar size={12} />
              {data.rounds_count} rodadas registradas
            </span>
            <span>·</span>
            <span>✓ {usedCount} usadas no cálculo</span>
          </div>

          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            style={{ marginTop: 20, padding: "10px 20px", backgroundColor: theme.info, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: recalculating ? "wait" : "pointer", fontSize: 13 }}
          >
            {recalculating ? "Recalculando..." : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <LuRefreshCw size={13} />
                RECALCULAR
              </span>
            )}
          </button>
        </div>

        {hi == null && (
          <div style={{ backgroundColor: theme.card, borderLeft: `4px solid ${theme.gold}`, padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <div style={{ color: theme.gold, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <LuTriangleAlert size={14} />
              Você ainda não tem Handicap Index
            </div>
            <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              É necessário completar pelo menos <b>3 rodadas de 18 buracos</b> (em torneios ou treinos finalizados) em um campo com Course Rating cadastrado. Após atingir 3 rodadas, clique em RECALCULAR.
            </div>
          </div>
        )}

        {/* Mini gráfico de evolução */}
        {chartData.length >= 2 && (
          <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16 }}>
            <div style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              Evolução do handicap
            </div>
            <MiniLineChart data={chartData} theme={theme} />
          </div>
        )}

        {/* Tabela de rodadas */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12 }}>
          <div style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
            Últimas rodadas ({rounds.length}/20)
          </div>

          {rounds.length === 0 ? (
            <p style={{ color: theme.textMuted, textAlign: "center", padding: 20, fontSize: 13 }}>
              Nenhuma rodada válida registrada ainda.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: theme.textMuted, textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 }}>
                    <th style={{ padding: "8px 6px", textAlign: "left" }}>Data</th>
                    <th style={{ padding: "8px 6px", textAlign: "left" }}>Campo</th>
                    <th style={{ padding: "8px 6px", textAlign: "center" }}>Tipo</th>
                    <th style={{ padding: "8px 6px", textAlign: "center" }}>Tee</th>
                    <th style={{ padding: "8px 6px", textAlign: "center" }}>Gross</th>
                    <th style={{ padding: "8px 6px", textAlign: "center" }}>Ajust.</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Differential</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: `1px solid ${theme.cardLight}`,
                        backgroundColor: r.used_in_calc ? "#052e16" : "transparent",
                      }}
                    >
                      <td style={{ padding: "10px 6px" }}>{fmtDate(r.round_date)}</td>
                      <td style={{ padding: "10px 6px" }}>{r.course_name}</td>
                      <td style={{ padding: "10px 6px", textAlign: "center" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, backgroundColor: r.round_type === "tournament" ? theme.gold : theme.info, color: "#000", fontWeight: 700 }}>
                          {r.round_type === "tournament" ? "TORNEIO" : "TREINO"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "center", fontSize: 11 }}>{TEE_LABEL[r.tee_color] || r.tee_color}</td>
                      <td style={{ padding: "10px 6px", textAlign: "center", fontWeight: 700 }}>{r.gross_score}</td>
                      <td style={{ padding: "10px 6px", textAlign: "center", color: theme.textMuted }}>{r.adjusted_gross}</td>
                      <td style={{ padding: "10px 6px", textAlign: "right" }}>
                        <span style={{ fontWeight: 800, color: r.used_in_calc ? theme.accent : theme.textMain, fontSize: 15 }}>
                          {Number(r.differential).toFixed(1)}
                        </span>
                        {r.used_in_calc && <span style={{ marginLeft: 4, color: theme.accent, fontSize: 12 }}>✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 12, color: theme.textMuted, fontSize: 11, textAlign: "center" }}>
            Rodadas com fundo verde e ✓ entraram no cálculo do seu HI atual.
          </div>
        </div>

      </div>
    </div>
  );
}

// Mini gráfico SVG puro — sem dependências externas
function MiniLineChart({ data, theme }) {
  const w = 600;
  const h = 140;
  const padding = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(0.1, max - min);
  const xStep = (w - padding * 2) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = padding + i * xStep;
    const y = padding + ((max - v) / range) * (h - padding * 2);
    return { x, y };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const areaD = pathD + ` L ${points[points.length - 1].x} ${h - padding} L ${points[0].x} ${h - padding} Z`;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ maxWidth: "100%" }}>
        <defs>
          <linearGradient id="hiGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity="0.4" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#hiGradient)" />
        <path d={pathD} stroke={theme.accent} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={theme.accent} />
        ))}
        <text x={padding} y={padding - 4} fill="#94a3b8" fontSize="10">max {max.toFixed(1)}</text>
        <text x={padding} y={h - 6} fill="#94a3b8" fontSize="10">min {min.toFixed(1)}</text>
      </svg>
    </div>
  );
}

export default Handicap;
