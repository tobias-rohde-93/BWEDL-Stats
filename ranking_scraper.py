import json
import os
import datetime
from playwright.sync_api import sync_playwright

DATA_FILE_JSON = "ranking_data.json"
DATA_FILE_JS = "ranking_data.js"
START_URL = "https://www.bwedl.de/ranglisten/"
BASE_URL = "https://www.bwedl.de"

def save_data(data):
    data["last_updated"] = datetime.datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    
    with open(DATA_FILE_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
        
    js_content = f"window.RANKING_DATA = {json.dumps(data, indent=4, ensure_ascii=False)};"
    with open(DATA_FILE_JS, "w", encoding="utf-8") as f:
        f.write(js_content)
    print(f"Data saved to {DATA_FILE_JSON} and {DATA_FILE_JS}")

def main():
    data = {"last_updated": "", "rankings": {}, "players": []}
    
    print(f"Connecting to {START_URL}...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(START_URL)
        
        # 1. Find ranking links
        # Use broader selector (like league scraper) to avoid missing them if layout differs
        links = page.locator("a[href*='/ranglisten/']").all()
        
        ranking_links = []
        for link in links:
            href = link.get_attribute("href")
            text = link.inner_text().strip()
            
            if href and href != "/ranglisten/" and "archiv" not in href.lower() and text:
                full_url = BASE_URL + href if href.startswith("/") else href
                # Dedupe
                if not any(l['url'] == full_url for l in ranking_links):
                    ranking_links.append({'url': full_url, 'name': text})
        
        print(f"Found {len(ranking_links)} ranking categories: {[l['name'] for l in ranking_links]}")
        
        # 2. Scrape each ranking
        for rank in ranking_links:
            print(f"Scraping {rank['name']}...")
            try:
                page.goto(rank['url'])
                
                # Wait for table
                # Check if table exists
                table_loc = page.locator("div.table-responsive table")
                if table_loc.count() > 0:
                    html = table_loc.first.evaluate("el => el.outerHTML")
                    data["rankings"][rank['name']] = html
                    
                    # Extract players
                    category_players = page.evaluate("""(leagueName) => {
                        const rows = Array.from(document.querySelectorAll('div.table-responsive table tr'));
                        const players = [];
                        let headers = [];
                        
                        rows.forEach((row, index) => {
                            const cols = Array.from(row.querySelectorAll('td'));
                            const texts = cols.map(c => c.innerText.trim());
                            
                            if (texts.includes("V-Nr.") && texts.includes("Nachname")) {
                                headers = texts;
                                return;
                            }
                            
                            if (headers.length === 0) return; // Wait for header
                            
                            const vNrIdx = headers.indexOf("V-Nr.");
                            const nrIdx = headers.indexOf("Nr.");
                            const fNameIdx = headers.indexOf("Vorname");
                            const lNameIdx = headers.indexOf("Nachname");
                            const rankIdx = headers.indexOf("Rang");
                            const pointsIdx = headers.indexOf("Gesamt");
                            
                            // Find all Round headers (R1...R18)
                            const roundIndices = {};
                            for (let i = 1; i <= 18; i++) {
                                const idx = headers.indexOf(`R${i}`);
                                if (idx > -1) roundIndices[`R${i}`] = idx;
                            }
                            
                            if (vNrIdx > -1 && fNameIdx > -1 && lNameIdx > -1 && cols.length > Math.max(vNrIdx, lNameIdx)) {
                                const vNr = texts[vNrIdx];
                                const pNr = texts[nrIdx];
                                const fName = texts[fNameIdx];
                                const lName = texts[lNameIdx];
                                const rank = rankIdx > -1 ? texts[rankIdx] : "";
                                const points = pointsIdx > -1 ? texts[pointsIdx] : "";
                                
                                const rounds = {};
                                for (const [key, idx] of Object.entries(roundIndices)) {
                                    rounds[key] = idx < texts.length ? texts[idx] : "";
                                }
                                
                                if (vNr && (fName || lName)) {
                                    players.push({
                                        v_nr: vNr,
                                        id: pNr,
                                        name: fName + " " + lName,
                                        rank: rank,
                                        points: points,
                                        league: leagueName,
                                        rounds: rounds
                                    });
                                }
                            }
                        });
                        return players;
                    }""", rank['name'])
                    
                    for p in category_players:
                        # Append to global list, allowing duplicates if same player is in different leagues
                        data["players"].append(p)
                else:
                    print(f"  [Warn] No table found for {rank['name']}")
                    
            except Exception as e:
                print(f"  [Error] scraping {rank['name']}: {e}")

        browser.close()
        
    save_data(data)

if __name__ == "__main__":
    main()
