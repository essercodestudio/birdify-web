// frontend/src/pages/NotFound.js
// Catch-all para URLs inexistentes — evita a tela em branco quando o usuário
// digita uma rota errada ou segue um link quebrado.
import { useNavigate } from "react-router-dom";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";

export default function NotFound() {
  const navigate = useNavigate();
  const theme = useBirdifyTheme();

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 64, fontWeight: 800, color: theme.accent }}>404</div>
      <h1 style={{ fontSize: 22, margin: 0 }}>Página não encontrada</h1>
      <p style={{ color: theme.textMuted, maxWidth: 420 }}>
        O endereço que você acessou não existe ou foi movido.
      </p>
      <button
        onClick={() => navigate("/")}
        style={{ padding: "12px 20px", backgroundColor: theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
      >
        Voltar ao início
      </button>
    </div>
  );
}
