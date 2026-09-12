// frontend/src/pages/PlayerHome.js
// Tela inicial unificada do jogador — substitui JoinGame (/) e PlayerDashboard (/player).
// Lógica de negócio movida intacta das duas telas; só a apresentação é nova.
import React, { useState, useEffect, useCallback, useContext } from "react";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../App";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import ProfileModal from "../components/ProfileModal";
import {
  LuCalendarDays,
  LuClipboardList,
  LuLandPlot,
  LuPlay,
  LuMapPin,
  LuClock,
  LuCopy,
  LuCheck,
  LuUser,
  LuArrowRight,
  LuX,
} from "react-icons/lu";

// Mesmo resolvedor de mídia do App.js — fotos ficam em /uploads/* no backend
const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const mediaUrl = (url) => {
  if (!url) return "";
  return url.startsWith("http") ? url : MEDIA_BASE + url;
};

function PlayerHome() {
  const navigate = useNavigate();
  const club = useContext(ThemeContext) || {};
  const theme = useBirdifyTheme();

  const [user, setUser] = useState(null);

  // ── Meu Perfil ─────────────────────────────────────────────────────────────
  // Modal foi extraído pra ProfileModal (Onda C · Fase C.2). Aqui a home só
  // precisa do profile pra exibir o avatar no header — o resto (form, upload,
  // crop) fica dentro do próprio modal, que emite onProfileChange pra manter
  // este cache sincronizado.
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(null);

  // ── Torneios (ex-PlayerDashboard) ──────────────────────────────────────────
  const [tournaments, setTournaments] = useState([]);
  const [activeTab, setActiveTab] = useState("ativos");
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [whatsappLink, setWhatsappLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [currentSponsorIndex, setCurrentSponsorIndex] = useState(0);

  // ── Entrar na partida por código (ex-JoinGame) ─────────────────────────────
  const [joinOpen, setJoinOpen] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [pendingGroup, setPendingGroup] = useState(null);
  const [groupPlayers, setGroupPlayers] = useState([]);
  const [handicaps, setHandicaps] = useState({});
  const [showHandicapModal, setShowHandicapModal] = useState(false);

  // ── Continuar Partida: sessão de torneio em andamento ──────────────────────
  // activeGroup é gravado no localStorage quando o jogador entra num grupo de
  // torneio. Se o app for fechado e reaberto, precisamos oferecer retomar em
  // vez de forçar novo código+handicap. Só mostra se o torneio ainda existe
  // e está aberto — caso contrário, o localStorage é higienizado.
  const [activeSession, setActiveSession] = useState(null); // { group, tournament }

  // Limpa TODOS os vestígios da sessão de partida (activeGroup + snapshots por groupId
  // + rascunhos por tournamentId). Compartilhado entre: expiração automática,
  // "sair da partida" no banner e o próprio Scorecard ao assinar o cartão.
  const clearMatchSession = useCallback((groupId, tournamentId) => {
    localStorage.removeItem("activeGroup");
    if (groupId != null) {
      localStorage.removeItem(`scorecard_state_${groupId}`);
      sessionStorage.removeItem(`scorecard_hole_${groupId}`);
    }
    if (tournamentId != null) {
      // Padrão dos rascunhos do Scorecard: draft_scores_match_<tid>_hole_<h>
      for (let h = 1; h <= 18; h++) {
        localStorage.removeItem(`draft_scores_match_${tournamentId}_hole_${h}`);
      }
    }
  }, []);

  const fetchTournaments = useCallback(async (userId) => {
    try {
      const res = await api.get(`/tournaments/list?user_id=${userId}`);
      setTournaments(res.data);
    } catch (error) {
      console.error("Erro ao buscar torneios Birdify", error);
    }
  }, []);

  useEffect(() => {
    const parsedUser = getUser();
    if (!parsedUser) {
      navigate("/login");
      return;
    }
    setUser(parsedUser);
    fetchTournaments(parsedUser.id);

    // Perfil (foto no header). O modal faz seu próprio fetch quando abre.
    api.get("/users/me/profile")
      .then((res) => setProfile(res.data))
      .catch(() => {}); // perfil é opcional — falha não bloqueia a home

    // Continuar Partida: se há activeGroup no localStorage, valida contra o
    // servidor. Torneio inexistente/concluído → limpa localStorage silenciosamente.
    // Torneio aberto → guarda a sessão para renderizar o banner "Retomar".
    (async () => {
      let saved;
      try { saved = JSON.parse(localStorage.getItem("activeGroup") || "null"); }
      catch { saved = null; }

      if (!saved?.id || !saved?.tournament_id) return;

      // TTL de segurança: 7 dias. Cobre o caso raro do backend responder OK a um
      // torneio antigo que ninguém encerrou; sem isso, um activeGroup órfão de
      // meses atrás continuaria mostrando o banner até o clube fechar o torneio.
      const savedAt = saved.savedAt || 0;
      const TTL_MS = 7 * 24 * 60 * 60 * 1000;
      if (savedAt && Date.now() - savedAt > TTL_MS) {
        clearMatchSession(saved.id, saved.tournament_id);
        return;
      }

      try {
        const res = await api.get(`/tournaments/${saved.tournament_id}`);
        const tournament = res.data;
        // Só torneio realmente aberto vale como sessão em andamento.
        if (!tournament || tournament.status !== "OPEN") {
          clearMatchSession(saved.id, saved.tournament_id);
          return;
        }
        // Bloco D · commit 5: se o grupo salvo pertence a uma rodada cujo
        // dia BRT ja passou (Opcao B), limpa a sessao — o sócio precisa
        // entrar com o NOVO código da rodada de hoje. Sem isso, o banner
        // "Continuar partida" levaria pra scorecard de rodada anterior.
        const totalRounds = Number(tournament.total_rounds) || 1;
        const savedRound = Number(saved.round_number) || 1;
        if (totalRounds > 1 && Array.isArray(tournament.rounds)) {
          const savedRoundInfo = tournament.rounds.find(r => Number(r.round_number) === savedRound);
          if (savedRoundInfo?.round_date) {
            const savedDayBRT = new Date(savedRoundInfo.round_date)
              .toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
            const todayBRT = new Date()
              .toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
            if (savedDayBRT < todayBRT) {
              clearMatchSession(saved.id, saved.tournament_id);
              return;
            }
          }
        }
        setActiveSession({ group: saved, tournament });
      } catch (err) {
        // 404 = torneio deletado → limpa. Falha de rede → mantém e tenta de novo depois.
        if (err.response?.status === 404) {
          clearMatchSession(saved.id, saved.tournament_id);
        }
      }
    })();
  }, [navigate, fetchTournaments, clearMatchSession]);

  // Carrossel de patrocinadores
  useEffect(() => {
    let interval;
    if (
      selectedTournament &&
      selectedTournament.sponsors &&
      selectedTournament.sponsors.length > 1
    ) {
      interval = setInterval(() => {
        setCurrentSponsorIndex((prev) =>
          prev === selectedTournament.sponsors.length - 1 ? 0 : prev + 1,
        );
      }, 8000);
    }
    return () => clearInterval(interval);
  }, [selectedTournament]);

  const activeTournaments = tournaments.filter((t) => t.status === "OPEN");
  const pastTournaments = tournaments.filter((t) => t.status === "concluido");

  // ── Lógica intacta: entrar no grupo por código ─────────────────────────────
  const handleJoinGroup = async (e) => {
    e.preventDefault();

    if (!navigator.onLine) {
      alert("Sem conexão com a internet. Aguarde o sinal voltar para entrar no grupo.");
      return;
    }

    try {
      const res = await api.post("/groups/join", {
        access_code: accessCode,
        user_id: user.id,
      });

      const group = res.data.group;
      // Fase 2 · Commit 2.4: ask_handicap=0 pula o modal HANDICAPS e vai direto
      // pro Scorecard. Default seguro Number(undefined ?? 1)===1 preserva o
      // comportamento historico se o backend nao injetar o campo (rollback do
      // commit 2.2, deploy fora de ordem, etc). Fluxo doubles ainda nao passa
      // por aqui — PlayerHome so trata individual hoje.
      const askHandicap = Number(group.ask_handicap ?? 1) === 1;
      const listRes = await api.get(`/groups/list/${group.tournament_id}`);
      const myGroup = listRes.data.find((g) => g.id === group.id) || group;

      if (askHandicap && myGroup.players && myGroup.players.length > 0) {
        setPendingGroup(group);
        setGroupPlayers(myGroup.players);

        const initialHandicaps = {};
        myGroup.players.forEach((p) => {
          initialHandicaps[p.id] =
            p.handicap !== null && p.handicap !== undefined ? p.handicap : "";
        });

        setHandicaps(initialHandicaps);
        setShowHandicapModal(true);
      } else {
        // Bloco D · commit 5: preservar round_number (vem do backend commit 2)
        // no localStorage — o Scorecard usa autoritativo e o effect abaixo
        // invalida a sessao quando a rodada do grupo salvo ja passou.
        localStorage.setItem("activeGroup", JSON.stringify({
          ...group,
          round_number: group.round_number ? Number(group.round_number) : 1,
          savedAt: Date.now(),
        }));
        navigate(`/scorecard/${group.id}`);
      }
    } catch (error) {
      const msg = error.response?.data?.message || "Erro de conexão.";
      alert(msg);
    }
  };

  const handleHandicapChange = (userId, value) => {
    setHandicaps({ ...handicaps, [userId]: value });
  };

  const submitHandicaps = async () => {
    if (!navigator.onLine) {
      alert("Aguarde a conexão voltar para confirmar os handicaps. Seus dados estão preenchidos na tela.");
      return;
    }

    for (const p of groupPlayers) {
      if (handicaps[p.id] === "" || handicaps[p.id] === undefined) {
        alert(`Por favor, insira o handicap de ${p.name}`);
        return;
      }
    }

    const playersData = groupPlayers.map((p) => ({
      user_id: p.id,
      handicap: parseFloat(handicaps[p.id]),
    }));

    try {
      await api.put("/groups/save-handicaps", {
        group_id: pendingGroup.id,
        players_data: playersData,
      });

      localStorage.setItem("activeGroup", JSON.stringify({
        ...pendingGroup,
        round_number: pendingGroup.round_number ? Number(pendingGroup.round_number) : 1,
        savedAt: Date.now(),
      }));
      setShowHandicapModal(false);
      navigate(`/scorecard/${pendingGroup.id}`);
    } catch (error) {
      alert("Erro ao salvar: " + (error.response?.data?.error || error.message));
    }
  };

  // ── Lógica intacta: detalhes / inscrição no torneio ────────────────────────
  const openDetails = async (t) => {
    try {
      const res = await api.get(`/inscriptions/tournament/${t.id}`);

      const fullTournamentData = {
        ...res.data,
        course_name: t.course_name,
        course_city: t.course_city,
        course_state: t.course_state,
        pix_key_type: t.pix_key_type,
        fee: t.fee,
      };

      setSelectedTournament(fullTournamentData);

      const alreadySubscribed = t.is_subscribed > 0;
      setIsSubscribed(alreadySubscribed);

      if (alreadySubscribed && fullTournamentData.whatsapp_contact) {
        const message = `Olá! Sou o jogador *${user.name}*. \n\nSegue o meu comprovante de pagamento referente ao torneio *${fullTournamentData.name}*:`;
        const encodedMessage = encodeURIComponent(message);
        const cleanNumber = fullTournamentData.whatsapp_contact.replace(/\D/g, "");
        setWhatsappLink(`https://wa.me/${cleanNumber}?text=${encodedMessage}`);
      } else {
        setWhatsappLink("");
      }

      setCopied(false);
      setCurrentSponsorIndex(0);
    } catch (error) {
      alert("Erro ao carregar detalhes do evento Birdify.");
    }
  };

  const closeModal = () => setSelectedTournament(null);

  const handleInscription = async () => {
    try {
      await api.post("/inscriptions/create", {
        tournament_id: selectedTournament.id,
        user_id: user.id,
        category_id: null,
      });

      const message = `Olá! Acabei de me inscrever no torneio *${selectedTournament.name}*. \n\n*Jogador:* ${user.name} \n\nSegue o meu comprovante de pagamento:`;
      const encodedMessage = encodeURIComponent(message);

      const cleanNumber = selectedTournament.whatsapp_contact
        ? selectedTournament.whatsapp_contact.replace(/\D/g, "")
        : "";

      setWhatsappLink(`https://wa.me/${cleanNumber}?text=${encodedMessage}`);
      setIsSubscribed(true);

      fetchTournaments(user.id);
    } catch (error) {
      if (error.response && error.response.status === 400) {
        alert("Você já está inscrito! Aguarde a aprovação do organizador.");
      } else {
        alert("Erro ao realizar inscrição.");
      }
    }
  };

  const handleCopyPix = () => {
    if (selectedTournament && selectedTournament.payment_info) {
      navigator.clipboard.writeText(selectedTournament.payment_info);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return "--";
    const date = new Date(dateString);
    return date
      .toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", " às");
  };

  // Logout foi movido pra aba "Mais" (Onda C · Fase C.2 — PlayerMore.js);
  // a limpeza de activeGroup vive lá agora (auto-suficiente, lê o localStorage).

  const handleResumeMatch = () => {
    if (!activeSession) return;
    navigate(`/scorecard/${activeSession.group.id}`);
  };

  const handleDismissSession = () => {
    if (!activeSession) return;
    if (!window.confirm("Sair desta partida? A pontuação já salva no servidor não será perdida, mas o app não vai mais oferecer retomar.")) return;
    clearMatchSession(activeSession.group.id, activeSession.group.tournament_id);
    setActiveSession(null);
  };

  // ── Atalhos do grid (2×2) ──────────────────────────────────────────────────
  // Histórico e Meu Desempenho migraram pra aba "Mais" (Onda C · Fase C.2).
  const shortcuts = [
    { icon: LuCalendarDays, label: "Reservar", onClick: () => navigate("/tee-times") },
    { icon: LuClipboardList, label: "Minhas Reservas", onClick: () => navigate("/my-bookings") },
    { icon: LuLandPlot, label: "Treino do dia", onClick: () => navigate("/daily-training") },
    { icon: LuPlay, label: "Entrar na Partida", onClick: () => setJoinOpen(true) },
  ];

  // ── Estilos (design system Birdify) ────────────────────────────────────────
  const { space, radius, shadow, text } = theme;

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
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      paddingBottom: space[4],
      marginBottom: space[5],
      borderBottom: `1px solid ${theme.border}`,
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: space[3],
      marginBottom: space[6],
    },
    shortcut: {
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      padding: `${space[4]}px ${space[2]}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: space[2],
      cursor: "pointer",
      color: theme.textMain,
    },
    shortcutLabel: { ...text.caption, fontWeight: 700 },
    tabsRow: {
      display: "flex",
      gap: space[5],
      borderBottom: `1px solid ${theme.border}`,
      marginBottom: space[4],
    },
    tab: (active) => ({
      background: "none",
      border: "none",
      padding: `${space[3]}px 0`,
      marginBottom: -1,
      cursor: "pointer",
      fontWeight: 700,
      fontSize: 14,
      color: active ? theme.textMain : theme.textMuted,
      borderBottom: `2px solid ${active ? theme.accent : "transparent"}`,
      transition: "color 0.2s",
    }),
    tournamentCard: {
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.sm,
      padding: space[4],
      marginBottom: space[3],
      cursor: "pointer",
    },
    metaRow: {
      display: "flex",
      alignItems: "center",
      gap: space[2],
      ...text.caption,
      color: theme.textMuted,
    },
    badge: {
      backgroundColor: theme.accentSoft,
      color: theme.accent,
      padding: `${space[1]}px ${space[2]}px`,
      borderRadius: radius.sm,
      fontSize: 11,
      fontWeight: 700,
      border: `1px solid ${theme.accent}`,
      whiteSpace: "nowrap",
    },
    modalOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // 10001 pra ficar acima da GlobalSponsorsBar (App.js — zIndex 9999).
      // Modal precisa cobrir o rodapé fixo enquanto aberto.
      zIndex: 10001,
      backgroundColor: "rgba(15, 23, 42, 0.9)",
      backdropFilter: "blur(5px)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: space[4],
    },
    modalContent: {
      backgroundColor: theme.card,
      padding: space[5],
      borderRadius: radius.md,
      width: "100%",
      maxWidth: 550,
      maxHeight: "90vh",
      overflowY: "auto",
      border: `1px solid ${theme.border}`,
      boxShadow: shadow.lg,
    },
    infoBox: {
      backgroundColor: theme.bg,
      padding: space[4],
      borderRadius: radius.md,
      marginBottom: space[4],
      border: `1px solid ${theme.border}`,
    },
    codeInput: {
      padding: space[4],
      width: "100%",
      borderRadius: radius.md,
      border: `2px solid ${theme.border}`,
      backgroundColor: theme.bg,
      color: theme.textMain,
      fontSize: 24,
      textAlign: "center",
      textTransform: "uppercase",
      marginBottom: space[4],
      boxSizing: "border-box",
      letterSpacing: 4,
      fontWeight: 700,
      outline: "none",
    },
    primaryBtn: {
      width: "100%",
      padding: space[4],
      backgroundColor: theme.accent,
      color: theme.accentContrast,
      border: "none",
      borderRadius: radius.md,
      fontSize: 15,
      fontWeight: 700,
      cursor: "pointer",
    },
    secondaryBtn: {
      padding: space[4],
      backgroundColor: "transparent",
      color: theme.textMuted,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      cursor: "pointer",
      fontWeight: 700,
    },
    whatsappBtn: {
      display: "block",
      width: "100%",
      padding: space[4],
      backgroundColor: theme.whatsapp,
      color: "#fff",
      fontSize: 14,
      fontWeight: 700,
      border: "none",
      borderRadius: radius.md,
      textAlign: "center",
      textDecoration: "none",
      boxSizing: "border-box",
      marginTop: space[4],
    },
    playerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: `${space[4]}px 0`,
      borderBottom: `1px solid ${theme.border}`,
    },
    hcInput: {
      width: 90,
      padding: space[3],
      borderRadius: radius.sm,
      border: `1px solid ${theme.border}`,
      backgroundColor: theme.bg,
      color: theme.accent,
      textAlign: "center",
      fontSize: 18,
      fontWeight: 700,
    },
  };

  if (!user) return null;

  return (
    <div style={styles.container}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* ── Header ── */}
      <div style={styles.header}>
        <div style={{ ...text.h2, color: theme.textMain }}>
          {club.name || "Birdify"}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: space[3], position: "relative" }}>
          {/* Avatar clicável — atalho direto pro Meu Perfil */}
          <button
            onClick={() => setProfileOpen(true)}
            aria-label="Abrir meu perfil"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}
          >
            {profile?.profile_photo_url ? (
              <img
                src={mediaUrl(profile.profile_photo_url)}
                alt="Foto de perfil"
                style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: `1px solid ${theme.border}` }}
              />
            ) : (
              <span style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: theme.card, border: `1px solid ${theme.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: theme.textMuted }}>
                <LuUser size={16} />
              </span>
            )}
          </button>
          <span style={{ ...text.body, color: theme.textMuted }}>
            {user.name.split(" ")[0]}
          </span>
          {/* Menu hambúrguer migrou pra aba "Mais" (Onda C · Fase C.2):
              Meu Perfil, Painel do Organizador e Sair da Conta ficam lá. */}
        </div>
      </div>

      {/* ── Banner: continuar partida em andamento ── */}
      {activeSession && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: space[3],
            padding: space[4],
            marginBottom: space[4],
            backgroundColor: theme.accentSoft || theme.card,
            border: `1px solid ${theme.accent}`,
            borderRadius: radius.md,
            boxShadow: shadow.sm,
          }}
        >
          <button
            onClick={handleResumeMatch}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: space[3],
              padding: 0,
              background: "none",
              border: "none",
              color: theme.textMain,
              cursor: "pointer",
              textAlign: "left",
            }}
            aria-label="Retomar partida em andamento"
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                backgroundColor: theme.accent,
                color: theme.accentContrast,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <LuPlay size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...text.overline, color: theme.accent, marginBottom: 2 }}>
                CONTINUAR PARTIDA
              </div>
              <div style={{ ...text.body, fontWeight: 700, color: theme.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeSession.group.group_name || "Meu grupo"}
              </div>
              <div style={{ ...text.caption, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeSession.tournament.name}
              </div>
            </span>
            <LuArrowRight size={18} color={theme.accent} style={{ flexShrink: 0 }} />
          </button>
          <button
            onClick={handleDismissSession}
            aria-label="Sair desta partida"
            title="Sair desta partida"
            style={{
              background: "none",
              border: `1px solid ${theme.border}`,
              borderRadius: radius.sm,
              color: theme.textMuted,
              padding: space[2],
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <LuX size={16} />
          </button>
        </div>
      )}

      {/* ── Grid de atalhos ── */}
      <div style={styles.grid}>
        {shortcuts.map(({ icon: Icon, label, onClick }) => (
          <button key={label} onClick={onClick} style={styles.shortcut}>
            <Icon size={24} color={theme.accent} />
            <span style={styles.shortcutLabel}>{label}</span>
          </button>
        ))}
      </div>

      {/* ── Tabs de torneios ── */}
      <div style={styles.tabsRow}>
        <button style={styles.tab(activeTab === "ativos")} onClick={() => setActiveTab("ativos")}>
          Abertos
        </button>
        <button style={styles.tab(activeTab === "concluidos")} onClick={() => setActiveTab("concluidos")}>
          Concluídos
        </button>
      </div>

      {/* ── Lista de torneios ── */}
      {activeTab === "ativos" ? (
        <div>
          {activeTournaments.length === 0 ? (
            <div style={{ textAlign: "center", padding: space[6], color: theme.textMuted, ...text.body }}>
              Nenhum torneio aberto no momento.
            </div>
          ) : (
            activeTournaments.map((t) => (
              <div key={t.id} style={styles.tournamentCard} onClick={() => openDetails(t)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space[3], marginBottom: space[2] }}>
                  <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, ...text.h3, color: theme.textMain }}>{t.name}</h3>
                    {/* Onda B · Commit 3.13: badge DUPLAS distingue rapido
                        torneios doubles na lista do jogador. */}
                    {t.modality === 'doubles' && (
                      <span style={{ ...styles.badge, backgroundColor: theme.gold, color: '#000' }}>DUPLAS</span>
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
                    <span>
                      Início: <strong style={{ color: theme.textMain }}>{formatDateTime(t.start_date)}</strong>
                    </span>
                  </div>
                  <div style={styles.metaRow}>
                    <LuClock size={14} />
                    <span>
                      Inscrições até: <strong style={{ color: theme.danger }}>{formatDateTime(t.registration_deadline)}</strong>
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div>
          {pastTournaments.length === 0 ? (
            <div style={{ textAlign: "center", padding: space[6], color: theme.textMuted, ...text.body }}>
              Nenhum torneio concluído ainda.
            </div>
          ) : (
            pastTournaments.map((t) => {
              const slug = t.name
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)+/g, "");
              return (
                <div
                  key={t.id}
                  style={{ ...styles.tournamentCard, opacity: 0.85 }}
                  onClick={() => navigate(`/leaderboard/${t.id}-${slug}`)}
                >
                  <h3 style={{ margin: `0 0 ${space[1]}px 0`, ...text.h3, color: theme.textMain }}>{t.name}</h3>
                  <p style={{ margin: 0, ...text.caption, color: theme.textMuted }}>
                    Toque para ver o Hall da Fama e resultados.
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Modal: Meu Perfil (componente extraído — Onda C · Fase C.2) ── */}
      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onProfileChange={(next) => setProfile(next)}
      />

      {/* ── Modal: entrar na partida por código ── */}
      {joinOpen && (
        <div style={styles.modalOverlay} onClick={() => setJoinOpen(false)}>
          <div style={{ ...styles.modalContent, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: `0 0 ${space[2]}px 0`, ...text.h2, color: theme.textMain, textAlign: "center" }}>
              Entrar na Partida
            </h2>
            <p style={{ ...text.caption, color: theme.textMuted, textAlign: "center", margin: `0 0 ${space[5]}px 0`, textTransform: "uppercase", letterSpacing: 1 }}>
              Código do grupo (torneio)
            </p>
            <form onSubmit={handleJoinGroup}>
              <input
                type="text"
                placeholder="A1B2"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                style={styles.codeInput}
                required
                maxLength={6}
                autoFocus
              />
              <button type="submit" style={styles.primaryBtn}>COMEÇAR PARTIDA</button>
            </form>
            <button
              onClick={() => setJoinOpen(false)}
              style={{ ...styles.secondaryBtn, width: "100%", marginTop: space[3] }}
            >
              VOLTAR
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: handicaps do grupo ── */}
      {showHandicapModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: 420 }}>
            <h2 style={{ margin: 0, ...text.h2, color: theme.accent, textAlign: "center" }}>HANDICAPS</h2>
            <p style={{ ...text.body, color: theme.textMuted, textAlign: "center", marginBottom: space[5] }}>
              Insira o handicap para o cálculo do <strong style={{ color: theme.textMain }}>Net Score</strong>.
            </p>

            {groupPlayers.map((p) => (
              <div key={p.id} style={styles.playerRow}>
                <div style={{ textAlign: "left" }}>
                  <div style={{ ...text.h3 }}>{p.name}</div>
                  <div style={{ ...text.caption, color: theme.textMuted }}>
                    {p.gender === "M" || p.gender === "Masculino" ? "Masculino" : "Feminino"}
                  </div>
                </div>
                <input
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={handicaps[p.id] || ""}
                  onChange={(e) => handleHandicapChange(p.id, e.target.value)}
                  style={styles.hcInput}
                />
              </div>
            ))}

            <div style={{ display: "flex", gap: space[4], marginTop: space[5] }}>
              <button onClick={() => setShowHandicapModal(false)} style={{ ...styles.secondaryBtn, flex: 1 }}>
                VOLTAR
              </button>
              <button onClick={submitHandicaps} style={{ ...styles.primaryBtn, flex: 2 }}>
                CONFIRMAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: detalhes / inscrição do torneio ── */}
      {selectedTournament && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: space[4] }}>
              <h2 style={{ margin: 0, ...text.h2, color: theme.textMain }}>
                {selectedTournament.name}
              </h2>
              <button
                onClick={closeModal}
                style={{ background: "none", border: "none", color: theme.textMuted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div style={styles.infoBox}>
              <p style={{ ...text.overline, color: theme.textMuted, margin: `0 0 ${space[2]}px 0` }}>
                Sobre o evento
              </p>
              <p style={{ margin: `0 0 ${space[4]}px 0`, ...text.body, whiteSpace: "pre-wrap" }}>
                {selectedTournament.description}
              </p>

              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: space[3], display: "flex", flexDirection: "column", gap: space[1] }}>
                <div style={styles.metaRow}>
                  <LuCalendarDays size={14} />
                  <span>
                    <strong>Início:</strong> {formatDateTime(selectedTournament.start_date)}
                  </span>
                </div>
                <div style={{ ...styles.metaRow, color: theme.danger }}>
                  <LuClock size={14} />
                  <span>
                    <strong>Prazo final:</strong> {formatDateTime(selectedTournament.registration_deadline)}
                  </span>
                </div>
              </div>
            </div>

            {/* Pagamento (valor + PIX) */}
            {selectedTournament.payment_info && (
              <div style={{ ...styles.infoBox, borderLeft: `4px solid ${theme.whatsapp}` }}>
                {selectedTournament.fee && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[3], paddingBottom: space[3], borderBottom: `1px solid ${theme.border}` }}>
                    <span style={{ ...text.overline, color: theme.textMuted }}>
                      Valor da inscrição
                    </span>
                    <span style={{ fontSize: 15, color: theme.gold, fontWeight: 800 }}>
                      {selectedTournament.fee}
                    </span>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[2] }}>
                  <p style={{ ...text.caption, color: theme.whatsapp, margin: 0, fontWeight: 700 }}>
                    PIX ({selectedTournament.pix_key_type || "Chave Aleatória"})
                  </p>
                  <button
                    onClick={handleCopyPix}
                    style={{
                      backgroundColor: copied ? theme.whatsapp : "transparent",
                      color: copied ? "#000" : theme.whatsapp,
                      border: `1px solid ${theme.whatsapp}`,
                      padding: `${space[1]}px ${space[3]}px`,
                      borderRadius: radius.sm,
                      fontSize: 11,
                      cursor: "pointer",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: space[1],
                      transition: "all 0.2s",
                    }}
                  >
                    {copied ? <LuCheck size={13} /> : <LuCopy size={13} />}
                    {copied ? "COPIADO!" : "COPIAR CHAVE"}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                  {selectedTournament.payment_info}
                </p>
              </div>
            )}

            {!isSubscribed ? (
              <button style={styles.primaryBtn} onClick={handleInscription}>
                CONFIRMAR MINHA VAGA
              </button>
            ) : (
              <div style={{ textAlign: "center", padding: space[4], backgroundColor: theme.accentSofter, borderRadius: radius.md, border: `1px solid ${theme.accent}` }}>
                <LuCheck size={28} color={theme.accent} style={{ marginBottom: space[1] }} />
                <h3 style={{ margin: `0 0 ${space[1]}px 0`, ...text.h3, color: theme.accent }}>
                  Você já está inscrito!
                </h3>
                <p style={{ ...text.caption, color: theme.textMain, margin: `0 0 ${space[4]}px 0` }}>
                  Efetue o pagamento na chave PIX acima e envie o comprovante para garantir sua vaga.
                </p>
                {whatsappLink && (
                  <a href={whatsappLink} target="_blank" rel="noreferrer" style={styles.whatsappBtn}>
                    ENVIAR COMPROVANTE VIA WHATSAPP
                  </a>
                )}
              </div>
            )}

            {/* Patrocinadores */}
            {selectedTournament.sponsors?.length > 0 && (
              <div style={{ marginTop: space[5], borderTop: `1px solid ${theme.border}`, paddingTop: space[4], textAlign: "center" }}>
                <p style={{ ...text.overline, color: theme.textMuted, marginBottom: space[4], letterSpacing: 2 }}>
                  Patrocínio oficial
                </p>

                <div style={{ height: 90, display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <img
                    key={currentSponsorIndex}
                    src={mediaUrl(selectedTournament.sponsors[currentSponsorIndex].image_url)}
                    alt={selectedTournament.sponsors[currentSponsorIndex].name || "Patrocinador"}
                    style={{ maxHeight: "100%", maxWidth: 250, objectFit: "contain", animation: "fadeIn 0.5s ease-in" }}
                  />
                </div>

                {selectedTournament.sponsors.length > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", gap: space[2], marginTop: space[4] }}>
                    {selectedTournament.sponsors.map((_, idx) => (
                      <div
                        key={idx}
                        onClick={() => setCurrentSponsorIndex(idx)}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: currentSponsorIndex === idx ? theme.accent : theme.cardLight,
                          cursor: "pointer",
                          transition: "all 0.3s ease",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PlayerHome;
