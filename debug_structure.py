
import asyncio
from playwright.async_api import async_playwright

async def debug_table():
    print("Starting Debug Scrape...")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        # Hardcoded Deep Link
        url = "https://www.bwedl.de/archiv/2023-2024/bezirksliga-ranglisten/"
        
        print(f"Navigating to: {url}")
        await page.goto(url, wait_until="networkidle")
        
        # Dump Tables (Filtered for Data)
        print("\n--- TABLE DUMP ---")
        tables = await page.evaluate('''() => {
            const tables = Array.from(document.querySelectorAll('table'));
            return tables.filter(t => {
                const trs = t.querySelectorAll('tr');
                if (trs.length < 5) return false;
                // Check content of first data row
                const firstRow = trs[1] || trs[0]; 
                const cells = firstRow.querySelectorAll('td');
                if (cells.length < 3) return false;
                // Heuristic: First cell should be a small number (Rank)
                const txt = cells[0].innerText.trim().replace('.', '');
                return /^\d{1,3}$/.test(txt); 
            }).map((t, tIdx) => {
                const rows = Array.from(t.querySelectorAll('tr')).slice(0, 5); // First 5 rows
                return rows.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()));
            });
        }''')
        
        for i, table in enumerate(tables):
            print(f"Table {i}:")
            for j, row in enumerate(table):
                print(f"  Row {j}: {row}")
                
        await browser.close()

if __name__ == "__main__":
    asyncio.run(debug_table())
