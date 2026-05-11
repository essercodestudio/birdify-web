import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { ThemeContext } from '../App';

function DailyTraining() {
  const navigate   = useNavigate();
  const clubTheme  = useContext(ThemeContext);
  const loggedUser = JSON.parse(localStorage.getItem('user') || 'null');

  const accent = clubTheme?.primary_color || '#22c55e';
  const theme  = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent,
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444',
  };

  const [mode, setMode]                     = useState(null);
  // Pré-popula somente se status não for 'finalizado' — evita botão "Continuar" para treino morto.
  // Se status for 'finalizado' ou desconhecido, mostra "Verificando..." até o banco confirmar.
  const _stored   = JSON.parse(localStorage.getItem('activeTrainingGroup') || 'null');
  const _preGroup = (_stored?.id && _stored?.status !== 'finalizado')
    ? { group_id: _stored.id, status: _stored.status || 'aguardando' }
    : null;
  const [currentGroup, setCurrentGroup]       = useState(_preGroup);
  const [isCheckingGroup, setIsCheckingGroup] = useState(true);
  const [lobbies, setLobbies]               = useState([]);
  const [lobbiesLoading, setLobbiesLoading] = useState(true);

  const [courses, setCourses]           = useState([]);
  const [courseId, setCourseId]         = useState('');
  const [startingHole, setStartingHole] = useState(1);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError]   = useState('');

  const [joinState, setJoinState] = useState({});

  const pollRef      = useRef(null);
  const isCreatingRef = useRef(false);

  const checkCurrentGroup = useCallback(async () => {
    if (!loggedUser?.id) { setIsCheckingGroup(false); return; }
    try {
      const res = await api.get(`/training/current?user_id=${loggedUser.id}`);
      if (res.data.group_id) {
        setCurrentGroup(res.data);
      } else {
        setCurrentGroup(null);
        // Banco confirma: nenhum grupo ativo. Limpa resquícios de sessão anterior.
        const stored = localStorage.getItem('activeTrainingGroup');
        if (stored) {
          const parsed = JSON.parse(stored);
          localStorage.removeItem('activeTrainingGroup');
          if (parsed?.id) localStorage.removeItem(`training_hole_${parsed.id}`);
        }
      }
    } catch {
      // Falha de rede: mantém o estado pré-populado sem travar o fluxo
    } finally {
      setIsCheckingGroup(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLobbies = useCallback(async () => {
    try {
      const uid = loggedUser?.id;
      const res = await api.get(`/training/lobbies${uid ? `?user_id=${uid}` : ''}`);
      setLobbies(res.data || []);
    } catch {
    } finally {
      setLobbiesLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    checkCurrentGroup();
    fetchLobbies();
    pollRef.current = setInterval(() => {
      checkCurrentGroup();
      fetchLobbies();
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [checkCurrentGroup, fetchLobbies]);

  const loadCourses = async () => {
    if (courses.length > 0) return;
    try {
      const res  = await api.get('/courses');
      const list = res.data || [];
      setCourses(list);
      if (list.length > 0) setCourseId(list[0].id);
    } catch {}
  };

  const handleCreate = async () => {
    // Ref guard: impede duplo clique antes da re-renderização desabilitar o botão
    if (isCreatingRef.current) return;
    if (!courseId) { setCreateError('Selecione um campo.'); return; }
    if (!loggedUser) { navigate('/login'); return; }

    // Se há grupo ativo no estado, navega direto em vez de tentar criar
    if (currentGroup?.group_id) {
      navigate(`/training-scorecard/${currentGroup.group_id}`);
      return;
    }

    isCreatingRef.current = true;
    setCreateLoading(true); setCreateError('');
    try {
      const res = await api.post('/training/create', {
        creator_id:    loggedUser.id,
        course_id:     Number(courseId),
        starting_hole: Number(startingHole),
      });
      localStorage.removeItem('activeTrainingGroup');
      navigate(`/training-scorecard/${res.data.groupId}`);
    } catch (err) {
      const status = err.response?.status;

      if (status === 409 || status === 400) {
        // Cache zombie: o banco sabe que o usuário já está em um treino.
        // Limpa o localStorage e navega para o treino correto.
        const stored = localStorage.getItem('activeTrainingGroup');
        if (stored) {
          const parsed = JSON.parse(stored);
          localStorage.removeItem('activeTrainingGroup');
          if (parsed?.id) localStorage.removeItem(`training_hole_${parsed.id}`);
        }
        try {
          const res = await api.get(`/training/current?user_id=${loggedUser.id}`);
          if (res.data.group_id) {
            setCurrentGroup(res.data);
            navigate(`/training-scorecard/${res.data.group_id}`);
            return;
          } else {
            setCurrentGroup(null);
          }
        } catch {}
      }

      setCreateError(err.response?.data?.message || 'Erro ao criar treino.');
      setCreateLoading(false);
    } finally {
      isCreatingRef.current = false;
    }
  };

  const updateJoin = (lobbyId, patch) =>
    setJoinState(prev => ({ ...prev, [lobbyId]: { ...prev[lobbyId], ...patch } }));

  const toggleJoinInput = (lobbyId) =>
    setJoinState(prev => ({
      ...prev,
      [lobbyId]: prev[lobbyId]?.open
        ? { open: false, code: '', loading: false, error: '' }
        : { open: true,  code: '', loading: false, error: '' },
    }));

  const handleJoin = async (lobby) => {
    if (!loggedUser) { navigate('/login'); return; }
    const code = (joinState[lobby.id]?.code || '').trim().toUpperCase();
    if (!code) { updateJoin(lobby.id, { error: 'Digite o código.' }); return; }
    updateJoin(lobby.id, { loading: true, error: '' });
    try {
      const res = await api.post('/training/join', { access_code: code, user_id: loggedUser.id });
      localStorage.removeItem('activeTrainingGroup');
      navigate(`/training-scorecard/${res.data.table.id}`);
    } catch (err) {
      updateJoin(lobby.id, { loading: false, error: err.response?.data?.message || 'Código inválido.' });
    }
  };

  const s = {
    container:    { padding: '20px 16px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, fontFamily: "'Segoe UI', Roboto, sans-serif" },
    inner:        { maxWidth: '480px', margin: '0 auto' },
    header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: `1px solid ${theme.cardLight}` },
    btnBack:      { backgroundColor: 'transparent', color: theme.gold, border: `1px solid ${theme.gold}`, padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' },
    pageTitle:    { fontSize: '15px', fontWeight: 'bold', color: theme.textMain },
    sectionLabel: { color: theme.textMuted, fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '12px', marginTop: '24px' },
    btn:          { width: '100%', padding: '14px', borderRadius: '10px', border: 'none', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', marginBottom: '10px' },
    input:        { width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.cardLight, color: theme.textMain, fontSize: '15px', boxSizing: 'border-box', marginBottom: '12px' },
    select:       { width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.cardLight, color: theme.textMain, fontSize: '15px', boxSizing: 'border-box', marginBottom: '12px' },
    label:        { display: 'block', color: theme.textMuted, fontSize: '11px', fontWeight: 'bold', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '1px' },
    error:        { color: theme.danger, fontSize: '13px', textAlign: 'center', marginBottom: '10px' },
    card:         { backgroundColor: theme.card, borderRadius: '14px', padding: '18px', marginBottom: '10px', border: `1px solid ${theme.cardLight}` },
  };

  // ── Formulário de criação ──
  if (mode === 'create') {
    return (
      <div style={s.container}>
        <div style={s.inner}>
          <div style={s.header}>
            <button style={s.btnBack} onClick={() => { setMode(null); setCreateError(''); }}>⬅ VOLTAR</button>
            <span style={s.pageTitle}>Novo Grupo de Treino</span>
          </div>
          <div style={s.card}>
            <div style={{ color: theme.gold, fontSize: '18px', fontWeight: 'bold', textAlign: 'center', marginBottom: '20px' }}>
              Configurar Treino
            </div>
            {createError && <div style={s.error}>{createError}</div>}

            <label style={s.label}>Campo</label>
            <select style={s.select} value={courseId} onChange={e => setCourseId(e.target.value)}>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <label style={s.label}>Buraco de Saída</label>
            <select style={s.select} value={startingHole} onChange={e => setStartingHole(e.target.value)}>
              {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
                <option key={h} value={h}>Buraco {h}</option>
              ))}
            </select>

            <button style={{ ...s.btn, backgroundColor: theme.accent, color: '#000', marginTop: '8px' }}
              onClick={handleCreate} disabled={createLoading}>
              {createLoading ? 'Criando...' : 'Criar Treino'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Tela principal do Lobby ──
  return (
    <div style={s.container}>
      <div style={s.inner}>

        {/* Header com botão Voltar */}
        <div style={s.header}>
          <button style={s.btnBack} onClick={() => navigate('/', { replace: true })}>⬅ VOLTAR</button>
          <span style={s.pageTitle}>Treino do Dia</span>
        </div>

        {/* Ranking CTA */}
        <button
          style={{ ...s.btn, backgroundColor: theme.gold, color: '#000', fontWeight: '900', borderRadius: '12px', boxShadow: `0 6px 20px -4px ${theme.gold}55` }}
          onClick={() => navigate('/training-leaderboard')}
        >
          🏆 VER RANKING DO DIA
        </button>

        {/* Verificando sessão — substitui "Criar" enquanto o banco confirma o estado */}
        {isCheckingGroup && !currentGroup && (
          <div style={{ ...s.btn, backgroundColor: theme.cardLight, color: theme.textMuted, cursor: 'default', textAlign: 'center', borderRadius: '12px', fontSize: '14px' }}>
            Verificando sessão...
          </div>
        )}

        {/* Recovery: partida ativa */}
        {currentGroup?.status === 'ativo' && (
          <button
            style={{ ...s.btn, backgroundColor: theme.accent, color: '#000', borderRadius: '12px', fontWeight: '900', boxShadow: `0 6px 20px -4px ${theme.accent}55` }}
            onClick={() => navigate(`/training-scorecard/${currentGroup.group_id}`)}
          >
            ▶ Continuar Partida em Andamento
          </button>
        )}

        {/* Recovery: sala de espera */}
        {currentGroup?.status === 'aguardando' && (
          <button
            style={{ ...s.btn, backgroundColor: '#78350f', color: theme.gold, borderRadius: '12px', fontWeight: '900', border: `1px solid ${theme.gold}55` }}
            onClick={() => navigate(`/training-scorecard/${currentGroup.group_id}`)}
          >
            ⏳ Acessar minha Sala de Espera
          </button>
        )}

        {/* Criar — só aparece após o banco confirmar que não há grupo ativo */}
        {!isCheckingGroup && !currentGroup && (
          <button
            style={{ ...s.btn, backgroundColor: theme.accent, color: '#000', borderRadius: '12px' }}
            onClick={() => { setMode('create'); loadCourses(); }}
          >
            + Criar Novo Treino
          </button>
        )}

        {/* Lista de lobbies abertos */}
        <div style={s.sectionLabel}>Treinos em Aberto</div>

        {lobbiesLoading && (
          <p style={{ color: theme.textMuted, textAlign: 'center', fontSize: '14px' }}>Carregando...</p>
        )}

        {!lobbiesLoading && lobbies.length === 0 && (
          <div style={{ ...s.card, textAlign: 'center' }}>
            <p style={{ color: theme.textMuted, fontSize: '14px', margin: 0 }}>
              Nenhum treino aberto agora.<br />Crie o seu e convide atletas!
            </p>
          </div>
        )}

        {lobbies.map(lobby => {
          const isFull = lobby.player_count >= 4;
          const js     = joinState[lobby.id] || {};

          return (
            <div key={lobby.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: theme.textMain }}>{lobby.group_name}</div>
                  <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '2px' }}>
                    {lobby.creator_name} · {lobby.course_name || 'Campo'}
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: isFull ? theme.danger : theme.accent, fontWeight: 'bold', flexShrink: 0 }}>
                  {lobby.player_count}/4
                </div>
              </div>

              {lobby.players && lobby.players.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {lobby.players.map(p => (
                    <span key={p.id} style={{
                      padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
                      backgroundColor: theme.bg, color: theme.textMuted, border: `1px solid ${theme.cardLight}`,
                    }}>
                      {p.name}{lobby.creator_id === p.id ? ' ★' : ''}
                    </span>
                  ))}
                </div>
              )}

              {!currentGroup && !js.open && (
                <button
                  disabled={isFull}
                  onClick={() => !isFull && toggleJoinInput(lobby.id)}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                    backgroundColor: isFull ? theme.cardLight : theme.accent,
                    color: isFull ? theme.textMuted : '#000',
                    fontWeight: 'bold', fontSize: '14px',
                    cursor: isFull ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isFull ? 'Sala Lotada' : 'Entrar com Código'}
                </button>
              )}

              {!currentGroup && js.open && (
                <div>
                  {js.error && <div style={{ color: theme.danger, fontSize: '12px', marginBottom: '8px' }}>{js.error}</div>}
                  <input
                    autoFocus
                    placeholder="XXXXX"
                    maxLength={5}
                    value={js.code || ''}
                    onChange={e => updateJoin(lobby.id, { code: e.target.value.toUpperCase() })}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '8px',
                      border: `2px solid ${theme.accent}`, backgroundColor: theme.bg,
                      color: '#fff', fontSize: '22px', textAlign: 'center',
                      textTransform: 'uppercase', letterSpacing: '6px', fontWeight: '900',
                      boxSizing: 'border-box', outline: 'none', marginBottom: '8px',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: theme.cardLight, color: theme.textMain, fontWeight: 'bold', cursor: 'pointer' }}
                      onClick={() => toggleJoinInput(lobby.id)}
                    >Cancelar</button>
                    <button
                      disabled={js.loading}
                      onClick={() => handleJoin(lobby)}
                      style={{ flex: 2, padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: theme.accent, color: '#000', fontWeight: 'bold', cursor: 'pointer', opacity: js.loading ? 0.7 : 1 }}
                    >{js.loading ? 'Entrando...' : 'Confirmar'}</button>
                  </div>
                </div>
              )}

              {currentGroup && (
                <div style={{ padding: '8px 12px', backgroundColor: theme.bg, borderRadius: '8px', fontSize: '12px', color: theme.textMuted, textAlign: 'center' }}>
                  Você já está em um treino ativo
                </div>
              )}
            </div>
          );
        })}

        <div style={{ height: '40px' }} />
      </div>
    </div>
  );
}

export default DailyTraining;
