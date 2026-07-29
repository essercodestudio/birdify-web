-- =====================================================================
-- BIRDIFY — Formato do torneio (shotgun / tee time)
-- =====================================================================
-- Shotgun: todos os grupos saem ao mesmo tempo de buracos diferentes
--          (usa tournament_groups.starting_hole, tee_time fica NULL).
-- Tee time: todos saem do buraco 1 em horários escalonados
--           (starting_hole = 1 forçado, tee_time obrigatório).
--
-- Default 'shotgun' preserva o comportamento atual dos torneios existentes.
-- Se der "Duplicate column", ignore — a coluna já existia.
-- =====================================================================

ALTER TABLE tournaments
  ADD COLUMN format ENUM('shotgun','tee_time') NOT NULL DEFAULT 'shotgun';

ALTER TABLE tournament_groups
  ADD COLUMN tee_time TIME DEFAULT NULL;
