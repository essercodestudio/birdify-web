// frontend/src/pages/AdminSponsors.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { mediaUrl } from "../services/media";
import AdminNavMenu from "../components/AdminNavMenu";
import { useIsMobile } from "../hooks/useIsMobile";
import { LuMegaphone, LuPlus, LuTrash2, LuUpload, LuExternalLink } from "react-icons/lu";

function Field({ label, hint, children, theme }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ color: theme.textMuted, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function AdminSponsors() {
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
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const [sponsors, setSponsors] = useState([]);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get("/circuits/sponsors");
      setSponsors(res.data);
    } catch (e) {
      const status = e.response?.status;
      if (status === 403) setError("Acesso restrito a administradores.");
      else setError("Erro ao carregar patrocinadores.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    try {
      if (u.role !== "ADMIN") { navigate("/"); return; }
    } catch { navigate("/login"); return; }
    load();
  }, [navigate, load]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await api.post("/sponsors/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setLogoUrl(res.data.url);
    } catch {
      setError("Falha no upload da logo.");
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async () => {
    setError(null); setOk(null);
    if (!name.trim()) {
      setError("Informe o nome do patrocinador.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/circuits/sponsors", {
        name: name.trim(),
        logo_url: logoUrl || null,
        link_url: linkUrl.trim() || null,
      });
      setName(""); setLogoUrl(""); setLinkUrl("");
      setOk("Patrocinador adicionado!");
      await load();
    } catch (e) {
      setError(e.response?.data?.error || "Erro ao criar patrocinador.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sp) => {
    if (!window.confirm(`Excluir o patrocinador "${sp.name}"?`)) return;
    try {
      await api.delete(`/circuits/sponsors/${sp.id}`);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao excluir.");
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
            <LuMegaphone size={24} color={theme.accent} />
            Patrocinadores
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
            Patrocinadores do clube — aparecem na barra fixa no rodapé de todas as telas
          </p>
        </div>

        {error && <div style={{ backgroundColor: "#4c1d1d", border: `1px solid ${theme.danger}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#fecaca", fontSize: 13 }}>{error}</div>}
        {ok && <div style={{ backgroundColor: "#052e16", border: `1px solid ${theme.accent}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#bbf7d0", fontSize: 13 }}>{ok}</div>}

        {/* Adicionar */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h3 style={{ color: theme.accent, fontSize: 16, margin: 0, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <LuPlus size={16} />
            Adicionar patrocinador
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <Field theme={theme} label="Nome" hint="Aparece no rodapé caso não tenha logo.">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Nike Golf"
                style={inputStyle}
                maxLength={150}
              />
            </Field>

            <Field theme={theme} label="Link (opcional)" hint="URL que abre ao clicar no logo.">
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                style={inputStyle}
                maxLength={500}
              />
            </Field>
          </div>

          <Field theme={theme} label="Logo" hint="PNG/JPG/SVG. Fundo transparente fica melhor.">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", backgroundColor: theme.cardLight, color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, cursor: uploading ? "wait" : "pointer", fontWeight: 700, fontSize: 13 }}>
                <LuUpload size={14} />
                {uploading ? "Enviando..." : (logoUrl ? "Trocar logo" : "Escolher arquivo")}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  disabled={uploading}
                  style={{ display: "none" }}
                />
              </label>
              {logoUrl && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", backgroundColor: "#fff", borderRadius: 6 }}>
                  <img src={mediaUrl(logoUrl)} alt="preview" style={{ maxHeight: 40, maxWidth: 120, objectFit: "contain" }} />
                </div>
              )}
            </div>
          </Field>

          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            style={{
              width: "100%",
              padding: 14,
              backgroundColor: (saving || !name.trim()) ? theme.cardLight : theme.accent,
              color: (saving || !name.trim()) ? theme.textMuted : theme.accentContrast,
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 14,
              cursor: (saving || !name.trim()) ? "not-allowed" : "pointer",
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <LuPlus size={16} />
            {saving ? "Salvando..." : "ADICIONAR"}
          </button>
        </div>

        {/* Lista */}
        <div style={{ backgroundColor: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20 }}>
          <h3 style={{ color: theme.textMain, fontSize: 16, margin: 0, marginBottom: 14 }}>
            Cadastrados ({sponsors.length})
          </h3>

          {sponsors.length === 0 ? (
            <p style={{ color: theme.textMuted, textAlign: "center", padding: 24, fontSize: 13, margin: 0 }}>
              Nenhum patrocinador cadastrado ainda.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sponsors.map((sp) => (
                <div key={sp.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, backgroundColor: theme.bg, borderRadius: 8, border: `1px solid ${theme.border}` }}>
                  <div style={{ width: 80, height: 44, backgroundColor: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                    {sp.logo_url ? (
                      <img src={mediaUrl(sp.logo_url)} alt={sp.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    ) : (
                      <span style={{ fontSize: 10, color: "#64748b", padding: 2, textAlign: "center", wordBreak: "break-word" }}>sem logo</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: theme.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sp.name}
                    </div>
                    {sp.link_url && (
                      <a
                        href={sp.link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: theme.info, textDecoration: "none", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
                      >
                        <LuExternalLink size={11} />
                        {sp.link_url}
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(sp)}
                    style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${theme.border}`, backgroundColor: "transparent", color: theme.danger, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    title="Excluir patrocinador"
                  >
                    <LuTrash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default AdminSponsors;
