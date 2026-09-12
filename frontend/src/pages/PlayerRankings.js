// frontend/src/pages/PlayerRankings.js
// Aba RANKINGS da bottom nav (Onda C · Fase C.3). Lista os circuitos/ligas
// do clube atual (multi-tenant via req.club.id no backend); clique num card
// abre o ranking público existente em /ranking/:id (CircuitRankingPublic).
//
// Backend: GET /api/circuits/public (requireAuth, projeção enxuta).
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { LuMedal, LuChevronRight, LuTrophy, LuTriangleAlert } from "react-icons/lu";

export default function PlayerRankings() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const { space, radius, shadow, text } = theme;

  const [circuits, setCircuits] = useState(null); // null = loading, [] = empty, [...] = lista
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.get("/circuits/public")
      .then((r) => { if (!cancelled) setCircuits(Array.isArray(r.data) ? r.data : []); })
      .catch((e) => {
        if (cancelled) return;
        setErr(e.response?.data?.error || "Não foi possível carregar os rankings.");
        setCircuits([]);
      });
    return () => { cancelled = true; };
  }, []);

  const styles = {
    container: {
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      fontFamily: theme.font,
      padding: `${space[4]}px ${space[4]}px ${space[6]}px`,
      maxWidth: 560,
      margin: "0 auto",
    },
    card: {
      display: "flex",
      alignItems: "center",
      gap: space[3],
      width: "100%",
      padding: space[4],
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      marginBottom: space[3],
      color: theme.textMain,
      cursor: "pointer",
      textAlign: "left",
      fontFamily: theme.font,
    },
    iconBox: {
      width: 44, height: 44, borderRadius: radius.sm,
      backgroundColor: theme.accentSoft,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: theme.accent, flexShrink: 0,
    },
    empty: {
      textAlign: "center",
      padding: space[6],
      color: theme.textMuted,
      backgroundColor: theme.card,
      border: `1px dashed ${theme.border}`,
      borderRadius: radius.md,
      ...text.body,
    },
    chip: {
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: `2px ${space[2]}px`,
      backgroundColor: theme.bg,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.pill,
      ...text.caption,
      color: theme.textMuted,
      fontWeight: 600,
    },
    metaRow: {
      display: "flex", flexWrap: "wrap", gap: space[2],
      marginTop: space[1],
    },
  };

  const renderBody = () => {
    if (circuits === null) {
      return (
        <div style={{ ...styles.empty, borderStyle: "solid" }}>Carregando rankings…</div>
      );
    }
    if (err) {
      return (
        <div style={{ ...styles.empty, color: theme.danger, borderColor: theme.danger }}>
          <LuTriangleAlert size={20} style={{ marginBottom: space[1] }} />
          <div>{err}</div>
        </div>
      );
    }
    if (circuits.length === 0) {
      return (
        <div style={styles.empty}>
          <LuTrophy size={26} color={theme.textMuted} style={{ marginBottom: space[2] }} />
          <div style={{ ...text.body, color: theme.textMain, fontWeight: 700, marginBottom: space[1] }}>
            Nenhuma liga ou circuito ativo
          </div>
          <div style={{ ...text.caption, color: theme.textMuted }}>
            Quando seu clube abrir um novo circuito, ele aparece aqui.
          </div>
        </div>
      );
    }
    return circuits.map((c) => (
      <button
        key={c.id}
        onClick={() => navigate(`/ranking/${c.id}`)}
        style={styles.card}
        aria-label={`Abrir ranking do circuito ${c.name}`}
      >
        <span style={styles.iconBox}>
          <LuMedal size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...text.h3, color: theme.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.name}
          </div>
          {c.description && (
            <div style={{ ...text.caption, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
              {c.description}
            </div>
          )}
          <div style={styles.metaRow}>
            {c.total_stages != null && (
              <span style={styles.chip}>
                {c.total_stages} etapa{c.total_stages === 1 ? "" : "s"}
              </span>
            )}
            {c.num_discards > 0 && (
              <span style={styles.chip}>
                {c.num_discards} descarte{c.num_discards === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <LuChevronRight size={18} color={theme.textMuted} style={{ flexShrink: 0 }} />
      </button>
    ));
  };

  return (
    <div style={styles.container}>
      <h1 style={{ ...text.h1, color: theme.textMain, margin: `0 0 ${space[2]}px 0` }}>
        Rankings
      </h1>
      <p style={{ ...text.caption, color: theme.textMuted, margin: `0 0 ${space[5]}px 0` }}>
        Ligas e circuitos do seu clube
      </p>
      {renderBody()}
    </div>
  );
}
