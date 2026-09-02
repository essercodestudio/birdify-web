// frontend/src/pages/Scorecard.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../services/api";
import syncService from "../services/syncService";
import { getIncompleteEntries, formatIncompleteSummary } from "../utils/scoreCompleteness";
import { useParams, useNavigate } from "react-router-dom";
import { LuClipboardList, LuCheck, LuPencil, LuTrophy } from "react-icons/lu";
import HolePhotoBadge from "../components/HolePhotoBadge";
import HoleDistanceBadge from "../components/HoleDistanceBadge";

// ─── Pontuação por Resultado (Onda A · commit 6 · 2026-08-31) ────────────────
// Bate 1:1 com backend RESULT_KINDS + DEFAULT_RESULT_POINTS. Client-side deriva
// strokes na hora do clique só pra exibir imediato; server é fonte da verdade
// (re-deriva e valida antes de gravar).
const RESULT_KINDS = ['hio', 'albatross', 'eagle', 'birdie', 'par', 'bogey', 'double_bogey', 'triple_bogey'];
const RESULT_LABELS = {
  hio: 'HiO', albatross: 'Albatross', eagle: 'Eagle', birdie: 'Birdie',
  par: 'Par', bogey: 'Bogey', double_bogey: 'Dbl Bogey', triple_bogey: 'Tpl Bogey',
};
// Cor por resultado — segue paleta do design system (verde=abaixo do par,
// cinza=par, vermelho=acima, amarelo=eagle/HiO).
const RESULT_COLORS = {
  hio: '#eab308', albatross: '#eab308', eagle: '#eab308',
  birdie: '#22c55e',
  par: '#94a3b8',
  bogey: '#ef4444', double_bogey: '#ef4444', triple_bogey: '#ef4444',
};
// Deriva strokes a partir do resultado + par. Espelho de resultKindHelpers.js
// no backend — MANTER SINCRONIZADO. Null quando resultado é impossível pro par
// (ex: Albatross em par 3).
const deriveStrokesFromResult = (par, kind) => {
  const p = Number(par);
  if (!Number.isInteger(p) || p < 3) return null;
  switch (kind) {
    case 'hio': return 1;
    case 'albatross': return p - 3 >= 1 ? p - 3 : null;
    case 'eagle':     return p - 2 >= 1 ? p - 2 : null;
    case 'birdie':    return p - 1;
    case 'par':       return p;
    case 'bogey':     return p + 1;
    case 'double_bogey': return p + 2;
    case 'triple_bogey': return p + 3;
    default: return null;
  }
};

// Data de hoje em BRT no formato YYYY-MM-DD.
// Item 5 · commit 4 (2026-08-28): NÃO usar toISOString — converte pra UTC e
// perto da meia-noite BRT retorna o dia errado (bug idêntico ao do Item 3).
// toLocaleDateString('sv-SE', {timeZone}) devolve YYYY-MM-DD do fuso solicitado.
const todayBRT = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Extrai o dia BRT de uma round_date vinda do backend. round_date pode chegar
// como "2026-08-29T12:00:00.000Z" (ISO UTC vindo do MySQL DATETIME) OU como
// "2026-08-29 12:00:00" (string local sem TZ). Nos dois casos, o que interessa
// é o DIA no fuso BRT — não o dia UTC.
const roundDayBRT = (roundDate) => {
  if (!roundDate) return null;
  const d = new Date(roundDate);
  if (isNaN(d)) return String(roundDate).slice(0, 10); // fallback defensivo
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
};

