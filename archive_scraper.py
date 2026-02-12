
import asyncio
from playwright.async_api import async_playwright
import json
import re

BASE_URL = "https://www.bwedl.de"
ARCHIVE_URL = f"{BASE_URL}/archiv/"

async def scrape_archive():
    print(f"Starting Archive Scrape from {ARCHIVE_URL}")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        # Extract Season Links
        await page.goto(ARCHIVE_URL, wait_until="networkidle")
        
        # Extract All Archive Links
        season_links = await page.evaluate('''() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
                .filter(a => a.href.includes('/archiv/'))
                .map(a => ({ href: a.href, text: a.innerText.trim() }));
        }''')

        print(f"DEBUG: found {len(season_links)} raw archive links.")

        # Deduplicate and Filter
        unique_seasons = {}
        for s in season_links:
            text = s['text']
            href = s['href']
            
            # Identify if it's a season link
            match = re.search(r"(\d{4})[/-](\d{4})", text) or re.search(r"(\d{4})[/-](\d{4})", href)
            
            if match:
                # Normalize key
                y1 = match.group(1)
                y2 = match.group(2)
                
                # Check for plausible years (e.g. 2020+)
                if int(y1) >= 2020:
                    key = f"{y1}/{y2}"
                    # Prefer text match if available, otherwise just use key
                    clean_text = text if "Saison" in text or "/" in text else f"Saison {key}"
                    
                    # Avoid duplicates (use first found or prefer text with "Saison")
                    if href not in unique_seasons:
                         unique_seasons[href] = clean_text
        
        print(f"DEBUG: Unique seasons to scrape: {unique_seasons}")
        
        all_history = {} 

        if not unique_seasons:
            print("ERROR: No unique seasons found to scrape!")
        
        for url, season_name in unique_seasons.items():
            print(f"--------------------------------------------------")
            print(f"Starting Scrape for Season: {season_name}")
            print(f"  Landing URL: {url}")
            
            try:
                await page.goto(url, wait_until="networkidle")
                
                # Check for "Ranglisten" sub-link if tables not immediately obvious
                sub_link = await page.evaluate('''() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    
                    // Filter out main nav links or generic links
                    const candidates = links.filter(a => {
                        const h = a.href.toLowerCase();
                        // Must not be the main ranking page or home
                        if (h.endsWith("/ranglisten/") || h === "https://www.bwedl.de/") return false;
                        // Must be in archive or contain season years
                        return h.includes("/archiv/") || h.match(/\\d{4}.\\d{4}/);
                    });

                    // Try exact "Ranglisten" match first within candidates
                    let rankLink = candidates.find(a => a.innerText.toLowerCase().includes("ranglisten"));
                    
                    // Fallback: Try finding a link text that contains the season years
                    if (!rankLink) {
                         const urlParts = window.location.href.split('/');
                         const seasonPart = urlParts[urlParts.length - 2] || urlParts[urlParts.length - 1]; 
                         const yearMatch = seasonPart.match(/(\\d{4}.\\d{4})/);
                         if (yearMatch) {
                              const years = yearMatch[1];
                              rankLink = candidates.find(a => a.innerText.includes(years));
                         }
                    }
                    
                    if (rankLink) return { found: true, href: rankLink.href, text: rankLink.innerText };
                    
                    return { found: false };
                }''')
                
                if sub_link['found']:
                     target_url = sub_link['href']
                     if target_url != url:
                        print(f"  Found sub-link to Rankings: {sub_link['text']} -> {target_url}")
                        await page.goto(target_url, wait_until="networkidle")

                # Wait for tables
                try:
                    await page.wait_for_selector('table', timeout=5000)
                except:
                    pass # No tables found, continue to next season
                
                # Extract Tables using Text Search (Robust Logic)
                tables_data = await page.evaluate('''() => {
                    const extracted = [];
                    const processedSet = new Set();
                    
                    function extractTableData(table, league) {
                        const rows = Array.from(table.querySelectorAll('tbody tr'));
                        const data = rows.map(tr => {
                            const cells = Array.from(tr.querySelectorAll('td'));
                            if (cells.length < 3) return null;
                            return cells.map(c => c.innerText.trim());
                        }).filter(r => r !== null);
                        return { league: league, rows: data };
                    }

                    // Strategy 1: Forward Search from Headers
                    const headers = Array.from(document.querySelectorAll('b, strong, h2, h3, h4, div'));
                    headers.forEach(h => {
                        const txt = (h.innerText || "").trim();
                        let league = "";
                        if (txt.includes("Bezirksliga")) league = "Bezirksliga";
                        else if (txt.includes("A-Klasse")) league = "A-Klasse";
                        else if (txt.includes("B-Klasse")) league = "B-Klasse";
                        else if (txt.includes("C-Klasse")) league = "C-Klasse";
                        else if (txt.includes("Bezirksoberliga")) league = "Bezirksoberliga"; 

                        if (league) {
                            let sibling = h.nextElementSibling;
                            let count = 0;
                            while(sibling && count < 10) {
                                if (sibling.tagName === 'TABLE') {
                                    if (!processedSet.has(sibling)) {
                                        processedSet.add(sibling);
                                        extracted.push(extractTableData(sibling, league));
                                    }
                                    break; 
                                }
                                sibling = sibling.nextElementSibling;
                                count++;
                            }
                        }
                    });

                    // Strategy 2: Backward Search from Tables
                    const tables = document.querySelectorAll('table');
                    tables.forEach(table => {
                        if (processedSet.has(table)) return;

                        let sibling = table.previousElementSibling;
                        let foundLeague = "";
                        let count = 0;
                        while(sibling && count < 10 && !foundLeague) {
                            const txt = (sibling.innerText || "").trim();
                            if (txt.includes("Bezirksliga")) foundLeague = "Bezirksliga";
                            else if (txt.includes("A-Klasse")) foundLeague = "A-Klasse";
                            else if (txt.includes("B-Klasse")) foundLeague = "B-Klasse";
                            else if (txt.includes("C-Klasse")) foundLeague = "C-Klasse";
                            else if (txt.includes("Bezirksoberliga")) foundLeague = "Bezirksoberliga";
                            
                            sibling = sibling.previousElementSibling;
                            count++;
                        }
                        if (foundLeague) {
                            processedSet.add(table);
                            extracted.push(extractTableData(table, foundLeague));
                        }
                    });
                    
                    return extracted;
                }''')
                
                print(f"  Found {len(tables_data)} league tables on {page.url}.")
                
                for table in tables_data:
                    league = table['league']
                    
                    for row in table['rows']:
                        if len(row) < 3: continue

                        # Parsing logic
                        # Dynamic Column Detection
                        # We expect: Rank | (Club) | Name | ID | ...  OR  Rank | Name | ID ...
                        
                        rank = 0
                        try:
                            rank = int(row[0].replace('.', ''))
                        except:
                            pass
                            
                        p_id = ""
                        p_name = "Unbekannt"
                        
                        # Find the Player ID column (digits, usually > 99)
                        id_idx = -1
                        
                        # Scan typical range for ID (indices 1 to 4)
                        for i in range(1, min(len(row), 5)):
                            val = row[i].strip()
                            if val.isdigit() and int(val) > 99:
                                # Found a candidate ID
                                
                                # Verification: Name should be adjacent and NOT a number
                                # Check Left (i-1)
                                if i > 0 and not row[i-1].strip().isdigit():
                                    id_idx = i
                                    break
                                
                                # Check Right (i+1) - e.g. Rank | ID | Name
                                if i < len(row)-1 and not row[i+1].strip().isdigit():
                                     # This could be the ID
                                     # But let's verify if i-1 was maybe the Club ID (digits)
                                     # If i-1 is digits (Club) and i is ID, then Name is i+1?
                                     # Or Name is i-2?
                                     id_idx = i
                                     # Don't break yet, prefer standard (Name | ID) if found later?
                                     # Actually Name|ID is most common.
                        

                        # Helper to check if a string is a likely name (contains letters)
                        def is_valid_name(s):
                            s = s.strip()
                            if not s: return False
                            if s.isdigit(): return False
                            # Must contain at least one letter?
                            if not re.search(r'[a-zA-Z]', s): return False
                            return True

                        if id_idx != -1:
                            p_id = row[id_idx].strip()
                            
                            # Deduce Name Position relative to ID

                        if id_idx != -1:
                            p_id = row[id_idx].strip()
                            
                            # Deduce Name Position relative to ID
                            
                            # Pattern A: ID | First Name | Last Name (Common in 2022+ archives)
                            # e.g. ['1', '030', '1560', 'Thomas', 'Köhnlein', ...]
                            # ID is at id_idx. Name is id_idx+1 and id_idx+2
                            if id_idx < len(row)-2 and is_valid_name(row[id_idx+1]):
                                first = row[id_idx+1].strip()
                                last = ""
                                if is_valid_name(row[id_idx+2]):
                                    last = row[id_idx+2].strip()
                                
                                if last:
                                    p_name = f"{first} {last}"
                                else:
                                    p_name = first
                            
                            # Pattern B: Name | ID (Legacy?)
                            # Check if left neighbor is text
                            elif id_idx > 0 and is_valid_name(row[id_idx-1]):
                                p_name = row[id_idx-1].strip()
                            
                            # Pattern C: ID | Name (Single column)
                            elif id_idx < len(row)-1 and is_valid_name(row[id_idx+1]):
                                p_name = row[id_idx+1].strip()

                        # Fallback for very short rows or weird formats
                        if p_name == "Unbekannt" or not is_valid_name(p_name):
                             # Try to look for any valid name column
                             # row[3] and row[4] seem likely candidates based on debug dump
                             if len(row) > 4 and is_valid_name(row[3]) and is_valid_name(row[4]):
                                 p_name = f"{row[3]} {row[4]}"
                             elif len(row) > 3 and is_valid_name(row[3]):
                                 p_name = row[3]

                        # Clean Name (Flip "Last, First")
                        if "," in p_name: 
                            parts = p_name.split(",")
                            if len(parts) >= 2:
                                p_name = f"{parts[1].strip()} {parts[0].strip()}"


                                
                        # Points usually last column
                        points = 0
                        try:
                            if row[-1].isdigit():
                                points = int(row[-1])
                        except:
                            points = 0

                        if p_id and p_name != "Unbekannt":
                            clean_season = season_name.replace("Saison ", "").strip()
                            clean_season = clean_season.replace("Ranglisten ", "").strip()
                            if "2020" in clean_season and "2022" in clean_season: clean_season = "20/22"
                            elif "2022" in clean_season and "2023" in clean_season: clean_season = "22/23"
                            elif "2023" in clean_season and "2024" in clean_season: clean_season = "23/24"
                            elif "2024" in clean_season and "2025" in clean_season: clean_season = "24/25"

                            entry = {
                                "season": clean_season,
                                "rank": rank,
                                "points": points,
                                "league": league,
                                "name": p_name
                            }
                            
                            if p_id not in all_history:
                                all_history[p_id] = []
                            
                            exists = any(e['season'] == clean_season for e in all_history[p_id])
                            if not exists:
                                all_history[p_id].append(entry)

            except Exception as e:
                print(f"  Error processing {season_name}: {e}")

        await browser.close()
        
        # MERGE LOGIC START
        existing_history = {}
        try:
            with open("archive_data.js", "r", encoding="utf-8") as f:
                content = f.read().strip()
                # Remove "window.ARCHIVE_DATA = " and trailing ";"
                if content.startswith("window.ARCHIVE_DATA =") and content.endswith(";"):
                    json_str = content[len("window.ARCHIVE_DATA ="): -1]
                    existing_history = json.loads(json_str)
                    print(f"Loaded existing archive data: {len(existing_history)} players.")
        except Exception as e:
            print(f"No existing archive data found or error reading: {e}")

        # Merge new data into existing
        # Strategy:
        # 1. Iterate over new scraped data
        # 2. For each player ID, merge their seasons.
        # 3. If a season exists in both, overwrite with new (assume fresh scrape is better fix for corrections).
        # 4. If a season exists in OLD but not in NEW (e.g. deleted from site), KEEP IT.

        print("Merging new data into existing archive...")
        
        # We want to update existing_history with all_history
        for p_id, new_entries in all_history.items():
            if p_id not in existing_history:
                existing_history[p_id] = new_entries
            else:
                # Merge lists based on season
                existing_entries = existing_history[p_id]
                existing_map = {e['season']: e for e in existing_entries}
                
                for new_entry in new_entries:
                    # Update or Add
                    existing_map[new_entry['season']] = new_entry
                
                # Convert back to list
                existing_history[p_id] = list(existing_map.values())
        
        print(f"Merge complete. Total unique players: {len(existing_history)}")

        js_content = f"window.ARCHIVE_DATA = {json.dumps(existing_history, indent=2)};"
        with open("archive_data.js", "w", encoding="utf-8") as f:
            f.write(js_content)
        print(f"Archive data saved to archive_data.js.")

if __name__ == "__main__":
    asyncio.run(scrape_archive())


