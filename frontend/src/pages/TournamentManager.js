// frontend/src/pages/TournamentManager.js
import React, { useState, useEffect, useCallback, useMemo } from "react";
import api from "../services/api";
import { useParams, useNavigate } from "react-router-dom";
import { downloadFile } from "../services/download";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import {
  LuArrowLeft,
  LuClipboardList,
  LuFlag,
  LuPrinter,
  LuTrash2,
  LuUsers,
  LuPlus,
  LuX,
  LuSearch,
  LuCheck,
  LuKeyRound,
  LuUndo2,
  LuShuffle,
  LuClock,
  LuTrophy,
} from "react-icons/lu";

const TABS = [
  { key: "ALL",      label: "Todos" },
  { key: "PENDING",  label: "Pendentes" },
  { key: "APPROVED", label: "Aprovados" },
];

function TournamentManager() {
  const { id } = useParams();
  const navigate = useNavigate();
  const theme = useBirdifyTheme();

  const [groups, setGroups] = useState([]);
  const [inscriptions, setInscriptions] = useState([]);
  const [tournament, setTournament] = useState(null);

  const [tab, setTab] = useState("ALL");
  const [search, setSearch] = useState("");

  const [showManualModal, setShowManualModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [startingHole, setStartingHole] = useState(1);
  const [newGroupTeeTime, setNewGroupTeeTime] = useState("");

  const [addPlayerByGroup, setAddPlayerByGroup] = useState({});
  const [teeTimeDraft, setTeeTimeDraft] = useState({}); // { [groupId]: "HH:MM" } enquanto edita

  // Bloco D · commit 4: torneio multi-rodada — cada rodada tem seus proprios
  // grupos e codigos. activeRound=1 por default (torneio single-round nunca
  // mostra as pills). Fetch de grupos re-executa quando muda o round.
  const [activeRound, setActiveRound] = useState(1);
  const totalRounds = Number(tournament?.total_rounds) || 1;
  const isMultiRound = totalRounds > 1;

  const isTeeTime = tournament?.format === "tee_time";

  const fetchGroups = useCallback(async () => {
    try {
      // Passa ?round=N so pra torneio multi-rodada. Single-round preserva
      // o comportamento antigo (retorna tudo — na pratica so tem R1).
      const path = isMultiRound
        ? `/groups/list/${id}?round=${activeRound}`
        : `/groups/list/${id}`;
      const res = await api.get(path);
      setGroups(res.data);
    } catch (error) {
      console.error("Erro ao buscar grupos", error);
    }
  }, [id, activeRound, isMultiRound]);

  const fetchInscriptions = useCallback(async () => {
    try {
      const res = await api.get(`/inscriptions/list/${id}`);
      setInscriptions(res.data);
    } catch (error) {
      console.error("Erro ao buscar inscrições", error);
    }
  }, [id]);

  const fetchTournament = useCallback(async () => {
    try {
      const res = await api.get(`/tournaments/${id}`);
      setTournament(res.data);
    } catch (error) {
      console.error("Erro ao buscar torneio", error);
    }
  }, [id]);

  useEffect(() => {
    fetchGroups();
    fetchInscriptions();
    fetchTournament();
  }, [fetchGroups, fetchInscriptions, fetchTournament]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    if (isTeeTime && !newGroupTeeTime) {
      alert("Informe o horário do grupo.");
      return;
    }
    try {
      await api.post("/groups/create", {
        tournament_id: id,
        round_number: activeRound,
        group_name: newGroupName.trim(),
        starting_hole: isTeeTime ? 1 : startingHole,
        tee_time: isTeeTime ? newGroupTeeTime : null,
      });
      setNewGroupName("");
      setStartingHole(1);
      setNewGroupTeeTime("");
      setShowManualModal(false);
      fetchGroups();
    } catch (error) {
      alert(error.response?.data?.error || "Erro ao criar grupo");
    }
  };

  const handleSaveTeeTime = async (groupId, value) => {
    // Só persiste se mudou vs o valor original do grupo
    const current = (groups.find((g) => g.id === groupId)?.tee_time) || "";
    if (value === current) return;
    try {
      await api.put(`/groups/${groupId}`, { tee_time: value || null });
      fetchGroups();
    } catch (error) {
      alert(error.response?.data?.error || "Erro ao salvar horário.");
    }
  };

  const handleDeleteGroup = async (groupId, groupName) => {
    if (!window.confirm(`Deseja mesmo apagar o "${groupName}"?`)) return;
    try {
      await api.delete(`/groups/delete/${groupId}`);
      fetchGroups();
    } catch (error) {
      alert("Erro ao excluir grupo.");
    }
  };

  const handleAddPlayer = async (groupId) => {
    const userId = addPlayerByGroup[groupId];
    if (!userId) return;
    try {
      await api.post("/groups/add-player", { group_id: groupId, user_id: userId });
      setAddPlayerByGroup((s) => ({ ...s, [groupId]: "" }));
      fetchGroups();
    } catch (error) {
      alert("Erro ao adicionar jogador (talvez já esteja no grupo?)");
    }
  };

  const handleRemovePlayer = async (groupId, userId, playerName) => {
    if (!window.confirm(`Remover ${playerName} deste grupo?`)) return;
    try {
      await api.delete(`/groups/remove-player/${groupId}/${userId}`);
      fetchGroups();
    } catch (error) {
      alert("Erro ao remover jogador.");
    }
  };

  const generateAccessCode = async (groupId) => {
    try {
      await api.post("/groups/generate-code", { group_id: groupId });
      fetchGroups();
    } catch (error) {
      alert("Erro ao gerar código");
    }
  };

  const handleUpdateStatus = async (inscriptionId, newStatus, playerName) => {
    const msg = {
      APPROVED: `Aprovar a inscrição de ${playerName}?`,
      REJECTED: `Recusar a inscrição de ${playerName}?`,
      PENDING:  `Reverter ${playerName} para pendente?`,
    }[newStatus];
    if (msg && !window.confirm(msg)) return;
    try {
      await api.put(`/inscriptions/update-status/${inscriptionId}`, { status: newStatus });
      fetchInscriptions();
    } catch (error) {
      alert("Erro ao atualizar status.");
    }
  };

  const handleAutoGenerate = async () => {
    const total = approvedPlayers.length;
    if (total === 0) {
      alert("Aprove atletas antes de gerar flights.");
      return;
    }
    const nFlights = Math.ceil(total / 4);

    // No modo tee time, pergunta o intervalo antes do confirm de sobrescrita.
    let intervalMinutes = null;
    if (isTeeTime) {
      const raw = window.prompt(
        "Intervalo entre grupos em minutos (padrão 10):",
        "10"
      );
      if (raw === null) return; // cancelou
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) {
        alert("Intervalo inválido. Use um número entre 1 e 60.");
        return;
      }
      intervalMinutes = parsed;
    }

    const roundLabel = isMultiRound ? `da R${activeRound}` : "";
    const baseMsg = isTeeTime
      ? `Sortear ${total} atleta(s) em ${nFlights} flight(s) ${roundLabel}, com ${intervalMinutes} min entre cada um. Todos saem do buraco 1.`
      : `Sortear ${total} atleta(s) em ${nFlights} flight(s) ${roundLabel} de até 4. Cada grupo em um buraco (1, 2, 3…).`;
    const msg = groups.length > 0
      ? `Isso vai APAGAR ${groups.length} flight(s) existente(s)${isMultiRound ? ` da R${activeRound}` : ""}. ${baseMsg} Continuar?`
      : `${baseMsg} Continuar?`;
    if (!window.confirm(msg)) return;

    try {
      const payload = { tournament_id: id, round_number: activeRound };
      if (isTeeTime) payload.interval_minutes = intervalMinutes;
      await api.post("/groups/auto-generate", payload);
      fetchGroups();
    } catch (error) {
      alert(error.response?.data?.error || "Erro ao gerar flights.");
    }
  };

  // Bloco D · commit 4: re-seeding automatico da rodada atual pela
  // classificacao da rodada anterior. So aparece se activeRound >= 2 —
  // R1 nao tem "rodada anterior" pra rankear.
  const handleGenerateFromStandings = async () => {
    if (activeRound < 2) return;
    const prev = activeRound - 1;

    let intervalMinutes = null;
    if (isTeeTime) {
      const raw = window.prompt(`Intervalo entre grupos em minutos (padrão 10):`, "10");
      if (raw === null) return;
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) {
        alert("Intervalo inválido. Use um número entre 1 e 60.");
        return;
      }
      intervalMinutes = parsed;
    }

    const warn = groups.length > 0
      ? `Isso vai APAGAR ${groups.length} flight(s) da R${activeRound}. `
      : "";
    if (!window.confirm(
      `${warn}Gerar grupos da R${activeRound} pela classificacao da R${prev} (melhor gross → grupo 1, proximos 4 → grupo 2...). So entra quem completou os buracos da R${prev}. Continuar?`
    )) return;

    try {
      const payload = { tournament_id: id, round_number: activeRound };
      if (isTeeTime) payload.interval_minutes = intervalMinutes;
      const res = await api.post("/groups/generate-from-standings", payload);
      alert(`R${activeRound} gerada: ${res.data.groups_created} flight(s) com ${res.data.players_seeded} jogador(es) que completaram R${prev}.`);
      fetchGroups();
    } catch (error) {
      alert(error.response?.data?.error || "Erro no re-seeding.");
    }
  };

  const handleExportExcel = async () => {
    if (groups.length === 0) {
      alert("Não há grupos criados para exportar.");
      return;
    }
    try {
      await downloadFile(`/groups/export/${id}`, `grupos_torneio_${id}.xlsx`);
    } catch {
      alert("Erro ao exportar. Confira se você está logado como administrador do clube.");
    }
  };

  const counts = useMemo(() => ({
    ALL:      inscriptions.length,
    PENDING:  inscriptions.filter((i) => i.status === "PENDING").length,
    APPROVED: inscriptions.filter((i) => i.status === "APPROVED").length,
  }), [inscriptions]);

  const visibleInscriptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inscriptions.filter((i) => {
      if (tab === "PENDING"  && i.status !== "PENDING")  return false;
      if (tab === "APPROVED" && i.status !== "APPROVED") return false;
      if (q && !(i.player_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [inscriptions, tab, search]);

  const approvedPlayers = useMemo(
    () => inscriptions.filter((i) => i.status === "APPROVED"),
    [inscriptions]
  );

  // ── estilos ──────────────────────────────────────────────────────────────
  const s = {
    container: {
      padding: theme.space[5],
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      fontFamily: theme.font,
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.space[5],
    },
    backBtn: {
      backgroundColor: "transparent",
      color: theme.textMuted,
      border: "none",
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      cursor: "pointer",
      borderRadius: theme.radius.sm,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: theme.space[2],
      fontSize: 13,
    },
    section: {
      backgroundColor: theme.card,
      padding: theme.space[5],
      borderRadius: theme.radius.md,
      marginBottom: theme.space[5],
      border: `1px solid ${theme.border}`,
      boxShadow: theme.shadow.sm,
    },
    sectionTitle: {
      ...theme.text.h3,
      color: theme.textMain,
      margin: 0,
      display: "flex",
      alignItems: "center",
      gap: theme.space[2],
    },
    // ── busca ──────────────────────────────────────────────────────────────
    searchWrap: {
      position: "relative",
      marginTop: theme.space[4],
      marginBottom: theme.space[3],
    },
    searchIcon: {
      position: "absolute",
      left: theme.space[3],
      top: "50%",
      transform: "translateY(-50%)",
      color: theme.textMuted,
      pointerEvents: "none",
    },
    searchInput: {
      width: "100%",
      padding: `${theme.space[3]}px ${theme.space[3]}px ${theme.space[3]}px ${theme.space[6]}px`,
      borderRadius: theme.radius.sm,
      border: `1px solid ${theme.border}`,
      backgroundColor: theme.bg,
      color: theme.textMain,
      outline: "none",
      fontSize: 14,
      boxSizing: "border-box",
      fontFamily: theme.font,
    },
    // ── abas pill ──────────────────────────────────────────────────────────
    tabs: {
      display: "flex",
      gap: theme.space[2],
      marginBottom: theme.space[4],
      flexWrap: "wrap",
    },
    tab: (active) => ({
      padding: `${theme.space[2]}px ${theme.space[4]}px`,
      borderRadius: theme.radius.pill,
      border: `1px solid ${active ? "transparent" : theme.border}`,
      backgroundColor: active ? theme.accentSoft : "transparent",
      color: active ? theme.accent : theme.textMuted,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: theme.space[2],
      fontFamily: theme.font,
    }),
    tabCount: (active) => ({
      backgroundColor: active ? "transparent" : theme.cardLight,
      color: active ? theme.accent : theme.textMuted,
      padding: "1px 8px",
      borderRadius: theme.radius.pill,
      fontSize: 11,
      fontWeight: 800,
    }),
    // ── lista de inscritos ─────────────────────────────────────────────────
    inscRow: {
      display: "flex",
      alignItems: "center",
      gap: theme.space[3],
      padding: theme.space[3],
      borderTop: `1px solid ${theme.border}`,
    },
    inscInfo: { flex: 1, minWidth: 0 },
    inscName: {
      ...theme.text.body,
      fontWeight: 700,
      color: theme.textMain,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    inscCategory: {
      ...theme.text.caption,
      color: theme.textMuted,
      marginTop: 2,
    },
    inscActions: {
      display: "flex",
      alignItems: "center",
      gap: theme.space[2],
      flexShrink: 0,
    },
    pillBadge: (kind) => {
      const map = {
        APPROVED: { bg: theme.accentSoft, fg: theme.accent },
        PENDING:  { bg: "rgba(234,179,8,0.15)", fg: theme.gold },
        REJECTED: { bg: "rgba(239,68,68,0.15)", fg: theme.danger },
      }[kind] || { bg: theme.cardLight, fg: theme.textMuted };
      return {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: `${theme.space[1]}px ${theme.space[3]}px`,
        borderRadius: theme.radius.pill,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.5,
        backgroundColor: map.bg,
        color: map.fg,
      };
    },
    btnPrimary: {
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      backgroundColor: theme.accent,
      color: theme.accentContrast,
      border: "none",
      borderRadius: theme.radius.sm,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      minWidth: 90,
      justifyContent: "center",
      fontFamily: theme.font,
    },
    btnDangerOutline: {
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      backgroundColor: "transparent",
      color: theme.danger,
      border: `1px solid ${theme.danger}`,
      borderRadius: theme.radius.sm,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      minWidth: 90,
      justifyContent: "center",
      fontFamily: theme.font,
    },
    btnGhost: {
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      backgroundColor: "transparent",
      color: theme.textMuted,
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radius.sm,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      minWidth: 90,
      justifyContent: "center",
      fontFamily: theme.font,
    },
    emptyList: {
      color: theme.textMuted,
      textAlign: "center",
      padding: theme.space[5],
      fontSize: 13,
    },
    // ── toolbar de grupos ──────────────────────────────────────────────────
    toolbar: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: theme.space[3],
      marginBottom: theme.space[5],
    },
    toolbarBtn: {
      backgroundColor: theme.bg,
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radius.sm,
      padding: theme.space[4],
      cursor: "pointer",
      color: theme.textMain,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: theme.space[2],
      fontWeight: 700,
      fontSize: 13,
      fontFamily: theme.font,
      transition: "background-color 120ms",
    },
    // ── card de grupo ──────────────────────────────────────────────────────
    groupCard: {
      backgroundColor: theme.cardLight,
      padding: theme.space[4],
      marginBottom: theme.space[4],
      borderRadius: theme.radius.md,
      border: `1px solid ${theme.border}`,
    },
    groupHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.space[3],
      marginBottom: theme.space[4],
    },
    holePill: {
      display: "inline-flex",
      alignItems: "center",
      padding: `2px ${theme.space[2]}px`,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.bg,
      color: theme.textMain,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: 0.5,
      border: `1px solid ${theme.border}`,
    },
    iconBtn: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.sm,
      border: `1px solid ${theme.border}`,
      backgroundColor: "transparent",
      color: theme.textMain,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    },
    accessChip: {
      display: "inline-flex",
      alignItems: "center",
      gap: theme.space[2],
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      backgroundColor: theme.bg,
      color: theme.accent,
      borderRadius: theme.radius.sm,
      border: `1px solid ${theme.border}`,
      fontFamily: "monospace",
      fontSize: 14,
      fontWeight: 800,
      letterSpacing: 1,
    },
    btnSecondary: {
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      backgroundColor: theme.bg,
      color: theme.textMain,
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radius.sm,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: theme.space[2],
      fontFamily: theme.font,
    },
    playerLine: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: `${theme.space[2]}px ${theme.space[3]}px`,
      backgroundColor: theme.bg,
      borderRadius: theme.radius.sm,
      marginBottom: theme.space[2],
      border: `1px solid ${theme.border}`,
    },
    playerName: {
      ...theme.text.body,
      color: theme.textMain,
      display: "inline-flex",
      alignItems: "center",
      gap: theme.space[2],
    },
    addRow: {
      marginTop: theme.space[4],
      paddingTop: theme.space[4],
      borderTop: `1px solid ${theme.border}`,
      display: "flex",
      gap: theme.space[2],
      alignItems: "stretch",
    },
    addSelect: {
      flex: 1,
      padding: `${theme.space[3]}px`,
      borderRadius: theme.radius.sm,
      border: `1px solid ${theme.border}`,
      backgroundColor: theme.bg,
      color: theme.textMain,
      cursor: "pointer",
      fontSize: 13,
      fontFamily: theme.font,
      minWidth: 0,
    },
    addBtn: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.sm,
      border: "none",
      backgroundColor: theme.accent,
      color: theme.accentContrast,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    // ── modal ──────────────────────────────────────────────────────────────
    modalBackdrop: {
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      padding: theme.space[4],
    },
    modal: {
      backgroundColor: theme.card,
      borderRadius: theme.radius.md,
      border: `1px solid ${theme.border}`,
      boxShadow: theme.shadow.lg,
      padding: theme.space[5],
      width: "100%",
      maxWidth: 420,
    },
    modalHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.space[4],
    },
    modalTitle: { ...theme.text.h3, margin: 0, color: theme.textMain },
    label: {
      ...theme.text.overline,
      color: theme.textMuted,
      display: "block",
      marginBottom: theme.space[1],
    },
    field: { marginBottom: theme.space[4] },
    input: {
      width: "100%",
      padding: theme.space[3],
      borderRadius: theme.radius.sm,
      border: `1px solid ${theme.border}`,
      backgroundColor: theme.bg,
      color: theme.textMain,
      outline: "none",
      fontSize: 14,
      boxSizing: "border-box",
      fontFamily: theme.font,
    },
    ctaFull: {
      width: "100%",
      padding: `${theme.space[3]}px`,
      backgroundColor: theme.accent,
      color: theme.accentContrast,
      border: "none",
      borderRadius: theme.radius.sm,
      cursor: "pointer",
      fontWeight: 800,
      fontSize: 14,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space[2],
      fontFamily: theme.font,
    },
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h1 style={{ ...theme.text.h1, margin: 0 }}>Birdify Admin</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Onda B · Commit 3.9: torneios doubles mostram atalho pra
              AdminDuplasManager (rota /admin/torneio/:id/duplas). */}
          {tournament?.modality === 'doubles' && (
            <button
              onClick={() => navigate(`/admin/torneio/${id}/duplas`)}
              style={{ ...s.backBtn, backgroundColor: theme.accent, color: '#000' }}
              className="tm-tap"
            >
              Gerenciar Duplas
            </button>
          )}
          <button onClick={() => navigate("/dashboard")} style={s.backBtn} className="tm-tap">
            <LuArrowLeft size={15} />
            Voltar ao Painel
          </button>
        </div>
      </div>

      {/* ═══ SEÇÃO 1 · INSCRITOS ═══════════════════════════════════════════ */}
      <div style={s.section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: theme.space[2] }}>
          <h3 style={s.sectionTitle}>
            <LuClipboardList size={18} />
            Inscrições e Atletas
          </h3>
          <span style={{ ...theme.text.caption, color: theme.textMuted }}>
            {inscriptions.length} {inscriptions.length === 1 ? "jogador inscrito" : "jogadores inscritos"}
          </span>
        </div>

        {/* Busca */}
        <div style={s.searchWrap}>
          <LuSearch size={16} style={s.searchIcon} />
          <input
            type="text"
            placeholder="Buscar por nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={s.searchInput}
          />
        </div>

        {/* Abas pill */}
        <div style={s.tabs}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={s.tab(active)}
                className="tm-tap"
              >
                {t.label}
                <span style={s.tabCount(active)}>{counts[t.key]}</span>
              </button>
            );
          })}
        </div>

        {/* Lista */}
        {inscriptions.length === 0 ? (
          <div style={s.emptyList}>Nenhum jogador inscrito até o momento.</div>
        ) : visibleInscriptions.length === 0 ? (
          <div style={s.emptyList}>
            {search
              ? `Nenhum resultado para "${search}".`
              : "Nenhum jogador nesta aba."}
          </div>
        ) : (
          <div>
            {visibleInscriptions.map((insc) => (
              <div key={insc.id} style={s.inscRow}>
                <div style={s.inscInfo}>
                  <div style={s.inscName}>{insc.player_name}</div>
                  {insc.category_name && (
                    <div style={s.inscCategory}>{insc.category_name}</div>
                  )}
                </div>
                <div style={s.inscActions}>
                  {insc.status === "APPROVED" && (
                    <>
                      <span style={s.pillBadge("APPROVED")}>
                        <LuCheck size={11} /> APROVADO
                      </span>
                      <button
                        onClick={() => handleUpdateStatus(insc.id, "PENDING", insc.player_name)}
                        style={s.btnGhost}
                        className="tm-tap"
                        title="Voltar para pendente"
                      >
                        <LuUndo2 size={12} /> Reverter
                      </button>
                    </>
                  )}
                  {insc.status === "PENDING" && (
                    <>
                      <span style={s.pillBadge("PENDING")}>PENDENTE</span>
                      <button
                        onClick={() => handleUpdateStatus(insc.id, "APPROVED", insc.player_name)}
                        style={s.btnPrimary}
                        className="tm-tap"
                      >
                        Aprovar
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(insc.id, "REJECTED", insc.player_name)}
                        style={s.btnDangerOutline}
                        className="tm-tap"
                      >
                        Recusar
                      </button>
                    </>
                  )}
                  {insc.status === "REJECTED" && (
                    <>
                      <span style={s.pillBadge("REJECTED")}>RECUSADO</span>
                      <button
                        onClick={() => handleUpdateStatus(insc.id, "PENDING", insc.player_name)}
                        style={s.btnGhost}
                        className="tm-tap"
                        title="Voltar para pendente"
                      >
                        <LuUndo2 size={12} /> Reverter
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ SEÇÃO 2 · GRUPOS ══════════════════════════════════════════════ */}
      <div style={s.section}>
        <div style={{ marginBottom: theme.space[4] }}>
          <h3 style={s.sectionTitle}>
            <LuFlag size={18} />
            Montagem dos Flights
          </h3>
        </div>

        {/* Bloco D · commit 4: pills de rodada — so em torneio multi-rodada.
            Cada rodada tem seus proprios grupos e codigos (Opcao B do Item 4). */}
        {isMultiRound && (
          <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ ...theme.text.caption, color: theme.textMuted, marginRight: theme.space[2] }}>RODADA:</span>
            {Array.from({ length: totalRounds }, (_, i) => i + 1).map(rn => {
              const active = rn === activeRound;
              return (
                <button
                  key={rn}
                  onClick={() => setActiveRound(rn)}
                  className="tm-tap"
                  style={{
                    padding: `${theme.space[2]}px ${theme.space[4]}px`,
                    borderRadius: theme.radius.pill,
                    border: `1px solid ${active ? "transparent" : theme.border}`,
                    backgroundColor: active ? theme.accent : "transparent",
                    color: active ? theme.accentContrast : theme.textMuted,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  R{rn}
                </button>
              );
            })}
          </div>
        )}

        {/* CTA principal — sorteio automatico (aleatorio) da rodada atual.
            Em torneios multi-rodada, esse botao SO faz sentido pra R1 —
            R2+ deveria usar o re-seeding pela classificacao. Mantido em R2+
            como fallback caso o admin queira sortear do zero mesmo assim. */}
        <button
          onClick={handleAutoGenerate}
          style={{ ...s.ctaFull, marginBottom: theme.space[3] }}
          className="tm-tap"
          disabled={approvedPlayers.length === 0}
          title={approvedPlayers.length === 0 ? "Aprove atletas primeiro" : `Sortear aprovados em flights de 4${isMultiRound ? ` na R${activeRound}` : ""}`}
        >
          <LuShuffle size={16} />
          Sortear Flights Aleatorios{isMultiRound ? ` (R${activeRound})` : ""} ({approvedPlayers.length})
        </button>

        {/* CTA de re-seeding pela classificacao — so aparece em R2+ */}
        {isMultiRound && activeRound >= 2 && (
          <button
            onClick={handleGenerateFromStandings}
            style={{ ...s.ctaFull, backgroundColor: theme.gold, marginBottom: theme.space[3] }}
            className="tm-tap"
            title={`Gerar grupos da R${activeRound} pela classificacao da R${activeRound - 1}`}
          >
            <LuTrophy size={16} />
            Re-seed R{activeRound} pela Classificacao da R{activeRound - 1}
          </button>
        )}

        {/* Toolbar (2 ações) */}
        <div style={s.toolbar}>
          <button
            onClick={() => setShowManualModal(true)}
            style={s.toolbarBtn}
            className="tm-tap"
          >
            <LuUsers size={22} color={theme.accent} />
            <span>Grupo Manual</span>
          </button>
          <button onClick={handleExportExcel} style={s.toolbarBtn} className="tm-tap">
            <LuPrinter size={22} color={theme.accent} />
            <span>Imprimir</span>
          </button>
        </div>

        {/* Cards de grupo */}
        {groups.length === 0 ? (
          <div style={s.emptyList}>Nenhum flight criado ainda.</div>
        ) : (
          groups.map((group) => {
            const selected = addPlayerByGroup[group.id] || "";
            const groupPlayerIds = new Set((group.players || []).map((p) => p.id));
            const optionsFor = approvedPlayers.filter((i) => !groupPlayerIds.has(i.user_id));
            return (
              <div key={group.id} style={s.groupCard}>
                {/* Header */}
                <div style={s.groupHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], flexWrap: "wrap" }}>
                    <h3 style={{ ...theme.text.h3, margin: 0, color: theme.textMain }}>
                      {group.group_name}
                    </h3>
                    {isTeeTime ? (
                      <label
                        title="Horário de saída — editável"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.pill, backgroundColor: theme.bg, border: `1px solid ${theme.border}`, color: theme.textMain, fontSize: 12, fontWeight: 800 }}
                      >
                        <LuClock size={12} color={theme.accent} />
                        <input
                          type="time"
                          value={teeTimeDraft[group.id] ?? group.tee_time ?? ""}
                          onChange={(e) => setTeeTimeDraft((d) => ({ ...d, [group.id]: e.target.value }))}
                          onBlur={(e) => handleSaveTeeTime(group.id, e.target.value)}
                          style={{ background: "transparent", border: "none", outline: "none", color: theme.textMain, fontSize: 12, fontWeight: 800, fontFamily: "monospace", padding: 0, width: 68 }}
                        />
                      </label>
                    ) : (
                      <span style={s.holePill}>HOLE {group.starting_hole}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
                    {group.access_code ? (
                      <span style={s.accessChip} title="Código de acesso">
                        <LuKeyRound size={12} />
                        {group.access_code}
                      </span>
                    ) : (
                      <button
                        onClick={() => generateAccessCode(group.id)}
                        style={s.btnSecondary}
                        className="tm-tap"
                      >
                        <LuKeyRound size={13} />
                        Gerar código
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteGroup(group.id, group.group_name)}
                      style={s.iconBtn}
                      className="tm-tap"
                      title="Excluir grupo"
                    >
                      <LuTrash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Jogadores */}
                {group.players && group.players.length > 0 ? (
                  <div>
                    {group.players.map((p) => (
                      <div key={p.id} style={s.playerLine}>
                        <span style={s.playerName}>{p.name}</span>
                        <button
                          onClick={() => handleRemovePlayer(group.id, p.id, p.name)}
                          style={{ ...s.iconBtn, width: 28, height: 28 }}
                          className="tm-tap"
                          title="Remover jogador"
                        >
                          <LuX size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ ...s.emptyList, padding: theme.space[3], textAlign: "left", fontStyle: "italic" }}>
                    Nenhum jogador escalado para este flight.
                  </div>
                )}

                {/* Adicionar jogador */}
                <div style={s.addRow}>
                  <select
                    style={s.addSelect}
                    value={selected}
                    onChange={(e) =>
                      setAddPlayerByGroup((sMap) => ({ ...sMap, [group.id]: e.target.value }))
                    }
                  >
                    <option value="">Adicionar jogador aprovado…</option>
                    {optionsFor.map((insc) => (
                      <option key={insc.user_id} value={insc.user_id}>
                        {insc.player_name}
                        {insc.category_name ? ` (${insc.category_name})` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleAddPlayer(group.id)}
                    style={s.addBtn}
                    className="tm-tap"
                    title="Adicionar ao flight"
                    disabled={!selected}
                  >
                    <LuPlus size={18} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .tm-tap {
          transition: transform 120ms ease, background-color 160ms ease, border-color 160ms ease, filter 160ms ease, box-shadow 160ms ease;
        }
        .tm-tap:hover:not(:disabled) { filter: brightness(1.08); }
        .tm-tap:active:not(:disabled) { transform: scale(0.97); }
        .tm-tap:disabled { opacity: 0.5; cursor: not-allowed; }
        .tm-tap:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px ${theme.accentSoft};
        }
      `}</style>

      {/* ═══ MODAL · GRUPO MANUAL ══════════════════════════════════════════ */}
      {showManualModal && (
        <div
          style={s.modalBackdrop}
          onClick={(e) => { if (e.target === e.currentTarget) setShowManualModal(false); }}
        >
          <form style={s.modal} onSubmit={handleCreateGroup}>
            <div style={s.modalHeader}>
              <h3 style={s.modalTitle}>
                Novo flight manual{isMultiRound ? ` — R${activeRound}` : ""}
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                style={s.iconBtn}
                className="tm-tap"
                title="Fechar"
              >
                <LuX size={15} />
              </button>
            </div>

            <div style={s.field}>
              <label style={s.label}>Nome do grupo</label>
              <input
                type="text"
                placeholder="Ex: Grupo 01 - Manhã"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                style={s.input}
                autoFocus
              />
            </div>

            {isTeeTime ? (
              <div style={s.field}>
                <label style={s.label}>Horário de saída</label>
                <input
                  type="time"
                  value={newGroupTeeTime}
                  onChange={(e) => setNewGroupTeeTime(e.target.value)}
                  style={s.input}
                />
                <div style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }}>
                  Todos os grupos saem do buraco 1 neste torneio.
                </div>
              </div>
            ) : (
              <div style={s.field}>
                <label style={s.label}>Buraco de saída</label>
                <input
                  type="number"
                  min={1}
                  max={18}
                  value={startingHole}
                  onChange={(e) => setStartingHole(e.target.value)}
                  style={s.input}
                />
              </div>
            )}

            <button type="submit" style={s.ctaFull} className="tm-tap" disabled={!newGroupName.trim() || (isTeeTime && !newGroupTeeTime)}>
              <LuPlus size={16} />
              Criar flight
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default TournamentManager;
