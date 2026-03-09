// frontend/src/pages/Dashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api'; // Ajuste o caminho se necessário
import { useNavigate } from 'react-router-dom';

function Dashboard() {
  const navigate = useNavigate();
  
  const [tournaments, setTournaments] = useState([]);
  const [courses, setCourses] = useState([]); 

  // Estados do Formulário
  const [newTournamentName, setNewTournamentName] = useState('');
  const [newTournamentDate, setNewTournamentDate] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [description, setDescription] = useState('');
  const [paymentInfo, setPaymentInfo] = useState('');
  
  // NOVO: Estados de Valor e Chave PIX
  const [fee, setFee] = useState('');
  const [pixKeyType, setPixKeyType] = useState('Chave Aleatória'); 
  
  const [whatsappContact, setWhatsappContact] = useState('');
  const [registrationDeadline, setRegistrationDeadline] = useState('');
  
  // Patrocinadores
  const [sponsors, setSponsors] = useState([]);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorLogo, setSponsorLogo] = useState('');

  // Categorias
  const defaultCategories = [
    "Masculino Gross (M0)", "Masculino Net (M1) - 0 a 8.5", "Masculino Net (M2) - 8.6 a 14.0",
    "Masculino Net (M3) - 14.1 a 22.1", "Masculino Net (M4) - 22.2 a 36.4",
    "Feminino Gross (F0)", "Feminino Net (F1) - 0 a 16.1", "Feminino Net (F2) - 16.1 a 23.7",
    "Feminino Net (F3) - 23.8 a 36.4", "Sênior Masculino", "Sênior Feminino",
    "Duplas Masculinas", "Duplas Femininas"
  ];
  const [selectedCategories, setSelectedCategories] = useState([]);

  // Estado de Edição
  const [isEditing, setIsEditing] = useState(false);
  const [editTournamentId, setEditTournamentId] = useState(null);

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
    const storedUser = localStorage.getItem('user');
    if (!storedUser) { navigate('/login'); return; }
    const parsedUser = JSON.parse(storedUser);
    if (parsedUser.role !== 'ADMIN') { navigate('/'); return; }
    fetchTournaments();
    fetchCourses();
  }, [navigate, fetchTournaments, fetchCourses]);

  const handleCopyLink = (id) => {
    const link = `${window.location.origin}/leaderboard/${id}`;
    navigator.clipboard.writeText(link).then(() => alert("✅ Link copiado!"));
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

  const handleExport = (id) => window.open(`http://localhost:3001/api/export/${id}`, '_blank');

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
    
    // NOVO: Adicionado fee (valor) no payload
    const payload = {
      name: newTournamentName, start_date: newTournamentDate, course_id: selectedCourseId,
      description, fee, payment_info: paymentInfo, pix_key_type: pixKeyType, whatsapp_contact: whatsappContact,
      registration_deadline: registrationDeadline, categories: selectedCategories, sponsors
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
      const formatDate = (d) => d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      
      setNewTournamentName(t.name); setNewTournamentDate(formatDate(t.start_date));
      setSelectedCourseId(t.course_id); setDescription(t.description || '');
      setFee(t.fee || ''); // Puxa o valor do banco
      setPaymentInfo(t.payment_info || ''); setWhatsappContact(t.whatsapp_contact || '');
      setRegistrationDeadline(formatDate(t.registration_deadline));
      setSelectedCategories(t.categories || []); setSponsors(t.sponsors || []);
      setPixKeyType(t.pix_key_type || 'Chave Aleatória');
      
      setIsEditing(true); setEditTournamentId(t.id); window.scrollTo(0, 0);
    } catch (error) { alert('Erro ao carregar dados.'); }
  };

  const handleCancelEdit = () => {
    setNewTournamentName(''); setNewTournamentDate(''); setSelectedCourseId('');
    setDescription(''); setFee(''); setPaymentInfo(''); setWhatsappContact(''); setRegistrationDeadline('');
    setSelectedCategories([]); setSponsors([]); setPixKeyType('Chave Aleatória');
    setIsEditing(false); setEditTournamentId(null);
  };

  const styles = {
    container: { padding: '20px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, fontFamily: "'Segoe UI', sans-serif" },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: `1px solid ${theme.cardLight}`, paddingBottom: '15px' },
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
      <div style={styles.header}>
        <h1 style={{fontSize: '24px', margin: 0}}>⛳ Painel do Organizador</h1>
        <div style={{display: 'flex', gap: '10px'}}>
          <button onClick={() => navigate('/courses')} style={{...styles.btnAction, backgroundColor: theme.info, padding: '10px 15px'}}>GERENCIAR CAMPOS</button>
          <button onClick={() => { localStorage.removeItem('user'); navigate('/login'); }} style={{...styles.btnAction, backgroundColor: theme.cardLight}}>SAIR</button>
        </div>
      </div>

      <div style={styles.card}>
        <h2 style={{color: isEditing ? theme.info : theme.gold, marginTop: 0}}>
          {isEditing ? '✏️ Editar Torneio' : '➕ Novo Torneio'}
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
              <label style={styles.label}>DATA E HORA</label>
              <input style={styles.input} type="datetime-local" value={newTournamentDate} onChange={e => setNewTournamentDate(e.target.value)} required />
            </div>
          </div>
          <div style={{...styles.inputGroup, marginTop: '20px'}}>
            <label style={styles.label}>DESCRIÇÃO / REGRAS</label>
            <textarea style={styles.textarea} value={description} onChange={e => setDescription(e.target.value)} />
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
            {/* NOVO CAMPO DE VALOR DA INSCRIÇÃO */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>VALOR DA INSCRIÇÃO</label>
              <input style={styles.input} type="text" placeholder="Ex: R$ 150,00" value={fee} onChange={e => setFee(e.target.value)} />
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
              <label style={styles.label}>DATA LIMITE INSCRIÇÃO</label>
              <input style={styles.input} type="datetime-local" value={registrationDeadline} onChange={e => setRegistrationDeadline(e.target.value)} />
            </div>
          </div>

          <div style={{...styles.sectionTitle, marginTop: '30px'}}>4. PATROCINADORES</div>
          <div style={styles.formGrid}>
            <input style={styles.input} placeholder="Nome do Patrocinador" value={sponsorName} onChange={e => setSponsorName(e.target.value)} />
            <input style={styles.input} placeholder="URL do Logo (https://...)" value={sponsorLogo} onChange={e => setSponsorLogo(e.target.value)} />
            <button type="button" onClick={handleAddSponsor} style={{...styles.btnAction, backgroundColor: theme.info, height: '45px'}}>+ ADICIONAR</button>
          </div>
          {sponsors.length > 0 && (
            <div style={{display: 'flex', gap: '10px', marginTop: '15px', flexWrap: 'wrap'}}>
              {sponsors.map((s, idx) => (
                <div key={idx} style={{backgroundColor: theme.bg, padding: '5px 15px', borderRadius: '20px', border: `1px solid ${theme.cardLight}`, display: 'flex', alignItems: 'center', gap: '10px'}}>
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

      <h3 style={{color: theme.textMuted, fontSize: '14px', letterSpacing: '1px', marginBottom: '15px'}}>📅 MEUS TORNEIOS</h3>
      {tournaments.map(t => (
        <div key={t.id} style={{...styles.tournamentItem, borderLeft: `6px solid ${t.status === 'concluido' ? theme.danger : theme.accent}`}}>
          <div>
            <div style={{fontSize: '18px', fontWeight: 'bold'}}>{t.name}</div>
            <div style={{fontSize: '13px', color: theme.textMuted, marginTop: '4px'}}>
              📍 {t.course_name || 'Local não definido'} {t.course_city ? `- ${t.course_city}/${t.course_state}` : ''}
            </div>
            <div style={{fontSize: '12px', color: theme.textMuted, marginTop: '2px'}}>
              📅 {new Date(t.start_date).toLocaleString()}
            </div>
            <div style={{marginTop: '8px'}}>
              <span style={{backgroundColor: t.status === 'concluido' ? theme.danger : theme.accent, color: '#000', fontSize: '10px', padding: '3px 8px', borderRadius: '10px', fontWeight: 'bold'}}>
                {t.status === 'concluido' ? 'FINALIZADO' : 'ATIVO'}
              </span>
            </div>
          </div>
          <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end'}}>
            <button onClick={() => handleCopyLink(t.id)} style={{...styles.btnAction, backgroundColor: '#fff', color: '#000'}}>🔗 LINK</button>
            <button onClick={() => handleToggleStatus(t.id, t.status)} style={{...styles.btnAction, backgroundColor: t.status === 'concluido' ? theme.gold : theme.accent, color: '#000'}}>
                {t.status === 'concluido' ? 'REABRIR' : 'CONCLUIR'}
            </button>
            <button onClick={() => handleEditClick(t.id)} style={{...styles.btnAction, backgroundColor: theme.info}}>EDITAR</button>
            <button onClick={() => navigate(`/tournament/${t.id}`)} style={{...styles.btnAction, backgroundColor: theme.cardLight}}>GRUPOS</button>
            <button onClick={() => navigate(`/leaderboard/${t.id}`)} style={{...styles.btnAction, backgroundColor: theme.gold, color: '#000'}}>RANKING</button>
            <button onClick={() => handleExport(t.id)} style={{...styles.btnAction, backgroundColor: '#10b981'}}>EXCEL</button>
            <button onClick={() => handleDeleteTournament(t.id, t.name)} style={{...styles.btnAction, backgroundColor: theme.danger}}>🗑️</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Dashboard;