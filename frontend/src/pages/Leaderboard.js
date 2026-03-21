// frontend/src/pages/Leaderboard.js
import React, { useState, useEffect, useCallback } from "react";
import api from "../services/api";
import { useParams, useNavigate, useLocation } from "react-router-dom";

function Leaderboard() {
  const { tournamentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // 1. Extrai o ID real do torneio (antes do hífen)
  const actualId = tournamentId ? tournamentId.split("-")[0] : "";

  // 2. Identifica se o link acessado possui o parâmetro "?public=true"
  const isPublic =
    new URLSearchParams(location.search).get("public") === "true";

  const [ranking, setRanking] = useState([]);
  const [activeTab, setActiveTab] = useState("");
  const [tabs, setTabs] = useState([]);

  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerScores, setPlayerScores] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [sponsors, setSponsors] = useState([]);
  const [currentSponsorIndex, setCurrentSponsorIndex] = useState(0);

  const theme = {
    bg: "#0f172a",
    card: "#1e293b",
    cardLight: "#334155",
    accent: "#22c55e",
    gold: "#eab308",
    textMain: "#f8fafc",
    textMuted: "#94a3b8",
    danger: "#ef4444",
  };

  const fetchTournamentInfo = useCallback(async () => {
    try {
      const res = await api.get(`/tournaments/${actualId}`);
      if (res.data.sponsors) setSponsors(res.data.sponsors);

      let tournamentCategories = res.data.categories;
      if (typeof tournamentCategories === "string") {
        try {
          tournamentCategories = JSON.parse(tournamentCategories);
        } catch (e) {
          tournamentCategories = [];
        }
      }

      const categoriesFromDB = Array.isArray(tournamentCategories)
        ? tournamentCategories
        : [];
      setTabs(categoriesFromDB);

      if (categoriesFromDB.length > 0 && !activeTab) {
        setActiveTab(categoriesFromDB[0]);
      }
    } catch (error) {
      console.error("Erro info torneio", error);
    }
  }, [actualId, activeTab]);

  const fetchRanking = useCallback(async () => {
    try {
      const res = await api.get(`/leaderboard/${actualId}`);

      const dataWithNet = res.data.map((p) => {
        const total = parseInt(p.total_strokes || 0);
        const hc = parseFloat(p.handicap || 0);
        const toPar = parseInt(p.score_to_par || 0);

        return {
          ...p,
          handicap: hc,
          total_strokes: total,
          holes_played: parseInt(p.holes_played || 0),
          gross_to_par: toPar,
          net_to_par: toPar - hc,
        };
      });
      setRanking(dataWithNet);
    } catch (error) {
      console.error("Erro ranking Birdify", error);
    }
  }, [actualId]);

  useEffect(() => {
    fetchTournamentInfo();
    fetchRanking();
    const interval = setInterval(fetchRanking, 10000);
    return () => clearInterval(interval);
  }, [fetchTournamentInfo, fetchRanking]);

  useEffect(() => {
    let interval;
    if (sponsors && sponsors.length > 1) {
      interval = setInterval(() => {
        setCurrentSponsorIndex((prev) =>
          prev === sponsors.length - 1 ? 0 : prev + 1,
        );
      }, 8000);
    }
    return () => clearInterval(interval);
  }, [sponsors]);

  const handlePlayerClick = async (player) => {
    setSelectedPlayer(player);
    try {
      const res = await api.get(
        `/leaderboard/details/${actualId}/${player.id}`,
      );
      setPlayerScores(res.data);
      setIsModalOpen(true);
    } catch (error) {
      alert("Erro ao carregar cartão do jogador.");
    }
  };

  const getFilteredRanking = () => {
    let filtered = [...ranking];

    filtered = filtered.filter((p) => {
      const hc = p.handicap || 0;
      const sexo = p.gender || p.sexo || "M";

      if (sexo === "M" || sexo === "Masculino") {
        if (activeTab.includes("Feminino") || activeTab.startsWith("F"))
          return false;
        if (activeTab.includes("Masculino Livre") || activeTab.includes("M0"))
          return true;
        if (activeTab.includes("M1") && hc >= 0 && hc <= 8.5) return true;
        if (activeTab.includes("M2") && hc >= 8.6 && hc <= 14.0) return true;
        if (activeTab.includes("M3") && hc >= 14.1 && hc <= 22.1) return true;
        if (activeTab.includes("M4") && hc >= 22.2 && hc <= 36.4) return true;
      }

      if (sexo === "F" || sexo === "Feminino") {
        if (activeTab.includes("Masculino") || activeTab.startsWith("M"))
          return false;
        if (activeTab.includes("Feminino Livre") || activeTab.includes("F0"))
          return true;
        if (activeTab.includes("F1") && hc >= 0 && hc <= 16.1) return true;
        if (activeTab.includes("F2") && hc >= 16.1 && hc <= 23.7) return true;
        if (activeTab.includes("F3") && hc >= 23.8 && hc <= 36.4) return true;
      }

      return activeTab.includes("Sênior") || activeTab.includes("Duplas");
    });

    const isNet =
      (activeTab.includes("Net") || activeTab.match(/[MF][1-4]/)) &&
      !activeTab.includes("M0") &&
      !activeTab.includes("F0");

    filtered.sort((a, b) => {
      const holesA = a.holes_played || 0;
      const holesB = b.holes_played || 0;

      if (holesA === 0 && holesB === 0) return a.name.localeCompare(b.name);
      if (holesA > 0 && holesB === 0) return -1;
      if (holesA === 0 && holesB > 0) return 1;

      const scoreA = isNet ? a.net_to_par : a.gross_to_par;
      const scoreB = isNet ? b.net_to_par : b.gross_to_par;

      if (scoreA !== scoreB) return scoreA - scoreB;
      return holesA - holesB;
    });

    return { data: filtered, isNet };
  };

  const { data: displayedRanking, isNet } = getFilteredRanking();

  const getScoreStyle = (strokes, par) => {
    if (!strokes || !par)
      return { color: theme.textMain, bg: theme.bg, border: theme.cardLight };
    const diff = strokes - par;
    if (diff <= -2)
      return {
        color: theme.gold,
        bg: "rgba(234, 179, 8, 0.15)",
        border: theme.gold,
      };
    if (diff === -1)
      return {
        color: theme.accent,
        bg: "rgba(34, 197, 94, 0.15)",
        border: theme.accent,
      };
    if (diff === 0)
      return {
        color: theme.textMain,
        bg: theme.cardLight,
        border: theme.cardLight,
      };
    return {
      color: theme.danger,
      bg: "rgba(239, 68, 68, 0.15)",
      border: theme.danger,
    };
  };

  const styles = {
    container: {
      padding: "20px",
      backgroundColor: theme.bg,
      minHeight: "100vh",
      fontFamily: "'Segoe UI', Roboto, sans-serif",
      color: theme.textMain,
      display: "flex",
      flexDirection: "column",
    },
    topBar: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "20px",
    },
    btnBack: {
      backgroundColor: "transparent",
      color: theme.gold,
      border: `1px solid ${theme.gold}`,
      padding: "8px 16px",
      borderRadius: "8px",
      fontWeight: "bold",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "5px",
    },
    tabsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gap: "8px",
      marginBottom: "25px",
    },
    tabBtn: (isActive) => ({
      padding: "12px 10px",
      borderRadius: "8px",
      border: "none",
      fontSize: "12px",
      fontWeight: "bold",
      cursor: "pointer",
      backgroundColor: isActive ? theme.accent : theme.card,
      color: isActive ? "#000" : theme.textMuted,
      transition: "0.2s",
    }),
    tableCard: {
      backgroundColor: theme.card,
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      flex: 1,
      marginBottom: "30px",
    },
    row: {
      display: "grid",
      gridTemplateColumns: "35px 1fr 50px 50px 60px",
      padding: "15px 10px",
      borderBottom: `1px solid ${theme.cardLight}`,
      alignItems: "center",
      gap: "5px",
    },
    headerRow: {
      backgroundColor: theme.cardLight,
      color: theme.textMuted,
      fontSize: "10px",
      fontWeight: "bold",
      textTransform: "uppercase",
    },
    nameLabel: {
      fontSize: "14px",
      fontWeight: "600",
      color: theme.accent,
      cursor: "pointer",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    scoreCell: { textAlign: "center", fontSize: "14px", fontWeight: "bold" },
    badge: (val) => ({
      textAlign: "center",
      padding: "4px 0",
      borderRadius: "6px",
      fontSize: "13px",
      fontWeight: "800",
      backgroundColor:
        val < 0
          ? "rgba(34, 197, 94, 0.15)"
          : val > 0
            ? "rgba(239, 68, 68, 0.15)"
            : "rgba(255,255,255,0.05)",
      color: val < 0 ? theme.accent : val > 0 ? theme.danger : theme.textMuted,
    }),
    modalOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.9)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 2000,
    },
    modalContent: {
      backgroundColor: theme.card,
      padding: "25px",
      borderRadius: "15px",
      width: "90%",
      maxWidth: "500px",
      border: `1px solid ${theme.cardLight}`,
    },
    scoreGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(9, 1fr)",
      gap: "6px",
      marginBottom: "15px",
    },
    scoreBox: {
      padding: "6px 2px",
      textAlign: "center",
      borderRadius: "6px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    },
  };

  const renderNine = (start) => (
    <div style={styles.scoreGrid}>
      {Array.from({ length: 9 }, (_, i) => start + i).map((num) => {
        const hole = playerScores.find((h) => h.hole_number === num);
        const strokes = hole ? hole.strokes : null;
        const par = hole ? hole.par : null;
        const styling = getScoreStyle(strokes, par);

        return (
          <div
            key={num}
            style={{
              ...styles.scoreBox,
              backgroundColor: styling.bg,
              border: `1px solid ${styling.border}`,
            }}
          >
            <div
              style={{
                fontSize: "10px",
                color: theme.textMuted,
                fontWeight: "bold",
              }}
            >
              B{num}
            </div>
            <div
              style={{
                fontSize: "9px",
                color: theme.textMuted,
                marginBottom: "2px",
              }}
            >
              {par ? `Par ${par}` : "-"}
            </div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: "900",
                color: styling.color,
                marginTop: "2px",
              }}
            >
              {strokes ? strokes : "-"}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        {!isPublic && (
          <button onClick={() => navigate(-1)} style={styles.btnBack}>
            ⬅ VOLTAR AO JOGO
          </button>
        )}

        <div
          style={{
            color: theme.danger,
            fontWeight: "bold",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            marginLeft: isPublic ? "0" : "auto",
          }}
        >
          <span className="dot"></span> LIVE
        </div>
      </div>

      <div style={styles.tabsGrid}>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={styles.tabBtn(activeTab === tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={styles.tableCard}>
        <div style={{ ...styles.row, ...styles.headerRow }}>
          <div>POS</div>
          <div>JOGADOR</div>
          <div style={{ textAlign: "center" }}>HOLES</div>
          <div style={{ textAlign: "center" }}>TOTAL</div>
          <div style={{ textAlign: "center" }}>PAR</div>
        </div>

        {displayedRanking.map((row, index) => {
          const score = row.total_strokes;
          const relativeParRaw = isNet ? row.net_to_par : row.gross_to_par;

          let displayPar = "E";
          if (row.holes_played > 0) {
            if (relativeParRaw === 0) displayPar = "E";
            else if (relativeParRaw > 0)
              displayPar = `+${relativeParRaw.toFixed(1).replace(".0", "")}`;
            else displayPar = relativeParRaw.toFixed(1).replace(".0", "");
          }

          return (
            <div key={index} style={styles.row}>
              <div
                style={{
                  fontWeight: "800",
                  color:
                    row.holes_played > 0 && index === 0
                      ? theme.gold
                      : theme.textMuted,
                }}
              >
                {row.holes_played > 0 ? index + 1 : "-"}
              </div>
              <div
                style={styles.nameLabel}
                onClick={() => handlePlayerClick(row)}
              >
                {row.name}
                {isNet && (
                  <span
                    style={{
                      fontSize: "10px",
                      color: theme.textMuted,
                      marginLeft: "5px",
                    }}
                  >
                    (HC {row.handicap})
                  </span>
                )}
              </div>
              <div style={{ ...styles.scoreCell, color: theme.textMuted }}>
                {row.holes_played || 0}
              </div>
              <div style={styles.scoreCell}>
                {row.holes_played === 0 ? "--" : score}
              </div>
              <div style={styles.badge(relativeParRaw)}>
                {row.holes_played === 0 ? "--" : displayPar}
              </div>
            </div>
          );
        })}
      </div>

      {/* CARROSSEL DE PATROCINADORES */}
      {sponsors && sponsors.length > 0 && (
        <div
          style={{
            textAlign: "center",
            paddingBottom: "20px",
            marginTop: "20px",
          }}
        >
          <p
            style={{
              fontSize: "11px",
              color: theme.textMuted,
              marginBottom: "15px",
              letterSpacing: "2px",
              fontWeight: "bold",
            }}
          >
            PATROCÍNIO OFICIAL
          </p>
          <div
            style={{
              height: "90px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <img
              key={currentSponsorIndex}
              src={sponsors[currentSponsorIndex].image_url}
              alt="Patrocinador"
              style={{
                maxHeight: "100%",
                maxWidth: "250px",
                objectFit: "contain",
                animation: "fadeIn 0.5s ease-in",
              }}
            />
          </div>
          {sponsors.length > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "8px",
                marginTop: "15px",
              }}
            >
              {sponsors.map((_, idx) => (
                <div
                  key={idx}
                  onClick={() => setCurrentSponsorIndex(idx)}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor:
                      currentSponsorIndex === idx
                        ? theme.gold
                        : theme.cardLight,
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL DO CARTÃO DE SCORE */}
      {isModalOpen && selectedPlayer && (
        <div style={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <h3 style={{ margin: 0, color: theme.accent }}>
                {selectedPlayer.name}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "20px",
                }}
              >
                ×
              </button>
            </div>
            <p
              style={{
                color: theme.textMuted,
                fontSize: "12px",
                marginBottom: "5px",
              }}
            >
              IDA (FRONT 9)
            </p>
            {renderNine(1)}
            <p
              style={{
                color: theme.textMuted,
                fontSize: "12px",
                marginBottom: "5px",
                marginTop: "15px",
              }}
            >
              VOLTA (BACK 9)
            </p>
            {renderNine(10)}
            <div
              style={{
                marginTop: "20px",
                paddingTop: "15px",
                borderTop: `1px solid ${theme.cardLight}`,
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: "18px" }}>
                Total Gross: <strong>{selectedPlayer.total_strokes}</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dot { height: 8px; width: 8px; background-color: #ef4444; border-radius: 50%; display: inline-block; animation: blink 1s infinite; }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

export default Leaderboard;
