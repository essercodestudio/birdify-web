// Hook para capturar o <ScorephotoCard /> como PNG usando html-to-image.
// Uso:
//   const cardRef = useRef(null);
//   const { generate, imageBlob, imageUrl, isGenerating, error, reset } = useScorephoto(cardRef);
//   await generate();  // captura → Blob PNG
//
// O componente-alvo (referenciado por cardRef) deve estar montado no DOM
// mesmo que fora da viewport (ex: position:fixed; left:-9999px).
import { useCallback, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { SCOREPHOTO_WIDTH, SCOREPHOTO_HEIGHT } from "../components/ScorephotoCard";

export function useScorephoto(cardRef) {
  const [imageBlob,    setImageBlob]    = useState(null);
  const [imageUrl,     setImageUrl]     = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error,        setError]        = useState(null);

  // Revoga blob anterior antes de criar novo — evita leak de object URL
  const previousUrlRef = useRef(null);

  const reset = useCallback(() => {
    if (previousUrlRef.current) {
      URL.revokeObjectURL(previousUrlRef.current);
      previousUrlRef.current = null;
    }
    setImageBlob(null);
    setImageUrl(null);
    setError(null);
  }, []);

  const generate = useCallback(async () => {
    if (!cardRef.current) {
      setError(new Error("Card não montado."));
      return null;
    }
    setIsGenerating(true);
    setError(null);
    try {
      // pixelRatio 1 basta — o card já tem dimensões finais (1080x1350).
      // cacheBust evita imagem stale se o mesmo URL foi capturado antes.
      // fetchRequestInit sem credentials para não bloquear em CORS de logos públicos.
      const blob = await toBlob(cardRef.current, {
        width:  SCOREPHOTO_WIDTH,
        height: SCOREPHOTO_HEIGHT,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#0f172a",
        style: {
          transform: "none",  // anula qualquer transform do container escondido
        },
      });

      if (!blob) throw new Error("Falha ao gerar imagem.");

      if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
      const url = URL.createObjectURL(blob);
      previousUrlRef.current = url;

      setImageBlob(blob);
      setImageUrl(url);
      return blob;
    } catch (err) {
      console.error("[useScorephoto] erro ao gerar:", err);
      setError(err);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [cardRef]);

  return { generate, imageBlob, imageUrl, isGenerating, error, reset };
}
