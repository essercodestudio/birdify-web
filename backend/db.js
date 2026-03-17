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
  connectionLimit: 10,
  queueLimit: 0,
});

// Mensagem de log para confirmar a inicialização
console.log("✅ Pool de conexões MySQL configurado com variáveis de ambiente!");

// Exporta como promise para usar async/await
module.exports = pool.promise();
