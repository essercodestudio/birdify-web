// frontend/src/pages/AdminScoreAuditLog.js
// Histórico de todas as edições feitas via /admin/ajustar-scores.
// Filtro por contexto (torneio/treino) e opcionalmente por evento específico.
// Objetivo: transparência — sem tela de histórico o audit fica invisível ao
// gestor, o que anula parte do propósito de ter auditado.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { LuHistory, LuPencilLine, LuTrophy, LuFlag } from "react-icons/lu";

const CONTEXT_OPTS = [
  { id: "",           label: "Todos" },
  { id: "tournament", label: "Torneios" },
  { id: "training",   label: "Treinos" },
];

const ACTION_LABEL = {
  insert: { text: "Inseriu",  color: "#22c55e" },
  update: { text: "Alterou",  color: "#eab308" },
  delete: { text: "Apagou",   color: "#ef4444" },
};

const fmtDateTime = (raw) => {
  if (!raw) return "";
  try { return new Date(raw).toLocaleString("pt-BR"); }
  catch { return String(raw); }
};

const fmtScore = (v) => (v === null || v === undefined ? "—" : v);

export default function AdminScoreAuditLog() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();

  const [context, setContext] = useState("");
  const [eventId, setEventId] = useState("");
  const [tournaments, setTournaments] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    if (u.role !== "ADMIN") { navigate("/"); return; }
  }, [navigate]);

  // Popula seletores auxiliares uma vez
  useEffect(() => {
    api.get("/admin/scores/tournaments").then(r => setTournaments(r.data || [])).catch(() => {});
    api.get("/admin/scores/trainings").then(r => setTrainings(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (context)  params.context  = context;
      if (eventId)  params.event_id = eventId;
      const r = await api.get("/admin/scores/audit", { params });
      setAudits(r.data || []);
    } catch (e) {
      console.error(e);
      setAudits([]);
    } finally {
      setLoading(false);
    }
  }, [context, eventId]);

  useEffect(() => { load(); }, [load]);

  const eventOptions = useMemo(() => {
    if (context === "tournament") return tournaments;
    if (context === "training")   return trainings;
    return [];
  }, [context, tournaments, trainings]);

  const clearFilters = () => { setContext(""); setEventId(""); };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <AdminNavMenu />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <LuHistory size={24} color={theme.accent} />
              Histórico de Ajustes de Score
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              Todas as alterações manuais feitas pelo painel admin — quem, quando, o que mudou e por quê.
            </p>
          </div>
          <button
            onClick={() => navigate("/admin/ajustar-scores")}
            style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <LuPencilLine size={16} />
            Voltar ao editor
          </button>
        </div>

        {/* Filtros */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16, display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Contexto</label>
            <select
              value={context}
              onChange={(e) => { setContext(e.target.value); setEventId(""); }}
              style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, width: "100%", boxSizing: "border-box" }}
            >
              {CONTEXT_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
              {context === "tournament" ? "Torneio" : context === "training" ? "Treino" : "Evento"}
            </label>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              disabled={!context}
              style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, width: "100%", boxSizing: "border-box", opacity: context ? 1 : 0.5 }}
            >
              <option value="">{context ? "Todos" : "Selecione um contexto primeiro"}</option>
              {eventOptions.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {context === "tournament"
                    ? `${ev.name} — ${(ev.start_date || "").slice(0, 10)}`
                    : `${ev.group_name} — ${(ev.created_at || "").slice(0, 10)} · ${ev.status}`}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={clearFilters}
            style={{ padding: "10px 16px", backgroundColor: theme.cardLight, color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
          >
            Limpar
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 30 }}>Carregando...</p>
        ) : audits.length === 0 ? (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 30, backgroundColor: theme.card, borderRadius: 12 }}>
            Nenhuma edição registrada com esses filtros.
          </p>
        ) : (
          <div style={{ backgroundColor: theme.card, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: theme.cardLight, color: theme.textMuted, textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 }}>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Quando</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Contexto</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Evento</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Admin</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Jogador</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Buraco</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Ação</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Anterior → Novo</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((a) => {
                    const act = ACTION_LABEL[a.action] || { text: a.action, color: theme.textMuted };
                    const Icon = a.context === "tournament" ? LuTrophy : LuFlag;
                    const eventName = a.context === "tournament" ? a.tournament_name : a.training_group_name;
                    return (
                      <tr key={a.id} style={{ borderTop: `1px solid ${theme.cardLight}` }}>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: theme.textMuted, fontSize: 12 }}>
                          {fmtDateTime(a.created_at)}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: theme.textMuted }}>
                            <Icon size={14} />
                            {a.context === "tournament" ? "Torneio" : "Treino"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px" }}>{eventName || `#${a.tournament_id || a.training_group_id}`}</td>
                        <td style={{ padding: "10px 12px" }}>{a.admin_name}</td>
                        <td style={{ padding: "10px 12px" }}>{a.target_name}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{a.hole_number}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 20, backgroundColor: `${act.color}22`, color: act.color, fontWeight: 700, fontSize: 11 }}>
                            {act.text}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, fontFamily: "monospace" }}>
                          <span style={{ color: theme.textMuted }}>{fmtScore(a.previous_strokes)}</span>
                          <span style={{ margin: "0 8px", color: theme.textMuted }}>→</span>
                          <span style={{ color: a.new_strokes === null ? theme.danger : theme.textMain }}>
                            {fmtScore(a.new_strokes)}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", maxWidth: 360, color: theme.textMain, fontSize: 12 }}>
                          {a.reason}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${theme.cardLight}`, fontSize: 11, color: theme.textMuted, textAlign: "center" }}>
              {audits.length} registro(s) — ordenados do mais recente pro mais antigo.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
