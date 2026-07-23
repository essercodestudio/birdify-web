// frontend/src/pages/CoursePreview.js
// Visualização pública do campo — grid de buracos com par colorido, distância e foto.
// Rota /campo/:courseId — não exige login (mas filtra pelo clube via Detetive de Domínios).
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../services/api";
import { mediaUrl } from "../services/media";
import HoleDistanceBadge from "../components/HoleDistanceBadge";
import { LuArrowLeft, LuMapPin, LuX, LuFlag } from "react-icons/lu";

const theme = {
  bg: "#0f172a",
  card: "#1e293b",
  cardLight: "#334155",
  accent: "#22c55e",
  gold: "#eab308",
  info: "#38bdf8",
  textMain: "#f8fafc",
  textMuted: "#94a3b8",
};

const parColor = (par) => {
  const p = Number(par);
  if (p === 3) return theme.info;
  if (p === 5) return theme.gold;
  return theme.accent;
};

export default function CoursePreview() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [zoomHole, setZoomHole] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/courses/${courseId}/preview`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setErr(e.response?.data?.error || "Campo não encontrado."); });
    return () => { alive = false; };
  }, [courseId]);

  useEffect(() => {
    if (!zoomHole) return;
    const onKey = (e) => { if (e.key === "Escape") setZoomHole(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomHole]);

  if (err) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 24 }}>
        <button onClick={() => navigate(-1)} style={backBtnStyle}>
          <LuArrowLeft size={16} /> Voltar
        </button>
        <div style={{ marginTop: 24, color: theme.textMuted }}>{err}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando campo...
      </div>
    );
  }

  const { course, holes } = data;

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: "16px 12px 40px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <button onClick={() => navigate(-1)} style={backBtnStyle}>
          <LuArrowLeft size={16} /> Voltar
        </button>

        <div style={{ marginTop: 16, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24, display: "flex", alignItems: "center", gap: 8 }}>
            <LuFlag size={22} color={theme.accent} />
            {course.name}
          </h1>
          {(course.city || course.state) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: theme.textMuted, marginTop: 6, fontSize: 14 }}>
              <LuMapPin size={14} />
              {[course.city, course.state].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 12,
        }}>
          {holes.map((h) => (
            <div key={h.hole_number} style={{
              backgroundColor: theme.card,
              border: `1px solid ${theme.cardLight}`,
              borderRadius: 14,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: theme.textMain }}>
                  {h.hole_number}
                </span>
                <span style={{
                  backgroundColor: parColor(h.par),
                  color: "#fff",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                }}>
                  PAR {h.par}
                </span>
              </div>

              <div>
                <HoleDistanceBadge hole={h} />
              </div>

              {h.image_path ? (
                <button
                  type="button"
                  onClick={() => setZoomHole(h)}
                  style={{
                    padding: 0,
                    border: `1px solid ${theme.cardLight}`,
                    borderRadius: 10,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "transparent",
                  }}
                  aria-label={`Ampliar foto do buraco ${h.hole_number}`}
                >
                  <img
                    src={mediaUrl(h.image_path)}
                    alt={`Buraco ${h.hole_number}`}
                    style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
                  />
                </button>
              ) : (
                <div style={{
                  height: 120,
                  borderRadius: 10,
                  border: `1px dashed ${theme.cardLight}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: theme.textMuted,
                  fontSize: 12,
                }}>
                  Sem foto
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {zoomHole && (
        <div
          onClick={() => setZoomHole(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.92)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setZoomHole(null)}
            aria-label="Fechar"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: theme.card,
              border: `1px solid ${theme.cardLight}`,
              color: theme.textMain,
              width: 40,
              height: 40,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <LuX size={22} />
          </button>
          <img
            src={mediaUrl(zoomHole.image_path)}
            alt={`Buraco ${zoomHole.hole_number}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              objectFit: "contain",
            }}
          />
        </div>
      )}
    </div>
  );
}

const backBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  backgroundColor: theme.card,
  color: theme.textMain,
  border: `1px solid ${theme.cardLight}`,
  padding: "8px 12px",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 14,
};
