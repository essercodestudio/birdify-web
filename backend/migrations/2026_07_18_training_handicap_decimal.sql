-- Handicap declarado no treino: era INT e truncava valores como 10.5 → 10,
-- distorcendo o NET e a categoria do ranking. DECIMAL(4,1) casa com o passo
-- de 0.1 usado nos modais de handicap (treino e torneio).

ALTER TABLE training_participants
  MODIFY COLUMN handicap DECIMAL(4,1) NULL DEFAULT NULL;
