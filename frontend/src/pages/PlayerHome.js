// frontend/src/pages/PlayerHome.js
// Tela inicial unificada do jogador — substitui JoinGame (/) e PlayerDashboard (/player).
// Lógica de negócio movida intacta das duas telas; só a apresentação é nova.
import React, { useState, useEffect, useCallback, useContext } from "react";
import api from "../services/api";
import { logout } from "../services/session";
import { getUser, updateUser } from "../services/authStorage";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../App";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import Cropper from "react-easy-crop";
import {
  LuCalendarDays,
  LuClipboardList,
  LuFlag,
  LuHistory,
  LuLandPlot,
  LuPlay,
  LuTarget,
  LuMenu,
  LuMapPin,
  LuClock,
  LuCopy,
  LuCheck,
  LuLogOut,
  LuLayoutDashboard,
  LuUser,
  LuCamera,
  LuInstagram,
  LuMessageCircle,
  LuZoomIn,
  LuZoomOut,
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
  const [menuOpen, setMenuOpen] = useState(false);

  // ── Meu Perfil ─────────────────────────────────────────────────────────────
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(null); // dados vindos do servidor
  const [profileForm, setProfileForm] = useState({ name: "", bio: "", instagram_handle: "", whatsapp_number: "", golf_motivation: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  // Enquadramento da foto (react-easy-crop): o arquivo escolhido abre num
  // recorte circular com zoom/arrasto; só o quadro confirmado é enviado.
  const [cropSrc, setCropSrc] = useState(null);      // dataURL da imagem original
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropAreaPx, setCropAreaPx] = useState(null); // região confirmada, em pixels da original

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

    // Perfil (foto no header + dados do modal)
    api.get("/users/me/profile")
      .then((res) => {
        setProfile(res.data);
        setProfileForm({
          name: res.data.name || "",
          bio: res.data.bio || "",
          instagram_handle: res.data.instagram_handle || "",
          whatsapp_number: res.data.whatsapp_number || "",
          golf_motivation: res.data.golf_motivation || "",
        });
      })
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
      const listRes = await api.get(`/groups/list/${group.tournament_id}`);
      const myGroup = listRes.data.find((g) => g.id === group.id) || group;

      if (myGroup.players && myGroup.players.length > 0) {
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
        localStorage.setItem("activeGroup", JSON.stringify({ ...group, savedAt: Date.now() }));
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

      localStorage.setItem("activeGroup", JSON.stringify({ ...pendingGroup, savedAt: Date.now() }));
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

  const handleLogout = () => {
    // Limpa sessão de partida antes de sair — evita que outro usuário que
    // fizer login no mesmo dispositivo herde o activeGroup do anterior.
    if (activeSession) {
      clearMatchSession(activeSession.group.id, activeSession.group.tournament_id);
    }
    logout(navigate);
  };

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

  // ── Meu Perfil: salvar dados / foto ────────────────────────────────────────
  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg("");
    try {
      const res = await api.put("/users/me/profile", profileForm);
      setProfile((p) => ({ ...p, ...res.data }));
      // Nome corrigido precisa refletir no header e nas telas que leem o user do localStorage
      if (res.data.name && res.data.name !== user.name) {
        const updatedUser = { ...user, name: res.data.name };
        updateUser(updatedUser);
        setUser(updatedUser);
      }
      // Fecha o modal imediatamente após salvar — sem delay/mensagem intermediária.
      setProfileMsg("");
      setProfileOpen(false);
    } catch (e) {
      setProfileMsg(e.response?.data?.error || "Erro ao salvar perfil.");
    } finally {
      setProfileSaving(false);
    }
  };

  // Escolher arquivo NÃO envia mais direto: abre o enquadramento primeiro.
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reescolher o mesmo arquivo
    if (!file) return;
    setProfileMsg("");
    const reader = new FileReader();
    reader.onload = () => {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropAreaPx(null);
      setCropSrc(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Recorta a região confirmada num canvas 512x512 e devolve um blob JPEG.
  const buildCroppedBlob = (src, area) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas
          .getContext("2d")
          .drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Falha ao recortar a imagem."))),
          "image/jpeg",
          0.9
        );
      };
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = src;
    });

  const handleConfirmCrop = async () => {
    if (!cropSrc || !cropAreaPx) return;
    setPhotoUploading(true);
    setProfileMsg("");
    try {
      const blob = await buildCroppedBlob(cropSrc, cropAreaPx);
      const fd = new FormData();
      fd.append("photo", blob, "avatar.jpg");
      const res = await api.post("/users/me/photo", fd);
      setProfile((p) => ({ ...p, profile_photo_url: res.data.url }));
      setCropSrc(null);
    } catch (err) {
      setProfileMsg(err.response?.data?.error || err.message || "Erro ao enviar a foto.");
    } finally {
      setPhotoUploading(false);
    }
  };

  // ── Atalhos do grid (2 colunas) ────────────────────────────────────────────
  const shortcuts = [
    { icon: LuCalendarDays, label: "Reservar", onClick: () => navigate("/tee-times") },
    { icon: LuClipboardList, label: "Minhas Reservas", onClick: () => navigate("/my-bookings") },
    { icon: LuHistory, label: "Histórico", onClick: () => navigate("/player-history") },
    { icon: LuTarget, label: "Meu Desempenho", onClick: () => navigate("/my-performance") },
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
    menuBtn: {
      background: "none",
      border: `1px solid ${theme.border}`,
      borderRadius: radius.sm,
      padding: space[2],
      color: theme.textMain,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
    },
    dropdown: {
      position: "absolute",
      top: "calc(100% + 8px)",
      right: 0,
      backgroundColor: theme.card,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.md,
      boxShadow: shadow.lg,
      minWidth: 220,
      zIndex: 100,
      overflow: "hidden",
    },
    dropdownItem: {
      display: "flex",
      alignItems: "center",
      gap: space[3],
      width: "100%",
      padding: `${space[3]}px ${space[4]}px`,
      background: "none",
      border: "none",
      color: theme.textMain,
      cursor: "pointer",
      textAlign: "left",
      ...text.body,
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
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={styles.menuBtn}
            aria-label="Menu"
          >
            <LuMenu size={20} />
          </button>

          {menuOpen && (
            <>
              {/* Overlay invisível pra fechar o menu ao clicar fora */}
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
              />
              <div style={styles.dropdown}>
                <button
                  style={styles.dropdownItem}
                  onClick={() => { setMenuOpen(false); setProfileOpen(true); }}
                >
                  <LuUser size={18} color={theme.accent} />
                  Meu Perfil
                </button>
                {user.role === "ADMIN" && (
                  <button
                    style={styles.dropdownItem}
                    onClick={() => { setMenuOpen(false); navigate("/dashboard"); }}
                  >
                    <LuLayoutDashboard size={18} color={theme.accent} />
                    Painel do Organizador
                  </button>
                )}
                <button
                  style={{ ...styles.dropdownItem, color: theme.danger }}
                  onClick={handleLogout}
                >
                  <LuLogOut size={18} />
                  Sair da Conta
                </button>
              </div>
            </>
          )}
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
                  <h3 style={{ margin: 0, ...text.h3, color: theme.textMain }}>{t.name}</h3>
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

      {/* ── Modal: Meu Perfil ── */}
      {profileOpen && (
        <div style={styles.modalOverlay} onClick={() => setProfileOpen(false)}>
          <div style={{ ...styles.modalContent, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: `0 0 ${space[5]}px 0`, ...text.h2, color: theme.textMain, textAlign: "center" }}>
              Meu Perfil
            </h2>

            {/* Etapa de enquadramento: substitui o conteúdo do modal até confirmar/cancelar */}
            {cropSrc ? (
              <div>
                <p style={{ ...text.caption, color: theme.textMuted, textAlign: "center", margin: `0 0 ${space[3]}px 0` }}>
                  Arraste para posicionar e use o zoom para enquadrar
                </p>
                <div style={{ position: "relative", width: "100%", height: 280, borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.bg }}>
                  <Cropper
                    image={cropSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    cropShape="round"
                    showGrid={false}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_, areaPixels) => setCropAreaPx(areaPixels)}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: space[3], margin: `${space[4]}px 0` }}>
                  <LuZoomOut size={16} color={theme.textMuted} />
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    style={{ flex: 1, accentColor: theme.accent }}
                    aria-label="Zoom da foto"
                  />
                  <LuZoomIn size={16} color={theme.textMuted} />
                </div>

                <div style={{ display: "flex", gap: space[3] }}>
                  <button
                    onClick={() => setCropSrc(null)}
                    disabled={photoUploading}
                    style={{ ...styles.secondaryBtn, flex: 1 }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={handleConfirmCrop}
                    disabled={photoUploading || !cropAreaPx}
                    style={{ ...styles.primaryBtn, flex: 2, opacity: photoUploading ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: space[2] }}
                  >
                    <LuCheck size={16} />
                    {photoUploading ? "Enviando..." : "USAR FOTO"}
                  </button>
                </div>
                {profileMsg && (
                  <div style={{ ...text.caption, color: theme.danger, textAlign: "center", marginTop: space[3] }}>
                    {profileMsg}
                  </div>
                )}
              </div>
            ) : (
            <>
            {/* Foto */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: space[5] }}>
              <div style={{ position: "relative", width: 84, height: 84 }}>
                {profile?.profile_photo_url ? (
                  <img
                    src={mediaUrl(profile.profile_photo_url)}
                    alt="Foto de perfil"
                    style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover", border: `2px solid ${theme.border}` }}
                  />
                ) : (
                  <div style={{ width: 84, height: 84, borderRadius: "50%", backgroundColor: theme.bg, border: `2px dashed ${theme.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textMuted }}>
                    <LuUser size={34} />
                  </div>
                )}
                <label style={{
                  position: "absolute", bottom: -2, right: -2,
                  width: 30, height: 30, borderRadius: "50%",
                  backgroundColor: theme.accent, color: theme.accentContrast,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: photoUploading ? "wait" : "pointer",
                  border: `2px solid ${theme.card}`,
                }}>
                  <LuCamera size={15} />
                  <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={photoUploading} style={{ display: "none" }} />
                </label>
              </div>
              {photoUploading && (
                <div style={{ ...text.caption, color: theme.textMuted, marginTop: space[1] }}>Enviando foto...</div>
              )}
            </div>

            {/* Nome completo (editável — corrige cadastro errado) */}
            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              Nome completo
            </label>
            <input
              type="text"
              value={profileForm.name}
              onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={100}
              placeholder="Seu nome completo"
              style={{ width: "100%", boxSizing: "border-box", padding: space[3], borderRadius: radius.sm, border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.textMain, fontSize: 14, fontFamily: theme.font, marginBottom: space[4], outline: "none" }}
            />

            {/* Bio */}
            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              Bio
            </label>
            <textarea
              value={profileForm.bio}
              onChange={(e) => setProfileForm((f) => ({ ...f, bio: e.target.value }))}
              maxLength={150}
              placeholder="Uma linha sobre você"
              style={{ width: "100%", boxSizing: "border-box", padding: space[3], borderRadius: radius.sm, border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.textMain, minHeight: 56, resize: "vertical", fontFamily: theme.font, fontSize: 14 }}
            />
            <div style={{ ...text.caption, color: theme.textMuted, textAlign: "right", marginBottom: space[4] }}>
              {profileForm.bio.length}/150
            </div>

            {/* Redes sociais */}
            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              Instagram (opcional)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], border: `1px solid ${theme.border}`, borderRadius: radius.sm, backgroundColor: theme.bg, padding: `0 ${space[3]}px`, marginBottom: space[4] }}>
              <LuInstagram size={16} color={theme.textMuted} />
              <input
                type="text"
                value={profileForm.instagram_handle}
                onChange={(e) => setProfileForm((f) => ({ ...f, instagram_handle: e.target.value }))}
                maxLength={60}
                placeholder="seu.usuario"
                style={{ flex: 1, padding: `${space[3]}px 0`, border: "none", outline: "none", backgroundColor: "transparent", color: theme.textMain, fontSize: 14, fontFamily: theme.font }}
              />
            </div>

            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              WhatsApp (opcional)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], border: `1px solid ${theme.border}`, borderRadius: radius.sm, backgroundColor: theme.bg, padding: `0 ${space[3]}px`, marginBottom: space[4] }}>
              <LuMessageCircle size={16} color={theme.textMuted} />
              <input
                type="tel"
                value={profileForm.whatsapp_number}
                onChange={(e) => setProfileForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
                maxLength={20}
                placeholder="5511999998888"
                style={{ flex: 1, padding: `${space[3]}px 0`, border: "none", outline: "none", backgroundColor: "transparent", color: theme.textMain, fontSize: 14, fontFamily: theme.font }}
              />
            </div>

            {/* Motivação */}
            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              O que me motiva no golfe
            </label>
            <textarea
              value={profileForm.golf_motivation}
              onChange={(e) => setProfileForm((f) => ({ ...f, golf_motivation: e.target.value }))}
              maxLength={280}
              placeholder="Ex: superar meu próprio jogo a cada rodada"
              style={{ width: "100%", boxSizing: "border-box", padding: space[3], borderRadius: radius.sm, border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.textMain, minHeight: 72, resize: "vertical", fontFamily: theme.font, fontSize: 14 }}
            />
            <div style={{ ...text.caption, color: theme.textMuted, textAlign: "right", marginBottom: space[4] }}>
              {profileForm.golf_motivation.length}/280
            </div>

            {profileMsg && (
              <div style={{ ...text.caption, color: profileMsg === "Perfil salvo!" ? theme.accent : theme.danger, textAlign: "center", marginBottom: space[3] }}>
                {profileMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: space[3] }}>
              <button onClick={() => setProfileOpen(false)} style={{ ...styles.secondaryBtn, flex: 1 }}>
                FECHAR
              </button>
              <button onClick={handleSaveProfile} disabled={profileSaving} style={{ ...styles.primaryBtn, flex: 2, opacity: profileSaving ? 0.7 : 1 }}>
                {profileSaving ? "Salvando..." : "SALVAR PERFIL"}
              </button>
            </div>
            </>
            )}
          </div>
        </div>
      )}

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
                    src={selectedTournament.sponsors[currentSponsorIndex].image_url}
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
