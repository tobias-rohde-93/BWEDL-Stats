
// --- Dashboard Logic ---
function calculatePlayerStats(p) {
    let sum = 0;
    let count = 0;
    if (!p.rounds) return { avg: 0, count: 0 };

    for (let i = 1; i <= 18; i++) {
        const val = p.rounds[`R${i}`];
        if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
            sum += parseInt(val);
            count++;
        }
    }
    return {
        avg: count > 0 ? (sum / count) : 0,
        count: count
    };
}

function extractLeagueLeader(tableHtml) {
    // Simple regex to find the first data row (Rank 1)
    // Assumes structure: <tr><td>1</td><td>TEAMNAME</td>...
    // Or similar. Let's try to be generic. 
    // We create a temp div to parse.
    const temp = document.createElement('div');
    temp.innerHTML = tableHtml;
    const rows = temp.querySelectorAll('tr');
    for (let row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length > 2) {
            // Check if first cell is '1' or '1.'
            const rankText = cells[0].textContent.trim().replace('.', '');
            if (rankText === '1') {
                return cells[1].textContent.trim(); // Usually team name is 2nd column
            }
        }
    }
    return null;
}

function renderDashboard() {
    topBarTitle.textContent = "Dashboard";
    contentArea.innerHTML = '';

    const container = document.createElement('div');
    container.style.padding = "20px";
    container.style.maxWidth = "1200px";
    container.style.margin = "0 auto";

    // --- Top Players Section ---
    let allPlayers = [];
    if (rankingData.players) {
        allPlayers = rankingData.players.map(p => {
            const stats = calculatePlayerStats(p);
            return { ...p, ...stats };
        });
    }

    // Filter players with at least 3 games to be relevant
    const topPlayers = allPlayers.filter(p => p.count >= 3)
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 5);

    const playersSection = document.createElement('div');
    playersSection.style.marginBottom = "40px";

    let playersHtml = `<h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px;">🔥 Top Performance (Ø > 3 Spiele)</h2>`;
    playersHtml += `<div class="results-group" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">`;

    topPlayers.forEach((p, idx) => {
        // Find club name for context
        let clubName = p.company || (clubData.clubs.find(c => c.number === p.v_nr)?.name) || "";

        playersHtml += `
            <div style="background: #1e293b; padding: 15px; border-radius: 8px; border: 1px solid #334155; display: flex; align-items: center; gap: 15px; transition: transform 0.2s;" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
                <div style="font-size: 1.5em; font-weight: bold; color: #64748b; width: 30px;">${idx + 1}.</div>
                <div style="flex: 1;">
                    <div style="font-weight: 600; color: #f8fafc; font-size: 1.1em;">${p.name}</div>
                    <div style="font-size: 0.85em; color: #94a3b8;">${clubName}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 1.4em; font-weight: 700; color: #4ade80;">${p.avg.toFixed(2)}</div>
                    <div style="font-size: 0.75em; color: #64748b;">Ø Punkte</div>
                </div>
            </div>`;
    });
    playersHtml += `</div>`;
    playersSection.innerHTML = playersHtml;
    container.appendChild(playersSection);


    // --- League Leaders Section ---
    const leaguesSection = document.createElement('div');
    let leaguesHtml = `<h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px;">🏆 Tabellenführer</h2>`;
    leaguesHtml += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">`;

    if (leagueData.leagues) {
        Object.keys(leagueData.leagues).sort().forEach(leagueName => {
            const data = leagueData.leagues[leagueName];
            if (data.table) {
                const leader = extractLeagueLeader(data.table);
                if (leader) {
                    leaguesHtml += `
                        <div style="background: #1e293b; padding: 15px 20px; border-radius: 8px; border: 1px solid #334155; cursor: pointer;" onclick="navigateTo('league', '${leagueName}')">
                            <div style="font-size: 0.85em; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">${leagueName}</div>
                            <div style="font-size: 1.1em; font-weight: 600; color: #f8fafc;">${leader}</div>
                        </div>`;
                }
            }
        });
    }
    leaguesHtml += `</div>`;
    leaguesSection.innerHTML = leaguesHtml;
    container.appendChild(leaguesSection);

    contentArea.appendChild(container);
}
