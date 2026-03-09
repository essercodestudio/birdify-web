// frontend/src/pages/Register.js
import React, { useState } from 'react';
import api from '../services/api'; 
import { useNavigate, Link } from 'react-router-dom';

function Register() {
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    gender: 'M' 
  });

  // --- NOVO ESTADO PARA LGPD ---
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: '#22c55e', 
    gold: '#eab308',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444'
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    
    // Validação extra de segurança
    if (!acceptedTerms) {
      alert("Você precisa aceitar a Política de Privacidade para continuar.");
      return;
    }

    try {
      await api.post('/auth/register', {
        ...formData,
        role: 'PLAYER' 
      });
      
      alert('Conta criada com sucesso! Faça login.');
      navigate('/login');
    } catch (error) {
      alert(error.response?.data?.message || 'Erro ao criar conta.');
    }
  };

  const styles = {
    container: { 
      display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', 
      backgroundColor: theme.bg, color: theme.textMain, fontFamily: "'Inter', sans-serif", padding: '20px' 
    },
    formBox: { 
      backgroundColor: theme.card, padding: '40px', borderRadius: '24px', 
      boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', width: '100%', maxWidth: '400px', 
      textAlign: 'center', border: `1px solid ${theme.cardLight}` 
    },
    logo: { fontSize: '28px', fontWeight: '900', color: theme.gold, marginBottom: '5px' },
    subtitle: { color: theme.textMuted, fontSize: '14px', marginBottom: '25px' },
    label: { 
      display: 'block', textAlign: 'left', fontSize: '11px', fontWeight: 'bold', 
      color: theme.textMuted, marginBottom: '5px', marginLeft: '5px', textTransform: 'uppercase', letterSpacing: '0.5px' 
    },
    input: { 
      width: '100%', padding: '14px', marginBottom: '15px', borderRadius: '12px', 
      border: `2px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: 'white', 
      boxSizing: 'border-box', outline: 'none', fontSize: '15px' 
    },
    select: { 
      width: '100%', padding: '14px', marginBottom: '20px', borderRadius: '12px', 
      border: `2px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: 'white', 
      appearance: 'none', cursor: 'pointer', outline: 'none' 
    },
    // --- ESTILO DO CHECKBOX LGPD ---
    checkboxContainer: {
      display: 'flex',
      alignItems: 'flex-start',
      textAlign: 'left',
      gap: '10px',
      marginBottom: '20px',
      padding: '0 5px'
    },
    button: { 
      width: '100%', padding: '16px', 
      backgroundColor: acceptedTerms ? theme.accent : '#475569', // Cinza se desativado
      color: acceptedTerms ? '#0f172a' : '#94a3b8', 
      border: 'none', borderRadius: '12px', 
      cursor: acceptedTerms ? 'pointer' : 'not-allowed', 
      fontWeight: '800', 
      fontSize: '16px', marginTop: '10px', 
      boxShadow: acceptedTerms ? '0 10px 15px -3px rgba(34, 197, 94, 0.3)' : 'none',
      transition: 'all 0.3s ease'
    },
    footer: { marginTop: '25px', borderTop: `1px solid ${theme.cardLight}`, paddingTop: '20px' },
    link: { color: theme.gold, textDecoration: 'none', fontSize: '14px', fontWeight: '600' }
  };

  return (
    <div style={styles.container}>
      <div style={styles.formBox}>
        <div style={styles.logo}>Birdify</div>
        <p style={styles.subtitle}>Crie seu perfil de jogador</p>

        <form onSubmit={handleRegister}>
          <span style={styles.label}>Nome Completo</span>
          <input 
            type="text" name="name" placeholder="Ex: Roberto Silva" 
            value={formData.name} onChange={handleChange} style={styles.input} required 
          />

          <span style={styles.label}>E-mail</span>
          <input 
            type="email" name="email" placeholder="seu@email.com" 
            value={formData.email} onChange={handleChange} style={styles.input} required 
          />

          <span style={styles.label}>Senha</span>
          <input 
            type="password" name="password" placeholder="Mínimo 6 caracteres" 
            value={formData.password} onChange={handleChange} style={styles.input} required 
          />
          
          <div style={{textAlign: 'left'}}>
            <span style={styles.label}>Gênero (Categorias)</span>
            <select name="gender" value={formData.gender} onChange={handleChange} style={styles.select}>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
            </select>
          </div>

          {/* --- NOVO CAMPO: CHECKBOX LGPD --- */}
          <div style={styles.checkboxContainer}>
            <input 
              type="checkbox" 
              id="acceptedTerms"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              style={{ marginTop: '4px', cursor: 'pointer' }}
            />
            <label htmlFor="acceptedTerms" style={{ fontSize: '13px', color: theme.textMuted, cursor: 'pointer' }}>
              Eu li e aceito a <Link to="/privacidade" target="_blank" style={{ color: theme.accent, textDecoration: 'none', fontWeight: 'bold' }}>Política de Privacidade</Link> e autorizo o uso dos meus dados para gestão de torneios.
            </label>
          </div>

          <button 
            type="submit" 
            style={styles.button}
            disabled={!acceptedTerms}
          >
            CRIAR CONTA AGORA
          </button>
        </form>
        
        <div style={styles.footer}>
          <span style={{color: theme.textMuted, fontSize: '14px'}}>Já possui cadastro? </span>
          <Link to="/login" style={styles.link}>Faça Login</Link>
        </div>
      </div>
    </div>
  );
}

export default Register;