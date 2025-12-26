
try:
    with open('league_data.json', 'r', encoding='utf-8') as f:
        content = f.read()
        print(f"Read {len(content)} chars.")
        print(f"Snippet: {content[:500]}")
        
        if "Reloaded" in content:
            print("Found 'Reloaded' in raw content.")
        else:
            print("NOT Found 'Reloaded' in raw content.")
except Exception as e:
    print(f"Error: {e}")
