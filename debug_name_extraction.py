
import json
import re

def normalize(s):
    return s.lower().replace('&nbsp;', '').replace(' ', '')

def debug_extraction():
    # Load Data
    try:
        with open('league_data.json', 'r', encoding='utf-8') as f:
            league_data = json.load(f)
    except Exception as e:
        print(f"Error loading league_data.json: {e}")
        return

    # Target Club
    target_club_name = "DC Reloaded"
    escaped_name = re.escape(target_club_name)
    print(f"Target Club: {target_club_name}")
    print(f"Escaped Name: {escaped_name}")

    # Regex from JS (approximately)
    # const regex = new RegExp(`>([^<]*?${escapedName}[^<]*?)<`, 'i');
    regex_pattern = fr">([^<]*?{escaped_name}[^<]*?)<"
    print(f"Regex Pattern: {regex_pattern}")

    # Access correct root key
    leagues = league_data.get('leagues', league_data)
    
    # Relaxed Search
    print("Searching for 'Reloaded' (partial)...")
    for league_name, data in leagues.items():
        if 'table' in data:
            table_html = data['table']
            if "Reloaded" in table_html:
                print(f"\n--- Found Partial 'Reloaded' in League: {league_name} ---")
                
                # Find index
                idx = table_html.find("Reloaded")
                start = max(0, idx - 100)
                end = min(len(table_html), idx + 100)
                context = table_html[start:end]
                print(f"RAW HTML CONTEXT:\n{context}\n")

                # Try regex again on this snippet
                matches = re.finditer(regex_pattern, table_html, re.IGNORECASE)
                for match in matches:
                    print(f"VALID REGEX MATCH: '{match.group(1)}'")


if __name__ == "__main__":
    debug_extraction()
