import React, { useState, useEffect } from 'react';

const LGPDBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Verifica se o utilizador já aceitou anteriormente
    const consent = localStorage.getItem('birdify_lgpd_consent');
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const acceptConsent = () => {
    localStorage.setItem('birdify_lgpd_consent', 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: '#2c3e50', color: 'white',
      padding: '20px', textAlign: 'center', zIndex: 9999,
      boxShadow: '0 -2px 10px rgba(0,0,0,0.3)',
      fontFamily: 'sans-serif'
    }}>
      <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
        Este site utiliza cookies para garantir a melhor experiência na marcação de scores. 
        Ao continuar, concorda com a nossa <a href="/privacidade" style={{ color: '#27ae60', fontWeight: 'bold', textDecoration: 'underline' }}>Política de Privacidade</a>.
      </p>
      <button 
        onClick={acceptConsent}
        style={{
          background: '#27ae60', color: 'white', border: 'none',
          padding: '10px 30px', borderRadius: '5px', cursor: 'pointer', 
          fontWeight: 'bold', fontSize: '14px'
        }}
      >
        Entendido e Aceito
      </button>
    </div>
  );
};

export default LGPDBanner;