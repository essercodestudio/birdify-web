// frontend/src/pages/AdminTeeBookings.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { useIsMobile } from "../hooks/useIsMobile";
import { LuClipboardList, LuSettings } from "react-icons/lu";

const buildStatus = (theme) => ({
  pending:   { text: "Aguardando",  color: theme.gold,      bg: "#78350f" },
  confirmed: { text: "Confirmada",  color: theme.accent,    bg: "#052e16" },
  canceled:  { text: "Cancelada",   color: theme.textMuted, bg: theme.cardLight },
  no_show:   { text: "Não compareceu", color: theme.danger,  bg: "#4c1d1d" },
});

const fmtDate = (d) => {
  if (!d) return "";
  const raw = typeof d === "string" ? d : new Date(d).toISOString();
  const [y, m, day] = raw.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

function AdminTeeBookings() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const isMobile = useIsMobile();
  const STATUS = buildStatus(theme);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/admin/tee-bookings", { params });
      setBookings(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    try {
      if (u.role !== "ADMIN") { navigate("/"); return; }
    } catch { navigate("/login"); return; }
    load();
  }, [navigate, load]);

  const updateStatus = async (id, newStatus) => {
    setUpdatingId(id);
    try {
      await api.put(`/admin/tee-bookings/${id}/status`, { status: newStatus });
      await load();
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao atualizar status.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        <AdminNavMenu />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <LuClipboardList size={24} color={theme.accent} />
              Reservas de Tee Time
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              Gerencie as reservas dos sócios do clube
            </p>
          </div>
          <button onClick={() => navigate("/admin/tee-settings")} style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <LuSettings size={16} />
            Configuração
          </button>
        </div>

        {/* Filtros */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr auto", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Período</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo || undefined}
                aria-label="Data inicial"
                style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, flex: 1, minWidth: 0, boxSizing: "border-box" }}
              />
              <span style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                aria-label="Data final"
                style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, flex: 1, minWidth: 0, boxSizing: "border-box" }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, width: "100%", boxSizing: "border-box" }}>
              <option value="">Todos</option>
              <option value="pending">Aguardando</option>
              <option value="confirmed">Confirmada</option>
              <option value="canceled">Cancelada</option>
              <option value="no_show">Não compareceu</option>
            </select>
          </div>
          <button onClick={() => { setDateFrom(""); setDateTo(""); setStatusFilter(""); }} style={{ padding: "10px 16px", backgroundColor: theme.cardLight, color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
            Limpar
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 30 }}>Carregando...</p>
        ) : bookings.length === 0 ? (
          <p style={{ textAlign: "center", color: theme.textMuted, padding: 30, backgroundColor: theme.card, borderRadius: 12 }}>
            Nenhuma reserva encontrada com esses filtros.
          </p>
        ) : (
          <div style={{ backgroundColor: theme.card, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: theme.cardLight, color: theme.textMuted, textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 }}>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Data</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Hora</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Sócio</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Campo</th>
                    <th style={{ padding: "10px 12px", textAlign: "center" }}>Jog.</th>
                    <th style={{ padding: "10px 12px", textAlign: "left" }}>Status</th>
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const st = STATUS[b.status] || STATUS.pending;
                    return (
                      <tr key={b.id} style={{ borderTop: `1px solid ${theme.cardLight}` }}>
                        <td style={{ padding: "12px" }}>{fmtDate(b.booking_date)}</td>
                        <td style={{ padding: "12px", fontWeight: 700 }}>{b.booking_time.slice(0, 5)}</td>
                        <td style={{ padding: "12px" }}>
                          <div>{b.user_name}</div>
                          <div style={{ color: theme.textMuted, fontSize: 11 }}>{b.user_email}</div>
                        </td>
                        <td style={{ padding: "12px" }}>{b.course_name}</td>
                        <td style={{ padding: "12px", textAlign: "center", fontWeight: 700 }}>{b.players_count}</td>
                        <td style={{ padding: "12px" }}>
                          <span style={{ padding: "4px 10px", backgroundColor: st.bg, color: st.color, borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                            {st.text}
                          </span>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {b.status === "pending" && (
                            <>
                              <button onClick={() => updateStatus(b.id, "confirmed")} disabled={updatingId === b.id} style={{ marginRight: 4, padding: "6px 10px", backgroundColor: theme.accent, color: theme.accentContrast, border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                                Confirmar
                              </button>
                              <button onClick={() => updateStatus(b.id, "canceled")} disabled={updatingId === b.id} style={{ padding: "6px 10px", backgroundColor: theme.danger, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                                Rejeitar
                              </button>
                            </>
                          )}
                          {b.status === "confirmed" && (
                            <>
                              <button onClick={() => updateStatus(b.id, "no_show")} disabled={updatingId === b.id} style={{ marginRight: 4, padding: "6px 10px", backgroundColor: theme.gold, color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                                Não compareceu
                              </button>
                              <button onClick={() => updateStatus(b.id, "canceled")} disabled={updatingId === b.id} style={{ padding: "6px 10px", backgroundColor: theme.danger, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                                Cancelar
                              </button>
                            </>
                          )}
                          {(b.status === "canceled" || b.status === "no_show") && (
                            <button onClick={() => updateStatus(b.id, "confirmed")} disabled={updatingId === b.id} style={{ padding: "6px 10px", backgroundColor: theme.info, color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                              ↻ Reativar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default AdminTeeBookings;
