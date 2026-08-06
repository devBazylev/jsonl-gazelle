// Captures a zoomed-in crop of just the logo + view tabs (Table / Pretty
// Print / Raw), at 2x scale so it reads as a genuine close-up.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const state = require('./state.js');
const { PORT } = require('./serve.js');

const OUT = path.join(__dirname, '.generated', 'shots');

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 200 }, deviceScaleFactor: 2 });

  let bridgeState = state.makeInitialState();
  await page.exposeFunction('hostBridge', () => ({ type: 'update', data: bridgeState }));
  await page.addInitScript(() => {
    window.acquireVsCodeApi = () => ({
      postMessage: (msg) => { window.hostBridge(msg).then(reply => { if (reply) window.postMessage(reply, '*'); }); },
      getState: () => undefined, setState: () => {},
    });
  });

  await page.goto(`http://127.0.0.1:${PORT}/harness-light.html`);
  await page.waitForTimeout(150);
  await page.evaluate((data) => window.postMessage({ type: 'update', data }, '*'), bridgeState);
  await page.waitForTimeout(150);

  const rect = await page.evaluate(() => {
    const logo = document.querySelector('.logo-container').getBoundingClientRect();
    const tabs = document.querySelector('.segmented-control').getBoundingClientRect();
    const pad = 14;
    return {
      x: Math.max(0, logo.x - pad),
      y: Math.max(0, Math.min(logo.y, tabs.y) - pad),
      width: (tabs.x + tabs.width) - logo.x + pad * 2,
      height: Math.max(logo.height, tabs.height) + pad * 2,
    };
  });

  const buttonRects = await page.evaluate(() => {
    function r(sel) {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    return {
      table: r('.segmented-control button[data-view="table"]'),
      json: r('.segmented-control button[data-view="json"]'),
      raw: r('.segmented-control button[data-view="raw"]'),
    };
  });

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'tabs-base.png'), clip: rect });
  fs.writeFileSync(path.join(OUT, 'tabs-rects.json'), JSON.stringify({ crop: rect, buttons: buttonRects }, null, 2));

  await browser.close();
  console.log('Wrote tabs-base.png and tabs-rects.json');
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
