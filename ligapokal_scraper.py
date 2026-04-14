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
    # Ligapokal page: <b>Round Name</b> followed by <table>
    cup_data = page.evaluate("""() => {
        const results = [];
        const fullHtmlParts = [];

        // Get all B and TABLE elements in document order
        const elems = Array.from(document.querySelectorAll('b, table'));

        let currentRoundName = null;

        for (let el of elems) {
            if (el.tagName === 'B') {
                const text = el.innerText.trim();
                // Match round names: "1. Runde", "Halbfinale", "Finale",
                // "Spiel um Platz 3", etc.
                if (text.includes('Runde') ||
                    text.includes('Finale') ||
                    text.includes('Halbfinale') ||
                    text.includes('Spiel um') ||
                    text.includes('Viertelfinale') ||
                    text.includes('Achtelfinale')) {
                    currentRoundName = text;
                }
            } else if (el.tagName === 'TABLE') {
                if (currentRoundName) {
                    const rows = Array.from(el.querySelectorAll('tr'));
                    // Only process tables with actual data rows
                    if (rows.length > 1) {
                        // Build HTML for the table view
                        fullHtmlParts.push(
                            `<h3>${currentRoundName}</h3>`
                        );
                        fullHtmlParts.push(el.outerHTML);

                        // Build text representation for match_days
                        // (compatible with renderLeague result parsing)
                        let rowText = "";
                        for (let i = 1; i < rows.length; i++) {
                            const cells = Array.from(
                                rows[i].querySelectorAll('td')
                            ).map(td => td.innerText.trim());

                            if (cells.length >= 5) {
                                // Format: Date  Home - Away  Score
                                rowText += `${cells[0]}   ${cells[2]}`;
                                rowText += ` - ${cells[3]}`;
                                rowText += `   ${cells[4]}\\n`;
                            } else if (cells.length >= 4) {
                                // Some tables may have fewer columns
                                rowText += `${cells[0]}   ${cells[1]}`;
                                rowText += ` - ${cells[2]}`;
                                rowText += `   ${cells[3]}\\n`;
                            }
                        }
                        if (rowText.trim().length > 0) {
                            results.push({
                                name: currentRoundName,
                                text: rowText
                            });
                        }
                    }
                    // Consume the header
                    currentRoundName = null;
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
        "match_days": {}
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
        page = browser.new_page()

        for entry in LIGAPOKAL_ARCHIVE_URLS:
            try:
                result = scrape_ligapokal_page(
                    page, entry["url"], entry["name"]
                )
                ligapokal_data[entry["name"]] = result
                print(f"  [OK] {entry['name']} scraped successfully")
            except Exception as e:
                print(f"  [ERR] Error scraping {entry['name']}: {e}")

        browser.close()

    # Save as JavaScript file
    js_content = (
        f"window.LIGAPOKAL_ARCHIVE = "
        f"{json.dumps(ligapokal_data, indent=4, ensure_ascii=False)};"
    )
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)

    print(f"\n[INFO] Saved {len(ligapokal_data)} seasons to {OUTPUT_FILE}")
    print("Done!")


if __name__ == "__main__":
    main()
