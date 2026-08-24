// frontend/src/pages/CourseManager.js
import React, { useState, useEffect } from "react";
import api from "../services/api"; // Ajuste o caminho se necessário
import { mediaUrl } from "../services/media";
import { useNavigate } from "react-router-dom";
import AdminNavMenu from "../components/AdminNavMenu";
import { LuFlag, LuTrash2, LuSave, LuArrowLeft, LuImagePlus, LuX, LuTarget, LuTriangleAlert, LuPlus, LuChevronUp, LuChevronDown } from "react-icons/lu";

const GENDER_LABEL = { ALL: "Todos", M: "Masculino", F: "Feminino" };

// Editor de regras agora indexado por tee_id (dinâmico).
// Shape: { mode, rows: { ALL: {teeId: {min, max}}, M: {...}, F: {...} } }
function emptyTeeRulesEditor() {
  return {
    mode: "single", // 'single' = ALL; 'gender' = M+F
    rows: { ALL: {}, M: {}, F: {} },
  };
}

function rulesToEditor(rules) {
  const editor = emptyTeeRulesEditor();
  if (!rules || rules.length === 0) return editor;
  editor.mode = rules.some((r) => r.gender !== "ALL") ? "gender" : "single";
  for (const r of rules) {
    if (!editor.rows[r.gender]) continue;
    editor.rows[r.gender][r.tee_id] = {
      min: String(r.handicap_min),
      max: String(r.handicap_max),
    };
  }
  return editor;
}

// Editor → payload do backend. Só envia gêneros do modo atual e apenas
// linhas com min E max preenchidos, na ordem dos tees do campo.
function editorToPayload(editor, tees) {
  const genders = editor.mode === "single" ? ["ALL"] : ["M", "F"];
  const out = [];
  for (const gender of genders) {
    tees.forEach((tee, idx) => {
      const row = editor.rows[gender]?.[tee.id];
      if (!row) return;
      const min = row.min?.toString().trim();
      const max = row.max?.toString().trim();
      if (min === "" || max === "") return;
      out.push({
        gender,
        tee_id: tee.id,
        handicap_min: Number(min),
        handicap_max: Number(max),
        display_order: idx,
      });
    });
  }
  return out;
}

