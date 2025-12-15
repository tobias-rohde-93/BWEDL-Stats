from playwright.sync_api import sync_playwright
import time

URL = "https://bwedl.de/tabellen/a-klasse-gruppe-1-2025-2026/"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        print(f"Navigating to {URL}")
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        
        # Initial
        initial = page.evaluate("document.querySelector('textarea').value")
        print(f"Initial: {initial[:30]}...")
        
        # Select 2. Spieltag
        print("Selecting 2. Spieltag...")
        page.select_option("select[name='wtWahl']", value="2. Spieltag")
        
        # Explicit wait like browser agent
        time.sleep(5)
        
        updated = page.evaluate("document.querySelector('textarea').value")
        print(f"Updated: {updated[:30]}...")
        
        if initial != updated:
            print("SUCCESS: Content changed.")
        else:
            print("FAILURE: Content did not change.")
            
        browser.close()

if __name__ == "__main__":
    main()
