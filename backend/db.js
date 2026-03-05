const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

connection.connect((err) => {
    if (err) {
        console.error('❌ Erro ao conectar: ' + err.stack);
        return;
    }
    console.log('✅ Conectado ao MySQL com sucesso! ID da conexão: ' + connection.threadId);
});

module.exports = connection;