// frontend/src/pages/ClubSettings.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { useIsMobile } from "../hooks/useIsMobile";
import { LuSettings, LuSave, LuEye } from "react-icons/lu";

const isHex = (s) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s || "");

function Field({ label, hint, children, theme }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", color: theme.textMuted, fontSize: 12, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function ClubSettings() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const [form, setForm] = useState({
    name: "",
    primary_color: "#22c55e",
    background_color: "",
    logo_url: "",
    domain: "",
  });

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get("/admin/club");
      setForm({
        name: res.data.name || "",
        primary_color: res.data.primary_color || "#22c55e",
        background_color: res.data.background_color || "",
        logo_url: res.data.logo_url || "",
        domain: res.data.domain || "",
      });
    } catch (e) {
      const status = e.response?.status;
      if (status === 403) setError("Acesso restrito a administradores.");
      else setError("Não foi possível carregar os dados do clube.");
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

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setOk(null);
    setError(null);

    if (!form.name || form.name.trim().length < 2) {
      setError("Informe o nome do clube (mínimo 2 caracteres).");
      return;
    }
    if (!isHex(form.primary_color)) {
      setError("Cor primária inválida. Use formato #RRGGBB.");
      return;
    }
    if (form.background_color && !isHex(form.background_color)) {
      setError("Cor de fundo inválida. Use formato #RRGGBB.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        primary_color: form.primary_color,
        background_color: form.background_color,
        logo_url: form.logo_url,
      };
      const res = await api.put("/admin/club", payload);
      setOk("Configurações salvas com sucesso!");
      // Atualiza tema em runtime (cor primária) sem precisar recarregar
      if (res.data?.club?.primary_color) {
        document.documentElement.style.setProperty("--color-primary", res.data.club.primary_color);
      }
      if (res.data?.club?.background_color) {
        document.documentElement.style.setProperty("--color-bg", res.data.club.background_color);
      }
    } catch (e) {
      setError(e.response?.data?.error || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando configurações...
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 24 }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        <AdminNavMenu />

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
            <LuSettings size={24} color={theme.accent} />
            Configurações do Clube
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
            Identidade visual e informações públicas
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>

          {/* Formulário */}
          <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 24 }}>
            <h3 style={{ color: theme.textMain, fontSize: 16, marginBottom: 16 }}>Dados do clube</h3>

            {error && <div style={{ backgroundColor: "#4c1d1d", border: `1px solid ${theme.danger}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#fecaca", fontSize: 13 }}>{error}</div>}
            {ok && <div style={{ backgroundColor: "#052e16", border: `1px solid ${theme.accent}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#bbf7d0", fontSize: 13 }}>{ok}</div>}

            <Field theme={theme} label="Nome do clube">
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ex: São Fernando Golf Club"
                style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, boxSizing: "border-box" }}
                maxLength={100}
              />
            </Field>

            <Field theme={theme} label="Cor primária" hint="Cor da marca — usada em botões e destaques.">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="color"
                  value={isHex(form.primary_color) ? form.primary_color : "#22c55e"}
                  onChange={(e) => set("primary_color", e.target.value)}
                  style={{ width: 50, height: 42, border: "none", background: "transparent", cursor: "pointer" }}
                />
                <input
                  type="text"
                  value={form.primary_color}
                  onChange={(e) => set("primary_color", e.target.value)}
                  placeholder="#22c55e"
                  style={{ flex: 1, padding: 12, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain }}
                  maxLength={7}
                />
              </div>
            </Field>

            <Field theme={theme} label="Cor de fundo (opcional)" hint="Deixe vazio para usar o padrão escuro.">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="color"
                  value={isHex(form.background_color) ? form.background_color : "#0f172a"}
                  onChange={(e) => set("background_color", e.target.value)}
                  style={{ width: 50, height: 42, border: "none", background: "transparent", cursor: "pointer" }}
                />
                <input
                  type="text"
                  value={form.background_color}
                  onChange={(e) => set("background_color", e.target.value)}
                  placeholder="(vazio)"
                  style={{ flex: 1, padding: 12, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain }}
                  maxLength={7}
                />
              </div>
            </Field>

            <Field theme={theme} label="URL do logo" hint="Cole uma URL pública (https://…) ou o caminho retornado pelo upload.">
              <input
                type="text"
                value={form.logo_url}
                onChange={(e) => set("logo_url", e.target.value)}
                placeholder="https://.../logo.png"
                style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, boxSizing: "border-box" }}
              />
            </Field>

            <Field theme={theme} label="Domínio">
              <input
                type="text"
                value={form.domain}
                disabled
                style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMuted, cursor: "not-allowed", boxSizing: "border-box" }}
              />
              <div style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }}>
                Alteração de domínio precisa ser feita pela equipe Birdify.
              </div>
            </Field>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{ width: "100%", padding: 14, backgroundColor: saving ? theme.cardLight : theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 15, cursor: saving ? "wait" : "pointer", marginTop: 8 }}
            >
              {saving ? "Salvando..." : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <LuSave size={16} />
                  SALVAR ALTERAÇÕES
                </span>
              )}
            </button>
          </div>

          {/* Preview */}
          <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 24, height: "fit-content", position: isMobile ? "static" : "sticky", top: 20 }}>
            <h3 style={{ color: theme.textMain, fontSize: 16, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <LuEye size={16} color={theme.textMuted} />
              Prévia
            </h3>

            <div style={{
              backgroundColor: form.background_color && isHex(form.background_color) ? form.background_color : theme.bg,
              border: `1px solid ${theme.cardLight}`,
              borderRadius: 12,
              padding: 20,
              minHeight: 320,
            }}>
              {form.logo_url ? (
                <img
                  src={form.logo_url}
                  alt="Logo"
                  style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", marginBottom: 16 }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : (
                <div style={{ height: 80, border: `2px dashed ${theme.cardLight}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textMuted, fontSize: 12, marginBottom: 16 }}>
                  (logo não definida)
                </div>
              )}

              <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 16 }}>
                {form.name || "Nome do clube"}
              </h2>

              <button
                style={{
                  padding: "12px 20px",
                  backgroundColor: isHex(form.primary_color) ? form.primary_color : "#22c55e",
                  color: "#000",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: "default",
                }}
              >
                BOTÃO PRIMÁRIO
              </button>

              <div style={{
                marginTop: 20,
                padding: 12,
                backgroundColor: "#0f172a",
                borderLeft: `4px solid ${isHex(form.primary_color) ? form.primary_color : "#22c55e"}`,
                borderRadius: 6,
                color: "#e2e8f0",
                fontSize: 13,
              }}>
                Torneio destaque com a cor da marca.
              </div>
            </div>

            <p style={{ color: theme.textMuted, fontSize: 11, marginTop: 12, textAlign: "center" }}>
              A prévia atualiza em tempo real conforme você edita.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default ClubSettings;
