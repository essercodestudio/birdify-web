// frontend/src/pages/AdminDuplasManager.js
//
// Onda B · Bloco 3 · Commit 3.9. Admin cadastra duplas de um torneio doubles.
// Rota: /admin/torneio/:tournamentId/duplas
//
// Fluxo:
//   1. Lista inscricoes APROVADAS do torneio + duplas ja criadas
//   2. Seleciona 2 jogadores da lista de aprovados (que ainda nao estao em
//      dupla desse torneio) + digita nome da dupla
//   3. Cria — POST /tournament-duplas
//   4. Lista atualiza; jogadores usados somem da lista de disponíveis
//
// Nao suporta editar dupla (delete + criar de novo cobre o caso).
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import { useBirdifyTheme } from '../hooks/useBirdifyTheme';
import AdminNavMenu from '../components/AdminNavMenu';
import { LuUsers, LuPlus, LuTrash2, LuArrowLeft } from 'react-icons/lu';

export default function AdminDuplasManager() {
  const navigate = useNavigate();
  const { tournamentId } = useParams();
  const theme = useBirdifyTheme();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [duplas, setDuplas] = useState([]);
  const [approved, setApproved] = useState([]);

  const [duplaName, setDuplaName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [handicap, setHandicap] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const [tRes, dRes, aRes] = await Promise.all([
        api.get(`/tournaments/${tournamentId}`),
        api.get(`/tournament-duplas/tournament/${tournamentId}`),
        api.get(`/inscriptions/list/${tournamentId}`),
      ]);
      setTournament(tRes.data);
      setDuplas(dRes.data || []);
      setApproved((aRes.data || []).filter(i => i.status === 'APPROVED'));
    } catch (e) {
      const status = e.response?.status;
      if (status === 403) setError('Acesso restrito a administradores.');
      else if (status === 404) setError('Torneio não encontrado.');
      else setError(e.response?.data?.message || 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  // Jogadores em duplas ja criadas (nao podem ser reusados nesse torneio)
  const usedUserIds = new Set();
  for (const d of duplas) for (const p of d.players || []) usedUserIds.add(p.user_id);
  const available = approved.filter(a => !usedUserIds.has(a.user_id));

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!duplaName.trim()) return alert('Nome da dupla obrigatório.');
    const ids = [player1, player2].filter(Boolean).map(Number);
    if (ids.length !== 2) return alert('Escolha os 2 jogadores da dupla.');
    if (ids[0] === ids[1]) return alert('Escolha 2 jogadores diferentes.');
    setSaving(true);
    try {
      await api.post('/tournament-duplas', {
        tournament_id: Number(tournamentId),
        dupla_name: duplaName.trim(),
        handicap: handicap === '' ? null : Number(handicap),
        player_ids: ids,
      });
      setDuplaName(''); setPlayer1(''); setPlayer2(''); setHandicap('');
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao criar dupla.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Excluir dupla "${name}"? Scores da dupla serão apagados.`)) return;
    try {
      await api.delete(`/tournament-duplas/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Erro ao excluir dupla.');
    }
  };

  if (loading) {
    return <div style={{ backgroundColor: theme.bg, color: theme.textMain, minHeight: '100vh', padding: 20 }}>Carregando...</div>;
  }
  if (error) {
    return <div style={{ backgroundColor: theme.bg, color: theme.danger, minHeight: '100vh', padding: 20 }}>{error}</div>;
  }
  if (tournament && tournament.modality !== 'doubles') {
    return (
      <div style={{ backgroundColor: theme.bg, color: theme.textMain, minHeight: '100vh', padding: 20 }}>
        <p style={{ color: theme.danger }}>Torneio não é modality=doubles.</p>
        <button onClick={() => navigate(`/tournament/${tournamentId}`)} style={{ padding: '10px 16px' }}>Voltar</button>
      </div>
    );
  }

  const styles = {
    input: { width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: theme.bg, color: theme.textMain, boxSizing: 'border-box' },
    label: { display: 'block', color: theme.textMuted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
    card: { backgroundColor: theme.card, padding: 16, borderRadius: 10, marginBottom: 14 },
    btnPrimary: { padding: '12px 18px', borderRadius: 8, border: 'none', backgroundColor: theme.accent, color: '#000', fontWeight: 700, cursor: 'pointer' },
    btnGhost: { padding: '10px 14px', borderRadius: 8, border: `1px solid ${theme.cardLight}`, backgroundColor: 'transparent', color: theme.textMain, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  };

  return (
    <div style={{ backgroundColor: theme.bg, color: theme.textMain, minHeight: '100vh' }}>
      <AdminNavMenu />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
        <button onClick={() => navigate(`/tournament/${tournamentId}`)} style={styles.btnGhost}>
          <LuArrowLeft size={16} /> Voltar ao torneio
        </button>

        <h1 style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <LuUsers size={26} color={theme.accent} /> Duplas — {tournament?.name}
        </h1>
        <p style={{ color: theme.textMuted, fontSize: 13 }}>
          Cadastre cada dupla com 2 jogadores já inscritos. Cada jogador só pode estar em 1 dupla neste torneio.
          Depois disso, gere os flights normalmente pelo menu do torneio (auto-gerar distribui 2 duplas por grupo).
        </p>

        <div style={styles.card}>
          <h3 style={{ marginTop: 0 }}>Nova dupla</h3>
          <form onSubmit={handleCreate}>
            <div style={{ marginBottom: 14 }}>
              <label style={styles.label}>Nome da dupla</label>
              <input style={styles.input} value={duplaName} onChange={e => setDuplaName(e.target.value)} placeholder="Ex: João & Pedro" maxLength={100} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={styles.label}>Jogador 1</label>
                <select style={styles.input} value={player1} onChange={e => setPlayer1(e.target.value)}>
                  <option value="">Selecione…</option>
                  {available.filter(a => String(a.user_id) !== player2).map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.player_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={styles.label}>Jogador 2</label>
                <select style={styles.input} value={player2} onChange={e => setPlayer2(e.target.value)}>
                  <option value="">Selecione…</option>
                  {available.filter(a => String(a.user_id) !== player1).map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.player_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={styles.label}>Handicap da dupla (opcional)</label>
              <input style={{ ...styles.input, maxWidth: 160 }} type="number" step="0.1" value={handicap} onChange={e => setHandicap(e.target.value)} placeholder="Ex: 14.5" />
            </div>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>
              <LuPlus size={16} /> {saving ? 'Salvando…' : 'Cadastrar dupla'}
            </button>
          </form>
        </div>

        <div style={styles.card}>
          <h3 style={{ marginTop: 0 }}>Duplas cadastradas ({duplas.length})</h3>
          {duplas.length === 0 ? (
            <p style={{ color: theme.textMuted }}>Nenhuma dupla ainda.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {duplas.map(d => (
                <li key={d.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 0', borderBottom: `1px solid ${theme.cardLight}`,
                }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.dupla_name}</div>
                    <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                      {(d.players || []).map(p => p.name).join(' & ') || 'sem jogadores'}
                      {d.handicap != null && <> · HDC {d.handicap}</>}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(d.id, d.dupla_name)} style={{
                    padding: 8, borderRadius: 8, border: 'none', backgroundColor: theme.danger, color: '#fff', cursor: 'pointer',
                  }} title="Excluir dupla">
                    <LuTrash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ ...styles.card, backgroundColor: theme.bg, border: `1px solid ${theme.cardLight}` }}>
          <h4 style={{ marginTop: 0 }}>Inscritos aprovados sem dupla ({available.length})</h4>
          {available.length === 0 ? (
            <p style={{ color: theme.textMuted, fontSize: 13 }}>Todos os aprovados já estão em duplas.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {available.map(a => (
                <span key={a.user_id} style={{
                  padding: '4px 10px', backgroundColor: theme.card, borderRadius: 6, fontSize: 12,
                }}>{a.player_name}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
