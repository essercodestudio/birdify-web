const cron = require('node-cron');
const db = require('../db');

const initCronJobs = () => {
  // Configurado para rodar a cada minuto APENAS PARA TESTE (* * * * *). 
  // Depois do teste, volte para: '59 59 23 * * *'
 cron.schedule('59 59 23 * * *', async () => {
    console.log("🌙 Iniciando processamento de fecho diário...");
    
    try {
      // 1. Buscar todos os clubes ativos
      const [clubs] = await db.query("SELECT id, name FROM clubs");
      
      const hoje = new Date().toISOString().split('T')[0];
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const dataAmanha = amanha.toISOString().split('T')[0];

      for (const club of clubs) {
        console.log(`⛳ Processando Clube: ${club.name}`);

        // 2. Marcar treinos de hoje como 'concluido' (Histórico)
        await db.query(
          "UPDATE tournaments SET status = 'concluido' WHERE club_id = ? AND name LIKE 'Treino %' AND status = 'OPEN'",
          [club.id]
        );

        // 3. Pegar o ID do campo (course) principal do clube
        const [courses] = await db.query("SELECT id FROM courses WHERE club_id = ? LIMIT 1", [club.id]);
        const courseId = courses.length > 0 ? courses[0].id : 1;

        // 4. Criar o treino para amanhã usando 'start_date' e 'OPEN'
        await db.query(
          "INSERT INTO tournaments (name, start_date, course_id, club_id, status) VALUES (?, ?, ?, ?, 'OPEN')",
          [`Treino ${dataAmanha}`, dataAmanha, courseId, club.id]
        );
      }

      console.log("✅ Todos os clubes foram atualizados para amanhã!");
    } catch (error) {
      console.error("❌ Erro no Cron Job:", error);
    }
  });
};

module.exports = { initCronJobs };