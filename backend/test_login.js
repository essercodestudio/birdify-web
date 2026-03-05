// backend/test_login.js
async function testarLogin() {
  console.log("🔑 Tentando fazer login...");

  try {
    const resposta = await fetch("http://localhost:3001/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@golf.com", // O mesmo que criaste antes
        password: "senha123", // A senha correta
      }),
    });

    const dados = await resposta.json();

    if (resposta.ok) {
      console.log("✅ SUCESSO:", dados.message);
      console.log("👤 Quem entrou:", dados.user.name);
    } else {
      console.log("❌ ERRO:", dados.message);
    }
  } catch (erro) {
    console.error("Erro na requisição:", erro);
  }
}

testarLogin();
