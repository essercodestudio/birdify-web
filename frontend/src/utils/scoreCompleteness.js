// Detecção compartilhada de scores faltantes antes de assinar/finalizar.
// Usado por Scorecard (torneio) e TrainingScorecard (treino) — mesma lógica,
// UX consistente: lista quem/quais buracos faltam pra o usuário não adivinhar.
//
// expectedHoles vem de holesData.length (derivado do course) — nunca hardcoded
// 18, pra suportar treino/torneio de 9 buracos quando existirem.

export function getIncompleteEntries(players, scores, expectedHoles) {
  if (!players?.length || !expectedHoles) return [];
  const missing = [];
  for (const p of players) {
    const holes = [];
    for (let h = 1; h <= expectedHoles; h++) {
      const s = scores?.[`${p.id}-${h}`];
      if (!s || Number(s) <= 0) holes.push(h);
    }
    if (holes.length > 0) {
      missing.push({ user_id: p.id, name: p.name, missing_holes: holes });
    }
  }
  return missing;
}

// Formata uma lista de missing pra alert simples (fallback quando modal não
// couber no fluxo). Ex: "João: buracos 7, 14 · Maria: buraco 3".
export function formatIncompleteSummary(missing) {
  if (!missing?.length) return '';
  return missing.map(m =>
    `${m.name}: ${m.missing_holes.length === 1 ? 'buraco' : 'buracos'} ${m.missing_holes.join(', ')}`
  ).join(' · ');
}
