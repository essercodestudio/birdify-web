// frontend/src/pages/AdminCourseTees.js
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import { getUser } from "../services/authStorage";
import { useBirdifyTheme } from "../hooks/useBirdifyTheme";
import AdminNavMenu from "../components/AdminNavMenu";
import { useIsMobile } from "../hooks/useIsMobile";
import { LuTarget, LuArrowLeft, LuInfo, LuSave, LuX } from "react-icons/lu";

// Cores de tee com display visual (o chip já usa bg/fg — dispensa emoji)
const TEE_COLORS = [
  { value: "white",  label: "Branco",   bg: "#f8fafc",   fg: "#000" },
  { value: "black",  label: "Preto",    bg: "#0f172a",   fg: "#fff" },
  { value: "blue",   label: "Azul",     bg: "#3b82f6",   fg: "#fff" },
  { value: "yellow", label: "Amarelo",  bg: "#fbbf24",   fg: "#000" },
  { value: "green",  label: "Verde",    bg: "#22c55e",   fg: "#000" },
  { value: "red",    label: "Vermelho", bg: "#ef4444",   fg: "#fff" },
];

const emptyRow = (tee_color, gender) => ({
  tee_color, gender, course_rating: "", slope_rating: "", course_par: 72,
});

function AdminCourseTees() {
  const navigate = useNavigate();
  const { courseId } = useParams();
  const theme = useBirdifyTheme();
  const isMobile = useIsMobile();
  const [courseName, setCourseName] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [coursesRes, teesRes] = await Promise.all([
        api.get("/courses/list"),
        api.get(`/admin/course-tees/${courseId}`),
      ]);
      const course = coursesRes.data.find((c) => String(c.id) === String(courseId));
      setCourseName(course?.name || `Campo #${courseId}`);
      setRows(teesRes.data.map((r) => ({ ...r, dbId: r.id })));
    } catch (e) {
      setError(e.response?.data?.error || "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    const u = getUser();
    if (!u) { navigate("/login"); return; }
    if (u.role !== "ADMIN") { navigate("/"); return; }
    load();
  }, [navigate, load]);

  const addRow = (tee_color, gender) => {
    if (rows.some((r) => r.tee_color === tee_color && r.gender === gender)) return;
    setRows((x) => [...x, emptyRow(tee_color, gender)]);
  };

  const removeRow = async (row, idx) => {
    if (row.dbId) {
      if (!window.confirm("Remover este tee do banco?")) return;
      try {
        await api.delete(`/admin/course-tees/tee/${row.dbId}`);
      } catch (e) {
        alert(e.response?.data?.error || "Erro ao remover.");
        return;
      }
    }
    setRows((x) => x.filter((_, i) => i !== idx));
  };

  const setField = (idx, field, value) => {
    setRows((x) => x.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    setOk(null); setError(null);
    // Valida
    for (const r of rows) {
      const cr = Number(r.course_rating);
      const sr = Number(r.slope_rating);
      if (!(cr > 55 && cr < 85)) {
        setError(`Course Rating fora do intervalo (55-85): ${r.tee_color} ${r.gender}`);
        return;
      }
      if (!(sr >= 55 && sr <= 155)) {
        setError(`Slope fora do intervalo (55-155): ${r.tee_color} ${r.gender}`);
        return;
      }
    }

    try {
      setSaving(true);
      const res = await api.put(`/admin/course-tees/${courseId}`, {
        tees: rows.map((r) => ({
          tee_color: r.tee_color,
          gender: r.gender,
          course_rating: Number(r.course_rating),
          slope_rating: Number(r.slope_rating),
          course_par: Number(r.course_par),
        })),
      });
      setRows(res.data.tees.map((r) => ({ ...r, dbId: r.id })));
      setOk("Tees salvos com sucesso!");
    } catch (e) {
      setError(e.response?.data?.error || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando...
      </div>
    );
  }

  const teesByGender = { M: rows.filter((r) => r.gender === "M"), F: rows.filter((r) => r.gender === "F") };

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: "100vh", color: theme.textMain, padding: 24 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        <AdminNavMenu />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
              <LuTarget size={22} color={theme.accent} />
              Ratings do campo
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>{courseName}</p>
          </div>
          <button onClick={() => navigate("/courses")} style={{ padding: "10px 16px", backgroundColor: "transparent", color: theme.textMuted, border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <LuArrowLeft size={16} />
            Voltar
          </button>
        </div>

        <div style={{ backgroundColor: theme.card, padding: 16, borderRadius: 12, marginBottom: 16, borderLeft: `4px solid ${theme.info}` }}>
          <div style={{ color: theme.info, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <LuInfo size={14} />
            Course Rating e Slope Rating
          </div>
          <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
            Esses valores são <b>oficiais</b> — publicados pela federação após avaliação do campo.
            Course Rating (55-85) representa a dificuldade em número de tacadas para um scratch player.
            Slope Rating (55-155) mede a dificuldade relativa para um bogey player.
            Cadastre por tee e por gênero — ambos são necessários pro cálculo do handicap WHS.
          </div>
        </div>

        {error && <div style={{ backgroundColor: "#4c1d1d", border: `1px solid ${theme.danger}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#fecaca" }}>{error}</div>}
        {ok && <div style={{ backgroundColor: "#052e16", border: `1px solid ${theme.accent}`, padding: 12, borderRadius: 8, marginBottom: 14, color: "#bbf7d0" }}>{ok}</div>}

        {/* Homens */}
        <div style={{ backgroundColor: theme.card, padding: 20, borderRadius: 12, marginBottom: 16 }}>
          <h3 style={{ color: theme.info, fontSize: 15, marginBottom: 14 }}>Tees Masculinos</h3>
          {teesByGender.M.length === 0 && <p style={{ color: theme.textMuted, fontSize: 13 }}>Nenhum tee cadastrado.</p>}
          {teesByGender.M.map((r) => {
            const globalIdx = rows.findIndex((x) => x === r);
            return renderRow(r, globalIdx);
          })}
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ color: theme.textMuted, fontSize: 12, marginRight: 6 }}>+ Adicionar:</span>
            {TEE_COLORS.map((c) => (
              <button
                key={`M-${c.value}`}
                onClick={() => addRow(c.value, "M")}
                disabled={rows.some((r) => r.tee_color === c.value && r.gender === "M")}
                style={{ padding: "10px 14px", minHeight: 40, backgroundColor: c.bg, color: c.fg, border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: rows.some((r) => r.tee_color === c.value && r.gender === "M") ? 0.3 : 1 }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mulheres */}
        <div style={{ backgroundColor: theme.card, padding: 20, borderRadius: 12, marginBottom: 20 }}>
          <h3 style={{ color: "#f472b6", fontSize: 15, marginBottom: 14 }}>Tees Femininos</h3>
          {teesByGender.F.length === 0 && <p style={{ color: theme.textMuted, fontSize: 13 }}>Nenhum tee cadastrado.</p>}
          {teesByGender.F.map((r) => {
            const globalIdx = rows.findIndex((x) => x === r);
            return renderRow(r, globalIdx);
          })}
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ color: theme.textMuted, fontSize: 12, marginRight: 6 }}>+ Adicionar:</span>
            {TEE_COLORS.map((c) => (
              <button
                key={`F-${c.value}`}
                onClick={() => addRow(c.value, "F")}
                disabled={rows.some((r) => r.tee_color === c.value && r.gender === "F")}
                style={{ padding: "10px 14px", minHeight: 40, backgroundColor: c.bg, color: c.fg, border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: rows.some((r) => r.tee_color === c.value && r.gender === "F") ? 0.3 : 1 }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || rows.length === 0}
          style={{ width: "100%", padding: 16, backgroundColor: saving ? theme.cardLight : theme.accent, color: theme.accentContrast, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 15, cursor: saving ? "wait" : "pointer" }}
        >
          {saving ? "Salvando..." : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <LuSave size={16} />
              SALVAR RATINGS
            </span>
          )}
        </button>

      </div>
    </div>
  );

  function renderRow(r, idx) {
    const colorInfo = TEE_COLORS.find((c) => c.value === r.tee_color);
    const inputStyle = { width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.card, color: theme.textMain, boxSizing: "border-box", fontSize: 14 };
    const labelStyle = { display: "block", color: theme.textMuted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 };
    const inputs = (
      <>
        <div>
          <label style={labelStyle}>Course Rating</label>
          <input
            type="number" step="0.1" min="55" max="85"
            value={r.course_rating}
            onChange={(e) => setField(idx, "course_rating", e.target.value)}
            placeholder="Ex: 71.2"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Slope</label>
          <input
            type="number" min="55" max="155"
            value={r.slope_rating}
            onChange={(e) => setField(idx, "slope_rating", e.target.value)}
            placeholder="Ex: 130"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Par</label>
          <input
            type="number" min="60" max="80"
            value={r.course_par}
            onChange={(e) => setField(idx, "course_par", e.target.value)}
            style={inputStyle}
          />
        </div>
      </>
    );

    if (isMobile) {
      return (
        <div key={`${r.tee_color}-${r.gender}-${idx}`} style={{ padding: 12, backgroundColor: theme.bg, borderRadius: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ padding: "6px 12px", backgroundColor: colorInfo?.bg, color: colorInfo?.fg, borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
              {colorInfo?.label || r.tee_color}
            </div>
            <button
              onClick={() => removeRow(r, idx)}
              aria-label="Remover tee"
              style={{ minHeight: 44, minWidth: 44, padding: "10px 14px", backgroundColor: "transparent", color: theme.danger, border: `1px solid ${theme.danger}`, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <LuX size={16} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {inputs}
          </div>
        </div>
      );
    }

    return (
      <div key={`${r.tee_color}-${r.gender}-${idx}`} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr auto", gap: 12, alignItems: "end", padding: "12px 14px", backgroundColor: theme.bg, borderRadius: 8, marginBottom: 8 }}>
        <div style={{ padding: "6px 12px", backgroundColor: colorInfo?.bg, color: colorInfo?.fg, borderRadius: 20, fontSize: 12, fontWeight: 700, minWidth: 90, textAlign: "center", alignSelf: "center" }}>
          {colorInfo?.label || r.tee_color}
        </div>
        {inputs}
        <button
          onClick={() => removeRow(r, idx)}
          aria-label="Remover tee"
          style={{ minHeight: 44, minWidth: 44, padding: "10px 14px", backgroundColor: "transparent", color: theme.danger, border: `1px solid ${theme.danger}`, borderRadius: 8, cursor: "pointer", alignSelf: "center", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <LuX size={16} />
        </button>
      </div>
    );
  }
}

export default AdminCourseTees;
