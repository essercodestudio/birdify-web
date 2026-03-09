// backend/controllers/courseController.js
const db = require('../db');

// 1. Listar todos os campos
exports.listCourses = async (req, res) => {
    try {
        const [courses] = await db.execute('SELECT * FROM courses');
        res.json(courses);
    } catch (error) {
        console.error('Erro ao listar cursos:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

// 2. Pegar buracos (Cura Automática: Se não tiver buracos na tabela nova, cria na hora!)
exports.getCourseHoles = async (req, res) => {
    try {
        const { id } = req.params; 
        const query = 'SELECT * FROM holes WHERE course_id = ? ORDER BY hole_number ASC';
        
        const [holes] = await db.execute(query, [id]);
        
        // Se o banco não achar os buracos, nós criamos eles na hora para não sumir da tela!
        if (holes.length === 0) {
            console.log(`⚠️ Campo ID ${id} estava sem buracos. Criando 18 buracos zerados...`);
            
            const holesData = Array.from({ length: 18 }, (_, i) => [id, i + 1, 4, 0, 0, 0, 0]);
            const insertQuery = "INSERT INTO holes (course_id, hole_number, par, yards_white, yards_yellow, yards_blue, yards_red) VALUES ?";
            
            await db.query(insertQuery, [holesData]);
            
            // Agora que criou, busca de novo e manda pra tela
            const [newHoles] = await db.execute(query, [id]);
            res.json(newHoles);
        } else {
            // Se já tiver os buracos, só envia normal
            res.json(holes);
        }
    } catch (error) {
        console.error('Erro ao buscar buracos:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

// 3. Criar Campo e Buracos
exports.createCourse = async (req, res) => {
    try {
        const { name, city, state } = req.body;

        if (!name || !city || !state) {
            return res.status(400).json({ error: "Nome, cidade e estado são obrigatórios." });
        }

        const query = "INSERT INTO courses (name, city, state) VALUES (?, ?, ?)";
        const [result] = await db.execute(query, [name, city, state]);
        
        const courseId = result.insertId;
        
        // Inserindo os 18 buracos na tabela 'holes'
        const holesQuery = "INSERT INTO holes (course_id, hole_number, par, yards_white, yards_yellow, yards_blue, yards_red) VALUES ?";
        const holesData = Array.from({ length: 18 }, (_, i) => [courseId, i + 1, 4, 0, 0, 0, 0]);

        await db.query(holesQuery, [holesData]);
        
        res.status(201).json({ 
            message: "Campo e buracos criados com sucesso!", 
            courseId 
        });
        
    } catch (error) {
        console.error('Erro ao criar campo:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

// 4. ATUALIZAR BURACOS (CORRIGIDO: Salvando na tabela 'holes')
exports.updateHoles = async (req, res) => {
    try {
        const { holes } = req.body;

        // Verifica se holes foi enviado e é um array
        if (!holes || !Array.isArray(holes) || holes.length === 0) {
            return res.status(400).json({ error: "Dados dos buracos são obrigatórios." });
        }

        // Usando Promise.all para executar todas as atualizações em paralelo
        const updatePromises = holes.map(async (h) => {
            const query = `
                UPDATE holes 
                SET par = ?, 
                    yards_white = ?, 
                    yards_yellow = ?, 
                    yards_blue = ?, 
                    yards_red = ? 
                WHERE id = ?
            `;
            await db.execute(query, [h.par, h.yards_white, h.yards_yellow, h.yards_blue, h.yards_red, h.id]);
        });

        await Promise.all(updatePromises);
        
        res.json({ message: 'Configuração do campo atualizada!' });
        
    } catch (error) {
        console.error('Erro ao atualizar buracos:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

// 5. EXCLUIR CAMPO (CORRIGIDO: Apagando os buracos da tabela 'holes')
exports.deleteCourse = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Primeiro deleta os buracos (foreign key)
        await db.execute('DELETE FROM holes WHERE course_id = ?', [id]);
        
        // Depois deleta o campo
        const [result] = await db.execute('DELETE FROM courses WHERE id = ?', [id]);
        
        // Verifica se algum registro foi realmente deletado
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Campo não encontrado.' });
        }
        
        res.json({ message: 'Campo excluído com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao excluir campo:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};

// 6. ATUALIZAR NOME, CIDADE E ESTADO DO CAMPO
exports.updateCourse = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, city, state } = req.body;

        // Validação básica
        if (!name || !city || !state) {
            return res.status(400).json({ error: "Nome, cidade e estado são obrigatórios." });
        }

        const query = 'UPDATE courses SET name = ?, city = ?, state = ? WHERE id = ?';
        const [result] = await db.execute(query, [name, city, state, id]);
        
        // Verifica se o campo foi encontrado e atualizado
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Campo não encontrado.' });
        }
        
        res.json({ message: 'Informações do campo atualizadas com sucesso!' });
        
    } catch (error) {
        console.error('Erro ao atualizar campo:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            message: error.message 
        });
    }
};