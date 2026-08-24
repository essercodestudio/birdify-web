-- 2026-08-21: tees dinâmicos por campo (nome + cor livres pelo admin).
--
-- MOTIVO: Extensão da feature "Regras de Tee por Handicap" (migration
-- 2026_08_21_course_tee_rules.sql do mesmo dia). Hoje as cores dos tees
-- são hardcoded (white/yellow/blue/red) e os rótulos PT-BR do frontend
-- não batem com o valor real do banco ("Preto" mostrando swatch amarelo,
-- "Verde" com swatch vermelho — herança de nomenclatura inconsistente).
-- O admin do clube quer poder cadastrar as próprias cores/nomes (ex:
-- "Championship", "Sênior", "Dourado") com o hex visual real.
--
-- ESCOPO: nova tabela course_tees (Conceito B — tees pra sugestão de
-- handicap). NÃO toca em holes.yards_white/_yellow/_blue/_red (Conceito
-- A — jardas visuais no scorecard), que continuam legado. Dois modelos
-- convivendo é decisão explícita — funções independentes.
--
-- TRANSAÇÃO: a migration tem 2 passos:
--   PASSO 1 (DDL, fora de transação, commit implícito): CREATE course_tees
--           + ALTER course_tee_rules ADD tee_id.
--   PASSO 2 (dentro de START TRANSACTION): backfill dos 4 tees padrão
--           pra todo course existente + backfill do tee_id nas regras
--           existentes + SELECT de orfas ANTES do COMMIT.
-- Rodar UM PASSO POR VEZ. No PASSO 2, olhar o número de orfas antes de
-- decidir COMMIT vs ROLLBACK.
--
-- ⚠️ PRÉ-REQUISITO — verificar órfã do WHS antes de rodar:
--   A migration 2026_07_23_drop_handicap_whs.sql tentou dropar uma tabela
--   `course_tees` LEGADA (do módulo WHS antigo), mas em alguns ambientes
--   o DROP não pegou. Se essa tabela ainda existe, tem estrutura totalmente
--   diferente (id, course_id, tee_color ENUM(6), gender, course_rating,
--   slope_rating, course_par) e vai colidir com o CREATE TABLE nesta
--   migration (IF NOT EXISTS pula silenciosamente, e o backend novo bate
--   'Unknown column tee_name'). Verifique ANTES:
--
--     SHOW CREATE TABLE course_tees\G                 -- se colunas velhas: órfã
--     SELECT COUNT(*) AS n FROM course_tees;          -- se 0: seguro pra drop
--
--   Se órfã com 0 linhas → `DROP TABLE course_tees;` (idempotente, já é o que
--   a migration WHS pretendia). Se >0 → parar, exportar antes:
--     mysqldump golf_db course_tees > /root/backup_course_tees_legada.sql
--
-- BACKUP OBRIGATÓRIO ANTES (em prod):
--   mysqldump -u root -p --single-transaction --routines --triggers golf_db > /root/backup_YYYY_MM_DD_pre_course_tees.sql
--   ls -lh + tail -5 confirmando dump completo.
--
-- ROLLBACK MANUAL (se algo der errado depois do commit):
--   ALTER TABLE course_tee_rules DROP FOREIGN KEY fk_ctr_tee;
--   ALTER TABLE course_tee_rules DROP COLUMN tee_id;
--   DROP TABLE course_tees;
--   (a coluna course_tee_rules.tee_color continua intacta como fallback)
--
-- ═════════════════════════════════════════════════════════════════════
-- ⚠️ TODO FOLLOW-UP — DROP DA COLUNA LEGADA tee_color
-- ═════════════════════════════════════════════════════════════════════
-- Depois de 1 deploy confirmando que o backend novo NÃO usa mais
-- course_tee_rules.tee_color em query nenhuma (grep no código +
-- observação em prod por alguns dias sem incidente), criar migration
-- nova pra drop:
--   ALTER TABLE course_tee_rules DROP COLUMN tee_color;
-- Deixar nullable por 1 deploy é a rede de segurança pra rollback do
-- backend novo (código antigo continua conseguindo ler tee_color).
-- NÃO DEIXAR ESQUECIDO como aconteceu com 2026_08_17_admin_score_audit
-- em prod (só foi rodada em 2026-08-21, dias depois do deploy do código).
-- ═════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- PASSO 1 — DDL (commit implícito do MySQL, fora da transação)
-- Rodar de uma vez. Reversível via ROLLBACK MANUAL acima.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS course_tees (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  course_id     INT NOT NULL,
  tee_name      VARCHAR(60) NOT NULL,   -- livre: "Branco", "Championship", "Sênior"
  color_hex     CHAR(7)     NOT NULL,   -- "#rrggbb"
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ct_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY uk_ct_course_name (course_id, tee_name),
  INDEX idx_ct_course_order (course_id, display_order)
);

