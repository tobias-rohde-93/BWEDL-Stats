const assert = require('node:assert/strict');
const fs = require('node:fs');

function innerText(fragment) {
  return fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buildDocument(html) {
  const tables = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tablePattern.exec(html)) !== null) {
    const rows = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(tableMatch[1])) !== null) {
      const cells = [];
      const cellPattern = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch;

      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        cells.push({ innerText: innerText(cellMatch[2]) });
      }

      rows.push({
        querySelectorAll(selector) {
          if (selector !== 'td, th') {
            throw new Error(`Unsupported row selector: ${selector}`);
          }
          return cells;
        },
      });
    }

    tables.push({
      previousElementSibling: null,
      querySelectorAll(selector) {
        if (selector !== 'tr') {
          throw new Error(`Unsupported table selector: ${selector}`);
        }
        return rows;
      },
    });
  }

  return {
    querySelectorAll(selector) {
      if (selector !== 'table') {
        throw new Error(`Unsupported document selector: ${selector}`);
      }
      return tables;
    },
  };
}

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const document = buildDocument(payload.html);
const extractor = new Function('document', `return (${payload.source});`)(document);
const result = extractor();

assert.equal(result.length, 1);
assert.equal(result[0].league, 'Bwedl e.V. 2025/2026 C-Klasse Meisterschaft');
assert.equal(result[0].rows.length, 3);
assert.equal(result[0].rows[0][0], 'Runde/Info');
assert.equal(
  result[0].rows.flat().includes('Bwedl e.V. 2025/2026 C-Klasse Meisterschaft'),
  false,
);
