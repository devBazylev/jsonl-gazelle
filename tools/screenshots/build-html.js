// Assembles a standalone HTML page from the extension's *real* webview code
// (src/webview/template.ts + styles.ts + scripts.ts, via their compiled `out/`
// output) plus a small outer shell that stands in for VS Code's own tab strip
// and breadcrumb bar. This lets us screenshot the actual current UI without
// needing a full VS Code / Extension Development Host install.
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, '.generated');

const { getHtmlTemplate } = require(path.join(REPO_ROOT, 'out', 'webview', 'template.js'));
const { styles } = require(path.join(REPO_ROOT, 'out', 'webview', 'styles.js'));
// Monaco is served from a local static server (see serve.js) instead of the
// jsdelivr CDN the real extension uses, so this tooling works fully offline
// and isn't at the mercy of network policy in CI/sandboxed environments.
const scripts = require(path.join(REPO_ROOT, 'out', 'webview', 'scripts.js')).scripts
  .split('https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs').join('http://127.0.0.1:8791/vs');
const { dark, light, chrome, cssVars } = require('./theme.js');

function dataUri(file, mime) {
  const buf = fs.readFileSync(file);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const iconUri = dataUri(path.join(REPO_ROOT, 'gazelle.svg'), 'image/svg+xml');
const animUri = dataUri(path.join(REPO_ROOT, 'gazelle-animation.gif'), 'image/gif');

// Real webview HTML, exactly as the extension builds it (minus the CSP meta,
// which would block our data: image URIs and inline styles we don't need to fight).
const fullInner = getHtmlTemplate(iconUri, animUri, styles, scripts, 'https://example.invalid', 'nonce123')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js', 'http://127.0.0.1:8791/vs/loader.js');
const innerHead = /<head>([\s\S]*)<\/head>/.exec(fullInner)[1];
const innerBody = /<body>([\s\S]*)<\/body>/.exec(fullInner)[1];

function buildPage(themeName, filename) {
  const theme = themeName === 'dark' ? dark : light;
  const c = themeName === 'dark' ? chrome.dark : chrome.light;
  const tabIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c.iconFg}" stroke-width="2"><path d="M4 6h16M4 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/></svg>`;
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>shot</title>
${innerHead}
<style>
  html,body{margin:0;padding:0;background:${theme['editor-background']};}
  :root{ ${cssVars(theme)} }
  .vscode-chrome-tabs{
    display:flex; align-items:center; height:35px; background:${c.tabsBg};
    font-family:${theme['font-family']}; font-size:13px; color:${c.tabActiveFg};
  }
  .vscode-chrome-tab{
    display:flex; align-items:center; gap:6px; height:35px; padding:0 10px 0 12px;
    background:${c.tabActiveBg}; border-right:1px solid ${theme['panel-border']};
    box-shadow: inset 0 -1px 0 ${theme['focusBorder']};
  }
  .vscode-chrome-tab .fname{white-space:nowrap;}
  .vscode-chrome-tab .close{opacity:0.7; margin-left:6px; font-size:14px;}
  .vscode-chrome-tabs-spacer{flex:1; background:${c.tabsBg}; height:35px;}
  .vscode-chrome-actions{display:flex; align-items:center; gap:14px; padding:0 14px; color:${c.iconFg}; font-size:12px; height:35px; background:${c.tabsBg};}
  .vscode-chrome-breadcrumb{
    display:flex; align-items:center; gap:6px; height:26px; padding:0 12px;
    background:${c.breadcrumbBg}; color:${c.breadcrumbFg}; font-size:12px;
    font-family:${theme['font-family']}; border-bottom:1px solid ${theme['panel-border']};
  }
  #app-frame{ height: calc(100vh - 61px); display:flex; flex-direction:column; }
  #app-frame .main-content{ flex:1; min-height:0; }
</style>
</head>
<body class="vscode-${themeName}">
  <div class="vscode-chrome-tabs">
    <div class="vscode-chrome-tab">
      ${tabIcon}
      <span class="fname">large.jsonl</span>
      <span class="close">&times;</span>
    </div>
    <div class="vscode-chrome-tabs-spacer"></div>
    <div class="vscode-chrome-actions">
      <span>HEX</span>
      <span>&#9635;</span>
      <span>&hellip;</span>
    </div>
  </div>
  <div class="vscode-chrome-breadcrumb">
    ${tabIcon}
    <span>large.jsonl</span>
  </div>
  <div id="app-frame">
  ${innerBody}
  </div>
</body>
</html>`;
  fs.writeFileSync(filename, page);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildPage('dark', path.join(OUT_DIR, 'harness-dark.html'));
buildPage('light', path.join(OUT_DIR, 'harness-light.html'));
console.log('Built harness-dark.html and harness-light.html in tools/screenshots/.generated/');
