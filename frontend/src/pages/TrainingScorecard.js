import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import syncService from '../services/syncService';
import { getIncompleteEntries, formatIncompleteSummary } from '../utils/scoreCompleteness';
import { getUser } from '../services/authStorage';
import { socket } from '../services/socket';
import { useClub } from '../context/ClubContext';
import { LuArrowLeft, LuTrophy, LuCopy, LuTrash2, LuLogOut, LuCircleCheck, LuCheck, LuPencil, LuEye, LuClipboardList, LuShare2 } from 'react-icons/lu';
import HolePhotoBadge from '../components/HolePhotoBadge';
import HoleDistanceBadge from '../components/HoleDistanceBadge';
import TeeSuggestionChip from '../components/TeeSuggestionChip';

const getScoreColor = (strokes, par, cardLight, gold, danger) => {
  const s = Number(strokes), p = Number(par) || 4;
  if (!s) return cardLight;
  const diff = s - p;
  if (s === 1 || diff <= -2) return gold;
  if (diff === -1)            return '#4ade80';
  if (diff === 0)             return '#cbd5e1';
  return danger;
};

const holeBoxStyle = (strokes, par) => {
  const s = Number(strokes), p = Number(par) || 4;
  if (!s) return { bg: 'rgba(51,65,85,0.5)', color: '#64748b', border: '#334155' };
  const diff = s - p;
  if (s === 1 || diff <= -2) return { bg: 'rgba(234,179,8,0.18)',   color: '#eab308', border: '#eab308' };
  if (diff === -1)            return { bg: 'rgba(74,222,128,0.15)',  color: '#4ade80', border: '#4ade80' };
  if (diff === 0)             return { bg: 'rgba(203,213,225,0.07)', color: '#cbd5e1', border: '#475569' };
  return                             { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', border: '#ef4444' };
};

function TrainingScorecard() {
  const { groupId: routeGroupId } = useParams();
  const navigate                  = useNavigate();
  const location                  = useLocation();
  const { club }                  = useClub();

  const returnHole = location.state?.returnHole || null;

  // F5 preserva a URL, mas se por algum motivo o parâmetro faltar, lê do localStorage.
  // Só navega para /daily-training se realmente não houver ID de lugar nenhum.
  const groupId = routeGroupId
    || JSON.parse(localStorage.getItem('activeTrainingGroup') || 'null')?.id?.toString()
    || null;

  const sessionKey = groupId ? `birdify_viewed_hole_${groupId}` : null;

  const [group, setGroup]               = useState(null);
  const [players, setPlayers]           = useState([]);
  const [groupStatus, setGroupStatus]   = useState('aguardando');
  const [holesData, setHolesData]       = useState([]);
  const [slotMap, setSlotMap]           = useState({ white: null, yellow: null, blue: null, red: null });
  const [currentHole, setCurrentHole]   = useState(() => {
    if (!sessionKey) return 1;
    const stored = parseInt(sessionStorage.getItem(sessionKey), 10);
    return (stored >= 1 && stored <= 18) ? stored : 1;
  });
  const [scores, setScores]             = useState({});
  const [playedHoles, setPlayedHoles]   = useState([1]);
  const [showSummary, setShowSummary]   = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [isCreator, setIsCreator]       = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  const [fetchError, setFetchError]   = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Handicaps declarados antes de iniciar (mesmo modelo do torneio):
  // o criador preenche o HC de cada atleta; alimenta NET e categorias do ranking.
  const [showHcModal, setShowHcModal] = useState(false);
  const [hcValues, setHcValues] = useState({});
  const [hcSaving, setHcSaving] = useState(false);
  const [teeRules, setTeeRules] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ online: true, pending: 0, syncing: false });

  // Timers de debounce por chave "userId-holeNumber"
  const saveTimers         = useRef({});
  // Ref estável para fetchData (evita stale closure nos listeners de socket)
  const fetchDataRef       = useRef(null);
  // Previne duplo clique no botão Finalizar
  const isFinishingRef     = useRef(false);
  // Espelho do groupStatus para uso dentro de closures de socket (sem stale closure)
  const groupStatusRef     = useRef('aguardando');
  // Garante que currentHole é calculado apenas na montagem inicial — não reage a fetchData subsequentes
  const holeInitializedRef = useRef(false);
  // Lock unificado: bloqueia +/- E ◀/▶ durante a transição de buraco (mesmo que
  // seja sync agora, cobre eventual re-entrada). useRef (não useState) porque a
  // mudança precisa ser síncrona — batching poderia deixar dois cliques do mesmo
  // tick passarem, abrindo janela pra gravar no buraco errado.
  const busyRef            = useRef(false);
  // Timestamp local do último toque por "userId-holeNumber". Usado pra descartar
  // broadcasts de socket obsoletos: se o servidor emitir um score_saved cujo
  // savedAt é anterior ao último toque local dessa chave, o valor local é mais
  // recente e o broadcast é ignorado (senão o valor "pisca" pra trás).
  const lastLocalTouchAt   = useRef({});

  const accent = club?.primary_color || '#22c55e';
  const theme  = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent,
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444',
  };

  // Redireciona se não houver groupId de forma alguma (efeito — não pode ser síncrono no render)
  useEffect(() => {
    if (!groupId) navigate('/daily-training', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hidratação do scorecard a partir do banco ──
  // Scores e holesData são sempre atualizados. currentHole só é calculado na montagem inicial
  // (holeInitializedRef) para não reagir a fetchData subsequentes disparados por socket.
  const loadScorecardData = useCallback(async (savedGroup, allPlayers, scoresRaw) => {
    // Sempre atualiza holesData e scores (fontes de verdade contínuas)
    if (savedGroup.course_id) {
      const [holesRes, mapRes] = await Promise.all([
        api.get(`/courses/${savedGroup.course_id}/holes`),
        api.get(`/courses/${savedGroup.course_id}/yard-slot-map`).catch(() => ({ data: null })),
      ]);
      setHolesData(holesRes.data);
      if (mapRes.data) setSlotMap(mapRes.data);
    }

    const scoresMap = {};
    scoresRaw.forEach(s => { scoresMap[`${s.user_id}-${s.hole_number}`] = s.strokes; });
    // Overlay offline-first: itens da fila do syncService ainda não confirmados pelo
    // servidor (pending/syncing/failed) sobrepõem o que veio do GET. Sem isso, um
    // refetch (socket, F5, join de outro atleta) apagava scores marcados offline —
    // era o cerne do bug de perda de dados relatado em uso real.
    const pendingOverlay = {};
    syncService.getPendingItems(item =>
      item.endpoint === '/training/score'
      && Number(item.payload?.group_id) === Number(savedGroup.id)
    ).forEach(item => {
      const p = item.payload;
      pendingOverlay[`${p.user_id}-${p.hole_number}`] = p.strokes;
    });
    // prev vem por último pra preservar cliques ainda no debounce (só criador marca,
    // então prev == versão local mais fresca; nunca há dado stale de outro autor).
    setScores(prev => ({ ...scoresMap, ...pendingOverlay, ...prev }));

    // Guard: currentHole e playedHoles só são definidos uma vez por montagem
    if (holeInitializedRef.current) return;

    const startHole = savedGroup.starting_hole || 1;

    const buildHistory = (from, to) => {
      const h = [];
      if (from <= to) { for (let i = from; i <= to; i++) h.push(i); }
      else { for (let i = from; i <= 18; i++) h.push(i); for (let i = 1; i <= to; i++) h.push(i); }
      return h;
    };

    const maxHoleWithScore = scoresRaw.reduce(
      (max, s) => (Number(s.strokes) > 0 ? Math.max(max, Number(s.hole_number)) : max),
      0
    );
    const fallbackNext = maxHoleWithScore > 0 ? Math.min(maxHoleWithScore + 1, 18) : startHole;

    // Prioridade 1: returnHole — voltando do Leaderboard com buraco exato
    if (returnHole >= 1 && returnHole <= 18) {
      holeInitializedRef.current = true;
      sessionStorage.setItem(sessionKey, returnHole);
      setPlayedHoles(buildHistory(startHole, Math.max(returnHole, fallbackNext)));
      setCurrentHole(returnHole);
      return;
    }

    // Prioridade 2: sessionHole — F5 mantém exatamente onde o usuário estava
    const sessionHole = parseInt(sessionStorage.getItem(sessionKey), 10);
    if (sessionHole >= 1 && sessionHole <= 18) {
      holeInitializedRef.current = true;
      setPlayedHoles(buildHistory(startHole, Math.max(sessionHole, fallbackNext)));
      setCurrentHole(sessionHole);
      return;
    }

    // Prioridade 3: fallback — primeira abertura sem sessionStorage válido.
    // Guard sempre travado: currentHole já está correto via useState lazy.
    // Scores continuam chegando via socket (setScores acima do guard) independentemente.
    // Quando maxHoleWithScore === 0, fallbackNext === startHole — comportamento idêntico ao anterior.
    holeInitializedRef.current = true;
    sessionStorage.setItem(sessionKey, fallbackNext);
    setPlayedHoles(buildHistory(startHole, fallbackNext));
    setCurrentHole(fallbackNext);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const fetchData = useCallback(async () => {
    try {
      const [groupData, scoresData] = await Promise.all([
        api.get(`/training/group/${groupId}`),
        api.get(`/training/scores/${groupId}`),
      ]);

      // Grupo não encontrado (deletado ou expirado): limpa cache zombie e retorna ao lobby.
      // Erro de rede real cai no catch e mostra tela de retry.
      if (!groupData.data?.id) {
        localStorage.removeItem('activeTrainingGroup');
        localStorage.removeItem(`training_hole_${groupId}`);
        navigate('/daily-training', { replace: true });
        return;
      }

      setFetchError(false);

      const status = groupData.data.status || 'aguardando';

      let savedGroup = JSON.parse(localStorage.getItem('activeTrainingGroup') || 'null');
      if (!savedGroup || savedGroup.id !== Number(groupId)) {
        savedGroup = {
          id:            groupData.data.id,
          creator_id:    groupData.data.creator_id,
          course_id:     groupData.data.course_id,
          group_name:    groupData.data.group_name,
          access_code:   groupData.data.access_code,
          starting_hole: groupData.data.starting_hole || 1,
          status,
        };
        localStorage.setItem('activeTrainingGroup', JSON.stringify(savedGroup));
      } else if (savedGroup.status !== status) {
        savedGroup = { ...savedGroup, status };
        localStorage.setItem('activeTrainingGroup', JSON.stringify(savedGroup));
      }

      const loggedUser = getUser();
      setIsCreator(!!(loggedUser && loggedUser.id === savedGroup.creator_id));
      setGroup(savedGroup);

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
 }, [groupId, navigate, loadScorecardData]);

  // Mantém refs sempre atualizadas para uso dentro de listeners de socket
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);
  useEffect(() => { groupStatusRef.current = groupStatus; }, [groupStatus]);

  // Carga inicial
  useEffect(() => { fetchData(); }, [fetchData]);

  // Regras de tee do campo (alimentam o chip de sugestão no modal de handicaps).
  // Falha silenciosa NA UI (sem regras = feature simplesmente não aparece), mas
  // console.warn pra rastrear erro real de rede/500 se algo quebrar em prod.
  useEffect(() => {
    const courseId = group?.course_id;
    if (!courseId) return;
    let cancelled = false;
    api.get(`/courses/${courseId}/tee-rules`)
      .then(res => { if (!cancelled) setTeeRules(res.data?.rules || []); })
      .catch(err => {
        if (cancelled) return;
        console.warn('[tee-rules] falha ao carregar regras do campo:', err?.response?.status, err?.message);
        setTeeRules([]);
      });
    return () => { cancelled = true; };
  }, [group?.course_id]);

  // ── Socket.io: tempo real ──
  useEffect(() => {
    let active = true;

    // Só conecta se ainda não está conectado — evita dupla tentativa no StrictMode
    if (!socket.connected) socket.connect();
    socket.emit('join:training', groupId);

    const onConnect = () => {
      if (active) socket.emit('join:training', groupId);
    };

    const onScoreSaved = ({ user_id, hole_number, strokes, savedAt }) => {
      if (!active) return;
      const key = `${user_id}-${hole_number}`;
      // Se o toque local nesta mesma chave é mais recente que o broadcast, o
      // evento chegou fora de ordem (segundo POST respondeu antes do primeiro
      // via websocket, ou eco atrasado depois de novo clique). Ignora — o
      // próximo save vai emitir um broadcast mais novo que carrega o valor certo.
      const localTouch = lastLocalTouchAt.current[key] || 0;
      if (savedAt && localTouch && savedAt < localTouch) {
        return;
      }
      setScores(prev => ({ ...prev, [key]: strokes }));
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
      // Ao sair do scorecard, dispara os timers pendentes → enqueue (a fila do
      // syncService persiste em localStorage e é drenada ao voltar/reconectar).
      Object.entries(saveTimers.current).forEach(([key, timerId]) => {
        clearTimeout(timerId);
        const [uid, hNum] = key.split('-');
        const s = scores[key];
        if (s > 0) enqueueScore(uid, hNum, s);
      });
      saveTimers.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Inscreve no syncService pra alimentar o pill "Aguardando Conexão"
  useEffect(() => {
    syncService.bootstrap();
    return syncService.subscribe(setSyncStatus);
  }, []);

  // ── Ações do Lobby ──
  // Passo 1: INICIAR TREINO abre o modal de handicaps com os atletas da sala
  const openHandicapModal = () => {
    if (!isCreator) return;
    const initial = {};
    players.forEach(p => {
      initial[p.id] = p.handicap > 0 ? String(p.handicap) : '';
    });
    setHcValues(initial);
    setShowHcModal(true);
  };

  // Passo 2: confirma handicaps -> salva -> inicia o treino
  const handleStartTraining = async () => {
    if (!isCreator || hcSaving) return;

    for (const p of players) {
      const v = hcValues[p.id];
      if (v === '' || v === undefined || isNaN(parseFloat(v))) {
        alert(`Por favor, insira o handicap de ${p.name}`);
        return;
      }
    }

    setHcSaving(true);
    try {
      await api.post('/training/save-handicaps', {
        group_id: Number(groupId),
        players_data: players.map(p => ({ user_id: p.id, handicap: parseFloat(hcValues[p.id]) })),
      });
      await api.post('/training/start', { group_id: Number(groupId) });
      setShowHcModal(false);
      setGroupStatus('ativo');
      // onStarted socket listener calls fetchData — não duplicar aqui para evitar race condition
    } catch (err) {
      alert(err.response?.data?.error || err.response?.data?.message || 'Erro ao iniciar treino.');
    } finally {
      setHcSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!isCreator) return;
    if (!window.confirm('Cancelar o treino? Todos os atletas serão removidos da sala.')) return;
    try {
      const loggedUser = getUser();
      await api.post('/training/cancel', { group_id: Number(groupId), creator_id: loggedUser?.id });
      localStorage.removeItem('activeTrainingGroup');
      localStorage.removeItem(`training_hole_${groupId}`);
      sessionStorage.removeItem(sessionKey);
      navigate('/daily-training', { replace: true });
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao cancelar treino.');
    }
  };

  const handleLeave = async () => {
    if (isCreator) return;
    if (!window.confirm('Sair do grupo?')) return;
    try {
      const loggedUser = getUser();
      await api.post('/training/leave', { group_id: Number(groupId), user_id: loggedUser?.id });
      localStorage.removeItem('activeTrainingGroup');
      localStorage.removeItem(`training_hole_${groupId}`);
      sessionStorage.removeItem(sessionKey);
      navigate('/daily-training', { replace: true });
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao sair do grupo.');
    }
  };

  // ── Scorecard ativo ──
  const currentHoleData = holesData.find(
    h => Number(h.hole_number) === Number(currentHole) || Number(h.hole) === Number(currentHole)
  ) || { par: 4 };

  // Enfileira o score no syncService — fila persistente em localStorage. Se offline,
  // fica em PENDING e é reenviado ao voltar. `dedupKey` garante que múltiplos cliques
  // no mesmo (group, user, hole) substituam pendências em vez de empilhar duplicatas.
  const enqueueScore = (userId, hole, strokes) => {
    syncService.enqueue({
      endpoint: '/training/score',
      payload: {
        group_id:    Number(groupId),
        user_id:     Number(userId),
        hole_number: Number(hole),
        strokes:     Number(strokes),
      },
      dedupKey: `training:${groupId}:${userId}:${hole}`,
    });
  };

  // Persistência atômica: cada clique → debounce 400ms → enqueue offline-first.
  // `hole` vem EXPLÍCITO do onClick — é o buraco que o usuário viu na tela no
  // momento do toque, não o state React (que pode ter avançado). Se o state já
  // divergiu OU o busyRef está ativo, o clique é descartado com log.
  const handleScoreChange = (userId, delta, hole) => {
    if (!isCreator) return;
    if (busyRef.current) return;
    if (Number(hole) !== Number(currentHole)) {
      console.warn('[TrainingScorecard] Clique descartado — hole visual difere do state.', {
        holeClicked: hole, currentHole, userId, delta,
      });
      return;
    }
    const key = `${userId}-${hole}`;
    const cur = parseInt(scores[key]) || 0;
    let next  = cur + delta;
    if (cur === 0 && delta > 0) next = currentHoleData.par || 4;
    if (next < 1) { if (delta < 0) return; next = 1; }

    lastLocalTouchAt.current[key] = Date.now();
    setScores(prev => ({ ...prev, [key]: next }));

    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      enqueueScore(userId, hole, next);
      delete saveTimers.current[key];
    }, 400);
  };

  // Drena timers pendentes de debounce imediatamente pro syncService (sync, não bloqueia).
  // Usado ao trocar de buraco ou navegar pra fora — garante que cliques ainda no debounce
  // virem enqueues antes de perder o timer. Depois disso a fila cuida da entrega.
  const flushPendingTimersForHole = (hole) => {
    players.forEach(p => {
      const key = `${p.id}-${hole}`;
      if (saveTimers.current[key]) {
        clearTimeout(saveTimers.current[key]);
        const s = scores[key];
        delete saveTimers.current[key];
        if (s > 0) enqueueScore(p.id, hole, s);
      }
    });
  };

  const flushAllPendingTimers = () => {
    Object.entries(saveTimers.current).forEach(([key, timerId]) => {
      clearTimeout(timerId);
      const [uid, hNum] = key.split('-');
      const s = scores[key];
      delete saveTimers.current[key];
      if (s > 0) enqueueScore(uid, hNum, s);
    });
  };

  // Avança ou recua o buraco. Como o syncService cuida da entrega offline-first,
  // não bloqueamos por espera de servidor — só drenamos timers de debounce pra
  // que cliques pendentes virem enqueues antes da transição.
  const changeHole = (delta) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const holeBeforeChange = currentHole;
    try {
      if (delta > 0) {
        const missing = players.find(p => !(scores[`${p.id}-${holeBeforeChange}`] > 0));
        if (missing) { alert(`Falta anotar o score de: ${missing.name}`); return; }
        flushPendingTimersForHole(holeBeforeChange);
        if (!isReviewMode && playedHoles.length >= 18) { setShowSummary(true); return; }
        let next = holeBeforeChange + 1; if (next > 18) next = 1;
        if (!playedHoles.includes(next)) setPlayedHoles(prev => [...prev, next]);
        sessionStorage.setItem(sessionKey, next);
        setCurrentHole(next);
      } else if (delta < 0) {
        let prev = holeBeforeChange - 1; if (prev < 1) prev = 18;
        if (!playedHoles.includes(prev)) { alert('Você não pode voltar antes do tee de saída.'); return; }
        sessionStorage.setItem(sessionKey, prev);
        setCurrentHole(prev);
      }
    } finally {
      busyRef.current = false;
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

  // Bug B — 2026-08-13: validação de completude antes de finalizar.
  // Deriva expectedHoles de holesData.length (não hardcoded 18) — suporta
  // treino/torneio de 9 buracos quando existirem.
  const expectedHoles = holesData.length > 0 ? holesData.length : 18;
  const incompleteEntries = getIncompleteEntries(players, scores, expectedHoles);

  const handleFinish = async () => {
    if (!isCreator || isFinishingRef.current) return;
    if (!navigator.onLine) { alert('Aguarde a conexão voltar para finalizar o treino.'); return; }

    // Validação client-side de completude — feedback imediato sem hit backend
    if (incompleteEntries.length > 0) {
      alert(`Cartão incompleto — não pode ser finalizado.\n\n${formatIncompleteSummary(incompleteEntries)}`);
      return;
    }

    isFinishingRef.current = true;
    setIsFinishing(true);
    try {
      // Drena timers de debounce → enqueue. Depois força um flush e reverifica: se
      // ainda sobrou pendência (rede caiu no meio), aborta pra não finalizar sem
      // ter certeza que todos os scores chegaram ao servidor.
      flushAllPendingTimers();
      await syncService.flush();
      const finalStatus = syncService.getStatus();
      if (finalStatus.pending > 0 || finalStatus.syncing) {
        alert(`Ainda há ${finalStatus.pending || 1} tacada(s) sincronizando. Aguarde o indicador zerar antes de finalizar.`);
        return;
      }

      const loggedUser = getUser();
      try {
        await api.post('/training/finish', { group_id: Number(groupId), creator_id: loggedUser?.id });
      } catch (err) {
        // Backend detectou incompletude (defense-in-depth): mostra o que faltou
        const data = err.response?.data;
        if (err.response?.status === 400 && Array.isArray(data?.missing) && data.missing.length > 0) {
          alert(`Cartão incompleto (checado no servidor):\n\n${formatIncompleteSummary(data.missing)}`);
          return;
        }
        throw err;
      }

      // Limpa localStorage e sessionStorage APÓS o backend confirmar o encerramento
      localStorage.removeItem('activeTrainingGroup');
      localStorage.removeItem(`training_hole_${groupId}`);
      sessionStorage.removeItem(sessionKey);
      setShowSummary(false);
      setGroupStatus('finalizado');
    } catch {
      alert('Falha ao encerrar o treino. Verifique a conexão e tente novamente.');
    } finally {
      isFinishingRef.current = false;
      setIsFinishing(false);
    }
  };

  // ── Estilos compartilhados ──
  const st = {
    page:       { padding: '15px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, textAlign: 'center' },
    holeNav:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.card, padding: '15px', borderRadius: '10px', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' },
    navBtn:     { backgroundColor: theme.cardLight, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '5px', fontSize: '20px', cursor: 'pointer' },
    playerCard: { backgroundColor: theme.card, padding: '15px', borderRadius: '10px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${theme.cardLight}` },
    scoreBtn:   { width: '45px', height: '45px', borderRadius: '50%', border: 'none', fontSize: '24px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    finishBtn:  { width: '100%', padding: '15px', backgroundColor: 'transparent', color: '#fff', fontSize: '17px', fontWeight: 'bold', border: `2px solid ${accent}`, borderRadius: '10px', cursor: 'pointer', marginTop: '30px', marginBottom: '20px' },
    btnBack:    { backgroundColor: 'transparent', color: theme.textMuted, border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
  };

  if (!groupId) return null;

  if (isLoading) return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: theme.textMuted, fontSize: '14px' }}>Carregando treino...</div>
    </div>
  );

  if (fetchError) return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '20px' }}>
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
      <div style={{ color: theme.textMuted, fontSize: '14px' }}>Carregando treino...</div>
    </div>
  );

  // ══════════════════════════════════════════════════
  // FASE 1: SALA DE ESPERA
  // ══════════════════════════════════════════════════
  if (groupStatus === 'aguardando') {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '420px', margin: '0 auto' }}>

          <div style={{ marginBottom: '16px' }}>
            <button style={st.btnBack} onClick={() => navigate('/daily-training')}><LuArrowLeft size={15} /> VOLTAR</button>
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
                  <LuCopy size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                  COPIAR CÓDIGO
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
                onClick={openHandicapModal}
                style={{ width: '100%', padding: '18px', backgroundColor: accent, color: '#000', fontSize: '18px', fontWeight: '800', border: 'none', borderRadius: '8px', cursor: 'pointer', marginBottom: '12px' }}
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
                <LuTrash2 size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                Cancelar Treino
              </button>
            ) : (
              <button onClick={handleLeave} style={{ width: '100%', padding: '12px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                <LuLogOut size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                Sair do Grupo
              </button>
            )}
          </div>
        </div>

        {/* Modal: handicaps antes de iniciar (criador) */}
        {showHcModal && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2,6,23,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div style={{ backgroundColor: theme.card, borderRadius: '12px', padding: '28px 24px', width: '100%', maxWidth: '420px', border: `1px solid ${theme.cardLight}`, boxShadow: '0 20px 60px rgba(0,0,0,0.8)', maxHeight: '90vh', overflowY: 'auto' }}>
              <h2 style={{ color: accent, margin: 0, textAlign: 'center', fontSize: '20px', fontWeight: '800' }}>HANDICAPS</h2>
              <p style={{ color: theme.textMuted, fontSize: '14px', textAlign: 'center', margin: '8px 0 20px' }}>
                Insira o handicap de cada atleta para o <strong style={{ color: theme.textMain }}>Net Score</strong> e as categorias do ranking.
              </p>

              {players.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: `1px solid ${theme.cardLight}` }}>
                  <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: theme.textMain }}>{p.name}</div>
                    <div style={{ fontSize: '12px', color: theme.textMuted }}>
                      {p.gender === 'M' || p.gender === 'Masculino' ? 'Masculino' : 'Feminino'}
                    </div>
                    <TeeSuggestionChip
                      handicap={hcValues[p.id]}
                      gender={p.gender}
                      rules={teeRules}
                    />
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="54"
                    placeholder="0.0"
                    value={hcValues[p.id] ?? ''}
                    onChange={e => setHcValues(v => ({ ...v, [p.id]: e.target.value }))}
                    style={{ width: '90px', padding: '10px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: accent, textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}
                  />
                </div>
              ))}

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button
                  onClick={() => setShowHcModal(false)}
                  disabled={hcSaving}
                  style={{ flex: 1, padding: '14px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  VOLTAR
                </button>
                <button
                  onClick={handleStartTraining}
                  disabled={hcSaving}
                  style={{ flex: 2, padding: '14px', backgroundColor: hcSaving ? theme.cardLight : accent, color: hcSaving ? theme.textMuted : '#000', border: 'none', borderRadius: '8px', cursor: hcSaving ? 'wait' : 'pointer', fontWeight: '800' }}
                >
                  {hcSaving ? 'Iniciando...' : 'CONFIRMAR E INICIAR'}
                </button>
              </div>
            </div>
          </div>
        )}

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
            <button style={st.btnBack} onClick={() => navigate('/daily-training')}><LuArrowLeft size={15} /> VOLTAR</button>
            <button
              onClick={() => navigate('/training-leaderboard')}
              style={{ backgroundColor: theme.gold, color: '#000', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
            >
              <LuTrophy size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Ranking
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: accent, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.5px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <LuCircleCheck size={13} />
              TREINO FINALIZADO
            </span>
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
            style={{ width: '100%', padding: '16px', backgroundColor: theme.gold, color: '#000', fontSize: '16px', fontWeight: '900', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '8px' }}
          >
            <LuTrophy size={15} style={{ verticalAlign: 'text-bottom', marginRight: 8 }} />
            Ver Ranking do Dia
          </button>
          <button
            onClick={async () => {
              const url = `${window.location.origin}/treino/${groupId}/ranking`;
              const shareData = { title: 'Ranking do treino — Birdify', text: 'Acompanhe o ranking do meu treino em tempo real:', url };
              try {
                if (navigator.share) { await navigator.share(shareData); return; }
                await navigator.clipboard.writeText(url);
                alert('Link copiado! Cole em qualquer aplicativo pra compartilhar.');
              } catch (_) { /* usuário cancelou o share nativo — silêncio */ }
            }}
            style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: theme.textMain, fontSize: '14px', fontWeight: '700', border: `1px solid ${theme.cardLight}`, borderRadius: '8px', cursor: 'pointer', marginTop: '8px' }}
          >
            <LuShare2 size={14} style={{ verticalAlign: 'text-bottom', marginRight: 8 }} />
            Compartilhar link do ranking
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
      <style>{`@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>

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

            {isCreator && (() => {
              const hasPending = syncStatus.pending > 0 || syncStatus.syncing;
              const hasIncomplete = incompleteEntries.length > 0;
              const blocked = isFinishing || hasPending || hasIncomplete;
              return (
                <>
                  {hasIncomplete && (
                    <div style={{ marginTop: '18px', padding: '12px 14px', backgroundColor: 'rgba(239,68,68,0.10)', border: `1px solid ${theme.danger}55`, borderRadius: '8px', fontSize: '12px', color: theme.danger, textAlign: 'left' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '6px', textAlign: 'center' }}>
                        Cartão incompleto — faltam scores:
                      </div>
                      {incompleteEntries.map(m => (
                        <div key={m.user_id} style={{ marginTop: '3px' }}>
                          <strong>{m.name}:</strong> {m.missing_holes.length === 1 ? 'buraco' : 'buracos'} {m.missing_holes.join(', ')}
                        </div>
                      ))}
                    </div>
                  )}
                  {hasPending && !hasIncomplete && (
                    <div style={{ marginTop: '18px', padding: '10px 12px', backgroundColor: 'rgba(234,179,8,0.10)', border: `1px solid ${theme.gold}55`, borderRadius: '8px', fontSize: '12px', color: theme.gold, textAlign: 'center' }}>
                      {syncStatus.online
                        ? `Sincronizando ${syncStatus.pending} tacada(s) — aguarde o indicador zerar.`
                        : `${syncStatus.pending} tacada(s) sem envio — aguarde a conexão voltar.`}
                    </div>
                  )}
                  <button
                    disabled={blocked}
                    style={{ width: '100%', padding: '16px', backgroundColor: blocked ? theme.cardLight : accent, color: blocked ? theme.textMuted : '#000', fontSize: '16px', fontWeight: '900', border: 'none', borderRadius: '8px', cursor: blocked ? 'not-allowed' : 'pointer', marginTop: '12px', transition: 'all 0.2s' }}
                    onClick={handleFinish}
                  >
                    {isFinishing ? 'Finalizando...' : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <LuCheck size={16} />
                        Confirmar e Encerrar Partida
                      </span>
                    )}
                  </button>
                </>
              );
            })()}
            <button
              style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, fontSize: '14px', fontWeight: 'bold', borderRadius: '10px', cursor: 'pointer', marginTop: '10px' }}
              onClick={() => { setShowSummary(false); setIsReviewMode(true); }}
            >
              <LuPencil size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Voltar e Editar
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: `1px solid ${theme.cardLight}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button style={st.btnBack} onClick={() => { flushAllPendingTimers(); navigate('/daily-training'); }} aria-label="Voltar"><LuArrowLeft size={16} /></button>
          <div style={{ textAlign: 'left' }}>
            <small style={{ color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '1px', fontSize: '10px' }}>TREINO DO DIA</small>
            <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '15px', marginTop: '2px' }}>{group.group_name || 'Treino'}</div>
            {!isCreator && (
              <small style={{ color: theme.textMuted, fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <LuEye size={11} />
                Modo Visualização
              </small>
            )}
            {isCreator && (!syncStatus.online || syncStatus.pending > 0) && (
              <div
                title={syncStatus.online ? 'Sincronizando tacadas pendentes...' : 'Sem conexão — tacadas serão enviadas ao reconectar'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  marginTop: '4px', padding: '3px 8px', borderRadius: '12px',
                  fontSize: '11px', fontWeight: 'bold',
                  backgroundColor: syncStatus.online ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                  color: syncStatus.online ? theme.gold : theme.danger,
                  border: `1px solid ${syncStatus.online ? theme.gold : theme.danger}55`,
                }}
              >
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: syncStatus.online ? theme.gold : theme.danger,
                  animation: 'pulse 1.5s infinite',
                }} />
                {syncStatus.online
                  ? `Sincronizando${syncStatus.pending > 0 ? ` (${syncStatus.pending})` : ''}`
                  : `Aguardando Conexão${syncStatus.pending > 0 ? ` (${syncStatus.pending})` : ''}`}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => { flushAllPendingTimers(); navigate('/training-leaderboard', { state: { returnHole: currentHole, groupId } }); }}
          style={{ backgroundColor: theme.gold, color: '#000', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
        >
          <LuTrophy size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Ranking
        </button>
      </div>

      {/* Navegação de buracos */}
      <div style={st.holeNav}>
        <button
          style={st.navBtn}
          onClick={() => changeHole(-1)}
        >◀</button>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: theme.gold, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            Buraco {currentHole}
            <HolePhotoBadge imagePath={currentHoleData.image_path} holeNumber={currentHole} />
          </div>
          <div style={{ marginTop: 6, textAlign: 'center' }}>
            <span style={{ color: theme.textMuted, fontSize: '16px' }}>PAR {currentHoleData.par}</span>
          </div>
          <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center' }}>
            <HoleDistanceBadge hole={currentHoleData} slotMap={slotMap} />
          </div>
        </div>
        <button
          style={st.navBtn}
          onClick={() => changeHole(1)}
        >▶</button>
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
                  <button style={{ ...st.scoreBtn, backgroundColor: theme.danger, color: '#fff' }} onClick={() => handleScoreChange(p.id, -1, currentHole)}>-</button>
                  <span style={{ fontSize: '26px', fontWeight: 'bold', minWidth: '35px', textAlign: 'center', color: scoreColor }}>
                    {score || '0'}
                  </span>
                  <button style={{ ...st.scoreBtn, backgroundColor: accent, color: '#fff' }} onClick={() => handleScoreChange(p.id, 1, currentHole)}>+</button>
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
          <LuClipboardList size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Finalizar Treino
        </button>
      )}
    </div>
  );
}

export default TrainingScorecard;
