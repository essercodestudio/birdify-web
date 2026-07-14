const jwt = require("jsonwebtoken");
const db = require("../db");

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Acesso negado. Token não fornecido." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
};

// requireAdmin: exige role ADMIN (porta grossa) E vínculo do usuário com o
// clube do domínio atual via club_admins (porta fina). O role global não basta
// — sem uma linha (user_id, club_id) em club_admins, um admin de outro clube
// que aponte o token para este domínio recebe 403.
const requireAdmin = (req, res, next) => {
  requireAuth(req, res, async () => {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Acesso restrito a administradores." });
    }

    const clubId = req.club?.id;
    if (!clubId) {
      return res.status(400).json({ message: "Clube não identificado." });
    }

    try {
      const [rows] = await db.query(
        "SELECT 1 FROM club_admins WHERE user_id = ? AND club_id = ? LIMIT 1",
        [req.user.id, clubId]
      );
      if (rows.length === 0) {
        return res.status(403).json({ message: "Você não administra este clube." });
      }
      next();
    } catch (err) {
      console.error("Erro ao validar vínculo admin↔clube:", err);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  });
};

module.exports = { requireAuth, requireAdmin };