// Decide qual round o jogador está marcando AGORA:
//   1) Round cujo dia BRT == hoje BRT (match exato). Se >1, pega o menor number.
//   2) Se ninguém casa, o próximo futuro (menor round_date > hoje).
//   3) Se nenhum futuro, o último passado (maior round_date <= hoje).
//   4) Fallback: 1 (single-round ou lista vazia).
const pickCurrentRound = (rounds) => {
  if (!Array.isArray(rounds) || rounds.length === 0) return 1;
  const today = todayBRT();
  const withDay = rounds
    .map(r => ({ n: Number(r.round_number), day: roundDayBRT(r.round_date) }))
    .filter(r => r.n && r.day);
  const exact = withDay.filter(r => r.day === today).sort((a, b) => a.n - b.n)[0];
  if (exact) return exact.n;
  const futures = withDay.filter(r => r.day > today).sort((a, b) => a.day.localeCompare(b.day));
  if (futures.length) return futures[0].n;
  const pasts = withDay.filter(r => r.day <= today).sort((a, b) => b.day.localeCompare(a.day));
  if (pasts.length) return pasts[0].n;
  return 1;
};

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
  const [slotMap, setSlotMap] = useState({ white: null, yellow: null, blue: null, red: null });

  // Item 5 · commit 4: multi-rodada. totalRounds=1 → UI/comportamento antigos
  // preservados. >1 → currentRound alimenta save/sign/getScores/getSignature
  // e o header mostra "R{n} · Sexta 25/08". Auto-detect por data BRT em
  // pickCurrentRound; usuário pode trocar via seletor pra ver R1 depois de R2.
  const [totalRounds, setTotalRounds] = useState(1);
  const [rounds, setRounds] = useState([]);
  const [currentRound, setCurrentRound] = useState(1);

  const [currentHole, setCurrentHole] = useState(1);
  const [scores, setScores] = useState({});
  // Onda A · commit 6: resultKinds paralelo aos scores — só relevante quando
  // inputMode='result'. Mapa `${userId}-${hole}` → 'birdie'|'par'|etc.
  // Fonte da verdade nominal no modo result_points (strokes vira derivado).
  const [resultKinds, setResultKinds] = useState({});
  const [playedHoles, setPlayedHoles] = useState([]);

  // Onda A · commit 6: bifurcação em dois eixos independentes.
  //   inputMode: 'strokes' (comportamento antigo, +/-) ou 'result' (ResultPicker)
  //   ownerKind: 'user' (Onda A sempre) ou 'dupla' (Onda B, ainda não usado)
  // Derivados de tournament.scoring_type e tournament.modality respectivamente
  // no fetchData. Setados 1x quando carrega o torneio.
  const [inputMode, setInputMode] = useState('strokes');
  const [ownerKind, setOwnerKind] = useState('user'); // eslint-disable-line no-unused-vars
  const [resultPointsMap, setResultPointsMap] = useState({}); // {kind: points}
  // Bloco 2 · Commit 2.3 (2026-09-01): {kind: true|false} — kinds desativados
  // sao filtrados do ResultPicker. Vazio = tudo ativo (torneio strokes ou pre-2.2).
  const [resultKindEnabledMap, setResultKindEnabledMap] = useState({});

  const [showSummary, setShowSummary] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ online: true, pending: 0, syncing: false });
  // Assinatura do cartão. null = nunca assinado. Objeto com invalidated_at != null
  // significa que admin ajustou score depois da assinatura → banner de alerta.
  const [signature, setSignature] = useState(null);

  // Lock unificado: bloqueia +/- E ◀/▶ durante qualquer transição de buraco.
  // useRef (não useState) porque a mudança precisa ser síncrona — batching
  // poderia deixar dois cliques do mesmo tick passarem, abrindo janela pra
  // gravar no buraco errado.
  const busyRef = useRef(false);
  // Timers de debounce por chave "userId-holeNumber": cada toque no +/- reseta o
  // timer; ao estourar 400ms sem novo toque, enfileira via syncService.
  const saveTimers = useRef({});

  const theme = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent: '#22c55e', 
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444'
  };

  // Funções para gerenciar rascunho no localStorage.
  // Item 5 · commit 4: chave inclui round pra rascunho de R1 não vazar pra R2.
  // Torneios single-round (round=1) preservam a chave visual antiga por não
  // usar sufixo — a chave é `draft_scores_match_<tid>_hole_<h>` como antes.
  const getDraftKey = useCallback((matchId, holeNumber, roundNumber = 1) => {
    const roundPart = Number(roundNumber) > 1 ? `_round_${roundNumber}` : '';
    return `draft_scores_match_${matchId}${roundPart}_hole_${holeNumber}`;
  }, []);

  const saveDraftToLocalStorage = useCallback((matchId, holeNumber, scoresToSave, roundNumber = 1) => {
    if (!matchId) return;
    const draftKey = getDraftKey(matchId, holeNumber, roundNumber);
    localStorage.setItem(draftKey, JSON.stringify(scoresToSave));
  }, [getDraftKey]);

  const loadDraftFromLocalStorage = useCallback((matchId, holeNumber, roundNumber = 1) => {
    if (!matchId) return null;
    const draftKey = getDraftKey(matchId, holeNumber, roundNumber);
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

  const clearDraftFromLocalStorage = useCallback((matchId, holeNumber, roundNumber = 1) => {
    if (!matchId) return;
    const draftKey = getDraftKey(matchId, holeNumber, roundNumber);
    localStorage.removeItem(draftKey);
  }, [getDraftKey]);

  // Limpa rascunhos de TODAS as rounds do match — usado após assinar (fecha
  // aquela rodada, mas ficamos conservadores e limpamos tudo pra evitar dado
  // stale se o jogador reabrir depois).
  const clearAllDraftsForMatch = useCallback((matchId) => {
    if (!matchId) return;
    for (let r = 1; r <= 10; r++) {
      for (let i = 1; i <= 18; i++) {
        localStorage.removeItem(getDraftKey(matchId, i, r));
      }
    }
  }, [getDraftKey]);

  // Snapshot consolidado: buraco ativo + todas as tacadas + ID do torneio.
  // F5/navegação para o ranking e volta restauram tudo exatamente como estava.
  const getStateKey = useCallback(() => `scorecard_state_${groupId}`, [groupId]);

  const persistState = useCallback((next) => {
    try {
      localStorage.setItem(getStateKey(), JSON.stringify({
        tournament_id: next.tournament_id,
        groupId: Number(groupId),
        currentHole: next.currentHole,
        scores: next.scores,
        resultKinds: next.resultKinds || {},
        playedHoles: next.playedHoles,
        savedAt: Date.now(),
      }));
    } catch (e) {
      console.warn("Falha ao persistir estado local do scorecard", e);
    }
  }, [getStateKey, groupId]);

  const loadPersistedState = useCallback(() => {
    try {
      const raw = localStorage.getItem(getStateKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }, [getStateKey]);

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

      // Restauração imediata do snapshot local — garante que F5 ou volta do
      // ranking renderizem a tela exatamente onde o usuário parou, mesmo antes
      // de qualquer resposta da API.
      const persisted = loadPersistedState();
      const hasPersisted = persisted && persisted.tournament_id === savedGroup.tournament_id;
      if (hasPersisted) {
        if (persisted.scores) setScores(persisted.scores);
        if (persisted.resultKinds) setResultKinds(persisted.resultKinds);
        if (Array.isArray(persisted.playedHoles) && persisted.playedHoles.length) {
          setPlayedHoles(persisted.playedHoles);
        }
        if (persisted.currentHole >= 1 && persisted.currentHole <= 18) {
          setCurrentHole(persisted.currentHole);
        }
      }

      const groupList = await api.get(`/groups/list/${savedGroup.tournament_id}`);
      const myGroupData = groupList.data.find((g) => g.id === Number(groupId));

      if (myGroupData && myGroupData.players) setPlayers(myGroupData.players);

      const tourRes = await api.get(`/tournaments/${savedGroup.tournament_id}`);
      // Item 5 · commit 4: hidrata metadados multi-rodada + calcula round atual.
      // Se torneio single-round (total_rounds=1), setCurrentRound(1) preserva tudo.
      const tr = Number(tourRes.data.total_rounds || 1);
      const roundsList = Array.isArray(tourRes.data.rounds) ? tourRes.data.rounds : [];
      setTotalRounds(tr);
      setRounds(roundsList);
      // Onda A · commit 6: hidrata inputMode + resultPointsMap. Onda B hidratará ownerKind.
      const st = tourRes.data.scoring_type === 'result_points' ? 'result' : 'strokes';
      setInputMode(st);
      // ownerKind: sempre 'user' na Onda A. Quando Onda B chegar, deriva de tourRes.data.modality.
      setOwnerKind(tourRes.data.modality === 'doubles' ? 'dupla' : 'user');
      if (st === 'result' && Array.isArray(tourRes.data.result_points)) {
        const rpMap = {};
        // Bloco 2 · Commit 2.3: mapa de enabled (default true se backend antigo).
        const enabledMap = {};
        tourRes.data.result_points.forEach(({ result_kind, points, enabled }) => {
          rpMap[result_kind] = Number(points);
          enabledMap[result_kind] = enabled === undefined ? true : Number(enabled) === 1;
        });
        setResultPointsMap(rpMap);
        setResultKindEnabledMap(enabledMap);
      } else {
        setResultPointsMap({});
        setResultKindEnabledMap({});
      }
      // Bloco D · commit 5: Opcao B — cada grupo pertence a UMA rodada. Se o
      // backend entregou group.round_number, usa direto (autoritativo). Fallback
      // pra pickCurrentRound pela data BRT so quando o grupo nao declara round
      // (torneio single-round pre-migration OU dado legado sem coluna).
      const groupRound = myGroupData?.round_number ? Number(myGroupData.round_number) : null;
      const autoRound = groupRound || pickCurrentRound(roundsList);
      setCurrentRound(autoRound);
      // Para multi-rodada, o CURSO relevante é o da RODADA (cada round pode ser
      // num campo diferente). Single-round cai no fallback do course do torneio.
      const roundCourseId = tr > 1
        ? (roundsList.find(r => Number(r.round_number) === autoRound)?.course_id || tourRes.data.course_id)
        : tourRes.data.course_id;
      const actualCourseId = roundCourseId || savedGroup.course_id;

      if (actualCourseId) {
          const [courseRes, mapRes] = await Promise.all([
            api.get(`/courses/${actualCourseId}/holes`),
            api.get(`/courses/${actualCourseId}/yard-slot-map`).catch(() => ({ data: null })),
          ]);
          setHolesData(courseRes.data);
          if (mapRes.data) setSlotMap(mapRes.data);
      }

      // Filtro por round no GET — evita puxar scores das OUTRAS rodadas pra o
      // scoresMap desta tela. Backend aceita ?round=N desde commit 2 do Item 5.
      const scoresRes = await api.get(
        `/scores/list/${savedGroup.tournament_id}${tr > 1 ? `?round=${autoRound}` : ''}`
      );
      const scoresMap = {};
      const kindsMap = {};
      scoresRes.data.forEach((s) => {
        scoresMap[`${s.user_id}-${s.hole_number}`] = s.strokes;
        // Onda A · commit 6: preenche resultKinds a partir do backend. Torneio
        // strokes vem com result_kind NULL — kindsMap fica vazio, sem ruído.
        if (s.result_kind) kindsMap[`${s.user_id}-${s.hole_number}`] = s.result_kind;
      });
      // Overlay offline-first: itens na fila do syncService ainda não confirmados
      // pelo servidor (pending/syncing/failed) sobrepõem o que veio do GET. Sem
      // isso, um refetch (F5, socket) apagaria scores marcados offline.
      // Item 5 · commit 4: filtra também por round pra não puxar scores de R1
      // sobre a tela de R2 (que exibe só os scores desta rodada).
      const pendingOverlay = {};
      syncService.getPendingItems((item) =>
        item.endpoint === "/scores/save"
        && Number(item.payload?.tournament_id) === Number(savedGroup.tournament_id)
        && Number(item.payload?.round_number || 1) === autoRound
      ).forEach((item) => {
        const p = item.payload;
        pendingOverlay[`${p.user_id}-${p.hole_number}`] = p.strokes;
      });
      // prev vem por último pra preservar cliques ainda no debounce.
      setScores((prev) => ({ ...scoresMap, ...pendingOverlay, ...prev }));
      // Onda A · commit 6: mesmo padrão pra resultKinds (só relevante em inputMode='result').
      const pendingKindsOverlay = {};
      syncService.getPendingItems((item) =>
        item.endpoint === "/scores/save"
        && Number(item.payload?.tournament_id) === Number(savedGroup.tournament_id)
        && Number(item.payload?.round_number || 1) === autoRound
        && item.payload?.result_kind
      ).forEach((item) => {
        const p = item.payload;
        pendingKindsOverlay[`${p.user_id}-${p.hole_number}`] = p.result_kind;
      });
      setResultKinds((prev) => ({ ...kindsMap, ...pendingKindsOverlay, ...prev }));
      
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
          
          // Reconstruir histórico de buracos jogados — só aplica se não há
          // snapshot local (snapshot é fonte mais recente, inclui buracos
          // marcados offline que ainda não chegaram ao servidor).
          if (!hasPersisted) {
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
      }

      // Snapshot local tem prioridade. Fallback: sessionStorage → cálculo do servidor.
      let resolvedHole;
      if (hasPersisted && persisted.currentHole >= 1 && persisted.currentHole <= 18) {
        resolvedHole = persisted.currentHole;
      } else {
        const storageKey = `scorecard_hole_${groupId}`;
        const persistedHole = parseInt(sessionStorage.getItem(storageKey), 10);
        resolvedHole = (persistedHole >= 1 && persistedHole <= 18) ? persistedHole : finalCurrentHole;
        setCurrentHole(resolvedHole);
      }

      // Carregar rascunhos do localStorage para o buraco atual — chave inclui round
      if (savedGroup.tournament_id) {
        const draftData = loadDraftFromLocalStorage(savedGroup.tournament_id, resolvedHole, autoRound);
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
  }, [groupId, navigate, loadDraftFromLocalStorage, loadPersistedState]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Busca a assinatura atual do grupo NA RODADA ATUAL. Se existe e
  // invalidated_at != null, banner vermelho: admin ajustou score depois.
  // Item 5 · commit 4: refetch quando currentRound muda — cada rodada tem
  // sua própria assinatura, então trocar de round precisa recarregar.
  useEffect(() => {
    let cancelled = false;
    if (!groupId) return;
    api.get(`/scores/signature/${groupId}?round=${currentRound}`)
      .then((r) => { if (!cancelled) setSignature(r.data || null); })
      .catch(() => { /* silencioso — grupo pode não ter sido assinado ainda */ });
    return () => { cancelled = true; };
  }, [groupId, currentRound]);

  // Persistência reativa: a cada mudança no estado relevante, salva o snapshot.
  // Não persiste durante o loading inicial para evitar gravar estado vazio.
  useEffect(() => {
    if (isInitialLoading || !group?.tournament_id) return;
    persistState({
      tournament_id: group.tournament_id,
      currentHole,
      scores,
      resultKinds,
      playedHoles,
    });
  }, [isInitialLoading, group, currentHole, scores, resultKinds, playedHoles, persistState]);

  // Inscreve no syncService para mostrar indicador "Aguardando Conexão"
  useEffect(() => {
    syncService.bootstrap();
    return syncService.subscribe(setSyncStatus);
  }, []);

  // Bloco D · hotfix 2026-08-29: switchRound REMOVIDO. Cada grupo pertence a
  // UMA rodada (tg.round_number), e o re-seeding pode colocar o jogador em
  // grupos DIFERENTES entre rodadas. Deixar o jogador trocar de rodada aqui
  // gravava score fora do contexto do grupo dele — bug real em torneio ASPIRANTES
  // (2026-08-29): mesmo player marcou R1/R2/R3 no mesmo buraco. Conferencia de
  // outras rodadas fica em Ranking/Meu Desempenho.

  // Cleanup: se o usuário sair do scorecard sem clicar em ▶, dispara os timers
  // pendentes de debounce → enqueue. A fila persiste em localStorage e é
  // drenada ao reabrir/reconectar.
  useEffect(() => {
    return () => {
      Object.entries(saveTimers.current).forEach(([key, timerId]) => {
        clearTimeout(timerId);
        const [uid, hNum] = key.split("-");
        const s = scores[key];
        if (s > 0) enqueueScore(uid, hNum, s);
      });
      saveTimers.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentHoleData = holesData.find(
    (h) => Number(h.hole_number) === Number(currentHole) || Number(h.hole) === Number(currentHole)
  ) || { par: 4, yards_blue: 0, yards_white: 0, yards_yellow: 0, yards_red: 0 };

  // Enfileira a tacada no syncService. Fila persistente em localStorage; se
  // offline, fica em PENDING e reenvia ao voltar. `dedupKey` garante que
  // cliques em sequência no mesmo (tournament, user, hole) substituam a
  // pendência anterior em vez de empilhar duplicatas.
  const enqueueScore = (userId, hole, strokes, resultKind = null) => {
    if (!group?.tournament_id) return;
    // Item 5 · commit 4: round_number no payload. dedupKey inclui round pra que
    // scores da mesma (user,hole) em rounds diferentes NÃO substituam um ao outro
    // na fila (bug potencial se dedupKey ignorasse round).
    // Onda A · commit 6: result_kind opcional. Em torneio strokes fica null e
    // o backend ignora; em torneio result_points é obrigatório (backend rejeita
    // sem kind e re-deriva strokes autoritativamente).
    const payload = {
      tournament_id: group.tournament_id,
      user_id: Number(userId),
      hole_number: Number(hole),
      round_number: Number(currentRound),
      strokes: Number(strokes),
    };
    if (resultKind) payload.result_kind = resultKind;
    syncService.enqueue({
      endpoint: "/scores/save",
      payload,
      dedupKey: `score:${group.tournament_id}:${currentRound}:${userId}:${hole}`,
    });
  };

  // Onda A · commit 6: handler pro ResultPicker (inputMode='result'). Diferente
  // do +/-, aqui o clique é DISCRETO — não há sequência de toques, então
  // enqueue imediato sem debounce. Deriva strokes client-side pra exibir no
  // ato (o backend re-deriva e é a fonte da verdade final).
  const handleResultPick = (userId, resultKind, hole) => {
    if (busyRef.current) return;
    if (Number(hole) !== Number(currentHole)) {
      console.warn("[Scorecard] Pick descartado — hole visual difere do state.", { holeClicked: hole, currentHole, userId, resultKind });
      return;
    }
    const par = currentHoleData.par || 4;
    const derivedStrokes = deriveStrokesFromResult(par, resultKind);
    if (derivedStrokes === null) {
      alert(`Resultado ${RESULT_LABELS[resultKind]} impossível em par ${par}.`);
      return;
    }
    const key = `${userId}-${hole}`;
    setScores(prev => ({ ...prev, [key]: derivedStrokes }));
    setResultKinds(prev => ({ ...prev, [key]: resultKind }));
    // Sem debounce — enqueue imediato.
    enqueueScore(userId, hole, derivedStrokes, resultKind);
  };

  // REGRA 1: handleScoreChange com anotação livre offline e bônus do PAR.
  // `hole` vem EXPLÍCITO do onClick — é o buraco que o usuário viu na tela no
  // momento do clique. Se o state React já avançou (busyRef ativo ou hole
  // divergente do currentHole atual), o clique é descartado e logado. Sem
  // isso, um toque durante a transição de buraco gravava no hole errado —
  // raiz do bug do torneio real de 2026-08.
  //
  // Fluxo pós-Bug A: cada toque agenda um enqueue no syncService com debounce
  // de 400ms. Antes o enqueue só rodava em saveCurrentHoleScores (ao avançar
  // buraco), então o buraco atual ficava fora da fila até o usuário clicar ▶.
  // Se caísse a conexão e ele fechasse a aba, o dado sobrevivia apenas no
  // draft/snapshot local — agora entra também na fila persistente.
  const handleScoreChange = (userId, delta, hole) => {
    if (busyRef.current) return;
    if (Number(hole) !== Number(currentHole)) {
      console.warn("[Scorecard] Clique descartado — hole visual difere do state.", {
        holeClicked: hole, currentHole, userId, delta,
      });
      return;
    }
    const key = `${userId}-${hole}`;
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
        const scoreKey = `${p.id}-${hole}`;
        if (updatedScores[scoreKey]) {
          currentHoleScores[scoreKey] = updatedScores[scoreKey];
        }
      });
      saveDraftToLocalStorage(group.tournament_id, hole, currentHoleScores, currentRound);
    }

    // Debounce 400ms → enqueue offline-first
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      enqueueScore(userId, hole, newScore);
      delete saveTimers.current[key];
    }, 400);
  };

  // Drena timers de debounce imediatamente pro syncService (sync, não bloqueia).
  // Usado ao trocar de buraco: garante que cliques ainda no debounce virem
  // enqueues antes da transição — depois disso a fila cuida da entrega.
  const flushPendingTimersForHole = (hole) => {
    players.forEach((p) => {
      const key = `${p.id}-${hole}`;
      if (saveTimers.current[key]) {
        clearTimeout(saveTimers.current[key]);
        const s = scores[key];
        delete saveTimers.current[key];
        // Onda A · commit 6: modo result não gera timer (enqueue imediato),
        // então esse flush só cobre modo strokes. resultKinds[key] será undefined
        // no fluxo normal — mas passamos por consistência caso haja edge case.
        if (s > 0) enqueueScore(p.id, hole, s, resultKinds[key] || null);
      }
    });
    // Rascunho do buraco pode ser limpo: syncService é o source-of-truth
    // dos envios pendentes; o snapshot consolidado mantém os scores na tela.
    if (group?.tournament_id) clearDraftFromLocalStorage(group.tournament_id, hole, currentRound);
  };

  const changeHole = (delta) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // Snapshot do hole no INÍCIO da transição — evita que qualquer setCurrentHole
      // concorrente (impossível hoje, defensivo pra futuro) corrompa o payload.
      const holeBeforeChange = currentHole;

      if (delta > 0) {
        const missingPlayer = players.find((p) => {
          const score = scores[`${p.id}-${holeBeforeChange}`];
          return !score || score === 0;
        });

        if (missingPlayer) {
          alert(`Falta anotar o score de: ${missingPlayer.name}`);
          return;
        }
      }

      // Drena timers de debounce do buraco atual (sync, não aguarda servidor).
      // A fila do syncService cuida da entrega em background.
      if (delta !== 0) flushPendingTimersForHole(holeBeforeChange);

      if (delta > 0) {
        if (!isReviewMode && playedHoles.length >= 18) {
          setShowSummary(true);
          return;
        }

        let nextHole = holeBeforeChange + 1;
        if (nextHole > 18) nextHole = 1;

        if (!playedHoles.includes(nextHole)) {
            setPlayedHoles([...playedHoles, nextHole]);
        }
        setCurrentHole(nextHole);
        sessionStorage.setItem(`scorecard_hole_${groupId}`, nextHole);

        // Carregar rascunho do próximo buraco se existir (chave inclui round)
        if (group?.tournament_id) {
          const draftData = loadDraftFromLocalStorage(group.tournament_id, nextHole, currentRound);
          if (draftData) {
            setScores(prev => ({ ...prev, ...draftData }));
          }
        }

      } else if (delta < 0) {
        let prevHole = holeBeforeChange - 1;
        if (prevHole < 1) prevHole = 18;

        if (!playedHoles.includes(prevHole)) {
          alert("Você não pode voltar para um buraco antes do seu tee de saída.");
          return;
        }
        setCurrentHole(prevHole);
        sessionStorage.setItem(`scorecard_hole_${groupId}`, prevHole);

        // Carregar rascunho do buraco anterior se existir (chave inclui round)
        if (group?.tournament_id) {
          const draftData = loadDraftFromLocalStorage(group.tournament_id, prevHole, currentRound);
          if (draftData) {
            setScores(prev => ({ ...prev, ...draftData }));
          }
        }
      }
    } finally {
      busyRef.current = false;
    }
  };

  const calculateTotal = (userId, handicap) => {
    let totalGross = 0;
    let totalPar = 0;
    let totalPoints = 0;

    for (let h = 1; h <= 18; h++) {
      const score = scores[`${userId}-${h}`];
      if (score > 0) {
        totalGross += score;

        const hole = holesData.find(hd => (hd.hole_number || hd.hole) === h);
        if (hole) totalPar += hole.par;

        // Onda A · commit 6: em modo result, soma pontos do resultKind gravado.
        // Modo strokes: resultKinds vazio → totalPoints=0 (não exibido).
        const kind = resultKinds[`${userId}-${h}`];
        if (kind && resultPointsMap[kind] !== undefined) {
          totalPoints += Number(resultPointsMap[kind]);
        }
      }
    }

    if (totalGross === 0) return { gross: 0, netVsPar: "E", points: 0 };

    const grossVsPar = totalGross - totalPar;
    const netVsPar = grossVsPar - parseFloat(handicap || 0);

    let formattedNet = "E";
    if (netVsPar !== 0) {
      formattedNet = netVsPar > 0 ? `+${netVsPar.toFixed(1)}` : netVsPar.toFixed(1);
    }

    return { gross: totalGross, netVsPar: formattedNet, points: totalPoints };
  };

  // Bug B — 2026-08-13: validação de completude antes de assinar.
  // expectedHoles derivado de holesData.length (não hardcoded 18). Fallback 18
  // se holesData ainda não carregou.
  const expectedHoles = holesData.length > 0 ? holesData.length : 18;
  const incompleteEntries = getIncompleteEntries(players, scores, expectedHoles);

  // Assinar cartão exige conexão real, fila zerada, cartão completo E confirmação
  // server-side via POST /scores/sign-card. O endpoint valida completude no banco
  // (defense-in-depth) e grava assinatura em tournament_scorecard_signatures com
  // timestamp — cartão oficial de verdade, não mais só ação de UI.
  const handleConfirmGame = async () => {
    if (!navigator.onLine) {
      alert("Aguarde a conexão voltar para assinar o cartão. Seus pontos estão salvos localmente.");
      return;
    }

    // Validação client-side de completude — feedback imediato
    if (incompleteEntries.length > 0) {
      alert(`Cartão incompleto — não pode ser assinado.\n\n${formatIncompleteSummary(incompleteEntries)}`);
      return;
    }

    // Drena qualquer timer de debounce dos buracos jogados → enqueue imediato.
    [...new Set(playedHoles)].forEach((h) => flushPendingTimersForHole(h));

    // Força um flush da fila e reverifica: se algo ficou pendente/falhou, aborta
    // — não assina cartão oficial sem confirmação de que todas as tacadas
    // chegaram ao servidor.
    await syncService.flush();
    const finalStatus = syncService.getStatus();
    if (finalStatus.pending > 0 || finalStatus.syncing) {
      alert(`Ainda há ${finalStatus.pending || 1} tacada(s) sincronizando. Aguarde o indicador zerar antes de assinar.`);
      return;
    }

    // Grava assinatura oficial no backend (endpoint novo do Bloco 3).
    // Item 5 · commit 4: assina POR ROUND. R1 e R2 têm assinaturas independentes;
    // editar R2 depois NÃO invalida R1 (validado no verify do commit 2).
    try {
      await api.post("/scores/sign-card", {
        tournament_id: group.tournament_id,
        group_id: Number(groupId),
        round_number: Number(currentRound),
      });
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 400 && Array.isArray(data?.missing) && data.missing.length > 0) {
        alert(`Cartão incompleto (checado no servidor):\n\n${formatIncompleteSummary(data.missing)}`);
        return;
      }
      alert("Falha ao registrar assinatura. Verifique a conexão e tente novamente.");
      return;
    }

    if (group?.tournament_id) {
      clearAllDraftsForMatch(group.tournament_id);
    }
    sessionStorage.removeItem(`scorecard_hole_${groupId}`);
    localStorage.removeItem(`scorecard_state_${groupId}`);
    // activeGroup é a chave que o PlayerHome usa para oferecer "Continuar Partida" —
    // remover aqui garante que, após assinar, o banner não reaparece na home.
    localStorage.removeItem("activeGroup");

    alert("Cartão Assinado! Placar Oficializado.");
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
    container: { padding: "15px", backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, textAlign: "center" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", paddingBottom: "10px", borderBottom: `1px solid ${theme.cardLight}` },
    headerInfo: { textAlign: "left" },
    leaderboardBtn: { backgroundColor: theme.gold, color: "black", border: "none", padding: "8px 12px", borderRadius: "8px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" },
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

  // AJUSTE VISUAL: Remover texto de loading, mostrar container vazio com fundo
  if (isInitialLoading || !group) {
    return <div style={{ backgroundColor: theme.bg, minHeight: "100vh" }} />;
  }

  if (showSummary) {
    return (
      <div style={styles.container}>
        <h2 style={{ color: theme.gold, display: "flex", alignItems: "center", gap: 8 }}>
          <LuClipboardList size={20} />
          Conferência Final
        </h2>
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
                  {inputMode === 'result' ? (
                    <div style={{ fontSize: "14px", fontWeight: "bold", color: theme.gold }}>
                      {totals.points} ponto{totals.points === 1 ? '' : 's'}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: "14px", fontWeight: "bold",
                      color: totals.netVsPar.toString().includes("-") ? theme.accent : (totals.netVsPar === "E" ? theme.textMuted : theme.danger)
                    }}>
                      NET: {totals.netVsPar}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {incompleteEntries.length > 0 && (
          <div style={{ marginTop: "18px", padding: "12px 14px", backgroundColor: "rgba(239,68,68,0.10)", border: `1px solid ${theme.danger}55`, borderRadius: "8px", fontSize: "12px", color: theme.danger, textAlign: "left" }}>
            <div style={{ fontWeight: "bold", marginBottom: "6px", textAlign: "center" }}>
              Cartão incompleto — faltam scores:
            </div>
            {incompleteEntries.map(m => (
              <div key={m.user_id} style={{ marginTop: "3px" }}>
                <strong>{m.name}:</strong> {m.missing_holes.length === 1 ? 'buraco' : 'buracos'} {m.missing_holes.join(', ')}
              </div>
            ))}
          </div>
        )}
        {(syncStatus.pending > 0 || syncStatus.syncing) && incompleteEntries.length === 0 && (
          <div style={{ marginTop: "18px", padding: "10px 12px", backgroundColor: "rgba(234,179,8,0.10)", border: `1px solid ${theme.gold}55`, borderRadius: "8px", fontSize: "12px", color: theme.gold, textAlign: "center" }}>
            {syncStatus.online
              ? `Sincronizando ${syncStatus.pending} tacada(s) — aguarde o indicador zerar antes de assinar.`
              : `${syncStatus.pending} tacada(s) sem envio — aguarde a conexão voltar.`}
          </div>
        )}
        {(() => {
          const blocked = syncStatus.pending > 0 || syncStatus.syncing || incompleteEntries.length > 0;
          return (
            <button
              style={{ ...styles.confirmBtn, ...(blocked && { backgroundColor: theme.cardLight, color: theme.textMuted, cursor: "not-allowed" }) }}
              onClick={handleConfirmGame}
              disabled={blocked}
            >
              <LuCheck size={16} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
              Assinar Cartão
            </button>
          );
        })()}
        <button style={styles.editBtn} onClick={handleEditMode}>
          <LuPencil size={14} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
          Voltar e Editar
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInfo}>
          <small style={{ color: theme.textMuted, textTransform: "uppercase", letterSpacing: "1px" }}>{group.tournament_name}</small>
          <h3 style={{ margin: "5px 0", color: "#fff" }}>{group.group_name}</h3>
          {totalRounds > 1 && (() => {
            // Badge da rodada atual. Item 5 · commit 4: só aparece pra multi-rodada.
            // Mostra "R2 · Sáb 30/08" — dia BRT do round vindo do backend.
            const roundInfo = rounds.find(r => Number(r.round_number) === currentRound);
            const dayBR = roundInfo ? new Date(roundInfo.round_date).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit'
            }) : '';
            return (
              <div style={{
                display: "inline-block", marginTop: 4, padding: "3px 10px",
                borderRadius: 12, fontSize: 11, fontWeight: "bold",
                backgroundColor: "rgba(234,179,8,0.15)", color: theme.gold,
                border: `1px solid ${theme.gold}55`,
              }}>
                R{currentRound} de {totalRounds}{dayBR ? ` · ${dayBR}` : ''}
              </div>
            );
          })()}
          {(!syncStatus.online || syncStatus.pending > 0) && (
            <div
              title={syncStatus.online ? "Sincronizando tacadas pendentes..." : "Sem conexão — tacadas serão enviadas ao reconectar"}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                marginTop: "4px", padding: "3px 8px", borderRadius: "12px",
                fontSize: "11px", fontWeight: "bold",
                backgroundColor: syncStatus.online ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.15)",
                color: syncStatus.online ? theme.gold : theme.danger,
                border: `1px solid ${syncStatus.online ? theme.gold : theme.danger}55`,
              }}
            >
              <span style={{
                width: "6px", height: "6px", borderRadius: "50%",
                backgroundColor: syncStatus.online ? theme.gold : theme.danger,
                animation: "birdifyPulse 1.5s infinite",
              }} />
              {syncStatus.online
                ? `Sincronizando${syncStatus.pending > 0 ? ` (${syncStatus.pending})` : ""}`
                : `Aguardando Conexão${syncStatus.pending > 0 ? ` (${syncStatus.pending})` : ""}`}
            </div>
          )}
        </div>
        <button onClick={openLeaderboard} style={styles.leaderboardBtn}>
          <LuTrophy size={14} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
          Ranking
        </button>
      </div>
      <style>{`@keyframes birdifyPulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>

      {/* Bloco D · hotfix 2026-08-29: seletor de pills R1/R2/R3 REMOVIDO.
          A rodada e fixa pelo grupo do jogador (badge no header ja mostra qual).
          Ver rodadas anteriores/proximas: Ranking ou Meu Desempenho. */}

      {signature && signature.invalidated_at && (
        <div style={{
          marginBottom: 14, padding: "12px 14px",
          backgroundColor: "rgba(239,68,68,0.12)",
          border: `1px solid ${theme.danger}`,
          borderRadius: 10, textAlign: "left",
        }}>
          <div style={{ fontWeight: "bold", color: theme.danger, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            ⚠ Cartão invalidado após ajuste do administrador
          </div>
          <div style={{ fontSize: 12, color: theme.textMain, marginBottom: 4 }}>
            Assinado em {new Date(signature.signed_at).toLocaleString("pt-BR")} por {signature.signed_by_name}.
            Invalidado em {new Date(signature.invalidated_at).toLocaleString("pt-BR")}.
          </div>
          {signature.invalidated_reason && (
            <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic" }}>
              {signature.invalidated_reason}
            </div>
          )}
        </div>
      )}
      {signature && !signature.invalidated_at && (
        <div style={{
          marginBottom: 14, padding: "10px 14px",
          backgroundColor: "rgba(34,197,94,0.10)",
          border: `1px solid ${theme.accent}55`,
          borderRadius: 10, textAlign: "left", fontSize: 12,
        }}>
          <span style={{ color: theme.accent, fontWeight: "bold" }}>Cartão assinado</span>
          <span style={{ color: theme.textMuted }}>
            {" "}em {new Date(signature.signed_at).toLocaleString("pt-BR")} por {signature.signed_by_name}.
          </span>
        </div>
      )}

      <div style={styles.holeNav}>
        <button style={styles.navBtn} onClick={() => changeHole(-1)}>◀</button>
        <div>
          <div style={{ ...styles.holeTitle, display: "inline-flex", alignItems: "center", gap: 10 }}>
            Buraco {currentHole}
            <HolePhotoBadge imagePath={currentHoleData.image_path} holeNumber={currentHole} />
          </div>
          <div style={{ textAlign: "center" }}>
            <span style={styles.parInfo}>PAR {currentHoleData.par}</span>
          </div>
          <div style={{ marginTop: 4, display: "flex", justifyContent: "center" }}>
            <HoleDistanceBadge hole={currentHoleData} slotMap={slotMap} />
          </div>
          {/* Pills de yards por tee agora vêm dentro do HoleDistanceBadge acima —
              evita duplicação. Cores yellow/red antigas estavam trocadas (yellow→preto,
              red→verde); o componente novo tem as cores corretas do padrão de golfe. */}
        </div>
        <button style={styles.navBtn} onClick={() => changeHole(1)}>▶</button>
      </div>

      <div>
        {players.map((p) => {
          const score = scores[`${p.id}-${currentHole}`];
          const kind = resultKinds[`${p.id}-${currentHole}`];
          const perfil = calcularPerfilGolfista(p.gender, p.handicap);
          const par = currentHoleData.par || 4;

          // Onda A · commit 6: em modo 'result', card vira coluna (info em cima,
          // ResultPicker embaixo) pra caber os 8 botões sem apertar. Em modo
          // 'strokes' mantém layout horizontal antigo (info | +/-).
          const cardStyle = inputMode === 'result'
            ? { ...styles.playerCard, flexDirection: 'column', alignItems: 'stretch', gap: 12 }
            : styles.playerCard;

          return (
            <div key={p.id} style={cardStyle}>
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

              {inputMode === 'strokes' ? (
                <div style={styles.scoreControl}>
                  <button style={{ ...styles.scoreBtn, ...styles.minus }} onClick={() => handleScoreChange(p.id, -1, currentHole)}>-</button>
                  <span style={{ ...styles.scoreValue, color: score ? (score < par ? theme.accent : score > par ? theme.danger : "white") : theme.cardLight }}>
                    {score ? score : "0"}
                  </span>
                  <button style={{ ...styles.scoreBtn, ...styles.plus }} onClick={() => handleScoreChange(p.id, 1, currentHole)}>+</button>
                </div>
              ) : (
                // ResultPicker: um chip por resultKind válido pro par. Kind
                // selecionado ganha borda accent + fundo pigmentado da própria
                // cor (verde/cinza/vermelho/amarelo). O clique dispara
                // handleResultPick (sem debounce, enqueue imediato).
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {RESULT_KINDS
                    // Bloco 2 · Commit 2.3: esconde kinds que o admin desativou
                    // neste torneio. Mapa vazio (torneio strokes / backend antigo)
                    // → todos aparecem, comportamento inalterado.
                    .filter(k => Object.keys(resultKindEnabledMap).length === 0 || resultKindEnabledMap[k])
                    .map(k => {
                    const derived = deriveStrokesFromResult(par, k);
                    const impossible = derived === null;
                    const active = kind === k;
                    const baseColor = RESULT_COLORS[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={impossible}
                        onClick={() => handleResultPick(p.id, k, currentHole)}
                        title={impossible ? `Impossível em par ${par}` : `${RESULT_LABELS[k]} — ${derived} tacada(s) · ${resultPointsMap[k] ?? '?'} pt(s)`}
                        style={{
                          padding: '10px 6px',
                          borderRadius: 8,
                          border: `1px solid ${active ? baseColor : theme.cardLight}`,
                          backgroundColor: active ? `${baseColor}33` : theme.bg,
                          color: impossible ? theme.cardLight : (active ? baseColor : theme.textMain),
                          cursor: impossible ? 'not-allowed' : 'pointer',
                          opacity: impossible ? 0.4 : 1,
                          fontSize: 12,
                          fontWeight: active ? 800 : 600,
                          textAlign: 'center',
                          lineHeight: 1.1,
                        }}
                      >
                        <div>{RESULT_LABELS[k]}</div>
                        <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
                          {impossible ? '—' : `${resultPointsMap[k] ?? '?'}pt`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isReviewMode && (
        <button style={styles.reviewBtn} onClick={() => setShowSummary(true)}>
          <LuClipboardList size={16} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
          Finalizar Cartão
        </button>
      )}
    </div>
  );
}

export default Scorecard;