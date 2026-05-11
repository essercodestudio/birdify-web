// frontend/src/App.js
import React, { useState, useEffect, createContext } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import api from "./services/api"; // Importando a sua conexão com o backend

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

// Importação da LGPD e Recuperação de Senha
import LGPDBanner from "./pages/LGPDBanner"; 
import Privacidade from "./pages/Privacidade";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

// --- 1. CRIANDO A "MEMÓRIA GLOBAL" DO CAMALEÃO ---
export const ThemeContext = createContext();

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
};

function App() {
  const [clubTheme, setClubTheme] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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

  if (isLoading) {
    return (
      <div style={{ backgroundColor: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        Carregando sistema...
      </div>
    );
  }

  return (
    // --- 3. ABRAÇANDO O SITE COM O CONTEXTO DE CORES ---
    <ThemeContext.Provider value={clubTheme}>
      <Router>
        <LGPDBanner />

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
          
          <Route path="/privacidade" element={<Privacidade />} />
        </Routes>
      </Router>
    </ThemeContext.Provider>
  );
}

export default App;