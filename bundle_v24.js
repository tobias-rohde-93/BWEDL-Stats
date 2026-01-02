// Global Error Handler
window.onerror = function (msg, url, line, col, error) {
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.top = '0';
    div.style.left = '0';
    div.style.width = '100%';
    div.style.background = '#ef4444';
    div.style.color = 'white';
    div.style.padding = '15px';
    div.style.zIndex = '99999';
    div.style.fontFamily = 'monospace';
    div.style.fontSize = '14px';
    div.textContent = `JS Error: ${msg} (Line ${line}:${col})`;
    document.body.appendChild(div);
    return false;
};

document.addEventListener('DOMContentLoaded', () => {
    const nav = document.getElementById('league-nav');
    const contentArea = document.getElementById('content-area');
    const topBarTitle = document.getElementById('current-league-title');
    const lastUpdatedEl = document.getElementById('last-updated');
    const template = document.getElementById('league-view-template');

    const searchInput = document.getElementById('global-search');
    const searchResults = document.getElementById('search-results');
    const backBtn = document.getElementById('back-btn');

    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', goBack);
    }

    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    // Favorites State (Hoisted to avoid TDZ)
    let favorites = [];
    try {
        favorites = JSON.parse(localStorage.getItem('bwedl_favorites')) || [];
        if (!Array.isArray(favorites)) favorites = [];
    } catch (e) {
        console.error("Failed to parse favorites", e);
    }

    // --- My Profile State ---
    let myPlayerName = localStorage.getItem('myPlayerName');
    let myTeamName = localStorage.getItem('myTeamName');
    const setMyPlayer = (name) => {
        if (name) {
            localStorage.setItem('myPlayerName', name);
            myPlayerName = name;
        } else {
            localStorage.removeItem('myPlayerName');
            myPlayerName = null;
        }
        // Update Sidebar Link
        const link = document.getElementById('my-profile-link');
        if (link) {
            link.innerHTML = myPlayerName ? `👤 ${myPlayerName}` : `👤 Mein Profil`;
            link.style.color = myPlayerName ? "#f8fafc" : "#94a3b8";
        }
        renderDashboard();
    };

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 &&
                sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) &&
                e.target !== menuToggle) {
                sidebar.classList.remove('open');
            }
        });

        // Close sidebar when a link inside it is clicked
        sidebar.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                // If clicked element is a link or clickable item (league-item)
                if (e.target.classList.contains('league-item') || e.target.tagName === 'A') {
                    sidebar.classList.remove('open');
                }
            }
        });
    }

    // State Variables
    let leagueData = {};
    let rankingData = {};
    let clubData = {};
    let archiveData = {};

    // Search & Navigation Globals
    window.searchIndex = [];
    // let searchIndex = window.searchIndex; // Removed to prevent TDZ issues
    let historyStack = [];
    let isNavigatingBack = false;
    let currentState = null;

    // Load Data
    if (typeof LEAGUE_DATA !== 'undefined') leagueData = LEAGUE_DATA;
    else if (window.LEAGUE_DATA) leagueData = window.LEAGUE_DATA;

    if (typeof RANKING_DATA !== 'undefined') rankingData = RANKING_DATA;
    else if (window.RANKING_DATA) rankingData = window.RANKING_DATA;

    if (typeof CLUB_DATA !== 'undefined') clubData = CLUB_DATA;
    else if (window.CLUB_DATA) clubData = window.CLUB_DATA;

    if (typeof ARCHIVE_DATA !== 'undefined') archiveData = ARCHIVE_DATA;
    else if (window.ARCHIVE_DATA) archiveData = window.ARCHIVE_DATA;

    if (Object.keys(leagueData).length === 0) {
        fetch('league_data.json')
            .then(res => res.json())
            .then(data => {
                leagueData = data;
                init();
            })
            .catch(e => {
                console.error("Fetch failed", e);
                init();
            });
    } else {
        init();
    }

    function init() {
        // Inject Styles for Highlighting
        if (!document.getElementById('my-profile-styles')) {
            const style = document.createElement('style');
            style.id = 'my-profile-styles';
            style.innerHTML = `
                .my-player-row {
                    background-color: rgba(59, 130, 246, 0.15) !important;
                    border-left: 3px solid #3b82f6 !important;
                }
                .my-player-text {
                    color: #60a5fa !important;
                    font-weight: bold;
                }
            `;
            document.head.appendChild(style);
        }

        if (leagueData.last_updated) {
            lastUpdatedEl.textContent = `Stand: ${leagueData.last_updated}`;
        }


        // 0. Pre-sort Clubs
        if (clubData.clubs && clubData.clubs.length > 0) {
            clubData.clubs.sort((a, b) => {
                if (!a.name) return 1;
                if (!b.name) return -1;
                return a.name.localeCompare(b.name);
            });
        }

        // Build Index immediately if data present
        try {
            buildSearchIndex();
        } catch (e) {
            console.error("Search Build Error", e);
        }

        // Safety Fallback: Re-build after 2 seconds to ensure data is settled
        setTimeout(() => {
            // Use global window.searchIndex to check
            if (!window.searchIndex || window.searchIndex.length < 50) {
                console.log("Retrying Search Index Build...");
                buildSearchIndex();
            }
        }, 2000);

        // --- Render Sidebar ---
        // nav.innerHTML = ""; // Don't clear immediately if we want to show debug above.
        // Instead, clear only if we have data to show.
        if (leagueData.leagues) {
            nav.innerHTML = ""; // Clear for fresh render

            // --- Dashboard Link ---
            const dashboardLink = document.createElement('div');
            dashboardLink.className = 'nav-section-header';
            dashboardLink.innerHTML = '🏠 DASHBOARD';
            dashboardLink.style.padding = "15px";
            dashboardLink.style.cursor = "pointer";
            dashboardLink.style.color = "#f8fafc";
            dashboardLink.style.fontWeight = "bold";
            dashboardLink.style.backgroundColor = "#1e293b";
            dashboardLink.style.borderBottom = "1px solid #334155";
            dashboardLink.onmouseover = () => dashboardLink.style.backgroundColor = "#334155";
            dashboardLink.onmouseout = () => dashboardLink.style.backgroundColor = "#1e293b";
            dashboardLink.onclick = () => navigateTo('dashboard');
            nav.appendChild(dashboardLink);

            // --- My Profile Link ---
            const profileLink = document.createElement('div');
            profileLink.id = 'my-profile-link';
            profileLink.className = 'nav-section-header';
            profileLink.innerHTML = myPlayerName ? `👤 ${myPlayerName}` : `👤 Mein Profil`;
            profileLink.style.padding = "10px 15px";
            profileLink.style.cursor = "pointer";
            profileLink.style.color = "#94a3b8";
            profileLink.style.fontSize = "0.9em";
            profileLink.style.borderBottom = "1px solid #334155";
            profileLink.onmouseover = () => profileLink.style.color = "#f8fafc";
            profileLink.onmouseout = () => profileLink.style.color = "#94a3b8";
            profileLink.onclick = () => navigateTo('profile');
            nav.appendChild(profileLink);
        }

        // 1. Leagues
        if (leagueData.leagues) {
            const leagueHeader = document.createElement('div');
            leagueHeader.className = 'nav-section-header';
            leagueHeader.innerHTML = '<span style="display:inline-block; width:15px; transition: transform 0.2s;">▶</span> LIGEN';
            leagueHeader.style.padding = "10px 15px 5px";
            leagueHeader.style.color = "#888";
            leagueHeader.style.fontSize = "0.8em";
            leagueHeader.style.fontWeight = "bold";
            leagueHeader.style.cursor = "pointer";
            nav.appendChild(leagueHeader);

            const container = document.createElement('div');
            container.style.display = "none"; // Hidden by default
            container.style.paddingLeft = "0";

            leagueHeader.addEventListener('click', () => {
                const isHidden = container.style.display === "none";
                container.style.display = isHidden ? "block" : "none";
                leagueHeader.querySelector('span').style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
            });

            const leagues = Object.keys(leagueData.leagues).sort();
            leagues.forEach(leagueName => {
                const el = document.createElement('div');
                el.className = 'league-item';
                el.textContent = leagueName;
                el.addEventListener('click', () => {
                    navigateTo('league', leagueName);
                });
                container.appendChild(el);
            });
            nav.appendChild(container);
        }

        // 2. Rankings
        if (rankingData.rankings) {
            const rankingHeader = document.createElement('div');
            rankingHeader.className = 'nav-section-header';
            rankingHeader.innerHTML = '<span style="display:inline-block; width:15px; transition: transform 0.2s;">▶</span> RANGLISTEN';
            rankingHeader.style.padding = "15px 15px 5px";
            rankingHeader.style.color = "#888";
            rankingHeader.style.fontSize = "0.8em";
            rankingHeader.style.fontWeight = "bold";
            rankingHeader.style.cursor = "pointer";
            nav.appendChild(rankingHeader);

            const container = document.createElement('div');
            container.style.display = "none";
            container.style.paddingLeft = "0";

            rankingHeader.addEventListener('click', () => {
                const isHidden = container.style.display === "none";
                container.style.display = isHidden ? "block" : "none";
                rankingHeader.querySelector('span').style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
            });

            const ranks = Object.keys(rankingData.rankings).sort();
            ranks.forEach(rankName => {
                const el = document.createElement('div');
                el.className = 'league-item';
                el.textContent = rankName;
                el.addEventListener('click', () => {
                    navigateTo('ranking', rankName);
                });
                container.appendChild(el);
            });
            nav.appendChild(container);
        }

        // 3. Clubs
        if (clubData.clubs && clubData.clubs.length > 0) {
            /* Sorted at top of init */

            const header = document.createElement('div');
            header.className = 'nav-section-header';
            header.innerHTML = '<span style="display:inline-block; width:15px; transition: transform 0.2s;">▶</span> VEREINE';
            header.style.padding = "15px 15px 5px";
            header.style.color = "#888";
            header.style.fontSize = "0.8em";
            header.style.fontWeight = "bold";
            header.style.cursor = "pointer";
            header.title = "Klicken zum Ausklappen / Titel klicken für Übersicht";
            nav.appendChild(header);

            const container = document.createElement('div');
            container.style.display = "none";
            container.style.paddingLeft = "0";

            header.addEventListener('click', (e) => {
                // If user clicks the text "VEREINE" or the arrow, toggle.
                // But we also have navigation logic for 'clubList'. 
                // Let's split: Arrow -> Toggle, Text -> Toggle. 
                // Wait, original logic navigated to clubList on click. 
                // Let's keep toggle on Arrow/Header, and maybe add a "All Clubs" item inside or just toggle.
                // Re-reading user request: "ausklappbar sind". 
                // I will make the whole header toggle. The "Club Overview" can be the first item in the list or explicitly added.

                const isHidden = container.style.display === "none";
                container.style.display = isHidden ? "block" : "none";
                header.querySelector('span').style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
            });

            // Add 'All Clubs' link as first item
            const allClubsEl = document.createElement('div');
            allClubsEl.className = 'league-item';
            allClubsEl.innerHTML = '<i>Alle Vereine (Übersicht)</i>';
            allClubsEl.addEventListener('click', () => {
                navigateTo('clubList', null);
            });
            container.appendChild(allClubsEl);

            clubData.clubs.forEach((club, index) => {
                const el = document.createElement('div');
                el.className = 'league-item';
                el.textContent = club.name;
                el.addEventListener('click', () => {
                    navigateTo('club', index);
                });
                container.appendChild(el);
            });
            nav.appendChild(container);
        }

        // 4. Comparison (New)
        const compareLink = document.createElement('div');
        compareLink.className = 'nav-section-header';
        compareLink.innerHTML = '🆚 VERGLEICH';
        compareLink.style.padding = "15px 15px 5px";
        compareLink.style.color = "#888";
        compareLink.style.fontSize = "0.8em";
        compareLink.style.fontWeight = "bold";
        compareLink.style.cursor = "pointer";
        compareLink.onclick = () => navigateTo('comparison');
        nav.appendChild(compareLink);

        nav.appendChild(compareLink);

        // 5. All-Time Table (New)
        const allTimeLink = document.createElement('div');
        allTimeLink.className = 'nav-section-header';
        allTimeLink.innerHTML = '🏆 EWIGE TABELLE';
        allTimeLink.style.padding = "10px 15px 5px";
        allTimeLink.style.color = "#888";
        allTimeLink.style.fontSize = "0.8em";
        allTimeLink.style.fontWeight = "bold";
        allTimeLink.style.cursor = "pointer";
        allTimeLink.onclick = () => navigateTo('alltime');
        nav.appendChild(allTimeLink);

        allTimeLink.onclick = () => navigateTo('alltime');
        nav.appendChild(allTimeLink);

        // 6. Tools (New)
        const toolsLink = document.createElement('div');
        toolsLink.className = 'nav-section-header';
        toolsLink.innerHTML = '🧮 TOOLS';
        toolsLink.style.padding = "10px 15px 5px";
        toolsLink.style.color = "#888";
        toolsLink.style.fontSize = "0.8em";
        toolsLink.style.fontWeight = "bold";
        toolsLink.style.cursor = "pointer";
        toolsLink.onclick = () => navigateTo('tools');
        nav.appendChild(toolsLink);

        // Show Favorites
        renderFavoritesSidebar();

        // VERSION FOOTER
        const verDiv = document.createElement('div');
        verDiv.style.marginTop = "auto";
        verDiv.style.padding = "10px 15px";
        verDiv.style.color = "#475569";
        verDiv.style.fontSize = "0.7em";
        verDiv.style.textAlign = "center";
        verDiv.innerHTML = "App Version: v2.22 (Network Sync Fix)";
        nav.appendChild(verDiv);
        // Show Dashboard by default
        currentState = { type: 'dashboard', id: null };
        history.replaceState(currentState, "", "#dashboard");
        renderDashboard();

        // Check for Update Snapshot (show summary if recently updated)
        try {
            if (typeof checkUpdateSnapshot === 'function') {
                checkUpdateSnapshot();
            }
        } catch (e) { console.error(e); }
    }

    // --- Search & Navigation Globals (Moved to Top) ---
    // window.searchIndex = []; 
    // let searchIndex = window.searchIndex; 
    // let historyStack = [];
    // let isNavigatingBack = false;
    // let currentState = null;



    function buildSearchIndex() {
        window.searchIndex = [];
        const searchIndex = window.searchIndex; // Local ref for pusb operations



        // 1. Leagues
        if (leagueData.leagues) {
            Object.keys(leagueData.leagues).forEach(l => {
                searchIndex.push({ label: l, type: "Liga", category: 'league', id: l });
            });
        }

        // 2. Clubs
        if (clubData.clubs) {
            clubData.clubs.forEach((c, idx) => {
                searchIndex.push({ label: c.name, type: "Verein", category: 'club', id: idx });
            });
        }

        // 3. Players (from Ranking Data)
        if (rankingData.players) {
            // Deduplicate players by ID or Name+Club
            const seenPlayers = new Set();
            rankingData.players.forEach(p => {
                const uniqueKey = p.id ? p.id : (p.name + p.v_nr);
                if (!seenPlayers.has(uniqueKey)) {
                    seenPlayers.add(uniqueKey);

                    // Find club context if possible
                    let clubName = "";
                    if (clubData.clubs) {
                        const club = clubData.clubs.find(c => c.number === p.v_nr);
                        if (club) clubName = club.name;
                    }

                    let clubIdx = -1;
                    if (clubData.clubs) {
                        clubIdx = clubData.clubs.findIndex(c => c.number === p.v_nr);
                    }

                    if (clubIdx !== -1) {
                        searchIndex.push({
                            label: p.name,
                            type: "Spieler",
                            context: clubName,
                            category: 'club',
                            id: clubIdx
                        });
                    }
                }
            });
        }

        if (searchInput) {
            searchInput.placeholder = `Suche (${searchIndex.length} Einträge)...`;
        }
    }



    // --- Favorites Logic ---
    // (favorites state moved to top of file)

    function saveFavorites() {
        localStorage.setItem('bwedl_favorites', JSON.stringify(favorites));
        renderFavoritesSidebar();
    }

    function toggleFavorite(type, id, name) {
        const index = favorites.findIndex(f => f.type === type && f.id === id);
        if (index === -1) {
            favorites.push({ type, id, name });
        } else {
            favorites.splice(index, 1);
        }
        saveFavorites();

        const btn = document.getElementById('fav-btn');
        if (btn) {
            updateFavBtnState(btn, type, id);
        }
    }

    function isFavorite(type, id) {
        return favorites.some(f => f.type === type && f.id === id);
    }

    function updateFavBtnState(btn, type, id) {
        const isFav = isFavorite(type, id);
        btn.innerHTML = isFav ? "★" : "☆"; // Solid star or hollow star
        btn.style.color = isFav ? "#fbbf24" : "#94a3b8";
        btn.title = isFav ? "Von Favoriten entfernen" : "Zu Favoriten hinzufügen";
    }

    function renderFavoritesSidebar() {
        const existing = document.getElementById('fav-section');
        if (existing) existing.remove();

        if (favorites.length === 0) return;

        const container = document.createElement('div');
        container.id = 'fav-section';
        container.style.borderBottom = "1px solid #334155";
        container.style.marginBottom = "10px";
        container.style.paddingBottom = "10px";

        const header = document.createElement('div');
        header.className = 'nav-section-header';
        header.textContent = "FAVORITEN";
        header.style.padding = "10px 15px 5px";
        header.style.color = "#fbbf24";
        header.style.fontSize = "0.8em";
        header.style.fontWeight = "bold";
        container.appendChild(header);

        favorites.forEach(fav => {
            const el = document.createElement('div');
            el.className = 'league-item';
            el.innerHTML = `<span style="color: #fbbf24; margin-right: 6px;">★</span> ${fav.name}`;
            el.addEventListener('click', () => {
                navigateTo(fav.type, fav.id);
            });
            container.appendChild(el);
        });

        if (nav.firstChild) {
            nav.insertBefore(container, nav.firstChild);
        } else {
            nav.appendChild(container);
        }
    }

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
        const temp = document.createElement('div');
        temp.innerHTML = tableHtml;
        const rows = temp.querySelectorAll('tr');
        for (let row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length > 2) {
                const rankText = cells[0].textContent.trim().replace('.', '');
                if (rankText === '1') {
                    return cells[1].textContent.trim();
                }
            }
        }
        return null;
    }

    // --- Dashboard 2.0 Helpers ---

    function normalizeTeamName(name) {
        if (!name) return "";
        // Convert to lowercase, remove non-alphanumeric (keeping spaces), collapse spaces, trim
        // This ensures "Team" and "Team 2" are distinct ("team" vs "team 2")
        return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    function parseGermanDate(dateStr) {
        if (!dateStr) return null;
        // Format example: "28.11.2025 20:00" or "Di. 26. 8.2025 19:00" or "18.1.26 0:00"
        // Regex to find DD.MM.YYYY (supports 2 or 4 digit year)
        const match = dateStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/);
        if (match) {
            let year = match[3];
            if (year.length === 2) {
                year = "20" + year;
            }
            return new Date(`${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
        }
        return null;
    }

    function getTeamSchedule(leagueKey, myTeamName) {
        const schedule = [];
        const league = leagueData.leagues[leagueKey];
        if (!league || !league.match_days) return schedule;

        const normMyTeam = normalizeTeamName(myTeamName);
        if (!normMyTeam || normMyTeam.length < 2) return schedule; // Guard against empty searches

        Object.keys(league.match_days).forEach(roundKey => {
            const roundText = league.match_days[roundKey];
            const lines = roundText.split('\n');

            lines.forEach(line => {
                const parts = line.split(/\s+-\s+/);
                if (parts.length < 2) return;

                // 1. Process Left Side (Date + Home Team)
                let leftRaw = parts[0].trim();
                let homeTeamRaw = leftRaw;
                let dateStr = "";

                // Regex for German Date+Time at start: "Do. 28.08.2025 20:00" or "18.1.26 0:00"
                const dateMatch = leftRaw.match(/^([A-Za-z]{2}\.?\s*)?(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}\s+\d{1,2}:\d{2})/);
                if (dateMatch) {
                    dateStr = dateMatch[0]; // Capture full date string
                    homeTeamRaw = leftRaw.substring(dateMatch[0].length).trim();
                }

                // 2. Process Right Side (Away Team + Score)
                let rightRaw = parts[1].trim();
                let awayTeamRaw = rightRaw;
                let scoreStr = "---";

                // Extract score at the end: " 9:7", " ---", " : "
                const scoreMatch = rightRaw.match(/(\d+:\d+|---|:\s*)\s*$/);
                if (scoreMatch) {
                    scoreStr = scoreMatch[1];
                    awayTeamRaw = rightRaw.substring(0, scoreMatch.index).trim();
                }

                // 3. Strict Match Check
                const normHome = normalizeTeamName(homeTeamRaw);
                const normAway = normalizeTeamName(awayTeamRaw);

                // Strict equality on normalized strings
                // "dc schmbergereck" !== "dc schmbergereck 2"
                const isHome = normHome === normMyTeam;
                const isAway = normAway === normMyTeam;

                if (!isHome && !isAway) return;

                const opponent = isHome ? awayTeamRaw : homeTeamRaw;
                const dateObj = dateStr ? parseGermanDate(dateStr) : null;

                const myScore = isHome ? scoreStr.split(':')[0] : scoreStr.split(':')[1];
                const opScore = isHome ? scoreStr.split(':')[1] : scoreStr.split(':')[0];

                const isPending = scoreStr === '---' || !scoreStr.includes(':');

                const roundNum = parseInt(roundKey.match(/\d+/)[0]);

                schedule.push({
                    round: roundNum,
                    date: dateObj,
                    opponent: opponent,
                    score: scoreStr,
                    isHome: isHome,
                    isPending: isPending,
                    myTeamResult: isPending ? 'pending' : (parseInt(myScore) > parseInt(opScore) ? 'Won' : (parseInt(myScore) < parseInt(opScore) ? 'Lost' : 'Draw'))
                });
            });
        });

        return schedule.sort((a, b) => a.round - b.round);
    }

    function calculateTrend(p) {
        if (!p.rounds) return null;
        // Rounds are R1, R2, etc. convert to array
        const scores = [];
        for (let i = 1; i <= 18; i++) {
            const val = p.rounds[`R${i}`];
            if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
                scores.push({ r: i, s: parseInt(val) });
            }
        }
        scores.sort((a, b) => a.r - b.r);

        if (scores.length < 3) return { dir: 'flat', val: 0 };

        const last3 = scores.slice(-3);
        const last3Avg = last3.reduce((a, b) => a + b.s, 0) / 3;
        const totalAvg = parseFloat(String(p.avg || 0).replace(',', '.'));

        const diff = last3Avg - totalAvg;
        return {
            dir: diff > 0.5 ? 'up' : (diff < -0.5 ? 'down' : 'flat'),
            diff: Math.abs(diff).toFixed(1),
            last3Avg: last3Avg.toFixed(1)
        };
    }

    // --- Helper to extract ALL teams from all leagues ---
    function getAllLeagueTeams() {
        const teams = new Set();
        if (typeof leagueData === 'undefined' || !leagueData.leagues) return [];

        Object.values(leagueData.leagues).forEach(league => {
            if (league.match_days) {
                Object.values(league.match_days).forEach(dayContent => {
                    const lines = dayContent.split('\n');
                    lines.forEach(line => {
                        // Split strict by " - " to isolate home and away sides
                        const parts = line.split(/\s+-\s+/);
                        if (parts.length >= 2) {
                            let left = parts[0].trim();

                            // Aggressive regex to strip German Date/Time prefix
                            // Matches: "Di. 28.08.2025 20:00 " or "18.1.26 0:00 " etc.
                            // Components: Optional Day (Mo.|Di.|...), Date (D.M.YY or DD.MM.YYYY), Time (H:MM or HH:MM)
                            const dateTimeRegex = /^([A-Za-z]{2}\.?\s*)?(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4})\s+(\d{1,2}:\d{2})\s+/;
                            const match = left.match(dateTimeRegex);
                            if (match) {
                                left = left.replace(match[0], '').trim();
                            } else {
                                // Fallback: try simpler patterns if full date-time is missing but chunks exist
                                // e.g. Just date "28.08.2025 "
                                const dateOnly = /^(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4})\s+/;
                                const dMatch = left.match(dateOnly);
                                if (dMatch) left = left.replace(dMatch[0], '').trim();
                            }

                            let right = parts[1].trim();
                            // Strip score at the end: " 12:4" or " ---"
                            const scoreMatch = right.match(/(\s+\d+:\d+|\s+---|\s+:\s*|\s*:\s*)$/);
                            if (scoreMatch) {
                                right = right.substring(0, scoreMatch.index).trim();
                            }

                            if (left.length > 2) teams.add(left);
                            if (right.length > 2) teams.add(right);
                        }
                    });
                });
            }
        });
        return Array.from(teams).sort();
    }

    function findClubTeams(clubName) {
        const allTeams = getAllLeagueTeams();
        const normClub = normalizeTeamName(clubName);
        return allTeams.filter(t => normalizeTeamName(t).includes(normClub));
    }

    function renderProfileSelection() {
        topBarTitle.textContent = "Mein Profil";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "600px";
        container.style.margin = "0 auto";

        const card = document.createElement('div');
        card.style.background = "#1e293b";
        card.style.padding = "25px";
        card.style.borderRadius = "8px";
        card.style.border = "1px solid #334155";
        card.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.5)";

        const title = document.createElement('h2');
        title.textContent = "Spieler auswählen";
        title.style.color = "#f8fafc";
        title.style.marginBottom = "20px";
        title.style.textAlign = "center";
        card.appendChild(title);

        const desc = document.createElement('p');
        desc.textContent = "Wähle deinen Namen aus der Liste und bestätige deine Mannschaft, um dein Dashboard zu aktivieren.";
        desc.style.color = "#94a3b8";
        desc.style.textAlign = "center";
        desc.style.marginBottom = "30px";
        card.appendChild(desc);

        // --- Name Input Group ---
        const inputGroup = document.createElement('div');
        inputGroup.style.marginBottom = "20px";
        inputGroup.style.position = "relative";

        const label = document.createElement('label');
        label.textContent = "Name suchen";
        label.style.display = "block";
        label.style.color = "#e2e8f0";
        label.style.marginBottom = "8px";
        inputGroup.appendChild(label);

        const input = document.createElement('input');
        input.type = "text";
        input.style.width = "100%";
        input.style.padding = "12px";
        input.style.borderRadius = "6px";
        input.style.border = "1px solid #475569";
        input.style.background = "#0f172a";
        input.style.color = "white";
        input.placeholder = "Z.B. Max Mustermann";
        input.value = myPlayerName || "";
        input.autocomplete = "off";

        const suggestionsBox = document.createElement('div');
        suggestionsBox.style.position = "absolute";
        suggestionsBox.style.top = "100%";
        suggestionsBox.style.left = "0";
        suggestionsBox.style.right = "0";
        suggestionsBox.style.background = "#1e293b";
        suggestionsBox.style.border = "1px solid #475569";
        suggestionsBox.style.borderRadius = "0 0 6px 6px";
        suggestionsBox.style.zIndex = "100";
        suggestionsBox.style.maxHeight = "200px";
        suggestionsBox.style.overflowY = "auto";
        suggestionsBox.style.display = "none";

        // --- Team Select Group (Hidden initially) ---
        const teamGroup = document.createElement('div');
        teamGroup.style.marginBottom = "30px";
        teamGroup.style.display = "none";

        const teamLabel = document.createElement('label');
        teamLabel.textContent = "Wähle deine Mannschaft";
        teamLabel.style.display = "block";
        teamLabel.style.color = "#e2e8f0";
        teamLabel.style.marginBottom = "8px";
        teamGroup.appendChild(teamLabel);

        const teamSelect = document.createElement('select');
        teamSelect.style.width = "100%";
        teamSelect.style.padding = "12px";
        teamSelect.style.borderRadius = "6px";
        teamSelect.style.border = "1px solid #475569";
        teamSelect.style.background = "#0f172a";
        teamSelect.style.color = "white";
        teamGroup.appendChild(teamSelect);

        // Logic
        const populateTeams = (clubName) => {
            teamSelect.innerHTML = '';
            const possibleTeams = findClubTeams(clubName);

            if (possibleTeams.length === 0) {
                const opt = document.createElement('option');
                opt.value = clubName;
                opt.textContent = clubName + " (Keine spezifischen Teams gefunden)";
                teamSelect.appendChild(opt);
            } else {
                possibleTeams.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t;
                    opt.textContent = t;
                    teamSelect.appendChild(opt);
                });
            }
            teamGroup.style.display = 'block';
        };


        // Auto-show team if player already selected
        if (myPlayerName) {
            // Try to restore saved team or find context
            const savedTeam = localStorage.getItem('myTeamName');
            if (rankingData && rankingData.players) {
                const p = rankingData.players.find(rp => rp.name === myPlayerName);
                if (p) {
                    if (p.v_nr && typeof CLUB_DATA !== 'undefined' && CLUB_DATA.clubs) {
                        const club = CLUB_DATA.clubs.find(c => c.number == p.v_nr);
                        if (club) {
                            populateTeams(club.name);
                        }
                    }
                    if (savedTeam) teamSelect.value = savedTeam;
                }
            }
        }

        input.addEventListener('input', () => {
            const val = input.value.toLowerCase().trim();
            suggestionsBox.innerHTML = '';
            teamGroup.style.display = 'none';

            if (val.length < 2) {
                suggestionsBox.style.display = 'none';
                return;
            }

            if (window.searchIndex && window.searchIndex.length > 0) {
                const matches = window.searchIndex.filter(item =>
                    item.type === "Spieler" && item.label.toLowerCase().includes(val)
                ).slice(0, 10);

                if (matches.length > 0) {
                    suggestionsBox.style.display = 'block';
                    matches.forEach(m => {
                        const div = document.createElement('div');
                        div.style.padding = "10px";
                        div.style.borderBottom = "1px solid #334155";
                        div.style.cursor = "pointer";
                        div.style.color = "#e2e8f0";

                        // Use the context from search index which is already resolved to Club Name
                        const clubName = m.context || "Vereinslos";

                        div.innerHTML = `<div>${m.label}</div><div style="font-size: 0.8em; color: #94a3b8;">${clubName}</div>`;

                        div.addEventListener('mouseenter', () => div.style.background = "#0f172a");
                        div.addEventListener('mouseleave', () => div.style.background = "transparent");

                        div.addEventListener('click', () => {
                            input.value = m.label;
                            suggestionsBox.style.display = 'none';

                            if (rankingData && rankingData.players) {
                                const p = rankingData.players.find(rp => rp.name === m.label);
                                if (p && p.v_nr && typeof CLUB_DATA !== 'undefined') {
                                    const club = CLUB_DATA.clubs.find(c => c.number == p.v_nr);
                                    if (club) {
                                        populateTeams(club.name);
                                    } else {
                                        populateTeams(p.company || "Unbekannt");
                                    }
                                } else if (p && p.company) {
                                    populateTeams(p.company);
                                }
                            }
                        });
                        suggestionsBox.appendChild(div);
                    });
                } else {
                    suggestionsBox.style.display = 'block';
                    suggestionsBox.innerHTML = '<div style="padding:10px; color: #94a3b8;">Keine Spieler gefunden.</div>';
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!inputGroup.contains(e.target)) {
                suggestionsBox.style.display = 'none';
            }
        });

        inputGroup.appendChild(input);
        inputGroup.appendChild(suggestionsBox);
        card.appendChild(inputGroup);
        card.appendChild(teamGroup);

        const btnRow = document.createElement('div');
        btnRow.style.display = "flex";
        btnRow.style.gap = "10px";
        btnRow.style.justifyContent = "center";

        const saveBtn = document.createElement('button');
        saveBtn.textContent = "Speichern";
        saveBtn.style.padding = "12px 30px";
        saveBtn.style.background = "#3b82f6";
        saveBtn.style.color = "white";
        saveBtn.style.border = "none";
        saveBtn.style.borderRadius = "6px";
        saveBtn.style.cursor = "pointer";
        saveBtn.style.fontWeight = "bold";
        saveBtn.onclick = () => {
            const name = input.value.trim();
            if (name) {
                if (teamGroup.style.display !== 'none' && teamSelect.value) {
                    myTeamName = teamSelect.value;
                    localStorage.setItem('myTeamName', myTeamName);
                } else {
                    if (rankingData && rankingData.players) {
                        const p = rankingData.players.find(rp => rp.name === name);
                        if (p && p.company) {
                            myTeamName = p.company;
                            localStorage.setItem('myTeamName', myTeamName);
                        }
                    }
                }
                setMyPlayer(name);
                alert(`Profil gespeichert: ${name}`);
            }
        };

        const resetBtn = document.createElement('button');
        resetBtn.textContent = "Löschen";
        resetBtn.style.padding = "12px 30px";
        resetBtn.style.background = "transparent";
        resetBtn.style.color = "#ef4444";
        resetBtn.style.border = "1px solid #ef4444";
        resetBtn.style.borderRadius = "6px";
        resetBtn.style.cursor = "pointer";
        resetBtn.onclick = () => {
            myPlayerName = null;
            myTeamName = null;
            localStorage.removeItem('myTeamName');
            setMyPlayer(null); // Clears local storage and name
            input.value = "";
            teamGroup.style.display = 'none';
        };

        btnRow.appendChild(saveBtn);
        if (myPlayerName) btnRow.appendChild(resetBtn);
        card.appendChild(btnRow);

        container.appendChild(card);
        contentArea.appendChild(container); // Corrected
    }

    function renderDashboard() {
        topBarTitle.textContent = "Dashboard";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = "20px";
        container.style.maxWidth = "1200px";
        container.style.margin = "0 auto";

        // --- My Profile Section ---
        if (myPlayerName) {
            let myStats = null;
            let myLeagueKey = null;
            let mySchedule = [];
            let myTrend = null;
            let searchTeam = null;

            if (typeof rankingData !== 'undefined' && rankingData.players) {
                const p = rankingData.players.find(p => p.name === myPlayerName);
                if (p) {
                    const stats = calculatePlayerStats(p);
                    myStats = { ...p, ...stats };
                    myTrend = calculateTrend(p);

                    // Find League and Schedule
                    searchTeam = myTeamName;

                    // Fallback: Resolve team from v_nr if myTeamName is missing (e.g. first load)
                    if (!searchTeam && p.v_nr && typeof CLUB_DATA !== 'undefined' && CLUB_DATA.clubs) {
                        const club = CLUB_DATA.clubs.find(c => c.number == p.v_nr);
                        if (club) searchTeam = club.name;
                    }

                    // Final Fallback: Company property
                    if (!searchTeam && p.company) searchTeam = p.company;

                    if (searchTeam && leagueData.leagues) {
                        const leagueKeys = Object.keys(leagueData.leagues);

                        // Aggregate matching schedules from ALL leagues
                        for (const key of leagueKeys) {
                            const sched = getTeamSchedule(key, searchTeam);
                            if (sched.length > 0) {
                                // Add league key for context
                                sched.forEach(s => s.leagueKey = key);
                                mySchedule = [...mySchedule, ...sched];
                            }
                        }

                        // Determine "My League" (for ranking context)
                        // Prioritize the league that matches p.league, or default to the first one found
                        if (mySchedule.length > 0) {
                            const mainLeagueMatch = mySchedule.find(s => s.leagueKey.includes(p.league));
                            myLeagueKey = mainLeagueMatch ? mainLeagueMatch.leagueKey : mySchedule[0].leagueKey;
                        }

                        // Sort ALL games by date
                        // Fallback to Round if no date, but Date is preferred for mixed leagues
                        mySchedule.sort((a, b) => {
                            if (a.date && b.date) return a.date - b.date;
                            return (a.round || 0) - (b.round || 0);
                        });
                    }

                }
            }


            if (myStats) {
                // --- Dashboard Grid ---
                const grid = document.createElement('div');
                grid.style.display = "grid";
                grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(350px, 1fr))";
                grid.style.gap = "25px";
                grid.style.marginBottom = "40px";

                // --- 1. Hero Card ---
                const heroCard = document.createElement('div');
                heroCard.style.background = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
                heroCard.style.padding = "25px";
                heroCard.style.borderRadius = "12px";
                heroCard.style.border = "1px solid #334155";
                heroCard.style.position = "relative";
                heroCard.style.overflow = "hidden";
                heroCard.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.3)";

                const trendIcon = myTrend && myTrend.dir === 'up' ? '↗' : (myTrend && myTrend.dir === 'down' ? '↘' : '→');
                const trendColor = myTrend && myTrend.dir === 'up' ? '#4ade80' : (myTrend && myTrend.dir === 'down' ? '#f87171' : '#94a3b8');
                const trendText = myTrend ? `${trendIcon} ${myTrend.diff} (L3: ${myTrend.last3Avg})` : '';

                heroCard.innerHTML = `
                    <div style="position: relative; z-index: 2;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                            <div>
                                <div style="color: #60a5fa; font-weight: bold; letter-spacing: 1px; font-size: 0.8em; text-transform: uppercase; margin-bottom: 5px;">Dein Profil</div>
                                <h1 style="margin: 0; font-size: 2.2em; color: white;">${myStats.name}</h1>
                                <div style="color: #94a3b8; font-size: 1.1em; margin-top: 5px;">${myLeagueKey ? myLeagueKey.split('202')[0] : (myStats.league || "Liga n/a")} | ${searchTeam || "Vereinslos"}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 0.9em;">
                                    Rang ${myStats.rank}
                                </div>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                                <div style="color: #94a3b8; font-size: 0.8em; margin-bottom: 5px;">Ø PUNKTE</div>
                                <div style="font-size: 2em; font-weight: bold; color: white; display: flex; align-items: baseline; gap: 10px;">
                                    ${myStats.avg.toFixed(2)}
                                    <span style="font-size: 0.5em; color: ${trendColor}; font-weight: normal;">${trendText}</span>
                                </div>
                            </div>
                            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                                <div style="color: #94a3b8; font-size: 0.8em; margin-bottom: 5px;">SPIELE</div>
                                <div style="font-size: 2em; font-weight: bold; color: white;">${myStats.count}</div>
                            </div>
                        </div>
                    </div>
                `;
                grid.appendChild(heroCard);

                // --- 2. Action / Next Game Card ---
                const actionCard = document.createElement('div');
                actionCard.style.display = "flex";
                actionCard.style.flexDirection = "column";
                actionCard.style.gap = "20px";

                // Find Next Game
                const nextGame = mySchedule.find(g => g.isPending);

                if (nextGame) {
                    const nextCard = document.createElement('div');
                    nextCard.style.background = "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
                    nextCard.style.padding = "20px";
                    nextCard.style.borderRadius = "12px";
                    nextCard.style.border = "1px solid #3b82f6";
                    nextCard.style.cursor = "pointer";
                    nextCard.onclick = () => navigateTo('league', nextGame.leagueKey);
                    nextCard.innerHTML = `
                        <div style="color: #60a5fa; font-weight: bold; font-size: 0.9em; margin-bottom: 10px;">🚀 NÄCHSTES SPIEL</div>
                        <div style="font-size: 1.1em; color: white; margin-bottom: 5px;">
                            Gegen <strong>${nextGame.opponent}</strong>
                        </div>
                        <div style="color: #94a3b8; font-size: 0.9em;">
                             ${nextGame.date ? nextGame.date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Termin offen'}
                             ${nextGame.isHome ? '(Heim)' : '(Auswärts)'}
                        </div>
                        <div style="color: #64748b; font-size: 0.75em; margin-top: 5px;">${nextGame.leagueKey ? nextGame.leagueKey.split('202')[0] : ''}</div>
                    `;
                    actionCard.appendChild(nextCard);
                } else {
                    // Season finished
                    const nextCard = document.createElement('div');
                    nextCard.style.background = "#1e293b";
                    nextCard.style.padding = "20px";
                    nextCard.style.borderRadius = "12px";
                    nextCard.style.border = "1px solid #334155";
                    nextCard.innerHTML = `<div style="color:#94a3b8; text-align:center;">Keine offenen Spiele gefunden.<br>Saison beendet?</div>`;
                    actionCard.appendChild(nextCard);
                }

                // Match Preview Teaser inside grid
                const previewTeaser = document.createElement('div');
                previewTeaser.style.background = "#1e293b";
                previewTeaser.style.padding = "20px";
                previewTeaser.style.borderRadius = "12px";
                previewTeaser.style.border = "1px solid #334155";
                previewTeaser.style.cursor = "pointer";
                previewTeaser.style.display = "flex";
                previewTeaser.style.alignItems = "center";
                previewTeaser.style.justifyContent = "space-between";
                previewTeaser.onclick = () => navigateTo('matchPreview');
                previewTeaser.innerHTML = `
                    <div>
                        <h3 style="margin: 0; color: #f8fafc; font-size: 1em;">⚔️ Match Preview Tool</h3>
                        <div style="color: #64748b; font-size: 0.8em; margin-top: 5px;">Analysiere Gegner</div>
                    </div>
                    <span style="color: #3b82f6; font-size: 1.5em;">→</span>
                `;
                actionCard.appendChild(previewTeaser);

                grid.appendChild(actionCard);
                container.appendChild(grid);

                // --- 3. Season Log Table ---
                if (mySchedule.length > 0) {
                    const logContainer = document.createElement('div');
                    logContainer.className = "fade-in";
                    logContainer.innerHTML = `<h3 style="color: #f8fafc; margin-bottom: 15px; border-bottom: 2px solid #334155; padding-bottom: 10px;">📋 Saisonverlauf</h3>`;

                    const table = document.createElement('table');
                    table.style.width = "100%";
                    table.style.borderCollapse = "collapse";
                    table.style.fontSize = "0.9em";

                    const thead = document.createElement('thead');
                    thead.innerHTML = `
                        <tr style="text-align: left; color: #94a3b8;">
                            <th style="padding: 10px;">Runde</th>
                            <th style="padding: 10px;">Gegner</th>
                            <th style="padding: 10px; text-align: center;">Team</th>
                            <th style="padding: 10px; text-align: center;">Mein Score</th>
                        </tr>
                     `;
                    table.appendChild(thead);

                    const tbody = document.createElement('tbody');

                    // Show only PAST games in log, excluding Ligapokal
                    const pastGames = mySchedule.filter(g => !g.isPending && !g.leagueKey.includes("Ligapokal"));

                    pastGames.forEach((game, idx) => {
                        // Find personal score for this round
                        // ONLY if the match league matches the player's ranked league
                        // This avoids showing N/A or wrong scores for Cup games
                        let personalScore = '-';
                        if (game.leagueKey && myStats.league && game.leagueKey.includes(myStats.league)) {
                            personalScore = myStats.rounds ? myStats.rounds[`R${game.round}`] : '-';
                        }

                        const isPlayed = personalScore && personalScore !== 'x' && personalScore !== '&nbsp;' && personalScore !== '-' && !isNaN(parseInt(personalScore));

                        const row = document.createElement('tr');
                        row.style.borderBottom = "1px solid #334155";
                        row.style.background = idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent";

                        // Determine Team Result Color
                        let resColor = "#94a3b8";
                        if (game.myTeamResult === "Won") resColor = "#4ade80";
                        if (game.myTeamResult === "Lost") resColor = "#f87171";

                        // Determine Personal Score Style
                        let pScoreStyle = "color: #94a3b8;";
                        if (isPlayed) {
                            const ps = parseInt(personalScore);
                            if (ps >= myStats.avg) pScoreStyle = "color: #4ade80; font-weight: bold;"; // Above Average
                            else pScoreStyle = "color: #fca5a5;"; // Below Average
                        }

                        row.innerHTML = `
                            <td style="padding: 12px 10px; color: #cbd5e1;">Runde ${game.round} <span style="font-size:0.7em; color:#64748b">(${game.leagueKey ? game.leagueKey.split(' ')[0] : ''})</span></td>
                            <td style="padding: 12px 10px;">
                                <div style="color: white; font-weight: 500;">${game.opponent}</div>
                                <div style="color: #64748b; font-size: 0.8em;">${game.date ? game.date.toLocaleDateString('de-DE') : ''} ${game.isHome ? '(H)' : '(A)'}</div>
                            </td>
                            <td style="padding: 12px 10px; text-align: center;">
                                <span style="color: ${resColor}; font-weight: bold; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">
                                    ${game.score}
                                </span>
                            </td>
                            <td style="padding: 12px 10px; text-align: center; ${pScoreStyle}">
                                ${personalScore || '-'}
                            </td>
                         `;
                        tbody.appendChild(row);
                    });
                    table.appendChild(tbody);
                    logContainer.appendChild(table);
                    container.appendChild(logContainer);
                }
            }
        }

        // --- Top Players Section (Keep existing content at bottom for discovery) ---
        const playersSection = document.createElement('div');
        playersSection.style.marginTop = "60px";

        let allPlayers = [];
        if (typeof rankingData !== 'undefined' && rankingData.players) {
            allPlayers = rankingData.players.map(p => {
                const stats = calculatePlayerStats(p);
                return { ...p, ...stats };
            });
        }

        // Filter players with at least 3 games
        const topPlayers = allPlayers.filter(p => p.count >= 3)
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 5);

        let playersHtml = `<h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px;">🔥 Liga Highlights (Top 5)</h2>`;
        playersHtml += `<div class="results-group" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">`;

        topPlayers.forEach((p, idx) => {
            let clubName = p.company || (clubData.clubs && clubData.clubs.find(c => c.number === p.v_nr)?.name) || "";
            playersHtml += `
            <div style="background: #1e293b; padding: 15px; border-radius: 8px; border: 1px solid #334155; display: flex; align-items: center; gap: 15px;">
                <div style="font-size: 1.5em; font-weight: bold; color: #64748b; width: 30px;">#${idx + 1}</div>
                <div style="flex: 1;">
                    <div style="color: white; font-weight: bold;">${p.name}</div>
                    <div style="color: #94a3b8; font-size: 0.85em;">${clubName}</div>
                </div>
                <div style="text-align: right;">
                    <div style="color: #60a5fa; font-weight: bold; font-size: 1.2em;">${p.avg.toFixed(2)}</div>
                    <div style="color: #64748b; font-size: 0.7em;">Ø Pkt</div>
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

        if (typeof leagueData !== 'undefined' && leagueData.leagues) {
            Object.keys(leagueData.leagues).sort().forEach(leagueName => {
                const data = leagueData.leagues[leagueName];
                if (data.table) {
                    const leader = extractLeagueLeader(data.table);
                    if (leader) {
                        leaguesHtml += `
                        <div style="background: #1e293b; padding: 15px 20px; border-radius: 8px; border: 1px solid #334155; cursor: pointer; transition: background 0.2s;" 
                             onclick="navigateTo('league', '${leagueName}')"
                             onmouseover="this.style.background='#334155'" onmouseout="this.style.background='#1e293b'">
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

        // Update Nav Active State
        document.querySelectorAll('.nav-section-header').forEach(el => {
            el.style.backgroundColor = "transparent";
            el.style.color = "#94a3b8";
        });
        // Highlight logic can be added here if needed, but nav usually static.
    }

    function handleSearch(e) {
        const query = e.target.value.toLowerCase();
        searchResults.innerHTML = "";

        if (query.length < 2) {
            searchResults.classList.add('hidden');
            return;
        }

        const matches = window.searchIndex.filter(item => item.label.toLowerCase().includes(query)).slice(0, 10);

        if (matches.length > 0) {
            searchResults.classList.remove('hidden');
            matches.forEach(m => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.style.padding = "8px 10px";
                div.style.borderBottom = "1px solid #334155";
                div.style.cursor = "pointer";
                div.style.color = "#e2e8f0";
                div.style.fontSize = "0.9em";
                div.style.backgroundColor = "#1e293b";
                div.style.zIndex = "2000";

                let subtext = "";
                if (m.context) subtext = ` <span style='color: #94a3b8; font-size: 0.8em;'>(${m.context})</span>`;

                div.innerHTML = `<span style="display:inline-block; width: 60px; color: #64748b; font-size: 0.8em; font-weight:bold;">${m.type}</span> ${m.label}${subtext}`;

                div.addEventListener('click', () => {
                    if (m.category === 'league') navigateTo('league', m.id);
                    else if (m.category === 'club') navigateTo('club', m.id);
                    searchResults.classList.add('hidden');
                    searchInput.value = "";
                });

                div.addEventListener('mouseenter', () => div.style.background = "#334155");
                div.addEventListener('mouseleave', () => div.style.background = "#1e293b");

                searchResults.appendChild(div);
            });
        } else {
            searchResults.classList.remove('hidden');
            const div = document.createElement('div');
            div.style.padding = "8px 10px";
            div.style.color = "#94a3b8";
            div.style.fontSize = "0.9em";
            div.style.backgroundColor = "#1e293b";
            div.textContent = "Keine Treffer";
            searchResults.appendChild(div);
        }
    }


    function navigateTo(type, id, addToHistory = true) {
        // 1. Handle History
        if (addToHistory) {
            history.pushState({ type, id }, "", `#${type}${id ? '/' + id : ''}`);
        }

        // 2. Update toggle state if back/menu logic exists
        // (Existing sidebar logic)
        const sidebar = document.querySelector('.sidebar');
        if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }

        // 3. Render
        currentState = { type, id };

        if (type === 'league') renderLeague(id);
        else if (type === 'ranking') renderRanking(id);
        else if (type === 'club') renderClub(id);
        else if (type === 'clubList') renderClubList();
        else if (type === 'dashboard') renderDashboard();
        else if (type === 'dashboard') renderDashboard();
        else if (type === 'matchPreview') renderMatchPreview();
        else if (type === 'comparison') renderComparisonView();
        else if (type === 'alltime') renderAllTimeView();
        else if (type === 'tools') renderToolsView();
        else if (type === 'profile') renderProfileSelection();

        // 4. Update Back Button Visibility
        // Show back button everywhere except Dashboard
        if (backBtn) {
            backBtn.style.display = (type === 'dashboard') ? 'none' : 'block';
        }

        // Scroll to top
        window.scrollTo(0, 0);
    }

    // History Event Listener
    window.addEventListener('popstate', (event) => {
        if (event.state) {
            navigateTo(event.state.type, event.state.id, false);
        } else {
            // Fallback if state is null (e.g. initial load)
            navigateTo('dashboard', null, false);
        }
    });

    function goBack() {
        history.back();
    }
    // Expose to window for inline onclick handlers
    window.navigateTo = navigateTo;

    function renderComparisonView() {
        topBarTitle.textContent = "H2H Vergleich";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";

        // --- State ---
        let p1 = null;
        let p2 = null;

        // --- UI ---
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
        grid.style.gap = '20px';
        grid.style.marginBottom = '30px';

        const createSide = (label, id) => {
            const wrapper = document.createElement('div');
            wrapper.style.background = "#1e293b";
            wrapper.style.padding = "20px";
            wrapper.style.borderRadius = "8px";
            wrapper.style.border = "1px solid #334155";

            wrapper.innerHTML = `
                <h3 style="color: #94a3b8; margin-bottom: 15px;">${label}</h3>
                <input type="text" id="search-${id}" placeholder="Name suchen..." 
                    style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #475569; color: white; border-radius: 4px; margin-bottom: 10px;">
                <div id="results-${id}" style="max-height: 200px; overflow-y: auto;"></div>
                <div id="selected-${id}" style="margin-top: 10px; display: none;"></div>
            `;
            return wrapper;
        };

        const side1 = createSide("Spieler 1", "p1");
        const side2 = createSide("Spieler 2", "p2");

        grid.appendChild(side1);
        grid.appendChild(side2);
        container.appendChild(grid);

        const comparisonArea = document.createElement('div');
        comparisonArea.id = "comparison-area";
        comparisonArea.style.display = "none";
        container.appendChild(comparisonArea);

        contentArea.appendChild(container);

        // --- Logic ---
        const handleSearch = (query, resultsId, onSelect) => {
            const resEl = document.getElementById(resultsId);
            resEl.innerHTML = "";
            if (query.length < 2) return;

            // Search in SearchIndex
            const matches = (window.searchIndex || []).filter(item =>
                item.type === 'Spieler' && item.label.toLowerCase().includes(query.toLowerCase())
            ).slice(0, 10);

            matches.forEach(m => {
                const div = document.createElement('div');
                div.style.padding = "8px";
                div.style.borderBottom = "1px solid #334155";
                div.style.cursor = "pointer";
                div.innerHTML = `<span style="color: #f8fafc; font-weight: bold;">${m.label}</span><br><span style="font-size:0.8em; color:#64748b;">${m.context || ''}</span>`;
                div.onmouseover = () => div.style.backgroundColor = "#334155";
                div.onmouseout = () => div.style.backgroundColor = "transparent";
                div.onclick = () => {
                    resEl.innerHTML = "";
                    document.getElementById(resultsId.replace("results-", "search-")).value = "";
                    onSelect(m);
                };
                resEl.appendChild(div);
            });
        };

        const updateSelected = (sideId, player) => {
            const selEl = document.getElementById(`selected-${sideId}`);
            if (player) {
                selEl.style.display = "block";
                selEl.innerHTML = `
                    <div style="background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; padding: 10px; border-radius: 4px; align-items: center; display: flex; justify-content: space-between;">
                        <span style="font-weight: bold; color: #60a5fa">${player.label}</span>
                        <button onclick="this.parentElement.parentElement.style.display='none';" style="background:none; border:none; color: #94a3b8; cursor: pointer;">✕</button>
                    </div>`;
            } else {
                selEl.style.display = "none";
            }
        };

        const renderComparison = () => {
            if (!p1 || !p2) {
                comparisonArea.style.display = "none";
                return;
            }

            const getFullData = (searchItem) => {
                let current = null;
                if (rankingData && rankingData.players) {
                    current = rankingData.players.find(p => p.name === searchItem.label);
                }
                return { name: searchItem.label, current, searchItem };
            };

            const d1 = getFullData(p1);
            const d2 = getFullData(p2);

            const getHistory = (d) => {
                let hist = [];
                // 1. Try ID Match (Exact)
                if (d.current && d.current.v_nr && archiveData && archiveData[d.current.v_nr]) {
                    hist = archiveData[d.current.v_nr];
                }

                // 2. Fallback: Try Name Match (if no ID match found)
                if (hist.length === 0 && d.name) {
                    const searchName = d.name.toLowerCase().trim();
                    // Iterate over all archive entries
                    Object.values(archiveData).forEach(seasons => {
                        // Check if any season in this history block has this player's name
                        const match = seasons.some(s => s.name && s.name.toLowerCase().trim() === searchName);
                        if (match) {
                            // potential merge if multiple IDs found? For now just take the first robust match
                            // or append? Let's just take it if we found nothing yet.
                            if (hist.length === 0) hist = seasons;
                        }
                    });
                }
                return hist;
            };

            const h1 = getHistory(d1);
            const h2 = getHistory(d2);

            const calcAvg = (p) => {
                if (!p) return 0;
                const stats = calculatePlayerStats(p);
                return stats.avg;
            };

            const avg1 = calcAvg(d1.current);
            const avg2 = calcAvg(d2.current);

            const getBestStats = (hist) => {
                if (!hist || hist.length === 0) return { points: 0, season: '' };
                const best = hist.reduce((prev, current) => ((current.points || 0) > (prev.points || 0)) ? current : prev, { points: 0, season: '' });
                return { points: best.points || 0, season: best.season || '' };
            };

            const getBestRank = (hist) => {
                if (!hist || hist.length === 0) return { rank: 999, season: '' };
                const best = hist.reduce((prev, current) => ((current.rank || 999) < (prev.rank || 999)) ? current : prev, { rank: 999, season: '' });
                return { rank: best.rank || 999, season: best.season || '' };
            };

            const getSeasonList = (hist) => {
                if (!hist || hist.length === 0) return "";
                // Sort seasons if needed? They usually come in order or reverse order.
                // dedupe just in case
                const seasons = [...new Set(hist.map(e => e.season))].sort().join(", ");
                return seasons;
            };

            const best1Stats = getBestStats(h1); // Max Points
            const best2Stats = getBestStats(h2);

            const bestRank1 = getBestRank(h1); // Best Rank
            const bestRank2 = getBestRank(h2);

            const seasons1 = getSeasonList(h1);
            const seasons2 = getSeasonList(h2);

            const card = (val1, val2, label, subLabel, detail1 = "", detail2 = "", isFloat = false, invertWin = false) => {
                const v1 = isFloat ? val1.toFixed(2) : val1;
                const v2 = isFloat ? val2.toFixed(2) : val2;

                // Winner color logic
                let c1 = '#94a3b8';
                let c2 = '#94a3b8';

                if (val1 !== val2) {
                    let win1 = val1 > val2;
                    if (invertWin) win1 = val1 < val2; // Lower is better for Rank

                    if (win1) c1 = '#4ade80';
                    else c2 = '#4ade80';
                }

                // Small detail line style
                const detailStyle = "font-size: 0.7em; color: #64748b; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80px;";

                return `
                 <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #334155;">
                    <div style="display: flex; flex-direction: column; align-items: center; width: 90px;">
                        <div style="font-size: 1.2em; font-weight: bold; color: ${c1};">${v1}</div>
                        ${detail1 ? `<div style="${detailStyle}" title="${detail1}">${detail1}</div>` : ''}
                    </div>
                    
                    <div style="flex: 1; text-align: center; padding: 0 10px;">
                        <div style="color: #cbd5e1; font-size: 0.9em; text-transform: uppercase;">${label}</div>
                        <div style="color: #64748b; font-size: 0.75em; margin-top: 2px;">${subLabel}</div>
                    </div>

                    <div style="display: flex; flex-direction: column; align-items: center; width: 90px;">
                         <div style="font-size: 1.2em; font-weight: bold; color: ${c2};">${v2}</div>
                         ${detail2 ? `<div style="${detailStyle}" title="${detail2}">${detail2}</div>` : ''}
                    </div>
                 </div>`;
            };

            let html = `<div style="background: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden; margin-top: 20px;">
                <div style="padding: 15px; background: #0f172a; text-align: center; color: #94a3b8; font-weight: bold; border-bottom: 1px solid #334155;">
                    DIREKTER VERGLEICH
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid #334155; background: rgba(15, 23, 42, 0.5); font-size: 0.9em; color: #f8fafc;">
                     <div style="width: 40%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: bold;">${d1.name}</div>
                     <div style="width: 20%; text-align: center; color: #64748b; font-size: 0.8em;">vs</div>
                     <div style="width: 40%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: bold;">${d2.name}</div>
                </div>
                ${card(avg1, avg2, "Ø Aktuell", "Durchschnitt dieser Saison", "", "", true)}
                ${card(h1.length, h2.length, "Erfahrung", "Anzahl gespielter Saisons im Archiv", seasons1, seasons2)}
                ${card(best1Stats.points, best2Stats.points, "Meiste Punkte", "Rekord in einer Saison (Archiv)", best1Stats.season, best2Stats.season)}
                ${card(bestRank1.rank === 999 ? '-' : bestRank1.rank + '.', bestRank2.rank === 999 ? '-' : bestRank2.rank + '.', "Beste Platzierung", "Bester Liga-Rang (Archiv)", bestRank1.season, bestRank2.season, false, true)}
             </div>
             <div style="margin-top: 20px; text-align: center; padding: 10px; background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; border-radius: 6px; color: #60a5fa; font-size: 0.9em;">
                ℹ️ <strong>Erklärung:</strong><br>
                Daten basieren auf der aktuellen Saison und der verknüpften Historie (Name oder ID).
                <br><em>Fehlende Daten können an Namensänderungen liegen.</em>
             </div>`;

            comparisonArea.innerHTML = html;
            comparisonArea.style.display = "block";
        };

        // Listeners
        document.getElementById('search-p1').addEventListener('input', (e) => handleSearch(e.target.value, 'results-p1', (p) => {
            p1 = p;
            updateSelected('p1', p);
            renderComparison();
        }));
        document.getElementById('search-p2').addEventListener('input', (e) => handleSearch(e.target.value, 'results-p2', (p) => {
            p2 = p;
            updateSelected('p2', p);
            renderComparison();
        }));
    }

    function renderAllTimeView() {
        topBarTitle.textContent = "Ewige Tabelle";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";

        // Aggregation Logic
        if (!archiveData || Object.keys(archiveData).length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; color: #94a3b8;">
                <h2>📭 Keine Archiv-Daten</h2>
                <p>Es wurden noch keine historischen Daten geladen.</p>
                </div>`;
            contentArea.appendChild(container);
            return;
        }

        const allPlayers = [];

        Object.entries(archiveData).forEach(([playerKey, seasons]) => {
            const name = seasons[0].name || "Unbekannt";
            const id = playerKey;

            let totalPoints = 0;
            let totalSeasons = seasons.length;

            // Metrics
            let bestSeasonRank = 999;
            let bestSeasonYearRank = "";
            let bestSeasonLeague = "";

            let maxPoints = 0;
            let maxPointsYear = "";
            let maxPointsLeague = "";

            seasons.forEach(s => {
                totalPoints += (parseInt(s.points) || 0);

                // Best Rank
                const r = parseInt(s.rank) || 999;
                if (r < bestSeasonRank) {
                    bestSeasonRank = r;
                    bestSeasonYearRank = s.season;
                    bestSeasonLeague = s.league || "";
                }

                // Max Points
                const p = parseInt(s.points) || 0;
                if (p > maxPoints) {
                    maxPoints = p;
                    maxPointsYear = s.season;
                    maxPointsLeague = s.league || "";
                }
            });

            allPlayers.push({
                id, name, totalPoints, totalSeasons,
                bestSeasonRank: (bestSeasonRank === 999 ? '-' : bestSeasonRank + '.'),
                bestSeasonYearRank,
                bestSeasonLeague,
                maxPoints,
                maxPointsYear,
                maxPointsLeague
            });
        });

        // Sort by Total Points (All-Time) descending
        allPlayers.sort((a, b) => b.totalPoints - a.totalPoints);

        let html = `<div style="background: #1e293b; border-radius: 8px; overflow: hidden;">
            <div style="display: flex; padding: 10px; background: #0f172a; color: #94a3b8; font-size: 0.8em; font-weight: bold; border-bottom: 1px solid #334155;">
                <div style="width: 30px; text-align: center;">#</div>
                <div style="flex: 1; padding-left: 10px;">NAME</div>
                <div style="width: 60px; text-align: center;">SAISONS</div>
                <div style="width: 100px; text-align: right; padding-right: 10px;">PUNKTE (GESAMT)</div>
            </div>`;

        allPlayers.forEach((p, idx) => {
            const rank = idx + 1;
            let medal = "";
            if (rank === 1) medal = "🥇";
            if (rank === 2) medal = "🥈";
            if (rank === 3) medal = "🥉";
            if (rank > 3) medal = `${rank}.`;

            html += `
            <div style="display: flex; padding: 15px 10px; border-bottom: 1px solid #334155; align-items: center;">
                <div style="width: 30px; text-align: center; font-weight: bold; color: ${rank <= 3 ? '#fbbf24' : '#cbd5e1'}">${medal}</div>
                <div style="flex: 1; padding-left: 10px;">
                    <div style="font-weight: bold; color: #f8fafc;">${p.name}</div>
                    <div style="font-size: 0.75em; color: #94a3b8; margin-top: 2px;">
                        Rang: <span style="color: #cbd5e1">${p.bestSeasonRank}</span> (${p.bestSeasonYearRank} • ${p.bestSeasonLeague}) • 
                        Pkt: <span style="color: #cbd5e1">${p.maxPoints}</span> (${p.maxPointsYear} • ${p.maxPointsLeague})
                    </div>
                </div>
                <div style="width: 60px; text-align: center; color: #cbd5e1;">${p.totalSeasons}</div>
                <div style="width: 100px; text-align: right; padding-right: 10px; font-weight: bold; color: #4ade80;">${p.totalPoints}</div>
            </div>`;
        });

        html += `</div>`;
        container.innerHTML = html;
        contentArea.appendChild(container);
    }



    function renderToolsView() {
        topBarTitle.textContent = "Match Tools";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "600px";
        container.style.margin = "0 auto";

        // --- Game Mode State ---
        let gameMode = 'DO'; // 'DO' or 'MO'

        // --- Checkout Database ---
        const outsDO = {
            170: "T20 - T20 - Bull", 167: "T20 - T19 - Bull", 164: "T20 - T18 - Bull", 161: "T20 - T17 - Bull", 160: "T20 - T20 - D20",
            158: "T20 - T20 - D19", 157: "T20 - T19 - D20", 156: "T20 - T20 - D18", 155: "T20 - T19 - D19", 154: "T20 - T18 - D20",
            153: "T20 - T19 - D18", 152: "T20 - T20 - D16", 151: "T20 - T17 - D20", 150: "T20 - T18 - D18", 149: "T20 - T19 - D16",
            148: "T20 - T16 - D20", 147: "T20 - T17 - D18", 146: "T20 - T18 - D16", 145: "T20 - T15 - D20", 144: "T20 - T20 - D12",
            143: "T20 - T17 - D16", 142: "T20 - T14 - D20", 141: "T20 - T19 - D12", 140: "T20 - T16 - D16", 139: "T19 - T14 - D20",
            138: "T20 - T18 - D12", 137: "T19 - T16 - D16", 136: "T20 - T20 - D8", 135: "25 - T20 - Bull", 134: "T20 - T14 - D16",
            133: "T20 - T19 - D8", 132: "25 - T19 - Bull", 131: "T20 - T13 - D16", 130: "T20 - T18 - D8", 129: "T19 - T20 - D6",
            128: "T18 - T14 - D16", 127: "T20 - T17 - D8", 126: "T19 - T19 - D6", 125: "Bull - 25 - Bull", 124: "T20 - D16 - D16",
            123: "T19 - T16 - D9", 122: "T18 - 18 - Bull", 121: "T20 - 11 - Bull", 120: "T20 - 20 - D20", 119: "T19 - 12 - Bull",
            118: "T20 - 18 - D20", 117: "T20 - 17 - D20", 116: "T20 - 16 - D20", 115: "T20 - 15 - D20", 114: "T20 - 14 - D20",
            113: "T20 - 13 - D20", 112: "T20 - 20 - D16", 111: "T20 - 19 - D16", 110: "T20 - 18 - D16", 109: "T20 - 17 - D16",
            108: "T20 - 16 - D16", 107: "T19 - 10 - D20", 106: "T20 - 14 - D16", 105: "T20 - 13 - D16", 104: "T18 - 10 - D20",
            103: "T20 - 3 - D20", 102: "T20 - 10 - D16", 101: "T17 - 10 - D20", 100: "T20 - D20",
            99: "T19 - 10 - D16", 98: "T20 - D19", 97: "T19 - D20", 96: "T20 - D18", 95: "T19 - D19", 94: "T18 - D20", 93: "T19 - D18", 92: "T20 - D16", 91: "T17 - D20",
            90: "T18 - D18", 89: "T19 - D16", 88: "T16 - D20", 87: "T17 - D18", 86: "T18 - D16", 85: "T15 - D20", 84: "T20 - D12", 83: "T17 - D16", 82: "T14 - D20", 81: "T15 - D18",
            80: "T20 - D10", 79: "T13 - D20", 78: "T18 - D12", 77: "T19 - D10", 76: "T20 - D8", 75: "T13 - D18", 74: "T14 - D16", 73: "T19 - D8", 72: "T16 - D12", 71: "T13 - D16",
            70: "T18 - D8", 69: "T15 - D12", 68: "T20 - D4", 67: "T17 - D8", 66: "T10 - D18", 65: "T15 - D10", 64: "D16 - D16", 63: "T13 - D12", 62: "T10 - D16", 61: "T15 - D8",
            60: "20 - D20", 59: "19 - D20", 58: "18 - D20", 57: "17 - D20", 56: "16 - D20", 55: "15 - D20", 54: "14 - D20", 53: "13 - D20", 52: "12 - D20", 51: "11 - D20",
            50: "10 - D20", 49: "9 - D20", 48: "16 - D16", 47: "15 - D16", 46: "6 - D20", 45: "13 - D16", 44: "12 - D16", 43: "3 - D20", 42: "10 - D16", 41: "9 - D16",
            40: "D20", 39: "7 - D16", 38: "D19", 37: "5 - D16", 36: "D18", 35: "3 - D16", 34: "D17", 33: "9 - D12", 32: "D16", 31: "15 - D8",
            30: "D15", 29: "13 - D8", 28: "D14", 27: "11 - D8", 26: "D13", 25: "9 - D8", 24: "D12", 23: "7 - D8", 22: "D11", 21: "5 - D8",
            20: "D10", 19: "3 - D8", 18: "D9", 17: "1 - D8", 16: "D8", 15: "7 - D4", 14: "D7", 13: "5 - D4", 12: "D6", 11: "3 - D4",
            10: "D5", 9: "1 - D4", 8: "D4", 7: "3 - D2", 6: "D3", 5: "1 - D2", 4: "D2", 3: "1 - D1", 2: "D1"
        };
        const outsMO = {
            ...outsDO,
            180: "T20 - T20 - T20", 179: "T20 - T19 - T20", 178: "T20 - T20 - T18", 177: "T20 - T19 - T18", 176: "T20 - T20 - T16", 175: "T20 - T19 - T16",
            174: "T20 - T20 - T14", 173: "T20 - T19 - T14", 172: "T20 - T20 - T12", 171: "T20 - T19 - T12",
            // 61-99 Low number overrides
            99: "T19 - 10 - D16",
            // Multiples of 3 can be finished on Triple
            3: "T1", 6: "T2", 9: "T3", 12: "T4", 15: "T5", 18: "T6", 21: "T7", 24: "T8", 27: "T9", 30: "T10", 33: "T11", 36: "T12",
            39: "T13", 42: "T14", 45: "T15", 48: "T16", 51: "T17", 54: "T18", 57: "T19", 60: "T20"
        };

        // UI Setup
        const toggleDiv = document.createElement('div');
        toggleDiv.style.cssText = "display:flex; justify-content:center; margin-bottom:20px; background:#0f172a; padding:5px; border-radius:8px; border:1px solid #334155; width:fit-content; margin:0 auto 20px auto;";

        const btnDO = document.createElement('button');
        btnDO.textContent = "Double Out";
        btnDO.style.cssText = "padding:8px 15px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; background:#3b82f6; color:white; margin-right:5px;";

        const btnMO = document.createElement('button');
        btnMO.textContent = "Master Out";
        btnMO.style.cssText = "padding:8px 15px; border:none; border-radius:6px; cursor:pointer; font-weight:bold; background:transparent; color:#94a3b8;";

        const updateToggle = () => {
            if (gameMode === 'DO') {
                btnDO.style.background = "#3b82f6";
                btnDO.style.color = "white";
                btnMO.style.background = "transparent";
                btnMO.style.color = "#94a3b8";
            } else {
                btnDO.style.background = "transparent";
                btnDO.style.color = "#94a3b8";
                btnMO.style.background = "#3b82f6";
                btnMO.style.color = "white";
            }
            if (btnCheckout.classList.contains('active')) renderCheckout();
            if (btnCounter.classList.contains('active')) renderCounter(true);
        };

        btnDO.onclick = () => { gameMode = 'DO'; updateToggle(); };
        btnMO.onclick = () => { gameMode = 'MO'; updateToggle(); };

        toggleDiv.appendChild(btnDO);
        toggleDiv.appendChild(btnMO);
        container.appendChild(toggleDiv);

        // Tabs
        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex; gap:10px; margin-bottom:20px;';

        const btnCheckout = document.createElement('button');
        btnCheckout.innerText = "Checkout Table";
        btnCheckout.className = 'tab-btn active';

        const btnCounter = document.createElement('button');
        btnCounter.innerText = "Score Counter";
        btnCounter.className = 'tab-btn';

        const style = document.createElement('style');
        style.innerHTML = `
            .tab-btn { flex: 1; padding: 12px; border: none; background: #1e293b; color: #94a3b8; cursor: pointer; border-radius: 6px; font-weight: bold; }
            .tab-btn.active { background: #3b82f6; color: white; }
        `;
        container.appendChild(style);
        tabs.appendChild(btnCheckout);
        tabs.appendChild(btnCounter);
        container.appendChild(tabs);

        const contentDiv = document.createElement('div');
        container.appendChild(contentDiv);
        contentArea.appendChild(container);

        // Logic Helpers
        const getCheckout = (val) => {
            let res = null;
            if (gameMode === 'MO' && outsMO[val]) res = outsMO[val];
            else if (outsDO[val]) res = outsDO[val];

            if (res) return res;
            if (val <= 1 && val !== 0) return "Nicht checkbar";
            if (val === 0) return "Check!";
            if (gameMode === 'DO' && val > 170) return "Nicht checkbar";

            return "Kein Standard-Finish";
        };

        // Checkout View
        const renderCheckout = () => {
            contentDiv.innerHTML = `<input type="number" id="checkout-input" placeholder="Rest (z.B. 90)" 
                style="width: 100%; padding: 15px; font-size: 1.2em; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; margin-bottom: 20px;">
                <div id="checkout-result" style="text-align: center; font-size: 1.5em; color: #4ade80; font-weight: bold; min-height: 50px;"></div>`;

            const input = document.getElementById('checkout-input');
            input.focus();
            input.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                const res = document.getElementById('checkout-result');
                if (isNaN(val)) { res.textContent = ""; return; }

                if (gameMode === 'DO' && [169, 168, 166, 165, 163, 162, 159].includes(val)) {
                    res.textContent = "Kein Finish möglich";
                    res.style.color = "#ef4444";
                    return;
                }

                const txt = getCheckout(val);
                res.textContent = txt;
                res.style.color = (txt.includes("Nicht") || txt.includes("Kein")) ? "#ef4444" : "#4ade80";
            });
        };

        // Scorer State
        let scScore = 501;
        let scHistory = [];
        let scInput = "";

        const renderCounter = (preserveState = false) => {
            if (!preserveState) { scScore = 501; scHistory = []; scInput = ""; }

            const styles = `
                .scorer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 300px; margin: 0 auto; }
                .scorer-btn { padding: 15px; font-size: 1.5em; background: #334155; color: white; border: none; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
                .scorer-btn:active { background: #475569; transform: scale(0.98); }
                .scorer-action { background: #475569; font-size: 1em; font-weight: bold; }
                .scorer-enter { background: #22c55e; grid-row: span 2; display: flex; align-items: center; justify-content: center; }
                .scorer-score { font-size: 5em; font-weight: bold; color: white; text-align: center; margin: 10px 0; text-shadow: 0 0 20px rgba(255,255,255,0.1); }
                .scorer-input { font-size: 1.5em; color: #60a5fa; text-align: center; height: 40px; margin-bottom: 20px; font-family: monospace; }
                .scorer-hint { color: #94a3b8; text-align: center; height: 20px; font-size: 0.9em; margin-bottom: 5px; }
            `;

            contentDiv.innerHTML = `
                <style>${styles}</style>
                <div id="scorer-hint" class="scorer-hint"></div>
                <div id="scorer-display" class="scorer-score">${scScore}</div>
                <div id="input-display" class="scorer-input">${scInput || "_"}</div>
                
                <div class="scorer-grid">
                    <button class="scorer-btn" onclick="scTap('1')">1</button>
                    <button class="scorer-btn" onclick="scTap('2')">2</button>
                    <button class="scorer-btn" onclick="scTap('3')">3</button>
                    <button class="scorer-btn" onclick="scTap('4')">4</button>
                    <button class="scorer-btn" onclick="scTap('5')">5</button>
                    <button class="scorer-btn" onclick="scTap('6')">6</button>
                    <button class="scorer-btn" onclick="scTap('7')">7</button>
                    <button class="scorer-btn" onclick="scTap('8')">8</button>
                    <button class="scorer-btn" onclick="scTap('9')">9</button>
                    <button class="scorer-btn scorer-action" onclick="scUndo()">🔙</button>
                    <button class="scorer-btn" onclick="scTap('0')">0</button>
                    <button class="scorer-btn scorer-enter" onclick="scEnter()">⏎</button>
                </div>
                 <div style="text-align: center; margin-top: 20px;">
                    <button onclick="scReset()" style="background: none; border: 1px solid #ef4444; color: #ef4444; padding: 5px 15px; border-radius: 4px; font-size: 0.8em;">Neues Spiel</button>
                </div>
            `;

            window.updateScorerUI = () => {
                const disp = document.getElementById('scorer-display');
                const inp = document.getElementById('input-display');
                const hint = document.getElementById('scorer-hint');
                if (disp) disp.textContent = scScore;
                if (inp) inp.textContent = scInput || "-";
                if (hint) {
                    const txt = getCheckout(scScore);
                    if (txt && !txt.includes("Nicht") && !txt.includes("Kein")) {
                        hint.textContent = txt; hint.style.color = "#4ade80";
                    } else { hint.textContent = ""; }
                }
            };
            window.updateScorerUI();
        };

        window.scTap = (n) => { if (scInput.length < 3) scInput += n; window.updateScorerUI(); };
        window.scUndo = () => { if (scInput.length > 0) scInput = scInput.slice(0, -1); else if (scHistory.length > 0) scScore = scHistory.pop(); window.updateScorerUI(); };
        window.scEnter = () => {
            if (!scInput) return;
            const val = parseInt(scInput);
            scInput = "";
            if (val > 180) { alert("Maximal 180!"); window.updateScorerUI(); return; }
            const newScore = scScore - val;
            if (newScore === 0) {
                scHistory.push(scScore); scScore = 0; window.updateScorerUI();
                setTimeout(() => { if (confirm("🎉 GAME SHOT! Neues Spiel?")) scReset(); }, 100);
            } else if (newScore <= 1 && (newScore < 0 || gameMode !== 'MO' || newScore !== 0)) { // 1 is usually bust for MO too
                alert("BUST!");
            } else {
                scHistory.push(scScore); scScore = newScore;
            }
            window.updateScorerUI();
        };
        window.scReset = () => { scScore = 501; scHistory = []; scInput = ""; window.updateScorerUI(); };

        // Init
        renderCheckout();
        btnCheckout.onclick = () => { btnCheckout.className = 'tab-btn active'; btnCounter.className = 'tab-btn'; renderCheckout(); };
        btnCounter.onclick = () => { btnCheckout.className = 'tab-btn'; btnCounter.className = 'tab-btn active'; renderCounter(); };
    }

    function renderClubList() {
        topBarTitle.textContent = "Vereinsübersicht";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = "20px";
        container.style.display = "grid";
        container.style.gridTemplateColumns = "repeat(auto-fill, minmax(280px, 1fr))";
        container.style.gap = "20px";

        clubData.clubs.forEach((club, index) => {
            const card = document.createElement('div');
            card.className = 'results-card';
            card.style.cursor = "pointer";
            card.style.transition = "all 0.2s ease";
            card.style.height = "100%";
            card.style.display = "flex";
            card.style.flexDirection = "column";

            let html = `<div style="font-weight: bold; font-size: 1.1em; margin-bottom: 8px; color: #f8fafc;">${club.name}</div>`;
            if (club.venue) {
                html += `<div style="font-size: 0.9em; color: #94a3b8;">📍 ${club.venue}</div>`;
            }
            if (club.city) {
                html += `<div style="font-size: 0.85em; color: #64748b; margin-top: 4px;">${club.city}</div>`;
            }

            card.innerHTML = html;
            card.addEventListener('click', () => {
                navigateTo('club', index);
            });
            card.onmouseenter = () => {
                card.style.transform = "translateY(-2px)";
                card.style.borderColor = "#3b82f6";
            };
            card.onmouseleave = () => {
                card.style.transform = "none";
                card.style.borderColor = "#334155";
            };
            container.appendChild(card);
        });
        contentArea.appendChild(container);
    }



    function renderLeague(leagueName) {
        const data = leagueData.leagues[leagueName];
        topBarTitle.innerHTML = "";
        const span = document.createElement('span');
        span.textContent = leagueName;
        topBarTitle.appendChild(span);

        const favBtn = document.createElement('button');
        favBtn.id = "fav-btn";
        favBtn.style.background = "none";
        favBtn.style.border = "none";
        favBtn.style.cursor = "pointer";
        favBtn.style.fontSize = "1.2rem";
        favBtn.style.marginLeft = "10px";
        updateFavBtnState(favBtn, 'league', leagueName);
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite('league', leagueName, leagueName);
        };
        topBarTitle.appendChild(favBtn);

        contentArea.innerHTML = '';
        const clone = template.content.cloneNode(true);
        contentArea.appendChild(clone);

        // Handle Ligapokal specific view (Hide Tabs, show only table)
        if (leagueName.includes("Ligapokal")) {
            const tabsContainer = contentArea.querySelector('.tabs');
            if (tabsContainer) tabsContainer.style.display = 'none';
        } else {
            setupTabs(true);
        }

        const normalizeClubName = (str) => {
            return str.toLowerCase()
                .replace(/[.'`´]/g, '')
                .replace(/\s+/g, ' ')
                .replace(/\s+e\s?v/gi, '')
                .trim();
        };

        const findClubIndex = (name) => {
            if (typeof CLUB_DATA === 'undefined' || !CLUB_DATA.clubs) return -1;
            const normText = normalizeClubName(name);
            let idx = CLUB_DATA.clubs.findIndex(c => normalizeClubName(c.name) === normText);
            if (idx === -1) {
                const match = normText.match(/^(.*?)\s+\d+$/);
                if (match) {
                    idx = CLUB_DATA.clubs.findIndex(c => normalizeClubName(c.name) === match[1]);
                }
            }
            return idx;
        };

        const tableContainer = document.getElementById('league-table-container');
        if (data.table) {
            tableContainer.innerHTML = data.table;
            cleanTable(tableContainer);
            if (typeof CLUB_DATA !== 'undefined' && CLUB_DATA.clubs) {
                const tds = tableContainer.querySelectorAll('td');
                tds.forEach(td => {
                    const rawText = td.textContent.trim().replace(/\u00A0/g, ' ');
                    const index = findClubIndex(rawText);
                    if (index !== -1) {
                        td.textContent = '';
                        const span = document.createElement('span');
                        span.textContent = rawText;
                        span.style.cursor = 'pointer';
                        span.style.color = '#60a5fa';
                        span.style.fontWeight = '500';
                        span.onclick = () => navigateTo('club', index);
                        span.onmouseenter = () => span.style.textDecoration = 'underline';
                        span.onmouseleave = () => span.style.textDecoration = 'none';
                        td.appendChild(span);
                    }
                });
            }
        } else {
            tableContainer.innerHTML = '<p class="text-secondary">Keine Tabelle verfügbar.</p>';
        }

        const resultsContainer = document.getElementById('league-results-container');
        const matchDays = Object.keys(data.match_days).sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });

        if (matchDays.length > 0) {
            matchDays.forEach(day => {
                const group = document.createElement('div');
                group.className = 'results-group';

                const title = document.createElement('h3');
                title.textContent = day;
                title.style.borderBottom = "1px solid #334155";
                title.style.paddingBottom = "8px";
                title.style.marginBottom = "12px";
                group.appendChild(title);

                const rawText = data.match_days[day] || "";
                if (rawText && rawText !== "Keine Ergebnisse.") {
                    const lines = rawText.split('\n');
                    lines.forEach(line => {
                        line = line.trim();
                        if (!line) return;

                        let result = "---";
                        let mainPart = line;
                        const resMatch = line.match(/\s+(\d+:\d+|---|:)\s*$/);
                        if (resMatch) {
                            result = resMatch[1];
                            mainPart = line.substring(0, resMatch.index).trim();
                        }

                        const dateMatch = mainPart.match(/^.*?\d{4}(\s+\d{2}:\d{2})?/);
                        let dateStr = "";
                        let teamsPart = mainPart;
                        if (dateMatch) {
                            dateStr = dateMatch[0];
                            teamsPart = mainPart.substring(dateStr.length).trim();
                        }

                        const separatorMatch = teamsPart.match(/\s+-\s+/);
                        let homeName = teamsPart;
                        let guestName = "";

                        if (separatorMatch) {
                            homeName = teamsPart.substring(0, separatorMatch.index).trim();
                            guestName = teamsPart.substring(separatorMatch.index + separatorMatch[0].length).trim();
                        }

                        const createClubSpan = (name) => {
                            const idx = findClubIndex(name);
                            const span = document.createElement('span');
                            span.textContent = name;
                            if (idx !== -1) {
                                span.style.cursor = 'pointer';
                                span.style.color = '#60a5fa';
                                span.style.fontWeight = '500';
                                span.onclick = () => navigateTo('club', idx);
                                span.onmouseenter = () => span.style.textDecoration = 'underline';
                                span.onmouseleave = () => span.style.textDecoration = 'none';
                            } else {
                                span.style.color = '#e2e8f0';
                            }
                            return span;
                        };

                        const matchCard = document.createElement('div');
                        matchCard.className = 'match-card';
                        matchCard.style.background = "#1e293b";
                        matchCard.style.marginBottom = "8px";
                        matchCard.style.padding = "10px";
                        matchCard.style.borderRadius = "6px";
                        matchCard.style.border = "1px solid #334155";
                        matchCard.style.display = "flex";
                        matchCard.style.justifyContent = "space-between";
                        matchCard.style.alignItems = "center";
                        matchCard.style.flexWrap = "wrap";
                        matchCard.style.gap = "10px";

                        const dateDiv = document.createElement('div');
                        dateDiv.textContent = dateStr;
                        dateDiv.style.color = "#94a3b8";
                        dateDiv.style.fontSize = "0.85em";
                        dateDiv.style.width = "140px";

                        const teamsDiv = document.createElement('div');
                        teamsDiv.style.flex = "1";
                        teamsDiv.style.display = "flex";
                        teamsDiv.style.justifyContent = "center";
                        teamsDiv.style.gap = "8px";
                        teamsDiv.style.color = "#e2e8f0";
                        teamsDiv.appendChild(createClubSpan(homeName));

                        const vsSpan = document.createElement('span');
                        vsSpan.textContent = "-";
                        vsSpan.style.color = "#64748b";
                        teamsDiv.appendChild(vsSpan);
                        teamsDiv.appendChild(createClubSpan(guestName));

                        const resDiv = document.createElement('div');
                        resDiv.textContent = result;
                        resDiv.style.fontWeight = "bold";
                        resDiv.style.color = "#f8fafc";
                        resDiv.style.minWidth = "40px";
                        resDiv.style.textAlign = "right";

                        matchCard.appendChild(dateDiv);
                        matchCard.appendChild(teamsDiv);
                        matchCard.appendChild(resDiv);
                        group.appendChild(matchCard);
                    });
                } else {
                    const empty = document.createElement('div');
                    empty.textContent = rawText || "Keine Ergebnisse.";
                    empty.className = 'results-card';
                }
                resultsContainer.appendChild(group);
            });
        } else {
            resultsContainer.innerHTML = '<p class="text-secondary">Keine Ergebnisse verfügbar.</p>';
        }

        // Initialize Tabs explicitly for League View - ensure first is active
        setupTabs(true);
    }

    function setupTabs(forceFirst = false) {
        // Scope to contentArea to prevent finding unrelated elements (if any)
        const tabs = contentArea.querySelectorAll('.tab-btn');
        const contents = contentArea.querySelectorAll('.tab-content');

        console.log(`Setting up tabs: found ${tabs.length} buttons and ${contents.length} contents.`);

        tabs.forEach(tab => {
            // Remove old listeners by cloning (simple way) or just adding new ones logic is fine if DOM is fresh
            tab.onclick = () => { // Use onclick property to ensure single listener
                const tabId = tab.dataset.tab;
                console.log(`Tab clicked: ${tabId}`);

                // Deactivate all
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                // Activate clicked
                tab.classList.add('active');

                const targetId = `tab-${tabId}`;
                const target = contentArea.querySelector(`#${targetId}`);
                if (target) {
                    target.classList.add('active');
                    console.log(`Activated content: ${targetId}`);
                } else {
                    console.error(`Target content not found: ${targetId}`);
                }
            };
        });

        if (forceFirst && tabs.length > 0) {
            console.log("Forcing click on first tab");
            tabs[0].click();
        }
    }

    function calculateTotalPoints(p) {
        let sum = 0;
        let count = 0;
        let dCount = 0;
        if (!p.rounds) return 0;

        for (let i = 1; i <= 18; i++) {
            const val = String(p.rounds[`R${i}`] || "");
            if (val.toLowerCase() === 'd') {
                dCount++;
            } else {
                const num = parseInt(val);
                if (!isNaN(num)) {
                    sum += num;
                    count++;
                }
            }
        }

        const avg = count > 0 ? (sum / count) : 0;
        return sum + (avg * dCount);
    }

    function renderRanking(rankName) {
        topBarTitle.textContent = rankName;
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = "20px";
        container.className = "fade-in";

        // Logic to get players for this ranking
        // We match p.league with rankName
        let players = [];
        if (rankingData && rankingData.players) {
            players = rankingData.players.filter(p => p.league === rankName);
        }

        if (players.length === 0) {
            // Fallback to existing static HTML if no players found (compatibility)
            if (rankingData.rankings && rankingData.rankings[rankName]) {
                const div = document.createElement('div');
                div.innerHTML = rankingData.rankings[rankName];
                cleanTable(div);
                container.appendChild(div);
            } else {
                container.innerHTML = '<div style="color: #94a3b8;">Keine Daten verfügbar.</div>';
            }
            contentArea.appendChild(container);
            return;
        }

        // Calculate and Sort
        players = players.map(p => {
            const total = calculateTotalPoints(p);
            const stats = calculatePlayerStats(p);
            return { ...p, _totalPoints: total, _stats: stats };
        }).sort((a, b) => {
            // Sort by Points Desc, then Avg Desc
            if (b._totalPoints !== a._totalPoints) return b._totalPoints - a._totalPoints;
            return b._stats.avg - a._stats.avg;
        });

        // Build Table
        let html = `
        <div style="background: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden;">
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; color: #e2e8f0; font-size: 0.9em; min-width: 600px;">
                    <thead>
                        <tr style="background: #0f172a; border-bottom: 1px solid #334155; text-align: left;">
                            <th style="padding: 12px 15px; width: 50px;">#</th>
                            <th style="padding: 12px 15px;">Name</th>
                            <th style="padding: 12px 15px;">Verein</th>
                            <th style="padding: 12px 15px; text-align: center;">Spiele</th>
                            <th style="padding: 12px 15px; text-align: right;">Ø</th>
                            <th style="padding: 12px 15px; text-align: right;">Punkte</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        players.forEach((p, idx) => {
            const isTop3 = idx < 3;
            const rankEmoji = idx === 0 ? '🥇 ' : (idx === 1 ? '🥈 ' : (idx === 2 ? '🥉 ' : ''));
            const rowStyle = idx % 2 === 0 ? 'background: transparent;' : 'background: rgba(255,255,255,0.02);';
            const rankStyle = isTop3 ? 'color: #fbbf24; font-weight: bold;' : 'color: #94a3b8;';
            const highlightStyle = isTop3 ? 'color: #f8fafc; font-weight: 600;' : 'color: #e2e8f0;';

            // Find Club Index for link
            let clubIdx = -1;
            let clubName = p.company;

            if (clubData.clubs) {
                const club = clubData.clubs.find(c => c.number === p.v_nr);
                if (club) {
                    clubIdx = clubData.clubs.indexOf(club);
                    // Use club name from master data if missing on player object
                    if (!clubName) clubName = club.name;
                }
            }
            // Fallback
            if (!clubName) clubName = "Unbekannt";

            const isMyPlayer = p.name === myPlayerName;
            const extraClass = isMyPlayer ? 'my-player-row' : '';
            // const rowStyle already defined above, reuse/override background in class
            // If my player, override background in inline style or rely on class !important

            html += `
            <tr class="${extraClass}" style="${rowStyle} border-bottom: 1px solid #334155; transition: background 0.15s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='${idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'}'">
                <td style="padding: 10px 15px; ${rankStyle}">${rankEmoji}${idx + 1}.</td>
                <td style="padding: 10px 15px; ${highlightStyle}">
                    ${p.name}
                    ${p.team ? `<div style="font-size: 0.8em; color: #64748b;">${p.team}</div>` : ''}
                </td>
                <td style="padding: 10px 15px; color: #60a5fa; cursor: pointer;" onclick="navigateTo('club', ${clubIdx})">
                    ${clubName}
                </td>
                <td style="padding: 10px 15px; text-align: center; color: #94a3b8;">${p._stats.count}</td>
                <td style="padding: 10px 15px; text-align: right; color: #4ade80;">${p._stats.avg.toFixed(2)}</td>
                <td style="padding: 10px 15px; text-align: right; font-weight: bold; color: #f8fafc; font-size: 1.1em;">
                    ${parseFloat(p._totalPoints.toFixed(2)) /* Remove trailing zeros */}
                </td>
            </tr>
            `;
        });

        html += `</tbody></table></div></div>`;

        // Add info about calculation
        html += `<div style="margin-top: 10px; font-size: 0.8em; color: #64748b; font-style: italic;">
            * 'D' wertet als Durchschnitt der gespielten Spiele (Spielfrei-Ausgleich).
        </div>`;

        container.innerHTML = html;
        contentArea.appendChild(container);
    }



    function renderSparkline(rounds) {
        if (!rounds) return "";
        const data = [];
        for (let i = 1; i <= 18; i++) {
            const val = parseInt(rounds[`R${i}`]);
            if (!isNaN(val)) data.push(val);
        }
        if (data.length < 2) return "";

        const width = 60;
        const height = 25;
        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;

        let points = "";
        data.forEach((val, idx) => {
            const x = (idx / (data.length - 1)) * width;
            const y = height - ((val - min) / range) * height; // Invert Y
            points += `${x},${y} `;
        });

        return `<svg width="${width}" height="${height}" style="margin-left: 10px; opacity: 0.8; overflow: visible;">
            <polyline points="${points}" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    function renderClub(index) {
        const club = clubData.clubs[index];
        topBarTitle.innerHTML = "";
        const span = document.createElement('span');
        span.textContent = club.name;
        topBarTitle.appendChild(span);

        const favBtn = document.createElement('button');
        favBtn.id = "fav-btn";
        favBtn.style.background = "none";
        favBtn.style.border = "none";
        favBtn.style.cursor = "pointer";
        favBtn.style.fontSize = "1.2rem";
        favBtn.style.marginLeft = "10px";
        updateFavBtnState(favBtn, 'club', index);
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite('club', index, club.name);
        };
        topBarTitle.appendChild(favBtn);
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = "20px";

        const card = document.createElement('div');
        card.className = 'results-card';
        card.style.maxWidth = "800px";
        card.style.backgroundColor = "#1e293b";
        card.style.padding = "30px";

        let html = `<h2 style="margin-bottom: 25px; color: #fff; border-bottom: 1px solid #334155; padding-bottom: 15px;">${club.name}</h2>`;
        html += `<div class="club-details-grid">`;

        const labels = {
            number: "Vereinsnummer", venue: "Spiellokal", street: "Straße", city: "Ort", phone: "Telefon (Spiellokal)", fax: "Fax",
            website: "Webseite", email: "E-Mail (Verein)", contact: "Ansprechpartner", contact_phone: "Telefon (Kontakt)",
            mobile: "Mobil (Kontakt)", contact_email: "E-Mail (Kontakt)"
        };
        const order = ["number", "venue", "street", "city", "phone", "fax", "website", "email", "contact", "contact_phone", "mobile", "contact_email"];

        order.forEach(key => {
            const label = labels[key] || key;
            let value = club[key];
            if (!value || value === "null") value = "-";
            let renderedValue = value;
            if (key === 'website' && value !== "-") {
                let url = value;
                if (!url.startsWith('http')) url = 'http://' + url;
                renderedValue = `<a href="${url}" target="_blank" style="color: #3b82f6; text-decoration: none;">${value}</a>`;
            } else if ((key === 'email' || key === 'contact_email') && value !== "-") {
                renderedValue = `<a href="mailto:${value}" style="color: #3b82f6; text-decoration: none;">${value}</a>`;
            }
            html += `<div style="font-weight: 600; color: #94a3b8;">${label}:</div><div style="color: #f8fafc;">${renderedValue}</div>`;
        });

        if (club.street || club.city) {
            const query = `${club.street || ''} ${club.city || ''}`.trim();
            if (query) {
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
                html += `<div style="grid-column: 1 / -1; margin-top: 10px; margin-bottom: 10px;">
                    <a href="${mapsUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background-color: #3b82f6; color: white; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 0.9em; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">
                        <span>📍</span> Auf Karte zeigen
                    </a></div>`;
            }
        }

        html += `</div>`;

        if (club.number && typeof RANKING_DATA !== 'undefined' && RANKING_DATA.players) {
            const players = RANKING_DATA.players.filter(p => p.v_nr === club.number);
            if (players.length > 0) {
                const uniquePlayers = [];
                const seenIds = new Set();
                players.forEach(p => {
                    if (p.id) {
                        if (!seenIds.has(p.id)) {
                            seenIds.add(p.id);
                            uniquePlayers.push(p);
                        }
                    } else {
                        uniquePlayers.push(p);
                    }
                });

                uniquePlayers.sort((a, b) => {
                    const pointsA = parseInt(a.points) || 0;
                    const pointsB = parseInt(b.points) || 0;
                    if (pointsB !== pointsA) return pointsB - pointsA;
                    return a.name.localeCompare(b.name);
                });

                html += `<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #334155;">
                    <div style="font-weight: 600; color: #94a3b8; margin-bottom: 20px;">Gemeldete Spieler (${uniquePlayers.length}):</div>`;

                const playersByLeague = {};
                uniquePlayers.forEach(p => {
                    const league = p.league || "Unbekannt";
                    if (!playersByLeague[league]) playersByLeague[league] = [];
                    playersByLeague[league].push(p);
                });

                const leagueOrder = ["Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse"];
                const sortedLeagues = Object.keys(playersByLeague).sort((a, b) => {
                    let idxA = leagueOrder.findIndex(l => a.includes(l));
                    let idxB = leagueOrder.findIndex(l => b.includes(l));
                    if (idxA === -1) idxA = 999;
                    if (idxB === -1) idxB = 999;
                    if (idxA !== idxB) return idxA - idxB;
                    return a.localeCompare(b);
                });

                sortedLeagues.forEach(leagueName => {
                    const leaguePlayers = playersByLeague[leagueName];
                    leaguePlayers.sort((a, b) => {
                        const pointsA = parseInt(a.points) || 0;
                        const pointsB = parseInt(b.points) || 0;
                        if (pointsB !== pointsA) return pointsB - pointsA;
                        return a.name.localeCompare(b.name);
                    });

                    // logic to find matching league keys
                    let leagueActionButtons = "";
                    if (leagueData && leagueData.leagues) {
                        const potentialKeys = Object.keys(leagueData.leagues).filter(k => k.startsWith(leagueName));
                        console.log(`[LeagueMatch] Checking ${potentialKeys.length} potential keys for club '${club.name}' in league '${leagueName}'`);

                        potentialKeys.forEach(pk => {
                            const lTable = leagueData.leagues[pk].table || "";
                            // Robust normalization: remove &nbsp; and ALL whitespace
                            const normTable = lTable.replace(/&nbsp;/g, '').replace(/\s+/g, '').toLowerCase();
                            const normClub = club.name.replace(/\s+/g, '').toLowerCase();

                            const isMatch = normTable.includes(normClub);
                            console.log(`[LeagueMatch] Key: ${pk}, Match: ${isMatch}`);

                            if (isMatch) {
                                // Extract specific team name from table
                                // Table cells look like: <td>Team Name</td> or <td>&nbsp;Team Name&nbsp;</td>
                                // We search for the club name in the original HTML to get the display variant (e.g. "Club II")
                                let buttonText = "Tabelle";
                                try {
                                    // Robust Regex: splitting by space and allowing &nbsp; or whitespace between parts involving HTML entities
                                    // Escape special chars first
                                    const parts = club.name.split(/\s+/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                                    // Join with pattern matching space OR &nbsp;
                                    const flexibleNamePattern = parts.join('(?:\\s|&nbsp;)+');

                                    // Regex to find the cell content containing match, allowing for &nbsp; and whitespaces
                                    // We look for > (content including club name) <
                                    const regex = new RegExp(`>([^<]*?${flexibleNamePattern}[^<]*?)<`, 'i');
                                    const match = lTable.match(regex);
                                    if (match && match[1]) {
                                        // Clean up the found text
                                        let foundName = match[1].replace(/&nbsp;/g, ' ').trim();
                                        // Removing leading/trailing punctuation if any (like > or < artifacts, though regex should prevent)
                                        if (foundName.length > club.name.length + 8) {
                                            // slightly loose validation
                                        }
                                        buttonText = foundName;
                                    }
                                } catch (e) { console.error("Name extraction error", e); }

                                leagueActionButtons += `<button onclick="event.stopPropagation(); navigateTo('league', '${pk}')" style="margin-left: 10px; padding: 4px 10px; font-size: 0.75em; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">${buttonText}</button>`;
                            }
                        });
                    }

                    html += `<h3 style="color: #60a5fa; font-size: 1.1em; margin-bottom: 12px; margin-top: 15px; border-bottom: 1px solid #334155; padding-bottom: 5px; display: flex; align-items: center; justify-content: space-between;">
                        <span>${leagueName} (${leaguePlayers.length})</span>
                        <div>${leagueActionButtons}</div>
                    </h3>`;
                    html += `<div style="display: flex; flex-direction: column; gap: 8px;">`;

                    leaguePlayers.forEach(p => {
                        let stats = "";
                        let roundsDisplay = "";
                        let averageDisplay = "";

                        if (p.rounds) {
                            const roundValues = [];
                            let sum = 0;
                            let count = 0;
                            for (let i = 1; i <= 18; i++) {
                                const val = p.rounds[`R${i}`];
                                if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
                                    sum += parseInt(val);
                                    count++;
                                }
                                if (val && val !== "&nbsp;") {
                                    roundValues.push(`<span title="R${i}" style="min-width: 14px; text-align: center; color: ${val === 'x' ? '#64748b' : '#3b82f6'};">${val}</span>`);
                                } else {
                                    roundValues.push(`<span style="min-width: 14px; color: #334155;">.</span>`);
                                }
                            }
                            if (count > 0) {
                                const avg = (sum / count).toFixed(2);
                                averageDisplay = `<span style="font-size: 0.85em; color: #94a3b8; margin-right: 8px;">Ø <strong style="color: #cbd5e1;">${avg}</strong></span>`;
                            }
                            if (roundValues.some(v => !v.includes('>.<'))) {
                                roundsDisplay = `<div style="display: flex; gap: 4px; font-size: 0.75em; color: #64748b; margin-top: 6px; flex-wrap: wrap; border-top: 1px dashed rgba(148, 163, 184, 0.2); padding-top: 4px;">${roundValues.join('')}</div>`;
                            }
                        }

                        if (p.rank) {

                            const sparkline = renderSparkline(p.rounds);
                            stats = `<div style="display: flex; align-items: center; margin-left: auto;">
                                ${averageDisplay}
                                ${sparkline}
                                <span style="font-size: 0.85em; color: #94a3b8; margin-left: 10px;">Rang: <strong style="color: #cbd5e1;">${p.rank}</strong> (${p.points || '0'} Pkt.)</span>
                            </div>`;
                        }

                        let archiveHtml = "";
                        if (p.id && archiveData[p.id]) {
                            const history = archiveData[p.id];
                            if (history && history.length > 0) {
                                history.sort((a, b) => b.season.localeCompare(a.season));
                                const historyItems = history.map(h => {
                                    return `<span style="font-size: 0.8em; color: #64748b; margin-right: 8px; background: rgba(30, 41, 59, 0.5); padding: 2px 6px; border-radius: 4px;">${h.season}: #${h.rank} (${h.points} Pkt.) - ${h.league}</span>`;
                                }).join("");
                                archiveHtml = `<div style="font-size: 0.8em; color: #64748b; margin-top: 4px; margin-left: 0; width: 100%;"><span style="margin-right: 5px;">Archiv:</span> ${historyItems}</div>`;
                            }
                        }

                        const isMyPlayer = p.name === myPlayerName;
                        const extraClass = isMyPlayer ? 'my-player-row' : '';

                        html += `<div class="player-item ${extraClass}" style="display: flex; flex-direction: column; background: rgba(59, 130, 246, 0.1); color: #eff6ff; padding: 8px 12px; border-radius: 6px; font-size: 0.95em; border: 1px solid rgba(59, 130, 246, 0.2);">
                            <div style="display: flex; align-items: center; width: 100%; flex-wrap: wrap;">
                                <span class="player-name" style="font-weight: 500;">${p.name}</span>
                                ${stats}
                                ${archiveHtml}
                            </div>
                            ${roundsDisplay}
                        </div>`;
                    });
                    html += `</div>`;
                });
                html += `</div>`;
            }
        }



        // --- HISTORICAL TABLES ---
        if (typeof window.ARCHIVE_TABLES !== 'undefined' && window.ARCHIVE_TABLES.length > 0) {

            // Normalize current club name for matching
            const currentClubName = club.name.toLowerCase().trim();
            const currentClubNameParts = currentClubName.split(' '); // e.g. ["dc", "destroyers", "e.v."]

            // Filter relevant tables
            const relevantTables = window.ARCHIVE_TABLES.filter(table => {
                // Determine if any row in this table matches our club
                return table.rows.some(row => {
                    if (row.length < 2) return false;

                    // Check ALL columns for the club name (important for Match Lists where club can be Heim or Gast)
                    return row.some(cell => {
                        const normalize = (s) => s.replace(/(e\.?v\.?)|d\.?c\.?|s\.?v\.?/gi, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                        const clubNorm = normalize(club.name);
                        const cellNorm = normalize(cell);

                        // Direct containment (Club Name is in the Cell)
                        if (cellNorm.includes(clubNorm)) return true;

                        // Token matching
                        const clubTokens = club.name.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                        const cellTokens = cell.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");

                        const commonWords = ["dart", "club", "team", "darts", "sport", "heim", "gast", "spiel", "ergebnis"];
                        const relevantMatches = clubTokens.filter(t => cellTokens.includes(t) && !commonWords.includes(t));

                        return relevantMatches.length >= 1;
                    });
                });
            });

            if (relevantTables.length > 0) {
                // Sort by Season Descending
                relevantTables.sort((a, b) => b.season.localeCompare(a.season));

                html += `<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155;">
                    <h3 style="color: #60a5fa; font-size: 1.2em; margin-bottom: 15px;">Archiv / Historie</h3>`;

                relevantTables.forEach(table => {
                    // Inspect Headers to determine type
                    // Ranking Tables usually have "Pl." and "Tabelle" (or "Team") and "Pkt"
                    // Match Lists usually have "Heim" and "Gast" and "Ergebnis"

                    const headerRowStr = table.rows[0].map(h => h.toLowerCase()).join(' ');
                    const isMatchList = headerRowStr.includes('heim') && headerRowStr.includes('gast') && headerRowStr.includes('ergebnis');
                    // Treat everything else as a Ranking Table unless it's clearly a match list

                    if (isMatchList) {
                        // --- MATCH LIST RENDER LOGIC (Filtered) ---
                        // Only show rows where our club is involved
                        const myRows = table.rows.filter(row => {
                            if (row.length < 2) return false;
                            // Check if club is in ANY column
                            return row.some(cell => {
                                const normalize = (s) => s.replace(/(e\.?v\.?)|d\.?c\.?|s\.?v\.?/gi, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                                const clubNorm = normalize(club.name);
                                const cellNorm = normalize(cell);

                                if (cellNorm.includes(clubNorm)) return true;

                                const clubTokens = club.name.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                                const cellTokens = cell.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                                const commonWords = ["dart", "club", "team", "darts", "sport", "heim", "gast", "spiel", "ergebnis"];
                                const relevantMatches = clubTokens.filter(t => cellTokens.includes(t) && !commonWords.includes(t));
                                return relevantMatches.length >= 1;
                            });
                        });

                        if (myRows.length > 0) {
                            html += `<div style="margin-bottom: 25px;">
                                <div style="font-weight: 600; color: #94a3b8; margin-bottom: 8px;">${table.league}</div>
                                <div class="table-container" style="padding: 0; background: transparent; border: none; overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 0.85em; color: #e2e8f0; min-width: 400px;">
                                    <thead>
                                        <tr style="background: rgba(30, 41, 59, 0.5); border-bottom: 1px solid #475569;">
                                            ${table.rows[0].map(header => `<th style="padding: 8px 6px; text-align: left; white-space: nowrap;">${header}</th>`).join('')}
                                        </tr>
                                    </thead>
                                    <tbody>`;

                            myRows.forEach(row => {
                                html += `<tr style="border-bottom: 1px solid #334155;">
                                    ${row.map(cell => {
                                    // Highlight our club
                                    const normalize = (s) => s.replace(/(e\.?v\.?)|d\.?c\.?|s\.?v\.?/gi, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                                    const clubNorm = normalize(club.name);
                                    const cellNorm = normalize(cell);
                                    let isMyClub = false;
                                    if (cellNorm.includes(clubNorm)) isMyClub = true;
                                    else {
                                        const clubTokens = club.name.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                                        const cellTokens = cell.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                                        const commonWords = ["dart", "club", "team", "darts", "sport"];
                                        const relevantMatches = clubTokens.filter(t => cellTokens.includes(t) && !commonWords.includes(t));
                                        if (relevantMatches.length >= 1) isMyClub = true;
                                    }

                                    const cellStyle = isMyClub ? 'font-weight: bold; color: #60a5fa;' : '';

                                    return `<td style="padding: 6px; white-space: nowrap; ${cellStyle}">${cell}</td>`;
                                }).join('')}
                                 </tr>`;
                            });

                            html += `</tbody></table></div></div>`;
                        }

                    } else {
                        // --- RANKING TABLE RENDER LOGIC (Full Table) ---

                        // Generate Table HTML
                        let tableHtml = `<div style="margin-bottom: 25px;">
                            <div style="font-weight: 600; color: #94a3b8; margin-bottom: 8px;">Saison ${table.season} - ${table.league}</div>
                            <div class="table-container" style="padding: 0; background: transparent; border: none; overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em; color: #e2e8f0; min-width: 600px;">
                                <thead>
                                    <tr style="background: rgba(30, 41, 59, 0.5); border-bottom: 1px solid #475569;">
                                        ${table.rows[0].map(header => `<th style="padding: 8px 6px; text-align: left; white-space: nowrap;">${header}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>`;

                        // Skip header row (index 0)
                        for (let i = 1; i < table.rows.length; i++) {
                            const row = table.rows[i];
                            if (row.length < 2) continue;

                            // Check if this row belongs to our club
                            // Scan all columns instead of hardcoded index
                            let isMyClub = row.some(cell => {
                                const normalize = (s) => s.replace(/(e\.?v\.?)|d\.?c\.?|s\.?v\.?/gi, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                                const clubNorm = normalize(club.name);
                                const cellNorm = normalize(cell);

                                if (cellNorm.includes(clubNorm)) return true;

                                const clubTokens = club.name.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                                const cellTokens = cell.toLowerCase().split(/[\s.-]+/).filter(t => t.length > 2 && t !== "e.v.");
                                const commonWords = ["dart", "club", "team", "darts", "sport"];
                                const relevantMatches = clubTokens.filter(t => cellTokens.includes(t) && !commonWords.includes(t));
                                return relevantMatches.length >= 1;
                            });

                            const bgStyle = isMyClub ? 'background: rgba(59, 130, 246, 0.2);' : '';
                            const rowStyle = isMyClub ? 'font-weight: bold; color: #60a5fa;' : '';

                            tableHtml += `<tr style="border-bottom: 1px solid #334155; ${bgStyle} ${rowStyle}">
                                ${row.map(cell => `<td style="padding: 6px; white-space: nowrap;">${cell}</td>`).join('')}
                             </tr>`;
                        }

                        tableHtml += `</tbody></table></div></div>`;
                        html += tableHtml;
                    }
                });

                html += `</div>`;
            }
        }

        card.innerHTML = html;
        container.appendChild(card);
        contentArea.appendChild(container);
    }

    // (Rules removed: Duplicate setupTabs definition was here)

    function cleanTable(container) {
        const table = container.querySelector('table');
        if (table) {
            table.removeAttribute('style');
            table.removeAttribute('border');
            table.removeAttribute('cellpadding');
            table.removeAttribute('cellspacing');
        }
    }

    function renderMatchPreview() {
        topBarTitle.textContent = "Match Preview";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "1000px";
        container.style.margin = "0 auto";

        // Step 1: Selector UI
        const card = document.createElement('div');
        card.style.background = "#1e293b";
        card.style.padding = "20px";
        card.style.borderRadius = "8px";
        card.style.border = "1px solid #334155";
        card.style.marginBottom = "20px";

        const title = document.createElement('h3');
        title.textContent = "⚔️ Begegnung & Aufstellung";
        title.style.color = "#60a5fa";
        title.style.marginBottom = "20px";
        card.appendChild(title);

        // LEAGUE SELECTOR
        const leagueGroup = document.createElement('div');
        leagueGroup.style.marginBottom = "15px";
        const leagueLabel = document.createElement('label');
        leagueLabel.textContent = "Liga:";
        leagueLabel.style.color = "#94a3b8";
        leagueLabel.style.display = "block";
        leagueLabel.style.marginBottom = "5px";
        const leagueSelect = document.createElement('select');
        leagueSelect.className = "dark-select";
        leagueSelect.style.width = "100%";
        leagueSelect.style.padding = "8px";
        leagueSelect.style.background = "#0f172a";
        leagueSelect.style.color = "white";
        leagueSelect.style.border = "1px solid #475569";
        leagueSelect.style.borderRadius = "4px";

        leagueSelect.innerHTML = '<option value="">-- Bitte Liga wählen --</option>';
        const sortedLeagues = Object.keys(leagueData.leagues || {}).sort();
        sortedLeagues.forEach(l => {
            leagueSelect.innerHTML += `<option value="${l}">${l}</option>`;
        });
        leagueGroup.appendChild(leagueLabel);
        leagueGroup.appendChild(leagueSelect);
        card.appendChild(leagueGroup);

        // TEAM CONTAINER
        const teamSelection = document.createElement('div');
        teamSelection.style.display = "none";

        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
        grid.style.gap = '20px';

        const teamAGroup = document.createElement('div');
        const teamALabel = document.createElement('label');
        teamALabel.textContent = "Heim Team:";
        teamALabel.style.color = "#94a3b8";
        const teamASelect = document.createElement('select');
        teamASelect.className = "dark-select";
        teamASelect.style.width = "100%";
        teamASelect.style.padding = "8px";
        teamASelect.style.background = "#0f172a";
        teamASelect.style.color = "white";
        teamASelect.style.border = "1px solid #475569";
        teamASelect.style.borderRadius = "4px";
        teamAGroup.appendChild(teamALabel);
        teamAGroup.appendChild(teamASelect);

        const teamBGroup = document.createElement('div');
        const teamBLabel = document.createElement('label');
        teamBLabel.textContent = "Gast Team:";
        teamBLabel.style.color = "#94a3b8";
        const teamBSelect = document.createElement('select');
        teamBSelect.className = "dark-select";
        teamBSelect.style.width = "100%";
        teamBSelect.style.padding = "8px";
        teamBSelect.style.background = "#0f172a";
        teamBSelect.style.color = "white";
        teamBSelect.style.border = "1px solid #475569";
        teamBSelect.style.borderRadius = "4px";
        teamBGroup.appendChild(teamBLabel);
        teamBGroup.appendChild(teamBSelect);

        grid.appendChild(teamAGroup);
        grid.appendChild(teamBGroup);
        teamSelection.appendChild(grid);

        // SELECTION AREA
        const selectionArea = document.createElement('div');
        selectionArea.id = 'player-selection-area';
        selectionArea.style.marginTop = "20px";
        selectionArea.style.display = "none";
        selectionArea.style.borderTop = "1px solid #334155";
        selectionArea.style.paddingTop = "20px";

        const listGrid = document.createElement('div');
        listGrid.style.display = 'grid';
        listGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
        listGrid.style.gap = '20px';
        listGrid.innerHTML = `<div id="list-a"></div><div id="list-b"></div>`;
        selectionArea.appendChild(listGrid);

        const calcBtn = document.createElement('button');
        calcBtn.textContent = "Prognose berechnen";
        calcBtn.style.marginTop = "20px";
        calcBtn.style.padding = "12px 20px";
        calcBtn.style.background = "#3b82f6";
        calcBtn.style.color = "white";
        calcBtn.style.border = "none";
        calcBtn.style.borderRadius = "4px";
        calcBtn.style.cursor = "pointer";
        calcBtn.style.width = "100%";
        calcBtn.style.fontWeight = "bold";
        calcBtn.style.fontSize = "1.1em";
        selectionArea.appendChild(calcBtn);

        teamSelection.appendChild(selectionArea);
        card.appendChild(teamSelection);
        container.appendChild(card);

        // RESULT CONTAINER
        const resultDiv = document.createElement('div');
        resultDiv.id = 'preview-results';
        container.appendChild(resultDiv);

        contentArea.appendChild(container);

        // Logic
        let availableTeams = [];
        let playersA = [];
        let playersB = [];
        let selectedA = new Set();
        let selectedB = new Set();

        const normalize = (s) => s.toLowerCase().replace(/\d{4}-\d{4}/g, '').replace(/\d{4}/g, '').replace(/\s+/g, ' ').trim();

        leagueSelect.addEventListener('change', () => {
            const league = leagueSelect.value;
            selectionArea.style.display = "none";
            resultDiv.innerHTML = "";

            if (!league) {
                teamSelection.style.display = "none";
                return;
            }

            const targetNorm = normalize(league);

            let playersInLeague = rankingData.players.filter(p => {
                const pNorm = normalize(p.league || "");
                return pNorm === targetNorm || pNorm.includes(targetNorm) || targetNorm.includes(pNorm);
            });

            if (playersInLeague.length === 0) {
                const allLeagues = [...new Set(rankingData.players.map(p => p.league || ""))];
                const keywords = league.split(' ').filter(w => w.length > 3);
                const similar = allLeagues.filter(l => keywords.some(k => l.includes(k))).slice(0, 5);
                const debugDiv = document.createElement('div');
                debugDiv.style.color = "#ef4444";
                debugDiv.innerHTML = `⚠️ Keine Teams gefunden.<br>Similar: ${similar.join(', ')}`;
                leagueGroup.appendChild(debugDiv);
            } else {
                const old = leagueGroup.querySelector('div[style*="#ef4444"]');
                if (old) old.remove();
            }

            // Extract real team names from league table
            let tableTeams = [];
            if (leagueData.leagues[league] && leagueData.leagues[league].table) {
                const temp = document.createElement('div');
                temp.innerHTML = leagueData.leagues[league].table;
                const rows = temp.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length > 2) {
                        tableTeams.push(cells[1].textContent.trim());
                    }
                });
            }

            const teamsSet = new Map();
            playersInLeague.forEach(p => {
                let id = null;
                let name = null;

                if (p.v_nr) {
                    id = String(p.v_nr);
                    if (!teamsSet.has(id)) {
                        name = p.company || "Unbekannt";
                        if (clubData.clubs) {
                            const c = clubData.clubs.find(cl => String(cl.number) === id);
                            if (c) name = c.name;
                        }
                    }
                } else if (p.company) {
                    id = "NAME:" + p.company;
                    if (!teamsSet.has(id)) {
                        name = p.company;
                    }
                }

                if (id && name) {
                    // Try to find better name from table
                    if (tableTeams.length > 0) {
                        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                        const nName = norm(name);

                        // Find match: candidate name is usually a substring of table name (e.g. "Club" in "Club 1")
                        // Or table name is substring of candidate (rare)
                        const betterName = tableTeams.find(t => {
                            const nT = norm(t);
                            return nT.includes(nName) || nName.includes(nT);
                        });

                        if (betterName) name = betterName;
                    }
                    teamsSet.set(id, name);
                }
            });

            availableTeams = Array.from(teamsSet.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

            const populate = (sel) => {
                sel.innerHTML = '<option value="">-- Team wählen --</option>';
                availableTeams.forEach(t => {
                    sel.innerHTML += `<option value="${t.id}">${t.name}</option>`;
                });
            };
            populate(teamASelect);
            populate(teamBSelect);
            teamSelection.style.display = "block";
        });

        const fetchPlayers = (teamId, league) => {
            const targetNorm = normalize(league);

            return rankingData.players
                .filter(p => {
                    const pNorm = normalize(p.league || "");
                    const leagueMatch = pNorm === targetNorm || pNorm.includes(targetNorm) || targetNorm.includes(pNorm);
                    if (!leagueMatch) return false;

                    if (teamId.startsWith("NAME:")) {
                        return p.company === teamId.substring(5);
                    } else {
                        return String(p.v_nr) === String(teamId);
                    }
                })
                .map(p => {
                    const stats = calculatePlayerStats(p);
                    return { ...p, _avg: stats.avg, _cnt: stats.count };
                })
                .sort((a, b) => {
                    if (b._cnt !== a._cnt) return b._cnt - a._cnt;
                    return b._avg - a._avg;
                });
        };

        const renderPlayerList = (players, containerId, selectedSet, headerText) => {
            const el = document.getElementById(containerId);
            let html = `<h4 style="color: #94a3b8; margin-bottom: 10px; border-bottom: 1px solid #334155; padding-bottom: 5px;">${headerText} <span id="count-${containerId}" style="float: right; font-size: 0.8em; color: #60a5fa">${selectedSet.size} gewählt</span></h4>`;

            html += `<div style="max-height: 400px; overflow-y: auto; padding-right: 5px;">`;
            if (players.length === 0) {
                html += `<div style="color: #ef4444;">Keine Spieler gefunden</div>`;
            } else {
                players.forEach((p, idx) => {
                    // Check strict object equality for initial state, or by name/v_nr
                    // Better to use a simpler unique check.
                    const isChecked = Array.from(selectedSet).some(sel => sel === p) ? 'checked' : '';

                    const color = p._avg > 0 ? '#f8fafc' : '#64748b';
                    html += `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid #1e293b; font-size: 0.9em;">
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1;">
                            <input type="checkbox" value="${idx}" data-list="${containerId}" ${isChecked} style="transform: scale(1.2);">
                            <span style="color: ${color};" class="${p.name === myPlayerName ? 'my-player-text' : ''}">${p.name}</span>
                        </label>
                        <div style="text-align: right;">
                             <div style="font-weight: bold; color: #4ade80;">${p._avg.toFixed(2)}</div>
                             <div style="font-size: 0.7em; color: #64748b;">${p._cnt} Sp.</div>
                        </div>
                    </div>`;
                });
            }
            html += `</div>`;
            el.innerHTML = html;

            // Disable logic helper
            const updateDisabledState = () => {
                const limitReached = selectedSet.size >= 4;
                const inputs = el.querySelectorAll('input[type="checkbox"]');
                inputs.forEach(input => {
                    if (!input.checked) {
                        input.disabled = limitReached;
                        input.parentElement.style.opacity = limitReached ? "0.5" : "1";
                        input.parentElement.style.cursor = limitReached ? "not-allowed" : "pointer";
                    } else {
                        input.disabled = false;
                        input.parentElement.style.opacity = "1";
                        input.parentElement.style.cursor = "pointer";
                    }
                });
            };

            const checks = el.querySelectorAll('input[type="checkbox"]');
            checks.forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.value);
                    const p = players[idx];

                    if (e.target.checked) {
                        if (selectedSet.size >= 4) {
                            e.preventDefault();
                            e.target.checked = false;
                            return;
                        }
                        selectedSet.add(p);
                    } else {
                        selectedSet.delete(p);
                    }
                    updateCounts();
                    updateDisabledState();
                });
            });
            updateDisabledState(); // Initial run
        };

        const updateCounts = () => {
            const update = (id, set) => {
                const el = document.getElementById(`count-${id}`);
                if (el) el.textContent = `${set.size} gewählt`;
            };
            update('list-a', selectedA);
            update('list-b', selectedB);
        };

        const loadSelection = () => {
            const league = leagueSelect.value;
            const idA = teamASelect.value;
            const idB = teamBSelect.value;

            if (idA && idB && idA !== idB) {
                playersA = fetchPlayers(idA, league);
                playersB = fetchPlayers(idB, league);

                selectedA = new Set(playersA.filter(p => p._cnt >= 1).slice(0, 4));
                selectedB = new Set(playersB.filter(p => p._cnt >= 1).slice(0, 4));

                const nameA = availableTeams.find(t => t.id === idA)?.name || "Heim";
                const nameB = availableTeams.find(t => t.id === idB)?.name || "Gast";

                renderPlayerList(playersA, 'list-a', selectedA, nameA);
                renderPlayerList(playersB, 'list-b', selectedB, nameB);

                selectionArea.style.display = "block";
                resultDiv.innerHTML = "";
            } else {
                selectionArea.style.display = "none";
            }
        };

        const updateExclusions = () => {
            const valA = teamASelect.value;
            const valB = teamBSelect.value;

            Array.from(teamASelect.options).forEach(opt => {
                if (opt.value) opt.disabled = (opt.value === valB);
            });
            Array.from(teamBSelect.options).forEach(opt => {
                if (opt.value) opt.disabled = (opt.value === valA);
            });
        };

        teamASelect.addEventListener('change', () => {
            updateExclusions();
            loadSelection();
        });
        teamBSelect.addEventListener('change', () => {
            updateExclusions();
            loadSelection();
        });

        calcBtn.addEventListener('click', () => {
            const listA = Array.from(selectedA);
            const listB = Array.from(selectedB);

            const avgScore = (list) => {
                if (list.length === 0) return 0;
                const sum = list.reduce((acc, p) => acc + p._avg, 0);
                return sum / 4;
            };

            const strengthA = avgScore(listA);
            const strengthB = avgScore(listB);

            const total = strengthA + strengthB;
            const probA = total > 0 ? (strengthA / total) * 100 : 50;
            const probB = 100 - probA;

            const nameA = availableTeams.find(t => t.id === teamASelect.value)?.name || "Team A";
            const nameB = availableTeams.find(t => t.id === teamBSelect.value)?.name || "Team B";

            let html = `
             <div class="fade-in" style="margin-top: 30px; border-top: 1px solid #334155; padding-top: 30px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                    <div style="text-align: center; flex: 1;">
                        <div style="font-size: 1.2em; font-weight: bold; color: #f8fafc;">${nameA}</div>
                        <div style="font-size: 2.5em; font-weight: bold; color: #4ade80; text-shadow: 0 0 20px rgba(74, 222, 128, 0.2);">${strengthA.toFixed(1)}</div>
                        <div style="font-size: 0.8em; color: #94a3b8;">Team-Score</div>
                    </div>
                    <div style="font-weight: bold; color: #64748b; font-size: 1.5em; opacity: 0.5;">VS</div>
                    <div style="text-align: center; flex: 1;">
                        <div style="font-size: 1.2em; font-weight: bold; color: #f8fafc;">${nameB}</div>
                        <div style="font-size: 2.5em; font-weight: bold; color: #60a5fa; text-shadow: 0 0 20px rgba(96, 165, 250, 0.2);">${strengthB.toFixed(1)}</div>
                         <div style="font-size: 0.8em; color: #94a3b8;">Team-Score</div>
                    </div>
                </div>

                <div style="margin-bottom: 30px; background: #0f172a; padding: 15px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; color: #94a3b8; font-size: 0.9em; text-transform: uppercase; letter-spacing: 1px;">
                        <span>Wahrscheinlichkeit</span>
                    </div>
                    <div style="height: 16px; background: #1e293b; border-radius: 8px; overflow: hidden; display: flex;">
                        <div style="width: ${probA}%; background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%); transition: width 1s ease;"></div>
                        <div style="width: ${probB}%; background: linear-gradient(90deg, #60a5fa 0%, #3b82f6 100%); transition: width 1s ease;"></div>
                    </div>
                     <div style="display: flex; justify-content: space-between; margin-top: 8px; font-weight: bold; font-family: monospace; font-size: 1.2em;">
                        <span style="color: #4ade80;">${probA.toFixed(1)}%</span>
                        <span style="color: #60a5fa;">${probB.toFixed(1)}%</span>
                    </div>
                </div>
                
                <div style="text-align: center; font-size: 0.9em; color: #64748b;">
                    Durschnitt der gewählten Spieler (${listA.length} vs ${listB.length})
                </div>
             </div>
             `;
            resultDiv.innerHTML = html;
            resultDiv.scrollIntoView({ behavior: 'smooth' });
        });
    }


    // Expose triggerUpdate globally so the button onclick works
    window.triggerUpdate = function () {
        const btn = document.getElementById('update-btn');
        const status = document.getElementById('update-status');

        if (btn) btn.disabled = true;

        // Snapshot current stats before update
        try {
            const stats = calculateDataStats();
            localStorage.setItem('update_snapshot', JSON.stringify(stats));
        } catch (e) { console.error("Snapshot failed", e); }

        let pollInterval;

        if (status) {
            status.textContent = "Starten...";
            status.classList.remove('hidden');
            status.style.color = "#94a3b8"; // reset color

            // Poll for status
            pollInterval = setInterval(() => {
                fetch('update_status.json?t=' + Date.now())
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.status) {
                            if (data.status === 'running') {
                                status.textContent = `Update läuft...${data.progress} % `;
                            } else if (data.status === 'error') {
                                status.textContent = `Fehler bei: ${data.current_script}`;
                                status.style.color = "#f87171"; // red
                            }
                        }
                    })
                    .catch(() => { /* ignore poll errors (file might not exist yet) */ });
            }, 1000);
        }

        fetch('/api/update', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                if (pollInterval) clearInterval(pollInterval);

                if (data.status === 'success') {
                    if (status) {
                        status.textContent = "Erfolg! 100% - Seite wird neu geladen...";
                        status.style.color = "#4ade80"; // green
                    }
                    setTimeout(() => location.reload(), 1500);
                } else {
                    throw new Error(data.message || "Unknown error");
                }
            })
            .catch(e => {
                if (pollInterval) clearInterval(pollInterval);
                if (status) {
                    status.textContent = "Fehler: " + e.message;
                    status.style.color = "#f87171"; // red
                }
                if (btn) btn.disabled = false;
            });
    };


    function calculateDataStats() {
        let players = 0;
        if (typeof rankingData !== 'undefined' && rankingData.players) {
            players = rankingData.players.length;
        }

        let matchCounts = {};
        if (typeof leagueData !== 'undefined' && leagueData.leagues) {
            for (const [name, league] of Object.entries(leagueData.leagues)) {
                let count = 0;
                if (league.match_days) {
                    // Estimate distinct matches (lines > 10 chars)
                    count = Object.values(league.match_days).join('\n').split('\n').filter(line => line.trim().length > 10).length;
                }
                matchCounts[name] = count;
            }
        }

        return { players, matchCounts, timestamp: Date.now() };
    }

    function checkUpdateSnapshot() {
        const snapshot = localStorage.getItem('update_snapshot');
        if (snapshot) {
            try {
                const prev = JSON.parse(snapshot);
                // Verify it's recent (< 5 min)
                if (Date.now() - prev.timestamp < 300000) {
                    const current = calculateDataStats();
                    const diffPlayers = current.players - prev.players;

                    const changes = [];
                    if (diffPlayers > 0) changes.push(`${diffPlayers} neue Spieler`);
                    if (diffPlayers < 0) changes.push(`${Math.abs(diffPlayers)} Spieler entfernt`);

                    // Diff Leagues
                    let changedLeagues = [];
                    for (const [league, count] of Object.entries(current.matchCounts)) {
                        const prevCount = prev.matchCounts[league] || 0;
                        const diff = count - prevCount;
                        if (diff > 0) {
                            changedLeagues.push(league);
                        }
                    }

                    if (changedLeagues.length > 0) {
                        if (changedLeagues.length <= 2) {
                            changes.push(`Neue Ergebnisse in ${changedLeagues.join(' und ')}`);
                        } else {
                            changes.push(`Neue Ergebnisse in ${changedLeagues.length} Ligen`);
                        }
                    }

                    if (changes.length === 0) changes.push("Keine Änderungen gefunden");

                    const statusEl = document.getElementById('update-status');
                    if (statusEl) {
                        // Show message
                        const msg = "Update erfolgreich!";
                        statusEl.innerHTML = `<strong>${msg}</strong><br><span style="font-size:0.9em">${changes.join(', ')}</span>`;
                        statusEl.classList.remove('hidden');
                        statusEl.style.color = "#4ade80";

                        // Keep it visible for 15 seconds so user sees it
                        setTimeout(() => statusEl.classList.add('hidden'), 15000);
                    }
                }
                localStorage.removeItem('update_snapshot');
            } catch (e) { console.error(e); localStorage.removeItem('update_snapshot'); }
        }
    }

    // Initialize
    // Init called via logic at top
    // init();
});

// Global check to hide update button on production environments
document.addEventListener('DOMContentLoaded', () => {
    // Styling for Last Updated
    const style = document.createElement('style');
    style.innerHTML = `
        #last-updated {
            margin-top: 10px;
            font-size: 0.85em;
            color: #64748b;
            text-align: center;
            width: 100%;
            display: block;
        }
    `;
    document.head.appendChild(style);

    // Hide update button on production
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        const prodStyle = document.createElement('style');
        prodStyle.innerHTML = '#update-btn { display: none !important; } #last-updated { margin-bottom: 20px !important; color: #94a3b8 !important; }';
        document.head.appendChild(prodStyle);
    }
});