-- =====================================================================
-- BIRDIFY — Schema completo do sistema (referência)
-- =====================================================================
-- INFERIDO DO CÓDIGO — não é fonte da verdade em produção.
-- Fonte da verdade: `mysqldump --no-data golf_db` do banco atual.
--
-- Todas as tabelas usam IF NOT EXISTS. Seguro rodar em banco existente:
-- só cria o que faltar (não altera nem apaga o que já tem).
--
-- Colunas marcadas [INFER] são inferência pelo uso no código —
-- podem divergir em tipo/tamanho do que existe em produção real.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ─── 1. clubs (multi-tenant) ─────────────────────────────────────────
-- [INFER] tipos exatos das colunas antigas
CREATE TABLE IF NOT EXISTS clubs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(150) NOT NULL,
  domain            VARCHAR(255) DEFAULT NULL,
  primary_color     VARCHAR(7)   DEFAULT '#22c55e',
  background_color  VARCHAR(7)   DEFAULT NULL,
  logo_url          VARCHAR(500) DEFAULT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_clubs_domain (domain)
);

-- ─── 2. users ────────────────────────────────────────────────────────
-- [INFER] estrutura básica + colunas do perfil (migration 2026_07_18_user_profile)
CREATE TABLE IF NOT EXISTS users (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  name                     VARCHAR(150) NOT NULL,
  email                    VARCHAR(255) NOT NULL,
  password_hash            VARCHAR(255) NOT NULL,
  gender                   VARCHAR(20)  DEFAULT NULL,
  role                     ENUM('ADMIN','PLAYER') NOT NULL DEFAULT 'PLAYER',
  reset_password_token     VARCHAR(64)  DEFAULT NULL,
  reset_password_expires   DATETIME     DEFAULT NULL,
  profile_photo_url        VARCHAR(500) DEFAULT NULL,
  bio                      TEXT         DEFAULT NULL,
  instagram                VARCHAR(100) DEFAULT NULL,
  whatsapp                 VARCHAR(30)  DEFAULT NULL,
  motivation               TEXT         DEFAULT NULL,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_email (email)
);

-- ─── 3. club_admins (vínculo user↔clube, porta fina do requireAdmin) ─
CREATE TABLE IF NOT EXISTS club_admins (
  user_id  INT NOT NULL,
  club_id  INT NOT NULL,
  PRIMARY KEY (user_id, club_id),
  CONSTRAINT fk_cadmin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cadmin_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- ─── 4. courses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  club_id    INT NOT NULL,
  name       VARCHAR(150) NOT NULL,
  city       VARCHAR(100) DEFAULT NULL,
  state      VARCHAR(2)   DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_courses_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  INDEX idx_courses_club (club_id)
);

-- ─── 5. holes (buracos do campo) ─────────────────────────────────────
-- image_path da migration 2026_07_22_hole_images
CREATE TABLE IF NOT EXISTS holes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT NOT NULL,
  hole_number  INT NOT NULL,
  par          INT NOT NULL DEFAULT 4,
  yards_white  INT DEFAULT 0,
  yards_yellow INT DEFAULT 0,
  yards_blue   INT DEFAULT 0,
  yards_red    INT DEFAULT 0,
  image_path   VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_holes_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY uk_holes_course_number (course_id, hole_number)
);

-- ─── 6. course_holes (legado — mantida por compat, alguns fallbacks) ─
-- [INFER] pouco usada — o código faz fallback pra ela quando `holes` não tem dados
CREATE TABLE IF NOT EXISTS course_holes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  course_id   INT NOT NULL,
  hole_number INT NOT NULL,
  par         INT NOT NULL DEFAULT 4,
  CONSTRAINT fk_choles_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY uk_choles_course_number (course_id, hole_number)
);

-- ─── 7a. course_tees (tees dinâmicos por campo — Conceito B) ─────────
-- Cadastro livre pelo admin: nome + cor hex. Substitui as 4 cores
-- fixas (white/yellow/blue/red) ANTES usadas em course_tee_rules.
-- NÃO substitui holes.yards_white/_yellow/_blue/_red (Conceito A —
-- jardas visuais no scorecard), que continuam legado — dois modelos
-- convivem por decisão de escopo. Migration 2026_08_21_course_tees.
CREATE TABLE IF NOT EXISTS course_tees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  course_id      INT NOT NULL,
  tee_name       VARCHAR(60) NOT NULL,
  color_hex      CHAR(7)     NOT NULL,
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ct_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY uk_ct_course_name (course_id, tee_name),
  INDEX idx_ct_course_order (course_id, display_order)
);

