import React, { useState } from 'react';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const theme = { bg: '#0f172a', card: '#1e293b', accent: '#22c55e', text: '#f8fafc', textMuted: '#94a3b8' };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setMessage(res.data.message || 'Se o e-mail estiver cadastrado, um link será enviado.');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Erro ao tentar enviar o e-mail.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: theme.text, fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: theme.card, padding: '30px', borderRadius: '12px', width: '100%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
        <h2 style={{ color: theme.accent, marginBottom: '20px' }}>Recuperar Senha</h2>
        <p style={{ color: theme.textMuted, fontSize: '14px', marginBottom: '20px' }}>Digite seu e-mail abaixo e enviaremos um link para você redefinir sua senha.</p>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input 
            type="email" placeholder="Seu e-mail de cadastro" value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#334155', color: '#fff' }}
          />
          <button type="submit" disabled={loading} style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: theme.accent, color: '#000', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Enviando...' : 'Enviar Link'}
          </button>
        </form>

        {message && <p style={{ marginTop: '15px', fontSize: '14px', color: theme.text }}>{message}</p>}

        <button onClick={() => navigate('/login')} style={{ marginTop: '20px', background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', textDecoration: 'underline' }}>
          Voltar para o Login
        </button>
      </div>
    </div>
  );
}

export default ForgotPassword;