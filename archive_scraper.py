
import argparse
import asyncio
from playwright.async_api import (
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)
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

ARCHIVE_RANKING_TABLE_EXTRACTOR_JS = r'''() => {
    const extracted = [];
    const processedSet = new Set();

    function rowValues(row) {
        return Array.from(row.cells).map((cell) => cell.innerText.trim());
    }

    function isSemanticHeaderRow(row) {
        const values = rowValues(row);
        return (
            values.some((value) => /^(?:Pl\.?|Platz|Rang)$/i.test(value))
            && values.some((value) => /^(?:ID|Nr\.?)$/i.test(value))
            && values.some((value) => /^(?:Name|Vorname|Nachname)$/i.test(value))
            && values.some((value) => /^Gesamt$/i.test(value))
        );
    }

    function extractTableData(table, league) {
        const theadRows = Array.from(table.querySelectorAll('thead tr'));
        const headerRow = (
            theadRows.find(isSemanticHeaderRow)
            || Array.from(table.rows).slice(0, 5).find(isSemanticHeaderRow)
        );
        if (!headerRow) return null;

        const rows = Array.from(table.tBodies)
            .flatMap((body) => Array.from(body.rows))
            .filter((row) => row !== headerRow)
            .map((row) => Array.from(row.querySelectorAll('td'))
                .map((cell) => cell.innerText.trim()))
            .filter((row) => row.length >= 3);
        return { league, headers: rowValues(headerRow), rows };
    }

    function addTable(table, league) {
        if (processedSet.has(table)) return;
        processedSet.add(table);
        const data = extractTableData(table, league);
        if (data) extracted.push(data);
    }

    function leagueFromText(source) {
        const text = (source || '').trim();
        if (text.includes('Bezirksoberliga')) return 'Bezirksoberliga';
        if (text.includes('Bezirksliga')) return 'Bezirksliga';
        if (text.includes('A-Klasse')) return 'A-Klasse';
        if (text.includes('B-Klasse')) return 'B-Klasse';
        if (text.includes('C-Klasse')) return 'C-Klasse';
        return '';
    }

    const leagueHeadings = Array.from(
        document.querySelectorAll('b, strong, h2, h3, h4, div')
    );
    leagueHeadings.forEach((heading) => {
        const league = leagueFromText(heading.innerText);
        if (!league) return;

        let sibling = heading.nextElementSibling;
        let count = 0;
        while (sibling && count < 10) {
            if (sibling.tagName === 'TABLE') {
                addTable(sibling, league);
                break;
            }
            sibling = sibling.nextElementSibling;
            count += 1;
        }
    });

    document.querySelectorAll('table').forEach((table) => {
        if (processedSet.has(table)) return;

        let sibling = table.previousElementSibling;
        let league = '';
        let count = 0;
        while (sibling && count < 10 && !league) {
            league = leagueFromText(sibling.innerText);
            sibling = sibling.previousElementSibling;
            count += 1;
        }
        if (league) addTable(table, league);
    });

    return extracted;
}'''


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
            clean_season = season_name.replace("Saison ", "").strip()
            clean_season = clean_season.replace("Ranglisten ", "").strip()
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
                except PlaywrightTimeoutError:
                    pass
                
                tables_data = await page.evaluate(
                    ARCHIVE_RANKING_TABLE_EXTRACTOR_JS
                )
                
                print(f"  Found {len(tables_data)} league tables on {page.url}.")

                if not tables_data:
                    raise RuntimeError(
                        "table index unavailable: no recognized ranking tables"
                    )

                season_entries = []
                for table_index, table in enumerate(tables_data):
                    try:
                        records = parse_archive_ranking_table(
                            season=clean_season,
                            league=table['league'],
                            headers=table['headers'],
                            rows=table['rows'],
                        )
                        merge_archive_entries([
                            *all_entries,
                            *season_entries,
                            *records,
                        ])
                    except Exception as error:
                        raise RuntimeError(
                            f"table {table_index}: "
                            f"{type(error).__name__}: {error}"
                        ) from error
                    season_entries.extend(records)

                if not season_entries:
                    raise RuntimeError(
                        "table indexes "
                        f"0-{len(tables_data) - 1}: "
                        "no recognized ranking records"
                    )

                all_entries.extend(season_entries)

            except Exception as error:
                failure_url = getattr(page, "url", url) or url
                contextual_error = RuntimeError(
                    f"season {clean_season} url {failure_url}: "
                    f"{type(error).__name__}: {error}"
                )
                failures.append(contextual_error)
                print(
                    f"  Error processing {clean_season} "
                    f"at {failure_url}"
                )

        if failures:
            details = "; ".join(str(error) for error in failures)
            raise RuntimeError(
                "archive scrape incomplete "
                f"({len(failures)} item failures): {details}"
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


