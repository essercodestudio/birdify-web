// frontend/src/App.js
import React, { useState, useEffect, useContext, useCallback, createContext, Suspense, lazy } from "react";
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
import TrainingRankingPublic from './pages/TrainingRankingPublic';
import PlayerHistory from './pages/PlayerHistory';
import MyPerformance from './pages/MyPerformance';
import CircuitManagement from './pages/CircuitManagement';
import CircuitRankingPublic from './pages/CircuitRankingPublic';
import AdminKPIs from './pages/AdminKPIs';
import ClubSettings from './pages/ClubSettings';
import AdminTeeSettings from './pages/AdminTeeSettings';
import AdminTeeBookings from './pages/AdminTeeBookings';
import AdminSponsors from './pages/AdminSponsors';
import AdminScoreEditor from './pages/AdminScoreEditor';
import AdminScoreAuditLog from './pages/AdminScoreAuditLog';
import TeeTimes from './pages/TeeTimes';
import MyBookings from './pages/MyBookings';
import CoursePreview from './pages/CoursePreview';
import AdminNoAccess from './pages/AdminNoAccess';

// Importação da LGPD e Recuperação de Senha
import LGPDBanner from "./pages/LGPDBanner";
import Privacidade from "./pages/Privacidade";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

// Rota dev-only: /dev/scorephoto-preview.
// process.env.NODE_ENV é substituído em build time; em produção IS_DEV vira
// constante `false` e o Terser elimina o ramo — nenhum chunk async da preview
// é gerado, nem a Route é montada.
const IS_DEV = process.env.NODE_ENV !== "production";
const ScorephotoPreview = IS_DEV ? lazy(() => import("./pages/ScorephotoPreview")) : null;

// ─── helpers ──────────────────────────────────────────────────────────────────
const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const mediaUrl = (url) => {
  if (!url) return "";
  return url.startsWith("http") ? url : MEDIA_BASE + url;
};

// --- 1. CRIANDO A "MEMÓRIA GLOBAL" DO CAMALEÃO ---
export const ThemeContext = createContext();

// Isolamento multi-tenant do admin (2026-08-27): admin sem vínculo em
// club_admins pro clube do domínio atual se comporta como jogador comum.
// AdminRoute e itens de menu admin consultam este contexto (que faz
// preflight em GET /api/admin/me) em vez de olhar só o role local.
// Item 6 (2026-08-28): adminOf lista os clubes em que o user tem vinculo em
// club_admins (id/name/domain). Alimenta a tela AdminNoAccess (link direto
// pro dominio correto do admin cross-tenant) e o RootRoute abaixo.
const AdminMembershipContext = createContext({ loading: true, isAdmin: false, adminOf: [], refresh: () => {} });
export const useAdminMembership = () => useContext(AdminMembershipContext);

function AdminMembershipProvider({ isLoggedIn, children }) {
  const [state, setState] = useState({ loading: true, isAdmin: false, adminOf: [] });
  // Ler o token direto do storage em cada refresh (nao via prop isLoggedIn),
  // porque isLoggedIn no App.js so re-inicializa em outras abas via
  // 'storage' event — mesma aba fica stale apos login/logout. Login.js chama
  // refresh() manualmente apos setSession pra atualizar o contexto.
  const refresh = useCallback(async () => {
    if (!getToken()) { setState({ loading: false, isAdmin: false, adminOf: [] }); return false; }
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.get("/admin/me");
      const isAdmin = !!res.data?.isAdminOfCurrentClub;
      const adminOf = Array.isArray(res.data?.admin_of) ? res.data.admin_of : [];
      setState({ loading: false, isAdmin, adminOf });
      return isAdmin;
    } catch {
      // Falha de rede ou 401 (token expirado). Por seguranca, tratar como nao-admin;
      // AdminRoute vai redirecionar pro /login se o token realmente sumiu.
      setState({ loading: false, isAdmin: false, adminOf: [] });
      return false;
    }
  }, []);
  // Sincroniza quando isLoggedIn muda em outras abas (via storage event).
  useEffect(() => { refresh(); }, [refresh, isLoggedIn]);
  return (
    <AdminMembershipContext.Provider value={{ ...state, refresh }}>
      {children}
    </AdminMembershipContext.Provider>
  );
}

const ProtectedRoute = ({ children }) => {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  // Valida também o objeto user — token órfão (ex: logout que só removeu "user",
  // ou storage corrompido) não pode readmitir alguém nem quebrar telas que leem user.name.
  const user = getUser();
  if (!user || !user.id) return <Navigate to="/login" replace />;
  return children;
};

