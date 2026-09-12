// frontend/src/components/PlayerBottomNav.js
// Barra de navegação inferior fixa do jogador (Onda C · Fase C.1).
// Aparece apenas em rotas envoltas por PlayerShell — nunca em admin,
// nunca em telas full-screen (Scorecard, TrainingScorecard), nunca em
// rotas públicas (login, leaderboard, ranking/:id, campo/:id).
//
// O item ativo é determinado pela pathname atual. Sub-rotas herdam:
// /torneios/:id ativa "Torneios", /rankings/:id ativa "Rankings", etc.
import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LuHouse, LuTrophy, LuMedal, LuMenu } from "react-icons/lu";

const ITEMS = [
  { to: "/", label: "Início", Icon: LuHouse, prefix: null },
  { to: "/torneios", label: "Torneios", Icon: LuTrophy, prefix: "/torneios" },
  { to: "/rankings", label: "Rankings", Icon: LuMedal, prefix: "/rankings" },
  { to: "/mais", label: "Mais", Icon: LuMenu, prefix: "/mais" },
];

const NAV_HEIGHT = 64;
export const PLAYER_NAV_HEIGHT = NAV_HEIGHT;

export default function PlayerBottomNav({ bottomOffset = 0 }) {
  const { pathname } = useLocation();

  return (
    <nav
      role="navigation"
      aria-label="Navegação do jogador"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: bottomOffset,
        height: NAV_HEIGHT,
        backgroundColor: "#1e293b",
        borderTop: "1px solid #334155",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-around",
        zIndex: 9998,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxSizing: "content-box",
      }}
    >
      {ITEMS.map(({ to, label, Icon, prefix }) => {
        const active = prefix
          ? pathname === prefix || pathname.startsWith(prefix + "/")
          : pathname === "/";
        const color = active ? "#22c55e" : "#94a3b8";
        return (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              color,
              textDecoration: "none",
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              padding: "6px 0",
              minWidth: 0,
            }}
          >
            <Icon size={22} aria-hidden />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
