// backend/controllers/teeTimeController.js
const db = require("../db");

// ─── helpers ──────────────────────────────────────────────────────────
const clampInt = (v, min, max, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Normaliza "HH:MM" ou "HH:MM:SS" → "HH:MM:SS"
const normTime = (t) => {
  if (!t || !HHMM.test(t)) return null;
  return t.length === 5 ? `${t}:00` : t;
};

// Retorna settings do clube (cria com defaults se não existir)
async function ensureSettings(cid) {
  const [rows] = await db.execute(
    `SELECT * FROM club_tee_settings WHERE club_id = ?`,
    [cid]
  );
  if (rows.length > 0) return rows[0];

  await db.execute(
    `INSERT INTO club_tee_settings (club_id) VALUES (?)`,
    [cid]
  );
  const [again] = await db.execute(
    `SELECT * FROM club_tee_settings WHERE club_id = ?`,
    [cid]
  );
  return again[0];
}

// Gera slots de tempo entre opening e closing com step interval_minutes
function generateSlots(openingTime, closingTime, intervalMinutes) {
  const [oh, om] = openingTime.split(":").map(Number);
  const [ch, cm] = closingTime.split(":").map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  const slots = [];
  for (let m = start; m < end; m += intervalMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}:00`);
  }
  return slots;
}

// ─── ADMIN ─────────────────────────────────────────────────────────────

// GET /api/admin/tee-settings
exports.getSettings = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });
    const settings = await ensureSettings(cid);
    res.json(settings);
  } catch (error) {
    console.error("Erro getSettings tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// PUT /api/admin/tee-settings
exports.updateSettings = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    await ensureSettings(cid);

    const b = req.body || {};

    const interval_minutes     = clampInt(b.interval_minutes, 5, 60, 10);
    const max_players_per_slot = clampInt(b.max_players_per_slot, 1, 6, 4);
    const min_advance_hours    = clampInt(b.min_advance_hours, 0, 720, 24);
    const max_advance_days     = clampInt(b.max_advance_days, 1, 90, 14);
    const cancellation_hours   = clampInt(b.cancellation_hours, 0, 168, 12);
    const auto_confirm         = b.auto_confirm ? 1 : 0;
    const is_paid              = b.is_paid ? 1 : 0;
    const active               = b.active === undefined ? 1 : (b.active ? 1 : 0);

    const opening_time = normTime(b.opening_time) || "07:00:00";
    const closing_time = normTime(b.closing_time) || "17:00:00";
    if (opening_time >= closing_time) {
      return res.status(400).json({ error: "Horário de abertura deve ser antes do fechamento." });
    }

    // active_days: aceita "0,1,2,3,4,5,6" ou array [0,1,2,...]
    let active_days = "0,1,2,3,4,5,6";
    if (Array.isArray(b.active_days)) {
      const clean = b.active_days.map(Number).filter((n) => n >= 0 && n <= 6);
      if (clean.length > 0) active_days = [...new Set(clean)].sort().join(",");
    } else if (typeof b.active_days === "string" && /^[0-6](,[0-6])*$/.test(b.active_days)) {
      active_days = b.active_days;
    }

    const fee_value       = is_paid && b.fee_value ? Number(b.fee_value) : null;
    const pix_key         = (b.pix_key || "").toString().slice(0, 200) || null;
    const pix_key_type    = (b.pix_key_type || "").toString().slice(0, 30) || null;
    const whatsapp_number = (b.whatsapp_number || "").toString().slice(0, 30) || null;
    const instructions    = (b.instructions || "").toString().slice(0, 500) || null;

    await db.execute(
      `UPDATE club_tee_settings SET
         interval_minutes = ?, max_players_per_slot = ?,
         opening_time = ?, closing_time = ?, active_days = ?,
         min_advance_hours = ?, max_advance_days = ?, cancellation_hours = ?,
         auto_confirm = ?, is_paid = ?, fee_value = ?,
         pix_key = ?, pix_key_type = ?, whatsapp_number = ?,
         instructions = ?, active = ?
       WHERE club_id = ?`,
      [
        interval_minutes, max_players_per_slot,
        opening_time, closing_time, active_days,
        min_advance_hours, max_advance_days, cancellation_hours,
        auto_confirm, is_paid, fee_value,
        pix_key, pix_key_type, whatsapp_number,
        instructions, active,
        cid,
      ]
    );

    const settings = await ensureSettings(cid);
    res.json({ message: "Configuração atualizada.", settings });
  } catch (error) {
    console.error("Erro updateSettings tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/admin/tee-bookings?date=YYYY-MM-DD&status=...
exports.listAllBookings = async (req, res) => {
  try {
    const cid = req.club?.id;
    if (!cid) return res.status(400).json({ error: "Clube não identificado." });

    const filters = ["b.club_id = ?"];
    const params = [cid];

    if (req.query.date_from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from)) {
      filters.push("b.booking_date >= ?");
      params.push(req.query.date_from);
    }
    if (req.query.date_to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to)) {
      filters.push("b.booking_date <= ?");
      params.push(req.query.date_to);
    }
    if (req.query.status && ["pending", "confirmed", "canceled", "no_show"].includes(req.query.status)) {
      filters.push("b.status = ?");
      params.push(req.query.status);
    }

    const [rows] = await db.execute(
      `SELECT b.id, b.booking_date, b.booking_time, b.players_count, b.status, b.notes,
              b.created_at, b.updated_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email,
              c.id AS course_id, c.name AS course_name
         FROM tee_bookings b
         JOIN users u   ON b.user_id = u.id
         JOIN courses c ON b.course_id = c.id
        WHERE ${filters.join(" AND ")}
        ORDER BY b.booking_date DESC, b.booking_time DESC, b.id DESC
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro listAllBookings tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// PUT /api/admin/tee-bookings/:id/status
exports.updateBookingStatus = async (req, res) => {
  try {
    const cid = req.club?.id;
    const { id } = req.params;
    const { status } = req.body || {};
    if (!["pending", "confirmed", "canceled", "no_show"].includes(status)) {
      return res.status(400).json({ error: "Status inválido." });
    }
    const [result] = await db.execute(
      `UPDATE tee_bookings SET status = ? WHERE id = ? AND club_id = ?`,
      [status, id, cid]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Reserva não encontrada." });
    }
    res.json({ message: "Status atualizado.", id: Number(id), status });
  } catch (error) {
    console.error("Erro updateBookingStatus tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// ─── SÓCIO ──────────────────────────────────────────────────────────────

// GET /api/tee-times/config — settings públicas (o que o sócio precisa ver)
exports.getPublicConfig = async (req, res) => {
  try {
    const cid = req.club?.id;
    const s = await ensureSettings(cid);
    // Não vaza pix_key completa nem instructions internas indevidas — retorna
    // exatamente o que o formulário precisa.
    res.json({
      active: !!s.active,
      interval_minutes: s.interval_minutes,
      max_players_per_slot: s.max_players_per_slot,
      opening_time: s.opening_time,
      closing_time: s.closing_time,
      active_days: s.active_days.split(",").map(Number),
      min_advance_hours: s.min_advance_hours,
      max_advance_days: s.max_advance_days,
      cancellation_hours: s.cancellation_hours,
      is_paid: !!s.is_paid,
      fee_value: s.fee_value,
      pix_key: s.pix_key,
      pix_key_type: s.pix_key_type,
      whatsapp_number: s.whatsapp_number,
      instructions: s.instructions,
    });
  } catch (error) {
    console.error("Erro getPublicConfig tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/tee-times/availability?date=YYYY-MM-DD&course_id=X
exports.getAvailability = async (req, res) => {
  try {
    const cid = req.club?.id;
    const { date, course_id } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Data inválida (use YYYY-MM-DD)." });
    }
    if (!course_id) {
      return res.status(400).json({ error: "course_id obrigatório." });
    }

    // Verifica se o campo pertence ao clube
    const [courseCheck] = await db.execute(
      `SELECT id FROM courses WHERE id = ? AND club_id = ?`,
      [course_id, cid]
    );
    if (courseCheck.length === 0) {
      return res.status(403).json({ error: "Campo não encontrado ou acesso negado." });
    }

    const s = await ensureSettings(cid);
    if (!s.active) {
      return res.json({ enabled: false, slots: [], reason: "Reservas desativadas pelo clube." });
    }

    // Dia da semana
    const dayOfWeek = new Date(`${date}T00:00:00`).getDay(); // 0=dom
    const activeDays = s.active_days.split(",").map(Number);
    if (!activeDays.includes(dayOfWeek)) {
      return res.json({ enabled: false, slots: [], reason: "Este dia da semana não tem reservas." });
    }

    // Gera slots do dia
    const allSlots = generateSlots(s.opening_time, s.closing_time, s.interval_minutes);

    // Busca reservas existentes do dia (que ocupam vagas)
    const [booked] = await db.execute(
      `SELECT booking_time, SUM(players_count) AS total
         FROM tee_bookings
        WHERE club_id = ? AND course_id = ? AND booking_date = ?
          AND status IN ('pending','confirmed')
        GROUP BY booking_time`,
      [cid, course_id, date]
    );
    const bookedMap = new Map(booked.map((r) => [r.booking_time, Number(r.total)]));

    const now = new Date();
    const minAdvanceMs = s.min_advance_hours * 60 * 60 * 1000;

    const slots = allSlots.map((t) => {
      const taken = bookedMap.get(t) || 0;
      const available = Math.max(0, s.max_players_per_slot - taken);
      const slotDateTime = new Date(`${date}T${t}`);
      const tooSoon = slotDateTime.getTime() - now.getTime() < minAdvanceMs;
      return {
        time: t.slice(0, 5),
        taken,
        available,
        full: available === 0,
        too_soon: tooSoon,
      };
    });

    res.json({ enabled: true, date, course_id: Number(course_id), max_per_slot: s.max_players_per_slot, slots });
  } catch (error) {
    console.error("Erro getAvailability tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// POST /api/tee-times/book { course_id, date, time, players_count, notes }
exports.book = async (req, res) => {
  try {
    const cid = req.club?.id;
    const userId = req.user?.id;
    const { course_id, date, time, players_count = 1, notes } = req.body || {};

    if (!course_id || !date || !time) {
      return res.status(400).json({ error: "course_id, date e time são obrigatórios." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Data inválida." });
    }
    const normalizedTime = normTime(time);
    if (!normalizedTime) return res.status(400).json({ error: "Hora inválida." });

    const s = await ensureSettings(cid);
    if (!s.active) return res.status(400).json({ error: "Reservas desativadas pelo clube." });

    const pc = clampInt(players_count, 1, s.max_players_per_slot, 1);

    // Valida se pertence ao clube
    const [courseCheck] = await db.execute(
      `SELECT id FROM courses WHERE id = ? AND club_id = ?`,
      [course_id, cid]
    );
    if (courseCheck.length === 0) {
      return res.status(403).json({ error: "Campo não encontrado ou acesso negado." });
    }

    // Antecedência mínima
    const slotDateTime = new Date(`${date}T${normalizedTime}`);
    const now = new Date();
    const minAdvanceMs = s.min_advance_hours * 60 * 60 * 1000;
    if (slotDateTime.getTime() - now.getTime() < minAdvanceMs) {
      return res.status(400).json({
        error: `É necessário reservar com no mínimo ${s.min_advance_hours}h de antecedência.`,
      });
    }

    // Antecedência máxima
    const maxAdvanceMs = s.max_advance_days * 24 * 60 * 60 * 1000;
    if (slotDateTime.getTime() - now.getTime() > maxAdvanceMs) {
      return res.status(400).json({
        error: `Só é possível reservar até ${s.max_advance_days} dias no futuro.`,
      });
    }

    // Sócio já tem reserva ativa nesse dia?
    const [existing] = await db.execute(
      `SELECT id FROM tee_bookings
        WHERE club_id = ? AND user_id = ? AND booking_date = ?
          AND status IN ('pending','confirmed')`,
      [cid, userId, date]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "Você já tem uma reserva neste dia. Cancele a atual antes de criar outra." });
    }

    // Slot cheio?
    const [[occupied]] = await db.query(
      `SELECT COALESCE(SUM(players_count), 0) AS total
         FROM tee_bookings
        WHERE club_id = ? AND course_id = ? AND booking_date = ? AND booking_time = ?
          AND status IN ('pending','confirmed')`,
      [cid, course_id, date, normalizedTime]
    );
    const remaining = s.max_players_per_slot - Number(occupied.total || 0);
    if (pc > remaining) {
      return res.status(409).json({
        error: remaining <= 0
          ? "Horário completamente lotado."
          : `Este horário só tem ${remaining} vaga(s) disponíveis.`,
      });
    }

    const status = s.auto_confirm ? "confirmed" : "pending";

    const [result] = await db.execute(
      `INSERT INTO tee_bookings (club_id, course_id, user_id, booking_date, booking_time, players_count, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cid, course_id, userId, date, normalizedTime, pc, status, notes || null]
    );

    res.status(201).json({
      message: status === "confirmed" ? "Reserva confirmada!" : "Reserva registrada. Aguarda confirmação do clube.",
      booking_id: result.insertId,
      status,
      whatsapp_number: s.whatsapp_number,
    });
  } catch (error) {
    console.error("Erro book tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// GET /api/tee-times/my-bookings
exports.myBookings = async (req, res) => {
  try {
    const cid = req.club?.id;
    const userId = req.user?.id;

    const [rows] = await db.execute(
      `SELECT b.id, b.booking_date, b.booking_time, b.players_count, b.status, b.notes,
              b.created_at,
              c.id AS course_id, c.name AS course_name
         FROM tee_bookings b
         JOIN courses c ON b.course_id = c.id
        WHERE b.club_id = ? AND b.user_id = ?
        ORDER BY b.booking_date DESC, b.booking_time DESC
        LIMIT 100`,
      [cid, userId]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro myBookings tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// DELETE /api/tee-times/book/:id  (o próprio sócio cancela)
exports.cancelOwnBooking = async (req, res) => {
  try {
    const cid = req.club?.id;
    const userId = req.user?.id;
    const { id } = req.params;

    const [[booking]] = await db.query(
      `SELECT * FROM tee_bookings WHERE id = ? AND club_id = ? AND user_id = ?`,
      [id, cid, userId]
    );
    if (!booking) return res.status(404).json({ error: "Reserva não encontrada." });
    if (booking.status === "canceled") {
      return res.status(400).json({ error: "Reserva já cancelada." });
    }

    const s = await ensureSettings(cid);
    const slotDateTime = new Date(`${booking.booking_date.toISOString ? booking.booking_date.toISOString().slice(0,10) : booking.booking_date}T${booking.booking_time}`);
    const now = new Date();
    const cancelWindowMs = s.cancellation_hours * 60 * 60 * 1000;
    if (slotDateTime.getTime() - now.getTime() < cancelWindowMs) {
      return res.status(400).json({
        error: `Cancelamento só é permitido até ${s.cancellation_hours}h antes.`,
      });
    }

    await db.execute(
      `UPDATE tee_bookings SET status = 'canceled' WHERE id = ?`,
      [id]
    );
    res.json({ message: "Reserva cancelada.", id: Number(id) });
  } catch (error) {
    console.error("Erro cancelOwnBooking tee:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};
