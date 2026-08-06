# Screenshot generator (dev-only, not shipped)

Regenerates the `jsonl-gazelle-*.jpg` images used in the repo root README /
Marketplace listing, straight from the real webview code
(`src/webview/template.ts` + `styles.ts` + `scripts.ts`), without needing a
VS Code / Extension Development Host install. It drives a headless Chromium
through Playwright: real clicks, right-click context menus, and hovers
against the actual UI, so the screenshots reflect whatever the code
currently does.

This directory is excluded from the packaged `.vsix` (see `.vscodeignore` at
the repo root: `tools/**`) — it's a dev tool, not something end users need.

## How it works

- `theme.js` — approximate real VS Code Dark Modern / Light Modern
  `--vscode-*` token values, since there's no real VS Code host to supply them.
- `build-html.js` — stitches the compiled webview code
  (`out/webview/*.js`, built by `npm run compile` at the repo root) together
  with a small outer shell standing in for VS Code's tab strip and
  breadcrumb bar, into `harness-dark.html` / `harness-light.html`. Sets
  `<body class="vscode-dark">` / `class="vscode-light"` the same way real VS
  Code does — the webview's own code reads that class to decide the Monaco
  editor theme (`getMonacoTheme()` in `scripts.ts`), so skipping this makes
  Pretty Print / Raw render with mismatched light/dark theming.
- `serve.js` — a local static server for the Monaco editor assets (from this
  directory's own `node_modules`) and the generated harness pages, so
  everything is same-origin `http://127.0.0.1` instead of `file://` and no
  outbound network access is required.
- `state.js` — a tiny stand-in "extension host": seeds table state from
  `fixtures/sample-data.jsonl` and mirrors just enough of
  `jsonlViewerProvider.ts`'s `expandColumn` / display-sort logic to answer
  the handful of webview → extension messages the screenshots exercise.
- `shoot.js` — Table/Pretty Print/Raw screenshots, via real UI interaction
  (clicking the column-expand chevron, right-clicking headers to hide/sort).
- `annotate-capture.js` / `annotate-compose.js` — captures the table state
  plus every called-out element's on-screen coordinates, then composites the
  numbered feature-map image (`jsonl-gazelle-feature-map.jpg`).
- `tabs-capture.js` / `tabs-compose.js` — a zoomed-in crop of the logo + view
  tabs with 3 callouts (`jsonl-gazelle-tabs.jpg`).
- `run-all.js` — runs the whole pipeline and copies the results over the
  `jsonl-gazelle-*.jpg` files at the repo root.

## Usage

```bash
# From the repo root, once:
npm run compile

# From this directory:
npm install
npm run generate
```

Then review with `git diff --stat` (or open the changed files) from the repo
root before committing.

## Notes for future changes

- If the webview toolbar/table markup changes, the CSS selectors in
  `shoot.js` / `annotate-capture.js` / `tabs-capture.js` may need updating
  (e.g. `#refreshBtn`, `.segmented-control button[data-view="table"]`).
- `theme.js`'s color values are a best-effort approximation of VS Code's
  built-in themes, not pulled from VS Code itself — if the screenshots start
  looking obviously off from a real VS Code window, that's the first place
  to check.
- Playwright needs a Chromium build available (`npx playwright install
  chromium` if `npm install` didn't already fetch one for your platform).
