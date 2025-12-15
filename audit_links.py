
import json
import re
from bs4 import BeautifulSoup
import os

def normalize_club_name(name):
    """
    Python equivalent of the JS normalizeClubName function.
    """
    if not name:
        return ""
    
    # Lowercase
    name = name.lower()
    
    # Remove punctuation: . ' ` ´
    name = re.sub(r"[.'`´]", "", name)
    
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name)
    
    # Remove e.V. variants globally (not just at end)
    # Equivalent to .replace(/\s+e\s?v/gi, '')
    # After punctuation removal 'e.V.' becomes 'ev'
    name = re.sub(r"\s+e\s?v", "", name)
    
    return name.strip()

def main():
    base_dir = r"c:\Users\tobir\Dartapp"
# ... (rest of imports match)
    club_file = os.path.join(base_dir, "club_data.json")
    league_file = os.path.join(base_dir, "league_data.json")
    
    if not os.path.exists(club_file) or not os.path.exists(league_file):
        print("Missing data files.")
        return

    with open(club_file, "r", encoding="utf-8") as f:
        club_data = json.load(f)
        
    with open(league_file, "r", encoding="utf-8") as f:
        league_data = json.load(f)

    # Pre-process club names maps
    club_map = {} # normalized -> list of original names (for collisions)
    for club in club_data.get("clubs", []):
        norm = normalize_club_name(club["name"])
        if norm not in club_map:
            club_map[norm] = []
        club_map[norm].append(club["name"])
        
    print(f"Loaded {len(club_data.get('clubs', []))} clubs.")
    
    # Iterate leagues
    leagues = league_data.get("leagues", {})
    all_misses = set()
    
    print("\n--- Auditing Links ---")
    
    for league_name, league_info in leagues.items():
        html = league_info.get("table", "")
        if not html:
            continue
            
        soup = BeautifulSoup(html, "html.parser")
        rows = soup.find_all("tr")
        
        for row in rows:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
                
            # Usually the 2nd column (index 1) is the Team Name
            # Header check
            if "Tabelle" in cells[1].get_text():
                continue
                
            team_name_raw = cells[1].get_text(strip=True)
            if not team_name_raw or team_name_raw == "Spielfrei":
                continue
            
            # Filter noise
            if team_name_raw.isdigit() or len(team_name_raw) < 3 or "Spiel-Nr" in team_name_raw:
                continue
            
            # Apply same logic as JS: check if normalized name (possibly with suffix stripped) matches
            
            # 1. Direct normalized match
            norm_team = normalize_club_name(team_name_raw)
            matched = False
            
            if norm_team in club_map:
                matched = True
            else:
                # 2. Try stripping trailing numbers (suffix stripping logic from JS)
                # JS: const potentialMatch = normalizeClubName(club.name);
                #     const tableTeam = normalizeClubName(teamName);
                #     if (tableTeam.startsWith(potentialMatch)) ...
                # Wait, the JS logic iterates CLUBS and checks if the TEAM starts with the CLUB name.
                # So "DC Irish 26 e.V. 3" (team) starts with "DC Irish 26 e.V." (club)
                
                # Let's verify this reverse check
                for club_norm in club_map:
                    if norm_team.startswith(club_norm):
                        # Verify the suffix is just numbers/spaces
                        suffix = norm_team[len(club_norm):].strip()
                        # If suffix is just digits, it's a match
                        if not suffix or suffix.isdigit():
                            matched = True
                            break
            
            if not matched:
                print(f"MISSING LINK in '{league_name}': {team_name_raw}")
                all_misses.add(team_name_raw)
                
    print("\n--- Summary ---")
    if all_misses:
        print(f"Found {len(all_misses)} unique unlinked team names:")
        for miss in sorted(list(all_misses)):
            print(f" - {miss}")
    else:
        print("All teams matched successfully!")

if __name__ == "__main__":
    main()
