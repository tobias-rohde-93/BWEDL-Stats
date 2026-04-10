import json

with open('c:/Users/tobir/Dartapp/archive_tables.js', 'r', encoding='utf-8') as f:
    content = f.read()

json_str = content.replace('window.ARCHIVE_TABLES = ', '', 1).rstrip(';').strip()
data = json.loads(json_str)

for i in [0, 17, 34]:
    t = data[i]
    print('Index', i, ':', t['season'], '|', t['league'])
    print('  Headers:', t['rows'][0])
    if len(t['rows']) > 1:
        print('  First data row:', t['rows'][1])
    print()