function CourseManager() {
  const navigate = useNavigate();

  const [courses, setCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseCity, setNewCourseCity] = useState("");
  const [newCourseState, setNewCourseState] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [holes, setHoles] = useState([]);

  // NOVO: Estados para editar as informações do campo selecionado
  const [editCourseName, setEditCourseName] = useState("");
  const [editCourseCity, setEditCourseCity] = useState("");
  const [editCourseState, setEditCourseState] = useState("");

  // Regras de tee por handicap (Bloco 2/3). Editor local + warnings do backend.
  const [teeEditor, setTeeEditor] = useState(emptyTeeRulesEditor());
  const [teeWarnings, setTeeWarnings] = useState([]);
  const [savingTeeRules, setSavingTeeRules] = useState(false);

  // Tees dinâmicos do campo (Bloco C): cadastro/edição/reordenação livre.
  const [tees, setTees] = useState([]); // [{id, tee_name, color_hex, display_order, rules_count}]
  const [newTeeName, setNewTeeName] = useState("");
  const [newTeeHex, setNewTeeHex] = useState("#22c55e");
  const [addingTee, setAddingTee] = useState(false);

  // TEMA PADRONIZADO BIRDIFY
  const theme = {
    bg: "#0f172a",
    card: "#1e293b",
    cardLight: "#334155",
    accent: "#22c55e",
    gold: "#eab308",
    textMain: "#f8fafc",
    textMuted: "#94a3b8",
    danger: "#ef4444",
    blue: "#3b82f6",
    info: "#38bdf8",
  };

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      const res = await api.get("/courses/list");
      setCourses(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCourseName || !newCourseCity || !newCourseState) {
      alert("Por favor, preencha o Nome, a Cidade e o Estado do campo.");
      return;
    }
    try {
      await api.post("/courses/create", {
        name: newCourseName,
        city: newCourseCity,
        state: newCourseState,
      });
      alert("Campo criado! Selecione-o na lista para editar.");
      setNewCourseName("");
      setNewCourseCity("");
      setNewCourseState("");
      loadCourses();
    } catch (error) {
      alert("Erro ao criar campo");
    }
  };

  const handleSelectCourse = async (id) => {
    setSelectedCourseId(id);

    // Puxa as informações do campo selecionado para as caixinhas de edição
    const course = courses.find((c) => c.id === id);
    if (course) {
      setEditCourseName(course.name || "");
      setEditCourseCity(course.city || "");
      setEditCourseState(course.state || "");
    }

    try {
      const [holesRes, rulesRes, teesRes] = await Promise.all([
        api.get(`/courses/${id}/holes`),
        api.get(`/courses/${id}/tee-rules`),
        api.get(`/courses/${id}/tees`),
      ]);
      setHoles(holesRes.data);
      setTees(teesRes.data?.tees || []);
      setTeeEditor(rulesToEditor(rulesRes.data?.rules || []));
      setTeeWarnings(rulesRes.data?.warnings || []);
    } catch (error) {
      alert("Erro ao carregar dados do campo.");
    }
  };

  // ─── CRUD de Tees do Campo (Bloco C) ─────────────────────────────
  const reloadTees = async () => {
    if (!selectedCourseId) return;
    try {
      const res = await api.get(`/courses/${selectedCourseId}/tees`);
      setTees(res.data?.tees || []);
    } catch (e) {
      console.warn("[tees] falha ao recarregar:", e?.response?.status, e?.message);
    }
  };

  const handleAddTee = async () => {
    if (!selectedCourseId) return;
    const name = newTeeName.trim();
    if (!name) { alert("Dá um nome pro tee (ex: Championship, Sênior)."); return; }
    setAddingTee(true);
    try {
      await api.post(`/courses/${selectedCourseId}/tees`, {
        tee_name: name,
        color_hex: newTeeHex,
      });
      setNewTeeName("");
      setNewTeeHex("#22c55e");
      await reloadTees();
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao adicionar tee.");
    } finally {
      setAddingTee(false);
    }
  };

  const handleUpdateTeeField = async (teeId, patch) => {
    // PUT individual — otimista no state, rollback se der erro.
    const prev = tees;
    setTees((list) => list.map((t) => (t.id === teeId ? { ...t, ...patch } : t)));
    try {
      await api.put(`/courses/${selectedCourseId}/tees/${teeId}`, patch);
    } catch (e) {
      setTees(prev); // rollback
      alert(e.response?.data?.error || "Erro ao salvar tee.");
    }
  };

  const handleReorderTee = async (teeId, direction) => {
    // Swap com o vizinho direção +1/-1 e persiste display_order dos dois.
    const idx = tees.findIndex((t) => t.id === teeId);
    const neighborIdx = idx + direction;
    if (idx < 0 || neighborIdx < 0 || neighborIdx >= tees.length) return;
    const a = tees[idx];
    const b = tees[neighborIdx];
    // Otimista: troca display_order no state
    const swapped = [...tees];
    swapped[idx] = { ...b, display_order: a.display_order };
    swapped[neighborIdx] = { ...a, display_order: b.display_order };
    swapped.sort((x, y) => x.display_order - y.display_order);
    setTees(swapped);
    try {
      await Promise.all([
        api.put(`/courses/${selectedCourseId}/tees/${a.id}`, { display_order: b.display_order }),
        api.put(`/courses/${selectedCourseId}/tees/${b.id}`, { display_order: a.display_order }),
      ]);
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao reordenar. Recarregando.");
      await reloadTees();
    }
  };

  const handleDeleteTee = async (tee) => {
    const msg = tee.rules_count > 0
      ? `Apagar tee "${tee.tee_name}"? Isso remove ${tee.rules_count} regra(s) de handicap que apontam pra ele. Continuar?`
      : `Apagar tee "${tee.tee_name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.delete(`/courses/${selectedCourseId}/tees/${tee.id}`);
      // Após deletar, também recarrega as regras (podem ter cascateado)
      const [teesRes, rulesRes] = await Promise.all([
        api.get(`/courses/${selectedCourseId}/tees`),
        api.get(`/courses/${selectedCourseId}/tee-rules`),
      ]);
      setTees(teesRes.data?.tees || []);
      setTeeEditor(rulesToEditor(rulesRes.data?.rules || []));
      setTeeWarnings(rulesRes.data?.warnings || []);
    } catch (e) {
      alert(e.response?.data?.error || "Erro ao apagar tee.");
    }
  };

  const handleTeeCellChange = (gender, teeId, field, value) => {
    const cleaned = value.replace(",", ".").replace(/[^0-9.]/g, "");
    setTeeEditor((prev) => ({
      ...prev,
      rows: {
        ...prev.rows,
        [gender]: {
          ...prev.rows[gender],
          [teeId]: { ...(prev.rows[gender]?.[teeId] || { min: "", max: "" }), [field]: cleaned },
        },
      },
    }));
  };

  const handleTeeModeChange = (nextMode) => {
    // Preserva o que o admin já digitou nos dois modelos — só troca qual é
    // enviado ao salvar. Assim se ele cutuca o toggle sem querer, não perde.
    setTeeEditor((prev) => ({ ...prev, mode: nextMode }));
  };

  const handleSaveTeeRules = async () => {
    if (!selectedCourseId) return;
    const payload = editorToPayload(teeEditor, tees);
    if (payload.length === 0) {
      const ok = window.confirm(
        "Nenhuma faixa preenchida no modo atual. Salvar assim vai APAGAR todas as regras de tee desse campo. Continuar?",
      );
      if (!ok) return;
    }
    setSavingTeeRules(true);
    try {
      const res = await api.put(`/courses/${selectedCourseId}/tee-rules`, {
        rules: payload,
      });
      setTeeEditor(rulesToEditor(res.data?.rules || []));
      setTeeWarnings(res.data?.warnings || []);
      alert(res.data?.message || "Regras de tee salvas.");
    } catch (err) {
      alert(err.response?.data?.error || "Erro ao salvar regras de tee.");
    } finally {
      setSavingTeeRules(false);
    }
  };

  // NOVO: Função para salvar as edições de Nome e Cidade do Campo
  const handleSaveCourseInfo = async () => {
    if (!editCourseName) {
      alert("O nome do campo não pode ficar vazio.");
      return;
    }
    try {
      await api.put(`/courses/update/${selectedCourseId}`, {
        name: editCourseName,
        city: editCourseCity,
        state: editCourseState,
      });
      alert("Dados do campo atualizados com sucesso!");
      loadCourses(); // Recarrega a lista lateral para mostrar o novo nome
    } catch (error) {
      alert("Erro ao atualizar informações do campo.");
    }
  };

  const handleDeleteCourse = async (courseId, courseName) => {
    if (window.confirm(`Deseja excluir o campo "${courseName}"?`)) {
      if (
        window.confirm(
          `CONFIRMAÇÃO FINAL: Apagar o campo "${courseName}" removerá todos os dados de buracos e tees. Continuar?`,
        )
      ) {
        try {
          await api.delete(`/courses/delete/${courseId}`);
          alert("Campo excluído com sucesso!");
          if (selectedCourseId === courseId) {
            setSelectedCourseId(null);
            setHoles([]);
          }
          loadCourses();
        } catch (error) {
          alert(
            "Erro ao excluir campo. Verifique se não há torneios usando ele.",
          );
        }
      }
    }
  };

  const handleHoleChange = (index, field, value) => {
    const updatedHoles = [...holes];
    if (field === "par") {
      updatedHoles[index][field] = Number(value);
    } else {
      if (value === "") {
        updatedHoles[index][field] = 0;
      } else {
        let numValue = Number(value);
        if (numValue < 0) numValue = 0;
        if (numValue > 1000) numValue = 1000;
        updatedHoles[index][field] = numValue;
      }
    }
    setHoles(updatedHoles);
  };

  const handleSave = async () => {
    try {
      await api.post("/courses/update-holes", {
        holes,
      });
      alert("Configuração de buracos salva com sucesso!");
    } catch (error) {
      alert("Erro ao salvar buracos");
    }
  };

  const handleHoleImageUpload = async (holeIndex, file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("A imagem deve ter no máximo 2 MB.");
      return;
    }
    const hole = holes[holeIndex];
    const form = new FormData();
    form.append("image", file);
    try {
      const res = await api.post(
        `/courses/${selectedCourseId}/holes/${hole.hole_number}/image`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const updated = [...holes];
      // cache-bust — o filename é determinístico, então o navegador segurava a imagem antiga
      updated[holeIndex] = { ...hole, image_path: `${res.data.image_path}?t=${Date.now()}` };
      setHoles(updated);
    } catch (err) {
      alert(err.response?.data?.error || "Erro ao enviar imagem.");
    }
  };

  const handleHoleImageRemove = async (holeIndex) => {
    const hole = holes[holeIndex];
    if (!hole.image_path) return;
    if (!window.confirm(`Remover a foto do buraco ${hole.hole_number}?`)) return;
    try {
      await api.delete(`/courses/${selectedCourseId}/holes/${hole.hole_number}/image`);
      const updated = [...holes];
      updated[holeIndex] = { ...hole, image_path: null };
      setHoles(updated);
    } catch (err) {
      alert(err.response?.data?.error || "Erro ao remover imagem.");
    }
  };

  const styles = {
    container: {
      padding: "30px",
      backgroundColor: theme.bg,
      minHeight: "100vh",
      color: theme.textMain,
      
    },
    headerSection: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "30px",
    },
    columns: { display: "flex", gap: "30px", flexWrap: "wrap" },
    leftCol: { flex: "1", minWidth: "320px" },
    rightCol: { flex: "3", minWidth: "600px" },
    card: {
      backgroundColor: theme.card,
      padding: "24px",
      borderRadius: "16px",
      marginBottom: "20px",
      border: `1px solid ${theme.cardLight}`,
      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
    },
    input: {
      padding: "12px",
      width: "100%",
      borderRadius: "8px",
      border: `1px solid ${theme.cardLight}`,
      backgroundColor: theme.bg,
      color: "white",
      marginBottom: "10px",
      boxSizing: "border-box",
    },
    button: {
      padding: "12px 24px",
      backgroundColor: theme.accent,
      color: "#000",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontWeight: "bold",
      transition: "all 0.2s",
    },
    courseBtn: {
      flex: 1,
      padding: "15px",
      textAlign: "left",
      backgroundColor: theme.cardLight,
      color: "white",
      border: "none",
      cursor: "pointer",
      borderRadius: "8px 0 0 8px",
      fontSize: "15px",
      fontWeight: "600",
    },
    activeBtn: { backgroundColor: theme.gold, color: "black" },
    deleteBtn: {
      backgroundColor: theme.danger,
      color: "white",
      border: "none",
      borderRadius: "0 8px 8px 0",
      padding: "0 15px",
      cursor: "pointer",
    },
    table: {
      width: "100%",
      borderCollapse: "separate",
      borderSpacing: "0 8px",
      marginTop: "10px",
    },
    th: {
      textAlign: "center",
      padding: "12px",
      color: theme.textMuted,
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "1px",
    },
    td: {
      padding: "10px",
      backgroundColor: theme.cardLight,
      textAlign: "center",
    },
    firstTd: { borderRadius: "8px 0 0 8px" },
    lastTd: { borderRadius: "0 8px 8px 0" },
    parSelect: {
      width: "60px",
      padding: "8px",
      borderRadius: "6px",
      border: `1px solid ${theme.gold}`,
      backgroundColor: theme.bg,
      color: theme.gold,
      textAlign: "center",
      fontWeight: "bold",
      fontSize: "16px",
      cursor: "pointer",
      outline: "none",
    },
    yardInput: (color, bg) => ({
      width: "55px",
      padding: "8px",
      borderRadius: "6px",
      border: `1px solid ${color}`,
      backgroundColor: bg,
      color: "#000",
      textAlign: "center",
      fontWeight: "600",
      outline: "none",
    }),
  };

  return (
    <div style={styles.container}>
      <AdminNavMenu />
      <div style={styles.headerSection}>
        <h1 style={{ margin: 0, fontSize: "24px", display: "flex", alignItems: "center", gap: 10 }}>
          <LuFlag size={22} color={theme.accent} />
          Gestão de Campos
        </h1>
      </div>

      <div style={styles.columns}>
        <div style={styles.leftCol}>
          <div style={styles.card}>
            <h3 style={{ marginTop: 0, color: theme.gold, fontSize: "16px" }}>
              ADICIONAR NOVO CAMPO
            </h3>
            <form onSubmit={handleCreate}>
              <input
                type="text"
                placeholder="Nome (Ex: São Fernando GC)"
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                style={styles.input}
              />

              <div
                style={{ display: "flex", gap: "10px", marginBottom: "10px" }}
              >
                <input
                  type="text"
                  placeholder="Cidade (Ex: Cotia)"
                  value={newCourseCity}
                  onChange={(e) => setNewCourseCity(e.target.value)}
                  style={{ ...styles.input, marginBottom: 0, flex: 2 }}
                />
                <select
                  value={newCourseState}
                  onChange={(e) => setNewCourseState(e.target.value)}
                  style={{
                    ...styles.input,
                    marginBottom: 0,
                    flex: 1,
                    cursor: "pointer",
                  }}
                >
                  <option value="">UF</option>
                  <option value="AC">AC</option>
                  <option value="AL">AL</option>
                  <option value="AP">AP</option>
                  <option value="AM">AM</option>
                  <option value="BA">BA</option>
                  <option value="CE">CE</option>
                  <option value="DF">DF</option>
                  <option value="ES">ES</option>
                  <option value="GO">GO</option>
                  <option value="MA">MA</option>
                  <option value="MT">MT</option>
                  <option value="MS">MS</option>
                  <option value="MG">MG</option>
                  <option value="PA">PA</option>
                  <option value="PB">PB</option>
                  <option value="PR">PR</option>
                  <option value="PE">PE</option>
                  <option value="PI">PI</option>
                  <option value="RJ">RJ</option>
                  <option value="RN">RN</option>
                  <option value="RS">RS</option>
                  <option value="RO">RO</option>
                  <option value="RR">RR</option>
                  <option value="SC">SC</option>
                  <option value="SP">SP</option>
                  <option value="SE">SE</option>
                  <option value="TO">TO</option>
                </select>
              </div>

              <button type="submit" style={{ ...styles.button, width: "100%" }}>
                + CRIAR CAMPO
              </button>
            </form>
          </div>

          <div style={styles.card}>
            <h3
              style={{ marginTop: 0, color: theme.textMuted, fontSize: "14px" }}
            >
              CAMPOS CADASTRADOS
            </h3>
            {courses.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  marginBottom: "10px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              >
                <button
                  onClick={() => handleSelectCourse(c.id)}
                  style={{
                    ...styles.courseBtn,
                    borderRadius: "8px 0 0 8px",
                    ...(selectedCourseId === c.id ? styles.activeBtn : {}),
                  }}
                >
                  {c.name} {c.city ? `(${c.city})` : ""}
                </button>
                <button
                  onClick={() => handleDeleteCourse(c.id, c.name)}
                  style={styles.deleteBtn}
                  title="Excluir Campo"
                >
                  <LuTrash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.rightCol}>
          {selectedCourseId ? (
            <>
              {/* NOVO: CARD PARA EDITAR NOME E CIDADE */}
              <div
                style={{ ...styles.card, borderTop: `4px solid ${theme.info}` }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "15px",
                  }}
                >
                  <h3 style={{ margin: 0, color: theme.info }}>
                    Informações do Campo
                  </h3>
                  <button
                    onClick={handleSaveCourseInfo}
                    style={{
                      ...styles.button,
                      backgroundColor: theme.info,
                      padding: "8px 15px",
                      color: "#fff",
                    }}
                  >
                    Atualizar Dados
                  </button>
                </div>
                <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 2, marginBottom: 0 }}
                    value={editCourseName}
                    onChange={(e) => setEditCourseName(e.target.value)}
                    placeholder="Nome do Campo"
                  />
                  <input
                    style={{ ...styles.input, flex: 1, marginBottom: 0 }}
                    value={editCourseCity}
                    onChange={(e) => setEditCourseCity(e.target.value)}
                    placeholder="Cidade"
                  />
                  <select
                    style={{ ...styles.input, flex: 1, marginBottom: 0 }}
                    value={editCourseState}
                    onChange={(e) => setEditCourseState(e.target.value)}
                  >
                    <option value="">UF</option>
                    <option value="AC">AC</option>
                    <option value="AL">AL</option>
                    <option value="AP">AP</option>
                    <option value="AM">AM</option>
                    <option value="BA">BA</option>
                    <option value="CE">CE</option>
                    <option value="DF">DF</option>
                    <option value="ES">ES</option>
                    <option value="GO">GO</option>
                    <option value="MA">MA</option>
                    <option value="MT">MT</option>
                    <option value="MS">MS</option>
                    <option value="MG">MG</option>
                    <option value="PA">PA</option>
                    <option value="PB">PB</option>
                    <option value="PR">PR</option>
                    <option value="PE">PE</option>
                    <option value="PI">PI</option>
                    <option value="RJ">RJ</option>
                    <option value="RN">RN</option>
                    <option value="RS">RS</option>
                    <option value="RO">RO</option>
                    <option value="RR">RR</option>
                    <option value="SC">SC</option>
                    <option value="SP">SP</option>
                    <option value="SE">SE</option>
                    <option value="TO">TO</option>
                  </select>
                </div>
              </div>

              {/* CARD DE BURACOS (ORIGINAL) */}
              <div style={styles.card}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "20px",
                  }}
                >
                  <h3 style={{ margin: 0, color: theme.gold }}>
                    Configuração de Buracos e Tees
                  </h3>
                  <button
                    onClick={handleSave}
                    style={{ ...styles.button, backgroundColor: theme.accent }}
                  >
                    <LuSave size={14} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
                    SALVAR BURACOS
                  </button>
                </div>

                <div style={{ overflowX: "auto" }}>
  <table style={styles.table}>
    <thead>
      <tr>
        <th style={styles.th}>Buraco</th>
        <th style={styles.th}>PAR</th>
        <th style={styles.th}>Branco</th>
        {/* Mudamos Amarelo para Preto */}
        <th style={styles.th}>Preto</th>
        <th style={styles.th}>Azul</th>
        {/* Mudamos Vermelho para Verde */}
        <th style={styles.th}>Verde</th>
        <th style={styles.th}>Foto</th>
      </tr>
    </thead>
                    <tbody>
                      {holes.map((h, index) => (
                        <tr key={h.id}>
                          <td style={{ ...styles.td, ...styles.firstTd }}>
                            <span
                              style={{ fontSize: "18px", fontWeight: "900" }}
                            >
                              {h.hole_number}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <select
                              value={h.par === 0 ? 4 : h.par}
                              onChange={(e) =>
                                handleHoleChange(index, "par", e.target.value)
                              }
                              style={styles.parSelect}
                            >
                              <option value={3}>3</option>
                              <option value={4}>4</option>
                              <option value={5}>5</option>
                            </select>
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              min="0"
                              max="1000"
                              placeholder="-"
                              value={h.yards_white === 0 ? "" : h.yards_white}
                              onChange={(e) =>
                                handleHoleChange(
                                  index,
                                  "yards_white",
                                  e.target.value,
                                )
                              }
                              style={styles.yardInput("#ddd", "#fff")}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              placeholder="-"
                              value={h.yards_yellow === 0 ? "" : h.yards_yellow}
                              onChange={(e) =>
                                handleHoleChange(
                                  index,
                                  "yards_yellow",
                                  e.target.value,
                                )
                              }
                              style={styles.yardInput("#ffd700", "#fffacd")}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              placeholder="-"
                              value={h.yards_blue === 0 ? "" : h.yards_blue}
                              onChange={(e) =>
                                handleHoleChange(
                                  index,
                                  "yards_blue",
                                  e.target.value,
                                )
                              }
                              style={styles.yardInput("#3b82f6", "#e6f2ff")}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              placeholder="-"
                              value={h.yards_red === 0 ? "" : h.yards_red}
                              onChange={(e) =>
                                handleHoleChange(
                                  index,
                                  "yards_red",
                                  e.target.value,
                                )
                              }
                              style={styles.yardInput("#ef4444", "#ffe6e6")}
                            />
                          </td>
                          <td style={{ ...styles.td, ...styles.lastTd }}>
                            <HoleImageCell
                              hole={h}
                              onUpload={(file) => handleHoleImageUpload(index, file)}
                              onRemove={() => handleHoleImageRemove(index)}
                              theme={theme}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CARD DE TEES DO CAMPO (Bloco C) — nome + cor livres, alimenta as Regras abaixo */}
              <div style={{ ...styles.card, borderTop: `4px solid ${theme.info}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                  <h3 style={{ margin: 0, color: theme.info, display: "flex", alignItems: "center", gap: 8 }}>
                    <LuFlag size={18} /> Tees do Campo
                  </h3>
                  <span style={{ color: theme.textMuted, fontSize: 12 }}>
                    {tees.length} tee{tees.length === 1 ? "" : "s"} cadastrado{tees.length === 1 ? "" : "s"}
                  </span>
                </div>

                <p style={{ margin: "0 0 14px", color: theme.textMuted, fontSize: 13 }}>
                  Cadastre os tees que o campo oferece. Nome livre (ex: "Championship", "Sênior")
                  e cor visual real. Cada tee cadastrado aparece como linha nas Regras de Tee por
                  Handicap abaixo.
                </p>

                {tees.length === 0 && (
                  <div style={{ padding: "12px 14px", backgroundColor: theme.bg, border: `1px dashed ${theme.cardLight}`, borderRadius: 8, color: theme.textMuted, fontSize: 13, marginBottom: 12 }}>
                    Nenhum tee cadastrado. Adicione abaixo pra começar.
                  </div>
                )}

                {tees.map((tee, idx) => (
                  <div key={tee.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", backgroundColor: theme.cardLight, borderRadius: 8, marginBottom: 6 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleReorderTee(tee.id, -1)}
                        title="Subir"
                        style={{ background: "none", border: "none", color: idx === 0 ? theme.cardLight : theme.textMuted, cursor: idx === 0 ? "not-allowed" : "pointer", padding: 0, height: 14 }}
                      >
                        <LuChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === tees.length - 1}
                        onClick={() => handleReorderTee(tee.id, +1)}
                        title="Descer"
                        style={{ background: "none", border: "none", color: idx === tees.length - 1 ? theme.cardLight : theme.textMuted, cursor: idx === tees.length - 1 ? "not-allowed" : "pointer", padding: 0, height: 14 }}
                      >
                        <LuChevronDown size={14} />
                      </button>
                    </div>
                    <input
                      type="color"
                      value={tee.color_hex}
                      onChange={(e) => handleUpdateTeeField(tee.id, { color_hex: e.target.value })}
                      title="Cor visual do tee"
                      style={{ width: 36, height: 32, border: `1px solid ${theme.cardLight}`, borderRadius: 6, backgroundColor: "transparent", cursor: "pointer" }}
                    />
                    <input
                      type="text"
                      value={tee.tee_name}
                      maxLength={60}
                      onChange={(e) => setTees((list) => list.map((t) => (t.id === tee.id ? { ...t, tee_name: e.target.value } : t)))}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== tee.tee_name) handleUpdateTeeField(tee.id, { tee_name: name });
                      }}
                      style={{ flex: 1, minWidth: 120, padding: "8px 10px", borderRadius: 6, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, fontSize: 14 }}
                    />
                    <span
                      title={tee.rules_count === 0 ? "Sem regras usando este tee" : `${tee.rules_count} regra(s) apontam pra este tee`}
                      style={{
                        padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                        backgroundColor: tee.rules_count > 0 ? "rgba(56,189,248,0.15)" : "rgba(148,163,184,0.12)",
                        color: tee.rules_count > 0 ? theme.info : theme.textMuted,
                        border: `1px solid ${tee.rules_count > 0 ? theme.info : theme.cardLight}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tee.rules_count} regra{tee.rules_count === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteTee(tee)}
                      title="Apagar tee"
                      style={{ background: "none", border: "none", color: theme.danger, cursor: "pointer", padding: 6 }}
                    >
                      <LuTrash2 size={16} />
                    </button>
                  </div>
                ))}

                {/* Adicionar novo tee */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", backgroundColor: theme.bg, borderRadius: 8, border: `1px dashed ${theme.cardLight}` }}>
                  <input
                    type="color"
                    value={newTeeHex}
                    onChange={(e) => setNewTeeHex(e.target.value)}
                    title="Cor do novo tee"
                    style={{ width: 36, height: 32, border: `1px solid ${theme.cardLight}`, borderRadius: 6, backgroundColor: "transparent", cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    placeholder="Nome do novo tee (ex: Championship)"
                    maxLength={60}
                    value={newTeeName}
                    onChange={(e) => setNewTeeName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddTee(); }}
                    style={{ flex: 1, minWidth: 120, padding: "8px 10px", borderRadius: 6, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.card, color: theme.textMain, fontSize: 14 }}
                  />
                  <button
                    type="button"
                    onClick={handleAddTee}
                    disabled={addingTee || !newTeeName.trim()}
                    style={{
                      padding: "8px 14px", borderRadius: 6, border: "none",
                      backgroundColor: addingTee || !newTeeName.trim() ? theme.cardLight : theme.info,
                      color: addingTee || !newTeeName.trim() ? theme.textMuted : "#fff",
                      fontWeight: 700, fontSize: 13, cursor: addingTee || !newTeeName.trim() ? "not-allowed" : "pointer",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                  >
                    <LuPlus size={14} /> {addingTee ? "..." : "ADICIONAR"}
                  </button>
                </div>
              </div>

              {/* CARD DE REGRAS DE TEE POR HANDICAP (Bloco 3) */}
              <div style={{ ...styles.card, borderTop: `4px solid ${theme.accent}` }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <h3 style={{ margin: 0, color: theme.accent, display: "flex", alignItems: "center", gap: 8 }}>
                    <LuTarget size={18} /> Regras de Tee por Handicap
                  </h3>
                  <button
                    onClick={handleSaveTeeRules}
                    disabled={savingTeeRules}
                    style={{
                      ...styles.button,
                      backgroundColor: theme.accent,
                      opacity: savingTeeRules ? 0.6 : 1,
                    }}
                  >
                    <LuSave size={14} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
                    {savingTeeRules ? "SALVANDO..." : "SALVAR REGRAS"}
                  </button>
                </div>

                <p style={{ margin: "0 0 16px", color: theme.textMuted, fontSize: 13 }}>
                  Define de qual tee o jogador deve sair, por faixa de handicap.
                  A sugestão aparece no lobby do torneio e do treino, na hora que
                  o jogador declara o handicap. Deixe uma cor em branco (min/max
                  vazios) pra não usar aquele tee.
                </p>

                <div
                  style={{
                    display: "flex",
                    gap: 20,
                    marginBottom: 16,
                    flexWrap: "wrap",
                    fontSize: 14,
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      checked={teeEditor.mode === "single"}
                      onChange={() => handleTeeModeChange("single")}
                    />
                    Mesma regra pra todos os jogadores
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      checked={teeEditor.mode === "gender"}
                      onChange={() => handleTeeModeChange("gender")}
                    />
                    Regras separadas por gênero (M / F)
                  </label>
                </div>

                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {(teeEditor.mode === "single" ? ["ALL"] : ["M", "F"]).map((gender) => (
                    <div key={gender} style={{ flex: 1, minWidth: 260 }}>
                      <div
                        style={{
                          color: theme.textMuted,
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: 1,
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        {GENDER_LABEL[gender]}
                      </div>
                      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
                        <thead>
                          <tr>
                            <th style={{ ...styles.th, textAlign: "left", padding: "4px 8px" }}>Tee</th>
                            <th style={{ ...styles.th, padding: "4px 8px" }}>HC mín</th>
                            <th style={{ ...styles.th, padding: "4px 8px" }}>HC máx</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tees.length === 0 && (
                            <tr>
                              <td colSpan={3} style={{ ...styles.td, ...styles.firstTd, ...styles.lastTd, color: theme.textMuted, textAlign: "center", fontSize: 12 }}>
                                Cadastre pelo menos 1 tee no card acima pra criar regras.
                              </td>
                            </tr>
                          )}
                          {tees.map((tee) => {
                            const row = teeEditor.rows[gender]?.[tee.id] || { min: "", max: "" };
                            return (
                              <tr key={`${gender}-${tee.id}`}>
                                <td style={{ ...styles.td, ...styles.firstTd, textAlign: "left" }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 14, height: 14, borderRadius: "50%",
                                      backgroundColor: tee.color_hex,
                                      border: `2px solid ${tee.color_hex}`,
                                      verticalAlign: "middle", marginRight: 8,
                                    }}
                                  />
                                  {tee.tee_name}
                                </td>
                                <td style={styles.td}>
                                  <input
                                    type="text" inputMode="decimal" placeholder="-"
                                    value={row.min}
                                    onChange={(e) => handleTeeCellChange(gender, tee.id, "min", e.target.value)}
                                    style={styles.yardInput(tee.color_hex, "#fff")}
                                  />
                                </td>
                                <td style={{ ...styles.td, ...styles.lastTd }}>
                                  <input
                                    type="text" inputMode="decimal" placeholder="-"
                                    value={row.max}
                                    onChange={(e) => handleTeeCellChange(gender, tee.id, "max", e.target.value)}
                                    style={styles.yardInput(tee.color_hex, "#fff")}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>

                {teeWarnings.length > 0 && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 14px",
                      backgroundColor: "rgba(234,179,8,0.08)",
                      border: `1px solid ${theme.gold}`,
                      borderRadius: 8,
                      color: theme.gold,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 6 }}>
                      <LuTriangleAlert size={16} /> Aviso: faixas com buracos
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {teeWarnings.map((w, i) => {
                        const label = GENDER_LABEL[w.gender] || w.gender;
                        const prefix =
                          w.type === "gap_at_start"
                            ? `Nenhum tee para handicap ${w.uncovered_min} a ${w.uncovered_max}`
                            : `Handicap ${w.uncovered_min} a ${w.uncovered_max} sem tee configurado`;
                        return <li key={i}>{prefix} ({label}).</li>;
                      })}
                    </ul>
                    <div style={{ marginTop: 6, color: theme.textMuted, fontSize: 12 }}>
                      Jogadores nessas faixas verão "confirme com o starter" no lobby, sem bloqueio.
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                ...styles.card,
                textAlign: "center",
                color: theme.textMuted,
                padding: "80px 20px",
                borderStyle: "dashed",
              }}
            >
              <div style={{ marginBottom: "20px" }}><LuArrowLeft size={50} /></div>
              <h2>Selecione um campo para editar</h2>
              <p>
                Ou crie um novo campo no menu lateral para começar a configurar
                os buracos.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HoleImageCell({ hole, onUpload, onRemove, theme }) {
  const inputId = `hole-img-${hole.id}`;
  if (hole.image_path) {
    return (
      <div style={{ position: "relative", display: "inline-block" }}>
        <img
          src={mediaUrl(hole.image_path)}
          alt={`Buraco ${hole.hole_number}`}
          style={{
            width: 48,
            height: 48,
            objectFit: "cover",
            borderRadius: 6,
            border: `1px solid ${theme.cardLight}`,
            display: "block",
          }}
        />
        <button
          type="button"
          onClick={onRemove}
          title="Remover foto"
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 20,
            height: 20,
            borderRadius: "50%",
            border: "none",
            backgroundColor: theme.danger,
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <LuX size={12} />
        </button>
      </div>
    );
  }
  return (
    <>
      <label
        htmlFor={inputId}
        title="Adicionar foto do buraco"
        style={{
          width: 48,
          height: 48,
          borderRadius: 6,
          border: `1px dashed ${theme.textMuted}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: theme.textMuted,
        }}
      >
        <LuImagePlus size={20} />
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(f);
        }}
      />
    </>
  );
}

export default CourseManager;