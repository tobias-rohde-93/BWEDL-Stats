import argparse
import json
import os
import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

from pipeline.files import write_json_pair
from pipeline.diagnostics import SyncDiagnosticSession, scraper_status
from pipeline.html_sanitizer import sanitize_table_fragment
from pipeline.urls import normalize_bwedl_url

DATA_FILE_JSON = "ranking_data.json"
DATA_FILE_JS = "ranking_data.js"
START_URL = "https://www.bwedl.de/ranglisten/"
BASE_URL = "https://www.bwedl.de"

def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("."),
        help="Directory for candidate output files",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=Path("artifacts"),
        help="Directory for failure diagnostics",
    )
    return parser.parse_args(argv)

def save_data(data, output_dir=Path(".")):
    data["last_updated"] = datetime.datetime.now().strftime("%d.%m.%Y %H:%M:%S")

    json_path, javascript_path = write_json_pair(
        output_dir, "ranking_data", "RANKING_DATA", data
    )
    print(f"Data saved to {json_path} and {javascript_path}")
    return json_path, javascript_path

def run_scrape(output_dir=Path("."), artifacts_dir=Path("artifacts")):
    data = {"last_updated": "", "rankings": {}, "players": []}
    
    print(f"Connecting to {START_URL}...")
    
    with SyncDiagnosticSession(
        sync_playwright, artifacts_dir, "ranking_scraper", headless=True
    ) as diagnostics:
        page = diagnostics.page
        page.goto(START_URL)
        
        # 1. Find ranking links
        # Use broader selector (like league scraper) to avoid missing them if layout differs
        links = page.locator("a[href*='/ranglisten/']").all()
        
        ranking_links = []
        failures = []
        for link in links:
            try:
                href = link.get_attribute("href")
                text = link.inner_text().strip()
            except Exception as error:
                failures.append(error)
                continue
            
            full_url = normalize_bwedl_url(href, "/ranglisten/")
            if (
                full_url
                and full_url != "https://www.bwedl.de/ranglisten/"
                and "archiv" not in full_url.casefold()
                and text
            ):
                # Dedupe
                if not any(l['url'] == full_url for l in ranking_links):
                    ranking_links.append({'url': full_url, 'name': text})
        
        print(f"Found {len(ranking_links)} ranking categories: {[l['name'] for l in ranking_links]}")
        
        # 2. Scrape each ranking
        for rank in ranking_links:
            print(f"Scraping {rank['name']}...")
            data["rankings"][rank["name"]] = ""
            try:
                page.goto(rank['url'])
                
                # Wait for table
                # Check if table exists
                table_loc = page.locator("div.table-responsive table")
                if table_loc.count() > 0:
                    html = table_loc.first.evaluate("el => el.outerHTML")
                    data["rankings"][rank['name']] = sanitize_table_fragment(html)
                    
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
                failures.append(e)
                print(f"  [Error] scraping {rank['name']}")

        if failures:
            raise RuntimeError(
                f"ranking scrape incomplete ({len(failures)} item failures)"
            ) from failures[0]

        save_data(data, output_dir)

    if diagnostics.error is not None:
        return 1
    return 0

def main(argv=None):
    args = parse_args(argv)
    return scraper_status(
        "ranking_scraper", args.artifacts_dir,
        lambda: run_scrape(args.output_dir, args.artifacts_dir),
    )

if __name__ == "__main__":
    raise SystemExit(main())
