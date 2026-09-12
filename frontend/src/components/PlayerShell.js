// frontend/src/components/PlayerShell.js
// Layout wrapper das rotas de jogador (Onda C · Fase C.1). Renderiza o
// conteúdo (via children OU <Outlet/>) e monta a bottom nav embaixo.
//
// Empilhamento com GlobalSponsorsBar (App.js):
//   - O wrapper geral do App.js já aplica paddingBottom=65 quando o
//     sponsors bar está visível (pra reservar o espaço do bar).
//   - Este shell soma APENAS a altura da nav (64) como padding próprio,
//     nunca a altura do sponsor bar. Total 65+64=129 quando ambos.
//   - A nav sobe pra bottom:65 quando sponsors visível, senão bottom:0.
//
// Uso:
//   <Route element={<PlayerShell hasSponsorBar={showSponsorBar} />}>
//     <Route path="/torneios" ... />
//   </Route>
//
//   // ou, quando outra rota já decidiu qual componente renderizar
//   // (ex.: RootRoute serve PlayerHome pra player):
//   <PlayerShell hasSponsorBar={x}><PlayerHome /></PlayerShell>
import React from "react";
import { Outlet } from "react-router-dom";
import PlayerBottomNav, { PLAYER_NAV_HEIGHT } from "./PlayerBottomNav";

const SPONSOR_BAR_HEIGHT = 65;

export default function PlayerShell({ children, hasSponsorBar = false }) {
  const navBottom = hasSponsorBar ? SPONSOR_BAR_HEIGHT : 0;

  return (
    <>
      <div style={{ paddingBottom: PLAYER_NAV_HEIGHT }}>
        {children ?? <Outlet />}
      </div>
      <PlayerBottomNav bottomOffset={navBottom} />
    </>
  );
}
