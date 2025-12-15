import re

file_path = r'c:\Users\tobir\Dartapp\archive_tables.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern to capture season and full match to find positions
# We iterate line by line to get line numbers
lines = content.split('\n')
for i, line in enumerate(lines):
    if '"league": "Unbekannt"' in line:
        # Look backwards for season
        season = "Unknown"
        for j in range(i, max(0, i-5), -1):
            s_match = re.search(r'"season":\s*"([^"]+)"', lines[j])
            if s_match:
                season = s_match.group(1)
                break
        print(f"Line {i+1}: Season {season}")
