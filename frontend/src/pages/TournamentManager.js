// frontend/src/pages/TournamentManager.js
import React, { useState, useEffect, useCallback } from "react";
import api from "../services/api"; // Ajuste o caminho se necessário
import { useParams, useNavigate } from "react-router-dom";

function TournamentManager() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [groups, setGroups] = useState([]);
  const [inscriptions, setInscriptions] = useState([]);

  const [newGroupName, setNewGroupName] = useState("");
  const [startingHole, setStartingHole] = useState(1);

  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");

  // TEMA PADRONIZADO BIRDIFY
  const theme = {
    bg: "#0f172a",
    card: "#1e293b",
    cardLight: "#334155",
    accent: "#22c55e",
    gold: "#eab308",
    blue: "#3b82f6",
    cyan: "#06b6d4",
    textMain: "#f8fafc",
    textMuted: "#94a3b8",
    danger: "#ef4444",
  };

  const fetchGroups = useCallback(async () => {
    try {
      const res = await api.get(`/groups/list/${id}`);
      setGroups(res.data);
    } catch (error) {
      console.error("Erro ao buscar grupos", error);
    }
  }, [id]);

  const fetchInscriptions = useCallback(async () => {
    try {
      const res = await api.get(`/inscriptions/list/${id}`);
      setInscriptions(res.data);
    } catch (error) {
      console.error("Erro ao buscar inscrições", error);
    }
  }, [id]);

  useEffect(() => {
    fetchGroups();
    fetchInscriptions();
  }, [fetchGroups, fetchInscriptions]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    try {
      await api.post("/groups/create", {
        tournament_id: id,
        group_name: newGroupName,
        starting_hole: startingHole,
      });
      alert("Grupo criado!");
      setNewGroupName("");
      fetchGroups();
    } catch (error) {
      alert("Erro ao criar grupo");
    }
  };

  const handleDeleteGroup = async (groupId, groupName) => {
    if (window.confirm(`Deseja mesmo apagar o "${groupName}"?`)) {
      try {
        await api.delete(`/groups/delete/${groupId}`);
        fetchGroups();
      } catch (error) {
        alert("Erro ao excluir grupo.");
      }
    }
  };

  const handleAddPlayer = async (groupId) => {
    if (!selectedPlayerId) {
      alert("Selecione um jogador na lista.");
      return;
    }
    try {
      await api.post("/groups/add-player", {
        group_id: groupId,
        user_id: selectedPlayerId,
      });
      alert("Jogador adicionado!");
      setSelectedPlayerId("");
      fetchGroups();
    } catch (error) {
      alert("Erro ao adicionar jogador (talvez já esteja no grupo?)");
    }
  };

  const handleRemovePlayer = async (groupId, userId, playerName) => {
    if (window.confirm(`Remover ${playerName} deste grupo?`)) {
      try {
        await api.delete(`/groups/remove-player/${groupId}/${userId}`);
        fetchGroups();
      } catch (error) {
        alert("Erro ao remover jogador.");
      }
    }
  };

  const generateAccessCode = async (groupId) => {
    try {
      const res = await api.post("/groups/generate-code", {
        group_id: groupId,
      });
      alert(`Código Gerado: ${res.data.access_code}`);
      fetchGroups();
    } catch (error) {
      alert("Erro ao gerar código");
    }
  };

  const handleUpdateStatus = async (inscriptionId, newStatus) => {
    try {
      await api.put(`/inscriptions/update-status/${inscriptionId}`, {
        status: newStatus,
      });
      fetchInscriptions();
    } catch (error) {
      alert("Erro ao atualizar status.");
    }
  };

  // --- NOVA FUNÇÃO BIRDIFY: EXPORTAR PARA EXCEL (Draw de Saídas) ---
  const handleExportExcel = () => {
    if (groups.length === 0) {
      alert("Não há grupos criados para exportar.");
      return;
    }

    // Agora o Frontend não faz mais o trabalho pesado!
    // Ele só pede para o Backend gerar e baixar a planilha formatada:
    window.open(`http://localhost:3001/api/groups/export/${id}`, "_blank");
  };

  const approvedPlayers = inscriptions.filter((i) => i.status === "APPROVED");

  const styles = {
    container: {
      padding: "30px",
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      fontFamily: "'Inter', sans-serif",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "30px",
    },
    backBtn: {
      backgroundColor: "transparent",
      color: theme.textMuted,
      border: `1px solid ${theme.cardLight}`,
      padding: "10px 20px",
      cursor: "pointer",
      borderRadius: "8px",
      fontWeight: "bold",
    },
    section: {
      backgroundColor: theme.card,
      padding: "25px",
      borderRadius: "16px",
      marginBottom: "30px",
      border: `1px solid ${theme.cardLight}`,
      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
    },
    input: {
      padding: "12px",
      borderRadius: "8px",
      border: `1px solid ${theme.cardLight}`,
      backgroundColor: theme.bg,
      color: "white",
      outline: "none",
    },
    select: {
      padding: "12px",
      borderRadius: "8px",
      border: `2px solid ${theme.cardLight}`,
      backgroundColor: theme.bg,
      color: "white",
      cursor: "pointer",
      minWidth: "240px",
    },
    button: {
      padding: "12px 20px",
      backgroundColor: theme.accent,
      color: "#000",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontWeight: "bold",
    },
    btnExport: {
      padding: "10px 18px",
      backgroundColor: "transparent",
      color: theme.gold,
      border: `1px solid ${theme.gold}`,
      borderRadius: "8px",
      cursor: "pointer",
      fontWeight: "bold",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    groupCard: {
      backgroundColor: theme.cardLight,
      padding: "20px",
      marginTop: "20px",
      borderRadius: "12px",
      borderLeft: `6px solid ${theme.gold}`,
    },
    playerBadge: {
      display: "inline-flex",
      alignItems: "center",
      backgroundColor: theme.bg,
      padding: "8px 15px",
      margin: "5px",
      borderRadius: "10px",
      fontSize: "14px",
      border: `1px solid ${theme.cardLight}`,
    },
    codeBox: {
      display: "inline-block", // 👈 A MÁGICA: Transforma o texto em um bloco firme
      marginTop: "4px", // 👈 Dá um respiro para desgrudar do título em cima
      backgroundColor: "#000",
      color: theme.accent,
      padding: "8px 12px",
      fontFamily: "monospace",
      borderRadius: "6px",
      fontSize: "16px",
      fontWeight: "bold",
      border: `1px solid ${theme.accent}`,
    },
    table: { width: "100%", borderCollapse: "collapse", marginTop: "15px" },
    th: {
      textAlign: "left",
      padding: "12px",
      color: theme.textMuted,
      fontSize: "12px",
      textTransform: "uppercase",
      letterSpacing: "1px",
    },
    td: { padding: "15px", borderBottom: `1px solid ${theme.cardLight}` },
    statusBadge: (status) => ({
      padding: "4px 10px",
      borderRadius: "6px",
      fontSize: "11px",
      fontWeight: "900",
      backgroundColor:
        status === "APPROVED"
          ? "rgba(34, 197, 94, 0.2)"
          : status === "REJECTED"
            ? "rgba(239, 68, 68, 0.2)"
            : "rgba(234, 179, 8, 0.2)",
      color:
        status === "APPROVED"
          ? theme.accent
          : status === "REJECTED"
            ? theme.danger
            : theme.gold,
      border: `1px solid ${status === "APPROVED" ? theme.accent : status === "REJECTED" ? theme.danger : theme.gold}`,
    }),
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>Birdify Admin</h1>
        <button onClick={() => navigate("/dashboard")} style={styles.backBtn}>
          ⬅ Voltar ao Painel
        </button>
      </div>

      {/* SEÇÃO DE INSCRIÇÕES */}
      <div style={{ ...styles.section, borderTop: `4px solid ${theme.cyan}` }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3 style={{ marginTop: 0, color: theme.cyan, letterSpacing: "1px" }}>
            📋 INSCRIÇÕES E ATLETAS
          </h3>
          <span style={{ fontSize: "12px", color: theme.textMuted }}>
            {inscriptions.length} jogadores inscritos
          </span>
        </div>

        {inscriptions.length === 0 ? (
          <p
            style={{
              color: theme.textMuted,
              textAlign: "center",
              padding: "20px",
            }}
          >
            Nenhum jogador inscrito até o momento.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Jogador</th>
                  <th style={styles.th}>Categoria</th>
                  <th style={styles.th}>Status</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>
                    Ações Rápidas
                  </th>
                </tr>
              </thead>
              <tbody>
                {inscriptions.map((insc) => (
                  <tr key={insc.id}>
                    <td style={styles.td}>
                      <strong style={{ fontSize: "16px" }}>
                        {insc.player_name}
                      </strong>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: theme.textMuted }}>
                        {insc.category_name}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.statusBadge(insc.status)}>
                        {insc.status === "APPROVED"
                          ? "APROVADO"
                          : insc.status === "REJECTED"
                            ? "RECUSADO"
                            : "PENDENTE"}
                      </span>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {insc.status !== "APPROVED" && (
                        <button
                          onClick={() =>
                            handleUpdateStatus(insc.id, "APPROVED")
                          }
                          style={{
                            ...styles.button,
                            backgroundColor: theme.accent,
                            padding: "8px 12px",
                            marginRight: "8px",
                            fontSize: "12px",
                          }}
                        >
                          Aprovar
                        </button>
                      )}
                      {insc.status !== "REJECTED" && (
                        <button
                          onClick={() =>
                            handleUpdateStatus(insc.id, "REJECTED")
                          }
                          style={{
                            ...styles.button,
                            backgroundColor: "transparent",
                            border: `1px solid ${theme.danger}`,
                            color: theme.danger,
                            padding: "8px 12px",
                            fontSize: "12px",
                          }}
                        >
                          Recusar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SEÇÃO DE GRUPOS */}
      <div style={styles.section}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h3
            style={{
              marginTop: 0,
              color: theme.gold,
              letterSpacing: "1px",
              margin: 0,
            }}
          >
            ⛳ MONTAGEM DOS FLIGHTS
          </h3>

          {/* BOTÃO EXPORTAR EXCEL AQUI */}
          <button onClick={handleExportExcel} style={styles.btnExport}>
            📥 Exportar Draw (Excel)
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "15px",
            flexWrap: "wrap",
            marginBottom: "30px",
            backgroundColor: theme.bg,
            padding: "20px",
            borderRadius: "12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <span
              style={{
                fontSize: "11px",
                color: theme.textMuted,
                fontWeight: "bold",
              }}
            >
              NOME DO GRUPO
            </span>
            <input
              type="text"
              placeholder="Ex: Grupo 01 - Manhã"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              style={{ ...styles.input, width: "250px" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <span
              style={{
                fontSize: "11px",
                color: theme.textMuted,
                fontWeight: "bold",
              }}
            >
              BURACO DE SAÍDA
            </span>
            <input
              type="number"
              value={startingHole}
              onChange={(e) => setStartingHole(e.target.value)}
              style={{ ...styles.input, width: "100px" }}
            />
          </div>
          <button
            onClick={handleCreateGroup}
            style={{ ...styles.button, alignSelf: "flex-end" }}
          >
            + Criar Flight
          </button>
        </div>

        {groups.map((group) => (
          <div key={group.id} style={styles.groupCard}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  {group.group_name}
                  <span
                    style={{
                      backgroundColor: theme.gold,
                      color: "#000",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontWeight: "bold",
                    }}
                  >
                    Hole {group.starting_hole}
                  </span>
                </h3>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "15px" }}
              >
                {group.access_code ? (
                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        fontSize: "10px",
                        display: "block",
                        color: theme.textMuted,
                        marginBottom: "2px",
                      }}
                    >
                      CÓDIGO DE ACESSO
                    </span>
                    <span style={styles.codeBox}>{group.access_code}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => generateAccessCode(group.id)}
                    style={{
                      ...styles.button,
                      backgroundColor: theme.cyan,
                      fontSize: "12px",
                    }}
                  >
                    Gerar Código
                  </button>
                )}
                <button
                  onClick={() => handleDeleteGroup(group.id, group.group_name)}
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "none",
                    color: theme.danger,
                    cursor: "pointer",
                    padding: "10px",
                    borderRadius: "8px",
                  }}
                  title="Excluir Grupo"
                >
                  🗑️
                </button>
              </div>
            </div>

            <div
              style={{
                marginTop: "20px",
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              {group.players && group.players.length > 0 ? (
                group.players.map((p) => (
                  <span key={p.id} style={styles.playerBadge}>
                    <span style={{ marginRight: "10px" }}>👤 {p.name}</span>
                    <button
                      onClick={() => handleRemovePlayer(group.id, p.id, p.name)}
                      style={{
                        background: "none",
                        border: "none",
                        color: theme.danger,
                        cursor: "pointer",
                        fontWeight: "bold",
                        fontSize: "14px",
                        marginLeft: "5px",
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))
              ) : (
                <span
                  style={{
                    color: theme.textMuted,
                    fontStyle: "italic",
                    fontSize: "14px",
                    padding: "10px",
                  }}
                >
                  Nenhum jogador escalado para este flight.
                </span>
              )}
            </div>

            <div
              style={{
                marginTop: "20px",
                paddingTop: "20px",
                borderTop: `1px solid ${theme.card}`,
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <select
                style={styles.select}
                value={selectedGroupId === group.id ? selectedPlayerId : ""}
                onChange={(e) => {
                  setSelectedGroupId(group.id);
                  setSelectedPlayerId(e.target.value);
                }}
              >
                <option value="">Adicionar jogador aprovado...</option>
                {approvedPlayers.map((insc) => (
                  <option key={insc.user_id} value={insc.user_id}>
                    {insc.player_name} ({insc.category_name})
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleAddPlayer(group.id)}
                style={{
                  ...styles.button,
                  backgroundColor: theme.blue,
                  color: "white",
                }}
              >
                + Adicionar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TournamentManager;
