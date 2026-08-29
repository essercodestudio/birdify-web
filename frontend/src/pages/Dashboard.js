// frontend/src/pages/Dashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { getUser } from '../services/authStorage';
import { useNavigate } from 'react-router-dom';
import AdminNavMenu from '../components/AdminNavMenu';
import { downloadFile } from '../services/download';
import { mediaUrl } from '../services/media';
import { LuCalendarDays, LuMapPin, LuLink, LuTrash2, LuUpload, LuX } from 'react-icons/lu';
import { TOURNAMENT_CATEGORIES } from '../utils/categories';

// ─── helpers de fuso horário (Brasília) ──────────────────────────────────────
const TZ = 'America/Sao_Paulo';

// Formata qualquer data/datetime no formato brasileiro: DD/MM/YYYY HH:mm
const fmtBR = (dateStr) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('pt-BR', {
      timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
};

// Prepara valor para <input type="datetime-local"> em horário de Brasília
const formatForInput = (d) => {
  if (!d) return '';
  // toLocaleString('sv-SE') dá formato "YYYY-MM-DD HH:MM:SS" sem sufixo de fuso
  return new Date(d).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16);
};

// True se a data do torneio for hoje em horário de Brasília
const isToday = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: TZ });
  const n = new Date().toLocaleDateString('pt-BR', { timeZone: TZ });
  return d === n;
};

// "Agora" no formato do <input type="datetime-local">, em horário de Brasília.
// Usa TZ pra bater com o que o input mostra pro admin.
const nowLocalInput = () =>
  new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16);

// Sanidade: impede ano absurdo tipo 9999 (o max do input já cobre no clique, mas
// mensagem melhor se o admin colar/digitar).
const validYear = (dateStr) => {
  if (!dateStr) return true;
  const y = new Date(dateStr).getFullYear();
  return y >= 2020 && y <= 2035;
};

