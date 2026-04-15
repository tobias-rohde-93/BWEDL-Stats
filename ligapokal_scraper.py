"""
Ligapokal Archive Scraper
=========================
Scrapes historical Ligapokal (League Cup) data from the BWEDL archive.
Outputs data in the same format as league_data.js for seamless
integration with the existing renderLeague() function.

Data structure produced:
{
    "Ligapokal 2024-2025": {
        "url": "...",
        "table": "<h3>Finale</h3><table>...</table>...",
        "match_days": {
            "Finale": "date  Home - Away  score\n...",
            "Halbfinale": "...",
            ...
        }
    },
    ...
}
"""

import json
from playwright.sync_api import sync_playwright


# Historical Ligapokal archive URLs
LIGAPOKAL_ARCHIVE_URLS = [
    {
        "url": "https://bwedl.de/archiv/2024-2025/ligapokal-2024-2025/",
        "name": "Ligapokal 2024-2025"
    },
    {
        "url": "https://bwedl.de/archiv/2023-2024/ligapokal-2023-2024/",
        "name": "Ligapokal 2023-2024"
    },
    {
        "url": "https://bwedl.de/archiv/saison-2022-2023/ligapokal-2022-2023/",
        "name": "Ligapokal 2022-2023"
    },
]

OUTPUT_FILE = "ligapokal_archive.js"


def scrape_ligapokal_page(page, url, name):
    """
    Scrape a single Ligapokal archive page.
    Uses the same cup-detection logic as the league_scraper.py
    to extract round headers and results tables.

    Args:
        page: Playwright page object
        url: URL of the Ligapokal archive page
        name: Display name for this season (e.g., "Ligapokal 2024-2025")

    Returns:
        dict with 'url', 'table' (HTML), and 'match_days' (text per round)
    """
    print(f"  Scraping {name} from {url}...")
    page.goto(url, wait_until="networkidle", timeout=30000)

    # Use JavaScript to extract round headers (bold tags) and their
    # associated tables, following the same DOM pattern as the live
    # Ligapokal page: Header followed by <table>
    cup_data = page.evaluate("""() => {
        const results = [];
        const fullHtmlParts = [];

        // Get elements that might be headers or tables
        // Added 'span' and 'div' to catch headers which are not in bold tags
        const elems = Array.from(document.querySelectorAll('p, b, strong, h1, h2, h3, h4, span, div, table'));

        let currentRoundName = null;

        for (let el of elems) {
            const tagName = el.tagName;
            const text = el.innerText.trim();

            if (tagName !== 'TABLE') {
                // Potential header: check if it contains keywords
                if (text.includes('Runde') ||
                    text.includes('Finale') ||
                    text.includes('Halbfinale') ||
                    text.includes('Viertelfinale') ||
                    text.includes('Achtelfinale') ||
                    text.includes('Spiel um')) {
                    
                    // Avoid catching large sections, small fragments or menu items
                    if (text.length > 5 && text.length < 120 && !text.includes('\\n')) {
                        // Clean up round name (remove tabs, multiple spaces)
                        currentRoundName = text.replace(/\\t/g, ' ').replace(/\\s+/g, ' ').trim();
                    }
                }
            } else if (tagName === 'TABLE') {
                if (currentRoundName) {
                    const rows = Array.from(el.querySelectorAll('tr'));
                    // Only process tables with actual data rows (excluding headers)
                    if (rows.length > 1) {
                        // Check if it's a results table (should have teams/scores)
                        const tableText = el.innerText.toLowerCase();
                        if (tableText.includes('heim') || tableText.includes('gast') || tableText.includes('ergebnis')) {
                            console.log(`Found round table: ${currentRoundName}`);
                            fullHtmlParts.push(`<h3>${currentRoundName}</h3>`);
                            fullHtmlParts.push(el.outerHTML);

                            let rowText = "";
                            for (let i = 1; i < rows.length; i++) {
                                const cells = Array.from(rows[i].querySelectorAll('td'))
                                    .map(td => td.innerText.trim());

                                if (cells.length >= 5) {
                                    // Datum, Spiel-Nr., Heim, Gast, Ergebnis
                                    rowText += `${cells[0]}   ${cells[2]} - ${cells[3]}   ${cells[4]}\\n`;
                                } else if (cells.length >= 4) {
                                    rowText += `${cells[0]}   ${cells[1]} - ${cells[2]}   ${cells[3]}\\n`;
                                }
                            }
                            if (rowText.trim().length > 0) {
                                results.push({
                                    name: currentRoundName,
                                    text: rowText,
                                    isCup: true
                                });
                                // IMPORTANT: Reset to prevent applying same header to next non-round table
                                currentRoundName = null; 
                            }
                        }
                    }
                }
            }
        }
        return {
            html: fullHtmlParts.join('<br>'),
            rounds: results
        };
    }""")

    # Build the league-compatible data structure
    league_entry = {
        "url": url,
        "table": cup_data["html"],
        "match_days": {},
        "isCup": True
    }

    # Populate match_days from extracted rounds
    for round_obj in cup_data["rounds"]:
        league_entry["match_days"][round_obj["name"]] = round_obj["text"]

    round_count = len(league_entry["match_days"])
    print(f"    Found {round_count} rounds")

    return league_entry


def main():
    """
    Main entry point for the Ligapokal archive scraper.
    Scrapes all historical Ligapokal pages and saves the result
    as a JavaScript file for inclusion in the web app.
    """
    print("=" * 60)
    print("Ligapokal Archive Scraper")
    print("=" * 60)

    ligapokal_data = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for entry in LIGAPOKAL_ARCHIVE_URLS:
            context = browser.new_context()
            page = context.new_page()
            try:
                result = scrape_ligapokal_page(
                    page, entry["url"], entry["name"]
                )
                ligapokal_data[entry["name"]] = result
                print(f"  [OK] {entry['name']} scraped successfully")
                
                # Save incrementally after each successful scrape
                js_content = (
                    f"window.LIGAPOKAL_ARCHIVE = "
                    f"{json.dumps(ligapokal_data, indent=4, ensure_ascii=False)};"
                )
                with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                    f.write(js_content)
                
            except Exception as e:
                print(f"  [ERR] Error scraping {entry['name']}: {e}")
            finally:
                context.close()

        browser.close()

    print(f"\n[INFO] Progressive save complete to {OUTPUT_FILE}")
    print("Done!")


if __name__ == "__main__":
    main()
