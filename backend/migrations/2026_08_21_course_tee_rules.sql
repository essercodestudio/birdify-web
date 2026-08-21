-- 2026-08-21: regras de "faixa de handicap → cor de tee" por campo.
--
-- MOTIVO: o clube quer sugerir/atribuir cor de tee ao jogador na hora do
-- lobby (torneio e treino), baseado no handicap declarado. Hoje as 4 cores
-- de tee vivem só como colunas de jarda em `holes` (yards_white/_yellow/
-- _blue/_red). Faltava a REGRA "handicap X→Y sai do tee Z" — o gestor
-- configura por campo, e a UI mostra a sugestão pro jogador.
--
-- ESCOPO: uma linha por (course, gender, tee_color, faixa). Reaproveita as
-- 4 cores existentes (evita quebrar `holes` e evita cor nova). Multi-tenant
-- sai via FK cascata em courses → clubs.
--
-- REGRA DE NEGÓCIO (validada no backend, não no schema):
--   - Overlap de faixas dentro do mesmo (course, gender) → BLOQUEIO (400).
--     Um handicap não pode cair em dois tees.
--   - Gap entre faixas → WARNING (não bloqueia). Aviso visual pro admin —
--     alguns clubes deliberadamente deixam handicaps "no meio" pra decisão
--     manual do starter, então não é erro.
--   - Não misturar gender='ALL' com 'M'/'F' no mesmo campo (evita ambiguidade).
--
-- NÃO cria FK pra `holes` — a cor pode estar cadastrada em regra mesmo que
-- o campo ainda não tenha jarda registrada pra ela; a UI da regra depende
-- só de o admin querer usar aquela cor, não da jarda estar preenchida.

CREATE TABLE IF NOT EXISTS course_tee_rules (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  course_id      INT NOT NULL,
  gender         ENUM('M','F','ALL')                          NOT NULL DEFAULT 'ALL',
  tee_color      ENUM('white','yellow','blue','red')          NOT NULL,
  handicap_min   DECIMAL(4,1) NOT NULL,   -- inclusivo
  handicap_max   DECIMAL(4,1) NOT NULL,   -- inclusivo
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ctr_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  INDEX idx_ctr_course_gender (course_id, gender)
);
