// frontend/src/pages/TeeTimes.js
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { LuCalendarDays, LuArrowLeft, LuInfo, LuCircleCheck, LuCopy } from "react-icons/lu";

const fmtBRL = (n) =>
  Number(n || 0).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2,
  });

// Data local (Brasília) → "YYYY-MM-DD" sem sofrer com fuso
const toISODate = (d) => {
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
};

const fmtDayLabel = (d) => {
  const wd = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const dm = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return { wd: wd.toUpperCase(), dm };
};

function TeeTimes() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();

  const [config, setConfig] = useState(null);
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [dateISO, setDateISO] = useState(toISODate(new Date()));
  const [slots, setSlots] = useState([]);
  const [slotsMeta, setSlotsMeta] = useState({ enabled: true, reason: "" });
  const [maxPerSlot, setMaxPerSlot] = useState(4);

  const [loadingBoot, setLoadingBoot] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [chosenSlot, setChosenSlot] = useState(null); // { time, available }
  const [playersCount, setPlayersCount] = useState(1);
  const [notes, setNotes] = useState("");
  const [bookingResult, setBookingResult] = useState(null);
  const [bookingError, setBookingError] = useState(null);
  const [bookingLoading, setBookingLoading] = useState(false);

  // Bootstrap: config + courses
  useEffect(() => {
    if (!getUser()) { navigate("/login"); return; }

    (async () => {
      try {
        const [cfg, cs] = await Promise.all([
          api.get("/tee-times/config"),
          api.get("/courses/list"),
        ]);
        setConfig(cfg.data);
        setCourses(cs.data);
        if (cs.data.length > 0) setCourseId(String(cs.data[0].id));
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingBoot(false);
      }
    })();
  }, [navigate]);

  // Próximos N dias pro seletor
  const dayOptions = useMemo(() => {
    if (!config) return [];
    const days = [];
    const today = new Date();
    for (let i = 0; i < config.max_advance_days; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dow = d.getDay();
      const isActive = config.active_days.includes(dow);
      days.push({
        iso: toISODate(d),
        active: isActive,
        ...fmtDayLabel(d),
        isToday: i === 0,
      });
    }
    return days;
  }, [config]);

  // Buscar slots do dia
  const loadSlots = useCallback(async () => {
    if (!courseId || !dateISO || !config) return;
    setLoadingSlots(true);
    try {
      const res = await api.get(`/tee-times/availability`, {
        params: { date: dateISO, course_id: courseId },
      });
      setSlots(res.data.slots || []);
      setSlotsMeta({ enabled: res.data.enabled !== false, reason: res.data.reason || "" });
      setMaxPerSlot(res.data.max_per_slot || config.max_players_per_slot);
    } catch (e) {
      setSlots([]);
      setSlotsMeta({ enabled: false, reason: "Erro ao carregar horários." });
    } finally {
      setLoadingSlots(false);
    }
  }, [courseId, dateISO, config]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  const openBookingModal = (slot) => {
    if (slot.full || slot.too_soon) return;
    setChosenSlot(slot);
    setPlayersCount(1);
    setNotes("");
    setBookingResult(null);
    setBookingError(null);
  };

  const closeModal = () => {
    setChosenSlot(null);
    setBookingResult(null);
    setBookingError(null);
  };

  const submitBooking = async () => {
    setBookingError(null);
    setBookingLoading(true);
    try {
      const res = await api.post("/tee-times/book", {
        course_id: Number(courseId),
        date: dateISO,
        time: chosenSlot.time,
        players_count: Number(playersCount),
        notes: notes || null,
      });
      setBookingResult(res.data);
      loadSlots();
    } catch (e) {
      setBookingError(e.response?.data?.error || "Erro ao reservar.");
    } finally {
      setBookingLoading(false);
    }
  };

  const whatsappLink = () => {
    if (!config?.whatsapp_number) return null;
    const courseName = courses.find((c) => String(c.id) === String(courseId))?.name || "";
    const msg = encodeURIComponent(
      `Olá! Fiz uma reserva de tee time:\n📅 ${dateISO}\n⏰ ${chosenSlot?.time}\n⛳ ${courseName}\n👥 ${playersCount} jogador(es)\n${config.is_paid ? "💰 " + fmtBRL(config.fee_value) : ""}${bookingResult?.booking_id ? "\n\nReserva #" + bookingResult.booking_id : ""}`
    );
    return `https://wa.me/55${config.whatsapp_number}?text=${msg}`;
  };

  if (loadingBoot) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando...
      </div>
    );
  }

  if (!config?.active) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 40 }}>
        <div style={{ maxWidth: 500, margin: "0 auto", backgroundColor: theme.card, padding: 30, borderRadius: 12, textAlign: "center" }}>
          <h2>Reservas indisponíveis</h2>
          <p style={{ color: theme.textMuted, marginTop: 10 }}>
            O clube ainda não ativou o sistema de reservas de tee time.
          </p>
          <button onClick={() => navigate("/player")} style={{ marginTop: 20, padding: "12px 24px", backgroundColor: theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <LuCalendarDays size={24} color={theme.accent} />
              Reservar Tee Time
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              Escolha o dia, campo e horário
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => navigate("/my-bookings")} style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
              Minhas reservas
            </button>
            <button onClick={() => navigate("/player")} style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMuted, border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <LuArrowLeft size={16} />
              Voltar
            </button>
          </div>
        </div>

        {/* Seletor de campo */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16 }}>
          <label style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Campo
          </label>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, marginTop: 6, boxSizing: "border-box" }}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name} {c.city ? `- ${c.city}/${c.state}` : ""}</option>
            ))}
          </select>
        </div>

        {/* Calendário horizontal */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16 }}>
          <div style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Escolha o dia
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
            {dayOptions.map((d) => {
              const selected = d.iso === dateISO;
              return (
                <button
                  key={d.iso}
                  onClick={() => d.active && setDateISO(d.iso)}
                  disabled={!d.active}
                  style={{
                    flexShrink: 0,
                    minWidth: 78,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${selected ? theme.accent : theme.cardLight}`,
                    backgroundColor: selected ? theme.accent : d.active ? theme.bg : "transparent",
                    color: selected ? theme.accentContrast : d.active ? theme.textMain : theme.textMuted,
                    cursor: d.active ? "pointer" : "not-allowed",
                    opacity: d.active ? 1 : 0.4,
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 11 }}>{d.wd}</div>
                  <div style={{ fontSize: 15, marginTop: 2 }}>{d.dm}</div>
                  {d.isToday && <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7 }}>hoje</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Slots */}
        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12 }}>
          <div style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Horários disponíveis
          </div>

          {loadingSlots && <p style={{ color: theme.textMuted, textAlign: "center", padding: 20 }}>Carregando horários...</p>}

          {!loadingSlots && !slotsMeta.enabled && (
            <p style={{ color: theme.textMuted, textAlign: "center", padding: 20 }}>
              {slotsMeta.reason || "Sem horários disponíveis nesta data."}
            </p>
          )}

          {!loadingSlots && slotsMeta.enabled && slots.length === 0 && (
            <p style={{ color: theme.textMuted, textAlign: "center", padding: 20 }}>Sem horários configurados.</p>
          )}

          {!loadingSlots && slotsMeta.enabled && slots.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {slots.map((s) => {
                const disabled = s.full || s.too_soon;
                let bg = theme.bg;
                let color = theme.textMain;
                let label = `${maxPerSlot - s.taken} vaga${(maxPerSlot - s.taken) === 1 ? "" : "s"}`;
                if (s.full) { bg = theme.cardLight; color = theme.textMuted; label = "cheio"; }
                if (s.too_soon) { bg = theme.cardLight; color = theme.textMuted; label = "muito perto"; }
                return (
                  <button
                    key={s.time}
                    onClick={() => openBookingModal(s)}
                    disabled={disabled}
                    style={{
                      padding: 12,
                      backgroundColor: bg,
                      color,
                      border: `1px solid ${disabled ? theme.cardLight : theme.accent}`,
                      borderRadius: 8,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{s.time}</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>{label}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Instruções do clube */}
        {config.instructions && (
          <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginTop: 16, borderLeft: `4px solid ${theme.gold}` }}>
            <div style={{ color: theme.gold, fontSize: 12, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <LuInfo size={14} />
              Instruções do clube
            </div>
            <div style={{ color: theme.textMain, fontSize: 13, whiteSpace: "pre-wrap" }}>{config.instructions}</div>
          </div>
        )}

        {/* Modal de reserva */}
        {chosenSlot && (
          <div
            onClick={closeModal}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: theme.card, padding: 24, borderRadius: 12, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
            >
              {!bookingResult ? (
                <>
                  <h2 style={{ marginTop: 0, marginBottom: 4 }}>Confirmar reserva</h2>
                  <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: 20 }}>
                    {new Date(`${dateISO}T00:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · {chosenSlot.time}
                  </p>

                  <label style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Quantos jogadores?
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 16 }}>
                    {Array.from({ length: chosenSlot.available }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => setPlayersCount(n)}
                        style={{
                          flex: 1,
                          padding: "12px 8px",
                          backgroundColor: playersCount === n ? theme.accent : theme.bg,
                          color: playersCount === n ? theme.accentContrast : theme.textMain,
                          border: `1px solid ${playersCount === n ? theme.accent : theme.cardLight}`,
                          borderRadius: 8,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  <label style={{ color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Observações (opcional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={500}
                    style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, minHeight: 60, boxSizing: "border-box" }}
                    placeholder="Ex: convidado, restrições, etc."
                  />

                  {config.is_paid && (
                    <div style={{ marginTop: 16, padding: 12, backgroundColor: theme.bg, borderRadius: 8, borderLeft: `4px solid ${theme.gold}` }}>
                      <div style={{ fontSize: 12, color: theme.textMuted }}>Green fee</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: theme.gold }}>{fmtBRL(config.fee_value)}</div>
                    </div>
                  )}

                  {bookingError && <div style={{ marginTop: 12, padding: 10, backgroundColor: "#4c1d1d", color: "#fecaca", borderRadius: 8, fontSize: 13 }}>{bookingError}</div>}

                  <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                    <button onClick={closeModal} style={{ flex: 1, padding: 12, backgroundColor: theme.cardLight, color: theme.textMain, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
                      Cancelar
                    </button>
                    <button onClick={submitBooking} disabled={bookingLoading} style={{ flex: 2, padding: 12, backgroundColor: bookingLoading ? theme.cardLight : theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 800, cursor: bookingLoading ? "wait" : "pointer" }}>
                      {bookingLoading ? "Reservando..." : "CONFIRMAR RESERVA"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <LuCircleCheck size={40} color={theme.accent} />
                    <h2 style={{ marginTop: 8, color: theme.accent }}>{bookingResult.message}</h2>
                    <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 8 }}>
                      Reserva #{bookingResult.booking_id} · {new Date(`${dateISO}T00:00:00`).toLocaleDateString("pt-BR")} · {chosenSlot.time}
                    </p>
                  </div>

                  {config.is_paid && config.pix_key && (
                    <div style={{ padding: 14, backgroundColor: theme.bg, borderRadius: 8, borderLeft: `4px solid ${theme.gold}`, marginBottom: 14 }}>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Pague o green fee via PIX</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: theme.gold, marginBottom: 8 }}>{fmtBRL(config.fee_value)}</div>
                      <div style={{ fontSize: 12, color: theme.textMuted }}>{config.pix_key_type}:</div>
                      <div style={{ fontSize: 14, fontWeight: 700, wordBreak: "break-all", padding: 8, backgroundColor: theme.card, borderRadius: 6, marginTop: 4 }}>{config.pix_key}</div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(config.pix_key); alert("Chave PIX copiada!"); }}
                        style={{ marginTop: 8, padding: "8px 12px", backgroundColor: theme.gold, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        <LuCopy size={13} />
                        COPIAR CHAVE PIX
                      </button>
                    </div>
                  )}

                  {config.whatsapp_number && (
                    <a
                      href={whatsappLink()}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "block", padding: 14, backgroundColor: "#25D366", color: "#fff", textDecoration: "none", borderRadius: 8, textAlign: "center", fontWeight: 800, fontSize: 15 }}
                    >
                      CONFIRMAR NO WHATSAPP DO CLUBE
                    </a>
                  )}

                  <button
                    onClick={closeModal}
                    style={{ width: "100%", padding: 12, marginTop: 10, backgroundColor: theme.cardLight, color: theme.textMain, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
                  >
                    Fechar
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default TeeTimes;
