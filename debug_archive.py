
import asyncio
from playwright.async_api import async_playwright

async def dump_dom():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        url = "https://www.bwedl.de/archiv/saison-2022-2023/2022-2023/"
        print(f"Going to {url}")
        await page.goto(url)
        content = await page.content()
        with open("debug_dom.html", "w", encoding="utf-8") as f:
            f.write(content)
        print("DOM dumped to debug_dom.html")
        await browser.close()

asyncio.run(dump_dom())
