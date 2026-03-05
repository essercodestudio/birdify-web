// frontend/src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Importação das Páginas
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import TournamentManager from './pages/TournamentManager';
import JoinGame from './pages/JoinGame'; 
import Scorecard from './pages/Scorecard';
import Leaderboard from './pages/Leaderboard'; 
import CourseManager from './pages/CourseManager';
import PlayerDashboard from './pages/PlayerDashboard';

function App() {
  return (
    <Router>
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
        
        {/* --- 2. ESTA LINHA É A QUE FALTA PARA O ERRO SUMIR --- */}
        <Route path="/leaderboard/:tournamentId" element={<Leaderboard />} />

        <Route path="/courses" element={<CourseManager />} />

        <Route path="/player" element={<PlayerDashboard />} />
        
      </Routes>
    </Router>
  );
}

export default App;