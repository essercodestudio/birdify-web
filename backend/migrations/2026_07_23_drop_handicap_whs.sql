-- =====================================================================
-- BIRDIFY — Remove módulo Handicap WHS (automático)
-- =====================================================================
-- O handicap agora é declarado MANUALMENTE em:
--   - training_participants.handicap (lobby de treino)
--   - group_players.handicap         (lobby de torneio)
-- Estas tabelas NÃO são afetadas.
--
-- IRREVERSÍVEL: se houver dados nas tabelas abaixo, serão perdidos.
-- Faça backup antes: mysqldump -u root -p golf_db > backup_pre_drop_whs.sql
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS handicap_rounds;
DROP TABLE IF EXISTS user_handicap;
DROP TABLE IF EXISTS course_tees;

SET FOREIGN_KEY_CHECKS = 1;
