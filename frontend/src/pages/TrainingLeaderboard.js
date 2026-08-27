import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import { socket } from '../services/socket';
import { useClub } from '../context/ClubContext';
import { LuArrowLeft, LuTrophy, LuShare2 } from 'react-icons/lu';
import { TOURNAMENT_CATEGORIES, applyCategoryFilter, isNetCategory } from '../utils/categories';

// Categorias da MESMA fonte do torneio (utils/categories.js) — lista completa,
// mesmo sem atleta na faixa. ABSOLUTO = gross geral; categorias Net rankeiam
// por NET (par - handicap); Gross (M0/F0) rankeiam bruto por gênero.

function TrainingLeaderboard() {
  const navigate           = useNavigate();
  const location           = useLocation();
  const { club } = useClub();

  const { returnHole, groupId: returnGroupId } = location.state || {};

  const [data, setData]               = useState({ ranking: [], hole_scores: [], holesData: [] });
  const [activeTab, setActiveTab]     = useState('ABSOLUTO');
  const [expandedKey, setExpandedKey] = useState(null);
  const [shareToast, setShareToast]   = useState(false);

  const handleShare = async () => {
    if (!returnGroupId) return;
    const url = `${window.location.origin}/treino/${returnGroupId}/ranking`;
    const shareData = { title: 'Ranking do treino — Birdify', text: 'Acompanhe o ranking do treino em tempo real:', url };
    try {
      if (navigator.share) { await navigator.share(shareData); return; }
      await navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    } catch (_) { /* usuário cancelou o share nativo — silêncio */ }
  };

  const accent = club?.primary_color || '#22c55e';
  const theme  = {
    bg: '#0f172a', card: '#1e293b', cardLight: '#334155', accent,
    gold: '#eab308', textMain: '#f8fafc', textMuted: '#94a3b8', danger: '#ef4444',
  };

  const fetchRanking = useCallback(async () => {
    try {
      const res = await api.get('/training/ranking/daily');
      setData(res.data);
    } catch (err) {
      console.error('Erro ao buscar ranking diário:', err);
    }
  }, []);

  useEffect(() => {
    fetchRanking();

    socket.connect();
    socket.emit('join:ranking');
    socket.on('training:ranking_updated', fetchRanking);

    // Fallback de 60s caso o socket caia
    const interval = setInterval(fetchRanking, 60000);

    return () => {
      socket.off('training:ranking_updated', fetchRanking);
      socket.disconnect();
      clearInterval(interval);
    };
  }, [fetchRanking]);

  // "AO VIVO" só quando existe treino em andamento agora (mesma lógica do LIVE
  // do torneio): algum grupo do dia com status 'ativo'. Dia sem treino ou só
  // com treinos finalizados não é "ao vivo".
  const isLiveDay = data.ranking.some(r => r.group_status === 'ativo');

  // ABSOLUTO + as 9 categorias completas do torneio (sempre visíveis)
  const tabs = ['ABSOLUTO', ...TOURNAMENT_CATEGORIES];
  const isNetTab = activeTab !== 'ABSOLUTO' && isNetCategory(activeTab);

  const netOf = (p) => (p.score_to_par || 0) - (parseFloat(p.handicap) || 0);

  const getFiltered = () => {
    let list = [...data.ranking];
    if (activeTab !== 'ABSOLUTO') list = applyCategoryFilter(list, activeTab);
    return list.sort((a, b) => {
      const hA = a.holes_played || 0, hB = b.holes_played || 0;
      if (hA === 0 && hB === 0) return (a.name || '').localeCompare(b.name || '');
      if (hA > 0 && hB === 0)   return -1;
      if (hA === 0 && hB > 0)   return 1;
      const diff = isNetTab ? netOf(a) - netOf(b) : a.score_to_par - b.score_to_par;
      return diff !== 0 ? diff : hB - hA;
    });
  };

  const getHoleStyle = (strokes, par) => {
    const s = Number(strokes), p = Number(par) || 4;
    if (!s) return { bg: theme.cardLight, color: theme.textMuted, border: theme.cardLight };
    const diff = s - p;
    if (s === 1 || diff <= -2) return { bg: 'rgba(234,179,8,0.25)',   color: theme.gold,   border: theme.gold };
    if (diff === -1)            return { bg: 'rgba(74,222,128,0.2)',   color: '#4ade80',    border: '#4ade80' };
    if (diff === 0)             return { bg: 'rgba(203,213,225,0.07)', color: '#cbd5e1',    border: '#475569' };
    return                             { bg: 'rgba(239,68,68,0.2)',    color: theme.danger, border: theme.danger };
  };

  const getParFor = (holeNum) => {
    const h = data.holesData.find(h => Number(h.hole_number) === holeNum);
    return h ? Number(h.par) || 4 : 4;
  };

  const renderNine = (userId, groupId, from, to) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '4px', marginBottom: '10px' }}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(num => {
        const hit = data.hole_scores.find(
          s => Number(s.user_id) === Number(userId) &&
               Number(s.group_id) === Number(groupId) &&
               Number(s.hole_number) === num
        );
        // hit.hole_par vem correto por row do backend (COALESCE filtrado pelo course
        // do treino específico). holesData é fallback e SÓ vale se o dia tiver 1
        // curso — se tiver treinos em cursos diferentes, holesData vira o par do
        // primeiro course e contamina os demais. Por isso hit.hole_par tem prioridade.
        const par = Number(hit?.hole_par) || getParFor(num) || 4;
        const { bg, color, border } = getHoleStyle(hit?.strokes, par);
        return (
          <div key={num} style={{ backgroundColor: bg, border: `1px solid ${border}`, borderRadius: '6px', padding: '5px 2px', textAlign: 'center' }}>
            <div style={{ fontSize: '9px',  color: theme.textMuted, fontWeight: 'bold' }}>B{num}</div>
            <div style={{ fontSize: '8px',  color: theme.textMuted, marginBottom: '2px' }}>P{par}</div>
            <div style={{ fontSize: '15px', fontWeight: '900', color }}>{hit?.strokes || '-'}</div>
          </div>
        );
      })}
    </div>
  );

  const renderLegend = () => (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${theme.cardLight}` }}>
      {[
        { color: theme.gold,   label: 'Eagle / HiO' },
        { color: '#4ade80',    label: 'Birdie' },
        { color: '#cbd5e1',    label: 'Par' },
        { color: theme.danger, label: 'Bogey+' },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: color, flexShrink: 0 }} />
          <span style={{ fontSize: '10px', color: theme.textMuted }}>{label}</span>
        </div>
      ))}
    </div>
  );

  const renderAccordion = (userId, groupId) => (
    <div style={{ backgroundColor: theme.bg, padding: '12px', borderRadius: '8px', marginTop: '6px' }}>
      <div style={{ fontSize: '10px', color: theme.textMuted, fontWeight: 'bold', marginBottom: '6px', textAlign: 'left' }}>IDA (FRONT 9)</div>
      {renderNine(userId, groupId, 1, 9)}
      <div style={{ fontSize: '10px', color: theme.textMuted, fontWeight: 'bold', marginBottom: '6px', textAlign: 'left' }}>VOLTA (BACK 9)</div>
      {renderNine(userId, groupId, 10, 18)}
      {renderLegend()}
    </div>
  );

  const displayed = getFiltered();

  // # | ATLETA | HB | TOT | PAR
  const gridCols = '36px 1fr 44px 50px 58px';

  const styles = {
    container: { padding: '20px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, maxWidth: '600px', margin: '0 auto' },
    topBar:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
    btnBack:   { backgroundColor: 'transparent', color: theme.textMuted, border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    tabs:      { display: 'flex', gap: '6px', marginBottom: '20px' },
    tabBtn: (active) => ({
      flex: 1, padding: '11px 6px', borderRadius: '10px', border: 'none', fontSize: '12px',
      fontWeight: 'bold', cursor: 'pointer',
      backgroundColor: active ? accent     : theme.card,
      color:           active ? '#000'     : theme.textMuted,
    }),
    tableCard: { backgroundColor: theme.card, borderRadius: '14px', overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.4)', marginBottom: '30px' },
    headerRow: {
      display: 'grid', gridTemplateColumns: gridCols,
      padding: '12px 10px', backgroundColor: theme.cardLight,
      color: theme.textMuted, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', gap: '4px',
    },
    playerRow: (isFirst, hasPlayed) => ({
      display: 'grid', gridTemplateColumns: gridCols,
      padding: '14px 10px', borderBottom: `1px solid ${theme.cardLight}`,
      alignItems: 'center', gap: '4px', cursor: 'pointer',
      backgroundColor: isFirst && hasPlayed ? 'rgba(234,179,8,0.04)' : 'transparent',
    }),
    accordionWrap: { padding: '0 10px 14px', borderBottom: `1px solid ${theme.cardLight}` },
    badge: (diff, hasPlayed) => ({
      textAlign: 'center', padding: '4px 2px', borderRadius: '6px', fontSize: '13px', fontWeight: '800',
      backgroundColor: !hasPlayed ? 'transparent'
        : diff < 0 ? 'rgba(74,222,128,0.15)'
        : diff > 0 ? 'rgba(239,68,68,0.15)'
        : 'rgba(148,163,184,0.10)',
      color: !hasPlayed ? theme.textMuted
        : diff < 0 ? '#4ade80'
        : diff > 0 ? theme.danger
        : '#cbd5e1',
    }),
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <button
          onClick={() => {
            if (returnGroupId) {
              navigate(`/training-scorecard/${returnGroupId}`, { state: { returnHole } });
            } else {
              navigate(-1);
            }
          }}
          style={styles.btnBack}
        ><LuArrowLeft size={15} /> VOLTAR</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isLiveDay && (
            <div style={{ color: theme.danger, fontWeight: 'bold', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="live-dot" /> AO VIVO
            </div>
          )}
          {returnGroupId && (
            <button
              onClick={handleShare}
              aria-label="Compartilhar ranking"
              title="Compartilhar ranking"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, backgroundColor: 'transparent', color: theme.textMain, border: `1px solid ${theme.cardLight}`, borderRadius: 8, cursor: 'pointer' }}
            >
              <LuShare2 size={16} />
            </button>
          )}
        </div>
      </div>
      {shareToast && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', backgroundColor: accent, color: '#000', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 9999 }}>
          Link copiado!
        </div>
      )}

      <h2 style={{ color: theme.gold, margin: '0 0 20px', fontSize: '20px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <LuTrophy size={18} />
        Ranking do Dia
      </h2>

      <div style={{ ...styles.tabs, overflowX: 'auto', paddingBottom: '4px' }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ ...styles.tabBtn(activeTab === tab), flex: 'none', padding: '11px 16px', whiteSpace: 'nowrap' }}>
            {tab}
          </button>
        ))}
      </div>

      <div style={styles.tableCard}>
        <div style={styles.headerRow}>
          <div>#</div>
          <div>ATLETA</div>
          <div style={{ textAlign: 'center' }}>HB</div>
          <div style={{ textAlign: 'center' }}>TOT</div>
          <div style={{ textAlign: 'center' }}>{isNetTab ? 'NET' : 'PAR'}</div>
        </div>

        {displayed.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: theme.textMuted, fontSize: '14px' }}>
            {data.ranking.length === 0 ? 'Nenhum treino registrado hoje.' : 'Nenhum jogador nesta categoria.'}
          </div>
        )}

        {displayed.map((player, idx) => {
          const rowKey     = `${player.id}_${player.group_id}`;
          // Aba de categoria mostra NET (par - handicap); ABSOLUTO mostra gross
          const rawDiff    = isNetTab ? netOf(player) : parseInt(player.score_to_par || 0);
          const diff       = Math.round(rawDiff * 10) / 10;
          const isExpanded = expandedKey === rowKey;
          const hasPlayed  = (player.holes_played || 0) > 0;
          const isFirst    = idx === 0;

          let displayPar = '--';
          if (hasPlayed) displayPar = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;

          return (
            <React.Fragment key={rowKey}>
              <div
                style={styles.playerRow(isFirst, hasPlayed)}
                onClick={() => setExpandedKey(isExpanded ? null : rowKey)}
              >
                {/* Posição */}
                <div style={{ fontWeight: '800', color: isFirst && hasPlayed ? theme.gold : theme.textMuted, fontSize: '14px' }}>
                  {hasPlayed ? idx + 1 : '-'}
                </div>

                {/* Nome + training_label (só exibe se backend enviou, ou seja, > 1 treino no dia) */}
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: isFirst && hasPlayed ? theme.gold : theme.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {player.name}
                    {!player.training_label && (
                      <span style={{ fontSize: '10px', color: theme.textMuted, marginLeft: '5px' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                  {/* Subtítulo cronológico — aparece APENAS para atletas com múltiplos treinos */}
                  {player.training_label && (
                    <div style={{ fontSize: '10px', color: theme.textMuted, marginTop: '1px' }}>
                      {player.training_label} {isExpanded ? '▲' : '▼'}
                    </div>
                  )}
                </div>

                {/* Buracos jogados */}
                <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 'bold', color: theme.textMuted }}>
                  {hasPlayed ? player.holes_played : '--'}
                </div>

                {/* Total de tacadas */}
                <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 'bold', color: hasPlayed ? theme.textMain : theme.textMuted }}>
                  {hasPlayed ? player.total_strokes : '--'}
                </div>

                {/* Saldo vs PAR */}
                <div style={styles.badge(diff, hasPlayed)}>{displayPar}</div>
              </div>

              {isExpanded && (
                <div style={styles.accordionWrap}>
                  {renderAccordion(player.id, player.group_id)}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <style>{`
        .live-dot {
          height: 8px; width: 8px; background-color: #ef4444;
          border-radius: 50%; display: inline-block;
          animation: blink 1s infinite;
        }
        @keyframes blink { 0%,100%{opacity:1;} 50%{opacity:0.2;} }
      `}</style>
    </div>
  );
}

export default TrainingLeaderboard;
