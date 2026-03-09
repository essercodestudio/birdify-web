import React from 'react';

const Privacidade = () => {
  return (
    <div style={{ 
      padding: '40px 20px', 
      maxWidth: '800px', 
      margin: '0 auto', 
      lineHeight: '1.6', 
      color: '#333',
      fontFamily: 'sans-serif' 
    }}>
      <h1 style={{ color: '#27ae60' }}>Política de Privacidade</h1>
      <p>A sua privacidade é fundamental para nós. Esta política explica como os seus dados são tratados no nosso sistema de gestão de golfe.</p>
      
      <h3>1. Dados Recolhidos</h3>
      <p>Atualmente, recolhemos o seu <strong>nome completo</strong> e <strong>e-mail</strong> para identificação e gestão de scores. Futuramente, para melhorar a experiência e comunicação, poderemos solicitar o seu <strong>número de telefone</strong> e <strong>data de nascimento</strong> (para fins de categorias etárias e celebrações).</p>

      <h3>2. Utilização dos Dados</h3>
      <p>Os seus dados são utilizados exclusivamente para:
        <ul>
          <li>Gestão da sua participação em torneios e grupos.</li>
          <li>Cálculo de rankings e manutenção do histórico de scores.</li>
          <li>Comunicações essenciais sobre as partidas em que está inscrito.</li>
        </ul>
      </p>

      <h3>3. Segurança e Armazenamento</h3>
      <p>Os seus dados são armazenados num servidor privado (VPS) com acesso restrito. Utilizamos métodos de segurança modernos para proteger as suas informações contra acessos não autorizados.</p>

      <h3>4. Os Seus Direitos</h3>
      <p>De acordo com a LGPD, tem o direito de aceder, corrigir ou solicitar a eliminação dos seus dados. Para qualquer questão relacionada com a sua privacidade, entre em contacto com a administração através do e-mail de suporte.</p>
      
      <hr style={{ margin: '40px 0', border: '0', borderTop: '1px solid #eee' }} />
      <p style={{ fontSize: '12px', color: '#888' }}>Última atualização: Março de 2026</p>
    </div>
  );
};

export default Privacidade;