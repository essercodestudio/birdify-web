// backend/test_register.js

// Simula o Frontend enviando dados para o Backend
async function criarAdmin() {
    console.log("📡 Enviando dados para criar Admin...");

    try {
        const resposta = await fetch('http://localhost:3001/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: "Organizador do Torneio",
                email: "admin@golf.com",
                password: "senha123", // O sistema vai criptografar isso sozinho
                gender: "M",
                role: "ADMIN"
            })
        });

        const dados = await resposta.json();
        console.log("📩 Resposta do Servidor:", dados);

    } catch (erro) {
        console.error("❌ Erro ao testar:", erro);
    }
}

criarAdmin();