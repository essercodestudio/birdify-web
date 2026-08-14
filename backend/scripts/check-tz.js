// Valida o fuso efetivo do pool do backend.
// Uso: node backend/scripts/check-tz.js
const db = require("../db");

(async () => {
  try {
    const [rows] = await db.query(
      "SELECT @@session.time_zone AS tz, NOW() AS now_ts, CURDATE() AS today"
    );
    console.log(rows[0]);
  } catch (e) {
    console.error("ERRO:", e.message);
  } finally {
    process.exit(0);
  }
})();
