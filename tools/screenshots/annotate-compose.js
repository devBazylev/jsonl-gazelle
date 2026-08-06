// Composites annotate-base.png with numbered callout pins (placed using the
// coordinates from annotate-capture.js) and a legend into the final
// feature-map image.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '.generated', 'shots');

const items = [
  { key: 'tabs', n: 1, label: 'Table / Pretty Print / Raw', desc: 'Three synced views of the same file: spreadsheet-style table, syntax-highlighted pretty JSON, or raw JSONL text.' },
  { key: 'refresh', n: 2, label: 'Refresh', desc: 'Reload from disk (Ctrl/Cmd+R or F5) if the file changed outside VS Code.' },
  { key: 'follow', n: 3, label: 'Follow mode', desc: 'Tail -f style auto-scroll — watches the file and jumps to new rows as they arrive.' },
  { key: 'find', n: 4, label: 'Find & Replace', desc: 'Search and replace across every cell, with regex, case, and whole-word options.' },
  { key: 'columns', n: 5, label: 'Manage columns', desc: 'Show, hide, reorder, add, or AI-generate columns from one panel.' },
  { key: 'fileInfo', n: 6, label: 'File stats', desc: 'Record count, column count, and file size at a glance.' },
  { key: 'settings', n: 7, label: 'AI settings', desc: 'Configure OpenAI, Anthropic, Gemini, or a local OpenAI-compatible model.' },
  { key: 'wrapText', n: 8, label: 'Wrap text', desc: 'Wrap long cell values instead of truncating them.' },
  { key: 'hiddenBadge', n: 9, label: 'Hidden-columns badge', desc: 'Shows how many columns are hidden — click to bring one back.' },
  { key: 'expandedCol', n: 10, label: 'Column expansion', desc: 'Nested objects/arrays expand into their own sortable, editable columns.' },
  { key: 'sortHeader', n: 11, label: 'Sort & column menu', desc: 'Right-click any header to sort (types auto-detected), hide, insert, or add AI columns. Sorted columns show ▲/▼.' },
];

function pinStyle(rect) {
  const cx = rect.x + rect.width - 6;
  const cy = rect.y + 2;
  return `left:${cx - 13}px; top:${cy - 13}px;`;
}

async function main() {
  const rects = JSON.parse(fs.readFileSync(path.join(OUT, 'annotate-rects.json'), 'utf8'));
  const imgBuf = fs.readFileSync(path.join(OUT, 'annotate-base.png'));
  const imgUri = `data:image/png;base64,${imgBuf.toString('base64')}`;

  const pinsHtml = items.map(it => `<div class="pin" style="${pinStyle(rects[it.key])}">${it.n}</div>`).join('\n');
  const legendHtml = items.map(it =>
    `<div class="legend-item"><span class="legend-num">${it.n}</span><span class="legend-text"><strong>${it.label}</strong> — ${it.desc}</span></div>`
  ).join('\n');

  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>feature map</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #1e1e1e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .frame { position: relative; width: 1440px; }
  .frame img { display: block; width: 1440px; }
  .pin {
    position: absolute; width: 26px; height: 26px; border-radius: 50%;
    background: #e8631c; color: #fff; font-weight: 700; font-size: 13px;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.55);
  }
  .legend {
    width: 1440px; background: #17171a; padding: 28px 36px 32px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px 40px;
  }
  .legend-title {
    grid-column: 1 / -1; color: #ffffff; font-size: 20px; font-weight: 700;
    margin-bottom: 6px;
  }
  .legend-item { display: flex; align-items: flex-start; gap: 10px; }
  .legend-num {
    flex: none; width: 22px; height: 22px; border-radius: 50%; background: #e8631c;
    color: #fff; font-weight: 700; font-size: 12px; display: flex; align-items: center;
    justify-content: center; margin-top: 1px;
  }
  .legend-text { color: #d4d4d4; font-size: 13.5px; line-height: 1.45; }
  .legend-text strong { color: #ffffff; }
</style>
</head>
<body>
  <div class="frame">
    <img src="${imgUri}">
    ${pinsHtml}
  </div>
  <div class="legend">
    <div class="legend-title">JSONL Gazelle at a glance</div>
    ${legendHtml}
  </div>
</body>
</html>`;

  const htmlPath = path.join(__dirname, '.generated', 'annotate-final.html');
  fs.writeFileSync(htmlPath, page);

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`file://${htmlPath}`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(OUT, 'feature-map.jpg'), fullPage: true, type: 'jpeg', quality: 84 });
  await browser.close();
  console.log('Wrote feature-map.jpg');
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
