const assert = require('assert');
const { scripts } = require('../out/webview/scripts');

// The webview JS ships as a template-literal string that tsc never parses,
// so an escaping mistake would only surface as a blank webview at runtime.
// new Function() parses the script body and throws on any syntax error.
assert.doesNotThrow(() => new Function(scripts), 'webview scripts string must be valid JavaScript');

// Sanity: key functions of the table pipeline are present
['updateTable', 'buildTableHeader', 'renderTableChunk', 'createTableRow', 'rebuildTable', 'flushDeferredUpdate'].forEach(name => {
    assert.ok(scripts.includes('function ' + name), 'expected function ' + name + ' in webview scripts');
});

console.log('webviewScripts tests passed');
