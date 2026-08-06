// Captures the Table, Pretty Print, and Raw view screenshots by driving the
// real webview UI (clicks, right-click menus, hovers) exactly as a user
// would, against the harness pages built by build-html.js.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const state = require('./state.js');

const OUT = path.join(__dirname, '.generated', 'shots');
const { PORT } = require('./serve.js');

async function withPage(themeName, fn) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 520 }, deviceScaleFactor: 1 });

  let bridgeState = state.makeInitialState();

  await page.exposeFunction('hostBridge', (msg) => {
    if (msg.type === 'expandColumn') state.expandColumn(bridgeState, msg.columnPath);
    else if (msg.type === 'toggleColumnVisibility') {
      const c = bridgeState.columns.find(c => c.path === msg.columnPath);
      if (c) c.visible = !c.visible;
    } else if (msg.type === 'setDisplaySort') {
      state.applyDisplaySort(bridgeState, msg.columnPath, msg.direction);
    } else if (msg.type === 'getSettings') {
      return { type: 'settingsLoaded', settings: {} };
    }
    return { type: 'update', data: bridgeState };
  });

  await page.addInitScript(() => {
    // Real VS Code injects this webview API global; the harness pages call it
    // the same way the real extension's webview does.
    window.acquireVsCodeApi = () => ({
      postMessage: (msg) => {
        window.hostBridge(msg).then(reply => {
          if (reply) window.postMessage(reply, '*');
        });
      },
      getState: () => undefined,
      setState: () => {},
    });
  });

  await page.goto(`http://127.0.0.1:${PORT}/harness-${themeName}.html`);
  await page.waitForTimeout(200);

  // Simulate the extension's initial full snapshot post.
  await page.evaluate((data) => window.postMessage({ type: 'update', data }, '*'), bridgeState);
  await page.waitForTimeout(200);

  await fn(page, bridgeState);

  await browser.close();
}

// A feature-rich table configuration reused by both hero shots and the
// feature-map base image: sorted, one hidden column, one expanded column.
async function applyRichTableState(page) {
  const usageHeader = page.locator('th[data-column-path="usage"] .expand-button');
  await usageHeader.click();
  await page.waitForTimeout(150);

  await page.locator('th[data-column-path="type"]').click({ button: 'right' });
  await page.waitForTimeout(100);
  await page.locator('.context-menu-item[data-action="hideColumn"]').click();
  await page.waitForTimeout(150);

  await page.locator('th[data-column-path="revenue"]').click({ button: 'right' });
  await page.waitForTimeout(100);
  await page.locator('#sortMenuItem').hover();
  await page.waitForTimeout(100);
  await page.locator('.context-menu-item[data-action="displaySortDesc"]').click();
  await page.waitForTimeout(150);
  await page.mouse.click(5, 5);
}

async function shootTable() {
  await withPage('light', async (page) => {
    await applyRichTableState(page);
    await page.screenshot({ path: path.join(OUT, 'table-light.jpg'), type: 'jpeg', quality: 82 });
  });

  await withPage('dark', async (page) => {
    await applyRichTableState(page);
    await page.screenshot({ path: path.join(OUT, 'table-dark.jpg'), type: 'jpeg', quality: 82 });
  });
}

async function shootPretty() {
  await withPage('dark', async (page) => {
    await page.locator('.segmented-control button[data-view="json"]').click();
    await page.waitForTimeout(1200); // let Monaco load & render
    await page.screenshot({ path: path.join(OUT, 'pretty-dark.jpg'), type: 'jpeg', quality: 82 });
  });
}

async function shootRaw() {
  await withPage('dark', async (page) => {
    await page.locator('.segmented-control button[data-view="raw"]').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'raw-dark.jpg'), type: 'jpeg', quality: 82 });
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await shootTable();
  await shootPretty();
  await shootRaw();
  console.log('Wrote table-light.jpg, table-dark.jpg, pretty-dark.jpg, raw-dark.jpg');
}

module.exports = { main, withPage, applyRichTableState, OUT };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