-- ─── 7b. course_tee_rules (regra "faixa de handicap → tee") ──────────
-- Configurado por campo pelo admin do clube. Alimenta a sugestão de tee
-- no lobby (torneio + treino) e potencialmente a inscrição em torneio.
-- Multi-tenant: FK cascata via courses. Sem club_id direto — filtro
-- sempre via JOIN em courses. Regras (validadas no controller, não no
-- schema): overlap dentro do mesmo (course, gender) é bloqueio; gap
-- entre faixas é warning; 'ALL' não pode coexistir com 'M'/'F' no
-- mesmo campo.
--
-- tee_color (ENUM) = legado, mantido nullable por 1 deploy pra permitir
-- rollback do backend novo. TODO: dropar em migration futura depois de
-- confirmar que nada consome mais (ver comentário no arquivo da migration
-- 2026_08_21_course_tees.sql).
--
-- tee_id → course_tees(id): coluna nova, backfilled a partir do
-- tee_color mapeado por nome PT-BR (white→'Branco', yellow→'Amarelo',
-- blue→'Azul', red→'Vermelho').
--
-- Migration original: 2026_08_21_course_tee_rules; extensão dinâmica:
-- 2026_08_21_course_tees.
CREATE TABLE IF NOT EXISTS course_tee_rules (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  course_id      INT NOT NULL,
  gender         ENUM('M','F','ALL')                          NOT NULL DEFAULT 'ALL',
  tee_color      ENUM('white','yellow','blue','red')          NULL,      -- LEGADO — dropar em migration futura
  tee_id         INT NULL,                                                -- fonte da verdade nova (course_tees)
  handicap_min   DECIMAL(4,1) NOT NULL,
  handicap_max   DECIMAL(4,1) NOT NULL,
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ctr_course FOREIGN KEY (course_id) REFERENCES courses(id)     ON DELETE CASCADE,
  CONSTRAINT fk_ctr_tee    FOREIGN KEY (tee_id)    REFERENCES course_tees(id) ON DELETE CASCADE,
  INDEX idx_ctr_course_gender (course_id, gender)
);

-- ─── 7c. course_yard_slot_map (mapeia tees dinâmicos → 4 colunas de jardas) ─
-- Cada linha diz "para o campo X, a coluna física <slot> da grade de jardas
-- (holes.yards_<slot>) exibe o tee dinâmico <tee_id>". Só troca RÓTULO e COR
-- exibidos — os valores numéricos ficam em holes.yards_white/yellow/blue/red
-- (intocados). Se a linha não existe pra um slot, o frontend faz fallback pro
-- nome/cor default hardcoded do slot ('Branco' pra white, 'Preto' pra yellow,
-- 'Azul' pra blue, 'Verde' pra red).
-- Limite intencional: 4 slots. Um clube que quiser N colunas espera o Bloco F.
-- Migration: 2026_08_26_course_yard_slot_map.
CREATE TABLE IF NOT EXISTS course_yard_slot_map (
  course_id  INT NOT NULL,
  slot       ENUM('white','yellow','blue','red') NOT NULL,
  tee_id     INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, slot),
  CONSTRAINT fk_cysm_course FOREIGN KEY (course_id) REFERENCES courses(id)     ON DELETE CASCADE,
  CONSTRAINT fk_cysm_tee    FOREIGN KEY (tee_id)    REFERENCES course_tees(id) ON DELETE CASCADE,
  INDEX idx_cysm_course (course_id)
);

-- ─── 8. tournaments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  club_id                INT NOT NULL,
  name                   VARCHAR(200) NOT NULL,
  start_date             DATE NOT NULL,
  course_id              INT DEFAULT NULL,
  description            TEXT DEFAULT NULL,
  fee                    DECIMAL(10,2) DEFAULT NULL,
  payment_info           VARCHAR(500)  DEFAULT NULL,
  pix_key_type           VARCHAR(30)   DEFAULT NULL,
  whatsapp_contact       VARCHAR(30)   DEFAULT NULL,
  registration_deadline  DATE          DEFAULT NULL,
  status                 VARCHAR(30)   NOT NULL DEFAULT 'OPEN',
  format                 ENUM('shotgun','tee_time') NOT NULL DEFAULT 'shotgun',
  categories             TEXT          DEFAULT NULL,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tourn_club   FOREIGN KEY (club_id)   REFERENCES clubs(id)   ON DELETE CASCADE,
  CONSTRAINT fk_tourn_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  INDEX idx_tourn_club (club_id),
  INDEX idx_tourn_status (status)
);

-- ─── 9. tournament_categories ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_categories (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  name          VARCHAR(100) NOT NULL,
  CONSTRAINT fk_tcat_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_tcat_tourn (tournament_id)
);

-- ─── 10. tournament_groups (grupos/mesas de jogo do torneio) ─────────
CREATE TABLE IF NOT EXISTS tournament_groups (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id  INT NOT NULL,
  group_name     VARCHAR(100) DEFAULT NULL,
  access_code    VARCHAR(20)  NOT NULL,
  starting_hole  INT NOT NULL DEFAULT 1,
  tee_time       TIME DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tgroup_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  UNIQUE KEY uk_tgroup_code (access_code)
);

