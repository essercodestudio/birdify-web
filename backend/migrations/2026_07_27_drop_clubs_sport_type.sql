-- Remove coluna sport_type de clubs: sistema agora é 100% golfe,
-- footgolf foi descontinuado (2026-07-27). Espelha a limpeza equivalente
-- da 2026_07_23_drop_handicap_whs.sql — dropar coluna que não é mais lida
-- por nenhuma rota (adminController, /api/theme e ClubSettings foram limpos).

ALTER TABLE clubs
  DROP COLUMN sport_type;
