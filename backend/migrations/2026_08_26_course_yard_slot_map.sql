-- 2026-08-26: mapear tees dinâmicos → colunas da grade de jardas.
--
-- MOTIVO: A grade de jardas do CourseManager tem 4 colunas físicas
-- FIXAS (holes.yards_white/yellow/blue/red) com rótulos hardcoded no
-- frontend ("Branco/Preto/Azul/Verde"). Quando implementamos tees
-- dinâmicos (2026_08_21_course_tees.sql) decidimos DELIBERADAMENTE não
-- migrar essa grade — era o "Bloco F" fora de escopo. Agora o admin quer
-- poder trocar os rótulos e cores da grade pra bater com os tees reais
-- do clube, sem precisar migrar as jardas pra uma tabela normalizada.
--
-- ESCOPO ENXUTO: uma tabela de mapeamento
-- course_yard_slot_map(course_id, slot, tee_id). Cada linha diz "coluna
-- física X do course Y = mostra o tee Z (nome + cor de course_tees)".
--
-- NÃO ALTERA holes.yards_* — dados numéricos ficam intactos. Se o admin
-- delete uma linha do mapping, o frontend volta ao rótulo default do slot
-- ("Branco" pra white, "Preto" pra yellow, "Azul" pra blue, "Verde" pra
-- red — nomes atuais hardcoded no CourseManager).
--
-- LIMITE: 4 slots físicos (nomes internos ENUM 'white','yellow','blue',
-- 'red'). Um clube que precisar de N slots (>4) continua esperando o
-- Bloco F completo. Isso é intencional — não força uma migração grande.
--
-- FK ON DELETE CASCADE em tee_id: quando o admin deletar um tee de
-- course_tees, a linha do mapping some junto, e a UI volta pro rótulo
-- default daquele slot. Sem cascade, sobra ponteiro quebrado apontando
-- pra tee inexistente.
--
-- BACKUP OBRIGATÓRIO ANTES (em prod):
--   mysqldump -u root -p --single-transaction --routines --triggers \
--     golf_db > /root/backup_YYYY_MM_DD_pre_yard_slot_map.sql
--   ls -lh + tail -5 confirmando dump completo antes de rodar a migration.
--
-- ROLLBACK MANUAL (se algo der errado depois do commit):
--   DROP TABLE course_yard_slot_map;
--   (nenhuma alteração em holes/courses/course_tees — rollback trivial)
--
-- ═════════════════════════════════════════════════════════════════════
-- MIGRATION
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS course_yard_slot_map (
  course_id INT NOT NULL,
  slot      ENUM('white','yellow','blue','red') NOT NULL,
  tee_id    INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, slot),
  CONSTRAINT fk_cysm_course FOREIGN KEY (course_id) REFERENCES courses(id)     ON DELETE CASCADE,
  CONSTRAINT fk_cysm_tee    FOREIGN KEY (tee_id)    REFERENCES course_tees(id) ON DELETE CASCADE,
  INDEX idx_cysm_course (course_id)
);

-- Verificação pós-migration (informacional — nenhum backfill necessário;
-- a tabela nasce vazia e o frontend faz fallback ao rótulo default).
SELECT
  (SELECT COUNT(*) FROM course_yard_slot_map)                                             AS mappings_atuais,
  (SELECT COUNT(*) FROM courses)                                                          AS courses_no_banco,
  (SELECT COUNT(*) FROM course_tees)                                                      AS tees_dinamicos_cadastrados;
