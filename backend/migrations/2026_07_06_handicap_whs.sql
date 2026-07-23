-- =====================================================================
-- BIRDIFY — Migration WHS (World Handicap System)
-- =====================================================================
-- Rodar após confirmar que a migration anterior (tee times) foi aplicada.
--   mysql -u <USER> -p golf_db < backend/migrations/2026_07_06_handicap_whs.sql
-- =====================================================================


-- ─── 1. course_tees — Course Rating e Slope por tee/gênero ────────────
-- Cada tee (branco/preto/azul/verde/amarelo/vermelho) tem 2 linhas:
--   uma pra M, outra pra F. Se um tee só é oficial pra um gênero,
--   basta cadastrar 1 linha.
CREATE TABLE IF NOT EXISTS course_tees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  course_id      INT NOT NULL,
  tee_color      ENUM('white','black','blue','red','yellow','green') NOT NULL,
  gender         ENUM('M','F') NOT NULL,
  course_rating  DECIMAL(4,1) NOT NULL,
  slope_rating   INT NOT NULL,
  course_par     INT NOT NULL DEFAULT 72,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_course_tee_gender (course_id, tee_color, gender),
  CONSTRAINT fk_tees_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);


-- ─── 2. handicap_rounds — rodadas consolidadas com differential ───────
-- Uma linha por rodada válida de 18 buracos (torneio OU treino).
-- A UNIQUE evita reprocessar a mesma rodada se o cálculo rodar de novo.
CREATE TABLE IF NOT EXISTS handicap_rounds (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  club_id             INT NOT NULL,
  user_id             INT NOT NULL,
  course_id           INT NOT NULL,
  round_date          DATE NOT NULL,
  round_type          ENUM('tournament','training') NOT NULL,
  round_source_id     INT NOT NULL,
  tee_color           ENUM('white','black','blue','red','yellow','green') NOT NULL,
  gender              ENUM('M','F') NOT NULL,
  gross_score         INT NOT NULL,
  adjusted_gross      INT NOT NULL,
  course_rating       DECIMAL(4,1) NOT NULL,
  slope_rating        INT NOT NULL,
  course_par          INT NOT NULL,
  differential        DECIMAL(5,2) NOT NULL,
  handicap_at_round   DECIMAL(4,1) DEFAULT NULL,
  is_valid            TINYINT(1) NOT NULL DEFAULT 1,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_round_source (user_id, round_type, round_source_id),
  INDEX idx_user_rounds (user_id, round_date DESC, id DESC),
  INDEX idx_club_rounds (club_id, round_date DESC),
  CONSTRAINT fk_hround_club   FOREIGN KEY (club_id)   REFERENCES clubs(id)   ON DELETE CASCADE,
  CONSTRAINT fk_hround_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_hround_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);


-- ─── 3. user_handicap — cache do HI atual por sócio×clube ─────────────
-- HI atual + Low HI (menor HI nos últimos 365 dias) usado no soft/hard cap.
-- Uma linha por usuário/clube — multi-tenant estrito.
CREATE TABLE IF NOT EXISTS user_handicap (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  user_id              INT NOT NULL,
  club_id              INT NOT NULL,
  handicap_index       DECIMAL(4,1) DEFAULT NULL,
  low_handicap_index   DECIMAL(4,1) DEFAULT NULL,
  low_hi_date          DATE DEFAULT NULL,
  rounds_count         INT NOT NULL DEFAULT 0,
  last_calculated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_club (user_id, club_id),
  CONSTRAINT fk_uh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uh_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);


-- ─── 4. Verificação ───────────────────────────────────────────────────
-- SHOW TABLES LIKE 'course_tees';
-- SHOW TABLES LIKE 'handicap_rounds';
-- SHOW TABLES LIKE 'user_handicap';
