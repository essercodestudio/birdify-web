import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { socket } from '../services/socket';
import { useClub } from '../context/ClubContext';

const TABS = ['ABSOLUTO', 'MASCULINO', 'FEMININO'];

function TrainingLeaderboard() {
  const navigate           = useNavigate();
  const { club } = useClub();

  const [data, setData]               = useState({ ranking: [], hole_scores: [], holesData: [] });
  const [activeTab, setActiveTab]     = useState('ABSOLUTO');
  const [expandedKey, setExpandedKey] = useState(null);

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

  const getFiltered = () => {
    let list = [...data.ranking];
    if (activeTab === 'MASCULINO') list = list.filter(p => p.gender === 'M' || p.gender === 'Masculino');
    if (activeTab === 'FEMININO')  list = list.filter(p => p.gender === 'F' || p.gender === 'Feminino');
    return list.sort((a, b) => {
      const hA = a.holes_played || 0, hB = b.holes_played || 0;
      if (hA === 0 && hB === 0) return (a.name || '').localeCompare(b.name || '');
      if (hA > 0 && hB === 0)   return -1;
      if (hA === 0 && hB > 0)   return 1;
      const diff = a.score_to_par - b.score_to_par;
      return diff !== 0 ? diff : hB - hA;
    });
  };

  const getHoleStyle = (strokes, par) => {
    if (!strokes) return { bg: theme.cardLight, color: theme.textMuted, border: theme.cardLight };
    const diff = strokes - par;
    if (strokes === 1 || diff <= -2) return { bg: 'rgba(234,179,8,0.25)',  color: theme.gold,   border: theme.gold };
    if (diff === -1)                  return { bg: 'rgba(74,222,128,0.2)',  color: '#4ade80',    border: '#4ade80' };
    if (diff === 0)                   return { bg: 'rgba(203,213,225,0.07)', color: '#cbd5e1',   border: '#475569' };
    return                                   { bg: 'rgba(239,68,68,0.2)',   color: theme.danger, border: theme.danger };
  };

  const getParFor = (holeNum) => {
    const h = data.holesData.find(h => h.hole_number === holeNum);
    return h ? h.par : 4;
  };

  const renderNine = (userId, groupId, from, to) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '4px', marginBottom: '10px' }}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(num => {
        const hit = data.hole_scores.find(
          s => s.user_id === userId && s.group_id === groupId && s.hole_number === num
        );
        const par = hit ? hit.par : getParFor(num);
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
    container: { padding: '20px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, fontFamily: "'Segoe UI', Roboto, sans-serif", maxWidth: '600px', margin: '0 auto' },
    topBar:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
    btnBack:   { backgroundColor: 'transparent', color: theme.gold, border: `1px solid ${theme.gold}`, padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' },
    tabs:      { display: 'flex', gap: '6px', marginBottom: '20px' },
    tabBtn: (active) => ({
      flex: 1, padding: '11px 6px', borderRadius: '10px', border: 'none', fontSize: '12px',
      fontWeight: 'bold', cursor: 'pointer',
      backgroundColor: active ? accent     : theme.card,
      color:           active ? '#000'     : theme.textMuted,
      boxShadow:       active ? `0 4px 12px -2px ${accent}44` : 'none',
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
        <button onClick={() => navigate(-1)} style={styles.btnBack}>⬅ VOLTAR</button>
        <div style={{ color: theme.danger, fontWeight: 'bold', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="live-dot" /> AO VIVO
        </div>
      </div>

      <h2 style={{ color: theme.gold, margin: '0 0 20px', fontSize: '20px' }}>🏆 Ranking do Dia</h2>

      <div style={styles.tabs}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={styles.tabBtn(activeTab === tab)}>
            {tab}
          </button>
        ))}
      </div>

      <div style={styles.tableCard}>
        {/* Cabeçalho — HB omitido para Footgolf */}
        <div style={styles.headerRow}>
          <div>#</div>
          <div>ATLETA</div>
          <div style={{ textAlign: 'center' }}>HB</div>
          <div style={{ textAlign: 'center' }}>TOT</div>
          <div style={{ textAlign: 'center' }}>PAR</div>
        </div>

        {displayed.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: theme.textMuted, fontSize: '14px' }}>
            Nenhum treino registrado hoje.
          </div>
        )}

        {displayed.map((player, idx) => {
          const rowKey     = `${player.id}_${player.group_id}`;
          const diff       = parseInt(player.score_to_par || 0);
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
