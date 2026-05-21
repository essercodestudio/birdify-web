// frontend/src/pages/Leaderboard.js
import React, { useState, useEffect, useCallback } from "react";
import api from "../services/api";
import { useParams, useNavigate, useLocation } from "react-router-dom";

const theme = {
  bg:        "#0f172a",
  card:      "#1e293b",
  cardLight: "#334155",
  accent:    "#22c55e",
  gold:      "#eab308",
  textMain:  "#f8fafc",
  textMuted: "#94a3b8",
  danger:    "#ef4444",
};

function getScoreStyle(strokes, par) {
  if (!strokes || !par) return { color: theme.textMain, bg: theme.bg, border: theme.cardLight };
  const d = strokes - par;
  if (d <= -2) return { color: theme.gold,   bg: "rgba(234,179,8,0.15)",  border: theme.gold   };
  if (d === -1) return { color: theme.accent, bg: "rgba(34,197,94,0.15)", border: theme.accent };
  if (d === 0)  return { color: theme.textMain, bg: theme.cardLight,      border: theme.cardLight };
  return         { color: theme.danger, bg: "rgba(239,68,68,0.15)",        border: theme.danger };
}

function applyFilter(players, tab) {
  return players.filter(p => {
    const hc = p.handicap || 0;
    const sx = p.gender || p.sexo || "M";
    if (sx === "M" || sx === "Masculino") {
      if (tab.includes("Feminino") || tab.startsWith("F")) return false;
      if (tab.includes("Masculino Livre") || tab.includes("M0")) return true;
      if (tab.includes("M1") && hc >= 0    && hc <= 8.5)  return true;
      if (tab.includes("M2") && hc >= 8.6  && hc <= 14.0) return true;
      if (tab.includes("M3") && hc >= 14.1 && hc <= 22.1) return true;
      if (tab.includes("M4") && hc >= 22.2 && hc <= 36.4) return true;
    }
    if (sx === "F" || sx === "Feminino") {
      if (tab.includes("Masculino") || tab.startsWith("M")) return false;
      if (tab.includes("Feminino Livre") || tab.includes("F0")) return true;
      if (tab.includes("F1") && hc >= 0    && hc <= 16.1) return true;
      if (tab.includes("F2") && hc >= 16.1 && hc <= 23.7) return true;
      if (tab.includes("F3") && hc >= 23.8 && hc <= 36.4) return true;
    }
    return tab.includes("Sênior") || tab.includes("Duplas");
  });
}

function isNet(tab) {
  return (tab.includes("Net") || /[MF][1-4]/.test(tab)) &&
    !tab.includes("M0") && !tab.includes("F0");
}

