// frontend/src/pages/CircuitManagement.js
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { getUser } from '../services/authStorage';
import { useNavigate } from 'react-router-dom';
import AdminNavMenu from '../components/AdminNavMenu';
import { LuLink, LuTrash2, LuX } from 'react-icons/lu';

const theme = {
  bg:        '#0f172a',
  card:      '#1e293b',
  cardLight: '#334155',
  accent:    '#22c55e',
  gold:      '#eab308',
  textMain:  '#f8fafc',
  textMuted: '#94a3b8',
  danger:    '#ef4444',
  info:      '#38bdf8',
  purple:    '#a78bfa',
};

const s = {
  container:    { padding: '20px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: `1px solid ${theme.cardLight}`, paddingBottom: '15px', flexWrap: 'wrap', gap: '10px' },
  card:         { backgroundColor: theme.card, padding: '25px', borderRadius: '15px', marginBottom: '25px' },
  sectionTitle: { fontSize: '14px', color: theme.accent, fontWeight: 'bold', marginBottom: '15px', borderLeft: `4px solid ${theme.accent}`, paddingLeft: '10px', letterSpacing: '1px' },
  subTitle:     { fontSize: '14px', color: theme.purple, fontWeight: 'bold', marginBottom: '15px', borderLeft: `4px solid ${theme.purple}`, paddingLeft: '10px', letterSpacing: '1px' },
  formGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' },
  inputGroup:   { display: 'flex', flexDirection: 'column', gap: '8px' },
  label:        { fontSize: '12px', color: theme.textMuted, fontWeight: 'bold', letterSpacing: '0.5px' },
  input:        { padding: '12px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, fontSize: '14px' },
  textarea:     { padding: '12px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, minHeight: '70px', resize: 'vertical', fontSize: '14px' },
  btn:          { padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  btnPrimary:   { padding: '13px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', backgroundColor: theme.accent, color: '#000', width: '100%', marginTop: '20px' },
  circuitRow:   { backgroundColor: theme.bg, padding: '18px 20px', borderRadius: '10px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', border: `1px solid ${theme.cardLight}` },
  stageRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '8px', marginBottom: '8px', backgroundColor: theme.bg, border: `1px solid ${theme.cardLight}` },
  ruleRow:      { display: 'grid', gridTemplateColumns: '60px 1fr 40px', gap: '10px', alignItems: 'center', marginBottom: '8px' },
  badge:        (color) => ({ backgroundColor: color, color: '#000', fontSize: '10px', fontWeight: 'bold', padding: '3px 9px', borderRadius: '10px', display: 'inline-block' }),
  divider:      { borderTop: `1px solid ${theme.cardLight}`, margin: '25px 0' },
};

export default function CircuitManagement() {
  const navigate = useNavigate();

  const [circuits,    setCircuits]    = useState([]);
  const [tournaments, setTournaments] = useState([]);

  // Create / Edit form
  const [formName,         setFormName]         = useState('');
  const [formDesc,         setFormDesc]         = useState('');
  const [formTotalStages,  setFormTotalStages]  = useState('');
  const [formNumDiscards,  setFormNumDiscards]  = useState('0');
  const [isEditing,        setIsEditing]        = useState(false);
  const [editId,           setEditId]           = useState(null);

  // Management panel (rules + stages)
  const [managing, setManaging] = useState(null);
  const [rules,    setRules]    = useState([]);
  const [stages,   setStages]   = useState([]);

  // Add-stage form
  const [newStageTournId, setNewStageTournId] = useState('');
  const [newStageNumber,  setNewStageNumber]  = useState('');

  // Scorecard edit
  const [editStageId,  setEditStageId]  = useState('');
  const [editPlayers,  setEditPlayers]  = useState([]);
  const [editPlayerId, setEditPlayerId] = useState('');
  const [editHoleData, setEditHoleData] = useState([]);
  const [editValues,   setEditValues]   = useState({});
  const [savingEdit,   setSavingEdit]   = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState('');

  // Sponsors
  const [allSponsors,       setAllSponsors]       = useState([]);
  const [circuitSponsorIds, setCircuitSponsorIds] = useState(new Set());
  const [sponsorName,       setSponsorName]       = useState('');
  const [sponsorLogoUrl,    setSponsorLogoUrl]    = useState('');
  const [sponsorLinkUrl,    setSponsorLinkUrl]    = useState('');
  const [savingSponsor,     setSavingSponsor]     = useState(false);

  // ── data loaders ──────────────────────────────────────────────────────────
  const loadCircuits = useCallback(async () => {
    try {
      const res = await api.get('/circuits');
      setCircuits(res.data);
    } catch (e) { console.error(e); }
  }, []);

  const loadTournaments = useCallback(async () => {
    try {
      const res = await api.get('/tournaments/list');
      setTournaments(res.data);
    } catch (e) { console.error(e); }
  }, []);

  const loadManaging = useCallback(async (id) => {
    try {
      const [res, spRes] = await Promise.all([
        api.get(`/circuits/${id}`),
        api.get(`/circuits/${id}/sponsors`),
      ]);
      setManaging(res.data);
      setRules(res.data.rules.map(r => ({ position: r.position, points: String(r.points) })));
      setStages(res.data.stages);
      setCircuitSponsorIds(new Set(spRes.data.map(s => s.id)));
    } catch (e) { console.error(e); }
  }, []);

  const loadAllSponsors = useCallback(async () => {
    try {
      const res = await api.get('/circuits/sponsors');
      setAllSponsors(res.data);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    const user = getUser();
    if (!user) { navigate('/login'); return; }
    if (user.role !== 'ADMIN') { navigate('/'); return; }
    loadCircuits();
    loadTournaments();
    loadAllSponsors();
  }, [navigate, loadCircuits, loadTournaments, loadAllSponsors]);

  // ── circuit create / edit ─────────────────────────────────────────────────
  const handleSubmitCircuit = async (e) => {
    e.preventDefault();
    if (!formName) return alert('O nome é obrigatório.');
    const payload = {
      name:         formName,
      description:  formDesc,
      total_stages: Number(formTotalStages) || 0,
      num_discards: Number(formNumDiscards) || 0,
    };
    try {
      if (isEditing) {
        await api.put(`/circuits/${editId}`, payload);
      } else {
        await api.post('/circuits', payload);
      }
      resetForm();
      loadCircuits();
    } catch (e) { alert('Erro ao salvar circuito.'); }
  };

  const handleEditCircuit = (c) => {
    setFormName(c.name);
    setFormDesc(c.description || '');
    setFormTotalStages(String(c.total_stages || ''));
    setFormNumDiscards(String(c.num_discards || 0));
    setIsEditing(true);
    setEditId(c.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteCircuit = async (id, name) => {
    if (!window.confirm(`Excluir o circuito "${name}" e todas as suas etapas/regras?`)) return;
    try {
      await api.delete(`/circuits/${id}`);
      if (managing?.id === id) setManaging(null);
      loadCircuits();
    } catch (e) { alert('Erro ao excluir.'); }
  };

  const resetForm = () => {
    setFormName(''); setFormDesc(''); setFormTotalStages(''); setFormNumDiscards('0');
    setIsEditing(false); setEditId(null);
  };

  const handleCopyLink = async (circuitId) => {
    const url = `${window.location.origin}/ranking/${circuitId}`;
    try {
      await navigator.clipboard.writeText(url);
      setToastMsg('Link do Ranking copiado!');
    } catch {
      setToastMsg('Erro ao copiar. Tente manualmente.');
    }
    setTimeout(() => setToastMsg(''), 2800);
  };

  // ── rules ─────────────────────────────────────────────────────────────────
  const addRuleRow = () => {
    setRules(prev => [...prev, { position: prev.length + 1, points: '' }]);
  };

  const removeRuleRow = (idx) => {
    setRules(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((r, i) => ({ ...r, position: i + 1 }));
    });
  };

  const handleRulePointsChange = (idx, val) => {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, points: val } : r));
  };

  const handleSaveRules = async () => {
    if (!managing) return;
    const payload = rules
      .filter(r => r.points !== '')
      .map(r => ({ position: r.position, points: Number(r.points) }));
    try {
      await api.post(`/circuits/${managing.id}/rules`, { rules: payload });
      alert('Regras salvas!');
      loadManaging(managing.id);
    } catch (e) { alert('Erro ao salvar regras.'); }
  };

  // ── stages ────────────────────────────────────────────────────────────────
  const handleAddStage = async (e) => {
    e.preventDefault();
    if (!newStageTournId || !newStageNumber) return alert('Selecione o torneio e o número da etapa.');
    try {
      await api.post(`/circuits/${managing.id}/stages`, {
        tournament_id: Number(newStageTournId),
        stage_number:  Number(newStageNumber),
      });
      setNewStageTournId(''); setNewStageNumber('');
      loadManaging(managing.id);
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao adicionar etapa.');
    }
  };

  const handleRemoveStage = async (stageId) => {
    if (!window.confirm('Remover esta etapa do circuito?')) return;
    try {
      await api.delete(`/circuits/${managing.id}/stages/${stageId}`);
      loadManaging(managing.id);
    } catch (e) { alert('Erro ao remover etapa.'); }
  };

  const handleManage = (c) => {
    if (managing?.id === c.id) {
      setManaging(null);
      setEditStageId(''); setEditPlayers([]); setEditPlayerId('');
      setEditHoleData([]); setEditValues({});
      return;
    }
    loadManaging(c.id);
    setTimeout(() => document.getElementById('management-panel')?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // ── sponsors ──────────────────────────────────────────────────────────────
  const mediaUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001') + url;
  };

  const handleSponsorFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const res = await api.post('/sponsors/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSponsorLogoUrl(res.data.url);
    } catch { alert('Erro ao fazer upload da imagem.'); }
  };

  const handleCreateSponsor = async () => {
    if (!sponsorName) return alert('O nome é obrigatório.');
    setSavingSponsor(true);
    try {
      await api.post('/circuits/sponsors', { name: sponsorName, logo_url: sponsorLogoUrl, link_url: sponsorLinkUrl });
      setSponsorName(''); setSponsorLogoUrl(''); setSponsorLinkUrl('');
      await loadAllSponsors();
    } catch (e) { alert('Erro ao criar patrocinador.'); }
    finally { setSavingSponsor(false); }
  };

  const handleDeleteSponsor = async (id, name) => {
    if (!window.confirm(`Excluir o patrocinador "${name}"?`)) return;
    try {
      await api.delete(`/circuits/sponsors/${id}`);
      setCircuitSponsorIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      await loadAllSponsors();
    } catch (e) { alert('Erro ao excluir patrocinador.'); }
  };

  const handleToggleSponsor = async (sponsorId, isLinked) => {
    if (!managing) return;
    try {
      if (isLinked) {
        await api.delete(`/circuits/${managing.id}/sponsors/${sponsorId}`);
        setCircuitSponsorIds(prev => { const s = new Set(prev); s.delete(sponsorId); return s; });
      } else {
        await api.post(`/circuits/${managing.id}/sponsors`, { sponsor_id: sponsorId });
        setCircuitSponsorIds(prev => new Set([...prev, sponsorId]));
      }
    } catch (e) { alert('Erro ao alterar vínculo.'); }
  };

  // ── scorecard edit ────────────────────────────────────────────────────────
  const handleSelectEditStage = async (stageId) => {
    setEditStageId(stageId);
    setEditPlayerId(''); setEditHoleData([]); setEditValues([]);
    if (!stageId) { setEditPlayers([]); return; }
    const stage = stages.find(s => String(s.id) === stageId);
    if (!stage) return;
    try {
      const res = await api.get(`/leaderboard/${stage.tournament_id}`);
      setEditPlayers(res.data.filter(p => p.holes_played > 0));
    } catch (e) { console.error(e); }
  };

  const handleSelectEditPlayer = async (playerId) => {
    setEditPlayerId(playerId);
    setEditHoleData([]); setEditValues({});
    if (!playerId || !editStageId) return;
    const stage = stages.find(s => String(s.id) === editStageId);
    if (!stage) return;
    try {
      const res = await api.get(`/leaderboard/details/${stage.tournament_id}/${playerId}`);
      setEditHoleData(res.data);
      const vals = {};
      res.data.forEach(h => { vals[h.hole_number] = String(h.strokes); });
      setEditValues(vals);
    } catch (e) { console.error(e); }
  };

  const handleSaveEdit = async () => {
    if (!editPlayerId || !editStageId || !editHoleData.length) return;
    const stage = stages.find(s => String(s.id) === editStageId);
    setSavingEdit(true);
    try {
      for (const h of editHoleData) {
        const newVal = Number(editValues[h.hole_number]);
        if (!isNaN(newVal) && newVal >= 1) {
          await api.put(`/circuits/${managing.id}/stages/${stage.id}/scorecard`, {
            user_id:     Number(editPlayerId),
            hole_number: h.hole_number,
            strokes:     newVal,
          });
        }
      }
      alert('Scorecard salvo!');
    } catch {
      alert('Erro ao salvar scorecard.');
    } finally {
      setSavingEdit(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={s.container}>

      <AdminNavMenu />

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px' }}>Circuitos / Ligas</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: theme.textMuted }}>
            Gerencie os circuitos anuais e vincule torneios como etapas.
          </p>
        </div>
      </div>

      {/* FORM: CREATE / EDIT CIRCUIT */}
      <div style={{ ...s.card, border: isEditing ? `1px solid ${theme.info}` : 'none' }}>
        <div style={s.sectionTitle}>{isEditing ? 'EDITAR CIRCUITO' : 'NOVO CIRCUITO'}</div>
        <form onSubmit={handleSubmitCircuit}>
          <div style={s.formGrid}>
            <div style={s.inputGroup}>
              <label style={s.label}>NOME DO CIRCUITO *</label>
              <input style={s.input} value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Liga 2025" required />
            </div>
            <div style={s.inputGroup}>
              <label style={s.label}>ETAPAS PREVISTAS</label>
              <input style={s.input} type="number" min="1" value={formTotalStages} onChange={e => setFormTotalStages(e.target.value)} placeholder="Ex: 5" />
            </div>
            <div style={s.inputGroup}>
              <label style={s.label}>QUANTIDADE DE DESCARTES</label>
              <input
                style={s.input}
                type="number"
                min="0"
                max="10"
                value={formNumDiscards}
                onChange={e => setFormNumDiscards(e.target.value)}
                placeholder="0"
              />
              <span style={{ fontSize: '11px', color: Number(formNumDiscards) > 0 ? theme.accent : theme.textMuted }}>
                {Number(formNumDiscards) > 0
                  ? `As ${formNumDiscards} piores etapas de cada jogador serão descartadas.`
                  : '0 = todas as etapas contam.'}
              </span>
            </div>
          </div>

          <div style={{ ...s.inputGroup, marginTop: '20px' }}>
            <label style={s.label}>DESCRIÇÃO</label>
            <textarea style={s.textarea} value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Regras gerais, premiação, etc." />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button type="submit" style={{ ...s.btnPrimary, marginTop: 0, flex: 1, backgroundColor: isEditing ? theme.info : theme.accent }}>
              {isEditing ? 'SALVAR ALTERAÇÕES' : 'CRIAR CIRCUITO'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm} style={{ ...s.btn, backgroundColor: theme.cardLight, color: theme.textMuted, padding: '13px 20px' }}>
                CANCELAR
              </button>
            )}
          </div>
        </form>
      </div>

      {/* CIRCUIT LIST */}
      <h3 style={{ fontSize: '13px', color: theme.textMuted, letterSpacing: '1px', marginBottom: '15px' }}>
        CIRCUITOS CADASTRADOS
      </h3>

      {circuits.length === 0 && (
        <div style={{ ...s.card, textAlign: 'center', color: theme.textMuted, padding: '40px' }}>
          Nenhum circuito cadastrado ainda.
        </div>
      )}

      {circuits.map(c => (
        <div key={c.id} style={{ ...s.circuitRow, borderLeft: `5px solid ${managing?.id === c.id ? theme.purple : theme.accent}` }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 'bold' }}>{c.name}</div>
            {c.description && <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '4px' }}>{c.description}</div>}
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={s.badge(theme.cardLight)}>
                {c.total_stages} etapa{c.total_stages !== 1 ? 's' : ''}
              </span>
              <span style={s.badge((c.num_discards || 0) > 0 ? theme.accent : theme.cardLight)}>
                {(c.num_discards || 0) > 0
                  ? `${c.num_discards} descarte${c.num_discards > 1 ? 's' : ''}`
                  : 'Sem descarte'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleManage(c)}
              style={{ ...s.btn, backgroundColor: managing?.id === c.id ? theme.purple : theme.cardLight, color: '#fff' }}
            >
              {managing?.id === c.id ? 'FECHAR' : 'GERENCIAR'}
            </button>
            <button onClick={() => window.open(`/ranking/${c.id}`, '_blank')} style={{ ...s.btn, backgroundColor: theme.gold, color: '#000' }}>
              RANKING
            </button>
            <button
              onClick={() => handleCopyLink(c.id)}
              title="Copiar link para enviar aos jogadores"
              style={{
                ...s.btn,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.accent}`,
                color: theme.accent,
                padding: '9px 12px',
                fontSize: '15px',
                lineHeight: 1,
              }}
            >
              <LuLink size={15} />
            </button>
            <button onClick={() => handleEditCircuit(c)} style={{ ...s.btn, backgroundColor: theme.info, color: '#000' }}>
              EDITAR
            </button>
            <button onClick={() => handleDeleteCircuit(c.id, c.name)} style={{ ...s.btn, backgroundColor: theme.danger, color: '#fff' }}>
              <LuTrash2 size={15} />
            </button>
          </div>
        </div>
      ))}

      {/* MANAGEMENT PANEL */}
      {managing && (
        <div id="management-panel" style={{ ...s.card, border: `1px solid ${theme.purple}`, marginTop: '10px' }}>
          <h2 style={{ margin: '0 0 5px', color: theme.purple, fontSize: '18px' }}>
            Gerenciando: {managing.name}
          </h2>
          <p style={{ margin: '0 0 25px', fontSize: '12px', color: theme.textMuted }}>
            Defina as regras de pontuação e vincule os torneios como etapas abaixo.
          </p>

          <div style={s.divider} />

          {/* ── RULES ── */}
          <div style={s.subTitle}>TABELA DE PONTUAÇÃO POR POSIÇÃO</div>
          <p style={{ fontSize: '12px', color: theme.textMuted, marginTop: '-8px', marginBottom: '15px' }}>
            Defina quantos pontos cada posição final recebe nos torneios deste circuito.
          </p>

          {rules.length === 0 && (
            <p style={{ fontSize: '13px', color: theme.textMuted, marginBottom: '12px' }}>Nenhuma regra definida. Clique em "+ Posição" para começar.</p>
          )}

          {rules.map((r, idx) => (
            <div key={idx} style={s.ruleRow}>
              <div style={{ textAlign: 'center', backgroundColor: theme.cardLight, borderRadius: '6px', padding: '8px', fontWeight: 'bold', fontSize: '13px' }}>
                {r.position}º
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Pontos"
                  style={{ ...s.input, paddingRight: '45px' }}
                  value={r.points}
                  onChange={e => handleRulePointsChange(idx, e.target.value)}
                />
                <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: theme.textMuted, fontSize: '12px' }}>pts</span>
              </div>
              <button type="button" onClick={() => removeRuleRow(idx)} style={{ ...s.btn, backgroundColor: theme.danger, color: '#fff', padding: '8px' }}>
                <LuX size={14} />
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button type="button" onClick={addRuleRow} style={{ ...s.btn, backgroundColor: theme.cardLight, color: theme.textMain }}>
              + Posição
            </button>
            <button type="button" onClick={handleSaveRules} style={{ ...s.btn, backgroundColor: theme.purple, color: '#fff' }}>
              SALVAR REGRAS
            </button>
          </div>

          <div style={s.divider} />

          {/* ── STAGES ── */}
          <div style={s.subTitle}>ETAPAS DO CIRCUITO</div>
          <p style={{ fontSize: '12px', color: theme.textMuted, marginTop: '-8px', marginBottom: '15px' }}>
            Vincule torneios já existentes como etapas numeradas deste circuito.
          </p>

          {stages.length === 0 && (
            <p style={{ fontSize: '13px', color: theme.textMuted, marginBottom: '15px' }}>Nenhuma etapa vinculada ainda.</p>
          )}
          {stages.map(st => {
            const tourn = tournaments.find(t => t.id === st.tournament_id);
            return (
              <div key={st.id} style={s.stageRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ ...s.badge(theme.purple), fontSize: '12px', padding: '5px 10px' }}>Etapa {st.stage_number}</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{st.tournament_name}</div>
                    {tourn && (
                      <div style={{ fontSize: '11px', color: theme.textMuted, marginTop: '2px' }}>
                        {tourn.course_name ? `${tourn.course_name} · ` : ''}{new Date(tourn.start_date).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveStage(st.id)}
                  style={{ ...s.btn, backgroundColor: theme.danger, color: '#fff', padding: '6px 12px', fontSize: '12px' }}
                >
                  Remover
                </button>
              </div>
            );
          })}

          {/* Add-stage form */}
          <form onSubmit={handleAddStage} style={{ marginTop: '15px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '10px', alignItems: 'end' }}>
              <div style={s.inputGroup}>
                <label style={s.label}>TORNEIO</label>
                <select
                  style={s.input}
                  value={newStageTournId}
                  onChange={e => setNewStageTournId(e.target.value)}
                  required
                >
                  <option value="">Selecione um torneio...</option>
                  {tournaments
                    .filter(t => !stages.some(st => st.tournament_id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({new Date(t.start_date).toLocaleDateString('pt-BR')})
                      </option>
                    ))}
                </select>
              </div>
              <div style={s.inputGroup}>
                <label style={s.label}>Nº ETAPA</label>
                <input
                  style={{ ...s.input, width: '80px' }}
                  type="number"
                  min="1"
                  placeholder="1"
                  value={newStageNumber}
                  onChange={e => setNewStageNumber(e.target.value)}
                  required
                />
              </div>
              <button type="submit" style={{ ...s.btn, backgroundColor: theme.accent, color: '#000', height: '46px', whiteSpace: 'nowrap' }}>
                + VINCULAR
              </button>
            </div>
          </form>

          <div style={s.divider} />

          {/* ── SCORECARD EDIT ── */}
          <div style={s.subTitle}>EDITAR SCORECARD (ADMIN)</div>
          <p style={{ fontSize: '12px', color: theme.textMuted, marginTop: '-8px', marginBottom: '15px' }}>
            Corrija as tacadas de qualquer jogador em etapas já encerradas.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '15px' }}>
            <div style={s.inputGroup}>
              <label style={s.label}>ETAPA</label>
              <select
                style={s.input}
                value={editStageId}
                onChange={e => handleSelectEditStage(e.target.value)}
              >
                <option value="">Selecione uma etapa...</option>
                {stages
                  .filter(st => st.tournament_status === 'concluido')
                  .map(st => (
                    <option key={st.id} value={st.id}>
                      Etapa {st.stage_number} — {st.tournament_name}
                    </option>
                  ))}
              </select>
            </div>

            {editStageId && (
              <div style={s.inputGroup}>
                <label style={s.label}>JOGADOR</label>
                <select
                  style={s.input}
                  value={editPlayerId}
                  onChange={e => handleSelectEditPlayer(e.target.value)}
                >
                  <option value="">Selecione um jogador...</option>
                  {editPlayers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {editHoleData.length > 0 && (
            <div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                gap: '8px',
                marginBottom: '15px'
              }}>
                {editHoleData
                  .slice()
                  .sort((a, b) => a.hole_number - b.hole_number)
                  .map(h => (
                    <div key={h.hole_number} style={{
                      backgroundColor: theme.bg, borderRadius: '8px', padding: '8px',
                      border: `1px solid ${theme.cardLight}`, textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '10px', color: theme.textMuted, marginBottom: '4px' }}>
                        B{h.hole_number} · P{h.par}
                      </div>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        style={{
                          ...s.input,
                          textAlign: 'center',
                          padding: '6px 4px',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          width: '100%',
                          boxSizing: 'border-box',
                        }}
                        value={editValues[h.hole_number] ?? ''}
                        onChange={e => setEditValues(prev => ({ ...prev, [h.hole_number]: e.target.value }))}
                      />
                    </div>
                  ))}
              </div>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                style={{ ...s.btn, backgroundColor: theme.accent, color: '#000', padding: '10px 24px', opacity: savingEdit ? 0.6 : 1 }}
              >
                {savingEdit ? 'Salvando...' : 'SALVAR SCORECARD'}
              </button>
            </div>
          )}

          {editStageId && editPlayerId && editHoleData.length === 0 && (
            <p style={{ fontSize: '12px', color: theme.textMuted }}>Nenhum buraco marcado encontrado para este jogador.</p>
          )}

          <div style={s.divider} />

          {/* ── SPONSORS ── */}
          <div style={s.subTitle}>PATROCINADORES DO CIRCUITO</div>
          <p style={{ fontSize: '12px', color: theme.textMuted, marginTop: '-8px', marginBottom: '15px' }}>
            Vincule patrocinadores a este circuito. Eles aparecem na barra pública do ranking.
          </p>

          {allSponsors.length === 0 && (
            <p style={{ fontSize: '13px', color: theme.textMuted, marginBottom: '12px' }}>Nenhum patrocinador cadastrado no clube. Crie um abaixo.</p>
          )}

          {allSponsors.map(sp => {
            const linked = circuitSponsorIds.has(sp.id);
            return (
              <div key={sp.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 14px', borderRadius: '8px', marginBottom: '8px',
                backgroundColor: theme.bg,
                border: `1px solid ${linked ? theme.accent : theme.cardLight}`,
              }}>
                <div style={{ width: '72px', height: '44px', backgroundColor: '#fff', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                  {sp.logo_url
                    ? <img src={mediaUrl(sp.logo_url)} alt={sp.name} style={{ maxWidth: '68px', maxHeight: '40px', objectFit: 'contain' }} />
                    : <span style={{ fontSize: '9px', color: '#9ca3af', textAlign: 'center', padding: '2px' }}>sem logo</span>
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{sp.name}</div>
                  {sp.link_url && <div style={{ fontSize: '11px', color: theme.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.link_url}</div>}
                </div>
                <button
                  onClick={() => handleToggleSponsor(sp.id, linked)}
                  style={{ ...s.btn, backgroundColor: linked ? theme.accent : theme.cardLight, color: linked ? '#000' : theme.textMain, fontSize: '11px', whiteSpace: 'nowrap' }}
                >
                  {linked ? 'DESVINCULAR' : 'VINCULAR'}
                </button>
                <button
                  onClick={() => handleDeleteSponsor(sp.id, sp.name)}
                  style={{ ...s.btn, backgroundColor: theme.danger, color: '#fff', padding: '8px 10px' }}
                >
                  <LuTrash2 size={14} />
                </button>
              </div>
            );
          })}

          <div style={{ marginTop: '15px', padding: '14px', borderRadius: '10px', border: `1px dashed ${theme.cardLight}` }}>
            <div style={{ fontSize: '11px', color: theme.textMuted, marginBottom: '10px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              ADICIONAR PATROCINADOR AO CLUBE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div style={s.inputGroup}>
                <label style={s.label}>NOME *</label>
                <input style={s.input} value={sponsorName} onChange={e => setSponsorName(e.target.value)} placeholder="Ex: Nike Golf" />
              </div>
              <div style={s.inputGroup}>
                <label style={s.label}>LINK DO PATROCINADOR (opcional)</label>
                <input style={s.input} value={sponsorLinkUrl} onChange={e => setSponsorLinkUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>

            {/* Logo upload */}
            <div style={{ marginBottom: '12px' }}>
              <label style={s.label}>LOGO (upload ou URL)</label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                <label style={{
                  padding: '9px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
                  border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain,
                  display: 'inline-block', whiteSpace: 'nowrap',
                }}>
                  ESCOLHER ARQUIVO
                  <input type="file" accept="image/*" onChange={handleSponsorFileChange} style={{ display: 'none' }} />
                </label>
                <span style={{ fontSize: '11px', color: theme.textMuted }}>ou</span>
                <input
                  style={{ ...s.input, flex: 1, minWidth: '180px' }}
                  value={sponsorLogoUrl}
                  onChange={e => setSponsorLogoUrl(e.target.value)}
                  placeholder="Cole a URL da imagem..."
                />
                {sponsorLogoUrl && (
                  <div style={{ width: '56px', height: '40px', backgroundColor: '#fff', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                    <img src={mediaUrl(sponsorLogoUrl)} alt="preview" style={{ maxWidth: '52px', maxHeight: '36px', objectFit: 'contain' }} />
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleCreateSponsor}
              disabled={savingSponsor}
              style={{ ...s.btn, backgroundColor: theme.purple, color: '#fff', padding: '10px 20px', opacity: savingSponsor ? 0.6 : 1 }}
            >
              {savingSponsor ? 'Salvando...' : '+ CRIAR PATROCINADOR'}
            </button>
          </div>
        </div>
      )}

      {/* TOAST — bottom 85px + zIndex 10000 pra ficar acima da GlobalSponsorsBar
          (bottom:0, altura 65px, z-index 9999 em App.js). Se a barra não existir,
          fica um pouco alto mas ainda legível. */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '85px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 10000,
          backgroundColor: theme.accent, color: '#000',
          padding: '12px 24px', borderRadius: '10px',
          fontSize: '14px', fontWeight: '700',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          zIndex: 9999,
          whiteSpace: 'nowrap',
          animation: 'toastIn 0.2s ease',
        }}>
          {toastMsg}
        </div>
      )}

      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}
