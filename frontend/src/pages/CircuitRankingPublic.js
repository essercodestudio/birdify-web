// frontend/src/pages/CircuitRankingPublic.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { getUser } from '../services/authStorage';
import { useParams } from 'react-router-dom';
import { LeaderboardView } from './Leaderboard';
import { LuFlag, LuTriangleAlert, LuTrophy } from 'react-icons/lu';

const T = {
  bg:        '#0a101f',
  card:      '#111827',
  cardLight: '#1f2937',
  border:    '#1c2533',
  accent:    '#22c55e',
  gold:      '#eab308',
  textMain:  '#f1f5f9',
  textSub:   '#94a3b8',
  textMuted: '#4b5563',
  danger:    '#ef4444',
};

// Top 3 destacado por cor (ouro/prata/bronze) em vez de medalha emoji
const MEDAL_COLORS = ['#eab308', '#9ca3af', '#b45309'];
const COL    = '44px 1fr 64px 76px';

const fmt = (pts) =>
  pts === undefined || pts === null ? '0'
  : Number.isInteger(Number(pts)) ? String(Math.round(pts))
  : Number(pts).toFixed(1);

// ─── Category helpers ─────────────────────────────────────────────────────────
function getPlayerCategory(p) {
  const hc = parseFloat(p.handicap ?? 0);
  const sx = String(p.gender || 'M').toUpperCase()[0];
  if (sx === 'F') {
    if (hc <= 16.1) return 'F1';
    if (hc <= 23.7) return 'F2';
    return 'F3';
  }
  if (hc <= 8.5)  return 'M1';
  if (hc <= 14.0) return 'M2';
  if (hc <= 22.1) return 'M3';
  return 'M4';
}

function deriveCategorias(ranking) {
  const cats = new Set();
  for (const p of ranking) {
    const c = getPlayerCategory(p);
    cats.add(c.startsWith('F') ? 'Feminino' : c);
  }
  return ['M1', 'M2', 'M3', 'M4', 'Feminino'].filter(c => cats.has(c));
}

