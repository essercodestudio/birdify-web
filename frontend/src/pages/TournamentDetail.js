// frontend/src/pages/TournamentDetail.js
// Detalhe rico do torneio pelo jogador (Onda C · Fase C.6). Substitui
// o layout enxuto da C.4 pelo formato "app nativo": banner de capa,
// header enriquecido, CTA de inscrição em destaque, seções expansíveis
// (accordions) pros 4 tópicos que o admin cadastra (Informações,
// Programação, Premiação, Regulamento). Cada seção só aparece se o
// admin preencheu — fallback pros torneios legados que ficam com todos
// os campos NULL.
//
// Endpoint: GET /inscriptions/tournament/:id (aumentado na Fase C.4
// pra devolver course_name/city/state + is_subscribed + campos C.5).
import React, { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { ThemeContext } from "../App";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import {
  LuArrowLeft,
  LuCalendarDays,
  LuClock,
  LuCopy,
  LuCheck,
  LuMapPin,
  LuInfo,
  LuClipboardList,
  LuTrophy,
  LuBookOpen,
  LuChevronDown,
  LuChevronUp,
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
function formatDateOnly(dateString) {
  if (!dateString) return "--";
  const d = new Date(dateString);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
function formatLabel(fmt) {
  return fmt === "tee_time" ? "Tee Time" : "Shotgun";
}
function buildWhatsappLink(number, message) {
  if (!number) return "";
  const clean = String(number).replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

// ─── Accordion inline: 1 seção expansível ─────────────────────────────────
// Só renderiza se `content` tiver texto — o pai já filtra, mas defensivo.
function Section({ icon: Icon, title, content, defaultOpen = false, theme }) {
  const [open, setOpen] = useState(defaultOpen);
  const { space, radius, text } = theme;
  if (!content || !String(content).trim()) return null;
  return (
    <div style={{
      backgroundColor: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: radius.md, marginBottom: space[3], overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: space[3],
          padding: `${space[4]}px ${space[4]}px`, background: "transparent",
          border: "none", cursor: "pointer", color: theme.textMain,
          textAlign: "left", fontFamily: theme.font,
        }}
      >
        <span style={{
          width: 36, height: 36, borderRadius: radius.sm,
          backgroundColor: theme.accentSoft, color: theme.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Icon size={18} />
        </span>
        <span style={{ ...text.h3, color: theme.textMain, flex: 1, minWidth: 0 }}>{title}</span>
        {open ? <LuChevronUp size={18} color={theme.textMuted} /> : <LuChevronDown size={18} color={theme.textMuted} />}
      </button>
      {open && (
        <div style={{
          padding: `0 ${space[4]}px ${space[4]}px ${space[4]}px`,
          ...text.body, color: theme.textMain, whiteSpace: "pre-wrap",
          borderTop: `1px solid ${theme.border}`, paddingTop: space[3],
        }}>
          {content}
        </div>
      )}
    </div>
  );
}

export default function TournamentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const club = useContext(ThemeContext) || {};
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
        tournament_id: t.id, user_id: user.id, category_id: null,
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
      fontFamily: theme.font, maxWidth: 560, margin: "0 auto",
      // padding lateral só nos blocos internos — banner ocupa full-width do container.
    },
    hero: {
      position: "relative", width: "100%", aspectRatio: "16 / 9",
      backgroundColor: theme.cardLight,
      overflow: "hidden",
    },
    heroImg: {
      width: "100%", height: "100%", objectFit: "cover", display: "block",
    },
    heroPlaceholder: {
      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      color: theme.textMuted, ...text.overline, letterSpacing: 2,
      background: `linear-gradient(135deg, ${theme.cardLight}, ${theme.card})`,
    },
    backChip: {
      position: "absolute", top: space[3], left: space[3], zIndex: 2,
      display: "inline-flex", alignItems: "center", gap: space[1],
      background: "rgba(15, 23, 42, 0.75)", color: theme.textMain,
      border: `1px solid rgba(255,255,255,0.15)`,
      borderRadius: radius.pill, padding: `${space[2]}px ${space[3]}px`,
      fontSize: 12, fontWeight: 700, cursor: "pointer",
      backdropFilter: "blur(6px)", fontFamily: theme.font,
    },
    body: { padding: `${space[5]}px ${space[4]}px ${space[6]}px` },
    headerBlock: { marginBottom: space[5] },
    name: { ...text.h1, color: theme.textMain, margin: `0 0 ${space[2]}px 0`, lineHeight: 1.2 },
    subtitle: {
      display: "flex", flexWrap: "wrap", gap: `${space[1]}px ${space[3]}px`,
      ...text.caption, color: theme.textMuted,
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
      fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: theme.font,
      marginBottom: space[4],
    },
    whatsappBtn: {
      display: "inline-block", padding: `${space[3]}px ${space[4]}px`,
      backgroundColor: theme.whatsapp, color: "#000", borderRadius: radius.sm,
      textDecoration: "none", fontWeight: 700, fontSize: 13, fontFamily: theme.font,
    },
    empty: {
      textAlign: "center", padding: space[6],
      backgroundColor: theme.card, border: `1px dashed ${theme.border}`,
      borderRadius: radius.md, color: theme.textMuted, ...text.body,
      margin: space[4],
    },
    sectionsWrap: { marginTop: space[5] },
  };

  const renderBackHeader = () => (
    <div style={styles.hero}>
      {t?.cover_image_path ? (
        <img src={mediaUrl(t.cover_image_path)} alt="Capa do torneio" style={styles.heroImg} />
      ) : (
        <div style={styles.heroPlaceholder}>SEM CAPA</div>
      )}
      <button onClick={() => navigate("/torneios")} style={styles.backChip} aria-label="Voltar">
        <LuArrowLeft size={14} />
        Voltar
      </button>
    </div>
  );

  if (t === null) {
    return (
      <div style={styles.container}>
        {renderBackHeader()}
        <div style={styles.empty}>Carregando torneio…</div>
      </div>
    );
  }
  if (err || !t?.id) {
    return (
      <div style={styles.container}>
        {renderBackHeader()}
        <div style={{ ...styles.empty, color: theme.danger, borderColor: theme.danger }}>
          {err || "Torneio não encontrado."}
        </div>
      </div>
    );
  }

  // "Sobre o evento" — event_summary novo tem prioridade; fallback pra
  // description (legado). Se nenhum, seção some.
  const aboutText = (t.event_summary && t.event_summary.trim())
    || (t.description && t.description.trim())
    || "";

  const whatsappMessage = t.is_subscribed
    ? `Olá! Sou o jogador *${user?.name || ""}*. \n\nSegue o meu comprovante de pagamento referente ao torneio *${t.name}*:`
    : "";
  const whatsappLink = t.is_subscribed
    ? buildWhatsappLink(t.whatsapp_contact, whatsappMessage)
    : "";

  return (
    <div style={styles.container}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* Hero: banner + botão voltar sobreposto */}
      {renderBackHeader()}

      <div style={styles.body}>
        {/* Header enriquecido: nome + linha de subtítulo (clube · data · formato) */}
        <div style={styles.headerBlock}>
          <h1 style={styles.name}>{t.name}</h1>
          <div style={styles.subtitle}>
            {club.name && <span>{club.name}</span>}
            {club.name && <span aria-hidden>·</span>}
            <span>{formatDateOnly(t.start_date)}</span>
            <span aria-hidden>·</span>
            <span>{formatLabel(t.format)}</span>
          </div>
        </div>

        {/* CTA de inscrição — em destaque, logo abaixo do header */}
        {!t.is_subscribed ? (
          <button style={styles.primaryBtn} onClick={handleInscription}>
            INSCREVER-SE
          </button>
        ) : (
          <div style={{ ...styles.infoBox, textAlign: "center", backgroundColor: theme.accentSofter, borderColor: theme.accent }}>
            <LuCheck size={28} color={theme.accent} style={{ marginBottom: space[1] }} />
            <h3 style={{ margin: `0 0 ${space[1]}px 0`, ...text.h3, color: theme.accent }}>
              Você já está inscrito!
            </h3>
            <p style={{ ...text.caption, color: theme.textMain, margin: `0 0 ${space[4]}px 0` }}>
              Efetue o pagamento na chave PIX abaixo e envie o comprovante para garantir sua vaga.
            </p>
            {whatsappLink && (
              <a href={whatsappLink} target="_blank" rel="noreferrer" style={styles.whatsappBtn}>
                ENVIAR COMPROVANTE VIA WHATSAPP
              </a>
            )}
          </div>
        )}

        {/* Sobre o evento — só se tiver texto (event_summary preferido, description fallback) */}
        {aboutText && (
          <div style={styles.infoBox}>
            <p style={{ ...text.overline, color: theme.textMuted, margin: `0 0 ${space[2]}px 0` }}>
              Sobre o evento
            </p>
            <p style={{ margin: 0, ...text.body, whiteSpace: "pre-wrap" }}>
              {aboutText}
            </p>
          </div>
        )}

        {/* Metas compactas (local + datas) */}
        <div style={styles.infoBox}>
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            {(t.course_name || t.course_city) && (
              <div style={styles.metaRow}>
                <LuMapPin size={14} />
                <span>
                  {t.course_name || "Local a definir"}
                  {t.course_city ? ` — ${t.course_city}/${t.course_state}` : ""}
                </span>
              </div>
            )}
            <div style={styles.metaRow}>
              <LuCalendarDays size={14} />
              <span><strong style={{ color: theme.textMain }}>Início:</strong> {formatDateTime(t.start_date)}</span>
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

        {/* Accordions (Onda C · Fase C.6): 4 tópicos do admin. Cada
            seção se auto-esconde quando o conteúdo é NULL/vazio. */}
        <div style={styles.sectionsWrap}>
          <Section theme={theme} icon={LuInfo}          title="Informações do torneio" content={t.info_content} />
          <Section theme={theme} icon={LuClipboardList} title="Programação"            content={t.schedule_content} />
          <Section theme={theme} icon={LuTrophy}        title="Premiação"              content={t.prizes_content} />
          <Section theme={theme} icon={LuBookOpen}      title="Regulamento"            content={t.rules_content} />
        </div>

        {/* Patrocinadores */}
        {t.sponsors?.length > 0 && (
          <div style={{ marginTop: space[5], borderTop: `1px solid ${theme.border}`, paddingTop: space[4], textAlign: "center" }}>
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
    </div>
  );
}
