// backend/controllers/courseController.js
const db = require('../db');

// 1. Listar todos os campos
exports.listCourses = (req, res) => {
    db.query('SELECT * FROM courses', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// 2. Pegar buracos (Cura Automática: Se não tiver buracos na tabela nova, cria na hora!)
exports.getCourseHoles = (req, res) => {
    const { id } = req.params; 
    const query = 'SELECT * FROM holes WHERE course_id = ? ORDER BY hole_number ASC';
    
    db.query(query, [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Se o banco não achar os buracos, nós criamos eles na hora para não sumir da tela!
        if (results.length === 0) {
            console.log(`⚠️ Campo ID ${id} estava sem buracos. Criando 18 buracos zerados...`);
            
            const holesData = Array.from({ length: 18 }, (_, i) => [id, i + 1, 4, 0, 0, 0, 0]);
            const insertQuery = "INSERT INTO holes (course_id, hole_number, par, yards_white, yards_yellow, yards_blue, yards_red) VALUES ?";
            
            db.query(insertQuery, [holesData], (insertErr) => {
                if (insertErr) return res.status(500).json({ error: insertErr.message });
                
                // Agora que criou, busca de novo e manda pra tela
                db.query(query, [id], (err2, newResults) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json(newResults);
                });
            });
        } else {
            // Se já tiver os buracos, só envia normal
            res.json(results);
        }
    });
};

// 3. Criar Campo e Buracos
exports.createCourse = (req, res) => {
  const { name, city, state } = req.body;

  if (!name || !city || !state) {
      return res.status(400).json({ error: "Nome, cidade e estado são obrigatórios." });
  }

  const query = "INSERT INTO courses (name, city, state) VALUES (?, ?, ?)";

  db.query(query, [name, city, state], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const courseId = result.insertId;
    
    // Inserindo os 18 buracos na tabela 'holes'
    const holesQuery = "INSERT INTO holes (course_id, hole_number, par, yards_white, yards_yellow, yards_blue, yards_red) VALUES ?";
    const holesData = Array.from({ length: 18 }, (_, i) => [courseId, i + 1, 4, 0, 0, 0, 0]);

    db.query(holesQuery, [holesData], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: "Campo e buracos criados com sucesso!", courseId });
    });
  });
};

// 4. ATUALIZAR BURACOS (CORRIGIDO: Salvando na tabela 'holes')
exports.updateHoles = (req, res) => {
    const { holes } = req.body;

    const updates = holes.map(h => {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE holes 
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

// 5. EXCLUIR CAMPO (CORRIGIDO: Apagando os buracos da tabela 'holes')
exports.deleteCourse = (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM holes WHERE course_id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('DELETE FROM courses WHERE id = ?', [id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Campo excluído com sucesso!' });
        });
    });
};

// 6. ATUALIZAR NOME, CIDADE E ESTADO DO CAMPO
exports.updateCourse = (req, res) => {
    const { id } = req.params;
    const { name, city, state } = req.body;

    const query = 'UPDATE courses SET name = ?, city = ?, state = ? WHERE id = ?';
    
    db.query(query, [name, city, state, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Informações do campo atualizadas com sucesso!' });
    });
};