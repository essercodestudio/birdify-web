const mysql = require("mysql2");
const path = require("path");

// Garante que o dotenv encontre o arquivo .env usando o caminho absoluto
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 50,
  timezone: "-03:00",
});

// VPS roda em UTC; sem isso, CURDATE()/NOW() do MySQL viram o dia às 21h BRT
// e o "Treino do Dia" quebra: some do ranking, do lobby e do bloqueio de duplicidade.
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '-03:00'");
});

console.log("✅ Pool de conexões MySQL configurado (fuso BRT)");

// Exporta como promise para usar async/await
module.exports = pool.promise();
