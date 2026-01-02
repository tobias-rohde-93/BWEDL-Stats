import json
import os
import sys
import datetime
from playwright.sync_api import sync_playwright

DATA_FILE = "league_data.json"
BASE_URL = "https://bwedl.de"
START_URL = "https://bwedl.de/tabellen/"

def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Ensure structure is consistent with new format
                if "leagues" not in data:
                    return {"leagues": {}, "last_updated": ""}
                return data
        except json.JSONDecodeError:
            print("Warning: Could not decode existing data file. Starting fresh.")
    return {"leagues": {}, "last_updated": ""}

def save_data(data):
    data["last_updated"] = datetime.datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    
    # Save as JSON (for potential future API use)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
        
    # Save as JS (for local file:// access without CORS)
    js_content = f"window.LEAGUE_DATA = {json.dumps(data, indent=4, ensure_ascii=False)};"
    with open("league_data.js", "w", encoding="utf-8") as f:
        f.write(js_content)

def scrape_league(page, league_url, league_name, data):
    print(f"Scraping {league_name}...")
    page.goto(league_url)
    
    # Initialize league data if not present
    if league_name not in data["leagues"]:
        data["leagues"][league_name] = {"url": league_url, "match_days": {}, "table": ""}
    
    league_storage = data["leagues"][league_name]

    # Check for dropdown to determine if it's a Standard League or Cup
    select_locator = page.locator('select[name="wtWahl"]')
    
    if select_locator.count() > 0:
        # --- STANDARD LEAGUE LOGIC ---
        # 1. Extract Current Table
        try:
            table_locator = page.locator("xpath=//table[contains(., 'Pl.')]")
            if table_locator.count() > 0:
                 league_storage["table"] = table_locator.first.evaluate("el => el.outerHTML")
            else:
                 print(f"  [Warn] No table found for {league_name}")
        except Exception as e:
            print(f"  [Error] extracting table for {league_name}: {e}")

        # 2. Extract Match Days
        try:
            # Identify the textarea element for results
            textarea = page.locator("textarea")

            options = select_locator.locator("option").all()
            option_values = []
            for opt in options:
                val = opt.get_attribute("value")
                text = opt.inner_text().strip()
                option_values.append((val, text))
            
            for val, text in option_values:
                val = (val or "").strip()
                if not val: 
                     val = text.strip()
                
                # FORCE UPDATE: Always fetch the latest data for every match day.
                # Previously, we skipped if data existed, which prevented updating scores for past match days.
                print(f"  Fetching: {text}")
                
                # Robust / Simple logic:
                # 1. Select the option
                select_locator.select_option(value=val)
                
                # 2. Wait for sufficient time for the async update (verified 2-3s is usually enough)
                # We use a fixed wait because detecting 'change' is flaky if content happens to be same
                # or if the old content capture missed the transition.
                page.wait_for_timeout(2000)
                
                # 3. Read content
                if textarea.count() > 0:
                    content = page.evaluate("document.querySelector('textarea').value")
                    league_storage["match_days"][text] = content
                        
        except Exception as e:
            print(f"  [Error] extracting match days for {league_name}: {e}")
            
    else:
        # --- CUP LOGIC (Ligapokal) ---
        print(f"  [Info] Cup/Tournament mode detected for {league_name}")
        
        # 1. Capture all tables for the 'table' view (Overview)
        try:
            # We want to capture the rounds structure. The rounds are named in <b> tags before tables.
            # A simple way is to grab the main container content or construct it.
            # Looking at HTML, there are <p><b>Runde...</b></p> followed by <table>.
            # Let's extract all tables and their preceding headers.
            
            html_content = ""
            # Find all bold headers that look like rounds
            # Using evaluate to traverse DOM might be easier to get clean HTML
            
            # Strategy: Find all tables. For each table, get the preceding round text.
            tables = page.locator("table").all()
            found_rounds = False
            
            for i, tbl in enumerate(tables):
                # Try to find the round name. It's usually in a prev sibling or close by.
                # In the debug HTML: <b> Runde 3... </b> <br> <table>...
                # So we can try to look for the preceding <b> tag.
                
                # Check if this table has data (rows > 1)
                rows = tbl.locator("tr").all()
                if len(rows) < 2: 
                    continue # Skip empty tables (structure tables)
                    
                # Get table HTML
                tbl_html = tbl.evaluate("el => el.outerHTML")
                
                # Try to extract a title.
                # Since DOM traversal upwards/backwards in playwright is tricky with locators,
                # we can assume the order of tables matches the order of rounds if we scrape them sequentially.
                # But to be safe, let's just grab the whole text content of the table and formatting for the "Results" section.
                
                # Parse Rows for Match Days (Results)
                # Header: Datum, Spiel-Nr, Heim, Gast, Ergebnis
                # We can deduce the Round Name from the content or just number them if header is missing.
                # However, usually the user wants to see "Runde 1", "Runde 2".
                # Let's use a JS evaluation to get text + table pairs.
                pass 

            # Better JS approach: Iterate B and TABLE tags in document order
            cup_data = page.evaluate("""() => {
                const results = [];
                const fullHtmlParts = [];
                
                // Get all B and TABLE elements in document order
                const elems = Array.from(document.querySelectorAll('b, table'));
                
                let currentRoundName = null;
                
                for (let el of elems) {
                    if (el.tagName === 'B') {
                        const text = el.innerText.trim();
                        if (text.includes('Runde') || text.includes('Finale') || text.includes('Halbfinale') || text.includes('Spiel um')) {
                            currentRoundName = text;
                        }
                    } else if (el.tagName === 'TABLE') {
                        // If we have a pending round header, associate this table with it
                        if (currentRoundName) {
                            // Check for content
                            const rows = Array.from(el.querySelectorAll('tr'));
                            if (rows.length > 1) { // header + at least 1 row
                                fullHtmlParts.push(`<h3>${currentRoundName}</h3>`);
                                fullHtmlParts.push(el.outerHTML);
                                
                                let rowText = "";
                                for (let i = 1; i < rows.length; i++) {
                                    const cells = Array.from(rows[i].querySelectorAll('td')).map(td => td.innerText.trim());
                                    if (cells.length >= 5) {
                                         // Format compatible with UI display
                                         rowText += `${cells[0]}   ${cells[2]} - ${cells[3]}   ${cells[4]}\\n`;
                                    }
                                }
                                if (rowText.trim().length > 0) {
                                    results.push({name: currentRoundName, text: rowText});
                                }
                            }
                            // consume the header so next table doesn't reuse it unless we expect multiple tables per header
                            currentRoundName = null;
                        }
                    }
                }
                return { html: fullHtmlParts.join('<br>'), rounds: results };
            }""")
            
            league_storage["table"] = cup_data["html"]
            for round_obj in cup_data["rounds"]:
                league_storage["match_days"][round_obj["name"]] = round_obj["text"]
                
        except Exception as e:
            print(f"  [Error] extracting cup data for {league_name}: {e}")

def main():
    data = load_data()
    
    print(f"Connecting to {START_URL}...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(START_URL)
        
        # Find all league links
        # We look for links that start with /tabellen/
        # and ignore the main tabellen link itself if it matches
        league_links = []
        
        # There isn't a single container, so we scan all links on page
        # Filtering for hrefs containing /tabellen/
        links = page.locator("a[href*='/tabellen/']").all()
        
        for link in links:
            href = link.get_attribute("href")
            text = link.inner_text().strip()
            if href and href != "/tabellen/" and text:
                full_url = BASE_URL + href if href.startswith("/") else href
                # Deduplicate
                if not any(l['url'] == full_url for l in league_links):
                    league_links.append({'url': full_url, 'name': text})
        
        print(f"Found {len(league_links)} leagues.")
        
        for league in league_links:
            scrape_league(page, league['url'], league['name'], data)
            
        browser.close()

    save_data(data)
    print("\n[INFO] Scraping completed. Data saved to league_data.json")

if __name__ == "__main__":
    main()
