async function criarTorneioTeste() {
    console.log("⛳ Criando Torneio...");
    
    // ATENÇÃO: Certifica-te que rodaste o INSERT do campo no Workbench antes!
    const dados = {
        name: "Torneio de Abertura 2026",
        course_id: 1, // Estamos usando o campo que criamos manualmente
        start_date: "2026-05-20 09:00:00"
    };

    const resposta = await fetch('http://localhost:3001/api/tournaments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
    });

    const json = await resposta.json();
    console.log(json);
}

criarTorneioTeste();