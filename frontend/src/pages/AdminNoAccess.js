// frontend/src/pages/AdminNoAccess.js
// Tela mostrada quando uma conta com role=ADMIN se autentica num domínio
// onde ela NÃO é admin. Item 6 (2026-08-28): conta admin nunca entra em
// experiência de jogador — sem esta tela, o AdminRoute redirecionava
// pra "/" e o PlayerHome renderizava como se fosse jogador comum.
//
// Se o backend expôs admin_of=[], listamos os clubes com link direto pro
// domínio correto. Sem essa lista, só mostra a mensagem + Sair.
import React, { useContext } from "react";
import { ThemeContext, useAdminMembership } from "../App";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import { logout } from "../services/session";
import { useNavigate } from "react-router-dom";
import { LuShieldAlert, LuExternalLink, LuLogOut } from "react-icons/lu";

export default function AdminNoAccess() {
  const club = useContext(ThemeContext) || {};
  const theme = useBirdifyTheme();
  const navigate = useNavigate();
  const { adminOf } = useAdminMembership();

  const handleLogout = () => logout(navigate);

  const linkFor = (domain) => {
    if (!domain) return null;
    // Se o domínio for localhost/IP direto (dev), não sabemos protocolo — assume HTTPS
    // pra produção; em dev o admin normalmente edita hosts pra alcançar.
    const scheme = /localhost|127\.0\.0\.1/.test(domain) ? "http" : "https";
    return `${scheme}://${domain}`;
  };

  return (
    <div style={{
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      padding: "40px 20px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: 28,
        boxShadow: theme.shadow?.lg || "0 10px 30px rgba(0,0,0,0.35)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <LuShieldAlert size={28} color={theme.gold} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Acesso restrito</h1>
        </div>

        <p style={{ color: theme.textMain, fontSize: 14, lineHeight: 1.55, margin: "0 0 12px 0" }}>
          Você está autenticado como <strong>administrador</strong>, mas não tem vínculo
          com o clube <strong>{club?.name || "atual"}</strong>. Contas de administrador
          não têm funções de jogador — nem neste clube nem em nenhum outro.
        </p>

        {adminOf && adminOf.length > 0 ? (
          <>
            <p style={{ color: theme.textMuted, fontSize: 13, margin: "18px 0 8px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
              Você administra:
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0" }}>
              {adminOf.map((c) => {
                const link = linkFor(c.domain);
                return (
                  <li key={c.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 14px", backgroundColor: theme.bg,
                    borderRadius: 10, marginBottom: 8, border: `1px solid ${theme.border}`,
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                        {c.domain || "domínio não configurado"}
                      </div>
                    </div>
                    {link ? (
                      <a
                        href={link}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "8px 12px", borderRadius: 8,
                          backgroundColor: theme.accent, color: theme.accentContrast || "#000",
                          fontWeight: 700, fontSize: 12, textDecoration: "none",
                        }}
                      >
                        Abrir <LuExternalLink size={12} />
                      </a>
                    ) : (
                      <span style={{ fontSize: 11, color: theme.textMuted }}>—</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p style={{ color: theme.textMuted, fontSize: 13, margin: "18px 0" }}>
            Sua conta ainda não tem clubes vinculados. Fale com o time Birdify.
          </p>
        )}

        <button
          onClick={handleLogout}
          style={{
            width: "100%", padding: "12px 16px", marginTop: 8,
            backgroundColor: "transparent", color: theme.danger,
            border: `1px solid ${theme.danger}55`, borderRadius: 10,
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <LuLogOut size={15} />
          Sair da conta
        </button>
      </div>
    </div>
  );
}
