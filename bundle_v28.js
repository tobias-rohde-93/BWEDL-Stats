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
        compareLink.innerHTML = '🆚 H2H VERGLEICH';
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

        // 7. Wiki / Help (New)
        const wikiLink = document.createElement('div');
        wikiLink.className = 'nav-section-header';
        wikiLink.innerHTML = '📘 ANLEITUNG / WIKI';
        wikiLink.style.padding = "10px 15px 5px";
        wikiLink.style.color = "#888";
        wikiLink.style.fontSize = "0.8em";
        wikiLink.style.fontWeight = "bold";
        wikiLink.style.cursor = "pointer";
        wikiLink.onclick = () => navigateTo('wiki');
        nav.appendChild(wikiLink);

        // Show Favorites
        renderFavoritesSidebar();

        // VERSION FOOTER

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
        // Format example: "28.11.2025 20:00"
        // Try to match standard date with optional time
        /* 
           Regex Analysis:
           (\d{1,2})\.     -> Day (Group 1)
           \s*(\d{1,2})\.  -> Month (Group 2)
           \s*(\d{2,4})    -> Year (Group 3)
           .*?             -> Match anything in between (like spaces)
           (\d{1,2}:\d{2})? -> Optional Time (Group 4)
        */
        const match = dateStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})(?:\s+(\d{1,2}:\d{2}))?/);
        if (match) {
            let year = match[3];
            if (year.length === 2) year = "20" + year; // Handle 2-digit year

            let timeStr = match[4] || "00:00"; // Default to midnight if no time found
            let [hours, minutes] = timeStr.split(':').map(Number);

            // Construct Date object
            // Note: Date(y, m, d, h, m) constructor uses local time.
            // Month is 0-indexed in JS Date constructor (0=Jan, 11=Dec)
            return new Date(year, parseInt(match[2]) - 1, parseInt(match[1]), hours, minutes);
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

        let myStats = null;
        // --- My Profile Section ---
        if (myPlayerName) {
            // myStats is now outer scope
            let myLeagueKey = null;
            let mySchedule = [];
            let myTrend = null;
            let searchTeam = null;

            if (typeof rankingData !== 'undefined' && rankingData.players) {
                const p = rankingData.players.find(p => p.name === myPlayerName);
                if (p) {
                    const stats = calculatePlayerStats(p);
                    myStats = { ...p, ...stats };
                    // FIXED: Use myStats (with calculated avg) instead of p (raw) for correct trend diff
                    myTrend = calculateTrend(myStats);

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

                // --- Helper to get Global Team Rank (Class-wide) ---
                let teamRank = null;
                let totalTeamsInClass = 0;

                if (myLeagueKey && leagueData.leagues && searchTeam) {
                    // 1. Identify "Class" (e.g., "District League", "B-Klasse")
                    // Assumption: League Key format is "B-Klasse Gruppe 3 - 2024/25" or similar.
                    // We split by "Gruppe" or just take the first part.
                    const leagueNameParts = myLeagueKey.split("Gruppe");
                    const leagueClass = leagueNameParts[0].trim(); // e.g. "B-Klasse"

                    // 2. Find all leagues matching this class
                    const matchingLeagues = Object.keys(leagueData.leagues).filter(k => k.startsWith(leagueClass));

                    // 3. Aggregate all teams
                    let allTeams = [];
                    const normMyTeam = normalizeTeamName(searchTeam);

                    matchingLeagues.forEach(lKey => {
                        const lData = leagueData.leagues[lKey];
                        if (lData && lData.table) {
                            const temp = document.createElement('div');
                            temp.innerHTML = lData.table;
                            const rows = temp.querySelectorAll('tr');

                            rows.forEach(row => {
                                const cells = row.querySelectorAll('td');
                                if (cells.length > 8) {
                                    // Extract Data
                                    // FIXED: Table usually has 10 columns (0-9).
                                    // Index 8 = Points. Index 7 = Diff. Index 2 = Games.
                                    // Last column (Index 9) is for penalties/notes (e.g. "(-1)" or "&nbsp;").

                                    const teamName = cells[1].textContent.trim();

                                    // Robust parsing
                                    const pointsText = cells[8].textContent.replace(/&nbsp;/g, '').trim();
                                    const points = parseInt(pointsText) || 0;

                                    const diffText = cells[7].textContent.replace(/&nbsp;/g, '').trim();
                                    const diff = parseInt(diffText) || 0;

                                    allTeams.push({
                                        name: teamName,
                                        normName: normalizeTeamName(teamName),
                                        points: points,
                                        diff: diff,
                                        league: lKey
                                    });
                                }
                            });
                        }
                    });

                    // 4. Sort Global List
                    // Points DESC, then Diff DESC
                    allTeams.sort((a, b) => {
                        if (b.points !== a.points) return b.points - a.points;
                        return b.diff - a.diff;
                    });

                    totalTeamsInClass = allTeams.length;

                    // 5. Find My Rank
                    const myTeamIdx = allTeams.findIndex(t => t.normName === normMyTeam);
                    if (myTeamIdx !== -1) {
                        teamRank = myTeamIdx + 1;
                    }
                }

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
                // const trendText = myTrend ? `${trendIcon} ${myTrend.diff} (L3: ${myTrend.last3Avg})` : '';

                heroCard.innerHTML = `
                    <div style="position: relative; z-index: 2;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                            <div>
                                <div style="color: #60a5fa; font-weight: bold; letter-spacing: 1px; font-size: 0.8em; text-transform: uppercase; margin-bottom: 5px;">Dein Profil</div>
                                <h1 style="margin: 0; font-size: 2.2em; color: white;">${myStats.name}</h1>
                                <div style="color: #94a3b8; font-size: 1.1em; margin-top: 5px;">
                                    ${myLeagueKey ? myLeagueKey.split('202')[0] : (myStats.league || "Liga n/a")} | ${searchTeam || "Vereinslos"}
                                    ${teamRank ? `<span style="color: #fbbf24; margin-left: 10px; font-weight: bold; white-space: nowrap;">(Team-Platz: ${teamRank} <span style="font-size:0.7em; font-weight:normal; color:#64748b;">/ ${totalTeamsInClass}</span>)</span>` : ''}
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="background: #3b82f6; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; font-size: 0.9em; display: inline-block; white-space: nowrap;">
                                    Rang ${myStats.rank}
                                </div>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                                <div style="color: #94a3b8; font-size: 0.8em; margin-bottom: 5px;">Ø PUNKTE</div>
                                <div style="font-size: 2em; font-weight: bold; color: white; display: flex; align-items: center; gap: 10px;">
                                    ${myStats.avg.toFixed(2)}
                                    ${myTrend ? `
                                    <div style="display: flex; flex-direction: column; justify-content: center; font-size: 0.4em; color: ${trendColor}; font-weight: normal; line-height: 1.2;">
                                        <div style="white-space: nowrap;">Trend: ${trendIcon} ${myTrend.diff}</div>
                                        <div style="white-space: nowrap; opacity: 0.8;">Form: ${myTrend.last3Avg}</div>
                                    </div>` : ''}
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

                // --- 2. STATS & FORM CARD ---
                const statsCard = document.createElement('div');
                statsCard.style.background = "#1e293b";
                statsCard.style.padding = "20px";
                statsCard.style.borderRadius = "12px";
                statsCard.style.border = "1px solid #334155";
                statsCard.style.display = "flex";
                statsCard.style.flexDirection = "column";
                statsCard.style.gap = "20px";

                // --- A) League Benchmark ---
                if (myLeagueKey && rankingData.players) {
                    // Filter players in same league
                    const leaguePlayers = rankingData.players.filter(p => p.league === myStats.league);
                    if (leaguePlayers.length > 0) {
                        // Calculate Avg
                        const totalAvg = leaguePlayers.reduce((acc, p) => {
                            const s = calculatePlayerStats(p);
                            return acc + s.avg;
                        }, 0);
                        const leagueAvg = totalAvg / leaguePlayers.length;

                        // Find Best
                        const bestPlayer = leaguePlayers.reduce((max, p) => {
                            const s = calculatePlayerStats(p);
                            return s.avg > max.avg ? s : max;
                        }, { avg: 0 });

                        // My position % (max is slightly above best to give space)
                        const maxScale = Math.max(bestPlayer.avg * 1.1, 10); // Min 10 pts scale
                        const myPercent = (myStats.avg / maxScale) * 100;
                        const avgPercent = (leagueAvg / maxScale) * 100;

                        statsCard.innerHTML += `
                            <div>
                                <div style="display:flex; justify-content:space-between; margin-bottom: 10px;">
                                    <h3 style="color: #94a3b8; font-size: 0.8em; text-transform: uppercase;">⚖️ Liga-Vergleich (Ø Punkte)</h3>
                                    <div style="color: #fbbf24; font-size: 0.7em;">🏆 Top: ${bestPlayer.avg.toFixed(1)}</div>
                                </div>
                                <div style="position: relative; height: 30px; background: #0f172a; border-radius: 15px; margin-top: 15px;">
                                    
                                    <!-- League Avg Marker -->
                                    <div style="position: absolute; left: ${avgPercent}%; top: -5px; bottom: -5px; width: 2px; background: #64748b; z-index: 1;"></div>
                                    <div style="position: absolute; left: ${avgPercent}%; top: -25px; transform: translateX(-50%); color: #64748b; font-size: 0.7em;">Ø ${leagueAvg.toFixed(1)}</div>
                                    
                                    <!-- My Bar -->
                                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${myPercent}%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 15px; z-index: 2;"></div>
                                    <div style="position: absolute; left: ${myPercent}%; top: 5px; transform: translateX(-50%); color: white; font-weight: bold; font-size: 0.8em; text-shadow: 0 1px 2px black; z-index: 3;">${myStats.avg.toFixed(1)}</div>
                                </div>
                            </div>
                        `;
                    }
                }

                // --- B) Form Curve (Spikes) ---
                if (myStats.rounds) {
                    const roundsData = [];
                    for (let i = 1; i <= 18; i++) {
                        const val = myStats.rounds[`R${i}`];
                        if (val && val !== "x" && val !== "&nbsp;" && val !== "-" && !isNaN(parseInt(val))) {
                            roundsData.push({ r: i, p: parseInt(val) });
                        }
                    }

                    if (roundsData.length > 0) {
                        // Take last 8 played rounds for display
                        const recentRounds = roundsData.slice(-8);
                        const maxPoints = Math.max(...recentRounds.map(d => d.p), 10);

                        let barsHtml = recentRounds.map(d => {
                            const h = (d.p / maxPoints) * 100;
                            const color = d.p >= myStats.avg ? '#4ade80' : '#f87171';

                            // Spike Visual
                            return `
                                <div style="display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end;">
                                    <div style="position: relative; width: 2px; height: ${h}%; background: ${color}; display: flex; justify-content: center;">
                                        <!-- Dot -->
                                        <div style="position: absolute; top: 0; width: 8px; height: 8px; background: ${color}; border-radius: 50%; transform: translateY(-50%);"></div>
                                        <!-- Label -->
                                        <div style="position: absolute; top: -20px; color: white; font-size: 0.7em; font-weight: bold;">${d.p}</div>
                                    </div>
                                    <div style="color: #64748b; font-size: 0.7em; margin-top: 8px;">R${d.r}</div>
                                </div>
                            `;
                        }).join('');

                        statsCard.innerHTML += `
                            <div style="border-top: 1px solid #334155; padding-top: 15px;">
                                <h3 style="color: #94a3b8; font-size: 0.8em; text-transform: uppercase; margin-bottom: 25px;">📈 Formkurve</h3>
                                <div style="display: flex; height: 100px; align-items: flex-end; gap: 10px; padding-top: 20px;">
                                    ${barsHtml}
                                </div>
                            </div>
                        `;
                    }
                }

                grid.appendChild(statsCard);

                // --- 2. Action / Next Game Card ---
                const actionCard = document.createElement('div');
                actionCard.style.display = "flex";
                actionCard.style.flexDirection = "column";
                actionCard.style.gap = "20px";

                // Find Next Game (Future only)
                const now = new Date();
                // We want the first pending game that is in the future
                // If date is missing, treat as future? Or ignore?
                const nextGame = mySchedule.filter(g => g.isPending && (!g.date || g.date >= now))
                    .sort((a, b) => (a.date || 0) - (b.date || 0))[0];

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

        // --- TOP 20 PLAYERS (Latest Matchday) ---
        const topPlayersSection = document.createElement('div');
        topPlayersSection.style.marginTop = "40px";

        // 1. Determine Latest Active Round
        let latestRound = 0;
        if (rankingData && rankingData.players) {
            for (let i = 1; i <= 18; i++) {
                const hasData = rankingData.players.some(p => {
                    const val = p.rounds[`R${i}`];
                    return val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val));
                });
                if (hasData) latestRound = i;
            }
        }

        // 2. Helper to get Top 20 for a specific league
        const getTopPlayers = (leagueName) => {
            if (!rankingData || !rankingData.players) return [];
            return rankingData.players
                .filter(p => p.league && p.league.includes(leagueName))
                .map(p => {
                    const val = p.rounds[`R${latestRound}`];
                    const score = (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) ? parseInt(val) : 0;
                    return { ...p, currentScore: score };
                })
                .filter(p => p.currentScore > 0)
                .sort((a, b) => b.currentScore - a.currentScore)
                .slice(0, 20);
        };

        // 3. UI Construction
        const topTitle = `<h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:center;">
                            <span>🏆 Spieltags-Sieger (Top 20)</span>
                            <span style="font-size:0.6em; color:#94a3b8; background:#1e293b; padding:2px 8px; border-radius:4px;">Spieltag ${latestRound}</span>
                          </h2>`;

        // Tabs
        const leagues = ["Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse"];
        // Default to user's league or first one
        let activeTab = leagues[0];
        if (myStats && myStats.league) {
            const match = leagues.find(l => myStats.league.includes(l));
            if (match) activeTab = match;
        }

        const renderTopList = (league) => {
            const list = getTopPlayers(league);
            if (list.length === 0) return `<div style="text-align:center; padding:20px; color:#94a3b8;">Keine Daten für Spieltag ${latestRound}</div>`;

            return `
            <div style="background: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; color: #e2e8f0; font-size: 0.9em;">
                    <thead>
                        <tr style="background: #0f172a; text-align: left; color: #94a3b8; font-size: 0.8em; text-transform: uppercase;">
                            <th style="padding: 10px 15px; width: 40px;">#</th>
                            <th style="padding: 10px 15px;">Name</th>
                            <th style="padding: 10px 15px;">Verein</th>
                            <th style="padding: 10px 15px; text-align: right;">Punkte</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(() => {
                    let lastScore = -1;
                    let lastRank = 0;

                    return list.map((p, idx) => {
                        const isMyPlayer = p.name === myPlayerName;
                        const rowBg = isMyPlayer ? 'rgba(59, 130, 246, 0.1)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)');

                        // Rank Logic
                        let displayRank = idx + 1;
                        if (p.currentScore === lastScore) {
                            displayRank = lastRank;
                        } else {
                            lastScore = p.currentScore;
                            lastRank = displayRank;
                        }

                        const rankColor = displayRank <= 3 ? '#fbbf24' : '#94a3b8';
                        const scoreColor = displayRank <= 3 ? '#4ade80' : '#f8fafc';

                        // Find full club name
                        let clubName = p.company || "-";
                        if (typeof clubData !== 'undefined' && clubData.clubs) {
                            const c = clubData.clubs.find(cl => cl.number == p.v_nr);
                            if (c) clubName = c.name;
                        }

                        return `
                                <tr style="background: ${rowBg}; border-bottom: 1px solid #334155;">
                                    <td style="padding: 10px 15px; font-weight: bold; color: ${rankColor};">${displayRank}.</td>
                                    <td style="padding: 10px 15px; font-weight: 600; color: ${isMyPlayer ? '#60a5fa' : '#f8fafc'};">${p.name}</td>
                                    <td style="padding: 10px 15px; color: #94a3b8; font-size: 0.9em;">${clubName}</td>
                                    <td style="padding: 10px 15px; text-align: right; font-weight: bold; color: ${scoreColor}; font-size: 1.1em;">${p.currentScore}</td>
                                </tr>
                                `;
                    }).join('');
                })()}
                    </tbody>
                </table>
            </div>`;
        };

        const containerDiv = document.createElement('div');
        containerDiv.innerHTML = topTitle;

        // Tab Container
        const tabContainer = document.createElement('div');
        tabContainer.style.display = "flex";
        tabContainer.style.gap = "10px";
        tabContainer.style.marginBottom = "15px";
        tabContainer.style.overflowX = "auto";
        tabContainer.style.paddingBottom = "5px";

        const contentDiv = document.createElement('div');

        leagues.forEach(l => {
            const btn = document.createElement('button');
            btn.textContent = l;
            btn.style.padding = "8px 16px";
            btn.style.borderRadius = "20px";
            btn.style.border = "1px solid #334155";
            btn.style.background = (l === activeTab) ? "#3b82f6" : "#1e293b";
            btn.style.color = (l === activeTab) ? "white" : "#94a3b8";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "bold";
            btn.style.fontSize = "0.9em";
            btn.style.whiteSpace = "nowrap";

            btn.onclick = () => {
                // Reset all
                Array.from(tabContainer.children).forEach(b => {
                    b.style.background = "#1e293b";
                    b.style.color = "#94a3b8";
                });
                // Set active
                btn.style.background = "#3b82f6";
                btn.style.color = "white";
                activeTab = l;
                contentDiv.innerHTML = "Lade...";
                setTimeout(() => {
                    contentDiv.innerHTML = renderTopList(l); // Render content
                }, 10);
            };
            tabContainer.appendChild(btn);
        });

        // Initial Render
        contentDiv.innerHTML = renderTopList(activeTab);

        topPlayersSection.appendChild(containerDiv);
        topPlayersSection.appendChild(tabContainer);
        topPlayersSection.appendChild(contentDiv);
        container.appendChild(topPlayersSection);

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
        else if (type === 'wiki') renderWiki();

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
                if (d.current && d.current.id && archiveData && archiveData[d.current.id]) {
                    hist = archiveData[d.current.id];
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
                
                <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #334155;">
                   <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: #f8fafc; overflow: hidden; text-overflow: ellipsis;">${d1.searchItem.context || '-'}</div>
                   <div style="width: 10%; text-align: center; color: #64748b; font-size: 0.8em;">Team</div>
                   <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: #f8fafc; overflow: hidden; text-overflow: ellipsis;">${d2.searchItem.context || '-'}</div>
                </div>

                ${card(h1.length, h2.length, "Erfahrung", "Anzahl gespielter Saisons im Archiv", seasons1, seasons2)}

                ${(() => {
                    const getTitles = (hist) => hist.filter(s => s.rank === 1).length;
                    const t1 = getTitles(h1);
                    const t2 = getTitles(h2);
                    return card(t1, t2, "Titel (Platz 1)", "Meisterschaften im Archiv", t1 > 0 ? "🏆" : "", t2 > 0 ? "🏆" : "");
                })()}

                ${(() => {
                    const leagueOrder = { "Bezirksliga": 4, "A-Klasse": 3, "B-Klasse": 2, "C-Klasse": 1 };
                    const getHighestLeague = (hist) => {
                        if (!hist || hist.length === 0) return "-";
                        let best = { name: "-", val: 0 };
                        hist.forEach(s => {
                            let lName = s.league || "";
                            // Simple normalized matching
                            let val = 0;
                            if (lName.includes("Bezirksliga")) val = 4;
                            else if (lName.includes("A-Klasse")) val = 3;
                            else if (lName.includes("B-Klasse")) val = 2;
                            else if (lName.includes("C-Klasse")) val = 1;

                            if (val > best.val) best = { name: lName, val: val };
                        });
                        return best.name;
                    };
                    const l1 = getHighestLeague(h1);
                    const l2 = getHighestLeague(h2);

                    // Custom Card for Text comparison
                    let c1 = '#94a3b8'; let c2 = '#94a3b8';
                    const getVal = (name) => {
                        if (name.includes("Bezirksliga")) return 4;
                        if (name.includes("A-Klasse")) return 3;
                        if (name.includes("B-Klasse")) return 2;
                        if (name.includes("C-Klasse")) return 1;
                        return 0;
                    }
                    const v1 = getVal(l1);
                    const v2 = getVal(l2);
                    if (v1 > v2) c1 = '#4ade80';
                    else if (v2 > v1) c2 = '#4ade80';

                    return `
                     <div style="display: flex; justify-content: space-between; align-items: start; padding: 15px; border-bottom: 1px solid #334155;">
                        <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: ${c1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${l1}</div>
                        <div style="flex: 1; text-align: center; padding: 0 5px;">
                            <div style="color: #cbd5e1; font-size: 0.9em; text-transform: uppercase;">Höchste Klasse</div>
                            <div style="color: #64748b; font-size: 0.75em; margin-top: 2px;">Bisher gespielt</div>
                        </div>
                        <div style="width: 45%; text-align: center; font-size: 0.9em; font-weight: bold; color: ${c2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${l2}</div>
                      </div>`;
                })()}



                ${card(best1Stats.points, best2Stats.points, "Meiste Punkte", "Rekord in einer Saison (Archiv)", best1Stats.season, best2Stats.season)}
                ${card(bestRank1.rank === 999 ? '-' : bestRank1.rank + '.', bestRank2.rank === 999 ? '-' : bestRank2.rank + '.', "Beste Platzierung", "Bester Liga-Rang (Archiv)", bestRank1.season, bestRank2.season, false, true)}

                ${(() => {
                    // --- PREDICTION ALGORITHM ---
                    const getRecentForm = (p) => {
                        if (!p || !p.rounds) return 0;
                        let sum = 0;
                        let count = 0;
                        // Iterate backwards from R18 to R1
                        for (let i = 18; i >= 1; i--) {
                            const val = p.rounds[`R${i}`];
                            if (val && val !== "&nbsp;" && val !== "x" && !isNaN(parseInt(val))) {
                                sum += parseInt(val);
                                count++;
                                if (count >= 5) break; // Last 5 matches
                            }
                        }
                        return count > 0 ? sum / count : 0;
                    };

                    const form1 = getRecentForm(d1.current); // Avg of last 5 stats
                    const form2 = getRecentForm(d2.current);

                    // Normalize Inputs
                    // - Average: 40-70 range
                    // - Form: 40-70 range
                    // - Exp: 0-10 range

                    const safeDiv = (a, b) => (a + b === 0) ? 0.5 : (a / (a + b));

                    const pAvg = safeDiv(avg1, avg2) * 0.4; // 40% Weight for Season Avg
                    const pForm = safeDiv(form1, form2) * 0.5; // 50% Weight for Recent Form (Current Strength)
                    const pExp = safeDiv(h1.length, h2.length) * 0.1; // 10% Weight for Experience

                    let winProb1 = pAvg + pForm + pExp;

                    // Calibration: If data is missing (e.g. no form), fallback to 50/50
                    if (avg1 === 0 && avg2 === 0) winProb1 = 0.5;
                    else if (avg1 === 0) winProb1 = 0.2; // Penalize no data
                    else if (avg2 === 0) winProb1 = 0.8;

                    let winProb2 = 1 - winProb1;

                    // Clamping (never 100% or 0%)
                    if (winProb1 > 0.95) winProb1 = 0.95;
                    if (winProb1 < 0.05) winProb1 = 0.05;
                    winProb2 = 1 - winProb1;

                    const percent1 = Math.round(winProb1 * 100);
                    const percent2 = Math.round(winProb2 * 100);

                    // Text Prediction
                    let predictionText = "Ausgeglichenes Match";
                    let winnerName = "";
                    if (winProb1 > 0.6) { winnerName = d1.name; predictionText = `Vorteil für <strong>${d1.name}</strong>`; }
                    else if (winProb2 > 0.6) { winnerName = d2.name; predictionText = `Vorteil für <strong>${d2.name}</strong>`; }
                    else {
                        if (winProb1 >= 0.5) predictionText = "Knappes Ding (Leichter Vorteil Links)";
                        else predictionText = "Knappes Ding (Leichter Vorteil Rechts)";
                    }

                    return `
                     <div style="padding: 15px; margin-top: 20px; border-top: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.9em; text-transform: uppercase; color: #94a3b8; margin-bottom: 10px; letter-spacing: 1px;">Match Prediction 🔮</div>
                        
                        <div style="font-size: 1.1em; color: white; margin-bottom: 15px;">${predictionText}</div>

                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                            <div style="font-weight: bold; color: ${winProb1 > 0.5 ? '#4ade80' : '#94a3b8'};">${percent1}%</div>
                            <div style="font-weight: bold; color: ${winProb2 > 0.5 ? '#4ade80' : '#94a3b8'};">${percent2}%</div>
                        </div>

                        <div style="height: 12px; background: #334155; border-radius: 6px; overflow: hidden; display: flex;">
                             <div style="width: ${percent1}%; background: ${winProb1 > 0.5 ? '#3b82f6' : '#64748b'}; transition: width 1s ease-out;"></div>
                             <div style="width: ${percent2}%; background: ${winProb2 > 0.5 ? '#3b82f6' : '#64748b'}; transition: width 1s ease-out;"></div>
                        </div>
                        <div style="font-size: 0.7em; color: #64748b; margin-top: 8px;">
                            Basiert auf: Ø Saison (40%), Form (Last 5) (50%), Erfahrung (10%)
                        </div>
                     </div>
                    `;
                })()}
             </div>
             <div style="margin-top: 20px; text-align: center; padding: 10px; background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; border-radius: 6px; color: #60a5fa; font-size: 0.9em;">
                ℹ️ <strong>Erklärung:</strong><br>
                Daten basieren auf der aktuellen Saison und der verknüpften Historie.
                <br><em>Fehlende Daten können an Namen-/Vereinswechseln liegen.</em>
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
        container.style.maxWidth = "900px";
        container.style.margin = "0 auto";

        // --- Empty State ---
        if (!archiveData || Object.keys(archiveData).length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; color: #94a3b8;">
                <h2>📭 Keine Archiv-Daten</h2>
                <p>Es wurden noch keine historischen Daten geladen.</p>
                </div>`;
            contentArea.appendChild(container);
            return;
        }

        // --- Liga-Tier Color Helper ---
        const leagueTierColor = (league) => {
            if (!league) return '#64748b';
            const l = league.toLowerCase();
            if (l.includes('bezirksoberliga')) return '#f59e0b';
            if (l.includes('bezirksliga')) return '#fbbf24';
            if (l.includes('a-klasse') || l.includes('a klasse')) return '#94a3b8';
            if (l.includes('b-klasse') || l.includes('b klasse')) return '#cd7f32';
            if (l.includes('c-klasse') || l.includes('c klasse')) return '#64748b';
            return '#64748b';
        };

        const leagueTierLabel = (league) => {
            if (!league) return '';
            const l = league.toLowerCase();
            if (l.includes('bezirksoberliga')) return 'BOL';
            if (l.includes('bezirksliga')) return 'BL';
            if (l.includes('a-klasse') || l.includes('a klasse')) return 'A';
            if (l.includes('b-klasse') || l.includes('b klasse')) return 'B';
            if (l.includes('c-klasse') || l.includes('c klasse')) return 'C';
            return '';
        };

        // --- Season sort helper (ascending) ---
        const seasonOrder = (s) => {
            const m = (s || '').match(/(\d{2})/);
            return m ? parseInt(m[1]) : 0;
        };

        // --- Aggregation ---
        const allPlayers = [];
        const allLeagues = new Set();
        const allSeasons = new Set();

        // Build a map of archive players by key for later merging
        const playerMap = new Map();

        Object.entries(archiveData).forEach(([playerKey, seasons]) => {
            const name = seasons[0].name || "Unbekannt";
            const id = playerKey;
            const playerLeagues = new Set();

            // Sort seasons for trend calculation
            const sorted = [...seasons].sort((a, b) => seasonOrder(a.season) - seasonOrder(b.season));

            sorted.forEach(s => {
                allSeasons.add(s.season);
                if (s.league) {
                    playerLeagues.add(s.league);
                    allLeagues.add(s.league);
                }
            });

            playerMap.set(id, {
                id, name, leagues: playerLeagues,
                seasons: sorted
            });
        });

        // --- Merge current season from rankingData ---
        // Determine current season label from ranking last_updated
        let currentSeasonLabel = 'Aktuell';
        if (rankingData && rankingData.last_updated) {
            const m = rankingData.last_updated.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (m) {
                const month = parseInt(m[2]);
                const year = parseInt(m[3]);
                // Season runs Aug-Jul: if month >= 8, season is year/(year+1), else (year-1)/year
                const startYear = month >= 8 ? year : year - 1;
                const endYear = startYear + 1;
                currentSeasonLabel = (startYear % 100).toString().padStart(2, '0') + '/' + (endYear % 100).toString().padStart(2, '0');
            }
        }

        if (rankingData && rankingData.players && rankingData.players.length > 0) {
            allSeasons.add(currentSeasonLabel);

            // Group ranking players by id (Nr.) — pick highest total if player appears in multiple leagues
            const bestByNr = new Map();
            rankingData.players.forEach(rp => {
                const nr = rp.id;
                const pts = parseInt(rp.points) || 0;
                if (!nr) return;
                const existing = bestByNr.get(nr);
                if (!existing || pts > (parseInt(existing.points) || 0)) {
                    bestByNr.set(nr, rp);
                }
            });

            bestByNr.forEach((rp, nr) => {
                const pts = parseInt(rp.points) || 0;
                const rank = parseInt(rp.rank) || 999;
                const league = rp.league || '';
                const seasonEntry = {
                    season: currentSeasonLabel,
                    rank: rank === 999 ? '-' : rank,
                    points: pts,
                    league: league,
                    name: rp.name,
                    isCurrent: true
                };

                if (playerMap.has(nr)) {
                    // Existing archive player — add current season
                    const p = playerMap.get(nr);
                    // Only add if not already present (avoid duplicates on re-render)
                    if (!p.seasons.some(s => s.season === currentSeasonLabel)) {
                        p.seasons.push(seasonEntry);
                    }
                    if (league) {
                        p.leagues.add(league);
                        allLeagues.add(league);
                    }
                } else {
                    // New player not in archive — create entry
                    const playerLeagues = new Set();
                    if (league) {
                        playerLeagues.add(league);
                        allLeagues.add(league);
                    }
                    playerMap.set(nr, {
                        id: nr,
                        name: rp.name || 'Unbekannt',
                        leagues: playerLeagues,
                        seasons: [seasonEntry]
                    });
                }
            });
        }

        // --- Finalize player stats ---
        playerMap.forEach((p) => {
            let totalPoints = 0;
            let totalSeasons = p.seasons.length;
            let bestSeasonRank = 999;
            let bestSeasonYearRank = '';
            let bestSeasonLeague = '';
            let maxPoints = 0;
            let maxPointsYear = '';
            let maxPointsLeague = '';

            p.seasons.forEach(s => {
                const pts = parseInt(s.points) || 0;
                totalPoints += pts;

                const r = parseInt(s.rank) || 999;
                if (r < bestSeasonRank) {
                    bestSeasonRank = r;
                    bestSeasonYearRank = s.season;
                    bestSeasonLeague = s.league || '';
                }
                if (pts > maxPoints) {
                    maxPoints = pts;
                    maxPointsYear = s.season;
                    maxPointsLeague = s.league || '';
                }
            });

            // Trend: compare last two seasons' points
            let trend = 'stable';
            if (p.seasons.length >= 2) {
                const last = parseInt(p.seasons[p.seasons.length - 1].points) || 0;
                const prev = parseInt(p.seasons[p.seasons.length - 2].points) || 0;
                if (last > prev + 5) trend = 'up';
                else if (last < prev - 5) trend = 'down';
            }

            const avgPoints = totalSeasons > 0 ? totalPoints / totalSeasons : 0;

            allPlayers.push({
                id: p.id, name: p.name, totalPoints, totalSeasons, avgPoints,
                bestSeasonRank, bestSeasonRankDisplay: (bestSeasonRank === 999 ? '-' : bestSeasonRank + '.'),
                bestSeasonYearRank, bestSeasonLeague,
                maxPoints, maxPointsYear, maxPointsLeague,
                trend, leagues: p.leagues,
                seasons: p.seasons
            });
        });

        // --- State ---
        let sortMode = 'totalPoints';
        let searchQuery = '';
        let pageSize = 50;
        let currentPage = 1;
        let expandedId = null;

        // --- Sort & Filter Logic ---
        const getFiltered = () => {
            let list = [...allPlayers];

            // Sort first to assign global ranks
            if (sortMode === 'totalPoints') list.sort((a, b) => b.totalPoints - a.totalPoints);
            else if (sortMode === 'avgPoints') list.sort((a, b) => b.avgPoints - a.avgPoints);
            else if (sortMode === 'bestRank') list.sort((a, b) => a.bestSeasonRank - b.bestSeasonRank);
            else if (sortMode === 'seasons') list.sort((a, b) => b.totalSeasons - a.totalSeasons || b.totalPoints - a.totalPoints);

            // Assign global rank before filtering
            list.forEach((p, idx) => { p.globalRank = idx + 1; });

            // Then filter by search (ranks stay from full list)
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                list = list.filter(p => p.name.toLowerCase().includes(q));
            }

            return list;
        };

        // --- Render Function ---
        const render = () => {
            container.innerHTML = '';

            const filtered = getFiltered();
            const shown = filtered.slice(0, currentPage * pageSize);
            const hasMore = shown.length < filtered.length;

            // --- Feature 6: Stats Header ---
            const totalPlayersCount = allPlayers.length;
            const activeSeasonCount = allSeasons.size;
            const veteranCount = allPlayers.filter(p => p.totalSeasons >= activeSeasonCount).length;

            let statsHtml = `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">`;
            const statCard = (icon, value, label) => `
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 1.6em; margin-bottom: 4px;">${icon}</div>
                    <div style="font-size: 1.4em; font-weight: bold; color: #f8fafc;">${value}</div>
                    <div style="font-size: 0.75em; color: #94a3b8; margin-top: 2px;">${label}</div>
                </div>`;
            statsHtml += statCard('👥', totalPlayersCount, 'Spieler gesamt');
            statsHtml += statCard('📅', activeSeasonCount, 'Saisons im Archiv');
            statsHtml += statCard('🎖️', veteranCount, `Veteranen (${activeSeasonCount}/${activeSeasonCount})`);
            statsHtml += `</div>`;
            container.insertAdjacentHTML('beforeend', statsHtml);

            // --- Feature 1: Controls (Sort, Filter, Search) ---
            const controlsDiv = document.createElement('div');
            controlsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; align-items: center;';

            // Search
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '🔍 Spieler suchen...';
            searchInput.value = searchQuery;
            searchInput.style.cssText = 'flex: 1; min-width: 160px; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f8fafc; font-size: 0.9em;';
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                currentPage = 1;
                render();
            });

            // Sort select
            const sortSelect = document.createElement('select');
            sortSelect.style.cssText = 'padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f8fafc; font-size: 0.85em; cursor: pointer;';
            const sortOptions = [
                { value: 'totalPoints', label: '⬇ Gesamtpunkte' },
                { value: 'avgPoints', label: '⬇ Ø Punkte/Saison' },
                { value: 'bestRank', label: '⬆ Beste Platzierung' },
                { value: 'seasons', label: '⬇ Meiste Saisons' }
            ];
            sortOptions.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                if (o.value === sortMode) opt.selected = true;
                sortSelect.appendChild(opt);
            });
            sortSelect.addEventListener('change', (e) => {
                sortMode = e.target.value;
                currentPage = 1;
                render();
            });

            controlsDiv.appendChild(searchInput);
            controlsDiv.appendChild(sortSelect);
            container.appendChild(controlsDiv);

            // --- Result count ---
            const countDiv = document.createElement('div');
            countDiv.style.cssText = 'color: #64748b; font-size: 0.8em; margin-bottom: 10px;';
            countDiv.textContent = `${filtered.length} Spieler${searchQuery ? ` für "${searchQuery}"` : ''}`;
            container.appendChild(countDiv);

            // --- Table ---
            const tableDiv = document.createElement('div');
            tableDiv.style.cssText = 'background: #1e293b; border-radius: 8px; overflow: hidden; border: 1px solid #334155;';

            // Header
            let headerHtml = `<div style="display: flex; padding: 10px 12px; background: #0f172a; color: #94a3b8; font-size: 0.75em; font-weight: bold; border-bottom: 1px solid #334155; text-transform: uppercase; letter-spacing: 0.5px;">
                <div style="width: 36px; text-align: center;">#</div>
                <div style="flex: 1; padding-left: 8px;">Name</div>
                <div style="width: 40px; text-align: center;" title="Trend">📈</div>
                <div style="width: 50px; text-align: center;">Saisons</div>
                <div style="width: 70px; text-align: right;">Ø / Saison</div>
                <div style="width: 80px; text-align: right; padding-right: 10px;">Gesamt</div>
            </div>`;
            tableDiv.insertAdjacentHTML('beforeend', headerHtml);

            // Rows
            shown.forEach((p, idx) => {
                const rank = p.globalRank;
                let medal = '';
                if (rank === 1) medal = '🥇';
                else if (rank === 2) medal = '🥈';
                else if (rank === 3) medal = '🥉';
                else medal = `${rank}.`;

                const rankColor = rank <= 3 ? '#fbbf24' : '#cbd5e1';

                // Trend icon
                let trendIcon = '➡️';
                let trendColor = '#94a3b8';
                if (p.trend === 'up') { trendIcon = '↗️'; trendColor = '#4ade80'; }
                else if (p.trend === 'down') { trendIcon = '↘️'; trendColor = '#ef4444'; }

                // Current league tier badge (most recent season)
                const lastSeason = p.seasons[p.seasons.length - 1];
                const tierBadge = leagueTierLabel(lastSeason ? lastSeason.league : '');
                const tierColor = leagueTierColor(lastSeason ? lastSeason.league : '');

                const isExpanded = expandedId === p.id;

                // Row
                const row = document.createElement('div');
                row.style.cssText = 'border-bottom: 1px solid #334155; cursor: pointer; transition: background 0.15s;';

                let rowHtml = `<div style="display: flex; padding: 12px; align-items: center;" class="alltime-row">
                    <div style="width: 36px; text-align: center; font-weight: bold; color: ${rankColor}; font-size: 0.95em;">${medal}</div>
                    <div style="flex: 1; padding-left: 8px; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.name}</span>
                            ${tierBadge ? `<span style="font-size: 0.65em; font-weight: bold; color: ${tierColor}; border: 1px solid ${tierColor}; padding: 1px 5px; border-radius: 3px; flex-shrink: 0;">${tierBadge}</span>` : ''}
                        </div>
                        <div style="font-size: 0.7em; color: #64748b; margin-top: 2px;">
                            Bester Rang: ${p.bestSeasonRankDisplay} (${p.bestSeasonYearRank}) • Max: ${p.maxPoints} Pkt (${p.maxPointsYear})
                        </div>
                    </div>
                    <div style="width: 40px; text-align: center; font-size: 0.9em;" title="${p.trend === 'up' ? 'Aufwärtstrend' : p.trend === 'down' ? 'Abwärtstrend' : 'Stabil'}">${trendIcon}</div>
                    <div style="width: 50px; text-align: center; color: #cbd5e1; font-size: 0.9em;">${p.totalSeasons}</div>
                    <div style="width: 70px; text-align: right; color: #60a5fa; font-weight: 500; font-size: 0.9em;">${p.avgPoints.toFixed(1)}</div>
                    <div style="width: 80px; text-align: right; padding-right: 10px; font-weight: bold; color: #4ade80; font-size: 1em;">${p.totalPoints}</div>
                </div>`;

                // Feature 4: Expandable detail
                if (isExpanded) {
                    rowHtml += `<div style="padding: 0 12px 12px 56px; animation: fadeIn 0.2s ease;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.8em;">
                            <thead>
                                <tr style="color: #94a3b8; text-align: left;">
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155;">Saison</th>
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155;">Liga</th>
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155; text-align: center;">Rang</th>
                                    <th style="padding: 6px 8px; border-bottom: 1px solid #334155; text-align: right;">Punkte</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${p.seasons.map(s => {
                        const sc = leagueTierColor(s.league);
                        const sl = leagueTierLabel(s.league);
                        const isCur = s.isCurrent;
                        const rowBg = isCur ? 'background: rgba(74, 222, 128, 0.07);' : '';
                        return `<tr style="color: #e2e8f0; ${rowBg}">
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b;">${s.season}${isCur ? ' ⚡' : ''}</td>
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b;">
                                            <span style="color: ${sc}; font-weight: 500;">${s.league || '-'}</span>
                                            ${sl ? `<span style="font-size: 0.75em; color: ${sc}; margin-left: 4px; border: 1px solid ${sc}; padding: 0 3px; border-radius: 2px;">${sl}</span>` : ''}
                                        </td>
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b; text-align: center;">${s.rank || '-'}</td>
                                        <td style="padding: 5px 8px; border-bottom: 1px solid #1e293b; text-align: right; font-weight: bold; color: #4ade80;">${s.points || 0}</td>
                                    </tr>`;
                    }).join('')}
                            </tbody>
                        </table>
                    </div>`;
                }

                row.innerHTML = rowHtml;

                // Click handler to toggle expand
                row.querySelector('.alltime-row').addEventListener('click', () => {
                    expandedId = expandedId === p.id ? null : p.id;
                    render();
                });

                // Hover effect
                row.addEventListener('mouseenter', () => { row.style.background = 'rgba(51, 65, 85, 0.3)'; });
                row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

                tableDiv.appendChild(row);
            });

            container.appendChild(tableDiv);

            // --- Feature 7: Pagination ---
            if (hasMore) {
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.textContent = `Mehr laden (${shown.length} / ${filtered.length})`;
                loadMoreBtn.style.cssText = 'display: block; width: 100%; margin-top: 16px; padding: 14px; background: #1e293b; border: 1px solid #334155; color: #60a5fa; font-weight: 600; font-size: 0.9em; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
                loadMoreBtn.addEventListener('mouseenter', () => { loadMoreBtn.style.background = '#334155'; });
                loadMoreBtn.addEventListener('mouseleave', () => { loadMoreBtn.style.background = '#1e293b'; });
                loadMoreBtn.addEventListener('click', () => {
                    currentPage++;
                    render();
                });
                container.appendChild(loadMoreBtn);
            }

            // Re-focus search input if user was typing
            if (searchQuery) {
                const newInput = container.querySelector('input[type="text"]');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(searchQuery.length, searchQuery.length);
                }
            }
        };

        contentArea.appendChild(container);
        render();
    }



    // =============================================
    // MATCH SCORER ENGINE
    // =============================================
    class MatchScorer {
        constructor(container) {
            this.container = container;
            this.players = []; // { name, score, history: [], legs: 0 }
            this.currentTurnDarts = []; // Track individual darts (max 3)
            this.activePlayerIndex = 0;
            this.gameMode = 'DO'; // 'DO' (Double Out) or 'MO' (Master Out)
            this.isLeagueMode = false; // New: 2vs2 League Mode
            this.startScore = 501;
            this.recognition = null;
            this.isListening = false;

            this.initSpeech();
            this.currentTurnMults = []; // Track multipliers for validation

            // Audio Unlock Strategy
            this.audioCtx = null;
            this.unlockAudioBind = this.unlockAudio.bind(this);
            document.addEventListener('click', this.unlockAudioBind, { once: true });
            document.addEventListener('touchstart', this.unlockAudioBind, { once: true });
        }

        unlockAudio() {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            if (!this.audioCtx) this.audioCtx = new AudioContext();
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

            // Play silent buffer to unlock strict browsers
            const buffer = this.audioCtx.createBuffer(1, 1, 22050);
            const source = this.audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioCtx.destination);
            source.start(0);
        }

        initSpeech() {
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = false;
                this.recognition.lang = 'de-DE';
                this.recognition.interimResults = false;
                this.recognition.maxAlternatives = 1;

                this.recognition.onresult = (event) => {
                    const last = event.results.length - 1;
                    const text = event.results[last][0].transcript;
                    console.log('Voice Input:', text);
                    this.handleVoiceInput(text);
                };

                this.recognition.onend = () => {
                    if (this.isListening) this.recognition.start();
                };

                this.recognition.onerror = (e) => {
                    console.error('Speech Error:', e.error);
                    this.isListening = false;
                    this.updateVoiceUI();
                };
            }
        }

        toggleVoice() {
            if (!this.recognition) {
                alert("Spracherkennung wird von diesem Browser nicht unterstützt (probiere Chrome/Edge).");
                return;
            }
            this.isListening = !this.isListening;
            if (this.isListening) {
                try {
                    this.recognition.start();
                } catch (e) { console.warn("Mic start error", e); }
            } else {
                this.recognition.stop();
            }
            this.updateVoiceUI();
        }

        updateVoiceUI() {
            const btn = document.getElementById('voice-toggle-btn');
            if (btn) {
                btn.style.background = this.isListening ? '#ef4444' : '#334155';
                btn.innerHTML = this.isListening ? '🎤 An' : '🎤 Aus';
                if (this.isListening) btn.classList.add('pulse-animation');
                else btn.classList.remove('pulse-animation');
            }
        }

        handleVoiceInput(text) {
            // Simple parser (German numbers)
            const map = {
                'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
                'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
                'elf': 11, 'zwölf': 12, 'hundert': 100, 'hundertachtzig': 180,
                'bull': 50, 'bullseye': 50, 'doppel': 'D', 'triple': 'T'
            };

            let val = parseInt(text);
            if (isNaN(val)) {
                // Try to parse text numbers if parseInt fails
                const lower = text.toLowerCase().trim();
                // Check map
                if (map[lower]) val = map[lower];
                // Check if it ends with words in map (e.g. "hundert zwanzig")
                // Keep it simple for now
            }

            if (!isNaN(val) && val >= 0 && val <= 180) {
                // assume voice gives total turn score
                this.currentTurnDarts = [val];
                this.confirmTurn();

                // Show feedback
                const feedback = document.createElement('div');
                feedback.textContent = `🎤 ${val}`;
                feedback.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.8); color:#00e0ff; padding:20px; border-radius:10px; font-size:2em; z-index:9999; pointer-events:none; animation: fadeUp 1s forwards;";
                document.body.appendChild(feedback);
                setTimeout(() => feedback.remove(), 1000);

                // Auto-stop voice to avoid interference with output
                if (this.isListening) {
                    this.toggleVoice();
                }
            }
        }

        renderSetup() {
            this.container.innerHTML = '';

            const card = document.createElement('div');
            card.className = "setup-card";
            card.style.cssText = "background: #1e293b; padding: 25px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid #334155;";

            card.innerHTML = `
                <h2 style="text-align:center; margin-bottom: 20px; color: #60a5fa;">Match Setup</h2>
                
                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Modus</label>
                    <div style="display:flex; gap:10px;">
                        <button id="mode-do" class="mode-btn active" style="flex:1; padding:10px; border-radius:6px; border:none; background:#3b82f6; color:white; font-weight:bold; cursor:pointer;">Double Out</button>
                        <button id="mode-mo" class="mode-btn" style="flex:1; padding:10px; border-radius:6px; border:none; background:#334155; color:#94a3b8; font-weight:bold; cursor:pointer;">Master Out</button>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Team Modus</label>
                    <button id="mode-league" class="mode-btn" style="width:100%; padding:10px; border-radius:6px; border:none; background:#334155; color:#94a3b8; font-weight:bold; cursor:pointer;">
                        Liga (2vs2)
                    </button>
                    <div id="league-hint" style="display:none; color:#f59e0b; font-size:0.8em; margin-top:5px;">
                        ⚠️ Benötigt genau 4 Spieler. (Team A: Sp 1+3, Team B: Sp 2+4)<br>
                        Regel: Check nur möglich, wenn Partner < Gegner-Summe.
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Start Punkte</label>
                    <select id="start-points" style="width:100%; padding:10px; background:#0f172a; color:white; border:1px solid #334155; border-radius:6px;">
                        <option value="301">301</option>
                        <option value="501" selected>501</option>
                        <option value="701">701</option>
                    </select>
                </div>

                <div style="margin-bottom: 25px;">
                    <label style="display:block; color:#94a3b8; margin-bottom:8px;">Spieler</label>
                    <div id="player-list" style="margin-bottom:10px; display:flex; flex-direction:column; gap:8px;"></div>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="new-player-name" placeholder="Name (z.B. Tobi)" style="flex:1; padding:10px; background:#0f172a; color:white; border:1px solid #334155; border-radius:6px;">
                        <button id="add-player-btn" style="padding:10px 15px; background:#10b981; color:white; border:none; border-radius:6px; cursor:pointer;">+</button>
                    </div>
                </div>

                <button id="start-match-btn" style="width:100%; padding:15px; background:#3b82f6; color:white; border:none; border-radius:8px; font-size:1.1em; font-weight:bold; cursor:pointer; opacity: 0.5; pointer-events: none;">Match Starten</button>
            `;

            this.container.appendChild(card);

            // Logic
            const btnDO = card.querySelector('#mode-do');
            const btnMO = card.querySelector('#mode-mo');
            const btnLeague = card.querySelector('#mode-league');
            const leagueHint = card.querySelector('#league-hint');
            const playerList = card.querySelector('#player-list');
            const inputName = card.querySelector('#new-player-name');
            const btnAdd = card.querySelector('#add-player-btn');
            const btnStart = card.querySelector('#start-match-btn');
            const startPoints = card.querySelector('#start-points');

            const updateStartBtn = () => {
                if (this.isLeagueMode) {
                    if (this.players.length === 4) {
                        btnStart.style.opacity = "1";
                        btnStart.style.pointerEvents = "all";
                        btnStart.textContent = `Liga-Match Starten`;
                    } else {
                        btnStart.style.opacity = "0.5";
                        btnStart.style.pointerEvents = "none";
                        btnStart.textContent = `Benötigt 4 Spieler (${this.players.length}/4)`;
                    }
                } else {
                    if (this.players.length > 0) {
                        btnStart.style.opacity = "1";
                        btnStart.style.pointerEvents = "all";
                        btnStart.textContent = `Match Starten (${this.players.length} Spieler)`;
                    } else {
                        btnStart.style.opacity = "0.5";
                        btnStart.style.pointerEvents = "none";
                        btnStart.textContent = "Match Starten";
                    }
                }
            };

            const renderPlayers = () => {
                playerList.innerHTML = '';
                this.players.forEach((p, i) => {
                    const div = document.createElement('div');
                    div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#334155; padding:8px 12px; border-radius:6px;";
                    div.innerHTML = `<span style="color:white;">${p.name}</span> <button data-idx="${i}" class="remove-p-btn" style="background:transparent; color:#ef4444; border:none; cursor:pointer;">✕</button>`;
                    playerList.appendChild(div);
                });

                playerList.querySelectorAll('.remove-p-btn').forEach(b => {
                    b.onclick = (e) => {
                        this.players.splice(parseInt(e.target.dataset.idx), 1);
                        renderPlayers();
                        updateStartBtn();
                    };
                });
            };

            // Pre-fill with "Ich" if empty
            if (this.players.length === 0 && myPlayerName) {
                this.players.push({ name: myPlayerName, score: 501, history: [], legs: 0 });
                renderPlayers();
                updateStartBtn();
            } else {
                renderPlayers();
                updateStartBtn();
            }

            btnAdd.onclick = () => {
                const name = inputName.value.trim();
                if (name) {
                    this.players.push({ name: name, score: parseInt(startPoints.value), history: [], legs: 0 });
                    inputName.value = '';
                    renderPlayers();
                    updateStartBtn();
                }
            };

            inputName.onkeypress = (e) => {
                if (e.key === 'Enter') btnAdd.click();
            }

            btnDO.onclick = () => { this.gameMode = 'DO'; btnDO.className = 'mode-btn active'; btnMO.className = 'mode-btn'; btnDO.style.background = '#3b82f6'; btnDO.style.color = 'white'; btnMO.style.background = '#334155'; btnMO.style.color = '#94a3b8'; };
            btnMO.onclick = () => { this.gameMode = 'MO'; btnMO.className = 'mode-btn active'; btnDO.className = 'mode-btn'; btnMO.style.background = '#3b82f6'; btnMO.style.color = 'white'; btnDO.style.background = '#334155'; btnDO.style.color = '#94a3b8'; };

            btnLeague.onclick = () => {
                this.isLeagueMode = !this.isLeagueMode;
                if (this.isLeagueMode) {
                    btnLeague.style.background = '#8b5cf6'; // Purple
                    btnLeague.style.color = 'white';
                    leagueHint.style.display = 'block';
                } else {
                    btnLeague.style.background = '#334155';
                    btnLeague.style.color = '#94a3b8';
                    leagueHint.style.display = 'none';
                }
                updateStartBtn();
            };

            startPoints.onchange = () => {
                this.startScore = parseInt(startPoints.value);
                this.players.forEach(p => p.score = this.startScore); // Reset scores if changed
            };

            btnStart.onclick = () => {
                this.startScore = parseInt(startPoints.value); // Confirm start score
                // Reset scores to start score
                this.players.forEach(p => {
                    p.score = this.startScore;
                    p.history = [];
                });
                this.activePlayerIndex = 0;
                this.renderBoard();

                // Voice Feedback for First Player
                if (this.players.length > 0 && this.players[0].score > 0) {
                    this.speakScore(this.players[0].score);
                }
            };
        }

        renderBoard() {
            this.container.innerHTML = '';
            this.renderGameUI();
        }

        getCheckout(val) {
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

            let res = null;
            if (this.gameMode === 'MO' && outsMO[val]) res = outsMO[val];
            else if (outsDO[val]) res = outsDO[val];

            if (res) return res;
            if (val <= 1 && val !== 0) return "Nicht checkbar";
            if (val === 0) return "Check!";
            if (this.gameMode === 'DO' && val > 170) return "Nicht checkbar";

            return "Kein Standard-Finish";
        }

        renderGameUI() {
            const activePlayer = this.players[this.activePlayerIndex];

            // Calculate remaining for dynamic checkout
            const currentTurnTotal = this.currentTurnDarts.reduce((a, b) => a + b, 0);
            const remaining = activePlayer.score - currentTurnTotal;

            // Visual Checkout Logic
            const checkoutStr = this.getCheckout(remaining);
            const highlightIds = this.getCheckoutSegments(checkoutStr);
            const dartboardSVG = this.renderDartboardSVG(highlightIds);

            this.container.innerHTML = `
                <style>
                    .scorer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 350px; margin: 0 auto; }
                    .scorer-btn { padding: 15px; font-size: 1.5em; background: #334155; color: white; border: none; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
                    .scorer-btn:active { background: #475569; transform: scale(0.98); }
                    .scorer-action { background: #475569; font-size: 1em; font-weight: bold; }
                    .scorer-enter { background: #22c55e; grid-row: span 2; display: flex; align-items: center; justify-content: center; }
                    
                    /* Dartboard specific */
                    .board-segment { transition: all 0.3s ease; cursor: pointer; }
                    .board-segment:hover { opacity: 0.8; }
                    .highlighted { filter: drop-shadow(0 0 10px #00e0ff); stroke: #00e0ff; stroke-width: 3 !important; z-index: 10; opacity: 1 !important; }
                    .highlighted text { fill: black !important; font-weight: 900; font-size: 14px; }
                    
                    .checkout-text-box {
                        font-family: 'Courier New', monospace;
                        background: rgba(0,0,0,0.3);
                        padding: 10px;
                        border-radius: 8px;
                        border: 1px solid #334155;
                        text-shadow: 0 0 10px rgba(0, 224, 255, 0.5);
                    }
                    
                    .pulse-animation { animation: pulse 1.5s infinite; }
                    @keyframes pulse {
                         0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                         70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
                         100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                    }

                    @media (max-width: 700px) {
                        .match-layout { flex-direction: column; align-items: center; }
                        .dartboard-container { margin-bottom: 20px; }
                        .current-score-box { font-size: 2em; }
                        /* Grid-like wrapping */
                        .player-score-container { 
                            flex-direction: row !important; 
                            flex-wrap: wrap !important; 
                            justify-content: center !important; 
                            align-items: stretch !important;
                            overflow-x: visible !important; 
                        }
                        .player-card { 
                            width: auto !important;
                            flex: 1 1 140px !important; /* Grow/shrink, min 140px */
                            max-width: 200px !important; 
                            margin-bottom: 10px; 
                            box-sizing: border-box; 
                        }
                    }
                </style>
                
                 <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                      <button id="back-setup-btn" style="background:#334155; color:white; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:bold;">🆕 Neues Spiel</button>
                      
                      <div class="checkout-text-box" style="margin: 0 15px; flex: 1; text-align: center;">
                          <div style="font-size: 0.8em; color: #94a3b8; margin-bottom: 2px;">CHECKOUT WEG</div>
                          <div style="font-size: 1.8em; font-weight:bold; color: ${checkoutStr && !checkoutStr.includes('Nicht') && !checkoutStr.includes('Kein') ? '#00e0ff' : '#64748b'};">
                              ${checkoutStr || '-'}
                          </div>
                      </div>

                      <button id="voice-toggle-btn" style="background:#334155; color:white; border:none; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:bold;">🎤 Aus</button>
                 </div>
                
                <div class="match-layout" style="display: flex; gap: 20px; align-items: flex-start; justify-content: center;">
                    
                    <!-- Left: Dartboard + Controls -->
                    <div class="dartboard-container" style="flex: 0 0 auto; display: flex; flex-direction: column; align-items: center;">
                        ${dartboardSVG}
                        
                        <div style="margin-top: 20px; display: flex; gap: 10px; width: 100%; justify-content: center;">
                             <button id="undo-btn" style="background:#475569; color:white; border:none; padding:12px 20px; border-radius:8px; font-size:1.1em; cursor:pointer; display:flex; align-items:center; gap:8px; flex: 1; justify-content: center; max-width: 160px; transition: background 0.2s;">
                                 <span>↩️</span> Rückgängig
                             </button>
                             <button id="confirm-btn" style="background:#22c55e; color:white; border:none; padding:12px 20px; border-radius:8px; font-size:1.1em; cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:bold; flex: 1; justify-content: center; max-width: 160px; transition: background 0.2s;">
                                 <span>✅</span> Bestätigen
                             </button>
                        </div>
                    </div>

                    <!-- Right: Scorer & Players -->
                    <div style="flex: 1; min-width: 300px; max-width: 400px;">
                        <!-- Player Scores -->
                        <div class="player-score-container" style="display:flex; gap:10px; overflow-x:auto; margin-bottom:20px; padding-bottom:10px;">
                            ${this.players.map((p, i) => {
                let teamBadge = '';
                if (this.isLeagueMode && this.players.length === 4) {
                    const isTeamA = i % 2 === 0;
                    const teamColor = isTeamA ? '#3b82f6' : '#ef4444';
                    const teamName = isTeamA ? 'TEAM A' : 'TEAM B';
                    teamBadge = `<div style="font-size:0.7em; background:${teamColor}; color:white; padding:2px 6px; border-radius:4px; margin-bottom:5px; display:inline-block;">${teamName}</div>`;
                }

                return `
                                <div class="player-card" style="min-width:100px; background:${i === this.activePlayerIndex ? '#3b82f6' : '#1e293b'}; padding:10px; border-radius:10px; text-align:center; transition:all 0.3s ease; transform:${i === this.activePlayerIndex ? 'scale(1.05)' : 'scale(1)'}; border:2px solid ${i === this.activePlayerIndex ? '#60a5fa' : '#334155'}; position: relative;">
                                    ${teamBadge}
                                    <div style="font-size:0.8em; color:${i === this.activePlayerIndex ? 'white' : '#94a3b8'}">${p.name}</div>
                                    <div style="font-size:2em; font-weight:bold; color:white;">
                                        ${i === this.activePlayerIndex ? (p.score - currentTurnTotal) : p.score}
                                    </div>
                                    <div style="font-size:0.7em; color:#cbd5e1;">Legs: ${p.legs} | Avg: ${this.calculateAvg(p)}</div>
                                </div>
                            `;
            }).join('')}
                        </div>
                        
                        <!-- Active Turn Input -->
                        <div style="background:#1e293b; padding:15px; border-radius:12px; margin-bottom:15px; text-align:center; position: relative;">
                            <div style="color:#94a3b8; font-size: 0.9em; margin-bottom:5px;">Aufnahme für <strong>${activePlayer.name}</strong></div>
                            
                            <!-- 3-Dart Display -->
                            <div style="display:flex; justify-content:center; gap:10px; margin-bottom:10px;">
                                ${[0, 1, 2].map(i => `
                                    <div style="width:60px; height:60px; background:${this.currentTurnDarts[i] !== undefined ? '#334155' : '#0f172a'}; border:1px solid #475569; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.5em; font-weight:bold; color:white;">
                                        ${this.currentTurnDarts[i] !== undefined ? this.currentTurnDarts[i] : ''}
                                    </div>
                                `).join('')}
                            </div>
                            
                            <!-- Current Sum & Input Buffer -->
                            <div style="text-align:left; font-size:0.7em; color:#94a3b8; margin-bottom:2px; margin-left:5px;">Manuelle Eingabe (Summe):</div>
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:#0f172a; border-radius:8px;">
                                <div style="font-size:0.8em; color:#94a3b8;">Summe: <span style="font-size:1.5em; color:#4ade80; font-weight:bold;">${this.currentTurnDarts.reduce((a, b) => a + b, 0)}</span></div>
                                <div id="current-input-buffer" style="font-size:1.5em; color:white; min-width:50px; text-align:right;"></div>
                            </div>

                        </div>

                        <!-- Numpad -->
                        <div class="scorer-grid">
                            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="scorer-btn" onclick="window.matchScorer.addInput(${n})">${n}</button>`).join('')}
                            <button class="scorer-btn" onclick="window.matchScorer.addInput(0)">0</button>
                            <button class="scorer-btn scorer-action" onclick="window.matchScorer.backspace()">⌫</button>
                            <button class="scorer-btn scorer-enter" style="${this.currentTurnDarts.length === 3 ? 'background:#ec4899;' : ''}" onclick="window.matchScorer.submitInput()">${this.currentTurnDarts.length === 3 ? 'WEITER' : 'Enter'}</button>
                        </div>
                    </div>
                </div>
             `;

            // Re-bind listeners
            this.container.querySelector('#back-setup-btn').onclick = () => this.renderSetup();
            this.container.querySelector('#voice-toggle-btn').onclick = () => this.toggleVoice();
            this.container.querySelector('#undo-btn').onclick = () => this.backspace();
            this.container.querySelector('#confirm-btn').onclick = () => this.confirmTurn();

            // Add click listeners to board segments
            this.container.querySelectorAll('.board-segment').forEach(seg => {
                seg.onclick = (e) => {
                    e.stopPropagation();
                    const val = parseInt(seg.dataset.val);
                    const mult = parseInt(seg.dataset.mult || 1);
                    this.addDart(val, mult);
                };
            });

            this.updateVoiceUI();
        }




        getCheckoutSegments(checkoutStr) {
            if (!checkoutStr || checkoutStr.includes("Nicht") || checkoutStr.includes("Kein")) return [];
            const segments = [];
            const parts = checkoutStr.split(' - ');
            parts.forEach(p => {
                const norm = p.trim().toUpperCase();
                if (norm === 'BULL') segments.push('s_50');
                else if (norm === '25') segments.push('s_25');
                else if (norm.startsWith('T')) segments.push('s_t' + norm.substring(1));
                else if (norm.startsWith('D')) segments.push('s_d' + norm.substring(1));
                else {
                    segments.push('s_so' + norm);
                    segments.push('s_si' + norm);
                }
            });
            return segments;
        }

        renderDartboardSVG(highlightIds = []) {
            const size = 340, cx = 170, cy = 170;
            // Radii (approx)
            const rDoubleOut = 140, rDoubleIn = 130;
            const rTrebleOut = 85, rTrebleIn = 75;
            const rOuter = 130, rInner = 15;
            const rBull = 6;

            // Standard order starting from top (20) clockwise
            const numbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
            const slice = 360 / 20;

            let paths = '';

            // Generate segments
            numbers.forEach((val, i) => {
                const angle = -90 + (i * slice) - (slice / 2); // Start -9 degrees (since 20 is at top center)
                // Correct logic: 20 is centered at -90deg. So start is -90 - 9 = -99.
                // Actually, standard board: 20 is top. 
                // Let's use simple rotation. Each slice is 18deg. 
                // 20 is at index 0. Center of 20 is -90deg.
                // So slice 0 starts at -99deg and ends at -81deg.

                const startA = (i * slice) - 9 - 90;
                const endA = startA + 18;

                const toRad = d => d * Math.PI / 180;

                const arc = (rStart, rEnd, idPrefix, colorEven, colorOdd) => {
                    const x1 = cx + rStart * Math.cos(toRad(startA));
                    const y1 = cy + rStart * Math.sin(toRad(startA));
                    const x2 = cx + rEnd * Math.cos(toRad(startA));
                    const y2 = cy + rEnd * Math.sin(toRad(startA));

                    const x3 = cx + rEnd * Math.cos(toRad(endA));
                    const y3 = cy + rEnd * Math.sin(toRad(endA));
                    const x4 = cx + rStart * Math.cos(toRad(endA));
                    const y4 = cy + rStart * Math.sin(toRad(endA));

                    const id = `${idPrefix}${val}`;
                    const isHigh = highlightIds.includes(id);
                    const fill = isHigh ? '#00e0ff' : (i % 2 === 0 ? colorEven : colorOdd);
                    const stroke = isHigh ? '#00e0ff' : '#1e293b';

                    return `<path d="M${x1},${y1} L${x2},${y2} A${rEnd},${rEnd} 0 0,1 ${x3},${y3} L${x4},${y4} A${rStart},${rStart} 0 0,0 ${x1},${y1} Z" 
                        fill="${fill}" stroke="${stroke}" stroke-width="${isHigh ? 3 : 1}" class="board-segment ${isHigh ? 'highlighted' : ''}" data-val="${val}" data-mult="${idPrefix === 's_d' ? 2 : (idPrefix === 's_t' ? 3 : 1)}" />`;
                };

                // Double Ring
                paths += arc(rDoubleIn, rDoubleOut, 's_d', '#f87171', '#4ade80'); // Red/Green
                // Outer Single
                paths += arc(rTrebleOut, rDoubleIn, 's_so', '#1e293b', '#e2e8f0'); // Black/White
                // Treble Ring
                paths += arc(rTrebleIn, rTrebleOut, 's_t', '#f87171', '#4ade80');
                // Inner Single
                paths += arc(rInner * 2, rTrebleIn, 's_si', '#1e293b', '#e2e8f0'); // Black/White

                // Labels (Numbers)
                const rText = rDoubleOut + 15;
                const tx = cx + rText * Math.cos(toRad(startA + 9));
                const ty = cy + rText * Math.sin(toRad(startA + 9));
                paths += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="12" font-weight="bold">${val}</text>`;
            });

            // Bullseye
            const bullHigh = highlightIds.includes('s_50');
            const outerHigh = highlightIds.includes('s_25');

            // Outer Bull (25)
            paths += `<circle cx="${cx}" cy="${cy}" r="${rInner * 2}" fill="${outerHigh ? '#00e0ff' : '#4ade80'}" stroke="#1e293b" class="board-segment ${outerHigh ? 'highlighted' : ''}" data-val="25" data-mult="1" />`; // Green -> Cyan if high
            // Inner Bull (50)
            paths += `<circle cx="${cx}" cy="${cy}" r="${rInner}" fill="${bullHigh ? '#00e0ff' : '#f87171'}" stroke="#1e293b" class="board-segment ${bullHigh ? 'highlighted' : ''}" data-val="50" data-mult="1" />`; // Red -> Cyan if high

            return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="max-width:100%; height:auto;">
                <circle cx="${cx}" cy="${cy}" r="${cx - 5}" fill="#0f172a" />
                ${paths}
            </svg>`;
        }

        calculateAvg(player) {
            if (player.history.length === 0) return "0.0";
            const total = player.history.reduce((a, b) => a + b, 0);
            return (total / player.history.length).toFixed(1);
        }

        addInput(num) {
            const buffer = document.getElementById('current-input-buffer');
            if (buffer && buffer.textContent.length < 3) {
                buffer.textContent += num;
            }
        }

        backspace() {
            const buffer = document.getElementById('current-input-buffer');
            if (buffer && buffer.textContent.length > 0) {
                buffer.textContent = buffer.textContent.slice(0, -1);
            } else if (this.currentTurnDarts.length > 0) {
                // Remove last dart if buffer is empty
                this.currentTurnDarts.pop();
                this.currentTurnMults.pop();
                this.renderGameUI();
            }
        }

        submitInput() {
            const buffer = document.getElementById('current-input-buffer');

            // If buffer has value, treat it as TOTAL turn score
            if (buffer && buffer.textContent !== '') {
                const val = parseInt(buffer.textContent);
                if (!isNaN(val) && val <= 180) {
                    // Manual entry is ALWAYS total score
                    this.currentTurnDarts = [val];
                    this.currentTurnMults = []; // Clear mults for manual entry (valid by default)
                    this.confirmTurn();
                    buffer.textContent = '';
                }
                return;
            }

            // If buffer empty, try to confirm turn
            if (this.currentTurnDarts.length > 0) {
                this.confirmTurn();
            }
        }

        addDart(val, mult = 1) {
            if (this.currentTurnDarts.length >= 3) return;
            this.currentTurnDarts.push(val * mult);
            this.currentTurnMults.push(mult);
            this.playSound('hit');
            this.renderGameUI();
        }

        confirmTurn() {
            const total = this.currentTurnDarts.reduce((a, b) => a + b, 0);
            const player = this.players[this.activePlayerIndex];

            // Validation for Checkout
            let validCheckout = true;
            let leagueBlockError = false;

            if (player.score - total === 0) {
                // 1. League Block Rule (Team A: 0/2, Team B: 1/3)
                if (this.isLeagueMode && this.players.length === 4) {
                    const pIdx = this.activePlayerIndex;
                    const partnerIdx = (pIdx + 2) % 4;
                    const opp1Idx = (pIdx + 1) % 4;
                    const opp2Idx = (pIdx + 3) % 4;

                    const partnerScore = this.players[partnerIdx].score;
                    const oppSum = this.players[opp1Idx].score + this.players[opp2Idx].score;

                    if (partnerScore >= oppSum) {
                        validCheckout = false;
                        leagueBlockError = true;
                    }
                }

                // 2. Standard Checkout Rules (if not already blocked)
                if (validCheckout) {
                    // Check if manual entry (no mults) OR valid dart mult
                    if (this.currentTurnMults.length > 0) {
                        // Last dart determines finish
                        const lastMult = this.currentTurnMults[this.currentTurnMults.length - 1];
                        if (this.gameMode === 'DO' && lastMult !== 2) validCheckout = false;
                        // MO: Double or Triple allowed
                        if (this.gameMode === 'MO' && lastMult !== 2 && lastMult !== 3) validCheckout = false;
                        // SO is always valid
                    }
                }
            }

            // Bust check (or invalid checkout)
            if (player.score - total < 0 || player.score - total === 1 || (player.score - total === 0 && !validCheckout)) {
                this.playSound('bust');

                if (leagueBlockError) {
                    const pIdx = this.activePlayerIndex;
                    const partner = this.players[(pIdx + 2) % 4];
                    const opp1 = this.players[(pIdx + 1) % 4];
                    const opp2 = this.players[(pIdx + 3) % 4];
                    const oppSum = opp1.score + opp2.score;
                    setTimeout(() => alert(`BLOCK! Partner (${partner.score}) muss weniger Punkte haben als Gegner (${opp1.score}+${opp2.score}=${oppSum})!`), 500);
                } else if (!validCheckout && player.score - total === 0) {
                    setTimeout(() => alert(`Ungültiges Checkout! (${this.gameMode === 'DO' ? 'Muss Double sein' : 'Muss Double oder Triple sein'})`), 500);
                } else {
                    setTimeout(() => alert("Überworfen!"), 500);
                }

                this.currentTurnDarts = [];
                this.currentTurnMults = [];
                this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
                const nextPlayer = this.players[this.activePlayerIndex];
                if (nextPlayer.score > 0) this.speakScore(nextPlayer.score);
            } else if (player.score - total === 0) {
                // Check!
                player.score = 0;
                player.legs++;
                player.history.push(total);

                setTimeout(() => alert(`${player.name} gewinnt das Leg!`), 500);

                this.players.forEach(p => { p.score = this.startScore; p.history = []; });
                this.currentTurnDarts = [];
                this.currentTurnMults = [];
                this.activePlayerIndex = 0;
                if (this.players[0].score > 0) this.speakScore(this.players[0].score);
            } else {
                player.score -= total;
                player.history.push(total);

                this.currentTurnDarts = [];
                this.currentTurnMults = [];

                // Switch player
                this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;

                // Voice Feedback for NEXT player
                const nextPlayer = this.players[this.activePlayerIndex];
                if (nextPlayer.score > 0) {
                    this.speakScore(nextPlayer.score);
                }
            }

            this.renderGameUI();
        }

        speakScore(score) {
            if (!('speechSynthesis' in window)) return;

            const speak = () => {
                const utterance = new SpeechSynthesisUtterance(score.toString());
                utterance.lang = 'de-DE';
                utterance.rate = 1.1;

                // Try to find German voice, fallback to default
                const voices = window.speechSynthesis.getVoices();
                const deVoice = voices.find(v => v.lang.includes('de'));
                if (deVoice) utterance.voice = deVoice;

                window.speechSynthesis.speak(utterance);
            };

            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
            }

            // Retry once if voices are empty (Chrome quirk)
            if (window.speechSynthesis.getVoices().length === 0) {
                const id = setTimeout(speak, 500); // Fallback
                window.speechSynthesis.onvoiceschanged = () => {
                    clearTimeout(id);
                    window.speechSynthesis.onvoiceschanged = null;
                    speak();
                };
            } else {
                speak();
            }
        }


        playSound(type) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            if (!this.audioCtx) {
                this.audioCtx = new AudioContext();
            }

            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.connect(gain);
            gain.connect(ctx.destination);

            const now = ctx.currentTime;

            if (type === 'hit') {
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
            } else if (type === 'bust') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.linearRampToValueAtTime(30, now + 0.4);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
            }
        }
    }

    // Global instance holder
    window.matchScorerInstance = null;
    window.matchScorer = {
        addInput: (n) => window.matchScorerInstance?.addInput(n),
        backspace: () => window.matchScorerInstance?.backspace(),
        submitInput: () => window.matchScorerInstance?.submitInput()
    };

    function renderToolsView() {
        topBarTitle.textContent = "Match Center";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "10px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";

        contentArea.appendChild(container);

        window.matchScorerInstance = new MatchScorer(container);
        window.matchScorerInstance.renderSetup();
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

        // --- Helper: Tier Colors & Labels ---
        const leagueTierColor = (league) => {
            if (!league) return '#94a3b8';
            if (league.includes('Bezirksliga')) return '#a855f7'; // Purple
            if (league.includes('A-Klasse')) return '#ef4444';    // Red
            if (league.includes('B-Klasse')) return '#f59e0b';    // Amber
            if (league.includes('C-Klasse')) return '#3b82f6';    // Blue
            return '#94a3b8';
        };

        const leagueTierLabel = (league) => {
            if (!league) return '';
            if (league.includes('Bezirksliga')) return 'BZL';
            if (league.includes('A-Klasse')) return 'A';
            if (league.includes('B-Klasse')) return 'B';
            if (league.includes('C-Klasse')) return 'C';
            return '';
        };

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
        container.classList.add('fade-in');
        container.style.padding = "20px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";

        // --- Helper: Fuzzy Match Club Name ---
        const isClubMatch = (clubName, targetName) => {
            if (!targetName) return false;
            const normC = clubName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normT = targetName.toLowerCase().replace(/[^a-z0-9]/g, '');

            if (!normC || !normT) return false;

            // 1. Exact Match
            if (normC === normT) return true;

            // 2. Target contains Club (e.g. "Club II" matches "Club")
            // This is usually safe, unless club name is very short (checked implicitly by data)
            if (normT.includes(normC)) return true;

            // 3. Club contains Target (e.g. "Club Name" matches "Club")
            // DANGEROUS: Matches "DC", "SV", "1", "Team" in table headers/cells.
            // Only allow if Target is distinctive enough (long enough).
            if (normC.includes(normT)) {
                if (normT.length < 4) return false; // Reject short matches like "DC", "EV", "1."
                return true;
            }

            return false;
        };

        // --- 1. GATHER DATA ---

        // A) Players
        let clubPlayers = [];
        if (typeof RANKING_DATA !== 'undefined' && RANKING_DATA.players && club.number) {
            clubPlayers = RANKING_DATA.players.filter(p => p.v_nr === club.number);
        }

        // B) Matches (Upcoming & Recent)
        let upcomingMatches = [];
        let recentMatches = [];

        if (typeof leagueData !== 'undefined' && leagueData.leagues) {
            Object.keys(leagueData.leagues).forEach(leagueName => {
                if (leagueName.includes("Ligapokal")) return; // Skip Ligapokal for now or handle differently

                const matches = parseAllMatches(leagueName); // Reuse existing helper
                matches.forEach(m => {
                    if (isClubMatch(club.name, m.home) || isClubMatch(club.name, m.away)) {
                        // Parse Date for sorting
                        let ts = 0;
                        if (m.dateStr) {
                            const parts = m.dateStr.split('.');
                            if (parts.length === 3) ts = new Date(parts[2], parts[1] - 1, parts[0]).getTime();
                        }

                        const matchObj = { ...m, leagueName, ts };

                        if (m.played) {
                            recentMatches.push(matchObj);
                        } else {
                            // Only future or today
                            // If no date, assume future? Or ignore?
                            // Let's assume matches without results are upcoming
                            upcomingMatches.push(matchObj);
                        }
                    }
                });
            });
        }

        // Sort Matches
        upcomingMatches.sort((a, b) => a.ts - b.ts); // Ascending (next game first)
        recentMatches.sort((a, b) => b.ts - a.ts);   // Descending (last game first)

        // limit
        const nextGames = upcomingMatches.slice(0, 5);
        const lastGames = recentMatches.slice(0, 5);


        // --- 2. RENDER UI ---

        // A) Quick Stats Header
        const totalPoints = clubPlayers.reduce((acc, p) => acc + (parseInt(p.points) || 0), 0);
        const activeLeagues = [...new Set(clubPlayers.map(p => p.league))].filter(l => l && l !== "Unbekannt").length;

        let statsHtml = `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 1.5em;">👥</div>
                    <div style="font-weight: bold; color: #f8fafc; font-size: 1.2em;">${clubPlayers.length}</div>
                    <div style="font-size: 0.75em; color: #94a3b8;">Spieler</div>
                </div>
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 1.5em;">🏆</div>
                    <div style="font-weight: bold; color: #f8fafc; font-size: 1.2em;">${activeLeagues}</div>
                    <div style="font-size: 0.75em; color: #94a3b8;">Ligen</div>
                </div>
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-size: 1.5em;">🎯</div>
                    <div style="font-weight: bold; color: #4ade80; font-size: 1.2em;">${totalPoints}</div>
                    <div style="font-size: 0.75em; color: #94a3b8;">Punkte (Ges.)</div>
                </div>
            </div>
        `;
        container.innerHTML += statsHtml;


        // B) Club Details (Collapsible or improved card)
        const detailsCard = document.createElement('div');
        detailsCard.style.background = "#1e293b";
        detailsCard.style.border = "1px solid #334155";
        detailsCard.style.borderRadius = "8px";
        detailsCard.style.marginBottom = "20px";
        detailsCard.style.overflow = "hidden";

        let detailsHtml = `
            <div style="padding: 15px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: rgba(255,255,255,0.02);" onclick="this.nextElementSibling.classList.toggle('hidden')">
                <span style="font-weight: bold; color: #f8fafc;">📍 Vereinsinfos & Kontakt</span>
                <span style="color: #64748b;">▼</span>
            </div>
            <div class="hidden" style="padding: 15px; border-top: 1px solid #334155;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
        `;

        // Fields to show
        const fields = [
            { k: 'venue', l: 'Spiellokal', i: '🏠' },
            { k: 'street', l: 'Adresse', i: '📍' },
            { k: 'city', l: 'Ort', i: '🏙️' },
            { k: 'website', l: 'Webseite', i: '🌐', link: true },
            { k: 'email', l: 'E-Mail', i: '✉️', mail: true },
            { k: 'contact', l: 'Kontaktperson', i: '👤' },
            { k: 'mobile', l: 'Mobil', i: '📱' },
        ];

        fields.forEach(f => {
            let val = club[f.k];
            if (val && val !== 'null' && val !== '-') {
                if (f.link && !val.startsWith('http')) val = `<a href="http://${val}" target="_blank" style="color:#3b82f6;">${val}</a>`;
                else if (f.mail) val = `<a href="mailto:${val}" style="color:#3b82f6;">${val}</a>`;

                detailsHtml += `
                    <div>
                        <div style="font-size: 0.8em; color: #64748b; margin-bottom: 2px;">${f.i} ${f.l}</div>
                        <div style="color: #e2e8f0; font-size: 0.95em;">${val}</div>
                    </div>
                 `;
            }
        });

        // Map Link
        if ((club.street && club.street !== '-') || (club.city && club.city !== '-')) {
            const q = `${club.street || ''} ${club.city || ''}`;
            detailsHtml += `
                <div style="grid-column: 1 / -1; margin-top: 10px;">
                    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" style="display: inline-block; width: 100%; text-align: center; padding: 8px; background: #334155; color: #fff; border-radius: 4px; text-decoration: none; font-size: 0.9em;">
                        Auf Karte anzeigen
                    </a>
                </div>
             `;
        }

        detailsHtml += `</div></div>`;
        detailsCard.innerHTML = detailsHtml;
        container.appendChild(detailsCard); // Append Details


        // C) Matches Section (Grid: Left Upcoming, Right Recent)
        const matchesGrid = document.createElement('div');
        matchesGrid.style.display = "grid";
        matchesGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(300px, 1fr))";
        matchesGrid.style.gap = "20px";
        matchesGrid.style.marginBottom = "20px";

        // C-1) Upcoming
        const upcomingCard = document.createElement('div');
        upcomingCard.innerHTML = `<h3 style="color: #f8fafc; font-size: 1.1em; margin-bottom: 10px; border-bottom: 1px solid #334155; padding-bottom: 5px;">📅 Nächste Spiele</h3>`;
        if (nextGames.length === 0) {
            upcomingCard.innerHTML += `<div style="color: #64748b; font-size: 0.9em;">Keine angesetzten Spiele gefunden.</div>`;
        } else {
            nextGames.forEach(m => {
                upcomingCard.innerHTML += `
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.8em; color: #94a3b8; margin-bottom: 4px;">
                            <span>${m.dateStr}</span>
                            <span style="color: #64748b;">${m.leagueName}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; color: #f8fafc; font-size: 0.95em;">
                            <span style="${isClubMatch(club.name, m.home) ? 'font-weight:bold; color:#60a5fa;' : ''}">${m.home}</span>
                            <span style="font-size: 0.8em; color: #64748b; padding: 0 5px;">vs</span>
                            <span style="${isClubMatch(club.name, m.away) ? 'font-weight:bold; color:#60a5fa;' : ''}">${m.away}</span>
                        </div>
                    </div>
                `;
            });
        }

        // C-2) Recent
        const recentCard = document.createElement('div');
        recentCard.innerHTML = `<h3 style="color: #f8fafc; font-size: 1.1em; margin-bottom: 10px; border-bottom: 1px solid #334155; padding-bottom: 5px;">📊 Letzte Ergebnisse</h3>`;
        if (lastGames.length === 0) {
            recentCard.innerHTML += `<div style="color: #64748b; font-size: 0.9em;">Keine Ergebnisse gefunden.</div>`;
        } else {
            lastGames.forEach(m => {
                // Determine Win/Loss mainly by score if we can identify 'our' team
                // Simple heuristic: if our team score > opponent score -> Win
                let resColor = "#94a3b8"; // Draw or unknown
                let isHome = isClubMatch(club.name, m.home);
                let ourScore = isHome ? m.scoreHome : m.scoreAway;
                let oppScore = isHome ? m.scoreAway : m.scoreHome;

                if (ourScore > oppScore) resColor = "#4ade80";
                else if (ourScore < oppScore) resColor = "#f87171";

                recentCard.innerHTML += `
                    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px; border-left: 3px solid ${resColor};">
                        <div style="display: flex; justify-content: space-between; font-size: 0.8em; color: #94a3b8; margin-bottom: 4px;">
                            <span>${m.dateStr}</span>
                            <span style="color: #64748b;">${m.leagueName}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="color: #f8fafc; font-size: 0.95em; flex: 1;">
                                <div style="${isClubMatch(club.name, m.home) ? 'font-weight:bold;' : ''}">${m.home}</div>
                                <div style="${isClubMatch(club.name, m.away) ? 'font-weight:bold;' : ''}">${m.away}</div>
                            </div>
                            <div style="font-weight: bold; font-size: 1.1em; color: #f8fafc; background: rgba(255,255,255,0.05); padding: 5px 8px; border-radius: 4px;">
                                ${m.scoreHome}:${m.scoreAway}
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        matchesGrid.appendChild(upcomingCard);
        matchesGrid.appendChild(recentCard);
        container.appendChild(matchesGrid);


        // D) Players List
        if (clubPlayers.length > 0) {
            // Sort Players
            clubPlayers.sort((a, b) => (parseInt(b.points) || 0) - (parseInt(a.points) || 0));

            const playerSection = document.createElement('div');
            playerSection.style.marginTop = "30px";
            playerSection.innerHTML = `<h3 style="color: #f8fafc; font-size: 1.2em; margin-bottom: 15px;">Mannschaft (${clubPlayers.length})</h3>`;

            const pGrid = document.createElement('div');
            pGrid.style.display = "grid";
            pGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(280px, 1fr))";
            pGrid.style.gap = "10px";

            clubPlayers.forEach(p => {
                const pCard = document.createElement('div');
                pCard.style.cssText = "background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; display: flex; justify-content: space-between; align-items: center;";

                // Sparkline
                let spark = "";
                if (p.rounds) spark = renderSparkline(p.rounds); // reuse existing sparkline

                const tierColor = leagueTierColor(p.league); // reuse existing helper

                pCard.innerHTML = `
                    <div style="flex: 1;">
                        <div style="font-weight: bold; color: #f8fafc;">${p.name}</div>
                        <div style="font-size: 0.8em; color: ${tierColor};">
                            ${p.league} 
                            <span style="color: #cbd5e1; margin-left: 5px; background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px;">
                                Platz ${p.rank || '-'}
                            </span>
                        </div>
                    </div>
                    ${spark}
                    <div style="text-align: right; margin-left: 10px;">
                        <div style="font-weight: bold; color: #4ade80; font-size: 1.1em;">${p.points || 0}</div>
                        <div style="font-size: 0.75em; color: #64748b;">Pkt</div>
                    </div>
                `;
                pGrid.appendChild(pCard);
            });
            playerSection.appendChild(pGrid);
            container.appendChild(playerSection);
        }

        // E) Archive (Keep existing logic mostly, just wrapped nicelier)
        // ... (We can reuse the logic from previous implementation if we duplicate it or extract it)
        // For brevity in this replacement, I'll simplify or just check if we have archive tables
        // To be safe and keep feature parity, I should re-include the archive logic.

        if (typeof window.ARCHIVE_TABLES !== 'undefined' && window.ARCHIVE_TABLES.length > 0) {

            // Normalize current club name for matching
            const currentClubName = club.name.toLowerCase().trim();

            // Filter relevant tables
            const relevantTables = window.ARCHIVE_TABLES.filter(table => {
                if (!table.league || table.league === 'Unbekannt') return false;
                if (table.league.includes('Ligapokal')) return false;

                // Determine if any row in this table matches our club
                if (!table.rows) return false;
                return table.rows.some(row => {
                    if (row.length < 2) return false;
                    // Check ALL columns for the club name
                    return row.some(cell => isClubMatch(club.name, cell));
                });
            });

            if (relevantTables.length > 0) {
                // Sort by Season Descending
                relevantTables.sort((a, b) => b.season.localeCompare(a.season));

                const archSection = document.createElement('div');
                archSection.style.marginTop = "40px";
                archSection.innerHTML = `<h3 style="color: #64748b; font-size: 1.1em; border-top: 1px solid #334155; padding-top: 20px;">📜 Archiv & Historie</h3>`;

                let html = "";

                relevantTables.forEach(table => {
                    // Inspect Headers to determine type
                    // Ranking Tables usually have "Pl." and "Tabelle" (or "Team") and "Pkt"
                    // Match Lists usually have "Heim" and "Gast" and "Ergebnis"

                    const headerRowStr = table.rows[0].map(h => h.toLowerCase()).join(' ');
                    const isMatchList = headerRowStr.includes('heim') && headerRowStr.includes('gast') && headerRowStr.includes('ergebnis');

                    if (isMatchList) {
                        // --- MATCH LIST RENDER LOGIC (Filtered) ---
                        // Only show rows where our club is involved
                        const myRows = table.rows.filter(row => {
                            if (row.length < 2) return false;
                            // Check if club is in ANY column
                            return row.some(cell => isClubMatch(club.name, cell));
                        });

                        if (myRows.length > 0) {
                            html += `<div style="margin-bottom: 25px;">
                                <div style="font-weight: 600; color: #94a3b8; margin-bottom: 8px;">${table.season} - ${table.league}</div>
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
                                    let isMyClub = isClubMatch(club.name, cell);
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
                            <div style="font-weight: 600; color: #94a3b8; margin-bottom: 8px;">${table.season} - ${table.league}</div>
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
                            let isMyClub = row.some(cell => isClubMatch(club.name, cell));

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

                archSection.innerHTML += html;
                container.appendChild(archSection);
            }
        }

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

    // =============================================
    // MATCH PREVIEW HELPER FUNCTIONS
    // =============================================

    /**
     * Parse all match_days text for a given league into structured objects.
     * Returns array of { spieltag, date, home, away, scoreHome, scoreAway, played }
     */
    function parseAllMatches(leagueName) {
        const matches = [];
        const league = leagueData.leagues[leagueName];
        if (!league || !league.match_days) return matches;

        for (const [spieltag, text] of Object.entries(league.match_days)) {
            if (!text) continue;
            // Split by newline (handles both \n and \\n in JSON)
            const lines = text.split(/\\n|\n/).filter(l => l.trim().length > 0);

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Try standard league format first:
                // "Mo. 25. 8.2025 20:00 Team A          - Team B             9:7  "
                // Or simpler: "date   home - away   score"
                // The separator between teams is " - " (space dash space)
                const dashIdx = trimmed.indexOf(' - ');
                if (dashIdx === -1) continue;

                const leftPart = trimmed.substring(0, dashIdx).trim();
                const rightPart = trimmed.substring(dashIdx + 3).trim();

                // Extract home team: everything after the date/time
                // Date patterns: "Mo. 25. 8.2025 20:00" or "28.11.2025 20:00"
                let home = leftPart;
                // Try to strip date: look for time pattern HH:MM or just strip leading date
                const timeMatch = leftPart.match(/\d{1,2}:\d{2}\s+(.+)/);
                if (timeMatch) {
                    home = timeMatch[1].trim();
                } else {
                    // Try date without time: "08.03.2026   team"
                    const dateOnlyMatch = leftPart.match(/\d{1,2}\.\d{1,2}\.\d{4}\s+(.+)/);
                    if (dateOnlyMatch) {
                        home = dateOnlyMatch[1].trim();
                    }
                }

                // Extract away team and score from right part
                // "Team B    9:7  " or "Team B    ---  " or "Team B    :  "
                let away = rightPart;
                let scoreHome = null;
                let scoreAway = null;
                let played = false;

                // Match score at end: digits:digits
                const scoreMatch = rightPart.match(/^(.+?)\s+(\d+):(\d+)\s*$/);
                const noScoreMatch = rightPart.match(/^(.+?)\s+(---|\s*:\s*)\s*$/);

                if (scoreMatch) {
                    away = scoreMatch[1].trim();
                    scoreHome = parseInt(scoreMatch[2]);
                    scoreAway = parseInt(scoreMatch[3]);
                    played = true;
                } else if (noScoreMatch) {
                    away = noScoreMatch[1].trim();
                    played = false;
                }

                // Extract date string for display
                let dateStr = '';
                const dateExtract = leftPart.match(
                    /(?:[A-Za-z]{2}\.\s+)?(\d{1,2}\.\s*\d{1,2}\.\d{4})(?:\s+\d{1,2}:\d{2})?/
                );
                if (dateExtract) {
                    dateStr = dateExtract[1].replace(/\s/g, '');
                }

                if (home && away && home !== 'Spielfrei' && away !== 'Spielfrei') {
                    matches.push({
                        spieltag, dateStr, home, away,
                        scoreHome, scoreAway, played
                    });
                }
            }
        }
        return matches;
    }

    /**
     * Find historical results between two teams in a league.
     * Returns { matches: [...], wins: n, draws: n, losses: n } (from teamA perspective)
     */
    function findHistoricalResults(leagueName, teamAName, teamBName) {
        const allMatches = parseAllMatches(leagueName);
        const norm = s => s.toLowerCase().replace(/\u00a0/g, ' ').trim();
        const nA = norm(teamAName);
        const nB = norm(teamBName);

        const results = [];
        let wins = 0, draws = 0, losses = 0;

        for (const m of allMatches) {
            const nHome = norm(m.home);
            const nAway = norm(m.away);

            const isMatch = (nHome === nA && nAway === nB) ||
                (nHome === nB && nAway === nA);
            if (!isMatch || !m.played) continue;

            // Determine result from teamA perspective
            let teamAScore, teamBScore;
            if (nHome === nA) {
                teamAScore = m.scoreHome;
                teamBScore = m.scoreAway;
            } else {
                teamAScore = m.scoreAway;
                teamBScore = m.scoreHome;
            }

            if (teamAScore > teamBScore) wins++;
            else if (teamAScore < teamBScore) losses++;
            else draws++;

            results.push({
                spieltag: m.spieltag,
                dateStr: m.dateStr,
                home: m.home,
                away: m.away,
                scoreHome: m.scoreHome,
                scoreAway: m.scoreAway,
                teamAScore, teamBScore
            });
        }

        return { matches: results, wins, draws, losses };
    }

    /**
     * Get a player's form trend (last N played rounds).
     * Returns { values: [5,7,3,...], lastNAvg: x, totalAvg: y, trend: 'up'|'down'|'flat' }
     */
    function getPlayerFormTrend(player, n = 5) {
        const allValues = [];
        if (!player.rounds) return { values: [], lastNAvg: 0, totalAvg: 0, trend: 'flat' };

        for (let i = 1; i <= 18; i++) {
            const val = player.rounds[`R${i}`];
            if (val && val !== '&nbsp;' && val !== 'x' && !isNaN(parseInt(val))) {
                allValues.push(parseInt(val));
            }
        }

        if (allValues.length === 0) {
            return { values: [], lastNAvg: 0, totalAvg: 0, trend: 'flat' };
        }

        const totalAvg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        const lastN = allValues.slice(-n);
        const lastNAvg = lastN.reduce((a, b) => a + b, 0) / lastN.length;

        let trend = 'flat';
        if (lastN.length >= 3) {
            const firstHalf = lastN.slice(0, Math.floor(lastN.length / 2));
            const secondHalf = lastN.slice(Math.floor(lastN.length / 2));
            const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            if (avg2 - avg1 > 0.5) trend = 'up';
            else if (avg1 - avg2 > 0.5) trend = 'down';
        }

        return { values: lastN, lastNAvg, totalAvg, trend };
    }

    /**
     * Calculate the optimal lineup of n players from a roster to maximize avg.
     * Returns { players: [...], avg: number }
     */
    function calculateOptimalLineup(allPlayers, n = 4) {
        // Filter players with at least 1 game
        const eligible = allPlayers.filter(p => p._cnt >= 1);
        if (eligible.length <= n) {
            const avg = eligible.length > 0
                ? eligible.reduce((s, p) => s + p._avg, 0) / n
                : 0;
            return { players: eligible, avg };
        }

        // Generate combinations C(eligible, n) - brute force is fine for small n
        let bestCombo = null;
        let bestAvg = -1;

        const combine = (start, current) => {
            if (current.length === n) {
                const avg = current.reduce((s, p) => s + p._avg, 0) / n;
                if (avg > bestAvg) {
                    bestAvg = avg;
                    bestCombo = [...current];
                }
                return;
            }
            if (start >= eligible.length) return;
            if (eligible.length - start < n - current.length) return;

            for (let i = start; i < eligible.length; i++) {
                current.push(eligible[i]);
                combine(i + 1, current);
                current.pop();
            }
        };

        combine(0, []);
        return { players: bestCombo || [], avg: bestAvg };
    }

    /**
     * Detect the user's next upcoming match.
     * Returns { league, home, away, dateStr, spieltag } or null
     */
    function detectNextMatch() {
        // 1. Find the user's team name from the profile
        console.log('[AutoDetect] myPlayerName:', myPlayerName);
        const myProfile = rankingData.players.find(p => p.name === myPlayerName);
        if (!myProfile) {
            console.log('[AutoDetect] No profile found for', myPlayerName);
            return null;
        }

        const myV_nr = myProfile.v_nr;
        let detectedTeamName = myProfile.company || '';

        console.log('[AutoDetect] Profile found:', {
            v_nr: myV_nr, company: detectedTeamName, league: myProfile.league
        });

        // Try to find better team name from clubData
        if (myV_nr && clubData.clubs) {
            const club = clubData.clubs.find(c => String(c.number) === String(myV_nr));
            if (club) detectedTeamName = club.name;
        }

        if (!detectedTeamName) {
            console.log('[AutoDetect] No team name found');
            return null;
        }
        console.log('[AutoDetect] Team name:', detectedTeamName);

        // 2. Search ALL leagues for matches involving my team
        // (league names in rankingData vs leagueData often don't match)
        const norm = s => s.toLowerCase().replace(/\u00a0/g, ' ').trim();
        const nTeam = norm(detectedTeamName);
        const leagueKeys = Object.keys(leagueData.leagues || {});
        let allUpcoming = [];

        // Strict team name matching: avoid "DC Foo" matching "DC Foo 2"
        // Only match if names are equal, or if one contains the other
        // AND the remaining characters are NOT a team number suffix
        const teamMatch = (matchName, myName) => {
            if (matchName === myName) return true;
            // If matchName is longer, check it contains myName as a full name
            if (matchName.includes(myName)) {
                const rest = matchName.replace(myName, '').trim();
                // Reject if remainder is just a number (e.g. "2", "3")
                if (/^\d+$/.test(rest)) return false;
                return true;
            }
            if (myName.includes(matchName)) {
                const rest = myName.replace(matchName, '').trim();
                if (/^\d+$/.test(rest)) return false;
                return true;
            }
            return false;
        };

        for (const leagueName of leagueKeys) {
            const allMatches = parseAllMatches(leagueName);
            if (allMatches.length === 0) continue;

            // Check if this league has any match (played or unplayed)
            // involving the user's team (strict matching)
            const teamInLeague = allMatches.some(m => {
                const nH = norm(m.home);
                const nA = norm(m.away);
                return teamMatch(nH, nTeam) || teamMatch(nA, nTeam);
            });

            if (!teamInLeague) continue;
            console.log('[AutoDetect] Found team in league:', leagueName,
                '(', allMatches.length, 'matches)');

            // Collect unplayed matches for my team
            const upcoming = allMatches.filter(m => {
                if (m.played) return false;
                const nH = norm(m.home);
                const nA = norm(m.away);
                return teamMatch(nH, nTeam) || teamMatch(nA, nTeam);
            });

            upcoming.forEach(m => {
                allUpcoming.push({ ...m, league: leagueName });
            });
        }

        console.log('[AutoDetect] Total upcoming across all leagues:',
            allUpcoming.length);

        // Parse date helper (DD.MM.YYYY → Date)
        const parseDate = d => {
            const parts = d.split('.');
            if (parts.length === 3) {
                return new Date(parts[2], parts[1] - 1, parts[0]);
            }
            return new Date(9999, 0, 1);
        };

        // Filter out past matches (only keep today or future)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        allUpcoming = allUpcoming.filter(m => {
            const matchDate = parseDate(m.dateStr);
            return matchDate >= today;
        });

        console.log('[AutoDetect] Future upcoming matches:', allUpcoming.length);

        if (allUpcoming.length === 0) return null;

        // Sort by date (soonest first)
        allUpcoming.sort((a, b) => parseDate(a.dateStr) - parseDate(b.dateStr));

        const next = allUpcoming[0];
        console.log('[AutoDetect] Next match:', next);
        return {
            league: next.league,
            home: next.home,
            away: next.away,
            dateStr: next.dateStr,
            spieltag: next.spieltag,
            teamName: detectedTeamName
        };
    }

    /**
     * Render a small SVG sparkline for an array of values.
     * Returns an HTML string with an inline SVG.
     */
    function renderMatchSparkline(values, color = '#4ade80') {
        if (!values || values.length === 0) return '';
        const w = 80, h = 24, padding = 2;
        const max = Math.max(...values, 1);
        const min = 0;
        const range = max - min || 1;

        const points = values.map((v, i) => {
            const x = padding + (i / (values.length - 1 || 1)) * (w - 2 * padding);
            const y = h - padding - ((v - min) / range) * (h - 2 * padding);
            return `${x},${y}`;
        }).join(' ');

        return `<svg width="${w}" height="${h}" style="vertical-align: middle;">
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
            ${values.map((v, i) => {
            const x = padding + (i / (values.length - 1 || 1)) * (w - 2 * padding);
            const y = h - padding - ((v - min) / range) * (h - 2 * padding);
            return `<circle cx="${x}" cy="${y}" r="2" fill="${color}"/>`;
        }).join('')}
        </svg>`;
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

        // HISTORICAL RESULTS CONTAINER (shown after team selection)
        const historyDiv = document.createElement('div');
        historyDiv.id = 'historical-results';
        container.appendChild(historyDiv);

        // RESULT CONTAINER
        const resultDiv = document.createElement('div');
        resultDiv.id = 'preview-results';
        container.appendChild(resultDiv);

        contentArea.appendChild(container);

        // AUTO-DETECT NEXT MATCH
        try {
            const nextMatch = detectNextMatch();
            if (nextMatch) {
                const banner = document.createElement('div');
                banner.style.cssText = 'background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%); padding: 15px 20px; border-radius: 8px; border: 1px solid #3b82f6; margin-bottom: 20px; cursor: pointer; display: flex; align-items: center; gap: 12px;';
                banner.innerHTML = `
                    <span style="font-size: 1.5em;">🎯</span>
                    <div style="flex: 1;">
                        <div style="font-size: 0.75em; color: #60a5fa; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Nächstes Spiel erkannt</div>
                        <div style="color: #f8fafc; font-weight: bold;">${nextMatch.home} vs ${nextMatch.away}</div>
                        <div style="color: #94a3b8; font-size: 0.85em;">${nextMatch.spieltag} · ${nextMatch.dateStr || 'Datum unbekannt'}</div>
                    </div>
                    <div style="background: #3b82f6; color: white; padding: 6px 14px; border-radius: 6px; font-size: 0.85em; font-weight: bold;">Laden →</div>
                `;
                banner.addEventListener('click', () => {
                    // Auto-select league
                    leagueSelect.value = nextMatch.league;
                    leagueSelect.dispatchEvent(new Event('change'));

                    // Auto-select teams after a short delay to let league change populate teams
                    setTimeout(() => {
                        const norm = s => s.toLowerCase().replace(/\u00a0/g, ' ').trim();
                        const findTeamOption = (select, teamName) => {
                            const nTeam = norm(teamName);
                            for (const opt of select.options) {
                                if (!opt.value) continue;
                                const nOpt = norm(opt.textContent);
                                if (nOpt === nTeam || nOpt.includes(nTeam) || nTeam.includes(nOpt)) return opt.value;
                            }
                            return null;
                        };

                        const homeVal = findTeamOption(teamASelect, nextMatch.home);
                        const awayVal = findTeamOption(teamBSelect, nextMatch.away);

                        if (homeVal) { teamASelect.value = homeVal; }
                        if (awayVal) { teamBSelect.value = awayVal; }

                        updateExclusions();
                        loadSelection();
                        banner.style.border = '1px solid #22c55e';
                        banner.querySelector('div[style*="background: #3b82f6"]').textContent = '✓ Geladen';
                        banner.querySelector('div[style*="background: #3b82f6"]').style.background = '#22c55e';
                    }, 200);
                });

                container.insertBefore(banner, card);
            }
        } catch (e) {
            console.warn('[Match Preview] Auto-detect error:', e);
        }

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

                // === FEATURE 3: Historical Results ===
                try {
                    const history = findHistoricalResults(league, nameA, nameB);
                    if (history.matches.length > 0) {
                        let hHtml = `
                        <div style="background: #1e293b; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
                            <h4 style="color: #f59e0b; margin-bottom: 15px;">📜 Historische Ergebnisse (${nameA} vs ${nameB})</h4>
                            <div style="display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap;">
                                <div style="background: #22c55e22; color: #4ade80; padding: 8px 16px; border-radius: 6px; font-weight: bold;">${history.wins} Sieg${history.wins !== 1 ? 'e' : ''}</div>
                                <div style="background: #64748b22; color: #94a3b8; padding: 8px 16px; border-radius: 6px; font-weight: bold;">${history.draws} Unentschieden</div>
                                <div style="background: #ef444422; color: #f87171; padding: 8px 16px; border-radius: 6px; font-weight: bold;">${history.losses} Niederlage${history.losses !== 1 ? 'n' : ''}</div>
                            </div>
                            <div style="font-size: 0.85em;">`;
                        history.matches.forEach(m => {
                            const isWin = m.teamAScore > m.teamBScore;
                            const isDraw = m.teamAScore === m.teamBScore;
                            const icon = isWin ? '🟢' : isDraw ? '🟡' : '🔴';
                            hHtml += `<div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1e293b40; color: #cbd5e1;">
                                <span>${icon} ${m.spieltag} · ${m.dateStr || ''}</span>
                                <span style="font-weight: bold;">${m.home} ${m.scoreHome}:${m.scoreAway} ${m.away}</span>
                            </div>`;
                        });
                        hHtml += `</div></div>`;
                        historyDiv.innerHTML = hHtml;
                    } else {
                        historyDiv.innerHTML = '';
                    }
                } catch (e) {
                    console.warn('[Match Preview] History error:', e);
                    historyDiv.innerHTML = '';
                }
            } else {
                selectionArea.style.display = "none";
                historyDiv.innerHTML = '';
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
                
                <div style="text-align: center; font-size: 0.9em; color: #64748b; margin-bottom: 20px;">
                    Durchschnitt der gewählten Spieler (${listA.length} vs ${listB.length})
                </div>
             </div>`;

            // === FEATURE 4: FORMKURVE / TREND ===
            if (listA.length > 0 || listB.length > 0) {
                html += `<div style="background: #1e293b; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
                    <h4 style="color: #a78bfa; margin-bottom: 15px;">📈 Formkurve (Letzte 5 Runden)</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">`;

                // Team A form
                html += `<div><h5 style="color: #4ade80; margin-bottom: 10px;">${nameA}</h5>`;
                listA.forEach(p => {
                    const form = getPlayerFormTrend(p);
                    const trendIcon = form.trend === 'up' ? '📈' : form.trend === 'down' ? '📉' : '➡️';
                    const trendColor = form.trend === 'up' ? '#4ade80' : form.trend === 'down' ? '#f87171' : '#94a3b8';
                    html += `<div style="display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #33415544;">
                        <span style="color: #cbd5e1; min-width: 100px; font-size: 0.85em;" class="${p.name === myPlayerName ? 'my-player-text' : ''}">${p.name}</span>
                        ${renderMatchSparkline(form.values, trendColor)}
                        <span style="font-size: 0.9em;">${trendIcon}</span>
                        <span style="color: #94a3b8; font-size: 0.75em;">Ø${form.lastNAvg.toFixed(1)}</span>
                    </div>`;
                });
                html += '</div>';

                // Team B form
                html += `<div><h5 style="color: #60a5fa; margin-bottom: 10px;">${nameB}</h5>`;
                listB.forEach(p => {
                    const form = getPlayerFormTrend(p);
                    const trendIcon = form.trend === 'up' ? '📈' : form.trend === 'down' ? '📉' : '➡️';
                    const trendColor = form.trend === 'up' ? '#4ade80' : form.trend === 'down' ? '#f87171' : '#94a3b8';
                    html += `<div style="display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #33415544;">
                        <span style="color: #cbd5e1; min-width: 100px; font-size: 0.85em;" class="${p.name === myPlayerName ? 'my-player-text' : ''}">${p.name}</span>
                        ${renderMatchSparkline(form.values, trendColor)}
                        <span style="font-size: 0.9em;">${trendIcon}</span>
                        <span style="color: #94a3b8; font-size: 0.75em;">Ø${form.lastNAvg.toFixed(1)}</span>
                    </div>`;
                });
                html += '</div></div></div>';
            }

            // === FEATURE 1: HEAD-TO-HEAD 1v1 MATRIX ===
            if (listA.length > 0 && listB.length > 0) {
                html += `<div style="background: #1e293b; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
                    <h4 style="color: #fb923c; margin-bottom: 15px;">⚔️ 1v1 Paarungen</h4>
                    <div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
                    <tr><th style="padding: 8px; color: #64748b; text-align: left; border-bottom: 2px solid #334155;"></th>`;

                listB.forEach(pb => {
                    const parts = pb.name.split(' ');
                    const shortName = parts.length > 1 ? parts[0].substring(0, 2) + '. ' + parts.slice(1).join(' ') : pb.name;
                    html += `<th style="padding: 8px; color: #60a5fa; text-align: center; border-bottom: 2px solid #334155; white-space: nowrap;">${shortName}</th>`;
                });
                html += '</tr>';

                listA.forEach(pa => {
                    const parts = pa.name.split(' ');
                    const shortName = parts.length > 1 ? parts[0].substring(0, 2) + '. ' + parts.slice(1).join(' ') : pa.name;
                    html += `<tr><td style="padding: 8px; color: #4ade80; font-weight: bold; border-bottom: 1px solid #33415544; white-space: nowrap;">${shortName}</td>`;
                    listB.forEach(pb => {
                        const totalAvg = pa._avg + pb._avg;
                        const winProb = totalAvg > 0 ? (pa._avg / totalAvg) * 100 : 50;
                        // Color: green >55%, red <45%, neutral otherwise
                        let cellBg, cellColor;
                        if (winProb >= 55) {
                            cellBg = `rgba(34, 197, 94, ${Math.min((winProb - 50) / 30, 0.4)})`;
                            cellColor = '#4ade80';
                        } else if (winProb <= 45) {
                            cellBg = `rgba(239, 68, 68, ${Math.min((50 - winProb) / 30, 0.4)})`;
                            cellColor = '#f87171';
                        } else {
                            cellBg = 'rgba(148, 163, 184, 0.1)';
                            cellColor = '#cbd5e1';
                        }
                        html += `<td style="padding: 8px; text-align: center; background: ${cellBg}; color: ${cellColor}; font-weight: bold; border-bottom: 1px solid #33415544;">${winProb.toFixed(0)}%</td>`;
                    });
                    html += '</tr>';
                });
                html += '</table></div></div>';
            }

            // === FEATURE 2: OPTIMALE AUFSTELLUNG ===
            if (playersA.length > 4 || playersB.length > 4) {
                html += `<div style="background: #1e293b; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
                    <h4 style="color: #34d399; margin-bottom: 15px;">🏆 Optimale Aufstellung</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">`;

                // Team A optimal
                if (playersA.length > 4) {
                    const optA = calculateOptimalLineup(playersA, 4);
                    html += `<div style="background: #0f172a; padding: 15px; border-radius: 6px;">
                        <div style="color: #4ade80; font-weight: bold; margin-bottom: 10px;">${nameA} – Empfehlung</div>`;
                    optA.players.forEach(p => {
                        html += `<div style="display: flex; justify-content: space-between; padding: 4px 0; color: #cbd5e1; font-size: 0.9em;">
                            <span class="${p.name === myPlayerName ? 'my-player-text' : ''}">${p.name}</span>
                            <span style="color: #4ade80; font-weight: bold;">Ø ${p._avg.toFixed(2)}</span>
                        </div>`;
                    });
                    html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #334155; color: #4ade80; font-weight: bold; text-align: right;">Team-Ø: ${optA.avg.toFixed(2)}</div></div>`;
                }

                // Team B optimal
                if (playersB.length > 4) {
                    const optB = calculateOptimalLineup(playersB, 4);
                    html += `<div style="background: #0f172a; padding: 15px; border-radius: 6px;">
                        <div style="color: #60a5fa; font-weight: bold; margin-bottom: 10px;">${nameB} – Empfehlung</div>`;
                    optB.players.forEach(p => {
                        html += `<div style="display: flex; justify-content: space-between; padding: 4px 0; color: #cbd5e1; font-size: 0.9em;">
                            <span class="${p.name === myPlayerName ? 'my-player-text' : ''}">${p.name}</span>
                            <span style="color: #60a5fa; font-weight: bold;">Ø ${p._avg.toFixed(2)}</span>
                        </div>`;
                    });
                    html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #334155; color: #60a5fa; font-weight: bold; text-align: right;">Team-Ø: ${optB.avg.toFixed(2)}</div></div>`;
                }

                html += '</div></div>';
            }

            resultDiv.innerHTML = html;
            resultDiv.scrollIntoView({ behavior: 'smooth' });
        });
    }


    // Expose triggerUpdate globally so the button onclick works
    window.triggerUpdate = function () {
        console.log('[Update] triggerUpdate called');
        const btn = document.getElementById('update-btn');
        const updateStatus = document.getElementById('update-status');
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        console.log('[Update] hostname:', window.location.hostname, 'isLocalhost:', isLocalhost);

        if (!isLocalhost) {
            console.log('[Update] Not localhost, reloading page...');
            // On static hosting (GitHub Pages), we can't trigger the python scraper.
            // But we CAN reload the page to fetch the latest data files (handled by Network-First SW).
            if (btn) {
                btn.innerHTML = "⏳ Lädt...";
                btn.disabled = true;
            }

            // Force reload after short delay to show feedback
            setTimeout(() => {
                window.location.reload();
            }, 500);
            return;
        }

        console.log('[Update] Localhost detected, starting update...');

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = "⏳ läuft...";
        }
        // Snapshot current stats before update
        try {
            const stats = calculateDataStats();
            localStorage.setItem('update_snapshot', JSON.stringify(stats));
        } catch (e) { console.error("Snapshot failed", e); }

        let pollInterval;

        if (updateStatus) {
            updateStatus.textContent = "Starten...";
            updateStatus.classList.remove('hidden');
            updateStatus.style.color = "#94a3b8"; // reset color

            // Poll for status
            pollInterval = setInterval(() => {
                fetch('update_status.json?t=' + Date.now())
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.status) {
                            if (data.status === 'running') {
                                updateStatus.innerHTML = `Update läuft... ${data.progress}%<br><span style="font-size:0.8em; color:#64748b">${data.current_script || ''}</span>`;
                            } else if (data.status === 'error') {
                                updateStatus.textContent = `Fehler bei: ${data.current_script}`;
                                updateStatus.style.color = "#f87171"; // red
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
                    if (updateStatus) {
                        updateStatus.textContent = "Erfolg! 100% - Seite wird neu geladen...";
                        updateStatus.style.color = "#4ade80"; // green
                    }
                    setTimeout(() => location.reload(), 1500);
                } else {
                    throw new Error(data.message || "Unknown error");
                }
            })
            .catch(e => {
                if (pollInterval) clearInterval(pollInterval);
                if (updateStatus) {
                    updateStatus.textContent = "Fehler: " + e.message;
                    updateStatus.style.color = "#f87171"; // red
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

    function renderWiki() {
        topBarTitle.textContent = "Anleitung / Wiki";
        contentArea.innerHTML = '';

        const container = document.createElement('div');
        container.className = "fade-in";
        container.style.padding = "20px";
        container.style.maxWidth = "800px";
        container.style.margin = "0 auto";
        container.style.color = "#e2e8f0";

        container.innerHTML = `
            <div style="background: #1e293b; padding: 25px; border-radius: 12px; border: 1px solid #334155;">
                <h2 style="color: #60a5fa; border-bottom: 2px solid #334155; padding-bottom: 10px; margin-bottom: 20px;">📘 BWEDL Stats - Benutzerhandbuch</h2>
                
                <p>Willkommen bei <strong>BWEDL Stats</strong>, deiner App für Darts-Statistiken, Tabellen und Tools rund um die <em>Baden-Württembergische E-Dart Liga</em>.</p>

                <h3 style="color: #f8fafc; margin-top: 25px;">🚀 Schnelleinstieg</h3>
                <p>Die App ist in drei Hauptbereiche unterteilt:</p>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Dashboard</strong>: Deine persönliche Übersicht (Favoriten, nächste Spiele).</li>
                    <li><strong>Ligen</strong>: Alle Tabellen, Ergebnisse und Schedules der aktuellen Saison.</li>
                    <li><strong>Tools</strong>: Nützliche Helfer wie der Match Scorer oder H2H-Vergleich.</li>
                </ul>

                <hr style="border-color: #334155; margin: 30px 0;">

                <h3 style="color: #f8fafc;">🧭 Navigation & Bereiche</h3>

                <h4 style="color: #94a3b8; margin-top: 20px;">1. Dashboard</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Favoriten</strong>: Markiere Spieler (⭐), um ihre Statistiken sofort zu sehen.</li>
                    <li><strong>Suche</strong>: Nutze die Suchleiste oben links, um schnell nach <em>Spielern</em> oder <em>Vereinen</em> zu suchen.</li>
                    <li><strong>Status</strong>: Oben links siehst du, wann die Daten zuletzt aktualisiert wurden.</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">2. Ligen & Tabellen</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Tabelle</strong>: Die aktuelle Rangliste.</li>
                    <li><strong>Ergebnisse</strong>: Alle Spieltage und Match-Details (klicke auf ein Match für Details).</li>
                    <li><strong>Einzelkritik</strong>: Klicke auf einen Spieler in der Tabelle, um seine persönlichen Stats zu sehen.</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">3. Vereinsseiten</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Quick Stats</strong>: Überblick über Mitgliederzahl, aktive Ligen und Gesamtpunkte.</li>
                    <li><strong>Details</strong>: Adresse, Kontaktinfos und Link zum Spielort.</li>
                    <li><strong>Kader</strong>: Liste aller Spieler mit aktueller Liga und Rang.</li>
                    <li><strong>Archiv</strong>: Historie des Vereins aus vergangenen Saisons.</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">4. Spieler-Profile</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Formkurve</strong>: Die letzten Spiele und Trend.</li>
                    <li><strong>Saisonverlauf</strong>: Detaillierte Liste aller gespielten Runden.</li>
                    <li><strong>Head-to-Head</strong>: Vergleiche diesen Spieler direkt mit einem anderen.</li>
                </ul>

                <hr style="border-color: #334155; margin: 30px 0;">

                <h3 style="color: #f8fafc;">🛠️ Tools & Features</h3>

                <h4 style="color: #94a3b8; margin-top: 20px;">⚔️ H2H Vergleich</h4>
                <p>Vergleiche zwei Spieler direkt miteinander: Titel, Erfahrung, Form.</p>

                <h4 style="color: #94a3b8; margin-top: 20px;">🎯 Match Scorer</h4>
                <ul style="padding-left: 20px; line-height: 1.6;">
                    <li><strong>Verschiedene Modi</strong>: Spiele 1vs1 (Single Out), Double Out, Master Out oder <strong>Liga (2vs2)</strong>.</li>
                    <li><strong>Liga-Modus</strong>: Spezieller 2vs2 Modus mit Block-Regel.</li>
                    <li><strong>Spracheingabe</strong>: Scorer per Stimme ("Hundertachtzig").</li>
                    <li><strong>Dartboard-Input</strong>: Tippe auf das Board.</li>
                    <li><strong>Checkout-Hilfe</strong>: Wege zum Finish (z.B. T20 - D20).</li>
                </ul>

                <h4 style="color: #94a3b8; margin-top: 20px;">📱 Installation (App)</h4>
                <p>Installiere diese Seite als App auf deinem Homescreen (iOS/Android), um sie wie eine normale App zu nutzen.</p>

                <hr style="border-color: #334155; margin: 30px 0;">

                <h3 style="color: #f8fafc;">❓ FAQ</h3>
                <p><strong>Wie oft werden die Daten aktualisiert?</strong><br>
                Die Webseite und App werden automatisch <strong>alle 6 Stunden</strong> aktualisiert. Der "Aktualisieren"-Button im Menü prüft nur, ob neue Daten auf dem Server bereitliegen.</p>
                <p><em>Hinweis: Ein komplett manuelles Anstoßen des Updates ist nur möglich, wenn das Programm direkt auf dem PC ausgeführt wird.</em></p>

                <p><strong>Kann ich alte Saisons sehen?</strong><br>
                Ja, im "Archiv" auf den Vereins- und Spielerseiten.</p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #64748b; font-size: 0.8em;">
                <a href="https://github.com/tobias-rohde-93/BWEDL-Stats/wiki" target="_blank" style="color: #64748b; text-decoration: underline;">
                    Doku auch auf GitHub ansehen
                </a>
            </div>
        `;

        contentArea.appendChild(container);
    }
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

    // Global Update Trigger
    // Original duplicate triggerUpdate removed to fix bug
});