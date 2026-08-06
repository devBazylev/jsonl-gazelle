// Composites tabs-base.png with 3 numbered callouts (Table / Pretty Print /
// Raw) and a short legend into the "three views" explainer image.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '.generated', 'shots');

// tabs-base.png was captured at deviceScaleFactor 2; displayed at that same
// pixel size (2x zoom vs. the real UI) so it reads as a genuine close-up,
// not an upscaled blur.
const SCALE = 2;

const items = [
  { key: 'table', n: 1, label: 'Table', desc: 'Spreadsheet-style grid — sort, hide, edit, and expand nested fields into columns.' },
  { key: 'json', n: 2, label: 'Pretty Print', desc: 'Syntax-highlighted, indented JSON — one record at a time, easy to scan.' },
  { key: 'raw', n: 3, label: 'Raw', desc: 'The file exactly as it is on disk — one JSON object per line.' },
];

async function main() {
  const { crop, buttons } = JSON.parse(fs.readFileSync(path.join(OUT, 'tabs-rects.json'), 'utf8'));
  const imgBuf = fs.readFileSync(path.join(OUT, 'tabs-base.png'));
  const imgUri = `data:image/png;base64,${imgBuf.toString('base64')}`;

  const imgWidth = Math.round(crop.width * SCALE);
  const imgHeight = Math.round(crop.height * SCALE);

  function toImg(rect) {
    return {
      x: (rect.x - crop.x) * SCALE,
      y: (rect.y - crop.y) * SCALE,
      width: rect.width * SCALE,
      height: rect.height * SCALE,
    };
  }

  const pinsHtml = items.map(it => {
    const r = toImg(buttons[it.key]);
    const cx = r.x + r.width / 2;
    const top = r.y - 34;
    return `<div class="pin" style="left:${cx - 15}px; top:${top}px;">${it.n}</div>
    <div class="pin-line" style="left:${cx - 1}px; top:${top + 30}px; height:${r.y - (top + 30) + 6}px;"></div>`;
  }).join('\n');

  const legendHtml = items.map(it =>
    `<div class="legend-item"><span class="legend-num">${it.n}</span><span class="legend-text"><strong>${it.label}</strong> — ${it.desc}</span></div>`
  ).join('\n');

  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>tabs</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .wrap { width: ${imgWidth}px; padding-top: 50px; }
  .frame {
    position: relative; width: ${imgWidth}px; height: ${imgHeight}px;
    background: #ffffff; border: 1px solid #e5e5e5; border-radius: 10px; overflow: visible;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .frame img { display: block; width: ${imgWidth}px; height: ${imgHeight}px; }
  .pin {
    position: absolute; width: 30px; height: 30px; border-radius: 50%;
    background: #e8631c; color: #fff; font-weight: 700; font-size: 15px;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.35); z-index: 2;
  }
  .pin-line { position: absolute; width: 2px; background: #e8631c; opacity: 0.55; z-index: 1; }
  .legend {
    width: ${imgWidth}px; background: #ffffff; padding: 22px 4px 4px;
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 28px;
  }
  .legend-item { display: flex; align-items: flex-start; gap: 10px; }
  .legend-num {
    flex: none; width: 24px; height: 24px; border-radius: 50%; background: #e8631c;
    color: #fff; font-weight: 700; font-size: 13px; display: flex; align-items: center;
    justify-content: center; margin-top: 1px;
  }
  .legend-text { color: #3b3b3b; font-size: 14px; line-height: 1.45; }
  .legend-text strong { color: #111111; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="frame">
      <img src="${imgUri}">
      ${pinsHtml}
    </div>
    <div class="legend">
      ${legendHtml}
    </div>
  </div>
</body>
</html>`;

  const htmlPath = path.join(__dirname, '.generated', 'tabs-final.html');
  fs.writeFileSync(htmlPath, page);

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: imgWidth + 40, height: imgHeight + 220 } });
  await p.goto(`file://${htmlPath}`);
  await p.waitForTimeout(150);
  const wrapBox = await p.locator('.wrap').boundingBox();
  await p.screenshot({
    path: path.join(OUT, 'tabs-explainer.jpg'),
    type: 'jpeg',
    quality: 92,
    clip: { x: wrapBox.x, y: wrapBox.y, width: wrapBox.width, height: wrapBox.height },
  });
  await browser.close();
  console.log('Wrote tabs-explainer.jpg');
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
