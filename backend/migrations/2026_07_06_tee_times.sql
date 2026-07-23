-- Migration: Tee Times (reserva de horários)
-- Rodar no MySQL golf_db antes de subir o backend com essa feature.
-- ATENÇÃO: Não usa "IF NOT EXISTS" nas FKs por compatibilidade — não rerodar sem limpar.

-- =====================================================================
-- 1. Configuração de tee time por clube (1 linha por clube)
-- =====================================================================
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
  pix_key_type             VARCHAR(30) DEFAULT NULL,
  whatsapp_number          VARCHAR(30) DEFAULT NULL,
  instructions             TEXT DEFAULT NULL,
  active                   TINYINT(1) NOT NULL DEFAULT 1,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tee_settings_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- =====================================================================
-- 2. Reservas — cada linha ocupa 1 slot para 1 sócio (com N jogadores)
-- =====================================================================
CREATE TABLE IF NOT EXISTS tee_bookings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  club_id        INT NOT NULL,
  course_id      INT NOT NULL,
  user_id        INT NOT NULL,
  booking_date   DATE NOT NULL,
  booking_time   TIME NOT NULL,
  players_count  INT NOT NULL DEFAULT 1,
  status         ENUM('pending','confirmed','canceled','no_show') NOT NULL DEFAULT 'pending',
  notes          VARCHAR(500) DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_club   FOREIGN KEY (club_id)   REFERENCES clubs(id)   ON DELETE CASCADE,
  CONSTRAINT fk_booking_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  INDEX idx_booking_lookup (club_id, booking_date, booking_time, status),
  INDEX idx_booking_user (user_id, booking_date, status)
);
