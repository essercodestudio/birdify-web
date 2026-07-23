// backend/controllers/userController.js
// Perfil do jogador (foto, bio, redes, motivação).
// Identidade SEMPRE vem do token (req.user.id) — nunca do body/query.
const db = require("../db");

// Limites espelham o DDL (2026_07_18_user_profile.sql)
const LIMITS = {
  bio: 150,
  instagram_handle: 60,
  whatsapp_number: 20,
  golf_motivation: 280,
};

// Normaliza: string vazia vira NULL; corta espaços das pontas.
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const getMyProfile = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, gender,
              profile_photo_url, bio, instagram_handle, whatsapp_number, golf_motivation
         FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao buscar perfil:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const name = clean(req.body.name);
    let bio = clean(req.body.bio);
    let instagram = clean(req.body.instagram_handle);
    let whatsapp = clean(req.body.whatsapp_number);
    let motivation = clean(req.body.golf_motivation);

    // Nome completo é editável (corrigir cadastro errado), mas nunca pode ficar vazio.
    if (req.body.name !== undefined && (!name || name.length < 2 || name.length > 100)) {
      return res.status(400).json({ error: "Nome inválido (2 a 100 caracteres)." });
    }

    // Instagram: guarda só o handle (sem @ e sem URL)
    if (instagram) {
      instagram = instagram
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
        .replace(/^@/, "")
        .replace(/\/+$/, "");
    }
    // WhatsApp: só dígitos (DDI incluso, ex: 5511999998888)
    if (whatsapp) whatsapp = whatsapp.replace(/\D/g, "");

    const fields = {
      bio,
      instagram_handle: instagram,
      whatsapp_number: whatsapp,
      golf_motivation: motivation,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value && value.length > LIMITS[key]) {
        return res.status(400).json({ error: `Campo ${key} excede o limite de ${LIMITS[key]} caracteres.` });
      }
    }

    if (name) {
      await db.query(
        `UPDATE users
            SET name = ?, bio = ?, instagram_handle = ?, whatsapp_number = ?, golf_motivation = ?
          WHERE id = ?`,
        [name, bio, instagram, whatsapp, motivation, req.user.id]
      );
    } else {
      await db.query(
        `UPDATE users
            SET bio = ?, instagram_handle = ?, whatsapp_number = ?, golf_motivation = ?
          WHERE id = ?`,
        [bio, instagram, whatsapp, motivation, req.user.id]
      );
    }
    res.json({ message: "Perfil atualizado.", ...(name ? { name } : {}), ...fields });
  } catch (err) {
    console.error("Erro ao atualizar perfil:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

// Chamado pelo endpoint de upload (multer roda antes, em server.js)
const saveMyPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
    const url = `/uploads/avatars/${req.file.filename}`;
    await db.query("UPDATE users SET profile_photo_url = ? WHERE id = ?", [url, req.user.id]);
    res.json({ url });
  } catch (err) {
    console.error("Erro ao salvar foto de perfil:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

module.exports = { getMyProfile, updateMyProfile, saveMyPhoto };
