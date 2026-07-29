// frontend/src/components/AdminNavMenu.js
// Header padrão das páginas do admin: identidade do clube à esquerda, botão ☰
// à direita. O menu abre como drawer lateral (overlay) em qualquer largura de
// tela, com itens agrupados por tema. Todos os itens compartilham o mesmo
// estilo — o único destaque de cor é theme.accent no hover e no item ativo.
// Resolve o item N11 da auditoria (navegação lateral entre áreas admin).
import { useContext, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ThemeContext } from "../App";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { logout } from "../services/session";
import {
  LuChartBar,
  LuSettings,
  LuMegaphone,
  LuTrophy,
  LuCalendarClock,
  LuLink,
  LuFlag,
  LuMenu,
  LuX,
  LuLogOut,
} from "react-icons/lu";

const GROUPS = [
  {
    label: "Gestão",
    items: [
      { icon: LuChartBar, label: "Painel do Gestor", path: "/admin/kpis" },
      { icon: LuSettings, label: "Configurações do Clube", path: "/admin/clube" },
      { icon: LuMegaphone, label: "Patrocinadores", path: "/admin/patrocinadores" },
    ],
  },
  {
    label: "Jogo",
    items: [
      { icon: LuTrophy, label: "Torneios", path: "/dashboard" },
      { icon: LuCalendarClock, label: "Tee Times", path: "/admin/tee-bookings", match: ["/admin/tee-bookings", "/admin/tee-settings"] },
      { icon: LuLink, label: "Circuitos / Ligas", path: "/circuits" },
      { icon: LuFlag, label: "Gerenciar Campos", path: "/courses" },
    ],
  },
];

export default function AdminNavMenu() {
  const theme = useBirdifyTheme();
  const club = useContext(ThemeContext);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const isActive = (item) =>
    (item.match || [item.path]).some((p) => pathname === p || pathname.startsWith(p + "/"));

  const go = (path) => { setOpen(false); navigate(path); };

  const handleLogout = () => logout(navigate);

  const itemStyle = (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "none",
    backgroundColor: active ? theme.accentSoft : "transparent",
    color: active ? theme.accent : theme.textMain,
    fontSize: 14,
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color 0.15s",
  });

  return (
    <>
      <style>{`
        .anm-item:hover { background-color: ${theme.accentSofter} !important; color: ${theme.accent} !important; }
        .anm-exit:hover { background-color: rgba(239, 68, 68, 0.12) !important; }
      `}</style>

      {/* Barra do header: clube à esquerda, ☰ à direita */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingBottom: 14, marginBottom: 20, borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {club?.logo_url && (
            <img src={club.logo_url} alt="" style={{ height: 32, width: 32, objectFit: "contain", borderRadius: 6 }} />
          )}
          <span style={{ fontSize: 17, fontWeight: 800, color: theme.textMain, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {club?.name || "Birdify"}
          </span>
        </div>
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          style={{ padding: "8px 14px", backgroundColor: "transparent", color: theme.textMain, border: `1px solid ${theme.border}`, borderRadius: 8, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          <LuMenu size={18} />
        </button>
      </div>

      {/* Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.55)", zIndex: 1000 }}
        />
      )}

      {/* Drawer lateral */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(300px, 85vw)",
          backgroundColor: theme.card,
          borderLeft: `1px solid ${theme.border}`,
          zIndex: 1001,
          padding: 20,
          boxSizing: "border-box",
          overflowY: "auto",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
            Menu
          </span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            style={{ padding: "6px 10px", backgroundColor: "transparent", color: theme.textMuted, border: "none", lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <LuX size={18} />
          </button>
        </div>

        {GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.5, padding: "0 14px", marginBottom: 6 }}>
              {group.label}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.path} className="anm-item" onClick={() => go(item.path)} style={itemStyle(isActive(item))}>
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}

        {/* Conta — separada do resto por divisória */}
        <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 4, paddingTop: 12 }}>
          <button className="anm-exit" onClick={handleLogout} style={{ ...itemStyle(false), color: theme.danger }}>
            <LuLogOut size={16} />
            Sair
          </button>
        </div>
      </div>
    </>
  );
}