// ─── LeaderboardView ─────────────────────────────────────────────────────────
// Reusable: aceita tournamentId como prop. embedded=true oculta topBar e bg.
export function LeaderboardView({ tournamentId, isPublic = false, onBack, embedded = false, showSponsors = true }) {
  const [ranking,             setRanking]             = useState([]);
  const [tabs,                setTabs]                = useState([]);
  const [activeTab,           setActiveTab]           = useState("");
  const [selectedPlayer,      setSelectedPlayer]      = useState(null);
  const [playerScores,        setPlayerScores]        = useState([]);
  const [isScoreModalOpen,    setIsScoreModalOpen]    = useState(false);
  const [sponsors,            setSponsors]            = useState([]);
  const [currentSponsorIndex, setCurrentSponsorIndex] = useState(0);

  const fetchInfo = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const res = await api.get(`/tournaments/${tournamentId}`);
      if (res.data.sponsors) setSponsors(res.data.sponsors);
      let cats = res.data.categories;
      if (typeof cats === "string") { try { cats = JSON.parse(cats); } catch { cats = []; } }
      cats = Array.isArray(cats) ? cats : [];
      setTabs(cats);
      setActiveTab(prev => (!prev && cats.length > 0 ? cats[0] : prev));
    } catch (e) { console.error("Leaderboard fetchInfo:", e); }
  }, [tournamentId]);

  const fetchRanking = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const res = await api.get(`/leaderboard/${tournamentId}`);
      setRanking(res.data.map(p => ({
        ...p,
        handicap:      parseFloat(p.handicap || 0),
        total_strokes: parseInt(p.total_strokes || 0),
        holes_played:  parseInt(p.holes_played  || 0),
        gross_to_par:  parseInt(p.score_to_par  || 0),
        net_to_par:    parseInt(p.score_to_par  || 0) - parseFloat(p.handicap || 0),
      })));
    } catch (e) { console.error("Leaderboard fetchRanking:", e); }
  }, [tournamentId]);

  useEffect(() => {
    fetchInfo();
    fetchRanking();
    const id = setInterval(fetchRanking, 10000);
    return () => clearInterval(id);
  }, [fetchInfo, fetchRanking]);

  useEffect(() => {
    if (!sponsors || sponsors.length <= 1) return;
    const id = setInterval(() =>
      setCurrentSponsorIndex(i => (i === sponsors.length - 1 ? 0 : i + 1)), 8000);
    return () => clearInterval(id);
  }, [sponsors]);

  const handlePlayerClick = async (player) => {
    setSelectedPlayer(player);
    setIsScoreModalOpen(true);
    if (!playerScores._loadedFor || playerScores._loadedFor !== player.id) {
      try {
        const res = await api.get(`/leaderboard/details/${tournamentId}/${player.id}`);
        const data = res.data;
        data._loadedFor = player.id;
        setPlayerScores(data);
      } catch { setPlayerScores([]); }
    }
  };

  const net = isNet(activeTab);
  const filtered = applyFilter(ranking, activeTab).sort((a, b) => {
    const ha = a.holes_played, hb = b.holes_played;
    if (!ha && !hb) return a.name.localeCompare(b.name);
    if (ha && !hb) return -1;
    if (!ha && hb) return 1;
    const sa = net ? a.net_to_par : a.gross_to_par;
    const sb = net ? b.net_to_par : b.gross_to_par;
    return sa !== sb ? sa - sb : ha - hb;
  });

  const renderNine = (start) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: "5px", marginBottom: "14px" }}>
      {Array.from({ length: 9 }, (_, i) => start + i).map(num => {
        const hole = (playerScores || []).find(h => h.hole_number === num);
        const st  = hole ? hole.strokes : null;
        const par = hole ? hole.par     : null;
        const { color, bg, border } = getScoreStyle(st, par);
        return (
          <div key={num} style={{ padding: "6px 2px", textAlign: "center", borderRadius: "6px", display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: bg, border: `1px solid ${border}` }}>
            <div style={{ fontSize: "9px",  color: theme.textMuted, fontWeight: "bold" }}>B{num}</div>
            <div style={{ fontSize: "8px",  color: theme.textMuted, marginBottom: "1px" }}>{par ? `Par ${par}` : "—"}</div>
            <div style={{ fontSize: "16px", fontWeight: "900", color, marginTop: "2px" }}>{st ?? "—"}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={embedded ? { fontFamily: "'Segoe UI', Roboto, sans-serif", color: theme.textMain } : {
      padding: "20px", backgroundColor: theme.bg, minHeight: "100vh",
      fontFamily: "'Segoe UI', Roboto, sans-serif", color: theme.textMain,
      display: "flex", flexDirection: "column",
    }}>

      {/* Top bar — apenas na página standalone */}
      {!embedded && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          {!isPublic && onBack && (
            <button onClick={onBack} style={{ backgroundColor: "transparent", color: theme.gold, border: `1px solid ${theme.gold}`, padding: "8px 16px", borderRadius: "8px", fontWeight: "bold", cursor: "pointer" }}>
              ⬅ VOLTAR AO JOGO
            </button>
          )}
          <div style={{ color: theme.danger, fontWeight: "bold", fontSize: "12px", display: "flex", alignItems: "center", gap: "5px", marginLeft: (isPublic || !onBack) ? "0" : "auto" }}>
            <span className="lb-dot" /> LIVE
          </div>
        </div>
      )}

      {/* Abas de categoria */}
      {tabs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px", marginBottom: "16px", padding: embedded ? "12px 16px 0" : "0" }}>
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "10px 8px", borderRadius: "8px", border: "none",
              fontSize: "12px", fontWeight: "bold", cursor: "pointer",
              backgroundColor: activeTab === tab ? theme.accent : theme.cardLight,
              color: activeTab === tab ? "#000" : theme.textMuted,
              transition: "background-color 0.15s, color 0.15s",
            }}>
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Tabela */}
      <div style={{ backgroundColor: theme.card, borderRadius: embedded ? "0" : "12px", overflow: "hidden", flex: 1, marginBottom: embedded ? "0" : "30px" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "35px 1fr 50px 50px 60px", padding: "10px 16px", backgroundColor: theme.cardLight, color: theme.textMuted, fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", alignItems: "center", gap: "5px" }}>
          <div>POS</div><div>JOGADOR</div>
          <div style={{ textAlign: "center" }}>HLS</div>
          <div style={{ textAlign: "center" }}>TOTAL</div>
          <div style={{ textAlign: "center" }}>PAR</div>
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px", color: theme.textMuted, fontSize: "13px" }}>Nenhum jogador nesta categoria.</div>
        )}

        {filtered.map((row, idx) => {
          const relPar = net ? row.net_to_par : row.gross_to_par;
          const parLabel = !row.holes_played ? "--"
            : relPar === 0 ? "E"
            : relPar > 0 ? `+${relPar.toFixed(1).replace(".0", "")}`
            : relPar.toFixed(1).replace(".0", "");

          return (
            <div key={row.id || idx} style={{ display: "grid", gridTemplateColumns: "35px 1fr 50px 50px 60px", padding: "14px 16px", borderBottom: `1px solid ${theme.cardLight}`, alignItems: "center", gap: "5px" }}>
              <div style={{ fontWeight: "800", fontSize: "13px", color: row.holes_played > 0 && idx === 0 ? theme.gold : theme.textMuted }}>
                {row.holes_played > 0 ? idx + 1 : "—"}
              </div>
              <div
                style={{ fontSize: "14px", fontWeight: "600", color: theme.accent, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                onClick={() => handlePlayerClick(row)}
              >
                {row.name}
                {net && <span style={{ fontSize: "10px", color: theme.textMuted, marginLeft: "5px" }}>(HC {row.handicap})</span>}
              </div>
              <div style={{ textAlign: "center", fontSize: "13px", color: theme.textMuted }}>{row.holes_played || 0}</div>
              <div style={{ textAlign: "center", fontSize: "14px", fontWeight: "bold", color: theme.textMain }}>{row.holes_played ? row.total_strokes : "--"}</div>
              <div style={{
                textAlign: "center", padding: "4px 0", borderRadius: "6px",
                fontSize: "13px", fontWeight: "800",
                backgroundColor: !row.holes_played ? "transparent" : relPar < 0 ? "rgba(34,197,94,0.15)" : relPar > 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                color: !row.holes_played ? theme.textMuted : relPar < 0 ? theme.accent : relPar > 0 ? theme.danger : theme.textMuted,
              }}>
                {parLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sponsors — apenas na página standalone */}
      {!embedded && showSponsors && sponsors.length > 0 && (
        <div style={{ textAlign: "center", paddingBottom: "20px" }}>
          <p style={{ fontSize: "11px", color: theme.textMuted, marginBottom: "15px", letterSpacing: "2px", fontWeight: "bold" }}>PATROCÍNIO OFICIAL</p>
          <div style={{ height: "90px", display: "flex", justifyContent: "center", alignItems: "center" }}>
            <img key={currentSponsorIndex} src={sponsors[currentSponsorIndex].image_url} alt="Patrocinador" style={{ maxHeight: "100%", maxWidth: "250px", objectFit: "contain", animation: "fadeIn 0.5s ease-in" }} />
          </div>
          {sponsors.length > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "15px" }}>
              {sponsors.map((_, i) => (
                <div key={i} onClick={() => setCurrentSponsorIndex(i)} style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: currentSponsorIndex === i ? theme.gold : theme.cardLight, cursor: "pointer", transition: "all 0.3s" }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de scorecard — position:fixed zIndex:2000 flutua acima de qualquer modal pai */}
      {isScoreModalOpen && selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.92)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 2000 }} onClick={() => setIsScoreModalOpen(false)}>
          <div style={{ backgroundColor: theme.card, padding: "24px", borderRadius: "16px", width: "92%", maxWidth: "480px", border: `1px solid ${theme.cardLight}`, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, color: theme.accent, fontSize: "16px" }}>{selectedPlayer.name}</h3>
              <button onClick={() => setIsScoreModalOpen(false)} style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer", fontSize: "22px", lineHeight: 1 }}>×</button>
            </div>
            <p style={{ color: theme.textMuted, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", marginBottom: "8px" }}>FRENTE (1–9)</p>
            {renderNine(1)}
            <p style={{ color: theme.textMuted, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", marginBottom: "8px", marginTop: "16px" }}>VOLTA (10–18)</p>
            {renderNine(10)}
            <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: `1px solid ${theme.cardLight}`, textAlign: "center" }}>
              <span style={{ fontSize: "17px", color: theme.textMain }}>Total Gross: <strong>{selectedPlayer.total_strokes}</strong></span>
            </div>
          </div>
        </div>
      )}

      {!embedded && (
        <style>{`
          .lb-dot { height:8px; width:8px; background-color:#ef4444; border-radius:50%; display:inline-block; animation:lbBlink 1s infinite; }
          @keyframes lbBlink { 0%{opacity:1} 50%{opacity:0.3} 100%{opacity:1} }
          @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        `}</style>
      )}
    </div>
  );
}

// ─── Leaderboard (página) ─────────────────────────────────────────────────────
function Leaderboard() {
  const { tournamentId: rawId } = useParams();
  const navigate  = useNavigate();
  const location  = useLocation();
  const actualId  = rawId ? rawId.split("-")[0] : "";
  const isPublic  = new URLSearchParams(location.search).get("public") === "true";

  return <LeaderboardView tournamentId={actualId} isPublic={isPublic} onBack={() => navigate(-1)} />;
}

export default Leaderboard;
