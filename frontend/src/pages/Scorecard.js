// frontend/src/pages/Scorecard.js
import React, { useState, useEffect, useCallback } from "react";
import api from "../services/api"; // Ajuste o caminho se necessário
import { useParams, useNavigate } from "react-router-dom";

function Scorecard() {
  const { groupId } = useParams();
  const navigate = useNavigate();

  const [group, setGroup] = useState(null);
  const [players, setPlayers] = useState([]);
  const [holesData, setHolesData] = useState([]);

  const [currentHole, setCurrentHole] = useState(1);
  const [scores, setScores] = useState({});
  const [playedHoles, setPlayedHoles] = useState([]); // Histórico de buracos jogados

  const [showSummary, setShowSummary] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);

  const theme = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent: '#22c55e', 
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444'
  };

  const fetchData = useCallback(async () => {
    try {
      const savedGroup = JSON.parse(localStorage.getItem("activeGroup"));

      if (!savedGroup || savedGroup.id !== Number(groupId)) {
        alert("Sessão inválida. Digite o código novamente.");
        navigate("/");
        return;
      }
      setGroup(savedGroup);
      setCurrentHole(savedGroup.starting_hole);
      
      // Inicia a lista de buracos permitidos para revisão
      setPlayedHoles([savedGroup.starting_hole]);

      const groupList = await api.get(`/groups/list/${savedGroup.tournament_id}`);
      const myGroupData = groupList.data.find((g) => g.id === Number(groupId));

      if (myGroupData && myGroupData.players) setPlayers(myGroupData.players);

      // --- CORREÇÃO: Busca o Course ID direto do torneio para não dar erro ---
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
     // A MÁGICA DO RETORNO: Descobre o último buraco jogado (AGORA SÓ DO SEU GRUPO)
      if (scoresRes.data && scoresRes.data.length > 0 && myGroupData && myGroupData.players) {
        
        // 1. Pega os IDs apenas dos jogadores do grupo atual
        const groupPlayerIds = myGroupData.players.map(p => p.id);

        // 2. Filtra os scores para mostrar SÓ os pontos desses jogadores
        const scoresDoMeuGrupo = scoresRes.data.filter(s => groupPlayerIds.includes(s.user_id));

        if (scoresDoMeuGrupo.length > 0) {
          // 3. Agora sim, pega o buraco mais alto que O SEU GRUPO já anotou
          const playedHoleNumbers = scoresDoMeuGrupo.map(s => s.hole_number);
          const maxHole = Math.max(...playedHoleNumbers);
          
          if (maxHole >= 1 && maxHole <= 18) {
             setCurrentHole(maxHole);
             
             // Reconstrói a lista do histórico para permitir a navegação livre para trás
             const reconstructedHistory = [];
             
             // Se saiu do 1, a lista é simples (ex: 1, 2, 3...)
             if (savedGroup.starting_hole <= maxHole) {
               for (let i = savedGroup.starting_hole; i <= maxHole; i++) reconstructedHistory.push(i);
             } 
             // Se saiu do 10 (Shotgun/Crossover) e já passou da virada do 18 pro 1, a lista dá a volta!
             else {
               for (let i = savedGroup.starting_hole; i <= 18; i++) reconstructedHistory.push(i);
               for (let i = 1; i <= maxHole; i++) reconstructedHistory.push(i);
             }

             setPlayedHoles(reconstructedHistory);
          }
        }
      }
    } catch (error) { console.error("Erro ao carregar dados", error); }
  }, [groupId, navigate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const currentHoleData = holesData.find(
    (h) => Number(h.hole_number) === Number(currentHole) || Number(h.hole) === Number(currentHole)
  ) || { par: 4, yards_blue: 0, yards_white: 0, yards_yellow: 0, yards_red: 0 };

  // Só mexe no número na tela (Visual)
  const handleScoreChange = (userId, delta) => {
    const key = `${userId}-${currentHole}`;
    const currentScore = scores[key];
    let newScore;

    if (!currentScore || currentScore === 0) {
      if (delta > 0) newScore = 1; else return;
    } else {
      newScore = currentScore + delta;
    }

    if (newScore < 1) newScore = 1;

    setScores((prev) => ({ ...prev, [key]: newScore }));
  };

  // --- TRAVA DE NAVEGAÇÃO E SALVAMENTO BIRDIFY (PGA STYLE) ---
  const changeHole = async (delta) => {
    
    // 1. SE TENTAR AVANÇAR: Confere se todo mundo do grupo tem nota
    if (delta > 0) {
      const missingPlayer = players.find((p) => {
        const score = scores[`${p.id}-${currentHole}`];
        return !score || score === 0;
      });

      if (missingPlayer) {
        alert(`⚠️ Falta anotar o score de: ${missingPlayer.name}`);
        return; // Trava a tela e não deixa avançar
      }
    }

    // 2. MÁGICA DO SALVAMENTO: Salva todos os scores da tela de uma vez só!
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
      
      await Promise.all(savePromises); // Espera salvar os 4 jogadores

    } catch (error) {
      console.error("Erro ao salvar os scores do buraco", error);
      alert("Erro ao salvar no banco de dados. Verifique a internet.");
      return; // Se estiver sem internet, não deixa mudar de buraco!
    }

    // 3. AGORA SIM, MUDA O BURACO
    if (delta > 0) {
      // Verifica se finalizou os 18 buracos
      if (!isReviewMode && playedHoles.length >= 18) {
        setShowSummary(true);
        return;
      }
      
      let nextHole = currentHole + 1;
      if (nextHole > 18) nextHole = 1;
      
      // Adiciona o próximo buraco na lista de buracos já acessados
      if (!playedHoles.includes(nextHole)) {
          setPlayedHoles([...playedHoles, nextHole]);
      }
      setCurrentHole(nextHole);

    } else if (delta < 0) {
      let prevHole = currentHole - 1;
      if (prevHole < 1) prevHole = 18;

      // Trava: Só pode voltar para buracos que ele já acessou
      if (!playedHoles.includes(prevHole)) {
        alert("🛑 Você não pode voltar para um buraco antes do seu tee de saída.");
        return;
      }
      setCurrentHole(prevHole);
    }
  };

  const calculateTotal = (userId) => {
    let total = 0;
    for (let h = 1; h <= 18; h++) {
      total += scores[`${userId}-${h}`] || 0;
    }
    return total;
  };

  const handleConfirmGame = () => {
    alert("✅ Cartão Assinado! Placar Oficializado.");
    navigate("/");
  };

  const handleEditMode = () => {
    setShowSummary(false);
    setIsReviewMode(true);
  };

  const openLeaderboard = () => {
    // Agora ele abre na mesma aba, como um App de verdade!
    navigate(`/leaderboard/${group.tournament_id}`);
  };

  const styles = {
    container: { padding: "15px", backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, fontFamily: "'Segoe UI', Roboto, sans-serif", textAlign: "center" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", paddingBottom: "10px", borderBottom: `1px solid ${theme.cardLight}` },
    headerInfo: { textAlign: "left" },
    leaderboardBtn: { backgroundColor: theme.gold, color: "black", border: "none", padding: "8px 12px", borderRadius: "5px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", boxShadow: "0 2px 5px rgba(0,0,0,0.5)" },
    holeNav: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.card, padding: "15px", borderRadius: "10px", marginBottom: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.3)" },
    navBtn: { backgroundColor: theme.cardLight, color: "white", border: "none", padding: "10px 20px", borderRadius: "5px", fontSize: "20px", cursor: "pointer" },
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

  if (!group) return <div style={styles.container}>Carregando...</div>;

  if (showSummary) {
    return (
      <div style={styles.container}>
        <h2 style={{ color: theme.gold }}>📋 Conferência Final</h2>
        <p style={{ color: theme.textMuted }}>Confira os totais com os parceiros.</p>
        <div style={styles.summaryCard}>
          {players.map((p) => (
            <div key={p.id} style={styles.summaryRow}>
              <span>{p.name}</span>
              <span style={styles.totalScore}>{calculateTotal(p.id)}</span>
            </div>
          ))}
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
        <button style={styles.navBtn} onClick={() => changeHole(-1)}>◀</button>
        <div>
          <div style={styles.holeTitle}>Buraco {currentHole}</div>
          <div style={styles.parInfo}>PAR {currentHoleData.par}</div>
          <div style={styles.details}>
            {currentHoleData.yards_blue > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#0077b6", color: "white" }}>{currentHoleData.yards_blue} yds</span>}
            {currentHoleData.yards_white > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#ffffff", color: "black" }}>{currentHoleData.yards_white} yds</span>}
            {currentHoleData.yards_yellow > 0 && <span style={{ ...styles.yardBadge, backgroundColor: "#ffd700", color: "black" }}>{currentHoleData.yards_yellow} yds</span>}
            {currentHoleData.yards_red > 0 && <span style={{ ...styles.yardBadge, backgroundColor: theme.danger, color: "white" }}>{currentHoleData.yards_red} yds</span>}
          </div>
        </div>
        <button style={styles.navBtn} onClick={() => changeHole(1)}>▶</button>
      </div>

      <div>
        {players.map((p) => {
          const score = scores[`${p.id}-${currentHole}`];
          return (
            <div key={p.id} style={styles.playerCard}>
              <div style={styles.playerName}>{p.name}</div>
              <div style={styles.scoreControl}>
                <button style={{ ...styles.scoreBtn, ...styles.minus }} onClick={() => handleScoreChange(p.id, -1)}>-</button>
                <span style={{ ...styles.scoreValue, color: score ? (score < currentHoleData.par ? theme.accent : score > currentHoleData.par ? theme.danger : "white") : theme.cardLight }}>
                  {score ? score : "0"}
                </span>
                <button style={{ ...styles.scoreBtn, ...styles.plus }} onClick={() => handleScoreChange(p.id, 1)}>+</button>
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