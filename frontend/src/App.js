// frontend/src/App.js
import React, { useState, useEffect, createContext } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import api from "./services/api";
import syncService from "./services/syncService";

// Importação das Páginas
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import TournamentManager from "./pages/TournamentManager";
import JoinGame from "./pages/JoinGame";
import Scorecard from "./pages/Scorecard";
import Leaderboard from "./pages/Leaderboard";
import CourseManager from "./pages/CourseManager";
import PlayerDashboard from "./pages/PlayerDashboard";
import DailyTraining from "./pages/DailyTraining";
import TrainingScorecard from './pages/TrainingScorecard';
import TrainingLeaderboard from './pages/TrainingLeaderboard';
import PlayerHistory from './pages/PlayerHistory';
import CircuitManagement from './pages/CircuitManagement';
import CircuitRankingPublic from './pages/CircuitRankingPublic';

// Importação da LGPD e Recuperação de Senha
import LGPDBanner from "./pages/LGPDBanner";
import Privacidade from "./pages/Privacidade";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

// ─── helpers ──────────────────────────────────────────────────────────────────
const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const mediaUrl = (url) => {
  if (!url) return "";
  return url.startsWith("http") ? url : MEDIA_BASE + url;
};

// --- 1. CRIANDO A "MEMÓRIA GLOBAL" DO CAMALEÃO ---
export const ThemeContext = createContext();

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
};

function App() {
  const [clubTheme, setClubTheme] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [globalSponsors, setGlobalSponsors] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem("token"));

  // --- 2. O DESPERTAR DO CAMALEÃO ---
  useEffect(() => {
    const fetchTheme = async () => {
      try {
        const response = await api.get("/theme"); 
        const data = response.data;
        
        setClubTheme(data);

        // Identidade na aba do navegador
        document.title = data.name ? `${data.name} | Birdify` : "Birdify Golf";

        if (data.logo_url) {
          const favicon = document.getElementById("favicon");
          if (favicon) {
            favicon.href = data.logo_url;
          }
        }

        // Injeção de Estilos CSS
        if (data.primary_color) {
          document.documentElement.style.setProperty('--color-primary', data.primary_color);
        }
        if (data.background_color) {
          document.documentElement.style.setProperty('--color-bg', data.background_color);
        }

      } catch (error) {
        console.error("🕵️ Erro ao carregar tema. Usando padrão Birdify:", error);
        
        setClubTheme({ 
          id: 1, 
          name: "Birdify", 
          primary_color: "#22c55e", 
          logo_url: "" 
        });
        document.title = "Birdify Golf";
      } finally {
        setIsLoading(false);
      }
    };

    fetchTheme();
  }, []);

  useEffect(() => {
    api.get("/circuits/club-sponsors")
      .then(r => setGlobalSponsors(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setIsLoggedIn(!!localStorage.getItem("token"));
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  // Gerenciador de reconexão global: registra listener 'online' uma única vez
  // e tenta drenar a fila ao abrir o app (útil quando o usuário voltou após F5
  // com tacadas pendentes do treino anterior).
  useEffect(() => { syncService.bootstrap(); }, []);

  if (isLoading) {
    return (
      <div style={{ backgroundColor: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        Carregando sistema...
      </div>
    );
  }

  const showSponsorBar = isLoggedIn && globalSponsors.length > 0;

  return (
    // --- 3. ABRAÇANDO O SITE COM O CONTEXTO DE CORES ---
    <ThemeContext.Provider value={clubTheme}>
      <Router>
        <LGPDBanner />

        <div style={{ paddingBottom: showSponsorBar ? "65px" : 0 }}>
          <Routes>
            <Route path="/" element={<JoinGame />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />

            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/tournament/:id" element={<ProtectedRoute><TournamentManager /></ProtectedRoute>} />
            <Route path="/scorecard/:groupId" element={<ProtectedRoute><Scorecard /></ProtectedRoute>} />
            <Route path="/leaderboard/:tournamentId" element={<Leaderboard />} />
            <Route path="/courses" element={<ProtectedRoute><CourseManager /></ProtectedRoute>} />
            <Route path="/player" element={<ProtectedRoute><PlayerDashboard /></ProtectedRoute>} />

            {/* ROTAS DE TREINO */}
            <Route path="/daily-training" element={<ProtectedRoute><DailyTraining /></ProtectedRoute>} />
            <Route path="/training-scorecard/:groupId" element={<ProtectedRoute><TrainingScorecard /></ProtectedRoute>} />
            <Route path="/training-leaderboard" element={<ProtectedRoute><TrainingLeaderboard /></ProtectedRoute>} />
            <Route path="/player-history" element={<ProtectedRoute><PlayerHistory /></ProtectedRoute>} />
            <Route path="/circuits" element={<ProtectedRoute><CircuitManagement /></ProtectedRoute>} />
            <Route path="/ranking/:circuitId" element={<CircuitRankingPublic />} />

            <Route path="/privacidade" element={<Privacidade />} />
          </Routes>
        </div>

        {showSponsorBar && <GlobalSponsorsBar sponsors={globalSponsors} />}
      </Router>
    </ThemeContext.Provider>
  );
}

export default App;

function GlobalSponsorsBar({ sponsors }) {
  return (
    <div style={{
      position: "fixed",
      bottom: 0, left: 0, right: 0,
      backgroundColor: "#ffffff",
      boxShadow: "0 -2px 10px rgba(0,0,0,0.05)",
      zIndex: 9999,
      overflowX: "auto",
      WebkitOverflowScrolling: "touch",
      scrollbarWidth: "none",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        minWidth: "max-content",
        height: "65px",
        padding: "0 8px",
      }}>
        {sponsors.map((sp, idx) => (
          <React.Fragment key={sp.id}>
            {idx > 0 && (
              <div style={{
                width: "1px",
                height: "25px",
                backgroundColor: "#e2e8f0",
                flexShrink: 0,
                alignSelf: "center",
              }} />
            )}
            <div style={{ flexShrink: 0 }}>
              {sp.link_url ? (
                <a href={sp.link_url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", textDecoration: "none" }}>
                  <LogoSlot sp={sp} />
                </a>
              ) : (
                <LogoSlot sp={sp} />
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function LogoSlot({ sp }) {
  return sp.logo_url ? (
    <div style={{
      width: "100px",
      height: "45px",
      padding: "6px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}>
      <img
        src={mediaUrl(sp.logo_url)}
        alt={sp.name}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  ) : (
    <div style={{
      width: "100px",
      height: "45px",
      padding: "6px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: "12px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap", textAlign: "center" }}>
        {sp.name}
      </span>
    </div>
  );
}