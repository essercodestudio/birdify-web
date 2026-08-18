-- 2026-08-17: auditoria de ajustes de score pelo admin + invalidação de assinatura
-- Motivo: o painel /admin/ajustar-scores dá ao gestor poder de corrigir tacadas
-- oficiais depois de gravadas. Sem rastro auditável e sem invalidar assinaturas
-- já emitidas, o cartão assinado poderia ficar divergente do que está gravado
-- sem que ninguém percebesse. Requerimento do produto: cada PUT admin registra
-- quem/quando/anterior→novo/motivo, e qualquer assinatura ativa do grupo
-- afetado passa a ser marcada como INVALIDATED — não deletada, pra preservar
-- a evidência histórica.

-- 1. Nova tabela de auditoria
-- FKs pra users/tournaments/training_groups usam SET NULL: se o alvo for
-- deletado, a linha da auditoria SOBREVIVE — só perde o link tipado. Isso
-- é o ponto da auditoria: prova histórica independente do que aconteça com
-- os dados relacionados. Só club_id usa CASCADE, porque se o clube inteiro
-- for removido do sistema (LGPD, off-boarding), a auditoria dele vai junto.
CREATE TABLE IF NOT EXISTS admin_score_audit (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  club_id            INT NOT NULL,
  admin_user_id      INT DEFAULT NULL,
  context            ENUM('tournament','training') NOT NULL,
  tournament_id      INT DEFAULT NULL,
  training_group_id  INT DEFAULT NULL,
  target_user_id     INT DEFAULT NULL,
  hole_number        INT NOT NULL,
  previous_strokes   INT DEFAULT NULL,   -- NULL = não existia score
  new_strokes        INT DEFAULT NULL,   -- NULL = foi apagado
  action             ENUM('insert','update','delete') NOT NULL,
  reason             VARCHAR(255) NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_asa_club   FOREIGN KEY (club_id)           REFERENCES clubs(id)             ON DELETE CASCADE,
  CONSTRAINT fk_asa_admin  FOREIGN KEY (admin_user_id)     REFERENCES users(id)             ON DELETE SET NULL,
  CONSTRAINT fk_asa_target FOREIGN KEY (target_user_id)    REFERENCES users(id)             ON DELETE SET NULL,
  CONSTRAINT fk_asa_tourn  FOREIGN KEY (tournament_id)     REFERENCES tournaments(id)       ON DELETE SET NULL,
  CONSTRAINT fk_asa_tgroup FOREIGN KEY (training_group_id) REFERENCES training_groups(id)   ON DELETE SET NULL,

  INDEX idx_asa_club_created  (club_id, created_at),
  INDEX idx_asa_tournament    (tournament_id, created_at),
  INDEX idx_asa_training      (training_group_id, created_at)
);

-- 2. Marcadores de invalidação na assinatura (não deleta o registro histórico)
-- Adiciona sem IF NOT EXISTS via SP wrapper — MySQL 8 aceita, mas em versões
-- antigas rodamos manualmente. Se rodar duas vezes em MySQL <8 → erro
-- "Duplicate column"; nesse caso, ignorar e seguir.
ALTER TABLE tournament_scorecard_signatures
  ADD COLUMN invalidated_at     TIMESTAMP    NULL AFTER signed_at,
  ADD COLUMN invalidated_reason VARCHAR(500) NULL AFTER invalidated_at;
