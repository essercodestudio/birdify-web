// frontend/src/pages/AdminKPIs.js
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { getUser } from '../services/authStorage';
import { useBirdifyTheme } from '../hooks/useBirdifyTheme';
import AdminNavMenu from '../components/AdminNavMenu';
import {
  LuChartBar,
  LuRocket,
  LuUsers,
  LuUser,
  LuTrophy,
  LuCalendarDays,
  LuFlag,
  LuDollarSign,
  LuFlame,
  LuTriangleAlert,
} from 'react-icons/lu';

const fmtBRL = (n) =>
  Number(n || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });

const fmtDateTimeBR = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

function KpiCard({ label, value, sub, color, icon: Icon, theme }) {
  const finalColor = color || theme.accent;
  return (
    <div style={{
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: 20,
      minHeight: 120,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <span style={{ color: theme.textMuted, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </span>
        {Icon && <Icon size={22} color={finalColor} />}
      </div>
      <div>
        <div style={{ color: finalColor, fontSize: 32, fontWeight: 800, lineHeight: 1.1, marginTop: 8 }}>
          {value}
        </div>
        {sub && (
          <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, theme }) {
  return (
    <div style={{
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: 20,
      marginTop: 20,
    }}>
      <h3 style={{ color: theme.textMain, fontSize: 16, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function AdminKPIs() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const [data, setData] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchKPIs = useCallback(async () => {
    try {
      setError(null);
      const [dash, onb] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/onboarding'),
      ]);
      setData(dash.data);
      setOnboarding(onb.data);
    } catch (e) {
      const status = e.response?.status;
      if (status === 403) setError('Acesso restrito a administradores.');
      else setError('Não foi possível carregar os KPIs. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const parsed = getUser();
    if (!parsed) { navigate('/login'); return; }
    try {
      if (parsed.role !== 'ADMIN') { navigate('/'); return; }
    } catch {
      navigate('/login');
      return;
    }
    fetchKPIs();
  }, [navigate, fetchKPIs]);

  if (loading) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Carregando KPIs...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, padding: 40 }}>
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.danger}`, borderRadius: 12, padding: 24, maxWidth: 500, margin: '0 auto' }}>
          <h2 style={{ color: theme.danger, fontSize: 18, marginBottom: 10 }}>Erro</h2>
          <p style={{ color: theme.textMuted }}>{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            style={{ marginTop: 16, padding: '10px 20px', backgroundColor: theme.accent, color: theme.accentContrast, border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const k = data?.kpis || {};
  const top = data?.top_jogadores || [];
  const dif = data?.buracos_dificeis || [];

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        <AdminNavMenu />

        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: theme.textMain, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
              <LuChartBar size={24} color={theme.accent} />
              Painel do Gestor
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              Última atualização: {fmtDateTimeBR(data?.updated_at)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={fetchKPIs}
              style={{ padding: '10px 16px', backgroundColor: theme.cardLight, color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
            >
              Atualizar
            </button>
          </div>
        </div>

        {/* Onboarding checklist — só aparece se ainda tem passo pendente */}
        {onboarding && onboarding.progress.percent < 100 && (
          <div style={{
            backgroundColor: theme.card,
            border: `1px solid ${theme.accent}`,
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <h3 style={{ color: theme.textMain, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <LuRocket size={16} color={theme.accent} />
                Configuração do clube ({onboarding.progress.completed}/{onboarding.progress.total})
              </h3>
              <div style={{ color: theme.accent, fontSize: 22, fontWeight: 800 }}>
                {onboarding.progress.percent}%
              </div>
            </div>

            {/* Barra de progresso */}
            <div style={{ height: 8, backgroundColor: theme.cardLight, borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{
                width: `${onboarding.progress.percent}%`,
                height: '100%',
                backgroundColor: theme.accent,
                transition: 'width 0.3s',
              }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
              {onboarding.steps.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(s.link)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    backgroundColor: s.done ? '#052e16' : theme.cardLight,
                    border: `1px solid ${s.done ? theme.accent : theme.border}`,
                    borderRadius: 8,
                    color: theme.textMain,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 13,
                  }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%',
                    backgroundColor: s.done ? theme.accent : 'transparent',
                    border: s.done ? 'none' : `2px solid ${theme.textMuted}`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: '#000', fontWeight: 800, fontSize: 12, flexShrink: 0,
                  }}>
                    {s.done ? '✓' : ''}
                  </span>
                  <span style={{ textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.7 : 1 }}>
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
        }}>
          <KpiCard theme={theme}
            label="Sócios ativos (30d)"
            value={k.socios_ativos_30d ?? 0}
            sub="Jogaram torneio ou treino no último mês"
            color={theme.accent}
            icon={LuUsers}
          />
          <KpiCard theme={theme}
            label="Sócios totais"
            value={k.socios_total ?? 0}
            sub="Histórico completo do clube"
            color={theme.info}
            icon={LuUser}
          />
          <KpiCard theme={theme}
            label="Torneios do mês"
            value={k.torneios_mes ?? 0}
            sub="Criados no mês corrente"
            color={theme.gold}
            icon={LuTrophy}
          />
          <KpiCard theme={theme}
            label="Torneios futuros"
            value={k.torneios_futuros ?? 0}
            sub="Agendados e ativos"
            color={theme.accent}
            icon={LuCalendarDays}
          />
          <KpiCard theme={theme}
            label="Treinos (30d)"
            value={k.treinos_30d ?? 0}
            sub="Mesas de treino nos últimos 30 dias"
            color={theme.info}
            icon={LuFlag}
          />
          <KpiCard theme={theme}
            label="Receita estimada do mês"
            value={fmtBRL(k.receita_estimada_mes)}
            sub="Inscrições aprovadas × taxa"
            color={theme.gold}
            icon={LuDollarSign}
          />
        </div>

        {/* Top jogadores */}
        <Section theme={theme} title={<><LuFlame size={16} color={theme.gold} /> Top 5 jogadores mais engajados (últimos 90 dias)</>}>
          {top.length === 0 ? (
            <p style={{ color: theme.textMuted, fontSize: 14 }}>
              Ainda sem dados suficientes.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top.map((p, idx) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: theme.cardLight,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%',
                      backgroundColor: idx === 0 ? theme.gold : theme.border,
                      color: idx === 0 ? "#000" : theme.textMain,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 13,
                    }}>{idx + 1}</span>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                  </div>
                  <span style={{ color: theme.accent, fontWeight: 700 }}>
                    {p.partidas} partidas
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Buracos difíceis */}
        <Section theme={theme} title={<><LuTriangleAlert size={16} color={theme.gold} /> Buracos com maior média de tacadas</>}>
          {dif.length === 0 ? (
            <p style={{ color: theme.textMuted, fontSize: 14 }}>
              Sem amostras suficientes ainda.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ color: theme.textMuted, textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>Buraco</th>
                    <th style={{ padding: '8px 12px' }}>Média de tacadas</th>
                    <th style={{ padding: '8px 12px' }}>Amostras</th>
                  </tr>
                </thead>
                <tbody>
                  {dif.map((h) => (
                    <tr key={h.hole} style={{ borderTop: `1px solid ${theme.border}` }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>#{h.hole}</td>
                      <td style={{ padding: '10px 12px', color: theme.danger, fontWeight: 700 }}>{h.media_tacadas}</td>
                      <td style={{ padding: '10px 12px', color: theme.textMuted }}>{h.amostras}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <p style={{ color: theme.textMuted, fontSize: 12, marginTop: 20, textAlign: 'center' }}>
          Clube #{data?.club_id} · Birdify
        </p>

      </div>
    </div>
  );
}

export default AdminKPIs;
