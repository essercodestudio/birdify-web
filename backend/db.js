// backend/db.js (Versão com Pool - Mais resistente)
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// O Pool não precisa de ".connect", ele conecta sob demanda.
console.log('✅ Pool de conexões MySQL configurado!');

module.exports = pool.promise(); // O .promise() permite usar async/await no backend