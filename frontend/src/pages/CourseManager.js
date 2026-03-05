// frontend/src/pages/CourseManager.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

function CourseManager() {
  const navigate = useNavigate();
  
  const [courses, setCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCity, setNewCourseCity] = useState(''); // NOVO
  const [newCourseState, setNewCourseState] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [holes, setHoles] = useState([]);

  // TEMA PADRONIZADO BIRDIFY
  const theme = {
    bg: '#0f172a',
    card: '#1e293b',
    cardLight: '#334155',
    accent: '#22c55e',
    gold: '#eab308',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444',
    blue: '#3b82f6'
  };

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      const res = await axios.get('http://localhost:3001/api/courses/list');
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
      await axios.post('http://localhost:3001/api/courses/create', { 
          name: newCourseName,
          city: newCourseCity,
          state: newCourseState
      });
      alert('Campo criado! Selecione-o na lista para editar.');
      
      // Limpa os campos depois de salvar
      setNewCourseName('');
      setNewCourseCity('');
      setNewCourseState('');
      
      loadCourses();
    } catch (error) {
      alert('Erro ao criar campo');
    }
  };

  const handleSelectCourse = async (id) => {
    setSelectedCourseId(id);
    try {
      const res = await axios.get(`http://localhost:3001/api/courses/${id}/holes`);
      setHoles(res.data);
    } catch (error) {
      alert('Erro ao carregar buracos');
    }
  };

  const handleDeleteCourse = async (courseId, courseName) => {
    if (window.confirm(`Deseja excluir o campo "${courseName}"?`)) {
      if (window.confirm(`CONFIRMAÇÃO FINAL: Apagar o campo "${courseName}" removerá todos os dados de buracos e tees. Continuar?`)) {
        try {
          await axios.delete(`http://localhost:3001/api/courses/delete/${courseId}`);
          alert('Campo excluído com sucesso!');
          if (selectedCourseId === courseId) {
             setSelectedCourseId(null);
             setHoles([]);
          }
          loadCourses(); 
        } catch (error) {
          alert('Erro ao excluir campo. Verifique se não há torneios usando ele.');
        }
      }
    }
  };

 // Ajustado com travas de segurança para as Jardas
  const handleHoleChange = (index, field, value) => {
    const updatedHoles = [...holes];

    // Se estivermos mexendo no PAR, salva normal
    if (field === 'par') {
      updatedHoles[index][field] = Number(value);
    } else {
      // Se estivermos mexendo nas JARDAS:
      if (value === '') {
        updatedHoles[index][field] = 0; // Fica vazio na tela
      } else {
        let numValue = Number(value);
        
        // As duas travas de segurança:
        if (numValue < 0) numValue = 0;
        if (numValue > 1000) numValue = 1000;
        
        updatedHoles[index][field] = numValue;
      }
    }
    setHoles(updatedHoles);
  };
  const handleSave = async () => {
    try {
      await axios.post('http://localhost:3001/api/courses/update-holes', { holes });
      alert('✅ Configuração salva com sucesso!');
    } catch (error) {
      alert('Erro ao salvar');
    }
  };

  const styles = {
    container: { padding: '30px', backgroundColor: theme.bg, minHeight: '100vh', color: theme.textMain, fontFamily: "'Inter', sans-serif" },
    headerSection: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' },
    columns: { display: 'flex', gap: '30px', flexWrap: 'wrap' },
    leftCol: { flex: '1', minWidth: '320px' },
    rightCol: { flex: '3', minWidth: '600px' },
    card: { backgroundColor: theme.card, padding: '24px', borderRadius: '16px', marginBottom: '20px', border: `1px solid ${theme.cardLight}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' },
    input: { padding: '12px', width: '100%', borderRadius: '8px', border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: 'white', marginBottom: '10px', boxSizing: 'border-box' },
    button: { padding: '12px 24px', backgroundColor: theme.accent, color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' },
    backBtn: { backgroundColor: 'transparent', color: theme.textMuted, border: `1px solid ${theme.cardLight}`, marginBottom: '0', width: 'auto' },
    courseBtn: { flex: 1, padding: '15px', textAlign: 'left', backgroundColor: theme.cardLight, color: 'white', border: 'none', cursor: 'pointer', borderRadius: '8px 0 0 8px', fontSize: '15px', fontWeight: '600' },
    activeBtn: { backgroundColor: theme.gold, color: 'black' },
    deleteBtn: { backgroundColor: theme.danger, color: 'white', border: 'none', borderRadius: '0 8px 8px 0', padding: '0 15px', cursor: 'pointer' },
    table: { width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px', marginTop: '10px' },
    th: { textAlign: 'center', padding: '12px', color: theme.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' },
    td: { padding: '10px', backgroundColor: theme.cardLight, textAlign: 'center' },
    firstTd: { borderRadius: '8px 0 0 8px' },
    lastTd: { borderRadius: '0 8px 8px 0' },
    // Select do PAR mais bonitão e interativo
    parSelect: { width: '60px', padding: '8px', borderRadius: '6px', border: `1px solid ${theme.gold}`, backgroundColor: theme.bg, color: theme.gold, textAlign: 'center', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', outline: 'none' },
    yardInput: (color, bg) => ({
      width: '55px', padding: '8px', borderRadius: '6px', border: `1px solid ${color}`, backgroundColor: bg, color: '#000', textAlign: 'center', fontWeight: '600', outline: 'none'
    })
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerSection}>
        <h1 style={{margin: 0, fontSize: '24px'}}>⛳ Gestão de Campos</h1>
        <button onClick={() => navigate('/dashboard')} style={{...styles.button, ...styles.backBtn}}>⬅ Dashboard</button>
      </div>

      <div style={styles.columns}>
        <div style={styles.leftCol}>
          <div style={styles.card}>
            <h3 style={{marginTop: 0, color: theme.gold, fontSize: '16px'}}>ADICIONAR NOVO CAMPO</h3>
            <form onSubmit={handleCreate}>
              <input 
                type="text" 
                placeholder="Nome (Ex: São Fernando GC)" 
                value={newCourseName} 
                onChange={e => setNewCourseName(e.target.value)} 
                style={styles.input} 
              />
              
              <div style={{display: 'flex', gap: '10px', marginBottom: '10px'}}>
                  <input 
                    type="text" 
                    placeholder="Cidade (Ex: Cotia)" 
                    value={newCourseCity} 
                    onChange={e => setNewCourseCity(e.target.value)} 
                    style={{...styles.input, marginBottom: 0, flex: 2}} 
                  />
                  
                  <select 
                    value={newCourseState} 
                    onChange={e => setNewCourseState(e.target.value)} 
                    style={{...styles.input, marginBottom: 0, flex: 1, cursor: 'pointer'}}
                  >
                    <option value="">UF</option>
                    <option value="AC">AC</option><option value="AL">AL</option><option value="AP">AP</option>
                    <option value="AM">AM</option><option value="BA">BA</option><option value="CE">CE</option>
                    <option value="DF">DF</option><option value="ES">ES</option><option value="GO">GO</option>
                    <option value="MA">MA</option><option value="MT">MT</option><option value="MS">MS</option>
                    <option value="MG">MG</option><option value="PA">PA</option><option value="PB">PB</option>
                    <option value="PR">PR</option><option value="PE">PE</option><option value="PI">PI</option>
                    <option value="RJ">RJ</option><option value="RN">RN</option><option value="RS">RS</option>
                    <option value="RO">RO</option><option value="RR">RR</option><option value="SC">SC</option>
                    <option value="SP">SP</option><option value="SE">SE</option><option value="TO">TO</option>
                  </select>
              </div>

              <button type="submit" style={{...styles.button, width: '100%'}}>+ CRIAR CAMPO</button>
            </form>
          </div>

          <div style={styles.card}>
            <h3 style={{marginTop: 0, color: theme.textMuted, fontSize: '14px'}}>CAMPOS CADASTRADOS</h3>
            {courses.map(c => (
              <div key={c.id} style={{display: 'flex', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'}}>
                  <button onClick={() => handleSelectCourse(c.id)} style={{ ...styles.courseBtn, ...(selectedCourseId === c.id ? styles.activeBtn : {}) }}>
                    {c.name}
                  </button>
                  <button onClick={() => handleDeleteCourse(c.id, c.name)} style={styles.deleteBtn} title="Excluir Campo">
                    🗑️
                  </button>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.rightCol}>
          {selectedCourseId ? (
            <div style={styles.card}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
                 <h3 style={{margin:0, color: theme.gold}}>Configuração de Buracos e Tees</h3>
                 <button onClick={handleSave} style={{...styles.button, backgroundColor: theme.accent}}>💾 SALVAR TUDO</button>
              </div>
              
              <div style={{overflowX: 'auto'}}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Buraco</th>
                      <th style={styles.th}>PAR</th>
                      <th style={styles.th}>⚪ Branco</th>
                      <th style={styles.th}>🟡 Amarelo</th>
                      <th style={styles.th}>🔵 Azul</th>
                      <th style={styles.th}>🔴 Vermelho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holes.map((h, index) => (
                      <tr key={h.id}>
                        <td style={{...styles.td, ...styles.firstTd}}>
                          <span style={{fontSize: '18px', fontWeight: '900'}}>{h.hole_number}</span>
                        </td>
                        
                        {/* SELECT PARA O PAR */}
                        <td style={styles.td}>
                          <select 
                            value={h.par === 0 ? 4 : h.par} 
                            onChange={e => handleHoleChange(index, 'par', e.target.value)} 
                            style={styles.parSelect}
                          >
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                            <option value={5}>5</option>
                          </select>
                        </td>

                        {/* INPUTS DE JARDAS VAZIOS QUANDO FOREM 0 */}
                        <td style={styles.td}>
                          <input type="number" min="0" max="1000" placeholder="-" value={h.yards_white === 0 ? '' : h.yards_white} onChange={e => handleHoleChange(index, 'yards_white', e.target.value)} style={styles.yardInput('#ddd', '#fff')}/>
                        </td>
                        <td style={styles.td}>
                          <input type="number" placeholder="-" value={h.yards_yellow === 0 ? '' : h.yards_yellow} onChange={e => handleHoleChange(index, 'yards_yellow', e.target.value)} style={styles.yardInput('#ffd700', '#fffacd')}/>
                        </td>
                        <td style={styles.td}>
                          <input type="number" placeholder="-" value={h.yards_blue === 0 ? '' : h.yards_blue} onChange={e => handleHoleChange(index, 'yards_blue', e.target.value)} style={styles.yardInput('#3b82f6', '#e6f2ff')}/>
                        </td>
                        <td style={{...styles.td, ...styles.lastTd}}>
                          <input type="number" placeholder="-" value={h.yards_red === 0 ? '' : h.yards_red} onChange={e => handleHoleChange(index, 'yards_red', e.target.value)} style={styles.yardInput('#ef4444', '#ffe6e6')}/>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={handleSave} style={{...styles.button, marginTop: '20px', width: '100%', fontSize: '16px'}}>💾 SALVAR ALTERAÇÕES DO CAMPO</button>
            </div>
          ) : (
            <div style={{...styles.card, textAlign: 'center', color: theme.textMuted, padding: '80px 20px', borderStyle: 'dashed'}}>
              <div style={{fontSize: '50px', marginBottom: '20px'}}>⬅️</div>
              <h2>Selecione um campo para editar</h2>
              <p>Ou crie um novo campo no menu lateral para começar a configurar os buracos.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CourseManager;