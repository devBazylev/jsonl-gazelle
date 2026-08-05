const assert = require('assert');
const { getUnhideableColumns } = require('../out/jsonl/columns');
const { scripts } = require('../out/webview/scripts');

// The webview cannot import from src/jsonl, so it carries a copy of the helper.
// Pull that copy out of the script string and run the same cases against both.
const START = '// --- shared:unhideable-columns';
const END = '// --- end shared:unhideable-columns';
const startIndex = scripts.indexOf(START);
const endIndex = scripts.indexOf(END);
assert.ok(startIndex !== -1 && endIndex > startIndex, 'webview scripts must contain the shared:unhideable-columns block');

const webviewSource = scripts.slice(scripts.indexOf('\n', startIndex), endIndex);
const webviewImpl = new Function(webviewSource + '\nreturn getUnhideableColumns;')();

const column = (path, extra) => Object.assign({ path, displayName: path, visible: true }, extra);

const cases = [
    {
        name: 'user-hidden columns are unhideable',
        columns: [column('a'), column('b', { visible: false }), column('c', { visible: false })],
        expected: ['b', 'c']
    },
    {
        name: 'nothing hidden',
        columns: [column('a'), column('b')],
        expected: []
    },
    {
        name: 'an expanded parent is not offered (its children stand in for it)',
        columns: [
            column('meta', { visible: false, isExpanded: true }),
            column('meta.id', { parentPath: 'meta' })
        ],
        expected: []
    },
    {
        name: 'hidden children of a collapsed parent are not offered',
        columns: [
            column('meta'),
            column('meta.id', { visible: false, parentPath: 'meta', isManuallyAdded: true })
        ],
        expected: []
    },
    {
        name: 'a child hidden while its parent is expanded is offered',
        columns: [
            column('meta', { visible: false, isExpanded: true }),
            column('meta.id', { visible: false, parentPath: 'meta' }),
            column('meta.name', { parentPath: 'meta' })
        ],
        expected: ['meta.id']
    },
    {
        name: 'a child whose parent no longer exists is not offered',
        columns: [column('meta.id', { visible: false, parentPath: 'meta' })],
        expected: []
    }
];

cases.forEach(testCase => {
    const fromProvider = getUnhideableColumns(testCase.columns).map(col => col.path);
    const fromWebview = webviewImpl(testCase.columns).map(col => col.path);
    assert.deepStrictEqual(fromProvider, testCase.expected, testCase.name + ' (provider)');
    assert.deepStrictEqual(fromWebview, testCase.expected, testCase.name + ' (webview)');
});

assert.deepStrictEqual(getUnhideableColumns(undefined), []);
assert.deepStrictEqual(webviewImpl(undefined), []);

// Menu wiring: the entries and the message they post must exist in the webview bundle
['unhideColumnsMenuItem', 'unhideColumnsSubmenu', 'unhideAllColumns', "type: 'showColumns'"].forEach(needle => {
    assert.ok(scripts.includes(needle), 'expected ' + needle + ' in webview scripts');
});

console.log('columns tests passed');
