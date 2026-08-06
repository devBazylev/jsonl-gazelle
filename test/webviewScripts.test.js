const assert = require('assert');
const { scripts } = require('../out/webview/scripts');
const { getHtmlTemplate } = require('../out/webview/template');

// The webview JS ships as a template-literal string that tsc never parses,
// so an escaping mistake would only surface as a blank webview at runtime.
// new Function() parses the script body and throws on any syntax error.
assert.doesNotThrow(() => new Function(scripts), 'webview scripts string must be valid JavaScript');

// Sanity: key functions of the table pipeline are present
['updateTable', 'buildTableHeader', 'renderTableChunk', 'createTableRow', 'rebuildTable', 'flushDeferredUpdate', 'appendRows', 'restoreTableScroll', 'updateLoadingBanner', 'renderFileInfo', 'toggleFileInfo', 'setDisplaySort'].forEach(name => {
    assert.ok(scripts.includes('function ' + name), 'expected function ' + name + ' in webview scripts');
});

// Both sort flavours must reach the extension: the display-only sort and the
// one that rewrites the file
assert.ok(scripts.includes("type: 'setDisplaySort'"), 'expected a setDisplaySort message');
assert.ok(scripts.includes("type: 'sortRows'"), 'expected a sortRows message');
['displaySortAsc', 'displaySortDesc', 'clearDisplaySort', 'sortAsc', 'sortDesc'].forEach(action => {
    assert.ok(scripts.includes("case '" + action + "'"), 'expected context menu action ' + action);
});

// Every column context-menu entry must be handled by the script's action
// switch, or the menu item would silently do nothing when clicked.
const html = getHtmlTemplate('icon', 'anim', '', '', 'csp', 'nonce');
const contextMenu = html.slice(html.indexOf('id="contextMenu"'), html.indexOf('id="rowContextMenu"'));
const menuActions = [...contextMenu.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]);
assert.ok(menuActions.length > 0, 'expected data-action entries in the column context menu');
menuActions.forEach(action => {
    assert.ok(scripts.includes("case '" + action + "'"), 'context menu action ' + action + ' has no handler');
});
// The sort entries specifically must be present in the menu markup
['displaySortAsc', 'displaySortDesc', 'clearDisplaySort', 'sortAsc', 'sortDesc'].forEach(action => {
    assert.ok(menuActions.includes(action), 'expected context menu entry for ' + action);
});

console.log('webviewScripts tests passed');
