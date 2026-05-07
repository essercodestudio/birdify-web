const db = require('./db');
(async () => {
  try {
    // Verificar colunas de training_participants
    const [cols] = await db.execute(`SHOW COLUMNS FROM training_participants`);
    console.log('training_participants cols:', cols.map(c => c.Field));

    // Verificar colunas de training_groups
    const [gcols] = await db.execute(`SHOW COLUMNS FROM training_groups`);
    console.log('training_groups cols:', gcols.map(c => c.Field));

    // Verificar colunas de courses
    const [ccols] = await db.execute(`SHOW COLUMNS FROM courses`);
    console.log('courses cols:', ccols.map(c => c.Field));

    // Testar a query problemática isolada
    const [rows] = await db.execute(`
      SELECT tg.id, tp.user_id
      FROM training_groups tg
      LEFT JOIN training_participants tp ON tp.group_id = tg.id
      WHERE tg.club_id = 1
        AND DATE(tg.created_at) = CURDATE()
        AND tg.status = 'aguardando'
        AND tg.id NOT IN (
          SELECT group_id FROM training_participants WHERE user_id = 0
        )
      LIMIT 3
    `);
    console.log('lobby query OK, rows:', rows.length);
  } catch (e) {
    console.error('ERRO:', e.message);
    console.error('SQL:', e.sql);
  }
  process.exit(0);
})();
