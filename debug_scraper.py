from playwright.sync_api import sync_playwright

URL = "https://bwedl.de/tabellen/ligapokal-2025-2026/"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        print(f"Navigating to {URL}")
        page.goto(URL)
        
        content = page.content()
        
        with open("debug_html.txt", "w", encoding="utf-8") as f:
            f.write(content)
            
        print("HTML dumped to debug_html.txt")
        browser.close()

if __name__ == "__main__":
    main()
