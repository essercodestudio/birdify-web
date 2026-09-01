// frontend/src/pages/Leaderboard.js
import React, { useState, useEffect, useCallback } from "react";
import api from "../services/api";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { LuArrowLeft, LuFlag } from "react-icons/lu";
import { applyCategoryFilter, isNetCategory } from "../utils/categories";
import { mediaUrl } from "../services/media";

const theme = {
  bg:        "#0f172a",
  card:      "#1e293b",
  cardLight: "#334155",
  accent:    "#22c55e",
  gold:      "#eab308",
  textMain:  "#f8fafc",
  textMuted: "#94a3b8",
  danger:    "#ef4444",
};

function getScoreStyle(strokes, par) {
  if (!strokes || !par) return { color: theme.textMain, bg: theme.bg, border: theme.cardLight };
  const d = strokes - par;
  if (d <= -2) return { color: theme.gold,   bg: "rgba(234,179,8,0.15)",  border: theme.gold   };
  if (d === -1) return { color: theme.accent, bg: "rgba(34,197,94,0.15)", border: theme.accent };
  if (d === 0)  return { color: theme.textMain, bg: theme.cardLight,      border: theme.cardLight };
  return         { color: theme.danger, bg: "rgba(239,68,68,0.15)",        border: theme.danger };
}

// Filtro e regra Net/Gross vêm da fonte única em utils/categories.js
const applyFilter = applyCategoryFilter;
const isNet = isNetCategory;

