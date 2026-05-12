// backend/controllers/exportController.js
const db = require("../db");
const ExcelJS = require("exceljs");

exports.exportTournamentToExcel = async (req, res) => {
  const { tournamentId } = req.params;

  try {
    // 1. Busca os Dados Básicos (COM VERIFICAÇÃO DE CLUB_ID)
    const [tournamentRows] = await db.execute(
      "SELECT * FROM tournaments WHERE id = ? AND club_id = ?",
      [tournamentId, req.club.id],
    );

    if (tournamentRows.length === 0) {
      return res
        .status(404)
        .json({ error: "Torneio não encontrado ou acesso negado." });
    }

    const tournament = tournamentRows[0];

    const [categories] = await db.execute(
      "SELECT name FROM tournament_categories WHERE tournament_id = ?",
      [tournamentId],
    );

    console.log(
      "🔍 [ESPIÃO EXCEL] ID DO CAMPO (course_id):",
      tournament.course_id,
    );

    // 2. BUSCA DUPLA DE BURACOS (Tenta em 'holes' e se falhar tenta em 'course_holes')
    let holes = [];
    if (tournament.course_id) {
      try {
        const [holesRows] = await db.execute(
          "SELECT * FROM holes WHERE course_id = ?",
          [tournament.course_id],
        );
        holes = holesRows;
      } catch (err) {
        console.log("A tabela não se chama 'holes'...");
      }

      // Se não achou na primeira, tenta na segunda
      if (holes.length === 0) {
        try {
          const [courseHolesRows] = await db.execute(
            "SELECT * FROM course_holes WHERE course_id = ?",
            [tournament.course_id],
          );
          holes = courseHolesRows;
        } catch (err) {
          console.log("Tabela 'course_holes' também não encontrada");
        }
      }
    }
    
    console.log("🔍 [ESPIÃO EXCEL] BURACOS ENCONTRADOS:", holes.length);
    if (holes.length > 0) {
      console.log("⛳ [RAIO-X] DADOS DO BURACO 1:", holes[0]);
    }

    // 3. Busca os Jogadores e os seus Handicaps
    const playersQuery = `
            SELECT gp.user_id, u.name, u.gender, gp.handicap 
            FROM group_players gp
            JOIN users u ON gp.user_id = u.id
            JOIN tournament_groups tg ON gp.group_id = tg.id
            WHERE tg.tournament_id = ?
        `;
    const [playersData] = await db.execute(playersQuery, [tournamentId]);

    // 4. Busca os Scores
    const [scoresData] = await db.execute(
      "SELECT user_id, hole_number, strokes FROM scores WHERE tournament_id = ?",
      [tournamentId],
    );

    // 5. Monta o Objeto de cada Jogador
    const players = playersData.map((p) => {
      const playerScores = scoresData.filter((s) => s.user_id === p.user_id);
      let scoresArray = Array(19).fill(0);
      let gross = 0;

      playerScores.forEach((s) => {
        scoresArray[s.hole_number] = s.strokes;
        gross += s.strokes;
      });

      const hc = parseFloat(p.handicap || 0);
      return {
        ...p,
        handicap: hc,
        scores: scoresArray,
        gross: gross,
        net: gross - hc,
        gender: p.gender || "M",
      };
    });

    // 6. LÓGICA DE DESEMPATE USGA
    const getTiebreakerVal = (p, holesList, isNet, fraction) => {
      let sum = 0;
      holesList.forEach((h) => (sum += p.scores[h]));
      return sum - (isNet ? p.handicap * fraction : 0);
    };

    const tiebreakerRules = [
      {
        name: "Últimos 9",
        holes: [10, 11, 12, 13, 14, 15, 16, 17, 18],
        frac: 1 / 2,
      },
      { name: "Últimos 6", holes: [13, 14, 15, 16, 17, 18], frac: 1 / 3 },
      { name: "Últimos 3", holes: [16, 17, 18], frac: 1 / 6 },
      { name: "Último 1", holes: [18], frac: 1 / 18 },
      { name: "Primeiros 9", holes: [1, 2, 3, 4, 5, 6, 7, 8, 9], frac: 1 / 2 },
    ];

    const sortPlayers = (list, isNet) => {
      list.sort((a, b) => {
        let scoreA = isNet ? a.net : a.gross;
        let scoreB = isNet ? b.net : b.gross;
        if (scoreA !== scoreB) return scoreA - scoreB;

        for (let rule of tiebreakerRules) {
          let vA = getTiebreakerVal(a, rule.holes, isNet, rule.frac);
          let vB = getTiebreakerVal(b, rule.holes, isNet, rule.frac);
          if (vA !== vB) return vA - vB;
        }
        return 0;
      });

      for (let i = 1; i < list.length; i++) {
        let p1 = list[i - 1],
          p2 = list[i];
        let s1 = isNet ? p1.net : p1.gross;
        let s2 = isNet ? p2.net : p2.gross;

        if (s1 === s2) {
          for (let rule of tiebreakerRules) {
            let v1 = getTiebreakerVal(p1, rule.holes, isNet, rule.frac);
            let v2 = getTiebreakerVal(p2, rule.holes, isNet, rule.frac);
            if (v1 !== v2) {
              p1.tieReason = `Desempate: ${rule.name}`;
              p2.tieReason = `Desempate: ${rule.name}`;
              break;
            }
          }
        }
      }
      return list;
    };

    // 7. Inicia o ExcelJS
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Golf Score App";

    const allCategories = [
      "Absoluto Gross",
      "Absoluto Net",
      ...categories.map((c) => c.name),
    ];

    allCategories.forEach((tabName) => {
      let filtered = [...players];
      let isNet = tabName.includes("Net") || tabName.match(/M[1-4]|F[1-3]/);

      filtered = filtered.filter((p) => {
        const hc = p.handicap;
        const sexo = p.gender;

        if (tabName === "Absoluto Gross" || tabName === "Absoluto Net")
          return true;
        if (sexo === "M" || sexo === "Masculino") {
          if (tabName.includes("Feminino")) return false;
          if (tabName.includes("Livre") || tabName.includes("M0")) return true;
          if (tabName.includes("M1") && hc >= 0 && hc <= 8.5) return true;
          if (tabName.includes("M2") && hc >= 8.6 && hc <= 14.0) return true;
          if (tabName.includes("M3") && hc >= 14.1 && hc <= 22.1) return true;
          if (tabName.includes("M4") && hc >= 22.2 && hc <= 36.4) return true;
        }
        if (sexo === "F" || sexo === "Feminino") {
          if (tabName.includes("Masculino")) return false;
          if (tabName.includes("Livre") || tabName.includes("F0")) return true;
          if (tabName.includes("F1") && hc >= 0 && hc <= 16.1) return true;
          if (tabName.includes("F2") && hc >= 16.1 && hc <= 23.7) return true;
          if (tabName.includes("F3") && hc >= 23.8 && hc <= 36.4) return true;
        }
        if (tabName.includes("Sênior") || tabName.includes("Duplas"))
          return true;
        return false;
      });

      if (filtered.length === 0) return;

      filtered = sortPlayers(filtered, isNet);

      const sheet = workbook.addWorksheet(tabName.substring(0, 31));

      sheet.columns = [
        { header: "Pos.", width: 6 },
        { header: "Nome", width: 30 },
        { header: "HDC", width: 8 },
        { header: "B1", width: 5 },
        { header: "B2", width: 5 },
        { header: "B3", width: 5 },
        { header: "B4", width: 5 },
        { header: "B5", width: 5 },
        { header: "B6", width: 5 },
        { header: "B7", width: 5 },
        { header: "B8", width: 5 },
        { header: "B9", width: 5 },
        { header: "1ª Volta", width: 10 },
        { header: "B10", width: 5 },
        { header: "B11", width: 5 },
        { header: "B12", width: 5 },
        { header: "B13", width: 5 },
        { header: "B14", width: 5 },
        { header: "B15", width: 5 },
        { header: "B16", width: 5 },
        { header: "B17", width: 5 },
        { header: "B18", width: 5 },
        { header: "2ª Volta", width: 10 },
        { header: "GROSS", width: 10 },
        { header: "NET", width: 10 },
        { header: "Desempate Aplicado", width: 25 },
      ];

      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { horizontal: "center" };

      // LINHA 2: A MÁGICA DO PAR
      let parOut = 0,
        parIn = 0;
      let parArray = Array(19).fill(0);

      if (holes && holes.length > 0) {
        holes.forEach((h) => {
          let hNum = Number(h.hole_number || h.hole || h.numero);
          let hPar = Number(h.par || h.par_value || 4);

          if (hNum >= 1 && hNum <= 18) {
            parArray[hNum] = hPar;
            if (hNum <= 9) parOut += hPar;
            else parIn += hPar;
          }
        });
      }

      // O PLANO B CONTINUA AQUI CASO A LISTA SEJA ZERO
      if (parOut === 0 && parIn === 0) {
        for (let i = 1; i <= 18; i++) parArray[i] = 4;
        parOut = 36;
        parIn = 36;
      }

      const parRow = sheet.addRow([
        "",
        "PAR DO CAMPO",
        "",
        parArray[1],
        parArray[2],
        parArray[3],
        parArray[4],
        parArray[5],
        parArray[6],
        parArray[7],
        parArray[8],
        parArray[9],
        parOut,
        parArray[10],
        parArray[11],
        parArray[12],
        parArray[13],
        parArray[14],
        parArray[15],
        parArray[16],
        parArray[17],
        parArray[18],
        parIn,
        parOut + parIn,
        parOut + parIn,
        "",
      ]);

      parRow.font = { bold: true, color: { argb: "FF000000" } };
      parRow.alignment = { horizontal: "center" };
      parRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDDDDD" },
      };

      filtered.forEach((p, index) => {
        let outSum = 0,
          inSum = 0;
        for (let i = 1; i <= 9; i++) outSum += p.scores[i];
        for (let i = 10; i <= 18; i++) inSum += p.scores[i];

        sheet.addRow([
          index + 1,
          p.name,
          p.handicap,
          p.scores[1] || "-",
          p.scores[2] || "-",
          p.scores[3] || "-",
          p.scores[4] || "-",
          p.scores[5] || "-",
          p.scores[6] || "-",
          p.scores[7] || "-",
          p.scores[8] || "-",
          p.scores[9] || "-",
          outSum,
          p.scores[10] || "-",
          p.scores[11] || "-",
          p.scores[12] || "-",
          p.scores[13] || "-",
          p.scores[14] || "-",
          p.scores[15] || "-",
          p.scores[16] || "-",
          p.scores[17] || "-",
          p.scores[18] || "-",
          inSum,
          p.gross,
          p.net,
          p.tieReason || "",
        ]).alignment = { horizontal: "center" };
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Torneio_${tournament.name || "export"}.xlsx"`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Erro ao gerar Excel:", error);
    res.status(500).json({ error: "Erro ao gerar Excel." });
  }
};
