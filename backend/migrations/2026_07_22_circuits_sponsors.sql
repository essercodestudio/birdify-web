-- =====================================================================
-- BIRDIFY — Migration Circuitos + Patrocinadores
-- Todas as tabelas usam IF NOT EXISTS — seguro rerodar.
-- Adiciona também inscriptions.manual_position (usado pelo pódio manual).
-- =====================================================================

-- 1) Patrocinadores do clube ------------------------------------------------
CREATE TABLE IF NOT EXISTS sponsors (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  club_id    INT NOT NULL,
  name       VARCHAR(150) NOT NULL,
  logo_url   VARCHAR(500) DEFAULT NULL,
  link_url   VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sponsors_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  INDEX idx_sponsors_club (club_id)
);

-- 2) Circuitos / ligas ------------------------------------------------------
CREATE TABLE IF NOT EXISTS circuits (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  club_id       INT NOT NULL,
  name          VARCHAR(150) NOT NULL,
  description   TEXT DEFAULT NULL,
  total_stages  INT NOT NULL DEFAULT 1,
  num_discards  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_circuits_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  INDEX idx_circuits_club (club_id)
);

-- 3) Etapas do circuito (vincula torneio a nº de etapa) ---------------------
CREATE TABLE IF NOT EXISTS circuit_stages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  circuit_id    INT NOT NULL,
  tournament_id INT NOT NULL,
  stage_number  INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cstage_circuit    FOREIGN KEY (circuit_id)    REFERENCES circuits(id)    ON DELETE CASCADE,
  CONSTRAINT fk_cstage_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  UNIQUE KEY uk_cstage_number   (circuit_id, stage_number),
  UNIQUE KEY uk_cstage_tourn    (circuit_id, tournament_id)
);

-- 4) Regras de pontuação por posição ----------------------------------------
CREATE TABLE IF NOT EXISTS circuit_point_rules (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  circuit_id INT NOT NULL,
  position   INT NOT NULL,
  points     DECIMAL(6,2) NOT NULL,
  CONSTRAINT fk_crules_circuit FOREIGN KEY (circuit_id) REFERENCES circuits(id) ON DELETE CASCADE,
  UNIQUE KEY uk_crules_pos (circuit_id, position)
);

-- 5) Vínculo circuito ↔ patrocinador (ordem de exibição) --------------------
CREATE TABLE IF NOT EXISTS circuit_sponsors (
  circuit_id     INT NOT NULL,
  sponsor_id     INT NOT NULL,
  display_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (circuit_id, sponsor_id),
  CONSTRAINT fk_csponsor_circuit FOREIGN KEY (circuit_id) REFERENCES circuits(id) ON DELETE CASCADE,
  CONSTRAINT fk_csponsor_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
);

-- 6) Posição manual em torneio (pódio pós-playoff) --------------------------
-- Se der "Duplicate column", ignore — a coluna já existia.
ALTER TABLE inscriptions
  ADD COLUMN manual_position INT DEFAULT NULL;
