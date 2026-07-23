-- Coluna sport_type em clubs: usada por adminController (GET/PUT /api/admin/club),
-- ClubSettings.js e /api/theme, mas nenhuma migration anterior a criava —
-- em produção ela existe por alteração manual. Esta migration fecha o gap
-- para ambientes recriados a partir das migrations.

ALTER TABLE clubs
  ADD COLUMN sport_type VARCHAR(20) NOT NULL DEFAULT 'golf';
