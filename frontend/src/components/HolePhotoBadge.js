// frontend/src/components/HolePhotoBadge.js
// Ícone da foto do buraco (só aparece se hole.image_path existir).
// Clique abre modal fullscreen com a foto.
import React, { useState, useEffect } from "react";
import { LuImage, LuX } from "react-icons/lu";
import { mediaUrl } from "../services/media";

export default function HolePhotoBadge({ imagePath, holeNumber, size = 22 }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!imagePath) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Ver foto do buraco ${holeNumber}`}
        aria-label={`Ver foto do buraco ${holeNumber}`}
        style={{
          background: "rgba(56,189,248,0.15)",
          border: "1px solid #38bdf8",
          color: "#38bdf8",
          borderRadius: "50%",
          width: size + 12,
          height: size + 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <LuImage size={size} />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
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
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#f8fafc",
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
            src={mediaUrl(imagePath)}
            alt={`Buraco ${holeNumber}`}
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
    </>
  );
}