// AdminRoute reescrito: além de role ADMIN, valida vínculo com o clube do
// dominio atual via /api/admin/me. Sem vinculo -> redireciona pra "/"
// silenciosamente (mesma UX de player comum), nao mostra tela de erro.
// Spinner discreto enquanto o preflight carrega (tipicamente <200ms).
const AdminRoute = ({ children }) => {
  // Hook chamado ANTES de qualquer early return — regra do react-hooks.
  const { loading, isAdmin } = useAdminMembership();
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  const user = getUser();
  if (!user || !user.id) return <Navigate to="/login" replace />;
  if (loading) {
    return (
      <div style={{ backgroundColor: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
        Carregando…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
};

// Item 6 (2026-08-28): rota "/" decide destino conforme papel + vinculo.
//   - sem token         → /login
//   - PLAYER            → PlayerHome (como sempre)
//   - ADMIN + vinculo   → /dashboard (nunca ve tela de jogador)
//   - ADMIN sem vinculo → AdminNoAccess (com links pros clubes que administra)
// Sem este wrapper, admin sem vinculo caia em PlayerHome se comportando como
// jogador comum — exatamente o que a regra de produto quer proibir.
const RootRoute = () => {
  const { loading, isAdmin, adminOf } = useAdminMembership();
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  const user = getUser();
  if (!user || !user.id) return <Navigate to="/login" replace />;
  if (loading) {
    return (
      <div style={{ backgroundColor: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
        Carregando…
      </div>
    );
  }
  if (user.role === "ADMIN") {
    if (isAdmin) return <Navigate to="/dashboard" replace />;
    // Admin sem vinculo NO CLUBE atual — mesmo que admin_of tenha outros.
    // Renderiza AdminNoAccess (tela com lista de dominios corretos + Sair).
    return <AdminNoAccess />;
  }
  return <PlayerHome />;
};

// PlayerRoute: rotas de fluxo de jogador (scorecard, treino, tee time, etc.).
// Alem do requireAuth padrao, redireciona admin de volta pra "/" — que por sua
// vez roteia pra /dashboard (se admin do clube) ou AdminNoAccess (se cross-tenant).
// Nunca permite renderizar UI de jogador pra admin.
const PlayerRoute = ({ children }) => {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  const user = getUser();
  if (!user || !user.id) return <Navigate to="/login" replace />;
  if (user.role === "ADMIN") return <Navigate to="/" replace />;
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
     <AdminMembershipProvider isLoggedIn={isLoggedIn}>
      <Router>
        <LGPDBanner />

        <div style={{ paddingBottom: showSponsorBar ? "65px" : 0 }}>
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />

            {/* Telas de gerenciamento admin (torneios, grupos, campos, circuitos) —
                AdminRoute com preflight de vinculo. Antes eram ProtectedRoute,
                o que deixava player logado abrir e admin cross-tenant enxergar
                dados do clube errado (fix 2026-08-27). */}
            <Route path="/dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
            <Route path="/tournament/:id" element={<AdminRoute><TournamentManager /></AdminRoute>} />
            <Route path="/scorecard/:groupId" element={<PlayerRoute><Scorecard /></PlayerRoute>} />
            <Route path="/leaderboard/:tournamentId" element={<Leaderboard />} />
            <Route path="/courses" element={<AdminRoute><CourseManager /></AdminRoute>} />
            {/* Rota legada: PlayerDashboard foi unificado com JoinGame em PlayerHome ("/") */}
            <Route path="/player" element={<Navigate to="/" replace />} />

            {/* ROTAS DE TREINO — sao fluxo de jogador, admin nao entra */}
            <Route path="/daily-training" element={<PlayerRoute><DailyTraining /></PlayerRoute>} />
            <Route path="/training-scorecard/:groupId" element={<PlayerRoute><TrainingScorecard /></PlayerRoute>} />
            {/* Ranking do dia é PÚBLICO — compartilhável sem exigir login. */}
            <Route path="/training-leaderboard" element={<TrainingLeaderboard />} />
            <Route path="/treino/:groupId/ranking" element={<TrainingRankingPublic />} />
            {/* Rota pública sem âncora — link compartilhável do dia inteiro do clube.
                Usada como fallback do botão de share quando o usuário não veio
                do próprio scorecard (não tem returnGroupId no state). */}
            <Route path="/ranking/dia" element={<TrainingRankingPublic />} />
            <Route path="/player-history" element={<PlayerRoute><PlayerHistory /></PlayerRoute>} />
            <Route path="/my-performance" element={<PlayerRoute><MyPerformance /></PlayerRoute>} />
            <Route path="/circuits" element={<AdminRoute><CircuitManagement /></AdminRoute>} />
            <Route path="/ranking/:circuitId" element={<CircuitRankingPublic />} />
            <Route path="/admin/kpis" element={<AdminRoute><AdminKPIs /></AdminRoute>} />
            <Route path="/admin/clube" element={<AdminRoute><ClubSettings /></AdminRoute>} />
            <Route path="/admin/tee-settings" element={<AdminRoute><AdminTeeSettings /></AdminRoute>} />
            <Route path="/admin/tee-bookings" element={<AdminRoute><AdminTeeBookings /></AdminRoute>} />
            <Route path="/admin/patrocinadores" element={<AdminRoute><AdminSponsors /></AdminRoute>} />
            <Route path="/admin/ajustar-scores" element={<AdminRoute><AdminScoreEditor /></AdminRoute>} />
            <Route path="/admin/scores-auditoria" element={<AdminRoute><AdminScoreAuditLog /></AdminRoute>} />
            <Route path="/tee-times" element={<PlayerRoute><TeeTimes /></PlayerRoute>} />
            <Route path="/my-bookings" element={<PlayerRoute><MyBookings /></PlayerRoute>} />
            <Route path="/campo/:courseId" element={<CoursePreview />} />

            <Route path="/privacidade" element={<Privacidade />} />

            {/* DEV-ONLY: preview do Scorephoto com dados mockados */}
            {IS_DEV && ScorephotoPreview && (
              <Route
                path="/dev/scorephoto-preview"
                element={
                  <Suspense fallback={<div style={{ padding: 24, color: "#f8fafc" }}>Carregando preview...</div>}>
                    <ScorephotoPreview />
                  </Suspense>
                }
              />
            )}

            {/* Catch-all: qualquer rota desconhecida cai numa 404 amigável, não em tela branca */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>

        {showSponsorBar && <GlobalSponsorsBar sponsors={globalSponsors} />}
      </Router>
     </AdminMembershipProvider>
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