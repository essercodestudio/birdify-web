// backend/controllers/courseYardSlotMapController.js
// Mapeamento "coluna física da grade de jardas → tee dinâmico".
// A grade em holes.yards_white/yellow/blue/red tem 4 slots hardcoded no schema.
// Esta camada permite ao admin escolher qual tee (de course_tees) rotula cada
// coluna na UI. Ver comentário da migration 2026_08_26_course_yard_slot_map.sql
// pra motivação e limite intencional.
//
// Multi-tenant: acesso ao course sempre filtra por req.club.id via JOIN em courses.
const db = require("../db");

const VALID_SLOTS = ["white", "yellow", "blue", "red"];

async function assertCourseInClub(conn, courseId, clubId) {
  const [[row]] = await conn.execute(
    `SELECT id FROM courses WHERE id = ? AND club_id = ?`,
    [courseId, clubId]
  );
  return !!row;
}

// GET /courses/:id/yard-slot-map
// Retorna sempre os 4 slots (mesmo os não mapeados vêm com tee_id: null).
// Facilita a UI: sem precisar juntar defaults com mapeamento.
exports.getYardSlotMap = async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    if (!courseId) return res.status(400).json({ error: "course_id inválido." });

    const inClub = await assertCourseInClub(db, courseId, req.club.id);
    if (!inClub) return res.status(404).json({ error: "Campo não encontrado." });

    const [rows] = await db.execute(
      `SELECT m.slot, m.tee_id, t.tee_name, t.color_hex
         FROM course_yard_slot_map m
         JOIN course_tees t ON t.id = m.tee_id
        WHERE m.course_id = ?`,
      [courseId]
    );

    const map = { white: null, yellow: null, blue: null, red: null };
    for (const r of rows) {
      map[r.slot] = { tee_id: r.tee_id, tee_name: r.tee_name, color_hex: r.color_hex };
    }
    res.json(map);
  } catch (error) {
    console.error("[getYardSlotMap] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// PUT /courses/:id/yard-slot-map
// Body: { white: tee_id|null, yellow: tee_id|null, blue: tee_id|null, red: tee_id|null }
// Bulk replace atômico: DELETE tudo do course + INSERT nas linhas não-nulas.
// Cada tee_id enviado precisa pertencer ao mesmo course (evita mapping cruzado).
exports.putYardSlotMap = async (req, res) => {
  const courseId = Number(req.params.id);
  if (!courseId) return res.status(400).json({ error: "course_id inválido." });

  const body = req.body || {};
  // Aceita chaves ausentes como null (equivalente a "limpar aquele slot").
  const rawEntries = VALID_SLOTS.map(slot => {
    const raw = body[slot];
    if (raw === null || raw === undefined || raw === "") return { slot, tee_id: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return { slot, tee_id: "INVALID" };
    return { slot, tee_id: n };
  });
  const invalid = rawEntries.find(e => e.tee_id === "INVALID");
  if (invalid) return res.status(400).json({ error: `tee_id inválido no slot '${invalid.slot}'.` });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const inClub = await assertCourseInClub(conn, courseId, req.club.id);
    if (!inClub) {
      await conn.rollback();
      return res.status(404).json({ error: "Campo não encontrado." });
    }

    // Todos os tee_id não-nulos precisam pertencer ao mesmo course.
    const teeIdsToCheck = rawEntries.filter(e => e.tee_id).map(e => e.tee_id);
    if (teeIdsToCheck.length > 0) {
      const placeholders = teeIdsToCheck.map(() => "?").join(",");
      const [validTees] = await conn.query(
        `SELECT id FROM course_tees WHERE course_id = ? AND id IN (${placeholders})`,
        [courseId, ...teeIdsToCheck]
      );
      if (validTees.length !== teeIdsToCheck.length) {
        await conn.rollback();
        return res.status(400).json({ error: "Um ou mais tees não pertencem a este campo." });
      }
    }

    await conn.execute(
      `DELETE FROM course_yard_slot_map WHERE course_id = ?`,
      [courseId]
    );

    for (const e of rawEntries) {
      if (!e.tee_id) continue;
      await conn.execute(
        `INSERT INTO course_yard_slot_map (course_id, slot, tee_id) VALUES (?, ?, ?)`,
        [courseId, e.slot, e.tee_id]
      );
    }

    await conn.commit();

    // Retorna o mapping atualizado no mesmo formato do GET.
    const [rows] = await db.execute(
      `SELECT m.slot, m.tee_id, t.tee_name, t.color_hex
         FROM course_yard_slot_map m
         JOIN course_tees t ON t.id = m.tee_id
        WHERE m.course_id = ?`,
      [courseId]
    );
    const map = { white: null, yellow: null, blue: null, red: null };
    for (const r of rows) {
      map[r.slot] = { tee_id: r.tee_id, tee_name: r.tee_name, color_hex: r.color_hex };
    }
    res.json({ ok: true, map });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error("[putYardSlotMap] Erro:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  } finally {
    conn.release();
  }
};
