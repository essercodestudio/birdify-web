// backend/controllers/courseController.js
const db = require('../db');

// 1. Listar todos os campos
exports.listCourses = (req, res) => {
    db.query('SELECT * FROM courses', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// 2. Pegar buracos
exports.getCourseHoles = (req, res) => {
    const { courseId } = req.params;
    const query = 'SELECT * FROM course_holes WHERE course_id = ? ORDER BY hole_number ASC';
    db.query(query, [courseId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};
exports.createCourse = (req, res) => {
  // Agora recebemos name, city e state do Front-end
  const { name, city, state } = req.body;

  if (!name || !city || !state) {
      return res.status(400).json({ error: "Nome, cidade e estado são obrigatórios." });
  }

  // Atualizamos a query para inserir as 3 informações
  const query = "INSERT INTO courses (name, city, state) VALUES (?, ?, ?)";

  db.query(query, [name, city, state], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const courseId = result.insertId;
    
    // O resto continua igual: criando os 18 buracos zerados...
    const holesQuery = "INSERT INTO holes (course_id, hole_number, par, yards_white, yards_yellow, yards_blue, yards_red) VALUES ?";
    const holesData = Array.from({ length: 18 }, (_, i) => [courseId, i + 1, 4, 0, 0, 0, 0]);

    db.query(holesQuery, [holesData], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: "Campo e buracos criados com sucesso!", courseId });
    });
  });
};

// 4. ATUALIZAR BURACOS (Salva Par e as 4 Jardas)
exports.updateHoles = (req, res) => {
    const { holes } = req.body;

    const updates = holes.map(h => {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE course_holes 
                SET par = ?, 
                    yards_white = ?, 
                    yards_yellow = ?, 
                    yards_blue = ?, 
                    yards_red = ? 
                WHERE id = ?
            `;
            db.query(query, [h.par, h.yards_white, h.yards_yellow, h.yards_blue, h.yards_red, h.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });

    Promise.all(updates)
        .then(() => res.json({ message: 'Configuração do campo atualizada!' }))
        .catch(err => res.status(500).json({ error: err.message }));
};
// EXCLUIR CAMPO
exports.deleteCourse = (req, res) => {
    const { id } = req.params;
    // Apaga os buracos primeiro, depois o campo
    db.query('DELETE FROM course_holes WHERE course_id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('DELETE FROM courses WHERE id = ?', [id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Campo excluído com sucesso!' });
        });
    });
};