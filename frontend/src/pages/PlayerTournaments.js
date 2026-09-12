// frontend/src/pages/PlayerTournaments.js
// Aba TORNEIOS da bottom nav (Onda C · Fase C.4). Move a lista inline
// (tabs Abertos/Concluídos) que ficava no PlayerHome pra cá. Clique em
// aberto navega pra /torneios/:id (TournamentDetail); clique em concluído
// segue no /leaderboard/:id-:slug (Hall da Fama), como já era.
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { LuCalendarDays, LuClock, LuMapPin, LuTrophy } from "react-icons/lu";

// Mesmo formatador que existia no PlayerHome — mantido inline pra não
// espalhar utils ainda sem uso claro fora dos torneios.
function formatDateTime(dateString) {
  if (!dateString) return "--";
  const date = new Date(dateString);
  return date
    .toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
    .replace(",", " às");
}

function slugify(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export default function PlayerTournaments() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const { space, radius, shadow, text } = theme;

  const [user] = useState(() => getUser());
  const [tournaments, setTournaments] = useState(null); // null = loading
  const [activeTab, setActiveTab] = useState("ativos");
  const [err, setErr] = useState("");

  const fetchTournaments = useCallback(async (userId) => {
    try {
      const res = await api.get(`/tournaments/list?user_id=${userId}`);
      setTournaments(res.data);
    } catch (e) {
      setErr("Não foi possível carregar os torneios.");
      setTournaments([]);
    }
  }, []);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    fetchTournaments(user.id);
  }, [user, fetchTournaments, navigate]);

  const active = (tournaments || []).filter((t) => t.status === "OPEN");
  const past = (tournaments || []).filter((t) => t.status === "concluido");

  const styles = {
    container: {
      backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain,
      fontFamily: theme.font,
      padding: `${space[4]}px ${space[4]}px ${space[6]}px`,
      maxWidth: 560, margin: "0 auto",
    },
    tabsRow: {
      display: "flex", gap: space[5],
      borderBottom: `1px solid ${theme.border}`,
      marginBottom: space[4],
    },
    tab: (isActive) => ({
      background: "none", border: "none",
      padding: `${space[3]}px 0`, marginBottom: -1,
      cursor: "pointer", fontWeight: 700, fontSize: 14,
      color: isActive ? theme.textMain : theme.textMuted,
      borderBottom: `2px solid ${isActive ? theme.accent : "transparent"}`,
      transition: "color 0.2s",
      fontFamily: theme.font,
    }),
    card: {
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md, boxShadow: shadow.sm,
      padding: space[4], marginBottom: space[3],
      cursor: "pointer",
      width: "100%", textAlign: "left", fontFamily: theme.font,
      color: theme.textMain,
    },
    metaRow: {
      display: "flex", alignItems: "center", gap: space[2],
      ...text.caption, color: theme.textMuted,
    },
    badge: {
      backgroundColor: theme.accent, color: theme.accentContrast,
      padding: `2px ${space[2]}px`, borderRadius: radius.pill,
      ...text.caption, fontWeight: 700,
    },
    empty: {
      textAlign: "center", padding: space[6],
      color: theme.textMuted,
      backgroundColor: theme.card,
      border: `1px dashed ${theme.border}`,
      borderRadius: radius.md,
      ...text.body,
    },
  };

  const renderActive = () => {
    if (tournaments === null) return <div style={styles.empty}>Carregando torneios…</div>;
    if (active.length === 0) return (
      <div style={styles.empty}>
        <LuTrophy size={26} color={theme.textMuted} style={{ marginBottom: space[2] }} />
        <div style={{ ...text.body, color: theme.textMain, fontWeight: 700, marginBottom: space[1] }}>
          Nenhum torneio aberto no momento
        </div>
        <div style={{ ...text.caption, color: theme.textMuted }}>
          Quando seu clube abrir um novo torneio, ele aparece aqui.
        </div>
      </div>
    );
    return active.map((t) => (
      <button
        key={t.id}
        style={styles.card}
        onClick={() => navigate(`/torneios/${t.id}`)}
        aria-label={`Ver torneio ${t.name}`}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space[3], marginBottom: space[2] }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, ...text.h3, color: theme.textMain }}>{t.name}</h3>
            {/* Onda B · 3.13: badge DUPLAS distingue rápido torneios doubles */}
            {t.modality === "doubles" && (
              <span style={{ ...styles.badge, backgroundColor: theme.gold, color: "#000" }}>DUPLAS</span>
            )}
          </div>
          {t.is_subscribed > 0 && <span style={styles.badge}>INSCRITO</span>}
        </div>
        <div style={{ ...styles.metaRow, marginBottom: space[2] }}>
          <LuMapPin size={14} />
          <span>
            {t.course_name || "Local a definir"}
            {t.course_city ? ` - ${t.course_city}/${t.course_state}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
          <div style={styles.metaRow}>
            <LuCalendarDays size={14} />
            <span>Início: <strong style={{ color: theme.textMain }}>{formatDateTime(t.start_date)}</strong></span>
          </div>
          <div style={styles.metaRow}>
            <LuClock size={14} />
            <span>Inscrições até: <strong style={{ color: theme.danger }}>{formatDateTime(t.registration_deadline)}</strong></span>
          </div>
        </div>
      </button>
    ));
  };

  const renderPast = () => {
    if (tournaments === null) return <div style={styles.empty}>Carregando torneios…</div>;
    if (past.length === 0) return (
      <div style={styles.empty}>Nenhum torneio concluído ainda.</div>
    );
    return past.map((t) => {
      const slug = slugify(t.name);
      return (
        <button
          key={t.id}
          style={{ ...styles.card, opacity: 0.85 }}
          onClick={() => navigate(`/leaderboard/${t.id}-${slug}`)}
        >
          <h3 style={{ margin: `0 0 ${space[1]}px 0`, ...text.h3, color: theme.textMain }}>{t.name}</h3>
          <p style={{ margin: 0, ...text.caption, color: theme.textMuted }}>
            Toque para ver o Hall da Fama e resultados.
          </p>
        </button>
      );
    });
  };

  return (
    <div style={styles.container}>
      <h1 style={{ ...text.h1, color: theme.textMain, margin: `0 0 ${space[4]}px 0` }}>
        Torneios
      </h1>

      <div style={styles.tabsRow}>
        <button style={styles.tab(activeTab === "ativos")} onClick={() => setActiveTab("ativos")}>
          Abertos
        </button>
        <button style={styles.tab(activeTab === "concluidos")} onClick={() => setActiveTab("concluidos")}>
          Concluídos
        </button>
      </div>

      {err && (
        <div style={{ ...styles.empty, color: theme.danger, borderColor: theme.danger }}>{err}</div>
      )}

      {activeTab === "ativos" ? renderActive() : renderPast()}
    </div>
  );
}
