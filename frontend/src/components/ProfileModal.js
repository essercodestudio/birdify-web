// frontend/src/components/ProfileModal.js
// Modal "Meu Perfil" — extraído do PlayerHome.js (Onda C · Fase C.2).
// Auto-contido: gerencia próprios states, fetch inicial e upload de foto.
// Emite onProfileChange(nextProfile) sempre que profile mudar (salvar ou
// enviar foto) — a tela pai usa pra sincronizar seu próprio cache local
// (ex: avatar exibido no header do PlayerHome).
//
// Uso:
//   <ProfileModal isOpen={open} onClose={() => setOpen(false)}
//                 onProfileChange={(next) => setProfile(next)} />
import React, { useState, useEffect } from "react";
import api from "../services/api";
import { getUser, updateUser } from "../services/authStorage";
import Cropper from "react-easy-crop";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import {
  LuUser,
  LuCamera,
  LuInstagram,
  LuMessageCircle,
  LuZoomIn,
  LuZoomOut,
  LuCheck,
} from "react-icons/lu";

const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const mediaUrl = (url) => (!url ? "" : url.startsWith("http") ? url : MEDIA_BASE + url);

export default function ProfileModal({ isOpen, onClose, onProfileChange }) {
  const theme = useBirdifyTheme();
  const { space, radius, text } = theme;

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    name: "",
    bio: "",
    instagram_handle: "",
    whatsapp_number: "",
    golf_motivation: "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");

  // Enquadramento (react-easy-crop): abre um recorte circular com zoom/arrasto;
  // só o quadro confirmado é enviado (canvas 512x512, JPEG q=0.9).
  const [cropSrc, setCropSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropAreaPx, setCropAreaPx] = useState(null);

  // Reset ao abrir + fetch inicial. Não faz sentido manter states entre
  // aberturas — se o user editou fora e voltou, precisa dado fresco.
  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    setCropSrc(null);
    api.get("/users/me/profile")
      .then((res) => {
        setProfile(res.data);
        setForm({
          name: res.data.name || "",
          bio: res.data.bio || "",
          instagram_handle: res.data.instagram_handle || "",
          whatsapp_number: res.data.whatsapp_number || "",
          golf_motivation: res.data.golf_motivation || "",
        });
      })
      .catch(() => {});
  }, [isOpen]);

  const applyProfileChange = (next) => {
    setProfile(next);
    onProfileChange?.(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await api.put("/users/me/profile", form);
      const next = { ...profile, ...res.data };
      applyProfileChange(next);
      // Nome corrigido precisa refletir no localStorage — outras telas leem user.name de lá.
      const u = getUser();
      if (res.data.name && u && res.data.name !== u.name) {
        updateUser({ ...u, name: res.data.name });
      }
      onClose();
    } catch (e) {
      setMsg(e.response?.data?.error || "Erro ao salvar perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg("");
    const reader = new FileReader();
    reader.onload = () => {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropAreaPx(null);
      setCropSrc(reader.result);
    };
    reader.readAsDataURL(file);
  };

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
    setUploading(true);
    setMsg("");
    try {
      const blob = await buildCroppedBlob(cropSrc, cropAreaPx);
      const fd = new FormData();
      fd.append("photo", blob, "avatar.jpg");
      const res = await api.post("/users/me/photo", fd);
      applyProfileChange({ ...profile, profile_photo_url: res.data.url });
      setCropSrc(null);
    } catch (err) {
      setMsg(err.response?.data?.error || err.message || "Erro ao enviar a foto.");
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  const overlay = {
    position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: space[4], zIndex: 10001, animation: "fadeIn 0.15s",
  };
  const content = {
    backgroundColor: theme.card, borderRadius: radius.md,
    padding: space[5], width: "100%", maxWidth: 440, maxHeight: "90vh",
    overflowY: "auto", boxShadow: theme.shadow.lg,
  };
  const secondaryBtn = {
    padding: `${space[3]}px ${space[4]}px`, backgroundColor: "transparent",
    color: theme.textMain, border: `1px solid ${theme.border}`,
    borderRadius: radius.sm, fontWeight: 700, cursor: "pointer",
    fontSize: 14, fontFamily: theme.font,
  };
  const primaryBtn = {
    padding: `${space[3]}px ${space[4]}px`, backgroundColor: theme.accent,
    color: theme.accentContrast, border: "none", borderRadius: radius.sm,
    fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: theme.font,
  };
  const inputBase = {
    width: "100%", boxSizing: "border-box", padding: space[3],
    borderRadius: radius.sm, border: `1px solid ${theme.border}`,
    backgroundColor: theme.bg, color: theme.textMain,
    fontSize: 14, fontFamily: theme.font, outline: "none",
  };

  return (
    <div style={overlay} onClick={onClose}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div style={content} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: `0 0 ${space[5]}px 0`, ...text.h2, color: theme.textMain, textAlign: "center" }}>
          Meu Perfil
        </h2>

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
                type="range" min={1} max={3} step={0.05} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ flex: 1, accentColor: theme.accent }}
                aria-label="Zoom da foto"
              />
              <LuZoomIn size={16} color={theme.textMuted} />
            </div>
            <div style={{ display: "flex", gap: space[3] }}>
              <button onClick={() => setCropSrc(null)} disabled={uploading} style={{ ...secondaryBtn, flex: 1 }}>
                CANCELAR
              </button>
              <button
                onClick={handleConfirmCrop}
                disabled={uploading || !cropAreaPx}
                style={{ ...primaryBtn, flex: 2, opacity: uploading ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: space[2] }}
              >
                <LuCheck size={16} />
                {uploading ? "Enviando..." : "USAR FOTO"}
              </button>
            </div>
            {msg && (
              <div style={{ ...text.caption, color: theme.danger, textAlign: "center", marginTop: space[3] }}>
                {msg}
              </div>
            )}
          </div>
        ) : (
          <>
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
                  cursor: uploading ? "wait" : "pointer",
                  border: `2px solid ${theme.card}`,
                }}>
                  <LuCamera size={15} />
                  <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploading} style={{ display: "none" }} />
                </label>
              </div>
              {uploading && (
                <div style={{ ...text.caption, color: theme.textMuted, marginTop: space[1] }}>Enviando foto...</div>
              )}
            </div>

            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              Nome completo
            </label>
            <input
              type="text" value={form.name} maxLength={100} placeholder="Seu nome completo"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={{ ...inputBase, marginBottom: space[4] }}
            />

            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              Bio
            </label>
            <textarea
              value={form.bio} maxLength={150} placeholder="Uma linha sobre você"
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              style={{ ...inputBase, minHeight: 56, resize: "vertical" }}
            />
            <div style={{ ...text.caption, color: theme.textMuted, textAlign: "right", marginBottom: space[4] }}>
              {form.bio.length}/150
            </div>

            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              Instagram (opcional)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], border: `1px solid ${theme.border}`, borderRadius: radius.sm, backgroundColor: theme.bg, padding: `0 ${space[3]}px`, marginBottom: space[4] }}>
              <LuInstagram size={16} color={theme.textMuted} />
              <input
                type="text" value={form.instagram_handle} maxLength={60} placeholder="seu.usuario"
                onChange={(e) => setForm((f) => ({ ...f, instagram_handle: e.target.value }))}
                style={{ flex: 1, padding: `${space[3]}px 0`, border: "none", outline: "none", backgroundColor: "transparent", color: theme.textMain, fontSize: 14, fontFamily: theme.font }}
              />
            </div>

            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              WhatsApp (opcional)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], border: `1px solid ${theme.border}`, borderRadius: radius.sm, backgroundColor: theme.bg, padding: `0 ${space[3]}px`, marginBottom: space[4] }}>
              <LuMessageCircle size={16} color={theme.textMuted} />
              <input
                type="tel" value={form.whatsapp_number} maxLength={20} placeholder="5511999998888"
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
                style={{ flex: 1, padding: `${space[3]}px 0`, border: "none", outline: "none", backgroundColor: "transparent", color: theme.textMain, fontSize: 14, fontFamily: theme.font }}
              />
            </div>

            <label style={{ ...text.overline, color: theme.textMuted, display: "block", marginBottom: space[1] }}>
              O que me motiva no golfe
            </label>
            <textarea
              value={form.golf_motivation} maxLength={280} placeholder="Ex: superar meu próprio jogo a cada rodada"
              onChange={(e) => setForm((f) => ({ ...f, golf_motivation: e.target.value }))}
              style={{ ...inputBase, minHeight: 72, resize: "vertical" }}
            />
            <div style={{ ...text.caption, color: theme.textMuted, textAlign: "right", marginBottom: space[4] }}>
              {form.golf_motivation.length}/280
            </div>

            {msg && (
              <div style={{ ...text.caption, color: theme.danger, textAlign: "center", marginBottom: space[3] }}>
                {msg}
              </div>
            )}

            <div style={{ display: "flex", gap: space[3] }}>
              <button onClick={onClose} style={{ ...secondaryBtn, flex: 1 }}>
                FECHAR
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ ...primaryBtn, flex: 2, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "Salvando..." : "SALVAR PERFIL"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