// ─── LeaderboardView ─────────────────────────────────────────────────────────
// Reusable: aceita tournamentId como prop. embedded=true oculta topBar e bg.
export function LeaderboardView({ tournamentId, isPublic = false, onBack, embedded = false, showSponsors = true }) {
  const [ranking,             setRanking]             = useState([]);
  const [tabs,                setTabs]                = useState([]);
  const [activeTab,           setActiveTab]           = useState("");
  const [selectedPlayer,      setSelectedPlayer]      = useState(null);
  const [playerScores,        setPlayerScores]        = useState([]);
  const [isScoreModalOpen,    setIsScoreModalOpen]    = useState(false);
  const [sponsors,            setSponsors]            = useState([]);
  const [currentSponsorIndex, setCurrentSponsorIndex] = useState(0);
  // Status do torneio: "LIVE" só aparece com torneio em andamento (não em histórico)
  const [tournamentStatus,    setTournamentStatus]    = useState(null);
  const [courseId,            setCourseId]            = useState(null);
  // Item 5 · commit 5 (2026-08-28): multi-rodada. activeRound === 'all' soma
  // todas as rodadas (comportamento antigo pra torneios single-round e default
  // pra multi). Números filtram a rodada específica. rounds[] vem do backend
  // via GET /tournaments/:id — segunda faixa de tabs só aparece se total_rounds>1.
  const [totalRounds,         setTotalRounds]         = useState(1);
  const [rounds,              setRounds]              = useState([]); // eslint-disable-line no-unused-vars
  const [activeRound,         setActiveRound]         = useState('all');
  // Onda A · commit 7 (2026-08-31): scoring_type do torneio.
  // 'strokes' (default) — ranking por menor tacadas + relPar (comportamento antigo).
  // 'result_points' — ranking por MAIOR total_points (ordenação inversa; sem NET).
  const [scoringType,         setScoringType]         = useState('strokes');

  const fetchInfo = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const res = await api.get(`/tournaments/${tournamentId}`);
      if (res.data.sponsors) setSponsors(res.data.sponsors);
      setTournamentStatus(res.data.status || null);
      setCourseId(res.data.course_id || null);
      // Item 5 · commit 5: metadados multi-rodada
      setTotalRounds(Number(res.data.total_rounds || 1));
      setRounds(Array.isArray(res.data.rounds) ? res.data.rounds : []);
      // Onda A · commit 7: scoring_type do torneio
      setScoringType(res.data.scoring_type === 'result_points' ? 'result_points' : 'strokes');
      let cats = res.data.categories;
      if (typeof cats === "string") { try { cats = JSON.parse(cats); } catch { cats = []; } }
      cats = Array.isArray(cats) ? cats : [];
      setTabs(cats);
      setActiveTab(prev => (!prev && cats.length > 0 ? cats[0] : prev));
    } catch (e) { console.error("Leaderboard fetchInfo:", e); }
  }, [tournamentId]);

  const fetchRanking = useCallback(async () => {
    if (!tournamentId) return;
    try {
      // ?round=all preserva o backend default (soma tudo). ?round=N filtra rodada.
      const path = activeRound === 'all'
        ? `/leaderboard/${tournamentId}`
        : `/leaderboard/${tournamentId}?round=${activeRound}`;
      const res = await api.get(path);
      setRanking(res.data.map(p => ({
        ...p,
        handicap:      parseFloat(p.handicap || 0),
        total_strokes: parseInt(p.total_strokes || 0),
        // Onda A · commit 7: total_points vem do backend (SUM via LEFT JOIN
        // em tournament_result_points). 0 em torneios strokes (JOIN vazio).
        total_points:  parseInt(p.total_points  || 0),
        holes_played:  parseInt(p.holes_played  || 0),
        gross_to_par:  parseInt(p.score_to_par  || 0),
        net_to_par:    parseInt(p.score_to_par  || 0) - parseFloat(p.handicap || 0),
      })));
    } catch (e) { console.error("Leaderboard fetchRanking:", e); }
  }, [tournamentId, activeRound]);

  useEffect(() => {
    fetchInfo();
    fetchRanking();
    const id = setInterval(fetchRanking, 10000);
    return () => clearInterval(id);
  }, [fetchInfo, fetchRanking]);

  useEffect(() => {
    if (!sponsors || sponsors.length <= 1) return;
    const id = setInterval(() =>
      setCurrentSponsorIndex(i => (i === sponsors.length - 1 ? 0 : i + 1)), 8000);
    return () => clearInterval(id);
  }, [sponsors]);

  const handlePlayerClick = async (player) => {
    setSelectedPlayer(player);
    setIsScoreModalOpen(true);
    // Cache-key inclui round pra evitar mostrar scores da round errada quando
    // o mesmo jogador é clicado depois de trocar de tab.
    const cacheKey = `${player.id}:${activeRound}`;
    if (!playerScores._loadedFor || playerScores._loadedFor !== cacheKey) {
      try {
        const path = activeRound === 'all'
          ? `/leaderboard/details/${tournamentId}/${player.id}`
          : `/leaderboard/details/${tournamentId}/${player.id}?round=${activeRound}`;
        const res = await api.get(path);
        const data = res.data;
        data._loadedFor = cacheKey;
        setPlayerScores(data);
      } catch { setPlayerScores([]); }
    }
  };

  // Onda A · commit 7: em result_points a decisão de produto é gross puro sem
  // handicap — ignora o filtro Net do nome da categoria (não existe "net por
  // pontos" nesta versão). Em strokes, comportamento antigo preservado.
  const isResultPoints = scoringType === 'result_points';
  const net = !isResultPoints && isNet(activeTab);
  const filtered = applyFilter(ranking, activeTab).sort((a, b) => {
    const ha = a.holes_played, hb = b.holes_played;
    if (!ha && !hb) return a.name.localeCompare(b.name);
    if (ha && !hb) return -1;
    if (!ha && hb) return 1;
    if (isResultPoints) {
      // Ranking inverso — MAIOR pontuação vence. Desempate: mais buracos jogados.
      const pa = a.total_points, pb = b.total_points;
      return pa !== pb ? pb - pa : hb - ha;
    }
    const sa = net ? a.net_to_par : a.gross_to_par;
    const sb = net ? b.net_to_par : b.gross_to_par;
    return sa !== sb ? sa - sb : ha - hb;
  });

  // Item 5 · commit 5: renderNine filtra por round quando fornecido.
  // Se roundFilter=null (single ou activeRound sem round), pega qualquer linha
  // com aquele hole_number (comportamento antigo). Se roundFilter=N, só linhas
  // daquela rodada — evita mostrar score de R1 na visão de R2 quando os dados
  // vêm agregados via activeRound='all'.
  const renderNine = (start, roundFilter = null) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: "5px", marginBottom: "14px" }}>
      {Array.from({ length: 9 }, (_, i) => start + i).map(num => {
        const rows = (playerScores || []).filter(h => h.hole_number === num);
        const hole = roundFilter != null
          ? rows.find(h => Number(h.round_number) === Number(roundFilter))
          : rows[0];
        const st  = hole ? hole.strokes : null;
        const par = hole ? hole.par     : null;
        const { color, bg, border } = getScoreStyle(st, par);
        return (
          <div key={num} style={{ padding: "6px 2px", textAlign: "center", borderRadius: "6px", display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: bg, border: `1px solid ${border}` }}>
            <div style={{ fontSize: "9px",  color: theme.textMuted, fontWeight: "bold" }}>B{num}</div>
            <div style={{ fontSize: "8px",  color: theme.textMuted, marginBottom: "1px" }}>{par ? `Par ${par}` : "—"}</div>
            <div style={{ fontSize: "16px", fontWeight: "900", color, marginTop: "2px" }}>{st ?? "—"}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={embedded ? { color: theme.textMain } : {
      padding: "20px", backgroundColor: theme.bg, minHeight: "100vh",
      color: theme.textMain,
      display: "flex", flexDirection: "column",
    }}>

      {/* Top bar — apenas na página standalone */}
      {!embedded && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          {!isPublic && onBack && (
            <button onClick={onBack} style={{ backgroundColor: "transparent", color: theme.textMuted, border: "none", padding: "8px 12px", borderRadius: "8px", fontWeight: "bold", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <LuArrowLeft size={15} />
              VOLTAR AO JOGO
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: (isPublic || !onBack) ? "0" : "auto" }}>
            {courseId && (
              <a
                href={`/campo/${courseId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: theme.textMuted, fontSize: "12px", fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <LuFlag size={13} /> VER CAMPO
              </a>
            )}
            {/* LIVE só com torneio em andamento — histórico/concluído não é "ao vivo" */}
            {tournamentStatus === "OPEN" && (
              <div style={{ color: theme.danger, fontWeight: "bold", fontSize: "12px", display: "flex", alignItems: "center", gap: "5px" }}>
                <span className="lb-dot" /> LIVE
              </div>
            )}
          </div>
        </div>
      )}

      {/* Abas de categoria */}
      {tabs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px", marginBottom: "16px", padding: embedded ? "12px 16px 0" : "0" }}>
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "10px 8px", borderRadius: "8px", border: "none",
              fontSize: "12px", fontWeight: "bold", cursor: "pointer",
              backgroundColor: activeTab === tab ? theme.accent : theme.cardLight,
              color: activeTab === tab ? "#000" : theme.textMuted,
              transition: "background-color 0.15s, color 0.15s",
            }}>
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Item 5 · commit 5: filtro TOTAL/R1/R2/R3 — só multi-rodada.
          Fica DENTRO de cada categoria (não substitui as tabs acima).
          TOTAL soma; R{n} filtra aquela rodada. */}
      {totalRounds > 1 && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap", padding: embedded ? "0 16px" : "0" }}>
          {['all', ...Array.from({ length: totalRounds }, (_, i) => i + 1)].map(r => {
            const label = r === 'all' ? 'TOTAL' : `R${r}`;
            const active = activeRound === r;
            return (
              <button
                key={String(r)}
                onClick={() => setActiveRound(r)}
                aria-label={`Filtrar por ${label}`}
                style={{
                  padding: "7px 14px", borderRadius: "999px", border: "none",
                  fontSize: "11px", fontWeight: "bold", cursor: "pointer",
                  backgroundColor: active ? theme.gold : "transparent",
                  color: active ? "#000" : theme.textMuted,
                  border: `1px solid ${active ? theme.gold : theme.cardLight}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Tabela */}
      <div style={{ backgroundColor: theme.card, borderRadius: embedded ? "0" : "12px", overflow: "hidden", flex: 1, marginBottom: embedded ? "0" : "30px" }}>
        {/* Header — em result_points, a coluna final vira PONTOS (ordenação
            inversa) e substitui "PAR". Tacadas continuam visíveis na coluna
            TOTAL pra referência (são derivadas do resultado escolhido). */}
        <div style={{ display: "grid", gridTemplateColumns: "35px 1fr 50px 50px 60px", padding: "10px 16px", backgroundColor: theme.cardLight, color: theme.textMuted, fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", alignItems: "center", gap: "5px" }}>
          <div>POS</div><div>JOGADOR</div>
          <div style={{ textAlign: "center" }}>HLS</div>
          <div style={{ textAlign: "center" }}>{isResultPoints ? 'TAC.' : 'TOTAL'}</div>
          <div style={{ textAlign: "center" }}>{isResultPoints ? 'PTS' : 'PAR'}</div>
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px", color: theme.textMuted, fontSize: "13px" }}>Nenhum jogador nesta categoria.</div>
        )}

        {filtered.map((row, idx) => {
          const relPar = net ? row.net_to_par : row.gross_to_par;
          const parLabel = !row.holes_played ? "--"
            : relPar === 0 ? "E"
            : relPar > 0 ? `+${relPar.toFixed(1).replace(".0", "")}`
            : relPar.toFixed(1).replace(".0", "");

          return (
            <div key={row.id || idx} style={{ display: "grid", gridTemplateColumns: "35px 1fr 50px 50px 60px", padding: "14px 16px", borderBottom: `1px solid ${theme.cardLight}`, alignItems: "center", gap: "5px" }}>
              <div style={{ fontWeight: "800", fontSize: "13px", color: row.holes_played > 0 && idx === 0 ? theme.gold : theme.textMuted }}>
                {row.holes_played > 0 ? idx + 1 : "—"}
              </div>
              <div
                style={{ fontSize: "14px", fontWeight: "600", color: theme.accent, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                onClick={() => handlePlayerClick(row)}
              >
                {row.name}
                {net && <span style={{ fontSize: "10px", color: theme.textMuted, marginLeft: "5px" }}>(HC {row.handicap})</span>}
              </div>
              <div style={{ textAlign: "center", fontSize: "13px", color: theme.textMuted }}>{row.holes_played || 0}</div>
              <div style={{ textAlign: "center", fontSize: "14px", fontWeight: "bold", color: theme.textMain }}>{row.holes_played ? row.total_strokes : "--"}</div>
              {isResultPoints ? (
                // Coluna PONTOS — ordenação por MAIOR. Cor gold pra destacar
                // que é o critério de classificação neste modo.
                <div style={{
                  textAlign: "center", padding: "4px 0", borderRadius: "6px",
                  fontSize: "13px", fontWeight: "800",
                  backgroundColor: row.holes_played ? "rgba(234,179,8,0.15)" : "transparent",
                  color: row.holes_played ? theme.gold : theme.textMuted,
                }}>
                  {row.holes_played ? row.total_points : '--'}
                </div>
              ) : (
                <div style={{
                  textAlign: "center", padding: "4px 0", borderRadius: "6px",
                  fontSize: "13px", fontWeight: "800",
                  backgroundColor: !row.holes_played ? "transparent" : relPar < 0 ? "rgba(34,197,94,0.15)" : relPar > 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                  color: !row.holes_played ? theme.textMuted : relPar < 0 ? theme.accent : relPar > 0 ? theme.danger : theme.textMuted,
                }}>
                  {parLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sponsors — apenas na página standalone */}
      {!embedded && showSponsors && sponsors.length > 0 && (
        <div style={{ textAlign: "center", paddingBottom: "20px" }}>
          <p style={{ fontSize: "11px", color: theme.textMuted, marginBottom: "15px", letterSpacing: "2px", fontWeight: "bold" }}>PATROCÍNIO OFICIAL</p>
          <div style={{ height: "90px", display: "flex", justifyContent: "center", alignItems: "center" }}>
            <img key={currentSponsorIndex} src={mediaUrl(sponsors[currentSponsorIndex].image_url)} alt="Patrocinador" style={{ maxHeight: "100%", maxWidth: "250px", objectFit: "contain", animation: "fadeIn 0.5s ease-in" }} />
          </div>
          {sponsors.length > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "15px" }}>
              {sponsors.map((_, i) => (
                <div key={i} onClick={() => setCurrentSponsorIndex(i)} style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: currentSponsorIndex === i ? theme.gold : theme.cardLight, cursor: "pointer", transition: "all 0.3s" }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de scorecard — position:fixed zIndex:2000 flutua acima de qualquer modal pai */}
      {isScoreModalOpen && selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.92)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 2000 }} onClick={() => setIsScoreModalOpen(false)}>
          <div style={{ backgroundColor: theme.card, padding: "24px", borderRadius: "16px", width: "92%", maxWidth: "480px", border: `1px solid ${theme.cardLight}`, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, color: theme.accent, fontSize: "16px" }}>{selectedPlayer.name}</h3>
              <button onClick={() => setIsScoreModalOpen(false)} style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer", fontSize: "22px", lineHeight: 1 }}>×</button>
            </div>
            {(() => {
              // Se torneio multi + activeRound='all', separa por rodada (evita
              // mostrar apenas o primeiro score por hole quando há dois rounds).
              // Nas demais combinações (single OU activeRound=N), renderiza uma
              // seção Frente/Volta como sempre.
              if (totalRounds > 1 && activeRound === 'all') {
                const roundsInScorecard = Array.from(
                  new Set((playerScores || []).map(s => Number(s.round_number)))
                ).sort((a, b) => a - b);
                if (roundsInScorecard.length === 0) {
                  return <p style={{ color: theme.textMuted, textAlign: "center" }}>Sem tacadas registradas.</p>;
                }
                return roundsInScorecard.map(rn => (
                  <div key={rn} style={{ marginBottom: 20 }}>
                    <p style={{ color: theme.gold, fontSize: "12px", fontWeight: "700", letterSpacing: "1.5px", marginBottom: "8px" }}>
                      RODADA {rn}
                    </p>
                    <p style={{ color: theme.textMuted, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", marginBottom: "8px" }}>FRENTE (1–9)</p>
                    {renderNine(1, rn)}
                    <p style={{ color: theme.textMuted, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", marginBottom: "8px", marginTop: "10px" }}>VOLTA (10–18)</p>
                    {renderNine(10, rn)}
                  </div>
                ));
              }
              return (
                <>
                  <p style={{ color: theme.textMuted, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", marginBottom: "8px" }}>FRENTE (1–9)</p>
                  {renderNine(1)}
                  <p style={{ color: theme.textMuted, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", marginBottom: "8px", marginTop: "16px" }}>VOLTA (10–18)</p>
                  {renderNine(10)}
                </>
              );
            })()}
            <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: `1px solid ${theme.cardLight}`, textAlign: "center" }}>
              <span style={{ fontSize: "17px", color: theme.textMain }}>
                {activeRound === 'all' && totalRounds > 1 ? 'Total Gross (todas): ' : 'Total Gross: '}
                <strong>{selectedPlayer.total_strokes}</strong>
              </span>
              {isResultPoints && (
                <div style={{ marginTop: 8, fontSize: "17px", color: theme.gold }}>
                  Total de Pontos: <strong>{selectedPlayer.total_points}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!embedded && (
        <style>{`
          .lb-dot { height:8px; width:8px; background-color:#ef4444; border-radius:50%; display:inline-block; animation:lbBlink 1s infinite; }
          @keyframes lbBlink { 0%{opacity:1} 50%{opacity:0.3} 100%{opacity:1} }
          @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        `}</style>
      )}
    </div>
  );
}

// ─── Leaderboard (página) ─────────────────────────────────────────────────────
function Leaderboard() {
  const { tournamentId: rawId } = useParams();
  const navigate  = useNavigate();
  const location  = useLocation();
  const actualId  = rawId ? rawId.split("-")[0] : "";
  const isPublic  = new URLSearchParams(location.search).get("public") === "true";

  return <LeaderboardView tournamentId={actualId} isPublic={isPublic} onBack={() => navigate(-1)} />;
}

export default Leaderboard;