function filterByCat(players, cat) {
  if (cat === 'TODOS')    return players;
  if (cat === 'Feminino') return players.filter(p => String(p.gender || 'M').toUpperCase()[0] === 'F');
  return players.filter(p => getPlayerCategory(p) === cat);
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CircuitRankingPublic() {
  const { circuitId } = useParams();

  const [data,             setData]             = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState(null);
  const [viewMode,         setViewMode]         = useState('oficial');
  const [activeCategory,   setActiveCategory]   = useState('TODOS');
  const [playerModal,      setPlayerModal]      = useState(null); // player object
  const [leaderboardModal, setLeaderboardModal] = useState(null);

  const isAdmin = useMemo(() => {
    return getUser()?.role === 'ADMIN';
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/circuits/${circuitId}/ranking`);
      setData(res.data);
    } catch {
      setError('Não foi possível carregar o ranking.');
    } finally {
      setLoading(false);
    }
  }, [circuitId]);

  useEffect(() => { load(); }, [load]);

  const stageGrid = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: data.circuit.total_stages || 0 }, (_, i) => {
      const n      = i + 1;
      const linked = data.stages.find(s => s.stage_number === n);
      return linked ? { ...linked, virtual: false } : { stage_number: n, virtual: true };
    });
  }, [data]);

  const sortedRanking = useMemo(() => {
    if (!data) return [];
    const key = viewMode === 'oficial' ? 'total_oficial' : 'total_bruto';
    return [...data.ranking].sort((a, b) => b[key] - a[key]);
  }, [data, viewMode]);

  const categories      = useMemo(() => deriveCategorias(sortedRanking), [sortedRanking]);
  const filteredRanking = useMemo(() => filterByCat(sortedRanking, activeCategory), [sortedRanking, activeCategory]);

  const finishedCount = data?.stages.filter(s => s.finished).length ?? 0;
  const numDiscards   = data?.circuit.num_discards ?? 0;
  const showDiscard   = numDiscards > 0 && viewMode === 'oficial';

  const page = {
    backgroundColor: T.bg, minHeight: '100vh', color: T.textMain,
    padding: '0',
  };

  if (loading) return (
    <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: '14px' }}><LuFlag size={44} color={T.accent} /></div>
        <div style={{ color: T.textSub, fontSize: '14px', letterSpacing: '0.5px' }}>Calculando ranking...</div>
      </div>
    </div>
  );

  if (error || !data) return (
    <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', maxWidth: '280px', padding: '24px' }}>
        <div style={{ marginBottom: '10px' }}><LuTriangleAlert size={32} color={T.danger} /></div>
        <div style={{ color: T.danger, fontSize: '14px' }}>{error || 'Circuito não encontrado.'}</div>
      </div>
    </div>
  );

  const { circuit } = data;

  return (
    <div style={page}>

      {/* ── HEADER ── */}
      <div style={{ backgroundColor: T.card, borderBottom: `1px solid ${T.border}`, padding: '20px 20px 0' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '10px', color: T.accent, fontWeight: '700', letterSpacing: '2.5px' }}>
                CIRCUITO / LIGA
              </p>
              <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '700', letterSpacing: '-0.5px', color: T.textMain }}>
                {circuit.name}
              </h1>
              {circuit.description && (
                <p style={{ margin: 0, color: T.textSub, fontSize: '13px', fontWeight: '400', lineHeight: '1.4' }}>
                  {circuit.description}
                </p>
              )}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
              <div style={{ fontSize: '18px', fontWeight: '800', color: T.accent }}>{finishedCount}</div>
              <div style={{ fontSize: '10px', color: T.textMuted }}>/{circuit.total_stages} etapas</div>
            </div>
          </div>

          {/* ── STAGE PILLS ── */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '16px', scrollbarWidth: 'none' }}>
            {stageGrid.map(st => (
              <StagePill key={st.stage_number} stage={st} onView={() => {
                if (!st.virtual && st.finished) setLeaderboardModal({
                  tournamentId:   st.tournament_id,
                  tournamentName: st.tournament_name,
                  stageNumber:    st.stage_number,
                  stageId:        st.stage_id,
                });
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>

        {sortedRanking.length === 0 ? (
          <div style={{
            backgroundColor: T.card, borderRadius: '16px', padding: '56px 24px',
            textAlign: 'center', color: T.textSub, border: `1px solid ${T.border}`,
          }}>
            <div style={{ marginBottom: '12px' }}><LuTrophy size={44} color={T.textMuted} /></div>
            <div style={{ fontSize: '15px', fontWeight: '500', marginBottom: '6px' }}>Nenhuma etapa finalizada.</div>
            <div style={{ fontSize: '12px', color: T.textMuted }}>O ranking aparece após ao menos uma etapa ser concluída.</div>
          </div>
        ) : (
          <>
            {/* ── TOOLBAR: categorias + descarte ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
              {categories.length > 1 && (
                <>
                  {['TODOS', ...categories].map(cat => (
                    <button key={cat} onClick={() => setActiveCategory(cat)} style={{
                      flexShrink: 0, padding: '7px 18px', borderRadius: '20px',
                      fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: 'none',
                      transition: 'background-color 0.15s, color 0.15s',
                      backgroundColor: activeCategory === cat ? T.accent : T.cardLight,
                      color:           activeCategory === cat ? '#000' : T.textSub,
                    }}>
                      {cat}
                    </button>
                  ))}
                </>
              )}
              {numDiscards > 0 && (
                <div style={{ marginLeft: categories.length > 1 ? 'auto' : '0', flexShrink: 0 }}>
                  <DiscardSwitch
                    enabled={viewMode === 'oficial'}
                    onChange={(on) => setViewMode(on ? 'oficial' : 'bruto')}
                  />
                </div>
              )}
            </div>

            {/* ── COLUMN HEADERS ── */}
            <div style={{
              display: 'grid', gridTemplateColumns: COL, gap: '8px',
              padding: '0 14px 8px', fontSize: '10px', color: T.textMuted,
              fontWeight: '700', letterSpacing: '1.2px',
            }}>
              <div style={{ textAlign: 'center' }}>POS</div>
              <div>JOGADOR</div>
              <div style={{ textAlign: 'center' }}>ETAPAS</div>
              <div style={{ textAlign: 'center', color: T.gold }}>TOTAL</div>
            </div>

            {/* ── TABLE ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {filteredRanking.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: T.textMuted }}>
                  Nenhum jogador nesta categoria.
                </div>
              ) : (
                filteredRanking.map((player, idx) => (
                  <PlayerRow
                    key={player.player_id}
                    player={player}
                    pos={idx + 1}
                    showDiscard={showDiscard}
                    viewMode={viewMode}
                    finishedCount={finishedCount}
                    onClick={() => setPlayerModal(player)}
                  />
                ))
              )}
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: '36px', fontSize: '10px', color: T.textMuted, letterSpacing: '1.5px' }}>
          BIRDIFY · DADOS EM TEMPO REAL
        </div>
      </div>

      {/* ── MODAL: EXTRATO DO JOGADOR ── */}
      {playerModal && (
        <PlayerExtractModal
          player={playerModal}
          stageGrid={stageGrid}
          showDiscard={showDiscard}
          viewMode={viewMode}
          onClose={() => setPlayerModal(null)}
        />
      )}

      {/* ── MODAL: LEADERBOARD DA ETAPA ── */}
      {leaderboardModal && (
        <TournamentLeaderboardModal
          tournamentId={leaderboardModal.tournamentId}
          tournamentName={leaderboardModal.tournamentName}
          stageNumber={leaderboardModal.stageNumber}
          stageId={leaderboardModal.stageId}
          circuitId={circuitId}
          isAdmin={isAdmin}
          onPositionsUpdated={load}
          onClose={() => setLeaderboardModal(null)}
        />
      )}

      <style>{`
        @keyframes slideUp { from { transform: translateY(60px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeBg  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes blink   { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}

// ─── PlayerRow ────────────────────────────────────────────────────────────────
function PlayerRow({ player, pos, showDiscard, viewMode, finishedCount, onClick }) {
  const isTop3  = pos <= 3;
  const total   = viewMode === 'oficial' ? player.total_oficial : player.total_bruto;
  const discards = player.discarded_stages || (player.discarded_stage ? [player.discarded_stage] : []);
  const played  = player.stages?.filter(s => s.participated && !s.pending).length ?? 0;

  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      style={{
        display: 'grid', gridTemplateColumns: COL, alignItems: 'center', gap: '8px',
        backgroundColor: T.card, padding: '13px 14px', borderRadius: '10px',
        border: `1px solid ${T.border}`, cursor: 'pointer', userSelect: 'none',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = T.accent + '50'}
      onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
    >
      {/* POS */}
      <div style={{ textAlign: 'center' }}>
        {isTop3
          ? <span style={{ fontSize: '14px', fontWeight: '800', color: MEDAL_COLORS[pos - 1] }}>{pos}º</span>
          : <span style={{ fontSize: '13px', fontWeight: '700', color: T.textSub }}>{pos}º</span>}
      </div>

      {/* JOGADOR */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: '500', color: T.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {player.player_name}
        </div>
        {showDiscard && discards.length > 0 && (
          <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '2px' }}>
            Descartes: {discards.map((d, i) => <span key={d.stage_number}>{i > 0 && ' · '}E{d.stage_number}</span>)}
          </div>
        )}
      </div>

      {/* ETAPAS */}
      <div style={{ textAlign: 'center', fontSize: '12px' }}>
        <span style={{ fontWeight: '700', color: T.textMain }}>{played}</span>
        <span style={{ color: T.textMuted }}>/{finishedCount}</span>
      </div>

      {/* TOTAL */}
      <div style={{ textAlign: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: '54px', padding: '5px 8px', borderRadius: '8px',
          fontWeight: '800', fontSize: '15px',
          backgroundColor: isTop3 ? T.gold + '20' : T.cardLight,
          color:           isTop3 ? T.gold : T.textMain,
          border:          `1px solid ${isTop3 ? T.gold + '50' : T.border}`,
        }}>
          {fmt(total)}
        </span>
      </div>
    </div>
  );
}

// ─── PlayerExtractModal ───────────────────────────────────────────────────────
function PlayerExtractModal({ player, stageGrid, showDiscard, viewMode, onClose }) {
  const total    = viewMode === 'oficial' ? player.total_oficial : player.total_bruto;
  const discards = player.discarded_stages || (player.discarded_stage ? [player.discarded_stage] : []);
  const category = getPlayerCategory(player);
  const played   = player.stages?.filter(s => s.participated && !s.pending).length ?? 0;

  const catLabel = category.startsWith('F') ? 'Feminino' : category;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,.88)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1200, animation: 'fadeBg 0.2s ease' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: T.card, borderRadius: '20px 20px 0 0', border: `1px solid ${T.border}`, width: '100%', maxWidth: '640px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', animation: 'slideUp 0.3s ease' }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
          <div style={{ width: '36px', height: '4px', borderRadius: '2px', backgroundColor: T.cardLight }} />
        </div>

        {/* Header */}
        <div style={{ padding: '16px 20px 14px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: '0 0 6px', fontSize: '9px', color: T.accent, fontWeight: '700', letterSpacing: '2px' }}>
                EXTRATO DO JOGADOR
              </p>
              <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: '700', color: T.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {player.player_name}
              </h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  backgroundColor: T.accent + '20', color: T.accent,
                  border: `1px solid ${T.accent}50`, borderRadius: '6px',
                  fontSize: '11px', fontWeight: '700', padding: '3px 10px', letterSpacing: '0.5px',
                }}>
                  {catLabel}
                </span>
                <span style={{ fontSize: '12px', color: T.textMuted }}>
                  HCP {Number(player.handicap ?? 0).toFixed(1)}
                </span>
                <span style={{ fontSize: '12px', color: T.textMuted }}>·</span>
                <span style={{ fontSize: '12px', color: T.textSub }}>
                  {played} etapa{played !== 1 ? 's' : ''} disputada{played !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Total badge */}
            <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: '16px' }}>
              <div style={{ fontSize: '28px', fontWeight: '800', color: T.gold, lineHeight: 1 }}>
                {fmt(total)}
              </div>
              <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '3px', fontWeight: '600' }}>
                {viewMode === 'oficial' ? 'PTS OFICIAL' : 'PTS BRUTO'}
              </div>
            </div>

            <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: '20px', cursor: 'pointer', minWidth: '40px', minHeight: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
          </div>
        </div>

        <div style={{ height: '1px', backgroundColor: T.border, flexShrink: 0 }} />

        {/* Stage list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

          {showDiscard && discards.length > 0 && (
            <div style={{ padding: '8px 14px', borderRadius: '8px', backgroundColor: T.bg, border: `1px solid ${T.danger}30`, marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: T.danger, fontWeight: '600' }}>
                {discards.length} etapa{discards.length > 1 ? 's' : ''} descartada{discards.length > 1 ? 's' : ''} do total oficial
              </span>
            </div>
          )}

          {stageGrid.map(st => {
            const entry   = player.stages?.find(s => s.stage_number === st.stage_number);
            const discard = showDiscard && discards.some(d => d.stage_number === st.stage_number);
            return <ExtractRow key={st.stage_number} stage={st} entry={entry} discarded={discard} />;
          })}

          {showDiscard && (
            <div style={{
              marginTop: '6px', padding: '12px 16px', borderRadius: '10px',
              backgroundColor: T.bg, border: `1px solid ${T.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '12px', color: T.textMuted }}>Total bruto (sem descarte)</span>
              <span style={{ fontSize: '14px', fontWeight: '700', color: T.textSub }}>{fmt(player.total_bruto)} pts</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
          <button onClick={onClose} style={{ width: '100%', padding: '13px', backgroundColor: 'transparent', border: `1px solid ${T.border}`, color: T.textSub, borderRadius: '12px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ExtractRow ───────────────────────────────────────────────────────────────
function ExtractRow({ stage, entry, discarded }) {
  const base = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderRadius: '10px',
    border: `1px solid ${discarded ? T.danger + '30' : T.border}`,
    backgroundColor: discarded ? T.danger + '05' : 'transparent',
  };

  const stageLabel = (
    <div>
      <div style={{ fontSize: '10px', color: T.textMuted, fontWeight: '700', letterSpacing: '0.8px', marginBottom: '3px' }}>
        ETAPA {stage.stage_number}
      </div>
      {!stage.virtual && (
        <div style={{ fontSize: '13px', color: T.textSub, maxWidth: '210px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stage.tournament_name || '—'}
        </div>
      )}
    </div>
  );

  if (stage.virtual) return (
    <div style={base}>
      {stageLabel}
      <span style={{ fontSize: '12px', color: T.textMuted }}>Não vinculada</span>
    </div>
  );

  if (!entry || entry.pending) return (
    <div style={base}>
      {stageLabel}
      <span style={{ fontSize: '12px', color: T.gold, fontWeight: '600' }}>Pendente</span>
    </div>
  );

  if (!entry.participated) return (
    <div style={base}>
      {stageLabel}
      <span style={{ fontSize: '12px', color: T.textMuted }}>Faltou</span>
    </div>
  );

  return (
    <div style={base}>
      {stageLabel}
      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '12px' }}>
        {entry.position && (
          <div style={{ fontSize: '11px', color: discarded ? T.textMuted : T.textSub, marginBottom: '3px', textDecoration: discarded ? 'line-through' : 'none' }}>
            {entry.position}º lugar
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
          <span style={{
            fontSize: '16px', fontWeight: '800',
            color:          discarded ? T.textMuted : T.accent,
            textDecoration: discarded ? 'line-through' : 'none',
          }}>
            {fmt(entry.points)} pts
          </span>
          {discarded && (
            <span style={{
              fontSize: '9px', fontWeight: '700', color: T.danger,
              border: `1px solid ${T.danger}60`, borderRadius: '4px',
              padding: '1px 5px', letterSpacing: '0.3px',
            }}>
              DESCARTADA
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StagePill ────────────────────────────────────────────────────────────────
function StagePill({ stage, onView }) {
  const fin = !stage.virtual && stage.finished;
  const pnd = !stage.virtual && !stage.finished;

  return (
    <div style={{
      backgroundColor: T.cardLight, borderRadius: '10px', padding: '10px 14px',
      borderLeft: `3px solid ${fin ? T.accent : pnd ? T.gold : T.border}`,
      minWidth: '130px', flexShrink: 0,
    }}>
      <div style={{ fontSize: '9px', color: T.textMuted, letterSpacing: '1.5px', marginBottom: '4px', fontWeight: '700' }}>
        ETAPA {stage.stage_number}
      </div>
      <div style={{ fontSize: '11px', fontWeight: '500', color: stage.virtual ? T.textMuted : T.textMain, marginBottom: '8px', lineHeight: 1.3, minHeight: '28px' }}>
        {stage.virtual ? 'Não vinculada' : stage.tournament_name}
      </div>
      {fin ? (
        <button onClick={onView} style={{
          width: '100%', padding: '5px 0', borderRadius: '6px',
          border: 'none', backgroundColor: T.accent,
          color: '#000', fontSize: '10px', fontWeight: '700',
          cursor: 'pointer', letterSpacing: '0.3px',
        }}>
          VER PLACAR
        </button>
      ) : (
        <span style={{ fontSize: '10px', color: pnd ? T.gold : T.textMuted }}>
          {stage.virtual ? '—' : 'Pendente'}
        </span>
      )}
    </div>
  );
}

// ─── TournamentLeaderboardModal ───────────────────────────────────────────────
function TournamentLeaderboardModal({ tournamentId, tournamentName, stageNumber, stageId, circuitId, isAdmin, onPositionsUpdated, onClose }) {
  const [players,          setPlayers]          = useState([]);
  const [showPodiumForm,   setShowPodiumForm]   = useState(false);
  const [podiumSelections, setPodiumSelections] = useState(
    { 1:'',2:'',3:'',4:'',5:'',6:'',7:'',8:'',9:'',10:'' }
  );
  const [savingPodium, setSavingPodium] = useState(false);

  useEffect(() => {
    if (!isAdmin || !tournamentId) return;
    api.get(`/leaderboard/${tournamentId}`)
      .then(res => setPlayers(res.data.map(p => ({
        ...p,
        handicap:     parseFloat(p.handicap || 0),
        holes_played: parseInt(p.holes_played  || 0),
        gross_to_par: parseInt(p.score_to_par  || 0),
      }))))
      .catch(console.error);
  }, [tournamentId, isAdmin]);

  const sortedGross = useMemo(() =>
    [...players].filter(p => p.holes_played > 0).sort((a, b) => a.gross_to_par - b.gross_to_par),
    [players]
  );

  const tiedGroups = useMemo(() => {
    const groups = [];
    let i = 0, cumPos = 1;
    while (i < sortedGross.length) {
      const score = sortedGross[i].gross_to_par;
      let j = i;
      while (j < sortedGross.length && sortedGross[j].gross_to_par === score) j++;
      groups.push({ score, players: sortedGross.slice(i, j), startPos: cumPos });
      cumPos += (j - i); i = j;
    }
    return groups;
  }, [sortedGross]);

  const hasTopTie = tiedGroups.some(g => g.players.length >= 2 && g.startPos <= 10);

  const positionGroupMap = useMemo(() => {
    const map = {};
    for (let g = 0; g < tiedGroups.length; g++) {
      const { players: gp, startPos } = tiedGroups[g];
      for (let k = 0; k < gp.length && startPos + k <= 10; k++) map[startPos + k] = g;
    }
    return map;
  }, [tiedGroups]);

  const selectedPlayerIds = useMemo(() =>
    new Set(Object.values(podiumSelections).filter(v => v !== '')),
    [podiumSelections]
  );

  const getPlayersForPosition = useCallback((pos) => {
    const gIdx = positionGroupMap[pos];
    if (gIdx === undefined) return [];
    const cur = podiumSelections[pos] || '';
    return tiedGroups[gIdx].players.filter(p =>
      !selectedPlayerIds.has(String(p.id)) || String(p.id) === cur
    );
  }, [positionGroupMap, tiedGroups, podiumSelections, selectedPlayerIds]);

  const handleSavePodium = async () => {
    const positions = [1,2,3,4,5,6,7,8,9,10]
      .filter(pos => podiumSelections[pos])
      .map(pos => ({ user_id: Number(podiumSelections[pos]), manual_position: pos }));
    if (!positions.length) { alert('Selecione ao menos uma posição antes de salvar.'); return; }
    const ids = positions.map(p => p.user_id);
    if (new Set(ids).size !== ids.length) { alert('O mesmo jogador não pode ter duas posições.'); return; }
    setSavingPodium(true);
    try {
      await api.post(`/circuits/${circuitId}/stages/${stageId}/manual-positions`, { positions });
      setShowPodiumForm(false);
      onPositionsUpdated?.();
    } catch { alert('Erro ao salvar posições.'); }
    finally { setSavingPodium(false); }
  };

  const handleClearPositions = async () => {
    if (!window.confirm('Remover todas as posições manuais?')) return;
    setSavingPodium(true);
    try {
      await api.delete(`/circuits/${circuitId}/stages/${stageId}/manual-positions`);
      setPodiumSelections({ 1:'',2:'',3:'',4:'',5:'',6:'',7:'',8:'',9:'',10:'' });
      setShowPodiumForm(false);
      onPositionsUpdated?.();
    } catch { alert('Erro ao limpar posições.'); }
    finally { setSavingPodium(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, animation: 'fadeBg 0.2s ease' }}>
      <div onClick={e => e.stopPropagation()} style={{ backgroundColor: T.card, borderRadius: '20px 20px 0 0', border: `1px solid ${T.border}`, width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', animation: 'slideUp 0.3s ease' }}>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
          <div style={{ width: '36px', height: '4px', borderRadius: '2px', backgroundColor: T.cardLight }} />
        </div>

        <div style={{ padding: '16px 20px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '9px', color: T.accent, fontWeight: '700', letterSpacing: '2px' }}>
                LEADERBOARD · ETAPA {stageNumber}
              </p>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: T.textMain }}>{tournamentName}</h2>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: '20px', cursor: 'pointer', minWidth: '40px', minHeight: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        </div>

        <div style={{ height: '1px', backgroundColor: T.border, flexShrink: 0 }} />

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <LeaderboardView tournamentId={tournamentId} embedded={true} />
        </div>

        <div style={{ padding: '12px 16px', flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
          {isAdmin && stageId && !showPodiumForm && (
            <button onClick={() => setShowPodiumForm(true)} style={{ width: '100%', padding: '10px', marginBottom: '8px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', border: `1px solid ${hasTopTie ? T.gold : T.border}`, backgroundColor: 'transparent', color: hasTopTie ? T.gold : T.textSub }}>
              <LuTrophy size={13} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              {hasTopTie ? 'Realizar Desempate de Pódio' : 'Definir Posições Manuais'}
            </button>
          )}

          {isAdmin && showPodiumForm && (
            <div style={{ marginBottom: '10px', padding: '12px', backgroundColor: `${T.gold}08`, border: `1px solid ${T.gold}30`, borderRadius: '12px' }}>
              <div style={{ fontSize: '10px', color: T.gold, fontWeight: '700', letterSpacing: '1.5px', marginBottom: '10px' }}>
                POSIÇÕES MANUAIS — deixe em branco para usar pro-rata
              </div>
              {tiedGroups.filter(g => g.players.length >= 2 && g.startPos <= 10).length === 0 ? (
                <div style={{ fontSize: '12px', color: T.textMuted, padding: '4px 0 10px' }}>Nenhum empate detectado.</div>
              ) : (
                tiedGroups.filter(g => g.players.length >= 2 && g.startPos <= 10).map(group => {
                  const positions = Array.from({ length: Math.min(group.players.length, 11 - group.startPos) }, (_, k) => group.startPos + k);
                  return (
                    <div key={group.startPos} style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '9px', color: T.textMuted, letterSpacing: '0.5px', marginBottom: '5px' }}>
                        Empate no {group.startPos}º · {group.players.length} jogadores ({group.score > 0 ? '+' : ''}{group.score})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                        {positions.map(pos => {
                          const available = getPlayersForPosition(pos);
                          return (
                            <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: pos <= 3 ? T.gold : T.textSub, minWidth: '20px', textAlign: 'right', flexShrink: 0 }}>{pos}º</span>
                              <select value={podiumSelections[pos] || ''} onChange={e => setPodiumSelections(prev => ({ ...prev, [pos]: e.target.value }))} style={{ flex: 1, padding: '5px 4px', borderRadius: '6px', fontSize: '11px', border: `1px solid ${podiumSelections[pos] ? T.gold + '70' : T.border}`, backgroundColor: T.card, color: podiumSelections[pos] ? T.textMain : T.textMuted, minWidth: 0 }}>
                                <option value="">—</option>
                                {available.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={handleSavePodium} disabled={savingPodium} style={{ flex: 1, padding: '9px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', border: 'none', cursor: 'pointer', backgroundColor: T.accent, color: '#000', opacity: savingPodium ? 0.6 : 1 }}>
                  {savingPodium ? 'Salvando...' : 'SALVAR'}
                </button>
                <button onClick={handleClearPositions} disabled={savingPodium} style={{ flex: 1, padding: '9px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer', border: `1px solid ${T.danger}50`, backgroundColor: 'transparent', color: T.danger, opacity: savingPodium ? 0.6 : 1 }}>
                  LIMPAR
                </button>
                <button onClick={() => setShowPodiumForm(false)} style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', border: `1px solid ${T.border}`, backgroundColor: 'transparent', color: T.textSub, flexShrink: 0 }}>×</button>
              </div>
            </div>
          )}

          <button onClick={onClose} style={{ width: '100%', padding: '13px', backgroundColor: 'transparent', border: `1px solid ${T.border}`, color: T.textSub, borderRadius: '12px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DiscardSwitch ────────────────────────────────────────────────────────────
function DiscardSwitch({ enabled, onChange }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onChange(!enabled)} role="switch" aria-checked={enabled}
      tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onChange(!enabled)}
    >
      <span style={{ fontSize: '11px', color: enabled ? T.textSub : T.textMuted, fontWeight: '600', transition: 'color 0.2s' }}>
        Descarte
      </span>
      <div style={{ width: '38px', height: '21px', borderRadius: '11px', backgroundColor: enabled ? T.accent : T.cardLight, border: `1px solid ${enabled ? T.accent : T.border}`, position: 'relative', transition: 'all 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: '3px', left: enabled ? '18px' : '3px', width: '13px', height: '13px', borderRadius: '50%', backgroundColor: enabled ? '#fff' : T.textMuted, transition: 'left 0.2s, background-color 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }} />
      </div>
    </div>
  );
}
