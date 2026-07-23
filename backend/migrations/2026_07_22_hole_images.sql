-- Adiciona coluna de imagem por buraco (Feature 2 — Imagem por buraco no cadastro do campo)
ALTER TABLE holes ADD COLUMN image_path VARCHAR(255) NULL AFTER yards_red;
