// frontend/src/pages/Login.js
import React, { useState } from 'react';
import api from '../services/api'; // Ajuste o caminho se necessário
import { useNavigate, Link } from 'react-router-dom';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // TEMA PADRONIZADO
  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: '#22c55e', // Verde Golf
    gold: '#eab308',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444'
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await api.post('/auth/login', {
        email: email,
        password: password
      });

      console.log("Login sucesso!", response.data);
      
      const user = response.data.user;
      
      // Salva o usuário no navegador
      localStorage.setItem('user', JSON.stringify(user));

      // --- LÓGICA DE REDIRECIONAMENTO PRESERVADA ---
      if (user.role === 'ADMIN') {
        navigate('/dashboard');
      } else {
        navigate('/'); 
      }

    } catch (err) {
      if (err.response) {
        setError(err.response.data.message);
      } else {
        setError("Erro ao conectar com o servidor.");
      }
    }
  };

  const styles = {
    container: {
      display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh',
      backgroundColor: theme.bg, color: theme.textMain, fontFamily: "'Inter', sans-serif"
    },
    formBox: {
      backgroundColor: theme.card, 
      padding: '40px', 
      borderRadius: '24px',
      boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', 
      width: '90%',
      maxWidth: '400px',
      textAlign: 'center',
      border: `1px solid ${theme.cardLight}`
    },
    logo: {
      fontSize: '32px', fontWeight: '900', color: theme.gold, marginBottom: '10px', letterSpacing: '-1px'
    },
    subtitle: {
      color: theme.textMuted, fontSize: '14px', marginBottom: '30px'
    },
    label: {
      display: 'block', textAlign: 'left', fontSize: '12px', fontWeight: 'bold', 
      color: theme.textMuted, marginBottom: '5px', marginLeft: '5px', textTransform: 'uppercase'
    },
    input: {
      width: '100%', padding: '15px', marginBottom: '20px', borderRadius: '12px',
      border: `2px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: 'white',
      boxSizing: 'border-box', outline: 'none', fontSize: '16px', transition: 'border-color 0.2s'
    },
    button: {
      width: '100%', padding: '16px', backgroundColor: theme.accent, color: '#0f172a',
      border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', 
      marginTop: '10px', fontSize: '16px', boxShadow: '0 10px 15px -3px rgba(34, 197, 94, 0.3)'
    },
    error: { 
      backgroundColor: 'rgba(239, 68, 68, 0.1)', color: theme.danger, 
      padding: '10px', borderRadius: '8px', fontSize: '14px', marginTop: '15px',
      border: `1px solid ${theme.danger}`
    },
    link: { 
      color: theme.gold, textDecoration: 'none', fontSize: '14px', fontWeight: '600'
    },
    footer: {
        marginTop: '25px', borderTop: `1px solid ${theme.cardLight}`, paddingTop: '20px'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.formBox}>
        <div style={styles.logo}>Birdify</div>
        <p style={styles.subtitle}>Entre para gerenciar seus scores</p>
        
        <form onSubmit={handleLogin}>
          <span style={styles.label}>E-mail</span>
          <input 
            type="email" 
            placeholder="exemplo@email.com" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />
          
          <span style={styles.label}>Senha</span>
          <input 
            type="password" 
            placeholder="••••••••" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
          />
          
          <button type="submit" style={styles.button}>ENTRAR NO SISTEMA</button>
        </form>
        
        {error && <div style={styles.error}>⚠️ {error}</div>}

        <div style={styles.footer}>
            <span style={{color: theme.textMuted, fontSize: '14px'}}>Ainda não joga conosco? </span>
            <Link to="/register" style={styles.link}>
              Cadastre-se
            </Link>
        </div>
      </div>
    </div>
  );
}

export default Login;