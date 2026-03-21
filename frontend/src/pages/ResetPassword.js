import React, { useState } from 'react';
import api from '../services/api';
import { useParams, useNavigate } from 'react-router-dom';

function ResetPassword() {
  const { token } = useParams(); // Pega o token da URL
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const theme = { bg: '#0f172a', card: '#1e293b', accent: '#22c55e', text: '#f8fafc', textMuted: '#94a3b8' };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage('As senhas não coincidem!');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const res = await api.post('/auth/reset-password', { token, newPassword });
      setMessage(res.data.message);
      setTimeout(() => navigate('/login'), 3000); // Manda pro login depois de 3 segundos
    } catch (error) {
      setMessage(error.response?.data?.message || 'Erro ao redefinir a senha. O link pode ter expirado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: theme.text, fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: theme.card, padding: '30px', borderRadius: '12px', width: '100%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
        <h2 style={{ color: theme.accent, marginBottom: '20px' }}>Criar Nova Senha</h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input 
            type="password" placeholder="Nova Senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength="6"
            style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#334155', color: '#fff' }}
          />
          <input 
            type="password" placeholder="Confirmar Nova Senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength="6"
            style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#334155', color: '#fff' }}
          />
          <button type="submit" disabled={loading} style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: theme.accent, color: '#000', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Salvando...' : 'Salvar Nova Senha'}
          </button>
        </form>

        {message && <p style={{ marginTop: '15px', fontSize: '14px', color: theme.text }}>{message}</p>}
      </div>
    </div>
  );
}

export default ResetPassword;