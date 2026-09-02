// frontend/src/pages/JoinGame.js
import React, { useState, useEffect, useContext } from 'react';
import api from '../services/api';
import { getUser } from '../services/authStorage';
import { logout } from '../services/session'; 
import { useNavigate } from 'react-router-dom';
import logoImg from '../assets/logo_birdify.png';
import { ThemeContext } from '../App';
import { mediaUrl } from '../services/media';
import TeeSuggestionChip from '../components/TeeSuggestionChip';
import { formatDuplaFromPlayers } from '../utils/duplaName';

function JoinGame() {
  const [accessCode, setAccessCode] = useState('');
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  const [showModal, setShowModal] = useState(false);
  const [pendingGroup, setPendingGroup] = useState(null);
  const [groupPlayers, setGroupPlayers] = useState([]);
  const [handicaps, setHandicaps] = useState({});
  const [teeRules, setTeeRules] = useState([]);
  // Onda B · Commit 3.10: doubles carrega duplas do grupo + handicap por dupla.
  // callerDuplaId (do joinGroup) identifica a dupla do jogador — usado pra
  // navegar direto ao scorecard com contexto certo.
  const [groupDuplas, setGroupDuplas] = useState([]);
  const [duplaHandicaps, setDuplaHandicaps] = useState({});
  const [modality, setModality] = useState('individual');
  const [callerDuplaId, setCallerDuplaId] = useState(null);

  const clubTheme = useContext(ThemeContext) || {};

  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: clubTheme.primary_color || '#22c55e', 
    gold: '#eab308',
    blue: '#3b82f6',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444'
  };

  useEffect(() => {
    const storedUser = getUser();
    if (storedUser) {
      setUser(storedUser);
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const handleJoinGroup = async (e) => {
    e.preventDefault();
    
    if (!navigator.onLine) {
      alert("⚠️ Sem conexão com a internet. Aguarde o sinal voltar para entrar no grupo.");
      return;
    }

    try {
      const res = await api.post('/groups/join', {
        access_code: accessCode,
        user_id: user.id
      });

      const group = res.data.group;
      const mod = group.modality || 'individual';
      const listRes = await api.get(`/groups/list/${group.tournament_id}`);
      const myGroup = listRes.data.find(g => g.id === group.id) || group;

      setModality(mod);
      setCallerDuplaId(group.caller_dupla_id || null);

      // Onda B · Commit 3.10: doubles bifurca aqui. Se torneio doubles, mostra
      // modal com 1 linha por DUPLA (nao por player). Handicap eh unico da
      // dupla, digitado no lobby (decisao 2).
      if (mod === 'doubles') {
        const duplas = myGroup.duplas || [];
        if (duplas.length === 0) {
          // sem duplas escaladas ainda — vai direto pro scorecard (admin deve
          // cadastrar duplas antes; mensagem descritiva vem do proprio scorecard)
          localStorage.setItem('activeGroup', JSON.stringify(group));
          navigate(`/scorecard/${group.id}`);
          return;
        }
        setPendingGroup(group);
        setGroupDuplas(duplas);
        const initialHc = {};
        duplas.forEach(d => {
          initialHc[d.id] = (d.handicap !== null && d.handicap !== undefined) ? d.handicap : '';
        });
        setDuplaHandicaps(initialHc);
        setShowModal(true);
        return;
      }

      if (myGroup.players && myGroup.players.length > 0) {
        setPendingGroup(group);
        setGroupPlayers(myGroup.players);

        const initialHandicaps = {};
        myGroup.players.forEach(p => {
            initialHandicaps[p.id] = (p.handicap !== null && p.handicap !== undefined) ? p.handicap : '';
        });

        setHandicaps(initialHandicaps);
        setShowModal(true);

        // Carrega regras de tee do campo. Falha silenciosa NA UI (chip só não
        // aparece), mas log em console pra rastrear erro real (rede, 500, etc.)
        // sem obrigar o jogador a ver mensagem que ele não sabe agir.
        if (group.course_id) {
          api.get(`/courses/${group.course_id}/tee-rules`)
            .then(res => setTeeRules(res.data?.rules || []))
            .catch(err => {
              console.warn('[tee-rules] falha ao carregar regras do campo:', err?.response?.status, err?.message);
              setTeeRules([]);
            });
        }
      } else {
        localStorage.setItem('activeGroup', JSON.stringify(group));
        navigate(`/scorecard/${group.id}`);
      }
    } catch (error) {
      const msg = error.response?.data?.message || "Erro de conexão.";
      alert("🚨 " + msg);
    }
  };

  const handleDuplaHandicapChange = (duplaId, value) => {
    setDuplaHandicaps({ ...duplaHandicaps, [duplaId]: value });
  };

  const submitDuplaHandicaps = async () => {
    if (!navigator.onLine) {
      alert("⚠️ Aguarde a conexão voltar para confirmar os handicaps.");
      return;
    }
    for (const d of groupDuplas) {
      if (duplaHandicaps[d.id] === '' || duplaHandicaps[d.id] === undefined) {
        alert(`Insira o handicap da dupla ${formatDuplaFromPlayers(d.players) || d.dupla_name}`);
        return;
      }
    }
    const duplas_data = groupDuplas.map(d => ({
      dupla_id: d.id,
      handicap: parseFloat(duplaHandicaps[d.id]),
    }));
    try {
      await api.put('/groups/save-dupla-handicaps', {
        group_id: pendingGroup.id,
        duplas_data,
      });
      // Passa caller_dupla_id via activeGroup pra Scorecard saber qual dupla eh a do jogador
      const groupWithDupla = { ...pendingGroup, modality: 'doubles', caller_dupla_id: callerDuplaId };
      localStorage.setItem('activeGroup', JSON.stringify(groupWithDupla));
      setShowModal(false);
      navigate(`/scorecard/${pendingGroup.id}`);
    } catch (error) {
      alert("Erro ao salvar: " + (error.response?.data?.error || error.message));
    }
  };

  const handleHandicapChange = (userId, value) => {
    setHandicaps({ ...handicaps, [userId]: value });
  };

  const submitHandicaps = async () => {
    if (!navigator.onLine) {
      alert("⚠️ Aguarde a conexão voltar para confirmar os handicaps. Seus dados estão preenchidos na tela.");
      return;
    }

    for (const p of groupPlayers) {
      if (handicaps[p.id] === '' || handicaps[p.id] === undefined) {
        alert(`Por favor, insira o handicap de ${p.name}`);
        return;
      }
    }

    const playersData = groupPlayers.map(p => ({
      user_id: p.id,
      handicap: parseFloat(handicaps[p.id])
    }));

    try {
      await api.put('/groups/save-handicaps', {
        group_id: pendingGroup.id,
        players_data: playersData
      });

      localStorage.setItem('activeGroup', JSON.stringify(pendingGroup));
      setShowModal(false);
      navigate(`/scorecard/${pendingGroup.id}`);
    } catch (error) {
      alert("Erro ao salvar: " + (error.response?.data?.error || error.message));
    }
  };

  const handleLogout = () => logout(navigate);

  const styles = {
    container: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: theme.bg, color: theme.textMain, padding: '20px' },
    card: { backgroundColor: theme.card, padding: '40px 30px', borderRadius: '24px', boxShadow: `0 25px 50px -12px rgba(0,0,0,0.5), 0 0 20px ${theme.accent}1A`, textAlign: 'center', width: '100%', maxWidth: '400px', border: `1px solid ${theme.cardLight}` },
    title: { color: theme.gold, margin: '0 0 10px 0', fontSize: '32px', fontWeight: '900', letterSpacing: '-1px' },
    form: { borderBottom: `1px solid ${theme.cardLight}`, paddingBottom: '30px', marginBottom: '30px' },
    input: { padding: '18px', width: '100%', borderRadius: '12px', border: `2px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: 'white', fontSize: '24px', textAlign: 'center', textTransform: 'uppercase', marginBottom: '20px', boxSizing: 'border-box', letterSpacing: '4px', fontWeight: 'bold', outline: 'none' },
    btnPlay: { padding: '18px', width: '100%', backgroundColor: theme.accent, color: '#000', border: 'none', borderRadius: '12px', fontSize: '18px', fontWeight: '800', cursor: 'pointer', boxShadow: `0 8px 20px -4px ${theme.accent}66` },
    btnPortal: { padding: '14px', width: '100%', backgroundColor: 'transparent', color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' },
    btnAdmin: { padding: '14px', width: '100%', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' },
    btnTraining: { padding: '14px', width: '100%', backgroundColor: 'transparent', color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: '12px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' },
    modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' },
    modalContent: { backgroundColor: theme.card, padding: '30px', borderRadius: '24px', width: '100%', maxWidth: '420px', border: `1px solid ${theme.accent}`, boxShadow: `0 0 30px ${theme.accent}33` },
    playerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 0', borderBottom: `1px solid ${theme.cardLight}` },
    hcInput: { width: '90px', padding: '10px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.accent, textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }
  };

  if (!user) return null;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <img
          src={clubTheme.logo_url ? mediaUrl(clubTheme.logo_url) : logoImg}
          alt={`Logo ${clubTheme.name || 'Birdify'}`}
          style={{ width: '180px', height: 'auto', marginBottom: '20px', objectFit: 'contain' }}
        />
        
        <h2 style={{ margin: '0 0 5px 0', fontSize: '20px', color: theme.accent }}>
          {clubTheme.name || 'Birdify'}
        </h2>
        
        <p style={{ color: theme.textMuted, marginBottom: '30px' }}>Bem-vindo, <strong style={{color: theme.textMain}}>{user.name}</strong></p>
            
        <form onSubmit={handleJoinGroup} style={styles.form}>
          <h3 style={{marginTop: 0, fontSize: '14px', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '1px'}}>Código do Grupo (TORNEIO)</h3>
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

        <p style={{margin: '0 0 15px 0', fontSize: '15px', color: theme.textMuted}}>Área do Atleta</p>
        <button onClick={() => navigate('/player')} style={styles.btnPortal}>INSCRIÇÕES E TORNEIOS</button>
        <button onClick={() => navigate('/daily-training')} style={styles.btnTraining}> TREINO DO DIA</button>
        <button onClick={() => navigate('/player-history')} style={{ ...styles.btnTraining, marginTop: '10px', color: theme.textMuted, borderColor: theme.cardLight }}>📊 MEU HISTÓRICO</button>

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
            <h2 style={{ color: theme.accent, marginTop: 0, textAlign: 'center', fontWeight: '900' }}>HANDICAPS</h2>
            <p style={{ color: theme.textMuted, fontSize: '14px', textAlign: 'center', marginBottom: '25px' }}>
              {modality === 'doubles'
                ? <>Insira o handicap <strong style={{color: theme.textMain}}>de cada dupla</strong> — combinado, único por dupla.</>
                : <>Insira o handicap para o cálculo do <strong style={{color: theme.textMain}}>Net Score</strong>.</>}
            </p>

            {modality === 'doubles' ? groupDuplas.map(d => (
              <div key={d.id} style={styles.playerRow}>
                <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                  {/* Onda B · Commit 3.16: nome compacto substitui dupla_name + subtitulo redundante. */}
                  <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                    {formatDuplaFromPlayers(d.players) || d.dupla_name}
                  </div>
                </div>
                <input
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={duplaHandicaps[d.id] || ''}
                  onChange={e => handleDuplaHandicapChange(d.id, e.target.value)}
                  style={styles.hcInput}
                />
              </div>
            )) : groupPlayers.map(p => (
              <div key={p.id} style={styles.playerRow}>
                <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{p.name}</div>
                  <div style={{ fontSize: '12px', color: theme.textMuted }}>{p.gender === 'M' || p.gender === 'Masculino' ? 'Masculino' : 'Feminino'}</div>
                  <TeeSuggestionChip
                    handicap={handicaps[p.id]}
                    gender={p.gender}
                    rules={teeRules}
                  />
                </div>
                <input
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={handicaps[p.id] || ''}
                  onChange={e => handleHandicapChange(p.id, e.target.value)}
                  style={styles.hcInput}
                />
              </div>
            ))}

            <div style={{ display: 'flex', gap: '15px', marginTop: '30px' }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '15px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, borderRadius: '12px', cursor: 'pointer' }}>
                VOLTAR
              </button>
              <button onClick={modality === 'doubles' ? submitDuplaHandicaps : submitHandicaps} style={{ ...styles.btnPlay, flex: 2, padding: '15px' }}>
                CONFIRMAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JoinGame;