-- ─── 11. group_players (jogadores de cada grupo do torneio) ──────────
CREATE TABLE IF NOT EXISTS group_players (
  group_id  INT NOT NULL,
  user_id   INT NOT NULL,
  handicap  DECIMAL(4,1) DEFAULT NULL,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT fk_gp_group FOREIGN KEY (group_id) REFERENCES tournament_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_gp_user  FOREIGN KEY (user_id)  REFERENCES users(id)             ON DELETE CASCADE
);

-- ─── 11b. tournament_scorecard_signatures (cartão oficial assinado) ──
-- Grava a assinatura do cartão do torneio: quem assinou, quando. Antes o "Assinar
-- Cartão" era só UI (limpava localStorage). Migration 2026_08_13.
-- invalidated_at/invalidated_reason: adicionados em 2026_08_17 pra marcar quando
-- o admin ajusta score depois da assinatura — a linha NÃO é apagada, mantém o
-- histórico "foi assinado uma vez com esses valores" + evidência da invalidação.
CREATE TABLE IF NOT EXISTS tournament_scorecard_signatures (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id       INT NOT NULL,
  group_id            INT NOT NULL,
  user_id             INT NOT NULL,
  signed_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  invalidated_at      TIMESTAMP    NULL,
  invalidated_reason  VARCHAR(500) NULL,
  UNIQUE KEY uk_sig (tournament_id, group_id, user_id),
  CONSTRAINT fk_sig_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id)       ON DELETE CASCADE,
  CONSTRAINT fk_sig_group FOREIGN KEY (group_id)      REFERENCES tournament_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_sig_user  FOREIGN KEY (user_id)       REFERENCES users(id)             ON DELETE CASCADE
);

-- ─── 11c. admin_score_audit (rastro de correção manual do admin) ─────
-- Cada PUT em /admin/scores/{tournament|training} grava aqui, dentro de uma
-- transação com o próprio upsert do score. Reason é obrigatório (5-255 chars)
-- e serve pra prestação de contas no comitê de regras/CBG. Migration 2026_08_17.
-- FKs pra users/tournaments/training_groups usam SET NULL: a auditoria
-- sobrevive à deleção do alvo (é prova histórica, não pode desaparecer
-- junto com o dado que auditou). Só club_id CASCADE — off-boarding
-- do clube inteiro leva os audits dele.
CREATE TABLE IF NOT EXISTS admin_score_audit (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  club_id            INT NOT NULL,
  admin_user_id      INT DEFAULT NULL,
  context            ENUM('tournament','training') NOT NULL,
  tournament_id      INT DEFAULT NULL,
  training_group_id  INT DEFAULT NULL,
  target_user_id     INT DEFAULT NULL,
  hole_number        INT NOT NULL,
  previous_strokes   INT DEFAULT NULL,
  new_strokes        INT DEFAULT NULL,
  action             ENUM('insert','update','delete') NOT NULL,
  reason             VARCHAR(255) NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_asa_club   FOREIGN KEY (club_id)           REFERENCES clubs(id)             ON DELETE CASCADE,
  CONSTRAINT fk_asa_admin  FOREIGN KEY (admin_user_id)     REFERENCES users(id)             ON DELETE SET NULL,
  CONSTRAINT fk_asa_target FOREIGN KEY (target_user_id)    REFERENCES users(id)             ON DELETE SET NULL,
  CONSTRAINT fk_asa_tourn  FOREIGN KEY (tournament_id)     REFERENCES tournaments(id)       ON DELETE SET NULL,
  CONSTRAINT fk_asa_tgroup FOREIGN KEY (training_group_id) REFERENCES training_groups(id)   ON DELETE SET NULL,
  INDEX idx_asa_club_created (club_id, created_at),
  INDEX idx_asa_tournament   (tournament_id, created_at),
  INDEX idx_asa_training     (training_group_id, created_at)
);

-- ─── 12. tournament_sponsors ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_sponsors (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id  INT NOT NULL,
  name           VARCHAR(150) NOT NULL,
  image_url      VARCHAR(500) DEFAULT NULL,
  CONSTRAINT fk_tspon_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_tspon_tourn (tournament_id)
);

-- ─── 13. inscriptions (inscrição do jogador no torneio) ──────────────
CREATE TABLE IF NOT EXISTS inscriptions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id    INT NOT NULL,
  user_id          INT NOT NULL,
  category_id      INT DEFAULT NULL,
  status           ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  manual_position  INT DEFAULT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ins_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id)          ON DELETE CASCADE,
  CONSTRAINT fk_ins_user  FOREIGN KEY (user_id)       REFERENCES users(id)                ON DELETE CASCADE,
  CONSTRAINT fk_ins_cat   FOREIGN KEY (category_id)   REFERENCES tournament_categories(id) ON DELETE SET NULL,
  UNIQUE KEY uk_ins (tournament_id, user_id),
  INDEX idx_ins_tourn (tournament_id, status)
);

