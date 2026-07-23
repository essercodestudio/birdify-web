-- =====================================================================
-- BIRDIFY — Migration completa 2026-07-06
-- Módulos afetados: Admin (ClubSettings) + Tee Times
-- =====================================================================
-- COMO RODAR:
--   1) Faça backup:  mysqldump -u <USER> -p golf_db > backup_pre_2026_07_06.sql
--   2) Execute:      mysql -u <USER> -p golf_db < 2026_07_06_full_migration.sql
--   3) Reinicie o backend: pm2 restart birdify-api
-- =====================================================================


-- ─── 1. Coluna background_color em `clubs` (usada em /admin/clube) ────
-- Se der erro "Duplicate column name 'background_color'", ignore — a coluna já existia.
ALTER TABLE clubs
  ADD COLUMN background_color VARCHAR(7) DEFAULT NULL;


-- ─── 2. Tabela club_tee_settings (configuração de tee times por clube) ─
CREATE TABLE IF NOT EXISTS club_tee_settings (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  club_id                  INT NOT NULL UNIQUE,
  interval_minutes         INT NOT NULL DEFAULT 10,
  max_players_per_slot     INT NOT NULL DEFAULT 4,
  opening_time             TIME NOT NULL DEFAULT '07:00:00',
  closing_time             TIME NOT NULL DEFAULT '17:00:00',
  active_days              VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4,5,6',
  min_advance_hours        INT NOT NULL DEFAULT 24,
  max_advance_days         INT NOT NULL DEFAULT 14,
  cancellation_hours       INT NOT NULL DEFAULT 12,
  auto_confirm             TINYINT(1) NOT NULL DEFAULT 0,
  is_paid                  TINYINT(1) NOT NULL DEFAULT 0,
  fee_value                DECIMAL(10,2) DEFAULT NULL,
  pix_key                  VARCHAR(200) DEFAULT NULL,
  pix_key_type             VARCHAR(30)  DEFAULT NULL,
  whatsapp_number          VARCHAR(30)  DEFAULT NULL,
  instructions             TEXT         DEFAULT NULL,
  active                   TINYINT(1) NOT NULL DEFAULT 1,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tee_settings_club
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);


-- ─── 3. Tabela tee_bookings (reservas dos sócios) ─────────────────────
CREATE TABLE IF NOT EXISTS tee_bookings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  club_id        INT NOT NULL,
  course_id      INT NOT NULL,
  user_id        INT NOT NULL,
  booking_date   DATE NOT NULL,
  booking_time   TIME NOT NULL,
  players_count  INT  NOT NULL DEFAULT 1,
  status         ENUM('pending','confirmed','canceled','no_show') NOT NULL DEFAULT 'pending',
  notes          VARCHAR(500) DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_club   FOREIGN KEY (club_id)   REFERENCES clubs(id)   ON DELETE CASCADE,
  CONSTRAINT fk_booking_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  INDEX idx_booking_lookup (club_id, booking_date, booking_time, status),
  INDEX idx_booking_user   (user_id, booking_date, status)
);


-- ─── 4. Verificações finais (opcional — só pra confirmar) ─────────────
-- Rode manualmente pra ver se tudo foi criado:
--   SHOW TABLES LIKE 'club_tee_settings';
--   SHOW TABLES LIKE 'tee_bookings';
--   SHOW COLUMNS FROM clubs LIKE 'background_color';
