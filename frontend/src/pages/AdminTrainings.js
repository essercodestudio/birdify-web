// frontend/src/pages/AdminTrainings.js
// Item 1+2 (2026-08-28 tarde): tela dedicada de "Treino do Dia" no admin,
// separada do Dashboard de torneios. Agrupa treinos por DIA (nao por criador)
// e oferece atalhos: ajustar tacadas do dia + ranking do dia (quando hoje).
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { LuFlag, LuCalendarDays, LuUsers, LuMapPin, LuPencilLine, LuTrophy } from "react-icons/lu";

// Formata "YYYY-MM-DD" → "DD/MM/YYYY" (fonte do backend ja normalizada BRT
// via DATE_FORMAT no MySQL).
const fmtBR = (isoDate) => {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
};

// "Hoje" em BRT — pra decidir se o ranking publico (/ranking/dia) faz sentido
// (a rota mostra APENAS o dia corrente). Historicos ficam sem esse botao ate
// existir rota historica publica.
const todayBRT = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export default function AdminTrainings() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();

  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    if (u.role !== "ADMIN") { navigate("/"); return; }
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/trainings/by-date");
      setDays(res.data || []);
    } catch (e) {
      console.error("Erro ao buscar treinos por data:", e);
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = todayBRT();

  const styles = {
    container: { backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 },
    inner: { maxWidth: 960, margin: "0 auto" },
    header: { marginBottom: 20 },
    title: { fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 },
    subtitle: { color: theme.textMuted, fontSize: 13, marginTop: 4 },
    card: (isToday) => ({
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderLeft: `6px solid ${isToday ? "#22d3ee" : theme.accent}`,
      borderRadius: 12,
      padding: 18,
      marginBottom: 14,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: 14,
    }),
    dateLine: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
    dateText: { fontSize: 18, fontWeight: 800 },
    liveBadge: {
      backgroundColor: "#22d3ee", color: "#000",
      fontSize: 10, fontWeight: 900, padding: "3px 9px",
      borderRadius: 10, letterSpacing: 1, animation: "pulse 1.5s infinite",
    },
    metaRow: { fontSize: 13, color: theme.textMuted, marginTop: 3, display: "flex", alignItems: "center", gap: 6 },
    chipRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 },
    statusChip: (bg, fg) => ({
      backgroundColor: bg, color: fg,
      fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 10,
      textTransform: "uppercase", letterSpacing: 0.3,
    }),
    actions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
    btn: (bg, fg = "#000") => ({
      padding: "8px 14px",
      borderRadius: 6,
      border: "none",
      backgroundColor: bg,
      color: fg,
      fontSize: 12,
      fontWeight: 800,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
    }),
    empty: {
      textAlign: "center", color: theme.textMuted, padding: 30,
      backgroundColor: theme.card, borderRadius: 12, fontSize: 14,
    },
  };

  return (
    <div style={styles.container}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      <div style={styles.inner}>
        <AdminNavMenu />

        <div style={styles.header}>
          <h1 style={styles.title}>
            <LuFlag size={24} color={theme.accent} />
            Treino do Dia
          </h1>
          <p style={styles.subtitle}>
            Treinos do clube agrupados por data (últimos 180 dias).
          </p>
        </div>

        {loading && (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 24 }}>
            Carregando treinos...
          </p>
        )}

        {!loading && days.length === 0 && (
          <div style={styles.empty}>
            Nenhum treino registrado nos últimos 180 dias.
          </div>
        )}

        {!loading && days.map((day) => {
          const isToday = day.date === today;
          const activeCount = day.status.ativo + day.status.aguardando;
          return (
            <div key={day.date} style={styles.card(isToday)}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={styles.dateLine}>
                  <LuCalendarDays size={17} color={theme.gold} />
                  <span style={styles.dateText}>Treino {fmtBR(day.date)}</span>
                  {isToday && activeCount > 0 && <span style={styles.liveBadge}>AO VIVO</span>}
                </div>

                <div style={styles.metaRow}>
                  <LuUsers size={13} />
                  <span>
                    <strong style={{ color: theme.textMain }}>{day.groups_count}</strong> treino(s) ·
                    {" "}<strong style={{ color: theme.textMain }}>{day.players_count}</strong> atleta(s) ·
                    {" "}<strong style={{ color: theme.textMain }}>{day.scores_recorded}</strong> buracos marcados
                  </span>
                </div>

                {day.courses && (
                  <div style={styles.metaRow}>
                    <LuMapPin size={13} />
                    <span>{day.courses}</span>
                  </div>
                )}

                <div style={styles.chipRow}>
                  {day.status.finalizado > 0 && (
                    <span style={styles.statusChip("rgba(34,197,94,0.15)", theme.accent)}>
                      {day.status.finalizado} finalizado
                    </span>
                  )}
                  {day.status.ativo > 0 && (
                    <span style={styles.statusChip("rgba(34,211,238,0.15)", "#22d3ee")}>
                      {day.status.ativo} em andamento
                    </span>
                  )}
                  {day.status.aguardando > 0 && (
                    <span style={styles.statusChip("rgba(234,179,8,0.15)", theme.gold)}>
                      {day.status.aguardando} aguardando
                    </span>
                  )}
                  {day.status.cancelado > 0 && (
                    <span style={styles.statusChip("rgba(148,163,184,0.15)", theme.textMuted)}>
                      {day.status.cancelado} cancelado
                    </span>
                  )}
                </div>
              </div>

              <div style={styles.actions}>
                <button
                  onClick={() => navigate(`/admin/ajustar-scores?tab=training&date=${day.date}`)}
                  style={styles.btn(theme.info, "#fff")}
                  title="Abrir editor de tacadas filtrado por este dia"
                >
                  <LuPencilLine size={12} />
                  AJUSTAR TACADAS
                </button>
                {isToday && (
                  <button
                    onClick={() => window.open("/ranking/dia", "_blank")}
                    style={styles.btn(theme.gold)}
                    title="Abrir ranking publico do dia atual"
                  >
                    <LuTrophy size={12} />
                    RANKING
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