-- ─── 14. scores (tacadas no torneio) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scores (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  user_id       INT NOT NULL,
  hole_number   INT NOT NULL,
  strokes       INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_scores_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_scores_user  FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
  UNIQUE KEY uk_score (tournament_id, user_id, hole_number),
  INDEX idx_scores_tourn (tournament_id)
);

-- ═════════════════════════════════════════════════════════════════════
-- MÓDULO TREINO DO DIA
-- ═════════════════════════════════════════════════════════════════════

-- ─── 15. training_groups ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_groups (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  club_id        INT NOT NULL,
  creator_id     INT NOT NULL,
  course_id      INT NOT NULL,
  group_name     VARCHAR(100) DEFAULT NULL,
  access_code    VARCHAR(20)  NOT NULL,
  starting_hole  INT NOT NULL DEFAULT 1,
  status         ENUM('aguardando','ativo','finalizado','cancelado') NOT NULL DEFAULT 'aguardando',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tg_club    FOREIGN KEY (club_id)    REFERENCES clubs(id)    ON DELETE CASCADE,
  CONSTRAINT fk_tg_creator FOREIGN KEY (creator_id) REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_tg_course  FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,
  UNIQUE KEY uk_tg_code (access_code),
  INDEX idx_tg_status (status)
);

-- ─── 16. training_participants ───────────────────────────────────────
-- handicap DECIMAL(4,1) via migration 2026_07_18_training_handicap_decimal
CREATE TABLE IF NOT EXISTS training_participants (
  group_id  INT NOT NULL,
  user_id   INT NOT NULL,
  handicap  DECIMAL(4,1) DEFAULT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT fk_tp_group FOREIGN KEY (group_id) REFERENCES training_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_user  FOREIGN KEY (user_id)  REFERENCES users(id)           ON DELETE CASCADE
);

-- ─── 17. training_scores (UPSERT atômico) ────────────────────────────
CREATE TABLE IF NOT EXISTS training_scores (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  group_id     INT NOT NULL,
  user_id      INT NOT NULL,
  hole_number  INT NOT NULL,
  strokes      INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ts_group FOREIGN KEY (group_id) REFERENCES training_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts_user  FOREIGN KEY (user_id)  REFERENCES users(id)           ON DELETE CASCADE,
  UNIQUE KEY uq_training_score (group_id, user_id, hole_number)
);

-- ═════════════════════════════════════════════════════════════════════
-- MÓDULO TEE TIMES (2026_07_06)
-- ═════════════════════════════════════════════════════════════════════

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
  CONSTRAINT fk_tsettings_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

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
  INDEX idx_booking_user   (user_id, booking_date, status)
);

-- ═════════════════════════════════════════════════════════════════════
-- MÓDULO CIRCUITOS + PATROCINADORES (2026_07_22)
-- ═════════════════════════════════════════════════════════════════════

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

CREATE TABLE IF NOT EXISTS circuit_stages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  circuit_id    INT NOT NULL,
  tournament_id INT NOT NULL,
  stage_number  INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cstage_circuit    FOREIGN KEY (circuit_id)    REFERENCES circuits(id)    ON DELETE CASCADE,
  CONSTRAINT fk_cstage_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  UNIQUE KEY uk_cstage_number (circuit_id, stage_number),
  UNIQUE KEY uk_cstage_tourn  (circuit_id, tournament_id)
);

CREATE TABLE IF NOT EXISTS circuit_point_rules (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  circuit_id INT NOT NULL,
  position   INT NOT NULL,
  points     DECIMAL(6,2) NOT NULL,
  CONSTRAINT fk_crules_circuit FOREIGN KEY (circuit_id) REFERENCES circuits(id) ON DELETE CASCADE,
  UNIQUE KEY uk_crules_pos (circuit_id, position)
);

CREATE TABLE IF NOT EXISTS circuit_sponsors (
  circuit_id     INT NOT NULL,
  sponsor_id     INT NOT NULL,
  display_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (circuit_id, sponsor_id),
  CONSTRAINT fk_csponsor_circuit FOREIGN KEY (circuit_id) REFERENCES circuits(id) ON DELETE CASCADE,
  CONSTRAINT fk_csponsor_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
);

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- FIM DO SCHEMA
-- =====================================================================
-- Total: 25 tabelas (17 antigas + 2 tee times + 2 handicap + 5 circuits/sponsors + 2 tee rules/tees)
-- Legado não incluído: training_tables, training_kicks (não usadas no código atual)
-- =====================================================================
