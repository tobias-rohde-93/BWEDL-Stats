
import argparse
import asyncio
from playwright.async_api import async_playwright
import json
import re
from pathlib import Path
from pipeline.archive_players import (
    merge_archive_entries,
    parse_archive_ranking_table,
)
from pipeline.diagnostics import AsyncDiagnosticSession, scraper_status
from pipeline.urls import normalize_bwedl_url

BASE_URL = "https://www.bwedl.de"
ARCHIVE_URL = f"{BASE_URL}/archiv/"


def is_archive_season_link(href: str, text: str) -> bool:
    safe_url = normalize_bwedl_url(href, "/archiv/")
    if not safe_url or not isinstance(text, str):
        return False
    match = re.search(r"(\d{4})[/-](\d{4})", text) or re.search(
        r"(\d{4})[/-](\d{4})", safe_url
    )
    if not match:
        return False
    first_year, second_year = (int(year) for year in match.groups())
    return first_year >= 2020 and 1 <= second_year - first_year <= 2


def is_archive_sub_link(href: str, text: str) -> bool:
    return (
        isinstance(text, str)
        and normalize_bwedl_url(href, "/archiv/") is not None
    )


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

def save_archive_data(data, output_dir=Path(".")) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "archive_data.js"
    js_content = f"window.ARCHIVE_DATA = {json.dumps(data, indent=2)};\n"
    output_path.write_text(js_content, encoding="utf-8", newline="\n")
    return output_path

async def scrape_archive(output_dir=Path("."), artifacts_dir=Path("artifacts")):
    print(f"Starting Archive Scrape from {ARCHIVE_URL}")
    async with AsyncDiagnosticSession(
        async_playwright, artifacts_dir, "archive_scraper"
    ) as diagnostics:
        page = diagnostics.page
        
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
            href = normalize_bwedl_url(s.get('href'), "/archiv/")

            if not href or not is_archive_season_link(href, text):
                continue
            
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
        
        all_entries = []

        if not unique_seasons:
            raise RuntimeError("No unique archive seasons found")
        
        failures = []
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
                     target_url = normalize_bwedl_url(
                         sub_link.get('href'), "/archiv/"
                     )
                     if (
                         target_url
                         and target_url != url
                         and is_archive_sub_link(
                             target_url, sub_link.get('text')
                         )
                     ):
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
                        const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
                        const fallbackHeader = Array.from(table.querySelectorAll('tr'))
                            .slice(0, 5)
                            .find((row) => (
                                Array.from(row.querySelectorAll('th, td')).some((cell) =>
                                    /^(?:Pl\\.?|Platz|Rang|V-Nr\\.?|ID|Nr\\.?|Gesamt)$/i.test(cell.innerText.trim())
                                )
                            ));
                        const headers = (
                            headerCells.length
                                ? headerCells
                                : Array.from(fallbackHeader?.querySelectorAll('th, td') || [])
                        ).map((cell) => cell.innerText.trim());
                        const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
                            .filter((row) => row !== fallbackHeader)
                            .map((row) => Array.from(row.querySelectorAll('td'))
                                .map((cell) => cell.innerText.trim()))
                            .filter((row) => row.length >= 3);
                        return { league, headers, rows };
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

                clean_season = season_name.replace("Saison ", "").strip()
                clean_season = clean_season.replace("Ranglisten ", "").strip()
                for table in tables_data:
                    all_entries.extend(parse_archive_ranking_table(
                        season=clean_season,
                        league=table['league'],
                        headers=table['headers'],
                        rows=table['rows'],
                    ))

            except Exception as e:
                failures.append(e)
                print(f"  Error processing {season_name}")

        if failures:
            raise RuntimeError(
                f"archive scrape incomplete ({len(failures)} item failures)"
            ) from failures[0]
        if not all_entries:
            raise RuntimeError("No recognized archive history records found")

        all_history = merge_archive_entries(all_entries)
        output_path = save_archive_data(all_history, output_dir)
        print(f"Archive data saved to {output_path}.")

    if diagnostics.error is not None:
        return 1
    return 0

def main(argv=None):
    args = parse_args(argv)
    return scraper_status(
        "archive_scraper", args.artifacts_dir,
        lambda: asyncio.run(scrape_archive(args.output_dir, args.artifacts_dir)),
    )

if __name__ == "__main__":
    raise SystemExit(main())


