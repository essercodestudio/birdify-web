// frontend/src/pages/JoinGame.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

function JoinGame() {
  const [accessCode, setAccessCode] = useState('');
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  // Estados para o Modal de Handicaps
  const [showModal, setShowModal] = useState(false);
  const [pendingGroup, setPendingGroup] = useState(null);
  const [groupPlayers, setGroupPlayers] = useState([]);
  const [handicaps, setHandicaps] = useState({});

  // TEMA PADRONIZADO
  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: '#22c55e',
    gold: '#eab308',
    blue: '#3b82f6',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444'
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const handleJoinGroup = async (e) => {
    e.preventDefault();
    try {
      // 1. A MÁGICA DE SEGURANÇA: Agora enviamos o código E quem está tentando entrar!
      const res = await axios.post('http://localhost:3001/api/groups/join', { 
        access_code: accessCode,
        user_id: user.id 
      });
      
      const group = res.data.group;

      const listRes = await axios.get(`http://localhost:3001/api/groups/list/${group.tournament_id}`);
      const allGroups = listRes.data;
      const myGroup = allGroups.find(g => g.id === group.id) || group;

      if (myGroup.players && myGroup.players.length > 0) {
        setPendingGroup(group);
        setGroupPlayers(myGroup.players);
        
        const initialHandicaps = {};
        myGroup.players.forEach(p => { initialHandicaps[p.id] = ''; });
        setHandicaps(initialHandicaps);
        
        setShowModal(true);
      } else {
        localStorage.setItem('activeGroup', JSON.stringify(group));
        navigate(`/scorecard/${group.id}`);
      }
    } catch (error) {
      // 2. MENSAGEM INTELIGENTE: Mostra o erro exato (ex: "Você não faz parte deste grupo")
      if (error.response && error.response.data && error.response.data.message) {
        alert("🚨 Acesso Negado: " + error.response.data.message);
      } else {
        alert("❌ Erro de conexão. Verifique o código e tente novamente.");
      }
    }
  };

  const handleHandicapChange = (userId, value) => {
    setHandicaps({ ...handicaps, [userId]: value });
  };

  const submitHandicaps = async () => {
    for (const playerId of groupPlayers.map(p => p.id)) {
      if (handicaps[playerId] === '' || handicaps[playerId] === undefined) {
        alert("Por favor, preencha o handicap de TODOS os jogadores (coloque 0 se não tiver).");
        return;
      }
    }

    const confirm1 = window.confirm("Tem certeza de que os Handicaps digitados estão corretos?");
    if (!confirm1) return;

    const confirm2 = window.confirm("⚠️ ATENÇÃO MÁXIMA: Após essa confirmação, os handicaps NÃO poderão ser alterados durante o jogo. Deseja prosseguir para o Scorecard?");
    if (!confirm2) return;

    const playersData = groupPlayers.map(p => ({
      user_id: p.id,
      handicap: parseFloat(handicaps[p.id])
    }));

    try {
      await axios.put('http://localhost:3001/api/groups/save-handicaps', {
        group_id: pendingGroup.id,
        players_data: playersData
      });

      localStorage.setItem('activeGroup', JSON.stringify(pendingGroup));
      setShowModal(false);
      navigate(`/scorecard/${pendingGroup.id}`);
    } catch (error) {
      alert("🚨 ERRO DETALHADO: " + (error.response?.data?.error || error.message));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    navigate('/login');
  };

  const styles = {
    container: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: theme.bg, color: theme.textMain, fontFamily: "'Inter', sans-serif", padding: '20px' },
    card: { backgroundColor: theme.card, padding: '40px 30px', borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center', width: '100%', maxWidth: '400px', border: `1px solid ${theme.cardLight}` },
    title: { color: theme.gold, margin: '0 0 10px 0', fontSize: '32px', fontWeight: '900', letterSpacing: '-1px' },
    form: { borderBottom: `1px solid ${theme.cardLight}`, paddingBottom: '30px', marginBottom: '30px' },
    input: { padding: '18px', width: '100%', borderRadius: '12px', border: `2px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: 'white', fontSize: '24px', textAlign: 'center', textTransform: 'uppercase', marginBottom: '20px', boxSizing: 'border-box', letterSpacing: '4px', fontWeight: 'bold', outline: 'none' },
    btnPlay: { padding: '18px', width: '100%', backgroundColor: theme.accent, color: '#000', border: 'none', borderRadius: '12px', fontSize: '18px', fontWeight: '800', cursor: 'pointer', boxShadow: `0 4px 14px 0 rgba(34, 197, 94, 0.39)` },
    btnPortal: { padding: '14px', width: '100%', backgroundColor: theme.blue, color: 'white', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' },
    btnAdmin: { padding: '14px', width: '100%', backgroundColor: 'transparent', color: theme.gold, border: `1px solid ${theme.gold}`, borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' },
    
    // Estilos do Modal
    modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' },
    modalContent: { backgroundColor: theme.card, padding: '30px', borderRadius: '24px', width: '100%', maxWidth: '420px', border: `1px solid ${theme.danger}`, boxShadow: '0 0 30px rgba(239, 68, 68, 0.2)' },
    playerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 0', borderBottom: `1px solid ${theme.cardLight}` },
    hcInput: { width: '90px', padding: '10px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.accent, textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }
  };

  if (!user) return <div style={styles.container}>Carregando...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ fontSize: '40px', marginBottom: '10px' }}>⛳</div>
        <h1 style={styles.title}>Golf Scorer</h1>
        <p style={{ color: theme.textMuted, marginBottom: '30px' }}>Bem-vindo, <strong style={{color: theme.textMain}}>{user.name}</strong></p>
            
        <form onSubmit={handleJoinGroup} style={styles.form}>
          <h3 style={{marginTop: 0, fontSize: '14px', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '1px'}}>Código do Grupo</h3>
          <input 
            type="text" 
            placeholder="A1B2" 
            value={accessCode}
            onChange={e => setAccessCode(e.target.value.toUpperCase())}
            style={styles.input}
            required
            maxLength={6}
          />
          <button type="submit" style={styles.btnPlay}>COMEÇAR PARTIDA</button>
        </form>

        <p style={{margin: '0 0 15px 0', fontSize: '13px', color: theme.textMuted}}>Área do Competidor</p>
        <button onClick={() => navigate('/player')} style={styles.btnPortal}>INSCRIÇÕES E TORNEIOS</button>

        {user.role === 'ADMIN' && (
          <button onClick={() => navigate('/dashboard')} style={styles.btnAdmin}>PAINEL DO ORGANIZADOR</button>
        )}

        <button onClick={handleLogout} style={{ marginTop: '25px', color: theme.danger, cursor: 'pointer', background: 'none', border: 'none', fontSize: '14px', fontWeight: '600' }}>
          Sair da Conta
        </button>
      </div>

      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h2 style={{ color: theme.danger, marginTop: 0, textAlign: 'center', fontWeight: '900' }}>HANDICAPS</h2>
            <p style={{ color: theme.textMuted, fontSize: '14px', textAlign: 'center', marginBottom: '25px', lineHeight: '1.5' }}>
              Confirme o handicap oficial para o cálculo do <strong style={{color: theme.textMain}}>Net Score</strong>. Use ponto para decimais.
            </p>

            {groupPlayers.map(p => (
              <div key={p.id} style={styles.playerRow}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{p.name}</div>
                  <div style={{ fontSize: '12px', color: theme.textMuted }}>Jogador</div>
                </div>
                <input 
                  type="number" 
                  step="0.1" 
                  placeholder="0.0"
                  value={handicaps[p.id]}
                  onChange={e => handleHandicapChange(p.id, e.target.value)}
                  style={styles.hcInput}
                />
              </div>
            ))}

            <div style={{ display: 'flex', gap: '15px', marginTop: '30px' }}>
              <button 
                onClick={() => setShowModal(false)} 
                style={{ flex: 1, padding: '15px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                VOLTAR
              </button>
              <button 
                onClick={submitHandicaps} 
                style={{ ...styles.btnPlay, flex: 2, padding: '15px', backgroundColor: theme.danger, color: 'white' }}
              >
                CONFIRMAR TUDO
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JoinGame;