// frontend/src/App.js
import React, { useState, useEffect, createContext } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import api from "./services/api";
import syncService from "./services/syncService";
import { getToken, getUser } from "./services/authStorage";
import { useIsMobile } from "./hooks/useIsMobile";

// Importação das Páginas
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import TournamentManager from "./pages/TournamentManager";
import PlayerHome from "./pages/PlayerHome";
import Scorecard from "./pages/Scorecard";
import Leaderboard from "./pages/Leaderboard";
import CourseManager from "./pages/CourseManager";
import DailyTraining from "./pages/DailyTraining";
import TrainingScorecard from './pages/TrainingScorecard';
import TrainingLeaderboard from './pages/TrainingLeaderboard';
import PlayerHistory from './pages/PlayerHistory';
import CircuitManagement from './pages/CircuitManagement';
import CircuitRankingPublic from './pages/CircuitRankingPublic';
import AdminKPIs from './pages/AdminKPIs';
import ClubSettings from './pages/ClubSettings';
import AdminTeeSettings from './pages/AdminTeeSettings';
import AdminTeeBookings from './pages/AdminTeeBookings';
import AdminSponsors from './pages/AdminSponsors';
import TeeTimes from './pages/TeeTimes';
import MyBookings from './pages/MyBookings';
import CoursePreview from './pages/CoursePreview';

// Importação da LGPD e Recuperação de Senha
import LGPDBanner from "./pages/LGPDBanner";
import Privacidade from "./pages/Privacidade";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

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
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  // Valida também o objeto user — token órfão (ex: logout que só removeu "user",
  // ou storage corrompido) não pode readmitir alguém nem quebrar telas que leem user.name.
  const user = getUser();
  if (!user || !user.id) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;
  return children;
};

function App() {
  const [clubTheme, setClubTheme] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [globalSponsors, setGlobalSponsors] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getToken());
  const isMobile = useIsMobile();

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
    const sync = () => setIsLoggedIn(!!getToken());
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

  // Barra global de patrocinadores: SÓ no mobile. Desktop tem mais espaço lateral
  // pra sponsors aparecerem em outros lugares; o rodapé fixo era pra economizar
  // scroll no celular. A rota /circuits/club-sponsors é pública.
  const showSponsorBar = isMobile && globalSponsors.length > 0;

  return (
    // --- 3. ABRAÇANDO O SITE COM O CONTEXTO DE CORES ---
    <ThemeContext.Provider value={clubTheme}>
      <Router>
        <LGPDBanner />

        <div style={{ paddingBottom: showSponsorBar ? "65px" : 0 }}>
          <Routes>
            <Route path="/" element={<ProtectedRoute><PlayerHome /></ProtectedRoute>} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />

            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/tournament/:id" element={<ProtectedRoute><TournamentManager /></ProtectedRoute>} />
            <Route path="/scorecard/:groupId" element={<ProtectedRoute><Scorecard /></ProtectedRoute>} />
            <Route path="/leaderboard/:tournamentId" element={<Leaderboard />} />
            <Route path="/courses" element={<ProtectedRoute><CourseManager /></ProtectedRoute>} />
            {/* Rota legada: PlayerDashboard foi unificado com JoinGame em PlayerHome ("/") */}
            <Route path="/player" element={<Navigate to="/" replace />} />

            {/* ROTAS DE TREINO */}
            <Route path="/daily-training" element={<ProtectedRoute><DailyTraining /></ProtectedRoute>} />
            <Route path="/training-scorecard/:groupId" element={<ProtectedRoute><TrainingScorecard /></ProtectedRoute>} />
            {/* Ranking do dia é PÚBLICO — compartilhável sem exigir login. */}
            <Route path="/training-leaderboard" element={<TrainingLeaderboard />} />
            <Route path="/player-history" element={<ProtectedRoute><PlayerHistory /></ProtectedRoute>} />
            <Route path="/circuits" element={<ProtectedRoute><CircuitManagement /></ProtectedRoute>} />
            <Route path="/ranking/:circuitId" element={<CircuitRankingPublic />} />
            <Route path="/admin/kpis" element={<AdminRoute><AdminKPIs /></AdminRoute>} />
            <Route path="/admin/clube" element={<AdminRoute><ClubSettings /></AdminRoute>} />
            <Route path="/admin/tee-settings" element={<AdminRoute><AdminTeeSettings /></AdminRoute>} />
            <Route path="/admin/tee-bookings" element={<AdminRoute><AdminTeeBookings /></AdminRoute>} />
            <Route path="/admin/patrocinadores" element={<AdminRoute><AdminSponsors /></AdminRoute>} />
            <Route path="/tee-times" element={<ProtectedRoute><TeeTimes /></ProtectedRoute>} />
            <Route path="/my-bookings" element={<ProtectedRoute><MyBookings /></ProtectedRoute>} />
            <Route path="/campo/:courseId" element={<CoursePreview />} />

            <Route path="/privacidade" element={<Privacidade />} />

            {/* Catch-all: qualquer rota desconhecida cai numa 404 amigável, não em tela branca */}
            <Route path="*" element={<NotFound />} />
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