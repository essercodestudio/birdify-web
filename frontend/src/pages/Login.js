import React, { useState } from "react";
import api from "../services/api";
import { useNavigate, Link } from "react-router-dom";
// 1. IMPORTAR A LOGO (Certifique-se que o arquivo está em src/assets/)
import logoImg from "../assets/logo_birdify.png";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const theme = {
    bg: "#0f172a",
    card: "#1e293b",
    cardLight: "#334155",
    accent: "#22c55e",
    gold: "#eab308",
    textMain: "#f8fafc",
    textMuted: "#94a3b8",
    danger: "#ef4444",
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const response = await api.post("/auth/login", {
        email: email,
        password: password,
      });
      const user = response.data.user;
      localStorage.setItem("user", JSON.stringify(user));
      if (user.role === "ADMIN") {
        navigate("/dashboard");
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(
        err.response
          ? err.response.data.message
          : "Erro ao conectar com o servidor.",
      );
    }
  };

  const styles = {
    container: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100vh",
      backgroundColor: theme.bg,
      color: theme.textMain,
      fontFamily: "'Inter', sans-serif",
    },
    formBox: {
      backgroundColor: theme.card,
      padding: "40px",
      borderRadius: "24px",
      boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
      width: "90%",
      maxWidth: "400px",
      textAlign: "center",
      border: `1px solid ${theme.cardLight}`,
    },
    // 2. AJUSTE DO ESTILO DA LOGO
    logoContainer: {
      marginBottom: "20px",
      display: "flex",
      justifyContent: "center",
    },
    logoImage: {
      height: "150px", // Ajuste a altura como preferir
      width: "auto",
      filter: "drop-shadow(0px 4px 10px rgba(0,0,0,0.3))", // Dá um relevo na logo
    },
    subtitle: {
      color: theme.textMuted,
      fontSize: "14px",
      marginBottom: "30px",
    },
    label: {
      display: "block",
      textAlign: "left",
      fontSize: "12px",
      fontWeight: "bold",
      color: theme.textMuted,
      marginBottom: "5px",
      marginLeft: "5px",
      textTransform: "uppercase",
    },
    input: {
      width: "100%",
      padding: "15px",
      marginBottom: "20px",
      borderRadius: "12px",
      border: `2px solid ${theme.cardLight}`,
      backgroundColor: theme.bg,
      color: "white",
      boxSizing: "border-box",
      outline: "none",
      fontSize: "16px",
    },
    button: {
      width: "100%",
      padding: "16px",
      backgroundColor: theme.accent,
      color: "#0f172a",
      border: "none",
      borderRadius: "12px",
      cursor: "pointer",
      fontWeight: "800",
      marginTop: "10px",
      fontSize: "16px",
      boxShadow: "0 10px 15px -3px rgba(34, 197, 94, 0.3)",
    },
    error: {
      backgroundColor: "rgba(239, 68, 68, 0.1)",
      color: theme.danger,
      padding: "10px",
      borderRadius: "8px",
      fontSize: "14px",
      marginTop: "15px",
      border: `1px solid ${theme.danger}`,
    },
    link: {
      color: theme.gold,
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "600",
    },
    footer: {
      marginTop: "25px",
      borderTop: `1px solid ${theme.cardLight}`,
      paddingTop: "20px",
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.formBox}>
        {/* 3. TROCA DO TEXTO PELA IMAGEM */}
        <div style={styles.logoContainer}>
          <img src={logoImg} alt="Birdify Logo" style={styles.logoImage} />
        </div>

        <p style={styles.subtitle}>Entre para gerenciar seus scores</p>

        <form onSubmit={handleLogin}>
          <span style={styles.label}>E-mail</span>
          <input
            type="email"
            placeholder="exemplo@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />

          <span style={styles.label}>Senha</span>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
          />

          <button type="submit" style={styles.button}>
            ENTRAR NO SISTEMA
          </button>
        </form>

        {error && <div style={styles.error}>⚠️ {error}</div>}

        <div style={styles.footer}>
          <span style={{ color: theme.textMuted, fontSize: "14px" }}>
            Ainda não joga conosco?{" "}
          </span>
          <Link to="/register" style={styles.link}>
            Cadastre-se
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
