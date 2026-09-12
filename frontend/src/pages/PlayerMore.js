// frontend/src/pages/PlayerMore.js
// Aba MAIS da bottom nav (Onda C · Fase C.2). Concentra o que saiu do
// menu hambúrguer + shortcuts secundários do PlayerHome:
//   - Meu Perfil (abre ProfileModal reutilizável)
//   - Histórico
//   - Meu Desempenho
//   - Painel do Organizador (só se isAdminOfCurrentClub)
//   - Sair da Conta
//
// A rota /mais é montada dentro de PlayerShell (App.js), sob PlayerRoute
// — admin nunca vê essa página; a bottom nav aparece embaixo.
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { logout } from "../services/session";
import { useAdminMembership } from "../App";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import ProfileModal from "../components/ProfileModal";
import {
  LuUser,
  LuHistory,
  LuTarget,
  LuLayoutDashboard,
  LuLogOut,
  LuChevronRight,
} from "react-icons/lu";

const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const mediaUrl = (url) => (!url ? "" : url.startsWith("http") ? url : MEDIA_BASE + url);

export default function PlayerMore() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const { isAdmin: isAdminOfCurrentClub } = useAdminMembership();
  const { space, radius, shadow, text } = theme;

  const [user] = useState(() => getUser());
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    api.get("/users/me/profile")
      .then((r) => setProfile(r.data))
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    // Limpa activeGroup antes de sair — evita que outro usuário no mesmo
    // dispositivo herde a sessão de partida do anterior (vinha do PlayerHome
    // antes da Fase C.2). Auto-suficiente: lê o localStorage aqui.
    try {
      const saved = JSON.parse(localStorage.getItem("activeGroup") || "null");
      if (saved?.id) {
        localStorage.removeItem("activeGroup");
        localStorage.removeItem(`scorecard_state_${saved.id}`);
        sessionStorage.removeItem(`scorecard_hole_${saved.id}`);
        if (saved.tournament_id != null) {
          for (let h = 1; h <= 18; h++) {
            localStorage.removeItem(`draft_scores_match_${saved.tournament_id}_hole_${h}`);
          }
        }
      }
    } catch (_) {}
    logout(navigate);
  };

  const items = [
    { key: "profile", label: "Meu Perfil", Icon: LuUser, onClick: () => setProfileOpen(true) },
    { key: "history", label: "Histórico", Icon: LuHistory, onClick: () => navigate("/player-history") },
    { key: "performance", label: "Meu Desempenho", Icon: LuTarget, onClick: () => navigate("/my-performance") },
    ...(isAdminOfCurrentClub
      ? [{ key: "organizer", label: "Painel do Organizador", Icon: LuLayoutDashboard, onClick: () => navigate("/dashboard") }]
      : []),
    { key: "logout", label: "Sair da Conta", Icon: LuLogOut, danger: true, onClick: handleLogout },
  ];

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
    userCard: {
      display: "flex",
      alignItems: "center",
      gap: space[3],
      padding: space[4],
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      marginBottom: space[5],
      cursor: "pointer",
      color: theme.textMain,
      textAlign: "left",
      width: "100%",
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: "50%",
      objectFit: "cover",
      border: `1px solid ${theme.border}`,
      flexShrink: 0,
    },
    avatarPlaceholder: {
      width: 56, height: 56, borderRadius: "50%",
      backgroundColor: theme.bg,
      border: `1px solid ${theme.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: theme.textMuted, flexShrink: 0,
    },
    row: (danger) => ({
      display: "flex",
      alignItems: "center",
      gap: space[3],
      width: "100%",
      padding: `${space[4]}px ${space[4]}px`,
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      marginBottom: space[2],
      color: danger ? theme.danger : theme.textMain,
      cursor: "pointer",
      textAlign: "left",
      fontFamily: theme.font,
    }),
    rowLabel: { ...text.body, fontWeight: 700, flex: 1, minWidth: 0 },
    sectionTitle: {
      ...text.overline,
      color: theme.textMuted,
      margin: `${space[5]}px 0 ${space[2]}px 0`,
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={{ ...text.h1, color: theme.textMain, margin: `0 0 ${space[4]}px 0` }}>
        Mais
      </h1>

      {/* Cartão do usuário — clique abre Meu Perfil (mesmo destino do 1º item da lista) */}
      <button onClick={() => setProfileOpen(true)} style={styles.userCard}>
        {profile?.profile_photo_url ? (
          <img
            src={mediaUrl(profile.profile_photo_url)}
            alt="Foto de perfil"
            style={styles.avatar}
          />
        ) : (
          <span style={styles.avatarPlaceholder}>
            <LuUser size={28} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...text.body, fontWeight: 700, color: theme.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.name || "Jogador"}
          </div>
          <div style={{ ...text.caption, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.email || ""}
          </div>
        </div>
        <LuChevronRight size={18} color={theme.textMuted} />
      </button>

      <div style={styles.sectionTitle}>CONTA E ATIVIDADE</div>
      {items.map((it) => (
        <button key={it.key} onClick={it.onClick} style={styles.row(it.danger)}>
          <it.Icon size={20} color={it.danger ? theme.danger : theme.accent} />
          <span style={styles.rowLabel}>{it.label}</span>
          {!it.danger && <LuChevronRight size={18} color={theme.textMuted} />}
        </button>
      ))}

      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onProfileChange={(next) => setProfile(next)}
      />
    </div>
  );
}
