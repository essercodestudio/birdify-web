// DEV-ONLY: rota /dev/scorephoto-preview para validar o layout do ScorephotoCard
// com dados mockados. NUNCA registrar em produção (guard no App.js).
//
// Renderiza o card visível em tamanho reduzido (scale 0.4) para caber na tela,
// e um botão pra gerar/baixar o PNG na dimensão real (1080x1350).
import React, { useRef, useState } from "react";
import ScorephotoCard, { SCOREPHOTO_WIDTH, SCOREPHOTO_HEIGHT } from "../components/ScorephotoCard";
import { useScorephoto } from "../hooks/useScorephoto";

const MOCKS = {
  treino: {
    playerName:     "Vinícius Kross",
    playerPhotoUrl: null,
    clubName:       "Birdify Padrão",
    clubLogoUrl:    null,
    clubAccent:     "#22c55e",
    mode:           "training",
    totalStrokes:   82,
    vsPar:          10,
    stats:          { eagles: 1, birdies: 2, pars: 7, bogeys: 8 },
    courseName:     "Terras de São José Golf Club",
    date:           "03/08/2026",
  },
  torneio: {
    playerName:      "Ana Beatriz Silveira",
    playerPhotoUrl:  null,
    clubName:        "Golf Club Fictício",
    clubLogoUrl:     null,
    clubAccent:      "#0ea5e9",
    mode:            "tournament",
    totalStrokes:    74,
    vsPar:           2,
    stats:           { eagles: 0, birdies: 4, pars: 10, bogeys: 4 },
    courseName:     "Campo Litoral Norte",
    date:            "03/08/2026",
    tournamentName:  "Copa Verão 2026",
  },
  eagle: {
    playerName:     "Carlos M.",
    playerPhotoUrl: null,
    clubName:       "Sunset Golf",
    clubLogoUrl:    null,
    clubAccent:     "#eab308",
    mode:           "training",
    totalStrokes:   68,
    vsPar:          -4,
    stats:          { eagles: 2, birdies: 5, pars: 9, bogeys: 2 },
    courseName:     "Sunset Ocean Course",
    date:           "03/08/2026",
  },
};

export default function ScorephotoPreview() {
  const [preset, setPreset] = useState("treino");
  const cardRef = useRef(null);
  const { generate, imageUrl, isGenerating, error, reset } = useScorephoto(cardRef);

  const data = MOCKS[preset];

  const handleGenerate = async () => {
    reset();
    await generate();
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `scorephoto-${preset}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const SCALE = 0.4;

  return (
    <div style={{
      minHeight: "100vh", backgroundColor: "#020617", color: "#f8fafc",
      padding: 24, fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0, fontSize: 24 }}>Scorephoto — Preview (DEV)</h1>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>
          Rota apenas em desenvolvimento. Dados mockados. Ajuste o preset e gere a imagem real (1080×1350).
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {Object.keys(MOCKS).map(k => (
            <button
              key={k}
              onClick={() => { setPreset(k); reset(); }}
              style={{
                padding: "10px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: 1,
                backgroundColor: preset === k ? "#22c55e" : "#1e293b",
                color: preset === k ? "#000" : "#f8fafc",
              }}
            >{k}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              padding: "12px 24px", borderRadius: 8, border: "none", cursor: isGenerating ? "wait" : "pointer",
              fontWeight: 800, fontSize: 14,
              backgroundColor: isGenerating ? "#334155" : "#22c55e",
              color: isGenerating ? "#94a3b8" : "#000",
            }}
          >
            {isGenerating ? "Gerando..." : "Gerar PNG"}
          </button>
          <button
            onClick={handleDownload}
            disabled={!imageUrl}
            style={{
              padding: "12px 24px", borderRadius: 8, border: `1px solid #334155`, cursor: imageUrl ? "pointer" : "not-allowed",
              fontWeight: 700, fontSize: 14,
              backgroundColor: "transparent",
              color: imageUrl ? "#f8fafc" : "#475569",
            }}
          >
            Baixar
          </button>
        </div>

        {error && (
          <div style={{ padding: 12, borderRadius: 8, backgroundColor: "#7f1d1d", color: "#fecaca", marginBottom: 16, fontSize: 13 }}>
            Erro: {error.message}
          </div>
        )}

        {/* Preview visível (escala reduzida) */}
        <div style={{
          border: "1px solid #334155", borderRadius: 12, overflow: "hidden",
          width: SCOREPHOTO_WIDTH * SCALE, height: SCOREPHOTO_HEIGHT * SCALE,
          marginBottom: 24,
        }}>
          <div style={{
            transform: `scale(${SCALE})`, transformOrigin: "top left",
            width: SCOREPHOTO_WIDTH, height: SCOREPHOTO_HEIGHT,
          }}>
            <ScorephotoCard {...data} />
          </div>
        </div>

        {imageUrl && (
          <div>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Resultado (PNG gerado)</h2>
            <img
              src={imageUrl}
              alt="Scorephoto gerado"
              style={{ width: "100%", maxWidth: SCOREPHOTO_WIDTH * SCALE, border: "1px solid #334155", borderRadius: 12 }}
            />
          </div>
        )}
      </div>

      {/* Card em tamanho real, fora do viewport, usado como fonte da captura */}
      <div style={{ position: "fixed", left: -99999, top: 0, pointerEvents: "none" }}>
        <ScorephotoCard ref={cardRef} {...data} />
      </div>
    </div>
  );
}