// Item 1+2 (2026-08-28 tarde): a aba "Treinos do Dia" que existia aqui foi
// EXTRAÍDA pra tela própria em /admin/treinos (AdminTrainings), agrupada por
// dia. O Dashboard voltou a ser só de torneios, alinhado ao pedido "Meus
// Torneios mostra SÓ torneios de verdade".
function Dashboard() {
  const navigate = useNavigate();

  const [tournaments, setTournaments] = useState([]);
  const [courses, setCourses] = useState([]);

  const [newTournamentName, setNewTournamentName] = useState('');
  const [newTournamentDate, setNewTournamentDate] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [format, setFormat] = useState('shotgun');
  const [description, setDescription] = useState('');
  const [paymentInfo, setPaymentInfo] = useState('');
  const [fee, setFee] = useState('');

  // Máscara de moeda: usuário digita só números e o campo formata como R$ automaticamente.
  // Estilo "centavos" (padrão bancário BR): 15000 → R$ 150,00. Campo vazio permanece vazio.
  const formatFeeBRL = (raw) => {
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return '';
    return (parseInt(digits, 10) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const [pixKeyType, setPixKeyType] = useState('Chave Aleatória'); 
  const [whatsappContact, setWhatsappContact] = useState('');
  const [registrationDeadline, setRegistrationDeadline] = useState('');
  
  const [sponsors, setSponsors] = useState([]);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorLogo, setSponsorLogo] = useState('');
  const [sponsorUploading, setSponsorUploading] = useState(false);

  // Fonte única das categorias — utils/categories.js (compartilhada com os leaderboards)
  const defaultCategories = TOURNAMENT_CATEGORIES;
  const [selectedCategories, setSelectedCategories] = useState([]);

  const [isEditing, setIsEditing] = useState(false);
  const [editTournamentId, setEditTournamentId] = useState(null);

  // Item 5 · commit 3 (2026-08-28): torneio multi-rodada.
  // Toggle default OFF → UX antiga preservada (backend cria round 1 sozinho).
  // Toggle ON → admin preenche N rodadas (round_date + course_id por rodada).
  // Regras validadas server-side: length==total_rounds, sequencial 1..N,
  // round_date estritamente crescente, cursos do clube.
  const [multiRound, setMultiRound] = useState(false);
  const [rounds, setRounds] = useState([]); // [{round_number, round_date, course_id}]

  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: '#22c55e',
    gold: '#eab308',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444',
    info: '#38bdf8'
  };

  const fetchTournaments = useCallback(async () => {
    try {
      const response = await api.get('/tournaments/list');
      setTournaments(response.data);
    } catch (error) { console.error("Erro ao buscar torneios:", error); }
  }, []);

  const fetchCourses = useCallback(async () => {
    try {
      const response = await api.get('/courses/list');
      setCourses(response.data);
    } catch (error) { console.error("Erro ao buscar campos:", error); }
  }, []);

  useEffect(() => {
    const parsedUser = getUser();
    if (!parsedUser) { navigate('/login'); return; }
    if (parsedUser.role !== 'ADMIN') { navigate('/'); return; }
    fetchTournaments();
    fetchCourses();
  }, [navigate, fetchTournaments, fetchCourses]);

  const handleCopyLink = (id) => {
    const link = `${window.location.origin}/leaderboard/${id}?public=true`;
    navigator.clipboard.writeText(link).then(() => {
      alert("Link Público copiado!");
    });
  };
  const toggleCategory = (cat) => {
    setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const handleAddSponsor = (e) => {
    e.preventDefault();
    if(sponsorName) {
        setSponsors([...sponsors, { name: sponsorName, image_url: sponsorLogo }]);
        setSponsorName(''); setSponsorLogo('');
    }
  };

  // Upload da logo do patrocinador — reaproveita /api/sponsors/upload.
  // Não adiciona à lista sozinho: preenche sponsorLogo e o admin clica em
  // "ADICIONAR" quando o nome + logo estiverem prontos.
  const handleSponsorLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSponsorUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await api.post('/sponsors/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSponsorLogo(res.data.url);
    } catch (err) {
      alert(err.response?.data?.error || 'Falha no upload da logo.');
    } finally {
      setSponsorUploading(false);
    }
  };

  const handleExport = async (id) => {
    try {
      await downloadFile(`/export/${id}`, `torneio_${id}.xlsx`);
    } catch {
      alert('Erro ao exportar. Confira se você está logado como administrador do clube.');
    }
  };

  const handleDeleteTournament = async (id, name) => {
    if (window.confirm(`ATENÇÃO: Deseja excluir "${name}"?`) && window.confirm(`TEM CERTEZA ABSOLUTA?`)) {
        try { await api.delete(`/tournaments/delete/${id}`); fetchTournaments(); }
        catch (e) { alert('Erro ao excluir.'); }
    }
  };

  const handleToggleStatus = async (id, status) => {
    const newStatus = status === 'OPEN' ? 'concluido' : 'OPEN';
    if (window.confirm(`Deseja alterar o status?`)) {
        try { await api.put(`/tournaments/status/${id}`, { status: newStatus }); fetchTournaments(); }
        catch (e) { alert('Erro no status.'); }
    }
  };

  const handleSubmitTournament = async (e) => {
    e.preventDefault();
    if (!selectedCourseId || selectedCategories.length === 0) { alert("Preencha os campos obrigatórios e escolha pelo menos 1 categoria."); return; }
    if (!validYear(newTournamentDate)) { alert('Ano da data do torneio inválido.'); return; }
    if (registrationDeadline && !validYear(registrationDeadline)) { alert('Ano da data limite inválido.'); return; }

    // Não permite data no passado (só na criação — em edição de torneio antigo,
    // a data pode legitimamente já ter passado; nesse caso só valida consistência)
    const now = nowLocalInput();
    if (!isEditing) {
      if (newTournamentDate && newTournamentDate < now) {
        alert('A data do torneio deve ser futura.'); return;
      }
      if (registrationDeadline && registrationDeadline < now) {
        alert('A data limite de inscrição deve ser futura.'); return;
      }
    }
    if (registrationDeadline && newTournamentDate && registrationDeadline >= newTournamentDate) {
      alert('A data limite de inscrição deve ser anterior à data do torneio.'); return;
    }

    // Item 5 · commit 3: valida rounds client-side antes de submeter — bate com as
    // regras do backend (validateRoundsPayload) pra dar feedback imediato. Ordem
    // estritamente crescente, sequência 1..N, curso preenchido em cada linha.
    let roundsPayload = undefined;
    let totalRoundsPayload = 1;
    if (multiRound) {
      if (rounds.length < 2 || rounds.length > 10) {
        alert('Torneio multi-rodada precisa entre 2 e 10 rodadas.'); return;
      }
      for (let i = 0; i < rounds.length; i++) {
        const r = rounds[i];
        if (Number(r.round_number) !== i + 1) {
          alert(`Numeração das rodadas precisa ser 1..${rounds.length} sem gaps.`); return;
        }
        if (!r.round_date || !validYear(r.round_date)) {
          alert(`R${r.round_number}: data inválida.`); return;
        }
        if (!r.course_id) {
          alert(`R${r.round_number}: escolha o campo.`); return;
        }
        if (i > 0 && r.round_date <= rounds[i - 1].round_date) {
          alert(`R${r.round_number} precisa ser depois de R${r.round_number - 1}.`); return;
        }
        if (!isEditing && r.round_date < now) {
          alert(`R${r.round_number}: data no passado.`); return;
        }
      }
      roundsPayload = rounds.map(r => ({
        round_number: Number(r.round_number),
        round_date: r.round_date,
        course_id: Number(r.course_id),
      }));
      totalRoundsPayload = rounds.length;
    }

    const payload = {
      name: newTournamentName, start_date: newTournamentDate, course_id: selectedCourseId,
      description, fee, payment_info: paymentInfo, pix_key_type: pixKeyType, whatsapp_contact: whatsappContact,
      registration_deadline: registrationDeadline, categories: selectedCategories, sponsors,
      format,
      total_rounds: totalRoundsPayload,
      ...(roundsPayload ? { rounds: roundsPayload } : {}),
    };
    
    try {
      if (isEditing) await api.put(`/tournaments/update/${editTournamentId}`, payload);
      else await api.post('/tournaments/create', payload);
      handleCancelEdit(); fetchTournaments();
      alert('Sucesso!');
    } catch (error) { alert('Erro ao salvar.'); }
  };

  const handleEditClick = async (id) => {
    try {
      const res = await api.get(`/tournaments/${id}`);
      const t = res.data;
      setNewTournamentName(t.name);
      setNewTournamentDate(formatForInput(t.start_date));
      setSelectedCourseId(t.course_id);
      setDescription(t.description || '');
      setFee(t.fee || '');
      setPaymentInfo(t.payment_info || '');
      setWhatsappContact(t.whatsapp_contact || '');
      setRegistrationDeadline(formatForInput(t.registration_deadline));
      setSelectedCategories(t.categories || []);
      setSponsors(t.sponsors || []);
      setPixKeyType(t.pix_key_type || 'Chave Aleatória');
      setFormat(t.format === 'tee_time' ? 'tee_time' : 'shotgun');
      // Item 5 · commit 3: hidrata estado multi-rodada quando o torneio tem >1 round
      const tr = Number(t.total_rounds || 1);
      if (tr > 1 && Array.isArray(t.rounds)) {
        setMultiRound(true);
        setRounds(t.rounds.map(r => ({
          round_number: Number(r.round_number),
          round_date: formatForInput(r.round_date),
          course_id: r.course_id,
        })));
      } else {
        setMultiRound(false);
        setRounds([]);
      }
      setIsEditing(true);
      setEditTournamentId(t.id);
      window.scrollTo(0, 0);
    } catch (error) { alert('Erro ao carregar dados.'); }
  };

  const handleCancelEdit = () => {
    setNewTournamentName(''); setNewTournamentDate(''); setSelectedCourseId('');
    setDescription(''); setFee(''); setPaymentInfo(''); setWhatsappContact(''); setRegistrationDeadline('');
    setSelectedCategories([]); setSponsors([]); setPixKeyType('Chave Aleatória');
    setFormat('shotgun');
    setMultiRound(false); setRounds([]);
    setIsEditing(false); setEditTournamentId(null);
  };

  // Item 5 · commit 3 — helpers de multi-rodada
  //
  // toggleMultiRound: ao LIGAR, se ainda não há rounds, pré-preenche R1 com o
  // (start_date, course_id) atuais + R2 vazia (dá pro admin visualizar o padrão).
  // Ao DESLIGAR, apaga o array — envio ao backend fica sem rounds[].
  const toggleMultiRound = (on) => {
    setMultiRound(on);
    if (on && rounds.length === 0) {
      setRounds([
        { round_number: 1, round_date: newTournamentDate || '', course_id: selectedCourseId || '' },
        { round_number: 2, round_date: '', course_id: selectedCourseId || '' },
      ]);
    }
  };

  const updateRound = (idx, patch) => {
    setRounds(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const addRound = () => {
    if (rounds.length >= 10) return;
    setRounds(prev => [
      ...prev,
      { round_number: prev.length + 1, round_date: '', course_id: prev[prev.length - 1]?.course_id || selectedCourseId || '' },
    ]);
  };

  const removeRound = (idx) => {
    if (rounds.length <= 2) return; // multi-rodada exige >= 2
    setRounds(prev => prev
      .filter((_, i) => i !== idx)
      .map((r, i) => ({ ...r, round_number: i + 1 }))
    );
  };

  const styles = {
    container: { padding: '20px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain },
    card: { backgroundColor: theme.card, padding: '25px', borderRadius: '15px', marginBottom: '25px', border: isEditing ? `1px solid ${theme.info}` : 'none' },
    sectionTitle: { fontSize: '16px', color: theme.accent, fontWeight: 'bold', marginBottom: '15px', borderLeft: `4px solid ${theme.accent}`, paddingLeft: '10px' },
    formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' },
    inputGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
    label: { fontSize: '13px', color: theme.textMuted, fontWeight: 'bold' },
    input: { padding: '12px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain },
    textarea: { padding: '12px', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, minHeight: '80px' },
    btnPrimary: { backgroundColor: theme.accent, color: '#000', border: 'none', padding: '15px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' },
    btnAction: { padding: '8px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', color: '#fff' },
    tournamentItem: { backgroundColor: theme.card, padding: '20px', borderRadius: '12px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }
  };

  return (
    <div style={styles.container}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      <AdminNavMenu />
      <h1 style={{fontSize: '24px', margin: '0 0 20px 0'}}>Painel do Organizador</h1>

      <div style={styles.card}>
        <h2 style={{color: isEditing ? theme.info : theme.gold, marginTop: 0}}>
          {isEditing ? 'Editar Torneio' : 'Novo Torneio'}
        </h2>

        <form onSubmit={handleSubmitTournament}>
          <div style={styles.sectionTitle}>1. INFORMAÇÕES BÁSICAS</div>
          <div style={styles.formGrid}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>NOME DO TORNEIO</label>
              <input style={styles.input} type="text" value={newTournamentName} onChange={e => setNewTournamentName(e.target.value)} required />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>CAMPO DE GOLFE</label>
              <select style={styles.input} value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)} required>
                <option value="">Selecione...</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.city ? `- ${c.city}/${c.state}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>DATA E HORA (Horário de Brasília)</label>
              <input style={styles.input} type="datetime-local" value={newTournamentDate} onChange={e => setNewTournamentDate(e.target.value)} min={isEditing ? undefined : nowLocalInput()} max="2035-12-31T23:59" required />
            </div>
          </div>

          {/* Formato do torneio: define como os grupos saem do campo. Muda a UI
              do TournamentManager (buraco escolhível vs horário editável). */}
          <div style={{...styles.inputGroup, marginTop: '20px'}}>
            <label style={styles.label}>FORMATO DO TORNEIO</label>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {[
                { value: 'shotgun',  label: 'Shotgun',  hint: 'Todos ao mesmo tempo, cada grupo em um buraco diferente' },
                { value: 'tee_time', label: 'Tee time', hint: 'Todos do buraco 1, em horários escalonados' },
              ].map(opt => {
                const active = format === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormat(opt.value)}
                    style={{
                      flex: 1, minWidth: 180,
                      padding: '14px', borderRadius: 8,
                      border: `1px solid ${active ? theme.accent : theme.cardLight}`,
                      backgroundColor: active ? theme.accent : theme.bg,
                      color: active ? '#000' : theme.textMuted,
                      cursor: 'pointer', textAlign: 'left',
                      fontWeight: active ? 800 : 600,
                    }}
                  >
                    <div style={{ fontSize: 14 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4, fontWeight: 600 }}>{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{...styles.inputGroup, marginTop: '20px'}}>
            <label style={styles.label}>DESCRIÇÃO / REGRAS</label>
            <textarea style={styles.textarea} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          {/* Item 5 · commit 3 — MULTI-RODADA */}
          <div style={{ marginTop: '20px', padding: '14px', border: `1px solid ${theme.cardLight}`, borderRadius: '10px', backgroundColor: theme.bg }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={multiRound}
                onChange={e => toggleMultiRound(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: theme.accent, cursor: 'pointer' }}
                aria-label="Torneio multi-rodada"
              />
              <span style={{ color: theme.textMain, fontWeight: 'bold', fontSize: 14 }}>Torneio multi-rodada</span>
              <span style={{ color: theme.textMuted, fontSize: 12 }}>
                (ex: sexta/sábado/domingo = R1/R2/R3)
              </span>
            </label>

            {multiRound && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ color: theme.textMuted, fontSize: 12 }}>
                    {rounds.length} rodada(s) — datas em ordem crescente, cada uma com seu campo
                  </span>
                  <button
                    type="button"
                    onClick={addRound}
                    disabled={rounds.length >= 10}
                    style={{
                      ...styles.btnAction,
                      backgroundColor: rounds.length >= 10 ? theme.cardLight : theme.info,
                      opacity: rounds.length >= 10 ? 0.5 : 1,
                    }}
                  >
                    + ADICIONAR RODADA
                  </button>
                </div>
                {rounds.map((r, idx) => (
                  <div key={idx} style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 1fr 40px',
                    gap: '10px',
                    alignItems: 'center',
                    padding: '10px',
                    marginBottom: '8px',
                    backgroundColor: theme.card,
                    border: `1px solid ${theme.cardLight}`,
                    borderRadius: '8px',
                  }}>
                    <div style={{ color: theme.gold, fontWeight: 'bold', fontSize: 15 }}>R{r.round_number}</div>
                    <input
                      type="datetime-local"
                      value={r.round_date || ''}
                      onChange={e => updateRound(idx, { round_date: e.target.value })}
                      min={isEditing ? undefined : nowLocalInput()}
                      max="2035-12-31T23:59"
                      style={{ ...styles.input, padding: '10px', fontSize: 13 }}
                      aria-label={`Data e hora da R${r.round_number}`}
                      required
                    />
                    <select
                      value={r.course_id || ''}
                      onChange={e => updateRound(idx, { course_id: e.target.value })}
                      style={{ ...styles.input, padding: '10px', fontSize: 13 }}
                      aria-label={`Campo da R${r.round_number}`}
                      required
                    >
                      <option value="">Selecione o campo</option>
                      {courses.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.city ? ` — ${c.city}/${c.state}` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeRound(idx)}
                      disabled={rounds.length <= 2}
                      style={{
                        ...styles.btnAction,
                        backgroundColor: rounds.length <= 2 ? theme.cardLight : theme.danger,
                        opacity: rounds.length <= 2 ? 0.5 : 1,
                        padding: '8px',
                      }}
                      aria-label={`Remover R${r.round_number}`}
                      title={rounds.length <= 2 ? 'Mínimo 2 rodadas' : 'Remover esta rodada'}
                    >
                      <LuTrash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{...styles.sectionTitle, marginTop: '30px'}}>2. CATEGORIAS</div>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px'}}>
            {defaultCategories.map(cat => (
              <div key={cat} onClick={() => toggleCategory(cat)} style={{
                padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', textAlign: 'center', fontWeight: 'bold',
                backgroundColor: selectedCategories.includes(cat) ? theme.accent : theme.bg,
                color: selectedCategories.includes(cat) ? '#000' : theme.textMuted,
                border: `1px solid ${theme.cardLight}`
              }}>{cat}</div>
            ))}
          </div>

          <div style={{...styles.sectionTitle, marginTop: '30px'}}>3. INSCRIÇÃO E PAGAMENTO</div>
          
          <div style={styles.formGrid}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>VALOR DA INSCRIÇÃO</label>
              <input style={styles.input} type="text" inputMode="numeric" placeholder="R$ 0,00" value={fee} onChange={e => setFee(formatFeeBRL(e.target.value))} />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>TIPO E CHAVE PIX</label>
              <select style={{...styles.input, marginBottom: '5px', fontWeight: 'bold', color: theme.gold}} value={pixKeyType} onChange={e => setPixKeyType(e.target.value)}>
                <option value="Chave Aleatória">Chave Aleatória</option>
                <option value="CPF">CPF</option>
                <option value="CNPJ">CNPJ</option>
                <option value="Celular">Celular</option>
                <option value="E-mail">E-mail</option>
                <option value="Copia e Cola">PIX Copia e Cola</option>
              </select>
              <textarea style={{...styles.textarea, minHeight: '60px'}} placeholder="Digite apenas a chave..." value={paymentInfo} onChange={e => setPaymentInfo(e.target.value)} />
            </div>
            
            <div style={styles.inputGroup}>
              <label style={styles.label}>WHATSAPP PARA COMPROVANTE</label>
              <input style={styles.input} type="text" value={whatsappContact} onChange={e => setWhatsappContact(e.target.value)} />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>DATA LIMITE INSCRIÇÃO (Horário de Brasília)</label>
              <input style={styles.input} type="datetime-local" value={registrationDeadline} onChange={e => setRegistrationDeadline(e.target.value)} min={isEditing ? undefined : nowLocalInput()} max={newTournamentDate || "2035-12-31T23:59"} />
            </div>
          </div>

          <div style={{...styles.sectionTitle, marginTop: '30px'}}>4. PATROCINADORES</div>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '15px', alignItems: 'end'}}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>NOME</label>
              <input style={styles.input} placeholder="Nome do Patrocinador" value={sponsorName} onChange={e => setSponsorName(e.target.value)} />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>LOGO (PNG/JPG até 3MB)</label>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                <label style={{display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', backgroundColor: theme.cardLight, color: theme.textMain, border: `1px solid ${theme.cardLight}`, borderRadius: 8, cursor: sponsorUploading ? 'wait' : 'pointer', fontWeight: 700, fontSize: 12}}>
                  <LuUpload size={13} />
                  {sponsorUploading ? 'Enviando...' : (sponsorLogo ? 'Trocar' : 'Escolher arquivo')}
                  <input type="file" accept="image/*" onChange={handleSponsorLogoUpload} disabled={sponsorUploading} style={{display: 'none'}} />
                </label>
                {sponsorLogo && (
                  <div style={{display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', backgroundColor: '#fff', borderRadius: 6}}>
                    <img src={mediaUrl(sponsorLogo)} alt="preview" style={{maxHeight: 32, maxWidth: 80, objectFit: 'contain'}} />
                    <button type="button" onClick={() => setSponsorLogo('')} title="Remover logo escolhido" style={{background: 'transparent', border: 'none', color: theme.danger, cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center'}}>
                      <LuX size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={handleAddSponsor} disabled={!sponsorName.trim()} style={{...styles.btnAction, backgroundColor: sponsorName.trim() ? theme.info : theme.cardLight, height: '45px', cursor: sponsorName.trim() ? 'pointer' : 'not-allowed', opacity: sponsorName.trim() ? 1 : 0.6}}>+ ADICIONAR</button>
          </div>
          {sponsors.length > 0 && (
            <div style={{display: 'flex', gap: '10px', marginTop: '15px', flexWrap: 'wrap'}}>
              {sponsors.map((s, idx) => (
                <div key={idx} style={{backgroundColor: theme.bg, padding: '5px 10px 5px 5px', borderRadius: '20px', border: `1px solid ${theme.cardLight}`, display: 'flex', alignItems: 'center', gap: '8px'}}>
                  {s.image_url && (
                    <div style={{width: 26, height: 26, borderRadius: '50%', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0}}>
                      <img src={mediaUrl(s.image_url)} alt={s.name} style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} />
                    </div>
                  )}
                  <span style={{fontSize: '12px'}}>{s.name}</span>
                  <button type="button" onClick={() => setSponsors(sponsors.filter((_, i) => i !== idx))} style={{background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', fontWeight: 'bold'}}>X</button>
                </div>
              ))}
            </div>
          )}

          <button type="submit" style={{...styles.btnPrimary, width: '100%', backgroundColor: isEditing ? theme.info : theme.accent}}>
            {isEditing ? 'SALVAR ALTERAÇÕES' : 'PUBLICAR TORNEIO'}
          </button>
          {isEditing && <button type="button" onClick={handleCancelEdit} style={{...styles.btnAction, width: '100%', marginTop: '10px', padding: '15px', backgroundColor: theme.cardLight}}>CANCELAR EDIÇÃO</button>}
        </form>
      </div>

      <h3 style={{color: theme.textMuted, fontSize: '14px', letterSpacing: '1px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: 8}}>
        <LuCalendarDays size={15} />
        MEUS TORNEIOS
      </h3>
      {tournaments.map(t => {
        const hoje = isToday(t.start_date) && t.status !== 'concluido';
        return (
        <div key={t.id} style={{...styles.tournamentItem, borderLeft: `6px solid ${hoje ? '#22d3ee' : t.status === 'concluido' ? theme.danger : theme.accent}`}}>
          <div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
              <span style={{fontSize: '18px', fontWeight: 'bold'}}>{t.name}</span>
              {hoje && (
                <span style={{
                  backgroundColor: '#22d3ee', color: '#000',
                  fontSize: '10px', fontWeight: '900', padding: '3px 9px',
                  borderRadius: '10px', letterSpacing: '1px', animation: 'pulse 1.5s infinite',
                }}>
                  AO VIVO
                </span>
              )}
            </div>
            <div style={{fontSize: '13px', color: theme.textMuted, marginTop: '4px', display: 'flex', alignItems: 'center', gap: 6}}>
              <LuMapPin size={13} />
              {t.course_name || 'Local não definido'} {t.course_city ? `- ${t.course_city}/${t.course_state}` : ''}
            </div>
            <div style={{fontSize: '12px', color: hoje ? '#22d3ee' : theme.textMuted, marginTop: '2px', fontWeight: hoje ? 'bold' : 'normal', display: 'flex', alignItems: 'center', gap: 6}}>
              <LuCalendarDays size={13} />
              {fmtBR(t.start_date)}
            </div>
            <div style={{marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
              <span style={{backgroundColor: t.status === 'concluido' ? theme.danger : theme.accent, color: '#000', fontSize: '10px', padding: '3px 8px', borderRadius: '10px', fontWeight: 'bold'}}>
                {t.status === 'concluido' ? 'FINALIZADO' : 'ATIVO'}
              </span>
            </div>
          </div>
          <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end'}}>
            <button onClick={() => handleCopyLink(t.id)} style={{...styles.btnAction, backgroundColor: '#fff', color: '#000'}}>
              <LuLink size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
              LINK
            </button>
            <button onClick={() => handleToggleStatus(t.id, t.status)} style={{...styles.btnAction, backgroundColor: t.status === 'concluido' ? theme.gold : theme.accent, color: '#000'}}>
                {t.status === 'concluido' ? 'REABRIR' : 'CONCLUIR'}
            </button>
            <button onClick={() => handleEditClick(t.id)} style={{...styles.btnAction, backgroundColor: theme.info}}>EDITAR</button>
            <button onClick={() => navigate(`/tournament/${t.id}`)} style={{...styles.btnAction, backgroundColor: theme.cardLight}}>GRUPOS</button>
            <button onClick={() => navigate(`/leaderboard/${t.id}`)} style={{...styles.btnAction, backgroundColor: theme.gold, color: '#000'}}>RANKING</button>
            <button onClick={() => handleExport(t.id)} style={{...styles.btnAction, backgroundColor: '#10b981'}}>EXCEL</button>
            <button onClick={() => handleDeleteTournament(t.id, t.name)} style={{...styles.btnAction, backgroundColor: theme.danger}}>
              <LuTrash2 size={13} />
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

export default Dashboard;