-- tee_id nullable enquanto o backend antigo (código atual em prod) ainda
-- pode escrever regras usando só tee_color. Backfill logo abaixo preenche
-- todas as linhas existentes. Depois do próximo deploy do backend novo,
-- todas as linhas terão tee_id != NULL. Um deploy DEPOIS disso, tornar
-- NOT NULL (ou dropar tee_color, ver TODO no topo).
ALTER TABLE course_tee_rules
  ADD COLUMN tee_id INT NULL AFTER tee_color,
  ADD CONSTRAINT fk_ctr_tee FOREIGN KEY (tee_id) REFERENCES course_tees(id) ON DELETE CASCADE;

-- Torna tee_color nullable — o backend novo grava NULL aqui quando a regra
-- aponta pra tee customizado (nome fora do enum legado white/yellow/blue/red),
-- via NAME_TO_LEGACY_COLOR em courseTeeRulesController.js. Sem este MODIFY,
-- o INSERT quebra com "Column 'tee_color' cannot be null" e a feature de
-- tees customizados fica inutilizável. Idempotente: se já for NULL, no-op.
ALTER TABLE course_tee_rules
  MODIFY tee_color ENUM('white','yellow','blue','red') NULL;

-- ─────────────────────────────────────────────────────────────────────
-- PASSO 2 — BACKFILL EM TRANSAÇÃO (aguarda "pode COMMIT" ANTES do commit)
-- Rodar TUDO até "-- fim da transação". NÃO commite sem conferir os SELECTs.
-- ─────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- Baselines pra diff antes/depois
SELECT COUNT(*) AS courses_total FROM courses;
SELECT COUNT(*) AS tees_antes    FROM course_tees;
SELECT COUNT(*) AS rules_total   FROM course_tee_rules;
SELECT COUNT(*) AS rules_com_tee_id_antes FROM course_tee_rules WHERE tee_id IS NOT NULL;

-- 2a. Seed 4 tees padrão pra todo course que ainda não tem esse nome cadastrado.
--     Idempotente via NOT EXISTS: rodar duas vezes não duplica.
INSERT INTO course_tees (course_id, tee_name, color_hex, display_order)
SELECT c.id, 'Branco', '#ffffff', 0
  FROM courses c
  WHERE NOT EXISTS (SELECT 1 FROM course_tees t WHERE t.course_id = c.id AND t.tee_name = 'Branco')
UNION ALL
SELECT c.id, 'Amarelo', '#eab308', 1
  FROM courses c
  WHERE NOT EXISTS (SELECT 1 FROM course_tees t WHERE t.course_id = c.id AND t.tee_name = 'Amarelo')
UNION ALL
SELECT c.id, 'Azul', '#0077b6', 2
  FROM courses c
  WHERE NOT EXISTS (SELECT 1 FROM course_tees t WHERE t.course_id = c.id AND t.tee_name = 'Azul')
UNION ALL
SELECT c.id, 'Vermelho', '#dc2626', 3
  FROM courses c
  WHERE NOT EXISTS (SELECT 1 FROM course_tees t WHERE t.course_id = c.id AND t.tee_name = 'Vermelho');

-- 2b. Preenche tee_id de todas as regras existentes.
--     Mapeamento ENUM antigo → tee_name PT-BR novo é 1:1.
UPDATE course_tee_rules r
  JOIN course_tees t
    ON t.course_id = r.course_id
   AND t.tee_name = CASE r.tee_color
         WHEN 'white'  THEN 'Branco'
         WHEN 'yellow' THEN 'Amarelo'
         WHEN 'blue'   THEN 'Azul'
         WHEN 'red'    THEN 'Vermelho'
       END
  SET r.tee_id = t.id
  WHERE r.tee_id IS NULL;

-- Conferências pós-backfill
SELECT COUNT(*) AS tees_depois FROM course_tees;
SELECT COUNT(*) AS rules_com_tee_id_depois FROM course_tee_rules WHERE tee_id IS NOT NULL;
SELECT COUNT(*) AS orfas FROM course_tee_rules WHERE tee_id IS NULL;

-- ── fim da transação (aguardar decisão) ─────────────────────────────
-- Esperado:
--   tees_depois - tees_antes = 4 * (courses_total - courses_que_já_tinham_tees)
--     Em prática, primeira rodada: 4 * courses_total (todos ganham 4).
--   rules_com_tee_id_depois = rules_total (todas as regras foram mapeadas).
--   orfas = 0 SEMPRE.
--
-- Se orfas = 0: COMMIT;
-- Se orfas > 0: ROLLBACK; (algum tee_color inesperado — investigar)
