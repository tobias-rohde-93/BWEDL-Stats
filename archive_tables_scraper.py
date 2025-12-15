
import asyncio
from playwright.async_api import async_playwright
import json
import re

BASE_URL = "https://www.bwedl.de"
ARCHIVE_URL = f"{BASE_URL}/archiv/"

async def scrape_archive_tables():
    print(f"Starting Archive Tables Scrape from {ARCHIVE_URL}")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        # Go to Archive Overview
        try:
            await page.goto(ARCHIVE_URL, wait_until="networkidle", timeout=60000)
        except Exception as e:
            print(f"Error accessing archive url: {e}")
            await browser.close()
            return

        # Extract Season Links
        season_links = await page.evaluate('''() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
                .filter(a => a.href.includes('/archiv/'))
                .map(a => ({ href: a.href, text: a.innerText.trim() }));
        }''')

        unique_seasons = {}
        for s in season_links:
            text = s['text']
            href = s['href']
            
            # Identify if it's a season link (YYYY/YYYY or similar)
            match = re.search(r"(\d{4})[/-](\d{4})", text) or re.search(r"(\d{4})[/-](\d{4})", href)
            
            if match:
                y1 = match.group(1)
                y2 = match.group(2)
                
                # We want mainly recent history but user asked for "each season", let's be generous. 
                # The site might have data back to 2010 or so.
                if int(y1) >= 2010:
                    key = f"{y1}/{y2}"
                    clean_text = text if "Saison" in text else f"Saison {key}"
                    if href not in unique_seasons:
                         unique_seasons[href] = clean_text
        
        print(f"Found {len(unique_seasons)} seasons to scrape.")
        
        all_tables = [] 

        for url, season_name in unique_seasons.items():
            print(f"Scraping Season: {season_name} ({url})")
            
            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)

                # --- SUB-LINK LOGIC START ---
                # Retrieve ALL potential sub-links (Ranglisten, Tabellen, Klassen, Pokal, Meisterschaften)
                sub_links = await page.evaluate('''() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const seen = new Set();
                    
                    return links
                        .filter(a => {
                            const h = a.href.toLowerCase();
                            const t = a.innerText.toLowerCase();
                            
                            if (h === window.location.href || h.endsWith("#")) return false;
                            if (h.endsWith("/ranglisten/") || h === "https://www.bwedl.de/") return false;
                            if (seen.has(h)) return false;
                            
                            // Criteria: path has "archiv" OR text implies a competition
                            const isArchive = h.includes("/archive/") || h.includes("/archiv/") || h.match(/\\d{4}.\\d{4}/);
                            
                            const isCompetition = t.includes("klasse") || 
                                                  t.includes("liga") || 
                                                  t.includes("pokal") || 
                                                  t.includes("meisterschaft") ||
                                                  t.includes("rangliste") ||
                                                  t.includes("tabelle");

                            if (isArchive && isCompetition) {
                                seen.add(h);
                                return true;
                            }
                            return false;
                        })
                        .map(a => ({ href: a.href, text: a.innerText.trim() }));
                }''')

                urls_to_scrape = [url] # Always scrape the main landing page too
                for link in sub_links:
                    if link['href'] not in urls_to_scrape:
                        print(f"  Found sub-page: {link['text']} -> {link['href']}")
                        urls_to_scrape.append(link['href'])
                
                # --- SUB-LINK LOGIC END ---

                # Scrape ALL identified pages for this season
                for target_url in urls_to_scrape:
                    if target_url != url:
                         try:
                             await page.goto(target_url, wait_until="networkidle", timeout=20000)
                         except:
                             continue
                    
                    # Extract Tables on this page
                    extracted_tables = await page.evaluate('''() => {
                    const results = [];
                    const tables = Array.from(document.querySelectorAll('table'));
                    
                    tables.forEach(table => {
                        // Attempt to find a preceding header to identify the league OR the section (Round)
                        let sibling = table.previousElementSibling;
                        let leagueName = "Unbekannt";
                        let initialSection = "";
                        let lookback = 0;
                        
                        while(sibling && lookback < 15) {
                            const txt = sibling.innerText ? sibling.innerText.trim() : "";
                            // Check for common league names
                            if (txt.match(/(Bezirksliga|Klasse|Oberliga|Verbandsliga|Bundesliga|Pokal)/i)) {
                                leagueName = txt;
                            }
                            // Check for Section/Round info (e.g. "Achtelfinale", "Runde 1")
                            // prioritize the closest one for section
                            if (!initialSection && txt.match(/(Finale|Runde|Spieltag|Gruppe)/i)) {
                                initialSection = txt;
                            }
                            
                            if (leagueName !== "Unbekannt" && initialSection) break;
                            
                            sibling = sibling.previousElementSibling;
                            lookback++;
                        }
                        
                        // Extract rows with Section/Round context
                        // We iterate manually to capture "Header Rows" (e.g. "Runde 1" spanning all cols)
                        let currentAcc = [];
                        let currentSection = initialSection; // Start with external section info if found
                        
                        const rows = Array.from(table.querySelectorAll('tr'));
                        
                        // First pass: check if we have a header row
                        // Often the first row is headers: ["Datum", "Heim", ...]
                        // If we find headers, we want to add "Runde" to it.
                        
                        rows.forEach((tr, index) => {
                            const cells = Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim().replace(/\\n/g, ' '));
                            
                            if (cells.length === 0) return;
                            
                            const rowText = cells.join(' ').toLowerCase();
                            const hasScore = /\d+:\d+/.test(rowText);
                            const isTableHeader = /heim|gast|tabelle|spiel-?nr/.test(rowText) && !/team/.test(rowText); // Avoid matching "Team" in club names
                            
                            // Heuristic for Section Header:
                            // 1. Single cell
                            // 2. OR Multi-cell but NO score AND NO table header keywords (and looks like a title, e.g. "Achtelfinale")
                            const isSectionHeader = (cells.length === 1) || (!hasScore && !isTableHeader && cells.length > 1 && cells.some(c => /finale|runde|spieltag|gruppe/i.test(c)));

                            if (isSectionHeader && !isTableHeader) {
                                // Update current section
                                // Use the first non-empty cell as the section name
                                const sectionName = cells.find(c => c.length > 2);
                                if (sectionName) {
                                    currentSection = sectionName;
                                }
                            } else if (cells.length > 2 || (cells.length === 2 && hasScore)) {
                                // It's likely a data row
                                
                                // CLONE the cells array
                                let newRow = [...cells];
                                
                                if (isTableHeader) {
                                    // Add "Runde" header
                                    newRow.unshift("Runde/Info");
                                } else {
                                    // Add current section value (or empty if none)
                                    newRow.unshift(currentSection);
                                }
                                
                                currentAcc.push(newRow);
                            }
                        });


                        if (currentAcc.length > 2) { // meaningful table
                             results.push({
                                 league: leagueName,
                                 rows: currentAcc
                             });
                        }
                    });
                    return results;
                }''')
                
                    clean_season = season_name.replace("Saison ", "").strip()
                    
                    for t in extracted_tables:
                        # Filter out non-league tables if possible? 
                        # If it has "Platz" or "Team" or "Verein" in header/first row, it's good.
                        if len(t['rows']) > 0:
                            first_row_str = " ".join(t['rows'][0]).lower()
                            # It must contain "tabelle" or "team" or "mannschaft" or "verein" or "heim" (for matches)
                            # to be a team table. "Tabelle" is the standard header for league tables.
                            
                            is_team_table = any(x in first_row_str for x in ["tabelle", "team", "mannschaft", "verein", "heim", "gast"])
                            is_player_ranking = any(x in first_row_str for x in ["vorname", "nachname", "spieler", "bestleistungen", "name"])
                            
                            if is_team_table and not is_player_ranking:
                                # Simple heuristic: must look like a table
                                if len(t['rows']) >= 3:
                                     all_tables.append({
                                         "season": clean_season,
                                         "league": t['league'],
                                         "rows": t['rows']
                                     })
                
            except Exception as e:
                print(f"  Error processing {season_name}: {e}")

        await browser.close()
        
        js_content = f"window.ARCHIVE_TABLES = {json.dumps(all_tables, indent=2)};"
        with open("archive_tables.js", "w", encoding="utf-8") as f:
            f.write(js_content)
        print(f"Archive tables saved to archive_tables.js. Total Tables: {len(all_tables)}")

if __name__ == "__main__":
    asyncio.run(scrape_archive_tables())
