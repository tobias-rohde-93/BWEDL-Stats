import json

def debug_matching():
    with open('league_data.json', 'r', encoding='utf-8') as f:
        league_data = json.load(f)
    
    with open('club_data.json', 'r', encoding='utf-8') as f:
        club_data = json.load(f)
        
    clubs = club_data['clubs']
    leagues = league_data['leagues']
    
    # Specific test case from screenshot
    target_club_name = "DC Black Scorpions"
    target_league_name = "Bezirksliga"
    
    print(f"Testing for Club: '{target_club_name}' in League prefix: '{target_league_name}'")
    
    # 1. Find the club object
    club = next((c for c in clubs if c['name'] == target_club_name), None)
    if not club:
        print("Club not found in club_data.json")
        return

    print(f"Club found: {club['name']}")
    norm_club = club['name'].lower()
    
    # 2. Find matching leagues
    potential_keys = [k for k in leagues.keys() if k.startswith(target_league_name)]
    print(f"Potential League Keys: {potential_keys}")
    
    for pk in potential_keys:
        table_html = leagues[pk].get('table', '')
        # JS Logic: lTable.replace(/&nbsp;/g, ' ').toLowerCase();
        norm_table = table_html.replace('&nbsp;', ' ').lower()
        
        print(f"\nChecking League: {pk}")
        match = norm_club in norm_table
        print(f"Match found? {match}")
        
        if not match:
             print("Partial Table content (first 500 chars):")
             print(norm_table[:500])
             if "alla" in norm_table:
                 print("Word 'alla' found in table.")
             if "häeeeehr" in norm_table:
                 print("Word 'häeeeehr' found in table.")

if __name__ == "__main__":
    debug_matching()
