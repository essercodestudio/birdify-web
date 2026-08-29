// frontend/src/pages/AdminScoreEditor.js
// Painel admin para corrigir tacadas de torneios e treinos.
// Fluxo: escolhe aba → escolhe evento → renderiza matriz (jogador × buraco) editável.
// Cada célula edita on-blur — vazio deleta o score, número entre 1 e 20 UPSERT.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { LuPencilLine, LuTrophy, LuFlag, LuSave, LuCheck, LuTriangleAlert, LuHistory, LuCalendar, LuX } from "react-icons/lu";

const TABS = [
  { id: "tournament", label: "Torneios",       icon: LuTrophy },
  { id: "training",   label: "Treinos do Dia", icon: LuFlag },
];

const fmtDate = (d) => {
  if (!d) return "";
  const raw = typeof d === "string" ? d : new Date(d).toISOString();
  const [y, m, day] = raw.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

// Cor por diferença de par (mesma paleta do scorecard oficial)
function scoreColor(theme, strokes, par) {
  if (strokes == null || strokes === "") return theme.textMuted;
  const diff = Number(strokes) - Number(par);
  if (diff <= -2) return theme.gold;      // Eagle/HiO
  if (diff === -1) return theme.accent;   // Birdie
  if (diff === 0) return theme.textMuted; // Par NEUTRO
  return theme.danger;                    // Bogey+
}

export default function AdminScoreEditor() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  // Query params opcionais — quando presente, forca tab=training e filtra a
  // lista de treinos por essa data exata. Usado pelo card "Treino DD/MM/YYYY"
  // do AdminTrainings, que abre o editor ja pre-focado no dia.
  const dateParam = searchParams.get("date");
  const dateFilter = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const tabParam = searchParams.get("tab") === "training" ? "training" : null;

  const [tab, setTab] = useState(tabParam || (dateFilter ? "training" : "tournament"));
  const [events, setEvents] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [matrix, setMatrix] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [flashKey, setFlashKey] = useState("");
  // Modal de motivo: guarda a mudança pendente até o admin justificar.
  // Sem isso, o PUT no backend rejeita (reason obrigatório, min 5 chars).
  const [pendingChange, setPendingChange] = useState(null); // { userId, holeNumber, currentValue, newValue, playerName, par }
  const [reasonText, setReasonText] = useState("");

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    if (u.role !== "ADMIN") { navigate("/"); return; }
  }, [navigate]);

  const loadEvents = useCallback(async (which) => {
    setLoadingList(true);
    setSelectedId("");
    setMatrix(null);
    try {
      let path = which === "tournament"
        ? "/admin/scores/tournaments"
        : "/admin/scores/trainings";
      // Filtro por data so vale pra treinos (torneios sao por evento nomeado, nao por dia)
      if (which === "training" && dateFilter) {
        path += `?date=${encodeURIComponent(dateFilter)}`;
      }
      const res = await api.get(path);
      setEvents(res.data || []);
      // Auto-seleciona quando ha apenas 1 treino no dia — economiza 1 clique
      if (which === "training" && dateFilter && Array.isArray(res.data) && res.data.length === 1) {
        setSelectedId(String(res.data[0].id));
      }
    } catch (e) {
      console.error(e);
      setEvents([]);
    } finally {
      setLoadingList(false);
    }
  }, [dateFilter]);

  useEffect(() => { loadEvents(tab); }, [tab, loadEvents]);

  // Se admin trocar de aba pra tournament, limpa o filtro de data da URL
  // (nao faz sentido manter ?date= com tab=tournament).
  const handleTabChange = (nextTab) => {
    setTab(nextTab);
    if (nextTab === "tournament" && dateFilter) {
      const next = new URLSearchParams(searchParams);
      next.delete("date");
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
  };

  const clearDateFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("date");
    setSearchParams(next, { replace: true });
  };

  const loadMatrix = useCallback(async (which, id) => {
    if (!id) { setMatrix(null); return; }
    setLoadingMatrix(true);
    try {
      const path = which === "tournament"
        ? `/admin/scores/tournament/${id}`
        : `/admin/scores/training/${id}`;
      const res = await api.get(path);
      setMatrix(res.data);
    } catch (e) {
      console.error(e);
      alert(e.response?.data?.error || "Erro ao carregar matriz.");
      setMatrix(null);
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadMatrix(tab, selectedId);
  }, [tab, selectedId, loadMatrix]);

  // Indexa scores {user_id: {hole_number: strokes}} pra render rápido.
  const scoreIndex = useMemo(() => {
    const idx = {};
    if (!matrix) return idx;
    for (const s of matrix.scores || []) {
      if (!idx[s.user_id]) idx[s.user_id] = {};
      idx[s.user_id][s.hole_number] = s.strokes;
    }
    return idx;
  }, [matrix]);

  const flatPlayers = useMemo(() => {
    if (!matrix) return [];
    if (tab === "training") {
      return (matrix.players || []).map(p => ({ ...p, group_id: matrix.group.id, group_name: matrix.group.group_name }));
    }
    const out = [];
    for (const g of matrix.groups || []) {
      for (const p of g.players || []) {
        out.push({ ...p, group_id: g.id, group_name: g.name });
      }
    }
    return out;
  }, [matrix, tab]);

  // Etapa 1: usuário edita a célula e sai (blur/enter). Se mudou, abre modal.
  const requestChange = (player, hole, rawValue) => {
    if (!matrix) return;
    const trimmed = String(rawValue || "").trim();
    const strokes = trimmed === "" ? null : Number(trimmed);
    const current = scoreIndex[player.id]?.[hole.hole_number];
    const currentNorm = current == null ? null : Number(current);
    if (strokes === currentNorm) return;

    if (strokes !== null && (!Number.isInteger(strokes) || strokes < 1 || strokes > 20)) {
      alert("Tacadas devem ser inteiro entre 1 e 20.");
      return;
    }

    setReasonText("");
    setPendingChange({
      userId: player.id,
      playerName: player.name,
      holeNumber: hole.hole_number,
      par: hole.par,
      currentValue: currentNorm,
      newValue: strokes,
    });
  };

  const cancelPending = () => {
    setPendingChange(null);
    setReasonText("");
  };

  // Etapa 2: motivo confirmado → PUT no backend com reason.
  const confirmPending = async () => {
    if (!pendingChange) return;
    const reason = reasonText.trim();
    if (reason.length < 5) {
      alert("Motivo deve ter pelo menos 5 caracteres.");
      return;
    }
    const { userId, holeNumber, newValue } = pendingChange;
    const key = `${userId}:${holeNumber}`;
    setSavingKey(key);
    try {
      if (tab === "tournament") {
        await api.put("/admin/scores/tournament", {
          tournament_id: matrix.tournament.id,
          user_id: userId,
          hole_number: holeNumber,
          strokes: newValue,
          reason,
        });
      } else {
        await api.put("/admin/scores/training", {
          group_id: matrix.group.id,
          user_id: userId,
          hole_number: holeNumber,
          strokes: newValue,
          reason,
        });
      }
      setMatrix(prev => {
        if (!prev) return prev;
        const filtered = (prev.scores || []).filter(
          s => !(Number(s.user_id) === Number(userId) && Number(s.hole_number) === Number(holeNumber))
        );
        if (newValue !== null) {
          filtered.push({ user_id: userId, hole_number: holeNumber, strokes: newValue });
        }
        return { ...prev, scores: filtered };
      });
      setFlashKey(key);
      setTimeout(() => setFlashKey(k => (k === key ? "" : k)), 900);
      setPendingChange(null);
      setReasonText("");
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao salvar tacada.");
    } finally {
      setSavingKey(k => (k === key ? "" : k));
    }
  };

  const totalFor = (userId) => {
    const row = scoreIndex[userId] || {};
    return Object.values(row).reduce((acc, s) => acc + Number(s || 0), 0);
  };

  const holesPlayedFor = (userId) => {
    const row = scoreIndex[userId] || {};
    return Object.values(row).filter(s => s != null && s !== "").length;
  };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <AdminNavMenu />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <LuPencilLine size={24} color={theme.accent} />
              Ajustar Tacadas
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              Corrija scores errados de torneios e treinos. Cada alteração exige motivo e fica registrada.
            </p>
          </div>
          <button
            onClick={() => navigate("/admin/scores-auditoria")}
            style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <LuHistory size={16} />
            Histórico de edições
          </button>
        </div>

        {/* Abas */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: `1px solid ${theme.border}` }}>
          {TABS.map(t => {
            const Icon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => handleTabChange(t.id)}
                style={{
                  padding: "10px 16px",
                  backgroundColor: "transparent",
                  color: active ? theme.accent : theme.textMuted,
                  border: "none",
                  borderBottom: `2px solid ${active ? theme.accent : "transparent"}`,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Chip do filtro por data (só quando ativo) */}
        {tab === "training" && dateFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", backgroundColor: theme.accentSoft, border: `1px solid ${theme.accent}`, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            <LuCalendar size={14} color={theme.accent} />
            <span style={{ color: theme.textMain }}>
              Filtrando treinos do dia <strong>{fmtDate(dateFilter)}</strong>
            </span>
            <button
              onClick={clearDateFilter}
              title="Remover filtro de data"
              style={{ marginLeft: "auto", background: "transparent", border: "none", color: theme.textMuted, cursor: "pointer", display: "inline-flex", alignItems: "center", padding: 4 }}
            >
              <LuX size={14} />
            </button>
          </div>
        )}

        {/* Seletor de evento */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16 }}>
          <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
            {tab === "tournament"
              ? "Torneio"
              : dateFilter
                ? `Treino do dia ${fmtDate(dateFilter)}`
                : "Treino (últimos 30 dias)"}
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loadingList}
            style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, width: "100%", boxSizing: "border-box" }}
          >
            <option value="">
              {loadingList ? "Carregando..." : `— selecione um ${tab === "tournament" ? "torneio" : "treino"} —`}
            </option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {tab === "tournament"
                  ? `${ev.name} — ${fmtDate(ev.start_date)}${ev.course_name ? ` · ${ev.course_name}` : ""}`
                  : `${ev.group_name} — ${fmtDate(ev.created_at)} · ${ev.status}`}
              </option>
            ))}
          </select>
        </div>

        {loadingMatrix && (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 30 }}>Carregando matriz...</p>
        )}

        {!loadingMatrix && matrix && flatPlayers.length === 0 && (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 30, backgroundColor: theme.card, borderRadius: 12 }}>
            Nenhum jogador escalado neste evento.
          </p>
        )}

        {!loadingMatrix && matrix && flatPlayers.length > 0 && (
          <div style={{ backgroundColor: theme.card, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: theme.cardLight, color: theme.textMuted, textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", position: "sticky", left: 0, backgroundColor: theme.cardLight, zIndex: 2, minWidth: 200 }}>
                      Jogador
                    </th>
                    {matrix.holes.map(h => (
                      <th key={h.hole_number} style={{ padding: "6px 4px", textAlign: "center", minWidth: 46 }}>
                        <div>{h.hole_number}</div>
                        <div style={{ fontSize: 10, color: theme.textMuted, fontWeight: 500 }}>par {h.par}</div>
                      </th>
                    ))}
                    <th style={{ padding: "10px 12px", textAlign: "center", minWidth: 70 }}>Total</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", minWidth: 70 }}>Jogados</th>
                  </tr>
                </thead>
                <tbody>
                  {flatPlayers.map((p, idx) => {
                    const prev = idx > 0 ? flatPlayers[idx - 1] : null;
                    const isNewGroup = !prev || prev.group_id !== p.group_id;
                    return (
                      <React.Fragment key={`${p.group_id}-${p.id}`}>
                        {tab === "tournament" && isNewGroup && (
                          <tr>
                            <td colSpan={matrix.holes.length + 3} style={{ padding: "10px 12px", backgroundColor: theme.bg, color: theme.textMuted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                              {p.group_name}
                            </td>
                          </tr>
                        )}
                        <tr style={{ borderTop: `1px solid ${theme.cardLight}` }}>
                          <td style={{ padding: "10px 12px", position: "sticky", left: 0, backgroundColor: theme.card, zIndex: 1, fontWeight: 600 }}>
                            {p.name}
                          </td>
                          {matrix.holes.map(h => {
                            const key = `${p.id}:${h.hole_number}`;
                            const val = scoreIndex[p.id]?.[h.hole_number];
                            const color = scoreColor(theme, val, h.par);
                            const saving = savingKey === key;
                            const flashed = flashKey === key;
                            return (
                              <td key={h.hole_number} style={{ padding: 2, textAlign: "center" }}>
                                <div style={{ position: "relative" }}>
                                  <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    inputMode="numeric"
                                    defaultValue={val ?? ""}
                                    key={`${key}-${val ?? "x"}`}
                                    onBlur={(e) => requestChange(p, h, e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                    disabled={saving}
                                    style={{
                                      width: 42, height: 34, textAlign: "center",
                                      backgroundColor: flashed ? theme.accentSoft : theme.bg,
                                      color, fontWeight: 700, fontSize: 14,
                                      border: `1px solid ${flashed ? theme.accent : theme.cardLight}`,
                                      borderRadius: 6, outline: "none",
                                      transition: "background-color 0.2s, border-color 0.2s",
                                    }}
                                  />
                                  {saving && (
                                    <LuSave size={10} style={{ position: "absolute", top: -2, right: -2, color: theme.info }} />
                                  )}
                                  {flashed && !saving && (
                                    <LuCheck size={10} style={{ position: "absolute", top: -2, right: -2, color: theme.accent }} />
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>
                            {totalFor(p.id) || "—"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: theme.textMuted }}>
                            {holesPlayedFor(p.id)}/{matrix.holes.length}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: 12, borderTop: `1px solid ${theme.cardLight}`, fontSize: 12, color: theme.textMuted, display: "flex", flexWrap: "wrap", gap: 16 }}>
              <span>Ao sair da célula (Tab / Enter / clique fora) você confirma a mudança com um motivo.</span>
              <span>Deixar em branco apaga o score.</span>
              {tab === "tournament" && <span style={{ color: theme.gold }}>⚠ editar torneio invalida a assinatura do grupo.</span>}
            </div>
          </div>
        )}

        {/* Modal de motivo — obrigatório antes do PUT */}
        {pendingChange && (
          <div
            onClick={cancelPending}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: theme.card, padding: 24, borderRadius: 12, maxWidth: 480, width: "100%", boxShadow: theme.shadow.lg }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <LuTriangleAlert size={20} color={theme.gold} />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Confirmar alteração</h3>
              </div>
              <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                Alteração para <strong style={{ color: theme.textMain }}>{pendingChange.playerName}</strong>, buraco{" "}
                <strong style={{ color: theme.textMain }}>{pendingChange.holeNumber}</strong> (par {pendingChange.par}):
              </p>
              <div style={{ backgroundColor: theme.bg, padding: 12, borderRadius: 8, marginBottom: 16, display: "flex", justifyContent: "space-around", alignItems: "center", gap: 12 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Antes</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: theme.textMain }}>
                    {pendingChange.currentValue ?? "—"}
                  </div>
                </div>
                <div style={{ color: theme.textMuted, fontSize: 20 }}>→</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Depois</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: pendingChange.newValue == null ? theme.danger : theme.accent }}>
                    {pendingChange.newValue == null ? "apagar" : pendingChange.newValue}
                  </div>
                </div>
              </div>
              <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                Motivo (mínimo 5 caracteres) *
              </label>
              <textarea
                autoFocus
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Ex: jogador contestou score do buraco após conferência final"
                maxLength={255}
                rows={3}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, fontFamily: theme.font, fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: theme.textMuted, marginTop: 4, marginBottom: 16 }}>
                <span>{reasonText.trim().length}/255</span>
                {tab === "tournament" && (
                  <span style={{ color: theme.gold }}>Vai invalidar a assinatura do grupo, se houver.</span>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={cancelPending}
                  style={{ padding: "10px 16px", backgroundColor: theme.cardLight, color: theme.textMain, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmPending}
                  disabled={reasonText.trim().length < 5 || savingKey}
                  style={{
                    padding: "10px 16px",
                    backgroundColor: reasonText.trim().length < 5 || savingKey ? theme.cardLight : theme.accent,
                    color: reasonText.trim().length < 5 || savingKey ? theme.textMuted : theme.accentContrast,
                    border: "none", borderRadius: 8, fontWeight: 700,
                    cursor: reasonText.trim().length < 5 || savingKey ? "not-allowed" : "pointer",
                  }}
                >
                  {savingKey ? "Salvando..." : "Confirmar alteração"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
