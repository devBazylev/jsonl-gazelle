const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// The provider needs the `vscode` module, which only exists inside VS Code, so
// it is stubbed with the small surface a file load touches. That lets the real
// column-visibility logic be exercised here rather than only by hand.

const warnings = [];
const vscodeStub = {
    Uri: {
        file: p => ({ toString: () => 'file://' + p, scheme: 'file', fsPath: p }),
        parse: s => ({ toString: () => s, scheme: 'file', fsPath: s }),
        joinPath: (base, ...parts) => ({ toString: () => 'file://' + parts.join('/'), fsPath: parts.join('/') })
    },
    Range: class {},
    WorkspaceEdit: class { replace() {} },
    ProgressLocation: { Notification: 15 },
    RelativePattern: class {},
    workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
        fs: { stat: async () => ({ size: 1 }) },
        applyEdit: async () => true,
        onDidChangeTextDocument: () => ({ dispose() {} }),
        createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} })
    },
    window: {
        showErrorMessage: () => {},
        showWarningMessage: message => { warnings.push(message); },
        showInformationMessage: () => {},
        registerCustomEditorProvider: () => ({ dispose() {} })
    },
    commands: { executeCommand: async () => {} },
    env: { openExternal: () => {}, clipboard: { writeText: async () => {} } }
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    return request === 'vscode' ? 'vscode' : originalResolve.call(this, request, ...rest);
};
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };

const { JsonlViewerProvider } = require('../out/jsonlViewerProvider');

const globalStore = new Map();
const context = {
    globalState: {
        get: (key, fallback) => (globalStore.has(key) ? globalStore.get(key) : fallback),
        update: async (key, value) => globalStore.set(key, value)
    },
    secrets: { get: async () => undefined, store: async () => {} },
    extensionUri: vscodeStub.Uri.file('/ext'),
    subscriptions: []
};

function makeDocument(file) {
    const text = fs.readFileSync(file, 'utf8');
    return {
        uri: vscodeStub.Uri.file(file),
        getText: () => text,
        lineCount: text.split('\n').length,
        isDirty: false,
        save: async () => true
    };
}

async function openFile(file) {
    const provider = new JsonlViewerProvider(context);
    provider.currentWebviewPanel = { webview: { postMessage: () => {} } };
    await provider.loadJsonlFile(makeDocument(file));
    return provider;
}

const dataDir = path.join(__dirname, '..', 'test-data');
const escapedJson = path.join(dataDir, 'escaped-json.jsonl');
const logs = path.join(dataDir, 'logs.jsonl');

function visiblePaths(provider) {
    return provider.columns.filter(col => col.visible).map(col => col.path);
}

(async () => {
    // A file of bare JSON values has exactly one column, so there is nothing to
    // fall back on if it gets hidden - this is what makes the bug reachable
    const escaped = await openFile(escapedJson);
    assert.deepStrictEqual(escaped.columns.map(col => col.path), ['(value)'],
        'lines that are bare JSON strings produce a single "(value)" column');
    assert.deepStrictEqual(visiblePaths(escaped), ['(value)']);

    // Hiding the only visible column would leave a table of numbered rows with
    // no cells and no header to right-click, so it is refused
    warnings.length = 0;
    escaped.toggleColumnVisibility('(value)', makeDocument(escapedJson));
    assert.deepStrictEqual(visiblePaths(escaped), ['(value)'],
        'the only visible column must not be hideable');
    assert.strictEqual(warnings.length, 1, 'refusing to hide the last column should explain why');
    assert.ok(/only visible column/.test(warnings[0]), 'warning should name the reason');

    // ...and nothing bad is persisted, so reopening is unaffected
    const reopened = await openFile(escapedJson);
    assert.deepStrictEqual(visiblePaths(reopened), ['(value)'],
        'reopening the file must still show its column');

    // Columns stay hideable whenever something else remains visible
    const multi = await openFile(logs);
    assert.ok(multi.columns.length > 1, 'fixture should have several columns');
    const firstPath = multi.columns[0].path;
    multi.toggleColumnVisibility(firstPath, makeDocument(logs));
    assert.ok(!visiblePaths(multi).includes(firstPath), 'hiding a column must still work');
    multi.toggleColumnVisibility(firstPath, makeDocument(logs));
    assert.ok(visiblePaths(multi).includes(firstPath), 'unhiding a column must still work');

    // Stored preferences that hide every column are ignored rather than opening
    // the file blank. Preferences persist per file, so honouring such a state
    // would make the file open empty on every load, with no way back.
    globalStore.set('jsonl-gazelle.columnPreferences', {
        [vscodeStub.Uri.file(escapedJson).toString()]: {
            order: ['(value)'],
            visibility: { '(value)': false }
        }
    });
    const healed = await openFile(escapedJson);
    assert.deepStrictEqual(visiblePaths(healed), ['(value)'],
        'a stored all-hidden state must not open the file as a blank table');

    // The same protection applies to a multi-column file
    globalStore.set('jsonl-gazelle.columnPreferences', {
        [vscodeStub.Uri.file(logs).toString()]: {
            order: ['timestamp', 'level', 'message'],
            visibility: { timestamp: false, level: false, message: false }
        }
    });
    const healedMulti = await openFile(logs);
    assert.strictEqual(visiblePaths(healedMulti).length, healedMulti.columns.length,
        'an all-hidden multi-column file must open with its columns restored');

    // A partially hidden state is still honoured - only the all-hidden case is ignored
    globalStore.set('jsonl-gazelle.columnPreferences', {
        [vscodeStub.Uri.file(logs).toString()]: {
            order: ['timestamp', 'level', 'message'],
            visibility: { timestamp: false, level: true, message: true }
        }
    });
    const partial = await openFile(logs);
    assert.ok(!visiblePaths(partial).includes('timestamp'), 'a partially hidden state must be kept');
    assert.ok(visiblePaths(partial).includes('level'));

    console.log('columnVisibility tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
