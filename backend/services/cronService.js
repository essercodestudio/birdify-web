const cron = require('node-cron');
const db = require('../db');

const initCronJobs = () => {
  cron.schedule('59 59 23 * * *', async () => {
    console.log("🌙 Iniciando processamento de fecho diário...");
    console.log(`🔌 Cron DB: host=${process.env.DB_HOST} user=${process.env.DB_USER} db=${process.env.DB_NAME}`);

    // Verifica conectividade antes de rodar as operações
    try {
      await db.query("SELECT 1");
    } catch (connErr) {
      console.error("❌ Cron: falha na conexão com o banco:", {
        code:       connErr.code,
        errno:      connErr.errno,
        sqlMessage: connErr.sqlMessage,
        message:    connErr.message,
      });
      return;
    }

    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const dataAmanha = amanha.toISOString().split('T')[0];

    let clubs = [];
    try {
      [clubs] = await db.query("SELECT id, name FROM clubs");
    } catch (err) {
      console.error("❌ Cron: erro ao buscar clubes:", { code: err.code, message: err.message });
      return;
    }

    for (const club of clubs) {
      console.log(`⛳ Processando Clube: ${club.name}`);

      try {
        await db.query(
          "UPDATE tournaments SET status = 'concluido' WHERE club_id = ? AND name LIKE 'Treino %' AND status = 'OPEN'",
          [club.id]
        );
      } catch (err) {
        console.error(`❌ Cron [${club.name}]: erro ao fechar treinos:`, { code: err.code, sqlMessage: err.sqlMessage, message: err.message });
      }

      try {
        const [courses] = await db.query("SELECT id FROM courses WHERE club_id = ? LIMIT 1", [club.id]);
        const courseId = courses.length > 0 ? courses[0].id : 1;

        await db.query(
          "INSERT INTO tournaments (name, start_date, course_id, club_id, status) VALUES (?, ?, ?, ?, 'OPEN')",
          [`Treino ${dataAmanha}`, dataAmanha, courseId, club.id]
        );
      } catch (err) {
        console.error(`❌ Cron [${club.name}]: erro ao criar treino amanhã:`, { code: err.code, sqlMessage: err.sqlMessage, message: err.message });
      }
    }

    console.log("✅ Fecho diário concluído!");
  });
};

module.exports = { initCronJobs };