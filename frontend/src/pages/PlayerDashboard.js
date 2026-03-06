// frontend/src/pages/PlayerDashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

function PlayerDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  
  // Controle das Abas
  const [activeTab, setActiveTab] = useState('ativos'); 

  // Estados do Modal
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [whatsappLink, setWhatsappLink] = useState('');
  const [copied, setCopied] = useState(false); 
  
  // Controle do Carrossel de Patrocinadores
  const [currentSponsorIndex, setCurrentSponsorIndex] = useState(0); 
  
  // TEMA PADRONIZADO BIRDIFY
  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: '#22c55e',
    gold: '#eab308',
    blue: '#3b82f6',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444',
    whatsapp: '#25D366'
  };

  const fetchTournaments = useCallback(async (userId) => {
    try {
      const res = await axios.get(`http://localhost:3001/api/tournaments/list?user_id=${userId}`);
      setTournaments(res.data);
    } catch (error) {
      console.error("Erro ao buscar torneios Birdify", error);
    }
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      navigate('/login');
      return;
    }
    
    const parsedUser = JSON.parse(storedUser);
    setUser(parsedUser);
    
    fetchTournaments(parsedUser.id); 
  }, [navigate, fetchTournaments]); 

  // Carrossel de patrocinadores
  useEffect(() => {
    let interval;
    if (selectedTournament && selectedTournament.sponsors && selectedTournament.sponsors.length > 1) {
      interval = setInterval(() => {
        setCurrentSponsorIndex((prev) => 
          prev === selectedTournament.sponsors.length - 1 ? 0 : prev + 1
        );
      }, 8000); 
    }
    return () => clearInterval(interval); 
  }, [selectedTournament]);

  const activeTournaments = tournaments.filter(t => t.status === 'OPEN');
  const pastTournaments = tournaments.filter(t => t.status === 'concluido');

  const openDetails = async (t) => {
    try {
      const res = await axios.get(`http://localhost:3001/api/inscriptions/tournament/${t.id}`);
      
      const fullTournamentData = { 
          ...res.data, 
          course_name: t.course_name, 
          course_city: t.course_city, 
          course_state: t.course_state,
          pix_key_type: t.pix_key_type,
          fee: t.fee 
      };

      setSelectedTournament(fullTournamentData);
      setSelectedCategoryId('');
      
      const alreadySubscribed = t.is_subscribed > 0;
      setIsSubscribed(alreadySubscribed); 
      
      // 👈 A MÁGICA: Reconstruir o botão do WhatsApp se ele já estiver inscrito!
      if (alreadySubscribed && fullTournamentData.whatsapp_contact) {
        const message = `Olá! Sou o jogador *${user.name}*. \n\nSegue o meu comprovante de pagamento referente ao torneio *${fullTournamentData.name}*:`;
        const encodedMessage = encodeURIComponent(message);
        const cleanNumber = fullTournamentData.whatsapp_contact.replace(/\D/g, '');
        setWhatsappLink(`https://wa.me/${cleanNumber}?text=${encodedMessage}`);
      } else {
        setWhatsappLink('');
      }

      setCopied(false); 
      setCurrentSponsorIndex(0); 
    } catch (error) {
      alert("Erro ao carregar detalhes do evento Birdify.");
    }
  };

  const closeModal = () => setSelectedTournament(null);

  const handleInscription = async () => {
    if (!selectedCategoryId) {
      alert("Por favor, selecione uma Categoria para jogar.");
      return;
    }

    try {
      await axios.post('http://localhost:3001/api/inscriptions/create', {
        tournament_id: selectedTournament.id,
        user_id: user.id,
        category_id: selectedCategoryId
      });

      const categoryName = selectedTournament.categories.find(c => c.id === Number(selectedCategoryId))?.name;
      const message = `Olá! Acabei de me inscrever no torneio *${selectedTournament.name}*. \n\n👤 *Jogador:* ${user.name} \n⛳ *Categoria:* ${categoryName} \n\nSegue o meu comprovante de pagamento:`;
      const encodedMessage = encodeURIComponent(message);
      const cleanNumber = selectedTournament.whatsapp_contact ? selectedTournament.whatsapp_contact.replace(/\D/g, '') : '';
      
      setWhatsappLink(`https://wa.me/${cleanNumber}?text=${encodedMessage}`);
      setIsSubscribed(true);
      
      fetchTournaments(user.id);

    } catch (error) {
      if (error.response && error.response.status === 400) {
        alert("Você já está inscrito! Aguarde a aprovação do organizador.");
      } else {
        alert("Erro ao realizar inscrição.");
      }
    }
  };

  const handleCopyPix = () => {
    if (selectedTournament && selectedTournament.payment_info) {
      navigator.clipboard.writeText(selectedTournament.payment_info);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); 
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '--';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).replace(',', ' às');
  };

  const styles = {
    container: { padding: '25px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, fontFamily: "'Inter', sans-serif" },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: `1px solid ${theme.cardLight}`, paddingBottom: '20px' },
    tabsContainer: { display: 'flex', gap: '10px', marginBottom: '25px' },
    tabBtn: (active) => ({
      padding: '12px 24px', border: 'none', borderRadius: '12px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold',
      backgroundColor: active ? theme.gold : theme.card, color: active ? '#000' : theme.textMuted, transition: '0.3s'
    }),
    card: { 
      backgroundColor: theme.card, padding: '20px', borderRadius: '16px', marginBottom: '15px', cursor: 'pointer', 
      borderLeft: `5px solid ${theme.gold}`, borderTop: `1px solid ${theme.cardLight}`, transition: '0.2s' 
    },
    cardFinalizado: { 
      backgroundColor: theme.card, padding: '20px', borderRadius: '16px', marginBottom: '15px', cursor: 'pointer', 
      borderLeft: `5px solid ${theme.danger}`, opacity: 0.8 
    },
    modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(5px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' },
    modalContent: { backgroundColor: theme.card, padding: '30px', borderRadius: '24px', width: '100%', maxWidth: '550px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.cardLight}` },
    infoBox: { backgroundColor: theme.bg, padding: '15px', borderRadius: '12px', marginBottom: '15px', border: `1px solid ${theme.cardLight}` },
    select: { width: '100%', padding: '15px', borderRadius: '12px', backgroundColor: theme.bg, color: 'white', border: `2px solid ${theme.cardLight}`, marginBottom: '20px' },
    whatsappBtn: { 
      display: 'block', 
      width: '100%', 
      padding: '14px', 
      backgroundColor: theme.whatsapp, 
      color: 'white', 
      fontSize: '14px', 
      fontWeight: 'bold', 
      border: 'none', 
      borderRadius: '12px', 
      textAlign: 'center', 
      textDecoration: 'none',
      boxSizing: 'border-box', 
      marginTop: '15px' 
    },
    submitBtn: { width: '100%', padding: '16px', backgroundColor: theme.accent, color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '12px', cursor: 'pointer' },
    // NOVO: Estilo para a caixinha de Valor
    feeBox: {
      backgroundColor: 'rgba(234, 179, 8, 0.1)', // Um fundo dourado bem clarinho
      border: `1px solid ${theme.gold}`,
      padding: '15px',
      borderRadius: '12px',
      marginBottom: '15px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  };

  return (
    <div style={styles.container}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      <div style={styles.header}>
        <div>
          <h1 style={{margin: 0, fontSize: '24px'}}>🦅 Olá, {user?.name.split(' ')[0]}</h1>
          <p style={{color: theme.textMuted, fontSize: '14px', margin: 0}}>Bem-vindo ao Portal Birdify</p>
        </div>
        <button onClick={() => { localStorage.removeItem('user'); navigate('/login'); }} 
          style={{padding: '10px 15px', backgroundColor: 'transparent', color: theme.danger, border: `1px solid ${theme.danger}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'}}>
          SAIR
        </button>
      </div>

      <div style={styles.tabsContainer}>
        <button style={styles.tabBtn(activeTab === 'ativos')} onClick={() => setActiveTab('ativos')}>🟢 ABERTOS</button>
        <button style={styles.tabBtn(activeTab === 'concluidos')} onClick={() => setActiveTab('concluidos')}>🏆 CONCLUÍDOS</button>
      </div>

      {activeTab === 'ativos' ? (
        <div>
          {activeTournaments.length === 0 ? (
            <div style={{textAlign: 'center', padding: '40px', color: theme.textMuted}}>Nenhum torneio Birdify aberto no momento.</div>
          ) : (
            activeTournaments.map(t => (
              <div key={t.id} style={styles.card} onClick={() => openDetails(t)}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                    <h3 style={{margin: '0 0 5px 0', color: theme.gold}}>{t.name}</h3>
                    
                    {t.is_subscribed > 0 && (
                        <span style={{backgroundColor: 'rgba(34, 197, 94, 0.2)', color: theme.accent, padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', border: `1px solid ${theme.accent}`}}>
                            ✅ INSCRITO
                        </span>
                    )}
                </div>
                
                <p style={{margin: '0 0 15px 0', fontSize: '13px', color: theme.textMain}}>
                    📍 {t.course_name || 'Local a definir'} {t.course_city ? `- ${t.course_city}/${t.course_state}` : ''}
                </p>
                
                <div style={{display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px', color: theme.textMuted}}>
                  <span>📅 Início: <strong style={{color: theme.textMain}}>{formatDateTime(t.start_date)}</strong></span>
                  <span>⏳ Inscrições até: <strong style={{color: theme.danger}}>{formatDateTime(t.registration_deadline)}</strong></span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div>
          {pastTournaments.map(t => {
            const slug = t.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            return (
              <div key={t.id} style={styles.cardFinalizado} onClick={() => navigate(`/leaderboard/${t.id}-${slug}`)}>
                <h3 style={{margin: '0 0 5px 0', color: theme.danger}}>{t.name}</h3>
                <p style={{margin: 0, fontSize: '12px', color: theme.textMuted}}>Clique para ver o Hall da Fama e resultados.</p>
              </div>
            );
          })}
        </div>
      )}

      {selectedTournament && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
                <h2 style={{marginTop: 0, marginBottom: 0, color: theme.gold}}>{selectedTournament.name}</h2>
                <button onClick={closeModal} style={{ background: 'none', border: 'none', color: theme.textMuted, fontSize: '24px', cursor: 'pointer' }}>×</button>
            </div>
            
            <div style={styles.infoBox}>
              <p style={{fontSize: '14px', color: theme.textMuted, marginBottom: '5px', fontWeight: 'bold'}}>SOBRE O EVENTO</p>
              <p style={{margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap', marginBottom: '15px'}}>{selectedTournament.description}</p>
              
              <div style={{borderTop: `1px solid ${theme.cardLight}`, paddingTop: '10px', fontSize: '13px', color: theme.textMuted}}>
                <p style={{margin: '0 0 5px 0'}}>⛳ <strong>Início:</strong> {formatDateTime(selectedTournament.start_date)}</p>
                <p style={{margin: 0, color: theme.danger}}>⏳ <strong>Prazo Final:</strong> {formatDateTime(selectedTournament.registration_deadline)}</p>
              </div>
            </div>

            {/* CAIXA DE PAGAMENTO COMPACTA (VALOR + PIX) */}
            {selectedTournament.payment_info && (
                <div style={{...styles.infoBox, borderLeft: `4px solid ${theme.whatsapp}`}}>
                  
                  {/* 1. VALOR DA INSCRIÇÃO DISCRETO */}
                  {selectedTournament.fee && (
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '12px', borderBottom: `1px solid ${theme.cardLight}`}}>
                      <span style={{fontSize: '12px', color: theme.textMuted, fontWeight: 'bold'}}>VALOR DA INSCRIÇÃO</span>
                      <span style={{fontSize: '15px', color: theme.gold, fontWeight: '900'}}>{selectedTournament.fee}</span>
                    </div>
                  )}

                  {/* 2. CHAVE PIX */}
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                    <p style={{fontSize: '13px', color: theme.whatsapp, margin: 0, fontWeight: 'bold'}}>
                        PIX ({selectedTournament.pix_key_type || 'Chave Aleatória'})
                    </p>
                    <button 
                      onClick={handleCopyPix}
                      style={{
                        backgroundColor: copied ? theme.whatsapp : 'transparent', 
                        color: copied ? '#000' : theme.whatsapp, 
                        border: `1px solid ${theme.whatsapp}`, 
                        padding: '4px 10px', 
                        borderRadius: '6px', 
                        fontSize: '11px', 
                        cursor: 'pointer', 
                        fontWeight: 'bold',
                        transition: 'all 0.2s'  
                      }}
                    >
                      {copied ? '✅ COPIADO!' : '📋 COPIAR CHAVE'}
                    </button>
                  </div>
                  <p style={{margin: 0, fontSize: '15px', fontWeight: 'bold'}}>{selectedTournament.payment_info}</p>
                </div>
            )}

            {!isSubscribed ? (
              <>
                <p style={{fontSize: '13px', color: theme.textMuted, marginBottom: '8px'}}>Selecione sua categoria:</p>
                <select style={styles.select} value={selectedCategoryId} onChange={e => setSelectedCategoryId(e.target.value)}>
                  <option value="">Escolha uma...</option>
                  {selectedTournament.categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button style={styles.submitBtn} onClick={handleInscription}>CONFIRMAR MINHA VAGA</button>
              </>
            ) : (
              <div style={{textAlign: 'center', padding: '10px', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '12px', border: `1px solid ${theme.accent}`}}>
                <div style={{fontSize: '30px', marginBottom: '5px'}}>✅</div>
                <h3 style={{margin: '0 0 5px 0', color: theme.accent}}>Você já está inscrito!</h3>
                <p style={{fontSize: '13px', color: theme.textMain, marginBottom: '15px'}}>Efetue o pagamento na chave PIX acima e envie o comprovante para garantir sua vaga.</p>
                {whatsappLink && (
                  <a href={whatsappLink} target="_blank" rel="noreferrer" style={styles.whatsappBtn}>ENVIAR COMPROVANTE VIA WHATSAPP</a>
                )}
              </div>
            )}

            {selectedTournament.sponsors?.length > 0 && (
              <div style={{marginTop: '25px', borderTop: `1px solid ${theme.cardLight}`, paddingTop: '20px', textAlign: 'center'}}>
                <p style={{fontSize: '12px', color: theme.textMuted, marginBottom: '20px', letterSpacing: '2px', fontWeight: 'bold'}}>PATROCÍNIO OFICIAL</p>
                
                <div style={{ height: '90px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <img 
                    key={currentSponsorIndex} 
                    src={selectedTournament.sponsors[currentSponsorIndex].image_url} 
                    alt={selectedTournament.sponsors[currentSponsorIndex].name || 'Patrocinador'} 
                    style={{
                      maxHeight: '100%', 
                      maxWidth: '250px', 
                      objectFit: 'contain',
                      animation: 'fadeIn 0.5s ease-in' 
                    }} 
                  />
                </div>

                {selectedTournament.sponsors.length > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px' }}>
                    {selectedTournament.sponsors.map((_, idx) => (
                      <div 
                        key={idx}
                        onClick={() => setCurrentSponsorIndex(idx)}
                        style={{
                          width: '8px', 
                          height: '8px', 
                          borderRadius: '50%', 
                          backgroundColor: currentSponsorIndex === idx ? theme.gold : theme.cardLight,
                          cursor: 'pointer',
                          transition: 'all 0.3s ease'
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            
          </div>
        </div>
      )}
    </div>
  );
}

export default PlayerDashboard;