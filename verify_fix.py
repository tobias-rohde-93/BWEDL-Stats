from playwright.sync_api import sync_playwright
from league_scraper import scrape_league
import json

def test_scrape():
    # URL for A-Klasse (Standard League)
    url = "https://bwedl.de/tabellen/a-klasse-gruppe-1-2025-2026/"
    name = "Test League"
    data = {"leagues": {}}

    print("Starting verification scrape for one league...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        scrape_league(page, url, name, data)
        
        browser.close()

    # Verify results
    match_days = data["leagues"][name]["match_days"]
    print(f"\nScraped {len(match_days)} match days.")
    
    # Check for duplicates
    content_hashes = set()
    duplicates = 0
    for day, content in match_days.items():
        # strict equality check of content
        if content in content_hashes:
            print(f"Duplicate content found for {day}!")
            duplicates += 1
        content_hashes.add(content)
        
        # Print snippet
        print(f"{day}: {content[:30]}...")

    if duplicates == 0:
        print("\nSUCCESS: All match days have unique content.")
    else:
        print(f"\nFAILURE: Found {duplicates} duplicate match days.")

if __name__ == "__main__":
    test_scrape()
