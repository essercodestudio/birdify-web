// frontend/src/pages/AdminTeeSettings.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { useIsMobile } from "../hooks/useIsMobile";
import { LuCalendarClock, LuSave } from "react-icons/lu";

const DAYS = [
  { n: 0, label: "Dom" },
  { n: 1, label: "Seg" },
  { n: 2, label: "Ter" },
  { n: 3, label: "Qua" },
  { n: 4, label: "Qui" },
  { n: 5, label: "Sex" },
  { n: 6, label: "Sáb" },
];

function Field({ label, hint, children, theme }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function AdminTeeSettings() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const isMobile = useIsMobile();

  const inputStyle = {
    width: "100%", padding: 12, borderRadius: 8,
    border: `1px solid ${theme.cardLight}`,
    backgroundColor: theme.bg, color: theme.textMain,
    boxSizing: "border-box",
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const [f, setF] = useState({
    active: 1,
    interval_minutes: 10,
    max_players_per_slot: 4,
    opening_time: "07:00",
    closing_time: "17:00",
    active_days: [0, 1, 2, 3, 4, 5, 6],
    min_advance_hours: 24,
    max_advance_days: 14,
    cancellation_hours: 12,
    auto_confirm: 0,
    is_paid: 0,
    fee_value: "",
    pix_key: "",
    pix_key_type: "Chave Aleatória",
    whatsapp_number: "",
    instructions: "",
  });

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const load = useCallback(async () => {
    try {
      const res = await api.get("/admin/tee-settings");
      const d = res.data;
      setF({
        active: d.active ? 1 : 0,
        interval_minutes: d.interval_minutes || 10,
        max_players_per_slot: d.max_players_per_slot || 4,
        opening_time: (d.opening_time || "07:00:00").slice(0, 5),
        closing_time: (d.closing_time || "17:00:00").slice(0, 5),
        active_days: (d.active_days || "0,1,2,3,4,5,6").split(",").map(Number),
        min_advance_hours: d.min_advance_hours ?? 24,
        max_advance_days: d.max_advance_days ?? 14,
        cancellation_hours: d.cancellation_hours ?? 12,
        auto_confirm: d.auto_confirm ? 1 : 0,
        is_paid: d.is_paid ? 1 : 0,
        fee_value: d.fee_value ?? "",
        pix_key: d.pix_key ?? "",
        pix_key_type: d.pix_key_type ?? "Chave Aleatória",
        whatsapp_number: d.whatsapp_number ?? "",
        instructions: d.instructions ?? "",
      });
    } catch (e) {
      const status = e.response?.status;
      if (status === 403) setError("Acesso restrito a administradores.");
      else setError("Erro ao carregar configuração.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    try {
      if (u.role !== "ADMIN") { navigate("/"); return; }
    } catch {
      navigate("/login");
      return;
    }
    load();
  }, [navigate, load]);

  const toggleDay = (n) => {
    setF((x) => ({
      ...x,
      active_days: x.active_days.includes(n) ? x.active_days.filter((d) => d !== n) : [...x.active_days, n].sort(),
    }));
  };

  const handleSave = async () => {
    setError(null); setOk(null);

    if (f.opening_time >= f.closing_time) {
      setError("Horário de abertura deve ser antes do fechamento.");
      return;
    }
    if (f.active_days.length === 0) {
      setError("Selecione pelo menos um dia da semana.");
      return;
    }
    if (f.is_paid && (!f.fee_value || Number(f.fee_value) <= 0)) {
      setError("Informe o valor da taxa (fee) quando reserva for paga.");
      return;
    }

    try {
      setSaving(true);
      await api.put("/admin/tee-settings", {
        active: !!f.active,
        interval_minutes: Number(f.interval_minutes),
        max_players_per_slot: Number(f.max_players_per_slot),
        opening_time: f.opening_time,
        closing_time: f.closing_time,
        active_days: f.active_days,
        min_advance_hours: Number(f.min_advance_hours),
        max_advance_days: Number(f.max_advance_days),
        cancellation_hours: Number(f.cancellation_hours),
        auto_confirm: !!f.auto_confirm,
        is_paid: !!f.is_paid,
        fee_value: f.is_paid ? Number(f.fee_value) : null,
        pix_key: f.pix_key,
        pix_key_type: f.pix_key_type,
        whatsapp_number: f.whatsapp_number,
        instructions: f.instructions,
      });
      setOk("Configuração salva com sucesso!");
    } catch (e) {
      setError(e.response?.data?.error || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando...
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 24 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        <AdminNavMenu />

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
            <LuCalendarClock size={24} color={theme.accent} />
            Configuração de Tee Times
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
            Como os sócios podem reservar horários no seu clube
          </p>
        </div>

        {error && <div style={{ backgroundColor: "#4c1d1d", border: `1px solid ${theme.danger}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#fecaca" }}>{error}</div>}
        {ok && <div style={{ backgroundColor: "#052e16", border: `1px solid ${theme.accent}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#bbf7d0" }}>{ok}</div>}

        {/* Ativação */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Reservas de tee time</div>
            <div style={{ color: theme.textMuted, fontSize: 12 }}>
              Quando desativado, sócios não conseguem reservar
            </div>
          </div>
          <button
            onClick={() => set("active", f.active ? 0 : 1)}
            style={{ padding: "10px 20px", backgroundColor: f.active ? theme.accent : theme.cardLight, color: f.active ? theme.accentContrast : theme.textMain, border: "none", borderRadius: 20, fontWeight: 700, cursor: "pointer" }}
          >
            {f.active ? "ATIVO" : "DESATIVADO"}
          </button>
        </div>

        {/* Grade */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <h3 style={{ color: theme.gold, fontSize: 16, marginBottom: 14 }}>1. Grade de horários</h3>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <Field theme={theme} label="Abertura">
              <input type="time" value={f.opening_time} onChange={(e) => set("opening_time", e.target.value)} style={inputStyle} />
            </Field>
            <Field theme={theme} label="Fechamento">
              <input type="time" value={f.closing_time} onChange={(e) => set("closing_time", e.target.value)} style={inputStyle} />
            </Field>
            <Field theme={theme} label="Intervalo entre grupos (min)" hint="Ex: 10 = 07:00, 07:10, 07:20…">
              <input type="number" min="5" max="60" value={f.interval_minutes} onChange={(e) => set("interval_minutes", e.target.value)} style={inputStyle} />
            </Field>
            <Field theme={theme} label="Máx. jogadores por horário" hint="1 a 6 (foursome padrão = 4)">
              <input type="number" min="1" max="6" value={f.max_players_per_slot} onChange={(e) => set("max_players_per_slot", e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field theme={theme} label="Dias da semana em que aceita reserva">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DAYS.map((d) => {
                const active = f.active_days.includes(d.n);
                return (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() => toggleDay(d.n)}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 8,
                      border: `1px solid ${active ? theme.accent : theme.cardLight}`,
                      backgroundColor: active ? theme.accent : "transparent",
                      color: active ? theme.accentContrast : theme.textMain,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        {/* Regras */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <h3 style={{ color: theme.info, fontSize: 16, marginBottom: 14 }}>2. Regras de reserva</h3>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14 }}>
            <Field theme={theme} label="Antecedência mín. (horas)" hint="Sócio só reserva com N horas de antecedência">
              <input type="number" min="0" max="720" value={f.min_advance_hours} onChange={(e) => set("min_advance_hours", e.target.value)} style={inputStyle} />
            </Field>
            <Field theme={theme} label="Antecedência máx. (dias)" hint="Até quantos dias no futuro">
              <input type="number" min="1" max="90" value={f.max_advance_days} onChange={(e) => set("max_advance_days", e.target.value)} style={inputStyle} />
            </Field>
            <Field theme={theme} label="Cancelamento até (horas antes)">
              <input type="number" min="0" max="168" value={f.cancellation_hours} onChange={(e) => set("cancellation_hours", e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <input id="auto_confirm" type="checkbox" checked={!!f.auto_confirm} onChange={(e) => set("auto_confirm", e.target.checked ? 1 : 0)} style={{ width: 18, height: 18, cursor: "pointer" }} />
            <label htmlFor="auto_confirm" style={{ cursor: "pointer" }}>
              Confirmar reservas automaticamente (sem aprovação manual do clube)
            </label>
          </div>
        </div>

        {/* Pagamento */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <h3 style={{ color: theme.accent, fontSize: 16, marginBottom: 14 }}>3. Pagamento (green fee)</h3>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <input id="is_paid" type="checkbox" checked={!!f.is_paid} onChange={(e) => set("is_paid", e.target.checked ? 1 : 0)} style={{ width: 18, height: 18, cursor: "pointer" }} />
            <label htmlFor="is_paid" style={{ cursor: "pointer" }}>
              Cobrar green fee por reserva (mostra PIX pro sócio)
            </label>
          </div>

          {f.is_paid && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14 }}>
              <Field theme={theme} label="Valor (R$)">
                <input type="number" step="0.01" min="0" value={f.fee_value} onChange={(e) => set("fee_value", e.target.value)} style={inputStyle} placeholder="Ex: 150.00" />
              </Field>
              <Field theme={theme} label="Tipo de chave PIX">
                <select value={f.pix_key_type} onChange={(e) => set("pix_key_type", e.target.value)} style={inputStyle}>
                  <option value="Chave Aleatória">Chave Aleatória</option>
                  <option value="CPF">CPF</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="Celular">Celular</option>
                  <option value="E-mail">E-mail</option>
                  <option value="Copia e Cola">PIX Copia e Cola</option>
                </select>
              </Field>
              <Field theme={theme} label="Chave PIX">
                <input type="text" value={f.pix_key} onChange={(e) => set("pix_key", e.target.value)} style={inputStyle} />
              </Field>
            </div>
          )}
        </div>

        {/* Confirmação */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <h3 style={{ color: theme.gold, fontSize: 16, marginBottom: 14 }}>4. Confirmação via WhatsApp</h3>
          <Field theme={theme} label="Número do WhatsApp do clube" hint="Com DDD, sem +55. Ex: 11987654321. Aparece pro sócio após a reserva.">
            <input type="text" value={f.whatsapp_number} onChange={(e) => set("whatsapp_number", e.target.value.replace(/\D/g, ""))} style={inputStyle} placeholder="11987654321" maxLength={13} />
          </Field>
          <Field theme={theme} label="Instruções extras (opcional)" hint="Ex: 'Confirme com 24h de antecedência via WhatsApp'.">
            <textarea value={f.instructions} onChange={(e) => set("instructions", e.target.value)} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} maxLength={500} />
          </Field>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{ width: "100%", padding: 16, backgroundColor: saving ? theme.cardLight : theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 16, cursor: saving ? "wait" : "pointer" }}
        >
          {saving ? "Salvando..." : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <LuSave size={16} />
              SALVAR CONFIGURAÇÃO
            </span>
          )}
        </button>

      </div>
    </div>
  );
}

export default AdminTeeSettings;
