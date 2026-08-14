-- 2026-08-13: assinatura oficial de cartão de torneio (Bug B — cartão oficial de verdade).
-- Antes, "Assinar Cartão" era só ação de UI: limpava localStorage e navegava, sem prova
-- server-side. Novo endpoint POST /scores/sign-card grava aqui, com timestamp.
-- Uma linha por (torneio, grupo, usuário-que-assinou) — permite múltiplas assinaturas
-- por grupo no futuro (cada jogador confirma o próprio); hoje só o creator do cartão
-- assina, mas o schema não precisa mudar pra evoluir depois.

CREATE TABLE IF NOT EXISTS tournament_scorecard_signatures (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id  INT NOT NULL,
  group_id       INT NOT NULL,
  user_id        INT NOT NULL,
  signed_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sig (tournament_id, group_id, user_id),
  CONSTRAINT fk_sig_tourn FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_sig_group FOREIGN KEY (group_id)      REFERENCES tournament_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_sig_user  FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE
);
