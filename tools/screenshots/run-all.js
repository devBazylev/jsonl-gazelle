// Regenerates every README screenshot from the current webview code and
// copies the results over the images at the repo root.
//
// Prerequisites (see README.md in this directory):
//   1. From the repo root: npm run compile   (produces out/webview/*.js)
//   2. From this directory: npm install       (installs playwright + monaco-editor here)
//   3. From this directory: npm run generate
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(__dirname, '.generated', 'shots');

const COPY_MAP = {
  'table-light.jpg': 'jsonl-gazelle-screenshot.jpg',
  'table-dark.jpg': 'jsonl-gazelle-screenshot2.jpg',
  'pretty-dark.jpg': 'jsonl-gazelle-screenshot3.jpg',
  'raw-dark.jpg': 'jsonl-gazelle-screenshot4.jpg',
  'feature-map.jpg': 'jsonl-gazelle-feature-map.jpg',
  'tabs-explainer.jpg': 'jsonl-gazelle-tabs.jpg',
};

async function main() {
  require('child_process').execSync('node ' + path.join(__dirname, 'build-html.js'), { stdio: 'inherit' });

  const serve = require('./serve.js');
  await serve.start();

  await require('./shoot.js').main();
  await require('./annotate-capture.js').main();
  await require('./annotate-compose.js').main();
  await require('./tabs-capture.js').main();
  await require('./tabs-compose.js').main();

  for (const [from, to] of Object.entries(COPY_MAP)) {
    fs.copyFileSync(path.join(SHOTS, from), path.join(REPO_ROOT, to));
    console.log(`Updated ${to}`);
  }

  console.log('\nDone. Review the changed jsonl-gazelle-*.jpg files at the repo root with `git diff --stat` before committing.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
