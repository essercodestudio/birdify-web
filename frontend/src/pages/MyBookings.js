// frontend/src/pages/MyBookings.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { LuClipboardList, LuPlus, LuArrowLeft, LuFlag, LuUsers } from "react-icons/lu";

const buildStatusLabel = (theme) => ({
  pending:   { text: "Aguardando confirmação", color: theme.gold,      bg: "#78350f" },
  confirmed: { text: "Confirmada",             color: theme.accent,    bg: "#052e16" },
  canceled:  { text: "Cancelada",              color: theme.textMuted, bg: theme.cardLight },
  no_show:   { text: "Não compareceu",         color: theme.danger,    bg: "#4c1d1d" },
});

const fmtDate = (d) => {
  if (!d) return "";
  const raw = typeof d === "string" ? d : new Date(d).toISOString();
  const [y, m, day] = raw.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

const fmtDay = (d) => {
  if (!d) return "";
  const raw = typeof d === "string" ? d : new Date(d).toISOString();
  const iso = raw.slice(0, 10);
  const wd = new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
  return wd.charAt(0).toUpperCase() + wd.slice(1);
};

function MyBookings() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const STATUS_LABEL = buildStatusLabel(theme);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelingId, setCancelingId] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get("/tee-times/my-bookings");
      setBookings(res.data);
    } catch (e) {
      setError("Não foi possível carregar suas reservas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getUser()) { navigate("/login"); return; }
    load();
  }, [navigate, load]);

  const handleCancel = async (id) => {
    if (!window.confirm("Deseja cancelar esta reserva?")) return;
    setCancelingId(id);
    try {
      await api.delete(`/tee-times/book/${id}`);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao cancelar.");
    } finally {
      setCancelingId(null);
    }
  };

  const upcoming = bookings.filter((b) => {
    const iso = typeof b.booking_date === "string" ? b.booking_date.slice(0, 10) : new Date(b.booking_date).toISOString().slice(0, 10);
    const dt = new Date(`${iso}T${b.booking_time}`);
    return dt >= new Date() && ["pending", "confirmed"].includes(b.status);
  });
  const past = bookings.filter((b) => !upcoming.includes(b));

  const renderCard = (b) => {
    const st = STATUS_LABEL[b.status] || STATUS_LABEL.pending;
    const iso = typeof b.booking_date === "string" ? b.booking_date.slice(0, 10) : new Date(b.booking_date).toISOString().slice(0, 10);
    const canCancel = ["pending", "confirmed"].includes(b.status) && new Date(`${iso}T${b.booking_time}`) > new Date();

    return (
      <div key={b.id} style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{b.booking_time.slice(0, 5)}</div>
            <div style={{ color: theme.textMuted, fontSize: 13 }}>
              {fmtDay(b.booking_date)} · {fmtDate(b.booking_date)}
            </div>
            <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <LuFlag size={12} />
              {b.course_name}
              <span>·</span>
              <LuUsers size={12} />
              {b.players_count} jogador{b.players_count > 1 ? "es" : ""}
            </div>
            {b.notes && (
              <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>"{b.notes}"</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={{ padding: "4px 12px", backgroundColor: st.bg, color: st.color, borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
              {st.text}
            </div>
            {canCancel && (
              <button
                onClick={() => handleCancel(b.id)}
                disabled={cancelingId === b.id}
                style={{ padding: "6px 12px", backgroundColor: "transparent", color: theme.danger, border: `1px solid ${theme.danger}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                {cancelingId === b.id ? "Cancelando..." : "CANCELAR"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
            <LuClipboardList size={24} color={theme.accent} />
            Minhas reservas
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => navigate("/tee-times")} style={{ padding: "10px 16px", backgroundColor: theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <LuPlus size={16} />
              Nova reserva
            </button>
            <button onClick={() => navigate("/player")} style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMuted, border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <LuArrowLeft size={16} />
              Voltar
            </button>
          </div>
        </div>

        {loading && <p style={{ textAlign: "center", color: theme.textMuted }}>Carregando...</p>}
        {error && <div style={{ padding: 12, backgroundColor: "#4c1d1d", color: "#fecaca", borderRadius: 8 }}>{error}</div>}

        {!loading && !error && (
          <>
            <h3 style={{ color: theme.accent, fontSize: 15, marginBottom: 10, marginTop: 10 }}>Próximas ({upcoming.length})</h3>
            {upcoming.length === 0 ? (
              <p style={{ color: theme.textMuted, fontSize: 14, textAlign: "center", padding: 30, backgroundColor: theme.card, borderRadius: 12 }}>
                Você não tem reservas futuras.
              </p>
            ) : (
              upcoming.map(renderCard)
            )}

            {past.length > 0 && (
              <>
                <h3 style={{ color: theme.textMuted, fontSize: 15, marginBottom: 10, marginTop: 24 }}>Histórico ({past.length})</h3>
                {past.map(renderCard)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default MyBookings;
