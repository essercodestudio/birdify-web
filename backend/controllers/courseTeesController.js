// backend/controllers/courseTeesController.js
//
// CRUD granular dos tees dinâmicos de um campo (Bloco B da feature de
// "tees dinâmicos"). Fonte da verdade nova: tabela course_tees.
//
// Endpoints:
//   GET    /api/courses/:id/tees             requireAuth  — lista tees do campo
//   POST   /api/courses/:id/tees             requireAdmin — cria 1 tee
//   PUT    /api/courses/:id/tees/:teeId      requireAdmin — edita 1 tee
//   DELETE /api/courses/:id/tees/:teeId      requireAdmin — apaga 1 tee (cascade)
//
// Por que granular e não bulk replace: bulk replace via DELETE-all+INSERT-all
// destruiria os IDs a cada save, e a FK course_tee_rules.tee_id → course_tees(id)
// tem ON DELETE CASCADE — cada save perderia TODAS as regras de handicap.
// Granular preserva IDs; delete deliberado do admin cascateia com aviso.
//
// Validações:
//   tee_name    non-empty, trim, max 60, único no mesmo course (UNIQUE constraint)
//   color_hex   normalizado pra minúsculas; formato #rrggbb (regex)
//   display_order  inteiro; default = índice mais alto atual + 1

const db = require("../db");

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAME_MAX = 60;

async function assertCourseInClub(courseId, clubId) {
  const [rows] = await db.execute(
    "SELECT id FROM courses WHERE id = ? AND club_id = ?",
    [courseId, clubId],
  );
  return rows.length > 0;
}

async function assertTeeInCourse(teeId, courseId) {
  const [rows] = await db.execute(
    "SELECT id FROM course_tees WHERE id = ? AND course_id = ?",
    [teeId, courseId],
  );
  return rows.length > 0;
}

function normalizeHex(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!HEX_RE.test(s)) return null;
  return s;
}

function normalizeName(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0 || s.length > NAME_MAX) return null;
  return s;
}

exports.listTees = async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!courseId) return res.status(400).json({ error: "ID de campo inválido." });

    if (!(await assertCourseInClub(courseId, req.club.id))) {
      return res.status(404).json({ error: "Campo não encontrado ou acesso negado." });
    }

    // rules_count via correlated subquery — pouco custoso (raramente >6 tees
    // por campo) e evita round-trip extra na hora de confirmar delete no admin.
    const [rows] = await db.execute(
      `SELECT id, tee_name, color_hex, display_order,
              (SELECT COUNT(*) FROM course_tee_rules WHERE tee_id = course_tees.id) AS rules_count
         FROM course_tees
        WHERE course_id = ?
        ORDER BY display_order, id`,
      [courseId],
    );
    res.json({ tees: rows.map((r) => ({ ...r, rules_count: Number(r.rules_count) })) });
  } catch (err) {
    console.error("Erro ao listar tees:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.createTee = async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!courseId) return res.status(400).json({ error: "ID de campo inválido." });

    if (!(await assertCourseInClub(courseId, req.club.id))) {
      return res.status(404).json({ error: "Campo não encontrado ou acesso negado." });
    }

    const tee_name = normalizeName(req.body?.tee_name);
    const color_hex = normalizeHex(req.body?.color_hex);
    if (!tee_name) return res.status(400).json({ error: `tee_name obrigatório (1 a ${NAME_MAX} chars).` });
    if (!color_hex) return res.status(400).json({ error: "color_hex inválido — use formato #rrggbb." });

    // display_order default: próximo índice após o maior existente
    let display_order = Number(req.body?.display_order);
    if (!Number.isFinite(display_order)) {
      const [[row]] = await db.execute(
        `SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM course_tees WHERE course_id = ?`,
        [courseId],
      );
      display_order = row.next_order;
    }

    try {
      const [result] = await db.execute(
        `INSERT INTO course_tees (course_id, tee_name, color_hex, display_order)
         VALUES (?, ?, ?, ?)`,
        [courseId, tee_name, color_hex, display_order],
      );
      res.status(201).json({ id: result.insertId, tee_name, color_hex, display_order });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: `Já existe um tee com o nome "${tee_name}" neste campo.` });
      }
      throw e;
    }
  } catch (err) {
    console.error("Erro ao criar tee:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.updateTee = async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    const teeId = Number(req.params.teeId);
    if (!courseId || !teeId) return res.status(400).json({ error: "IDs inválidos." });

    if (!(await assertCourseInClub(courseId, req.club.id))) {
      return res.status(404).json({ error: "Campo não encontrado ou acesso negado." });
    }
    if (!(await assertTeeInCourse(teeId, courseId))) {
      return res.status(404).json({ error: "Tee não encontrado neste campo." });
    }

    // Campos opcionais: só atualiza o que veio
    const updates = [];
    const params = [];

    if (req.body?.tee_name !== undefined) {
      const tee_name = normalizeName(req.body.tee_name);
      if (!tee_name) return res.status(400).json({ error: `tee_name inválido (1 a ${NAME_MAX} chars).` });
      updates.push("tee_name = ?"); params.push(tee_name);
    }
    if (req.body?.color_hex !== undefined) {
      const color_hex = normalizeHex(req.body.color_hex);
      if (!color_hex) return res.status(400).json({ error: "color_hex inválido — use formato #rrggbb." });
      updates.push("color_hex = ?"); params.push(color_hex);
    }
    if (req.body?.display_order !== undefined) {
      const display_order = Number(req.body.display_order);
      if (!Number.isFinite(display_order)) return res.status(400).json({ error: "display_order deve ser numérico." });
      updates.push("display_order = ?"); params.push(display_order);
    }
    if (updates.length === 0) return res.status(400).json({ error: "Nada pra atualizar." });

    params.push(teeId);
    try {
      await db.execute(`UPDATE course_tees SET ${updates.join(", ")} WHERE id = ?`, params);
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Já existe um tee com esse nome neste campo." });
      }
      throw e;
    }

    const [[row]] = await db.execute(
      `SELECT id, tee_name, color_hex, display_order FROM course_tees WHERE id = ?`,
      [teeId],
    );
    res.json(row);
  } catch (err) {
    console.error("Erro ao atualizar tee:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

exports.deleteTee = async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    const teeId = Number(req.params.teeId);
    if (!courseId || !teeId) return res.status(400).json({ error: "IDs inválidos." });

    if (!(await assertCourseInClub(courseId, req.club.id))) {
      return res.status(404).json({ error: "Campo não encontrado ou acesso negado." });
    }
    if (!(await assertTeeInCourse(teeId, courseId))) {
      return res.status(404).json({ error: "Tee não encontrado neste campo." });
    }

    // Conta regras que cascatearão (informativo pro cliente)
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM course_tee_rules WHERE tee_id = ?`,
      [teeId],
    );
    const cascaded_rules_count = row.n;

    await db.execute(`DELETE FROM course_tees WHERE id = ?`, [teeId]);
    res.json({ deleted: true, cascaded_rules_count });
  } catch (err) {
    console.error("Erro ao apagar tee:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
