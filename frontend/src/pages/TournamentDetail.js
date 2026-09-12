// frontend/src/pages/TournamentDetail.js
// Detalhe do torneio pelo jogador (Onda C · Fase C.4). Substitui o
// antigo MODAL que ficava dentro do PlayerHome — agora é uma tela
// completa, acessada por /torneios/:id, com bottom nav embaixo
// (montada sob PlayerShell). Conteudo IGUAL ao modal anterior:
// descricao, datas, PIX, botao inscrever, WhatsApp e sponsors.
// Na Fase C.6 esta tela ganha layout rico (capa, accordions de
// programacao/premiacao/regulamento) apoiado no schema da C.5.
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import {
  LuArrowLeft,
  LuCalendarDays,
  LuClock,
  LuCopy,
  LuCheck,
  LuMapPin,
} from "react-icons/lu";

const MEDIA_BASE = process.env.REACT_APP_MEDIA_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const mediaUrl = (u) => (!u ? "" : u.startsWith("http") ? u : MEDIA_BASE + u);

function formatDateTime(dateString) {
  if (!dateString) return "--";
  const date = new Date(dateString);
  return date
    .toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
    .replace(",", " às");
}

function buildWhatsappLink(number, message) {
  if (!number) return "";
  const clean = String(number).replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

export default function TournamentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const theme = useBirdifyTheme();
  const { space, radius, shadow, text } = theme;
  const [user] = useState(() => getUser());

  const [t, setT] = useState(null); // null = loading
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [sponsorIdx, setSponsorIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get(`/inscriptions/tournament/${id}`)
      .then((r) => { if (!cancelled) setT(r.data); })
      .catch((e) => {
        if (cancelled) return;
        const status = e.response?.status;
        setErr(status === 404 ? "Torneio não encontrado." : "Não foi possível carregar o torneio.");
        setT({});
      });
    return () => { cancelled = true; };
  }, [id]);

  // Carrossel de sponsors (mesma logica do modal antigo)
  useEffect(() => {
    if (!t?.sponsors || t.sponsors.length <= 1) return;
    const tid = setInterval(() => {
      setSponsorIdx((p) => (p === t.sponsors.length - 1 ? 0 : p + 1));
    }, 4000);
    return () => clearInterval(tid);
  }, [t]);

  const handleInscription = async () => {
    try {
      await api.post("/inscriptions/create", {
        tournament_id: t.id,
        user_id: user.id,
        category_id: null,
      });
      setT((prev) => ({ ...prev, is_subscribed: 1 }));
    } catch (e) {
      if (e.response?.status === 400) {
        alert("Você já está inscrito! Aguarde a aprovação do organizador.");
        setT((prev) => ({ ...prev, is_subscribed: 1 }));
      } else {
        alert("Erro ao realizar inscrição.");
      }
    }
  };

  const handleCopyPix = () => {
    if (!t?.payment_info) return;
    navigator.clipboard.writeText(t.payment_info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const styles = {
    container: {
      backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain,
      fontFamily: theme.font,
      padding: `${space[4]}px ${space[4]}px ${space[6]}px`,
      maxWidth: 560, margin: "0 auto",
    },
    headerRow: {
      display: "flex", alignItems: "center", gap: space[2],
      marginBottom: space[4],
    },
    backBtn: {
      background: "none", border: `1px solid ${theme.border}`,
      borderRadius: radius.sm, padding: space[2],
      color: theme.textMain, cursor: "pointer",
      display: "flex", alignItems: "center",
    },
    infoBox: {
      backgroundColor: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: radius.md, padding: space[4], marginBottom: space[4],
      boxShadow: shadow.sm,
    },
    metaRow: {
      display: "flex", alignItems: "center", gap: space[2],
      ...text.caption, color: theme.textMuted,
    },
    primaryBtn: {
      width: "100%", padding: `${space[4]}px`, backgroundColor: theme.accent,
      color: theme.accentContrast, border: "none", borderRadius: radius.sm,
      fontWeight: 700, cursor: "pointer", fontSize: 14,
      fontFamily: theme.font, marginTop: space[3],
    },
    whatsappBtn: {
      display: "inline-block", padding: `${space[3]}px ${space[4]}px`,
      backgroundColor: theme.whatsapp, color: "#000", borderRadius: radius.sm,
      textDecoration: "none", fontWeight: 700, fontSize: 13,
      fontFamily: theme.font,
    },
    empty: {
      textAlign: "center", padding: space[6],
      backgroundColor: theme.card, border: `1px dashed ${theme.border}`,
      borderRadius: radius.md, color: theme.textMuted,
      ...text.body,
    },
  };

  if (t === null) {
    return (
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <button style={styles.backBtn} onClick={() => navigate("/torneios")} aria-label="Voltar">
            <LuArrowLeft size={18} />
          </button>
        </div>
        <div style={styles.empty}>Carregando torneio…</div>
      </div>
    );
  }

  if (err || !t?.id) {
    return (
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <button style={styles.backBtn} onClick={() => navigate("/torneios")} aria-label="Voltar">
            <LuArrowLeft size={18} />
          </button>
        </div>
        <div style={{ ...styles.empty, color: theme.danger, borderColor: theme.danger }}>
          {err || "Torneio não encontrado."}
        </div>
      </div>
    );
  }

  const whatsappMessage = t.is_subscribed
    ? `Olá! Sou o jogador *${user?.name || ""}*. \n\nSegue o meu comprovante de pagamento referente ao torneio *${t.name}*:`
    : "";
  const whatsappLink = t.is_subscribed
    ? buildWhatsappLink(t.whatsapp_contact, whatsappMessage)
    : "";

  return (
    <div style={styles.container}>
      {/* Header com botao voltar */}
      <div style={styles.headerRow}>
        <button style={styles.backBtn} onClick={() => navigate("/torneios")} aria-label="Voltar">
          <LuArrowLeft size={18} />
        </button>
        <h1 style={{ ...text.h2, color: theme.textMain, margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.name}
        </h1>
      </div>

      {/* Sobre o evento */}
      <div style={styles.infoBox}>
        <p style={{ ...text.overline, color: theme.textMuted, margin: `0 0 ${space[2]}px 0` }}>
          Sobre o evento
        </p>
        {t.description ? (
          <p style={{ margin: `0 0 ${space[4]}px 0`, ...text.body, whiteSpace: "pre-wrap" }}>
            {t.description}
          </p>
        ) : (
          <p style={{ margin: `0 0 ${space[4]}px 0`, ...text.caption, color: theme.textMuted, fontStyle: "italic" }}>
            Sem descrição.
          </p>
        )}

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: space[3], display: "flex", flexDirection: "column", gap: space[2] }}>
          {(t.course_name || t.course_city) && (
            <div style={styles.metaRow}>
              <LuMapPin size={14} />
              <span>
                {t.course_name || "Local a definir"}
                {t.course_city ? ` - ${t.course_city}/${t.course_state}` : ""}
              </span>
            </div>
          )}
          <div style={styles.metaRow}>
            <LuCalendarDays size={14} />
            <span><strong>Início:</strong> {formatDateTime(t.start_date)}</span>
          </div>
          {t.registration_deadline && (
            <div style={{ ...styles.metaRow, color: theme.danger }}>
              <LuClock size={14} />
              <span><strong>Prazo final:</strong> {formatDateTime(t.registration_deadline)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Pagamento (valor + PIX) */}
      {t.payment_info && (
        <div style={{ ...styles.infoBox, borderLeft: `4px solid ${theme.whatsapp}` }}>
          {t.fee && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[3], paddingBottom: space[3], borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ ...text.overline, color: theme.textMuted }}>Valor da inscrição</span>
              <span style={{ fontSize: 15, color: theme.gold, fontWeight: 800 }}>{t.fee}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[2] }}>
            <p style={{ ...text.caption, color: theme.whatsapp, margin: 0, fontWeight: 700 }}>
              PIX ({t.pix_key_type || "Chave Aleatória"})
            </p>
            <button
              onClick={handleCopyPix}
              style={{
                backgroundColor: copied ? theme.whatsapp : "transparent",
                color: copied ? "#000" : theme.whatsapp,
                border: `1px solid ${theme.whatsapp}`,
                padding: `${space[1]}px ${space[3]}px`,
                borderRadius: radius.sm,
                fontSize: 11, cursor: "pointer", fontWeight: 700,
                display: "flex", alignItems: "center", gap: space[1],
                fontFamily: theme.font,
              }}
            >
              {copied ? <LuCheck size={13} /> : <LuCopy size={13} />}
              {copied ? "COPIADO!" : "COPIAR CHAVE"}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t.payment_info}</p>
        </div>
      )}

      {/* Botao inscrever OU bloco "ja esta inscrito" */}
      {!t.is_subscribed ? (
        <button style={styles.primaryBtn} onClick={handleInscription}>
          CONFIRMAR MINHA VAGA
        </button>
      ) : (
        <div style={{ textAlign: "center", padding: space[4], backgroundColor: theme.accentSofter, borderRadius: radius.md, border: `1px solid ${theme.accent}` }}>
          <LuCheck size={28} color={theme.accent} style={{ marginBottom: space[1] }} />
          <h3 style={{ margin: `0 0 ${space[1]}px 0`, ...text.h3, color: theme.accent }}>
            Você já está inscrito!
          </h3>
          <p style={{ ...text.caption, color: theme.textMain, margin: `0 0 ${space[4]}px 0` }}>
            Efetue o pagamento na chave PIX acima e envie o comprovante para garantir sua vaga.
          </p>
          {whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noreferrer" style={styles.whatsappBtn}>
              ENVIAR COMPROVANTE VIA WHATSAPP
            </a>
          )}
        </div>
      )}

      {/* Patrocinadores */}
      {t.sponsors?.length > 0 && (
        <div style={{ marginTop: space[5], borderTop: `1px solid ${theme.border}`, paddingTop: space[4], textAlign: "center" }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
          <p style={{ ...text.overline, color: theme.textMuted, marginBottom: space[4], letterSpacing: 2 }}>
            Patrocínio oficial
          </p>
          <div style={{ height: 90, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <img
              key={sponsorIdx}
              src={mediaUrl(t.sponsors[sponsorIdx].image_url)}
              alt={t.sponsors[sponsorIdx].name || "Patrocinador"}
              style={{ maxHeight: "100%", maxWidth: 250, objectFit: "contain", animation: "fadeIn 0.5s ease-in" }}
            />
          </div>
          {t.sponsors.length > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: space[2], marginTop: space[4] }}>
              {t.sponsors.map((_, idx) => (
                <div
                  key={idx}
                  onClick={() => setSponsorIdx(idx)}
                  style={{
                    width: 8, height: 8, borderRadius: "50%",
                    backgroundColor: sponsorIdx === idx ? theme.accent : theme.cardLight,
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
