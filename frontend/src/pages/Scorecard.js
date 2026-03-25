// frontend/src/pages/Scorecard.js
import React, { useState, useEffect, useCallback } from "react";
import api from "../services/api"; 
import { useParams, useNavigate } from "react-router-dom";

// --- O CÉREBRO DAS CATEGORIAS E CORES DE TEE ---
const calcularPerfilGolfista = (genero, handicap) => {
  const hc = parseFloat(handicap) || 0;
  let tee = { nome: "Verde", cor: "#22c55e" }; // Padrão Feminino
  let cat = "F";

  if (genero === "M" || genero === "Masculino") {
    if (hc <= 8.5) { tee = { nome: "Preto", cor: "#000000" }; cat = "M1"; }
    else if (hc <= 14.0) { tee = { nome: "Azul", cor: "#0000FF" }; cat = "M2"; }
    else if (hc <= 22.1) { tee = { nome: "Branco", cor: "#ffffff" }; cat = "M3"; }
    else { tee = { nome: "Branco", cor: "#ffffff" }; cat = "M4"; }
  } else {
    if (hc <= 16.1) cat = "F1";
    else if (hc <= 23.7) cat = "F2";
    else cat = "F3";
  }

  return { tee, cat };
};

function Scorecard() {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const [group, setGroup] = useState(null);
  const [players, setPlayers] = useState([]);
  const [holesData, setHolesData] = useState([]);

  const [currentHole, setCurrentHole] = useState(1);
  const [scores, setScores] = useState({});
  const [playedHoles, setPlayedHoles] = useState([]);

  const [showSummary, setShowSummary] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const theme = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent: '#22c55e', 
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444'
  };

  // Funções para gerenciar rascunho no localStorage
  const getDraftKey = useCallback((matchId, holeNumber) => {
    return `draft_scores_match_${matchId}_hole_${holeNumber}`;
  }, []);

  const saveDraftToLocalStorage = useCallback((matchId, holeNumber, scoresToSave) => {
    if (!matchId) return;
    const draftKey = getDraftKey(matchId, holeNumber);
    localStorage.setItem(draftKey, JSON.stringify(scoresToSave));
  }, [getDraftKey]);

  const loadDraftFromLocalStorage = useCallback((matchId, holeNumber) => {
    if (!matchId) return null;
    const draftKey = getDraftKey(matchId, holeNumber);
    const draftData = localStorage.getItem(draftKey);
    if (draftData) {
      try {
        return JSON.parse(draftData);
      } catch (e) {
        console.error("Erro ao carregar rascunho:", e);
        return null;
      }
    }
    return null;
  }, [getDraftKey]);

  const clearDraftFromLocalStorage = useCallback((matchId, holeNumber) => {
    if (!matchId) return;
    const draftKey = getDraftKey(matchId, holeNumber);
    localStorage.removeItem(draftKey);
  }, [getDraftKey]);

  const clearAllDraftsForMatch = useCallback((matchId) => {
    if (!matchId) return;
    for (let i = 1; i <= 18; i++) {
      const draftKey = getDraftKey(matchId, i);
      localStorage.removeItem(draftKey);
    }
  }, [getDraftKey]);

  const fetchData = useCallback(async () => {
    try {
      const savedGroup = JSON.parse(localStorage.getItem("activeGroup"));

      if (!savedGroup || savedGroup.id !== Number(groupId)) {
        alert("Sessão inválida. Digite o código novamente.");
        navigate("/");
        return;
      }
      setGroup(savedGroup);
      setPlayedHoles([savedGroup.starting_hole]);

      const groupList = await api.get(`/groups/list/${savedGroup.tournament_id}`);
      const myGroupData = groupList.data.find((g) => g.id === Number(groupId));

      if (myGroupData && myGroupData.players) setPlayers(myGroupData.players);

      const tourRes = await api.get(`/tournaments/${savedGroup.tournament_id}`);
      const actualCourseId = tourRes.data.course_id || savedGroup.course_id;

      if (actualCourseId) {
          const courseRes = await api.get(`/courses/${actualCourseId}/holes`);
          setHolesData(courseRes.data);
      }

      const scoresRes = await api.get(`/scores/list/${savedGroup.tournament_id}`);
      const scoresMap = {};
      scoresRes.data.forEach((s) => {
        scoresMap[`${s.user_id}-${s.hole_number}`] = s.strokes;
      });
      setScores(scoresMap);
      
      // Encontrar o primeiro buraco sem pontuação
      let finalCurrentHole = savedGroup.starting_hole;
      
      if (scoresRes.data && scoresRes.data.length > 0 && myGroupData && myGroupData.players) {
        const groupPlayerIds = myGroupData.players.map(p => p.id);
        const scoresDoMeuGrupo = scoresRes.data.filter(s => groupPlayerIds.includes(s.user_id));

        if (scoresDoMeuGrupo.length > 0) {
          let nextHole = savedGroup.starting_hole;
          for (let i = 1; i <= 18; i++) {
            const holeToCheck = savedGroup.starting_hole + i - 1;
            const actualHole = holeToCheck > 18 ? holeToCheck - 18 : holeToCheck;
            
            const allPlayersHaveScore = myGroupData.players.every(p => {
              return scoresDoMeuGrupo.some(s => s.user_id === p.id && s.hole_number === actualHole);
            });
            
            if (!allPlayersHaveScore) {
              nextHole = actualHole;
              break;
            }
            
            if (i === 18) {
              nextHole = actualHole;
              setShowSummary(true);
            }
          }
          
          finalCurrentHole = nextHole;
          
          // Reconstruir histórico de buracos jogados
          const reconstructedHistory = [];
          if (savedGroup.starting_hole <= nextHole) {
            for (let i = savedGroup.starting_hole; i <= nextHole; i++) reconstructedHistory.push(i);
          } else {
            for (let i = savedGroup.starting_hole; i <= 18; i++) reconstructedHistory.push(i);
            for (let i = 1; i <= nextHole; i++) reconstructedHistory.push(i);
          }
          setPlayedHoles(reconstructedHistory);
        }
      }
      
      setCurrentHole(finalCurrentHole);
      
      // Carregar rascunhos do localStorage para o buraco atual
      if (savedGroup.tournament_id) {
        const draftData = loadDraftFromLocalStorage(savedGroup.tournament_id, finalCurrentHole);
        if (draftData) {
          setScores(prev => ({ ...prev, ...draftData }));
        }
      }
      
    } catch (error) { 
      console.error("Erro ao carregar dados", error);
      // REGRA 4: Bloco catch apenas console.error, sem alert
    } finally {
      // REGRA 4: Finally sempre seta isLoading false
      setIsInitialLoading(false);
    }
  }, [groupId, navigate, loadDraftFromLocalStorage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const currentHoleData = holesData.find(
    (h) => Number(h.hole_number) === Number(currentHole) || Number(h.hole) === Number(currentHole)
  ) || { par: 4, yards_blue: 0, yards_white: 0, yards_yellow: 0, yards_red: 0 };

  // REGRA 1: handleScoreChange com anotação livre offline e bônus do PAR
  const handleScoreChange = (userId, delta) => {
    const key = `${userId}-${currentHole}`;
    const currentScore = parseInt(scores[key]) || 0;
    let newScore = currentScore + delta;

    // Bônus: se tava 0 e clicou no +, joga o PAR do buraco
    if (currentScore === 0 && delta > 0) {
      newScore = currentHoleData.par || 4;
    }

    if (newScore < 1) {
      if (delta < 0) return; // Não deixa ficar negativo
      newScore = 1;
    }
    
    const updatedScores = { ...scores, [key]: newScore };
    setScores(updatedScores); // Atualiza state imediatamente, mesmo offline
    
    if (group?.tournament_id) {
      const currentHoleScores = {};
      players.forEach(p => {
        const scoreKey = `${p.id}-${currentHole}`;
        if (updatedScores[scoreKey]) {
          currentHoleScores[scoreKey] = updatedScores[scoreKey];
        }
      });
      saveDraftToLocalStorage(group.tournament_id, currentHole, currentHoleScores);
    }
  };

  // REGRA 2: saveCurrentHoleScores com trava offline e catch com alert
  const saveCurrentHoleScores = async () => {
    // Trava offline: impede save e impede avanço
    if (!navigator.onLine) {
      alert("Conexão instável. Os pontos estão anotados na tela, aguarde o sinal voltar e clique na seta para salvar e avançar.");
      return false;
    }
    
    setIsSaving(true);
    try {
      const savePromises = players.map(p => {
        const score = scores[`${p.id}-${currentHole}`];
        if (score && score > 0) {
          return api.post("/scores/save", {
            tournament_id: group.tournament_id,
            user_id: p.id,
            hole_number: currentHole,
            strokes: score,
          });
        }
        return Promise.resolve(); 
      });
      
      await Promise.all(savePromises);
      
      if (group?.tournament_id) {
        clearDraftFromLocalStorage(group.tournament_id, currentHole);
      }
      return true;
    } catch (error) {
      // REGRA 2: catch com alert de erro de servidor e retorna false
      console.warn("Erro ao salvar pontuação:", error);
      alert("Erro de servidor. Não foi possível salvar os pontos. Tente novamente.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const changeHole = async (delta) => {
    if (delta > 0) {
      const missingPlayer = players.find((p) => {
        const score = scores[`${p.id}-${currentHole}`];
        return !score || score === 0;
      });

      if (missingPlayer) {
        alert(`⚠️ Falta anotar o score de: ${missingPlayer.name}`);
        return;
      }
    }

    if (delta !== 0) {
      const hasScoresToSave = players.some(p => {
        const score = scores[`${p.id}-${currentHole}`];
        return score && score > 0;
      });
      
      if (hasScoresToSave) {
        const saveSuccess = await saveCurrentHoleScores();
        if (!saveSuccess) {
          return;
        }
      }
    }

    if (delta > 0) {
      if (!isReviewMode && playedHoles.length >= 18) {
        setShowSummary(true);
        return;
      }
      
      let nextHole = currentHole + 1;
      if (nextHole > 18) nextHole = 1;
      
      if (!playedHoles.includes(nextHole)) {
          setPlayedHoles([...playedHoles, nextHole]);
      }
      setCurrentHole(nextHole);
      
      // Carregar rascunho do próximo buraco se existir
      if (group?.tournament_id) {
        const draftData = loadDraftFromLocalStorage(group.tournament_id, nextHole);
        if (draftData) {
          setScores(prev => ({ ...prev, ...draftData }));
        }
      }

    } else if (delta < 0) {
      let prevHole = currentHole - 1;
      if (prevHole < 1) prevHole = 18;

      if (!playedHoles.includes(prevHole)) {
        alert("🛑 Você não pode voltar para um buraco antes do seu tee de saída.");
        return;
      }
      setCurrentHole(prevHole);
      
      // Carregar rascunho do buraco anterior se existir
      if (group?.tournament_id) {
        const draftData = loadDraftFromLocalStorage(group.tournament_id, prevHole);
        if (draftData) {
          setScores(prev => ({ ...prev, ...draftData }));
        }
      }
    }
  };

  const calculateTotal = (userId, handicap) => {
    let totalGross = 0;
    let totalPar = 0;

    for (let h = 1; h <= 18; h++) {
      const score = scores[`${userId}-${h}`];
      if (score > 0) {
        totalGross += score;
        
        const hole = holesData.find(hd => (hd.hole_number || hd.hole) === h);
        if (hole) totalPar += hole.par;
      }
    }

    if (totalGross === 0) return { gross: 0, netVsPar: "E" };

    const grossVsPar = totalGross - totalPar;
    const netVsPar = grossVsPar - parseFloat(handicap || 0);

    let formattedNet = "E";
    if (netVsPar !== 0) {
      formattedNet = netVsPar > 0 ? `+${netVsPar.toFixed(1)}` : netVsPar.toFixed(1);
    }

    return { gross: totalGross, netVsPar: formattedNet };
  };

  // REGRA 3: handleConfirmGame com trava offline no início
  const handleConfirmGame = async () => {
    // Trava offline: impede finalização sem conexão
    if (!navigator.onLine) {
      alert("⚠️ Aguarde a conexão voltar para assinar o cartão. Seus pontos estão salvos localmente.");
      return;
    }
    
    const holesToSave = [...new Set(playedHoles)];
    for (const hole of holesToSave) {
      const hasScoresForHole = players.some(p => {
        const score = scores[`${p.id}-${hole}`];
        return score && score > 0;
      });
      
      if (hasScoresForHole) {
        try {
          const savePromises = players.map(p => {
            const score = scores[`${p.id}-${hole}`];
            if (score && score > 0) {
              return api.post("/scores/save", {
                tournament_id: group.tournament_id,
                user_id: p.id,
                hole_number: hole,
                strokes: score,
              });
            }
            return Promise.resolve();
          });
          await Promise.all(savePromises);
          
          // Limpar rascunho de cada buraco salvo
          if (group?.tournament_id) {
            clearDraftFromLocalStorage(group.tournament_id, hole);
          }
        } catch (error) {
          alert(`❌ Erro ao salvar pontuação do buraco ${hole}. Verifique sua conexão.`);
          return;
        }
      }
    }
    
    // Limpar todos os rascunhos após finalizar
    if (group?.tournament_id) {
      clearAllDraftsForMatch(group.tournament_id);
    }
    
    alert("✅ Cartão Assinado! Placar Oficializado.");
    navigate("/");
  };

  const handleEditMode = () => {
    setShowSummary(false);
    setIsReviewMode(true);
  };

  const openLeaderboard = () => {
    navigate(`/leaderboard/${group.tournament_id}`);
  };

  const styles = {
    container: { padding: "15px", backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, fontFamily: "'Segoe UI', Roboto, sans-serif", textAlign: "center" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", paddingBottom: "10px", borderBottom: `1px solid ${theme.cardLight}` },
    headerInfo: { textAlign: "left" },
    leaderboardBtn: { backgroundColor: theme.gold, color: "black", border: "none", padding: "8px 12px", borderRadius: "5px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", boxShadow: "0 2px 5px rgba(0,0,0,0.5)" },
    holeNav: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.card, padding: "15px", borderRadius: "10px", marginBottom: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.3)" },
    navBtn: { backgroundColor: theme.cardLight, color: "white", border: "none", padding: "10px 20px", borderRadius: "5px", fontSize: "20px", cursor: "pointer", opacity: isSaving ? 0.5 : 1, pointerEvents: isSaving ? "none" : "auto" },
    holeTitle: { fontSize: "28px", fontWeight: "bold", color: theme.gold },
    parInfo: { color: theme.textMuted, fontSize: "16px", marginTop: "5px" },
    details: { fontSize: "14px", color: "#888", marginTop: "8px", display: "flex", justifyContent: "center", gap: "8px", flexWrap: "wrap" },
    yardBadge: { padding: "3px 8px", borderRadius: "4px", fontWeight: "bold", fontSize: "12px" },
    playerCard: { backgroundColor: theme.card, padding: "15px", borderRadius: "10px", marginBottom: "15px", display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${theme.cardLight}` },
    playerName: { textAlign: "left", fontSize: "16px", fontWeight: "bold" },
    scoreControl: { display: "flex", alignItems: "center", gap: "15px" },
    scoreBtn: { width: "45px", height: "45px", borderRadius: "50%", border: "none", fontSize: "24px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    scoreValue: { fontSize: "26px", fontWeight: "bold", minWidth: "35px", textAlign: "center", color: "#fff" },
    minus: { backgroundColor: theme.danger, color: "white" },
    plus: { backgroundColor: theme.accent, color: "white" },
    summaryCard: { backgroundColor: theme.card, padding: "20px", borderRadius: "10px", marginTop: "20px", textAlign: "left", border: `1px solid ${theme.cardLight}` },
    summaryRow: { display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${theme.cardLight}`, padding: "15px 0", fontSize: "18px" },
    totalScore: { fontWeight: "bold", color: theme.gold, fontSize: "20px" },
    confirmBtn: { width: "100%", padding: "15px", backgroundColor: theme.accent, color: "black", fontSize: "18px", fontWeight: "bold", border: "none", borderRadius: "8px", cursor: "pointer", marginTop: "20px" },
    editBtn: { width: "100%", padding: "15px", backgroundColor: theme.cardLight, color: "white", fontSize: "16px", fontWeight: "bold", border: "none", borderRadius: "8px", cursor: "pointer", marginTop: "10px" },
    reviewBtn: { width: "100%", padding: "15px", backgroundColor: theme.cardLight, color: "white", fontSize: "18px", fontWeight: "bold", border: `2px solid ${theme.accent}`, borderRadius: "8px", cursor: "pointer", marginTop: "30px", marginBottom: "20px" },
  };

  // AJUSTE VISUAL: Remover texto de loading, mostrar container vazio com fundo
  if (isInitialLoading || !group) {
    return <div style={{ backgroundColor: theme.bg, minHeight: "100vh" }} />;
  }

  if (showSummary) {
    return (
      <div style={styles.container}>
        <h2 style={{ color: theme.gold }}>📋 Conferência Final</h2>
        <p style={{ color: theme.textMuted }}>Net Score (Relação ao Par - Handicap)</p>
        <div style={styles.summaryCard}>
          {players.map((p) => {
            const totals = calculateTotal(p.id, p.handicap);
            return (
              <div key={p.id} style={styles.summaryRow}>
                <span>
                  <div style={{ fontWeight: "bold" }}>{p.name}</div>
                  <div style={{ fontSize: "12px", color: theme.textMuted }}>HDCP: {p.handicap || 0}</div>
                </span>
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...styles.totalScore, color: "white" }}>
                    {totals.gross} tacadas
                  </div>
                  <div style={{ 
                    fontSize: "14px", fontWeight: "bold",
                    color: totals.netVsPar.toString().includes("-") ? theme.accent : (totals.netVsPar === "E" ? theme.textMuted : theme.danger) 
                  }}>
                    NET: {totals.netVsPar}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <button style={styles.confirmBtn} onClick={handleConfirmGame}>✅ Assinar Cartão</button>
        <button style={styles.editBtn} onClick={handleEditMode}>✏️ Voltar e Editar</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInfo}>
          <small style={{ color: theme.textMuted, textTransform: "uppercase", letterSpacing: "1px" }}>{group.tournament_name}</small>
          <h3 style={{ margin: "5px 0", color: "#fff" }}>{group.group_name}</h3>
        </div>
        <button onClick={openLeaderboard} style={styles.leaderboardBtn}>🏆 Ranking</button>
      </div>

      <div style={styles.holeNav}>
        <button style={styles.navBtn} onClick={() => changeHole(-1)} disabled={isSaving}>◀</button>
        <div>
          <div style={styles.holeTitle}>Buraco {currentHole}</div>
          <div style={styles.parInfo}>PAR {currentHoleData.par}</div>
          <div style={styles.details}>
            {currentHoleData.yards_blue > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#0077b6", color: "white" }}>{currentHoleData.yards_blue} yds</span>}
            {currentHoleData.yards_white > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#ffffff", color: "black" }}>{currentHoleData.yards_white} yds</span>}
            {currentHoleData.yards_yellow > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#000000", color: "white" }}>{currentHoleData.yards_yellow} yds</span>}
            {currentHoleData.yards_red > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#22c55e", color: "white" }}>{currentHoleData.yards_red} yds</span>}
          </div>
        </div>
        <button style={styles.navBtn} onClick={() => changeHole(1)} disabled={isSaving}>▶</button>
      </div>

      <div>
        {players.map((p) => {
          const score = scores[`${p.id}-${currentHole}`];
          const perfil = calcularPerfilGolfista(p.gender, p.handicap);

          return (
            <div key={p.id} style={styles.playerCard}>
              <div style={styles.playerName}>
                <div style={{ fontSize: "16px", color: "#fff" }}>{p.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", fontSize: "11px", color: theme.textMuted }}>
                  <span style={{ 
                    width: "10px", height: "10px", borderRadius: "50%", 
                    backgroundColor: perfil.tee.cor,
                    border: perfil.tee.nome === "Branco" ? "1px solid #94a3b8" : "none" 
                  }}></span>
                  TEE {perfil.tee.nome.toUpperCase()} • {perfil.cat} • HDCP {p.handicap || 0}
                </div>
              </div>

              <div style={styles.scoreControl}>
                <button style={{ ...styles.scoreBtn, ...styles.minus }} onClick={() => handleScoreChange(p.id, -1)} disabled={isSaving}>-</button>
                <span style={{ ...styles.scoreValue, color: score ? (score < currentHoleData.par ? theme.accent : score > currentHoleData.par ? theme.danger : "white") : theme.cardLight }}>
                  {score ? score : "0"}
                </span>
                <button style={{ ...styles.scoreBtn, ...styles.plus }} onClick={() => handleScoreChange(p.id, 1)} disabled={isSaving}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      {isReviewMode && (
        <button style={styles.reviewBtn} onClick={() => setShowSummary(true)}>📋 Finalizar Cartão</button>
      )}
    </div>
  );
}

export default Scorecard;