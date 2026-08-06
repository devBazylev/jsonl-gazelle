// Captures the base screenshot for the feature-map image (same rich table
// configuration as the table-light hero shot) plus the on-screen pixel
// coordinates of every UI element the feature map calls out, so
// annotate-compose.js can place numbered pins precisely.
const path = require('path');
const fs = require('fs');
const { withPage, applyRichTableState, OUT } = require('./shoot.js');

async function main() {
  await withPage('light', async (page) => {
    await applyRichTableState(page);

    const rects = await page.evaluate(() => {
      function r(sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
      return {
        tabs: r('.segmented-control button[data-view="table"]'),
        refresh: r('#refreshBtn'),
        follow: r('#followBtn'),
        find: r('#findReplaceBtn'),
        columns: r('#columnManagerBtn'),
        fileInfo: r('#fileInfoBtn'),
        settings: r('#settingsBtn'),
        wrapText: r('.wrap-text-control'),
        hiddenBadge: r('.hidden-columns-badge'),
        sortHeader: r('th[data-column-path="revenue"]'),
        expandedCol: r('th[data-column-path="usage.apiCalls"]'),
      };
    });

    // Crop to the actual content height (last table row) instead of the full
    // viewport, so the composited feature-map image doesn't carry dead space
    // between the table and the legend below it.
    const contentBottom = await page.evaluate(() => {
      const rows = document.querySelectorAll('#tableBody tr');
      const last = rows[rows.length - 1];
      return last ? Math.ceil(last.getBoundingClientRect().bottom) + 1 : 520;
    });

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'annotate-base.png'), clip: { x: 0, y: 0, width: 1440, height: contentBottom } });
    fs.writeFileSync(path.join(OUT, 'annotate-rects.json'), JSON.stringify(rects, null, 2));
  });

  console.log('Wrote annotate-base.png and annotate-rects.json');
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
