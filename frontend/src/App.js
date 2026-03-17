// frontend/src/App.js
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

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

// --- 1. IMPORTAR OS NOVOS ARQUIVOS DA LGPD ---
import LGPDBanner from "./pages/LGPDBanner";
import Privacidade from "./pages/Privacidade";

function App() {
  return (
    <Router>
      {/* --- 2. O BANNER APARECE EM TODO O SITE --- */}
      <LGPDBanner />

      <Routes>
        {/* Tela Inicial */}
        <Route path="/" element={<JoinGame />} />

        {/* Autenticação */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Área do Admin */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tournament/:id" element={<TournamentManager />} />

        {/* Área do Jogo */}
        <Route path="/scorecard/:groupId" element={<Scorecard />} />

        <Route path="/leaderboard/:tournamentId" element={<Leaderboard />} />
        <Route path="/courses" element={<CourseManager />} />
        <Route path="/player" element={<PlayerDashboard />} />

        {/* --- 3. NOVA ROTA PARA A POLÍTICA DE PRIVACIDADE --- */}
        <Route path="/privacidade" element={<Privacidade />} />
      </Routes>
    </Router>
  );
}

export default App;
