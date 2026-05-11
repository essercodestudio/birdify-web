// frontend/src/pages/Login.js
import React, { useState, useContext } from "react"; // 1. Adicionado useContext
import api from "../services/api";
import { useNavigate, Link } from "react-router-dom";
import logoImg from "../assets/logo_birdify.png";

// 2. Importando a Memória Global do Camaleão
import { ThemeContext } from "../App"; 

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // 3. Puxando as informações do clube atual
  const clubTheme = useContext(ThemeContext) || {};

  const theme = {
    bg: "#0f172a",
    card: "#1e293b",
    cardLight: "#334155",
    // 4. A MÁGICA DA COR: Usa a cor do clube ou verde como padrão
    accent: clubTheme.primary_color || "#22c55e", 
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
      const { token, user } = response.data;
      localStorage.setItem("token", token);
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
          : "Erro ao conectar com o servidor."
      );
    }
  };

  const styles = {
    container: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      backgroundColor: theme.bg,
      color: theme.textMain,
      fontFamily: "'Inter', sans-serif",
    },
    formBox: {
      backgroundColor: theme.card,
      padding: "40px",
      borderRadius: "24px",
      boxShadow: `0 25px 50px -12px rgba(0,0,0,0.5), 0 0 15px ${theme.accent}1A`, // Brilho sutil na cor do clube
      width: "90%",
      maxWidth: "400px",
      textAlign: "center",
      border: `1px solid ${theme.cardLight}`,
    },
    logoContainer: {
      marginBottom: "20px",
      display: "flex",
      justifyContent: "center",
    },
    logoImage: {
      height: "100px", 
      width: "auto",
      filter: "drop-shadow(0px 4px 10px rgba(0,0,0,0.3))", 
      objectFit: "contain"
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
      backgroundColor: theme.accent, // A cor do clube é aplicada aqui!
      color: "#0f172a",
      border: "none",
      borderRadius: "12px",
      cursor: "pointer",
      fontWeight: "800",
      marginTop: "10px",
      fontSize: "16px",
      boxShadow: `0 10px 15px -3px ${theme.accent}4D`, // Sombra dinâmica na cor do botão
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
        <div style={styles.logoContainer}>
          {/* 5. A MÁGICA DA LOGO: Usa a do banco, ou a do Birdify se não tiver */}
          <img 
            src={clubTheme.logo_url || logoImg} 
            alt={`${clubTheme.name || 'Birdify'} Logo`} 
            style={styles.logoImage} 
          />
        </div>

        {/* 6. NOME DO CLUBE DINÂMICO */}
        <p style={styles.subtitle}>
          Bem-vindo ao <strong style={{color: theme.textMain}}>{clubTheme.name || 'Birdify'}</strong><br/>
          Entre para gerenciar seus scores
        </p>

        <form onSubmit={handleLogin}>
          <span style={styles.label}>E-mail</span>
          <input
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{...styles.input, '&:focus': { borderColor: theme.accent }}}
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

        <div style={{ marginTop: "15px", textAlign: "center" }}>
          <button
            type="button"
            onClick={() => navigate("/forgot-password")}
            style={{
              background: "none",
              border: "none",
              color: theme.textMuted,
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: "14px",
            }}
          >
            Esqueceu sua senha?
          </button>
        </div>

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