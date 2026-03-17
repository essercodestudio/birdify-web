import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo_birdify.png'; // ou o nome que você deu ao arquivo
import './Navbar.css'; // Onde vamos estilizar

const Navbar = () => {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          {/* O logo entra aqui */}
          <img src={logo} alt="Birdify Logo" className="logo-img" />
          <span className="logo-text">Birdify</span>
        </Link>
        
        <div className="nav-menu">
          <Link to="/dashboard" className="nav-item">Dashboard</Link>
          <Link to="/scores" className="nav-item">Scores</Link>
          <button className="logout-btn">Sair</button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;