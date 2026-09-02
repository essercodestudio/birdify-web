// Fonte ÚNICA das categorias de competição — usada pelo Dashboard (criação de
// torneio), Leaderboard (torneio/histórico) e TrainingLeaderboard (treino do dia).
// Alterou faixa ou nome? Muda AQUI e todas as telas acompanham.

export const TOURNAMENT_CATEGORIES = [
  "Masculino Gross (M0)", "Masculino Net (M1) - 0 a 8.5", "Masculino Net (M2) - 8.6 a 14.0",
  "Masculino Net (M3) - 14.1 a 22.1", "Masculino Net (M4) - 22.2 a 36.4",
  "Feminino Gross (F0)", "Feminino Net (F1) - 0 a 16.1", "Feminino Net (F2) - 16.1 a 23.7",
  "Feminino Net (F3) - 23.8 a 36.4"
];

// Bloco 1 · Commit 1.1 (2026-09-01): categorias fixas para torneios com
// scoring_type='result_points'. Não passa por tournament_categories no banco —
// o Leaderboard hardcoda as 2 abas quando o torneio é result_points.
export const RESULT_POINTS_CATEGORIES = ["Masculino", "Feminino"];

// Onda B · Commit 3.12: categorias fixas para torneios com modality='doubles'.
// Ortogonais ao scoring_type. Derivadas dos generos dos 2 jogadores.
export const DOUBLES_CATEGORIES = ["Livre", "Masculina", "Feminina", "Mista"];

// Decide qual conjunto de tabs mostrar no Leaderboard.
// - modality='doubles' → sempre DOUBLES_CATEGORIES (categoria derivada por
//   gender dos jogadores, decisao 3 da Onda B).
// - scoringType='result_points' → sempre ["Masculino", "Feminino"] (ignora o que
//   o admin salvou em tournament_categories — decisão de produto Ajuste 1).
// - scoringType='strokes' (default) → devolve o que veio do backend, comportamento
//   antigo preservado.
export function getLeaderboardTabs(scoringType, tournamentCategories, modality) {
  if (modality === 'doubles') return [...DOUBLES_CATEGORIES];
  if (scoringType === 'result_points') return [...RESULT_POINTS_CATEGORIES];
  return Array.isArray(tournamentCategories) ? tournamentCategories : [];
}

// Filtro por categoria (mesmas regras históricas do Leaderboard de torneio)
export function applyCategoryFilter(players, tab) {
  return players.filter(p => {
    const hc = parseFloat(p.handicap) || 0;
    const sx = p.gender || p.sexo || "M";
    // Onda B · Commit 3.12: em doubles, cada linha ja carrega p.category
    // ('Livre'|'Masculina'|'Feminina'|'Mista') derivada no backend. Livre eh
    // catch-all: contem todas. Outras filtram por match exato de category.
    if (tab === "Livre" && p.category !== undefined) return true;
    if (tab === "Masculina" || tab === "Feminina" || tab === "Mista") {
      return p.category === tab;
    }
    // Bloco 1 · Commit 1.1: tabs curtas "Masculino"/"Feminino" (result_points)
    // filtram apenas por gênero, ignorando handicap. Cheque EXATO evita colidir
    // com "Masculino Gross (M0)" etc, que já batem nas regras antigas abaixo.
    if (tab === "Masculino") return sx === "M" || sx === "Masculino";
    if (tab === "Feminino")  return sx === "F" || sx === "Feminino";
    if (sx === "M" || sx === "Masculino") {
      if (tab.includes("Feminino") || tab.startsWith("F")) return false;
      if (tab.includes("Masculino Livre") || tab.includes("Masculino Gross") || tab.includes("M0")) return true;
      if (tab.includes("M1") && hc >= 0    && hc <= 8.5)  return true;
      if (tab.includes("M2") && hc >= 8.6  && hc <= 14.0) return true;
      if (tab.includes("M3") && hc >= 14.1 && hc <= 22.1) return true;
      if (tab.includes("M4") && hc >= 22.2 && hc <= 36.4) return true;
    }
    if (sx === "F" || sx === "Feminino") {
      if (tab.includes("Masculino") || tab.startsWith("M")) return false;
      if (tab.includes("Feminino Livre") || tab.includes("Feminino Gross") || tab.includes("F0")) return true;
      if (tab.includes("F1") && hc >= 0    && hc <= 16.1) return true;
      if (tab.includes("F2") && hc >= 16.1 && hc <= 23.7) return true;
      if (tab.includes("F3") && hc >= 23.8 && hc <= 36.4) return true;
    }
    return tab.includes("Sênior") || tab.includes("Duplas");
  });
}

// Categoria Net = rankeia por (saldo vs par - handicap); Gross/Livre rankeia bruto
export function isNetCategory(tab) {
  return (tab.includes("Net") || /[MF][1-4]/.test(tab)) &&
    !tab.includes("M0") && !tab.includes("F0");
}
