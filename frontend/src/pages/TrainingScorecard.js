import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { socket } from '../services/socket';
import { useClub } from '../context/ClubContext';

// Cores dos scores: Eagle=ouro, Birdie=verde, Par=cinza, Bogey+=vermelho, vazio=cardLight
const getScoreColor = (strokes, par, cardLight, gold, danger) => {
  if (!strokes || strokes === 0) return cardLight;
  const diff = strokes - par;
  if (strokes === 1 || diff <= -2) return gold;
  if (diff === -1)                  return '#4ade80';
  if (diff === 0)                   return '#cbd5e1';
  return danger;
};

const holeBoxStyle = (strokes, par) => {
  if (!strokes) return { bg: 'rgba(51,65,85,0.5)', color: '#64748b', border: '#334155' };
  const diff = strokes - par;
  if (strokes === 1 || diff <= -2) return { bg: 'rgba(234,179,8,0.18)',   color: '#eab308', border: '#eab308' };
  if (diff === -1)                  return { bg: 'rgba(74,222,128,0.15)',  color: '#4ade80', border: '#4ade80' };
  if (diff === 0)                   return { bg: 'rgba(203,213,225,0.07)', color: '#cbd5e1', border: '#475569' };
  return                                   { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', border: '#ef4444' };
};

function TrainingScorecard() {
  const { groupId: routeGroupId } = useParams();
  const navigate                  = useNavigate();
  const { club }                  = useClub();

  // F5 preserva a URL, mas se por algum motivo o parâmetro faltar, lê do localStorage.
  // Só navega para /daily-training se realmente não houver ID de lugar nenhum.
  const groupId = routeGroupId
    || JSON.parse(localStorage.getItem('activeTrainingGroup') || 'null')?.id?.toString()
    || null;

  const [group, setGroup]               = useState(null);
  const [players, setPlayers]           = useState([]);
  const [groupStatus, setGroupStatus]   = useState('aguardando');
  const [holesData, setHolesData]       = useState([]);
  const [currentHole, setCurrentHole]   = useState(1);
  const [scores, setScores]             = useState({});
  const [playedHoles, setPlayedHoles]   = useState([1]);
  const [showSummary, setShowSummary]   = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [isCreator, setIsCreator]       = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  const [fetchError, setFetchError]   = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Timers de debounce por chave "userId-holeNumber"
  const saveTimers      = useRef({});
  // Ref estável para fetchData (evita stale closure nos listeners de socket)
  const fetchDataRef    = useRef(null);
  // Previne duplo clique no botão Finalizar
  const isFinishingRef  = useRef(false);
  // Espelho do groupStatus para uso dentro de closures de socket (sem stale closure)
  const groupStatusRef  = useRef('aguardando');

  const accent = club?.primary_color || '#22c55e';
  const theme  = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent,
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444',
  };

  // Redireciona se não houver groupId de forma alguma (efeito — não pode ser síncrono no render)
  useEffect(() => {
    if (!groupId) navigate('/daily-training', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Limpeza de chaves training_hole_XX de treinos antigos que não foram encerrados corretamente.
  // Roda uma vez na montagem: remove todas as chaves training_hole_ exceto a do grupo atual.
  useEffect(() => {
    if (!groupId) return;
    const prefix = 'training_hole_';
    const currentKey = `${prefix}${groupId}`;
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix) && k !== currentKey)
      .forEach(k => localStorage.removeItem(k));
  }, [groupId]);

  // ── Hidratação do scorecard a partir do banco ──
  // Regra: posiciona no ÚLTIMO buraco onde todos têm score (não no próximo).
  // Isso garante que voltar do Ranking não avance o buraco automaticamente.
  const loadScorecardData = useCallback(async (savedGroup, allPlayers, scoresRaw) => {
    if (savedGroup.course_id) {
      const holesRes = await api.get(`/courses/${savedGroup.course_id}/holes`);
      setHolesData(holesRes.data);
    }

    const scoresMap = {};
    scoresRaw.forEach(s => { scoresMap[`${s.user_id}-${s.hole_number}`] = s.strokes; });
    setScores(scoresMap);

    const startHole = savedGroup.starting_hole || 1;

    // Sem scores ainda: começa no buraco inicial
    if (scoresRaw.length === 0 || allPlayers.length === 0) {
      setCurrentHole(startHole);
      setPlayedHoles([startHole]);
      return;
    }

    // Percorre em ordem e para no primeiro buraco incompleto.
    // O buraco ANTERIOR a esse é onde o usuário estava (último completo).
    let lastFullHole   = startHole;
    let holesCompleted = 0;

    for (let i = 1; i <= 18; i++) {
      const h       = startHole + i - 1;
      const actualH = h > 18 ? h - 18 : h;
      const allDone = allPlayers.every(
        p => scoresRaw.some(s => s.user_id === p.id && s.hole_number === actualH)
      );
      if (!allDone) break;
      lastFullHole = actualH;
      holesCompleted++;
    }

    // Reconstrói histórico de buracos navegados (permite voltar até startHole)
    const history = [];
    if (startHole <= lastFullHole) {
      for (let i = startHole; i <= lastFullHole; i++) history.push(i);
    } else {
      for (let i = startHole; i <= 18; i++) history.push(i);
      for (let i = 1; i <= lastFullHole; i++) history.push(i);
    }
    if (history.length === 0) history.push(startHole);

    // localStorage tem prioridade absoluta — persiste F5 e fecha/abre aba.
    // Não valida contra o estado do banco (evita regressão por latência de rede).
    const storageKey    = `training_hole_${groupId}`;
    const persistedHole = parseInt(localStorage.getItem(storageKey), 10) || null;

    if (persistedHole >= 1 && persistedHole <= 18) {
      // Reconstrói história contínua do startHole até o buraco persistido
      const fullHistory = [];
      if (startHole <= persistedHole) {
        for (let i = startHole; i <= persistedHole; i++) fullHistory.push(i);
      } else {
        for (let i = startHole; i <= 18; i++) fullHistory.push(i);
        for (let i = 1; i <= persistedHole; i++) fullHistory.push(i);
      }
      setPlayedHoles(fullHistory);
      setCurrentHole(persistedHole);
    } else {
      setPlayedHoles(history);
      setCurrentHole(lastFullHole);
    }

    if (holesCompleted === 18) setShowSummary(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const fetchData = useCallback(async () => {
    try {
      const [groupData, scoresData] = await Promise.all([
        api.get(`/training/group/${groupId}`),
        api.get(`/training/scores/${groupId}`),
      ]);

      // Grupo não encontrado: limpa localStorage para destravar criação de novo treino,
      // depois mostra tela de retry em vez de ejetar o usuário automaticamente.
      if (!groupData.data?.id) {
        localStorage.removeItem('activeTrainingGroup');
        localStorage.removeItem(`training_hole_${groupId}`);
        setFetchError(true);
        return;
      }

      setFetchError(false);

      let savedGroup = JSON.parse(localStorage.getItem('activeTrainingGroup') || 'null');
      if (!savedGroup || savedGroup.id !== Number(groupId)) {
        savedGroup = {
          id:            groupData.data.id,
          creator_id:    groupData.data.creator_id,
          course_id:     groupData.data.course_id,
          group_name:    groupData.data.group_name,
          access_code:   groupData.data.access_code,
          starting_hole: groupData.data.starting_hole || 1,
        };
        localStorage.setItem('activeTrainingGroup', JSON.stringify(savedGroup));
      }

      const loggedUser = JSON.parse(localStorage.getItem('user') || 'null');
      setIsCreator(!!(loggedUser && loggedUser.id === savedGroup.creator_id));
      setGroup(savedGroup);

      const status = groupData.data.status || 'aguardando';
      setGroupStatus(status);
      setPlayers(groupData.data.players || []);

      // Grupo finalizado: libera o slot — DailyTraining já pode criar novo treino
      if (status === 'finalizado') {
        localStorage.removeItem('activeTrainingGroup');
        localStorage.removeItem(`training_hole_${groupId}`);
      }

      if (status === 'ativo' || status === 'finalizado') {
        await loadScorecardData(savedGroup, groupData.data.players || [], scoresData.data);
      }
    } catch (err) {
      console.error('Erro ao carregar treino:', err);
      setFetchError(true);
    } finally {
      setIsLoading(false);
    }
  }, [groupId, loadScorecardData]);

  // Mantém refs sempre atualizadas para uso dentro de listeners de socket
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);
  useEffect(() => { groupStatusRef.current = groupStatus; }, [groupStatus]);

  // Carga inicial
  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Socket.io: tempo real ──
  useEffect(() => {
    let active = true;

    // Só conecta se ainda não está conectado — evita dupla tentativa no StrictMode
    if (!socket.connected) socket.connect();
    socket.emit('join:training', groupId);

    const onConnect = () => {
      if (active) socket.emit('join:training', groupId);
    };

    const onScoreSaved = ({ user_id, hole_number, strokes }) => {
      if (active) setScores(prev => ({ ...prev, [`${user_id}-${hole_number}`]: strokes }));
    };

    const onPlayerJoined = () => {
      if (!active) return;
      api.get(`/training/group/${groupId}`)
        .then(res => { if (active) setPlayers(res.data.players || []); })
        .catch(() => {});
    };

    const onStarted = () => {
      if (!active) return;
      setGroupStatus('ativo');
      fetchDataRef.current?.();
    };

    // Não chama fetchData se o criador já finalizou localmente: evita race condition
    // onde o banco ainda retorna 'ativo' e reverte o componente para FASE 2.
    const onFinished = () => {
      if (!active) return;
      setGroupStatus('finalizado');
      if (groupStatusRef.current !== 'finalizado') {
        fetchDataRef.current?.();
      }
    };

    socket.on('connect',                onConnect);
    socket.on('training:score_saved',   onScoreSaved);
    socket.on('training:player_joined', onPlayerJoined);
    socket.on('training:started',       onStarted);
    socket.on('training:finished',      onFinished);

    return () => {
      active = false;
      socket.off('connect',                onConnect);
      socket.off('training:score_saved',   onScoreSaved);
      socket.off('training:player_joined', onPlayerJoined);
      socket.off('training:started',       onStarted);
      socket.off('training:finished',      onFinished);
      socket.emit('leave:training', groupId);
      // ⚠️ NÃO desconectar: socket é singleton — disconnect aqui cancela o handshake WSS
      Object.values(saveTimers.current).forEach(clearTimeout);
      saveTimers.current = {};
    };
  }, [groupId]);

  // ── Ações do Lobby ──
  const handleStartTraining = async () => {
    if (!isCreator) return;
    try {
      await api.post('/training/start', { group_id: Number(groupId) });
      setGroupStatus('ativo');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao iniciar treino.');
    }
  };

  const handleCancel = async () => {
    if (!isCreator) return;
    if (!window.confirm('Cancelar o treino? Todos os atletas serão removidos da sala.')) return;
    try {
      const loggedUser = JSON.parse(localStorage.getItem('user') || 'null');
      await api.post('/training/cancel', { group_id: Number(groupId), creator_id: loggedUser?.id });
      localStorage.removeItem('activeTrainingGroup');
      localStorage.removeItem(`training_hole_${groupId}`);
      navigate('/daily-training', { replace: true });
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao cancelar treino.');
    }
  };

  const handleLeave = async () => {
    if (isCreator) return;
    if (!window.confirm('Sair do grupo?')) return;
    try {
      const loggedUser = JSON.parse(localStorage.getItem('user') || 'null');
      await api.post('/training/leave', { group_id: Number(groupId), user_id: loggedUser?.id });
      localStorage.removeItem('activeTrainingGroup');
      localStorage.removeItem(`training_hole_${groupId}`);
      navigate('/daily-training', { replace: true });
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao sair do grupo.');
    }
  };

  // ── Scorecard ativo ──
  const currentHoleData = holesData.find(
    h => Number(h.hole_number) === Number(currentHole) || Number(h.hole) === Number(currentHole)
  ) || { par: 4 };

  // Persistência atômica: cada clique → debounce 400ms → UPSERT no banco
  const handleScoreChange = (userId, delta) => {
    if (!isCreator) return;
    const key = `${userId}-${currentHole}`;
    const cur = parseInt(scores[key]) || 0;
    let next  = cur + delta;
    if (cur === 0 && delta > 0) next = currentHoleData.par || 4;
    if (next < 1) { if (delta < 0) return; next = 1; }

    setScores(prev => ({ ...prev, [key]: next }));

    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      api.post('/training/score', {
        group_id:    Number(groupId),
        user_id:     userId,
        hole_number: currentHole,
        strokes:     next,
      }).catch(err => console.error('Falha ao salvar score:', err));
      delete saveTimers.current[key];
    }, 400);
  };

  // Drena timers pendentes do buraco e aguarda confirmação do backend.
  // Retorna Promise para que changeHole possa fazer await antes de avançar.
  const flushPendingForHole = (hole) => {
    const saves = players
      .filter(p => saveTimers.current[`${p.id}-${hole}`])
      .map(p => {
        const key = `${p.id}-${hole}`;
        clearTimeout(saveTimers.current[key]);
        const s = scores[key];
        delete saveTimers.current[key];
        return s > 0
          ? api.post('/training/score', {
              group_id: Number(groupId), user_id: Number(p.id),
              hole_number: Number(hole), strokes: Number(s),
            }).catch(err => console.error('[flush] score falhou:', err))
          : Promise.resolve();
      });
    return Promise.all(saves);
  };

  // Avança ou recua o buraco. Aguarda o backend confirmar os scores antes de avançar
  // para garantir que o buraco só muda após persistência real no banco.
  const changeHole = async (delta) => {
    if (delta > 0) {
      const missing = players.find(p => !(scores[`${p.id}-${currentHole}`] > 0));
      if (missing) { alert(`⚠️ Falta anotar o score de: ${missing.name}`); return; }
      await flushPendingForHole(currentHole);
      if (!isReviewMode && playedHoles.length >= 18) { setShowSummary(true); return; }
      let next = currentHole + 1; if (next > 18) next = 1;
      if (!playedHoles.includes(next)) setPlayedHoles(prev => [...prev, next]);
      setCurrentHole(next);
      localStorage.setItem(`training_hole_${groupId}`, next);
    } else if (delta < 0) {
      let prev = currentHole - 1; if (prev < 1) prev = 18;
      if (!playedHoles.includes(prev)) { alert('🛑 Você não pode voltar antes do tee de saída.'); return; }
      setCurrentHole(prev);
      localStorage.setItem(`training_hole_${groupId}`, prev);
    }
  };

  const calculateTotal = (userId) => {
    let gross = 0, totalPar = 0;
    for (let h = 1; h <= 18; h++) {
      const s = scores[`${userId}-${h}`];
      if (s > 0) {
        gross += s;
        const hole = holesData.find(hd => (hd.hole_number || hd.hole) === h);
        if (hole) totalPar += hole.par;
      }
    }
    if (gross === 0) return { gross: 0, vsPar: 'E' };
    const diff = gross - totalPar;
    return { gross, vsPar: diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}` };
  };

  const handleFinish = async () => {
    if (!isCreator || isFinishingRef.current) return;
    if (!navigator.onLine) { alert('⚠️ Aguarde a conexão voltar para finalizar o treino.'); return; }

    isFinishingRef.current = true;
    setIsFinishing(true);
    try {
      // Limpeza atômica ANTES da rede: garante que, mesmo se a API falhar,
      // o localStorage não bloqueia a criação de novo treino.
      localStorage.removeItem('activeTrainingGroup');
      localStorage.removeItem(`training_hole_${groupId}`);

      // Drena qualquer timer pendente antes de finalizar
      const pending = Object.entries(saveTimers.current);
      await Promise.all(pending.map(([key]) => {
        clearTimeout(saveTimers.current[key]);
        const [uid, hNum] = key.split('-');
        const s = scores[key];
        delete saveTimers.current[key];
        return s > 0
          ? api.post('/training/score', {
              group_id: Number(groupId), user_id: Number(uid),
              hole_number: Number(hNum), strokes: s,
            }).catch(() => {})
          : Promise.resolve();
      }));

      const loggedUser = JSON.parse(localStorage.getItem('user') || 'null');
      try { await api.post('/training/finish', { group_id: Number(groupId), creator_id: loggedUser?.id }); } catch {}

      setShowSummary(false);
      setGroupStatus('finalizado');
    } finally {
      isFinishingRef.current = false;
      setIsFinishing(false);
    }
  };

  // ── Estilos compartilhados ──
  const st = {
    page:       { padding: '15px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, fontFamily: "'Segoe UI', Roboto, sans-serif", textAlign: 'center' },
    holeNav:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.card, padding: '15px', borderRadius: '10px', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' },
    navBtn:     { backgroundColor: theme.cardLight, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '5px', fontSize: '20px', cursor: 'pointer' },
    playerCard: { backgroundColor: theme.card, padding: '15px', borderRadius: '10px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${theme.cardLight}` },
    scoreBtn:   { width: '45px', height: '45px', borderRadius: '50%', border: 'none', fontSize: '24px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    finishBtn:  { width: '100%', padding: '15px', backgroundColor: 'transparent', color: '#fff', fontSize: '17px', fontWeight: 'bold', border: `2px solid ${accent}`, borderRadius: '10px', cursor: 'pointer', marginTop: '30px', marginBottom: '20px' },
    btnBack:    { backgroundColor: 'transparent', color: theme.gold, border: `1px solid ${theme.gold}`, padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' },
  };

  if (!groupId) return null;

  if (isLoading) return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: theme.textMuted, fontSize: '14px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>Carregando treino...</div>
    </div>
  );

  if (fetchError) return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '20px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ color: theme.textMuted, fontSize: '14px', textAlign: 'center' }}>Falha ao conectar com o servidor.</div>
      <button
        onClick={fetchData}
        style={{ backgroundColor: accent, color: '#000', border: 'none', padding: '12px 28px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}
      >
        Tentar novamente
      </button>
      <button
        onClick={() => navigate('/daily-training')}
        style={{ backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, padding: '10px 24px', borderRadius: '10px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer' }}
      >
        Voltar ao Treino
      </button>
    </div>
  );

  if (!group) return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: theme.textMuted, fontSize: '14px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>Carregando treino...</div>
    </div>
  );

  // ══════════════════════════════════════════════════
  // FASE 1: SALA DE ESPERA
  // ══════════════════════════════════════════════════
  if (groupStatus === 'aguardando') {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: '100vh', padding: '20px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
        <div style={{ maxWidth: '420px', margin: '0 auto' }}>

          <div style={{ marginBottom: '16px' }}>
            <button style={st.btnBack} onClick={() => navigate('/daily-training')}>⬅ VOLTAR</button>
          </div>

          <div style={{ backgroundColor: theme.card, borderRadius: '20px', padding: '28px 24px', border: `1px solid ${theme.cardLight}`, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '4px' }}>SALA DE ESPERA</div>
            <h2 style={{ color: '#fff', margin: '0 0 24px', fontSize: '20px' }}>{group.group_name || 'Treino'}</h2>

            {isCreator && (
              <div style={{ backgroundColor: theme.bg, borderRadius: '12px', padding: '20px 16px', marginBottom: '20px', border: `1px solid ${accent}55` }}>
                <div style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
                  Compartilhe com os atletas
                </div>
                <div style={{ fontSize: '42px', fontWeight: '900', color: theme.gold, letterSpacing: '12px', marginBottom: '14px' }}>
                  {group.access_code}
                </div>
                <button
                  onClick={() => navigator.clipboard?.writeText(group.access_code).catch(() => {})}
                  style={{ backgroundColor: 'transparent', border: `1px solid ${theme.gold}`, color: theme.gold, padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                >
                  📋 COPIAR CÓDIGO
                </button>
              </div>
            )}

            <div style={{ textAlign: 'left', marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
                Atletas na sala ({players.length}/4)
              </div>
              {players.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: theme.bg, borderRadius: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: accent, flexShrink: 0 }} />
                  <span style={{ fontSize: '15px', fontWeight: '600', color: theme.textMain }}>{p.name}</span>
                  {p.id === group.creator_id && (
                    <span style={{ fontSize: '10px', color: theme.gold, marginLeft: 'auto', fontWeight: 'bold' }}>CRIADOR</span>
                  )}
                </div>
              ))}
              {players.length === 0 && (
                <div style={{ color: theme.textMuted, fontSize: '13px', padding: '10px', textAlign: 'center' }}>Aguardando atletas...</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: accent, animation: 'pulse 1.5s infinite' }} />
                <span style={{ fontSize: '11px', color: theme.textMuted }}>Atualizando em tempo real...</span>
              </div>
            </div>

            {isCreator ? (
              <button
                onClick={handleStartTraining}
                style={{ width: '100%', padding: '18px', backgroundColor: accent, color: '#000', fontSize: '18px', fontWeight: '800', border: 'none', borderRadius: '12px', cursor: 'pointer', boxShadow: `0 8px 20px -4px ${accent}66`, marginBottom: '12px' }}
              >
                INICIAR TREINO
              </button>
            ) : (
              <div style={{ padding: '14px', backgroundColor: theme.cardLight, borderRadius: '10px', fontSize: '14px', color: theme.textMuted, marginBottom: '12px' }}>
                Aguardando o criador iniciar o treino...
              </div>
            )}

            {isCreator ? (
              <button onClick={handleCancel} style={{ width: '100%', padding: '12px', backgroundColor: 'transparent', color: theme.danger, border: `1px solid ${theme.danger}55`, borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                🗑 Cancelar Treino
              </button>
            ) : (
              <button onClick={handleLeave} style={{ width: '100%', padding: '12px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                ← Sair do Grupo
              </button>
            )}
          </div>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>
      </div>
    );
  }

  // ══════════════════════════════════════════════════
  // FASE 3: RESULTADO FINAL
  // ══════════════════════════════════════════════════
  if (groupStatus === 'finalizado') {
    const renderNine = (playerId, from, to) => (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '3px', marginBottom: '8px' }}>
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(num => {
          const hd = holesData.find(h => (h.hole_number || h.hole) === num) || { par: 4 };
          const s  = scores[`${playerId}-${num}`];
          const { bg, color, border } = holeBoxStyle(s, hd.par);
          return (
            <div key={num} style={{ backgroundColor: bg, border: `1px solid ${border}`, borderRadius: '5px', padding: '4px 1px', textAlign: 'center' }}>
              <div style={{ fontSize: '8px',  color: theme.textMuted, fontWeight: 'bold' }}>B{num}</div>
              <div style={{ fontSize: '7px',  color: theme.textMuted }}>P{hd.par}</div>
              <div style={{ fontSize: '13px', fontWeight: '900', color }}>{s || '-'}</div>
            </div>
          );
        })}
      </div>
    );

    return (
      <div style={{ ...st.page, textAlign: 'left' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '12px', borderBottom: `1px solid ${theme.cardLight}` }}>
            <button style={st.btnBack} onClick={() => navigate('/daily-training')}>⬅ VOLTAR</button>
            <button
              onClick={() => navigate('/training-leaderboard')}
              style={{ backgroundColor: theme.gold, color: '#000', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
            >
              🏆 Ranking
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: accent, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.5px' }}>✅ TREINO FINALIZADO</span>
          </div>
          <h2 style={{ color: '#fff', margin: '0 0 20px', fontSize: '20px', fontWeight: '800' }}>{group.group_name}</h2>

          {players.map(p => {
            const { gross, vsPar } = calculateTotal(p.id);
            const isOpen   = expandedPlayer === p.id;
            const isNeg    = vsPar.toString().startsWith('-');
            const parColor = isNeg ? '#4ade80' : vsPar === 'E' ? theme.textMuted : theme.danger;

            return (
              <div key={p.id} style={{ backgroundColor: theme.card, borderRadius: '14px', marginBottom: '12px', border: `1px solid ${theme.cardLight}`, overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedPlayer(isOpen ? null : p.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold', color: theme.textMain, fontSize: '15px' }}>{p.name}</div>
                    <div style={{ fontSize: '11px', color: theme.textMuted, marginTop: '2px' }}>{isOpen ? '▲' : '▼'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '800', fontSize: '22px', color: '#fff' }}>{gross || '—'}</div>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: parColor }}>{vsPar}</div>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: '0 12px 14px', borderTop: `1px solid ${theme.cardLight}`, paddingTop: '12px' }}>
                    <div style={{ fontSize: '9px', color: theme.textMuted, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>IDA — FRONT 9</div>
                    {renderNine(p.id, 1, 9)}
                    <div style={{ fontSize: '9px', color: theme.textMuted, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>VOLTA — BACK 9</div>
                    {renderNine(p.id, 10, 18)}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '8px', borderTop: `1px solid ${theme.cardLight}` }}>
                      {[
                        { color: '#eab308', label: 'Eagle / HiO' },
                        { color: '#4ade80', label: 'Birdie' },
                        { color: '#cbd5e1', label: 'Par' },
                        { color: '#ef4444', label: 'Bogey+' },
                      ].map(({ color, label }) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: color, flexShrink: 0 }} />
                          <span style={{ fontSize: '9px', color: theme.textMuted }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={() => navigate('/training-leaderboard')}
            style={{ width: '100%', padding: '16px', backgroundColor: theme.gold, color: '#000', fontSize: '16px', fontWeight: '900', border: 'none', borderRadius: '12px', cursor: 'pointer', marginTop: '8px', boxShadow: `0 6px 20px -4px ${theme.gold}55` }}
          >
            🏆 Ver Ranking do Dia
          </button>
          <div style={{ height: '40px' }} />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════
  // FASE 2: SCORECARD ATIVO + MODAL DE CONFERÊNCIA
  // ══════════════════════════════════════════════════
  return (
    <div style={st.page}>

      {/* Modal de Conferência */}
      {showSummary && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,23,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ backgroundColor: theme.card, borderRadius: '20px', padding: '28px 24px', width: '100%', maxWidth: '420px', border: `1px solid ${theme.cardLight}`, boxShadow: '0 20px 60px rgba(0,0,0,0.8)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '10px', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '2px', textAlign: 'center', marginBottom: '4px' }}>CONFERÊNCIA DE PONTOS</div>
            <h2 style={{ color: theme.gold, textAlign: 'center', margin: '0 0 24px', fontSize: '20px' }}>Resumo do Treino</h2>

            {players.map(p => {
              const { gross, vsPar } = calculateTotal(p.id);
              const isNeg    = vsPar.toString().startsWith('-');
              const parColor = isNeg ? '#4ade80' : vsPar === 'E' ? theme.textMuted : theme.danger;
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.cardLight}`, padding: '14px 0' }}>
                  <div style={{ fontWeight: 'bold', color: theme.textMain, fontSize: '15px' }}>{p.name}</div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '22px', color: '#fff' }}>{gross || '—'}</div>
                    <div style={{ fontSize: '11px', color: theme.textMuted }}>tacadas</div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: parColor }}>{vsPar}</div>
                  </div>
                </div>
              );
            })}

            {isCreator && (
              <button
                disabled={isFinishing}
                style={{ width: '100%', padding: '16px', backgroundColor: isFinishing ? theme.cardLight : accent, color: isFinishing ? theme.textMuted : '#000', fontSize: '16px', fontWeight: '900', border: 'none', borderRadius: '12px', cursor: isFinishing ? 'not-allowed' : 'pointer', marginTop: '24px', boxShadow: isFinishing ? 'none' : `0 6px 20px -4px ${accent}55`, transition: 'all 0.2s' }}
                onClick={handleFinish}
              >
                {isFinishing ? 'Finalizando...' : '✅ Confirmar e Encerrar Partida'}
              </button>
            )}
            <button
              style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, fontSize: '14px', fontWeight: 'bold', borderRadius: '10px', cursor: 'pointer', marginTop: '10px' }}
              onClick={() => { setShowSummary(false); setIsReviewMode(true); }}
            >
              ✏️ Voltar e Editar
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: `1px solid ${theme.cardLight}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button style={st.btnBack} onClick={() => navigate('/daily-training')}>⬅</button>
          <div style={{ textAlign: 'left' }}>
            <small style={{ color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '1px', fontSize: '10px' }}>TREINO DO DIA</small>
            <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '15px', marginTop: '2px' }}>{group.group_name || 'Treino'}</div>
            {!isCreator && <small style={{ color: theme.textMuted, fontSize: '10px' }}>👁 Modo Visualização</small>}
          </div>
        </div>
        <button
          onClick={() => navigate('/training-leaderboard')}
          style={{ backgroundColor: theme.gold, color: '#000', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px', boxShadow: '0 2px 5px rgba(0,0,0,0.5)' }}
        >
          🏆 Ranking
        </button>
      </div>

      {/* Navegação de buracos */}
      <div style={st.holeNav}>
        <button style={st.navBtn} onClick={() => changeHole(-1)}>◀</button>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: theme.gold }}>Buraco {currentHole}</div>
          <div style={{ color: theme.textMuted, fontSize: '16px', marginTop: '5px' }}>PAR {currentHoleData.par}</div>
        </div>
        <button style={st.navBtn} onClick={() => changeHole(1)}>▶</button>
      </div>

      {/* Cards dos atletas */}
      <div>
        {players.map(p => {
          const score      = scores[`${p.id}-${currentHole}`];
          const par        = currentHoleData.par || 4;
          const scoreColor = getScoreColor(score, par, theme.cardLight, theme.gold, theme.danger);

          return (
            <div key={p.id} style={st.playerCard}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold' }}>{p.name}</div>
              </div>

              {isCreator ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <button style={{ ...st.scoreBtn, backgroundColor: theme.danger, color: '#fff' }} onClick={() => handleScoreChange(p.id, -1)}>-</button>
                  <span style={{ fontSize: '26px', fontWeight: 'bold', minWidth: '35px', textAlign: 'center', color: scoreColor }}>
                    {score || '0'}
                  </span>
                  <button style={{ ...st.scoreBtn, backgroundColor: accent, color: '#fff' }} onClick={() => handleScoreChange(p.id, 1)}>+</button>
                </div>
              ) : (
                <span style={{ fontSize: '26px', fontWeight: 'bold', minWidth: '35px', textAlign: 'center', color: scoreColor }}>
                  {score || '-'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isCreator && (
        <button style={st.finishBtn} onClick={() => setShowSummary(true)}>
          📋 Finalizar Treino
        </button>
      )}
    </div>
  );
}

export default TrainingScorecard;
