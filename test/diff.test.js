const assert = require('assert');
const { computeJsonlDiff, diffRowPair, canonicalStringify, splitLines } = require('../out/jsonl/diff');

// --- splitLines ---
assert.deepStrictEqual(splitLines(''), []);
assert.deepStrictEqual(splitLines('{"a":1}\n'), ['{"a":1}']);
assert.deepStrictEqual(splitLines('{"a":1}\r\n{"b":2}'), ['{"a":1}', '{"b":2}']);

// --- canonicalStringify: key order does not matter ---
assert.strictEqual(
    canonicalStringify({ b: 2, a: { d: 4, c: 3 } }),
    canonicalStringify({ a: { c: 3, d: 4 }, b: 2 })
);

// --- identical documents ---
{
    const text = '{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n';
    const result = computeJsonlDiff(text, text);
    assert.deepStrictEqual(result.summary, { added: 0, removed: 0, modified: 0, unchanged: 2 });
}

// --- pure addition ---
{
    const oldText = '{"id":1}\n';
    const newText = '{"id":1}\n{"id":2}\n';
    const result = computeJsonlDiff(oldText, newText);
    assert.deepStrictEqual(result.summary, { added: 1, removed: 0, modified: 0, unchanged: 1 });
    const added = result.rows.find(r => r.type === 'added');
    assert.strictEqual(added.newLineNumber, 2);
    assert.strictEqual(added.oldLineNumber, null);
    assert.strictEqual(added.newText, '{"id":2}');
}

// --- pure removal ---
{
    const oldText = '{"id":1}\n{"id":2}\n{"id":3}\n';
    const newText = '{"id":1}\n{"id":3}\n';
    const result = computeJsonlDiff(oldText, newText);
    assert.deepStrictEqual(result.summary, { added: 0, removed: 1, modified: 0, unchanged: 2 });
    const removed = result.rows.find(r => r.type === 'removed');
    assert.strictEqual(removed.oldLineNumber, 2);
    assert.strictEqual(removed.newLineNumber, null);
}

// --- field edit of the same record is reported as modified with field changes ---
{
    const oldText = '{"id":1,"name":"Alice","age":30}\n{"id":2,"name":"Bob","age":25}\n';
    const newText = '{"id":1,"name":"Alicia","age":30}\n{"id":2,"name":"Bob","age":25}\n';
    const result = computeJsonlDiff(oldText, newText);
    assert.deepStrictEqual(result.summary, { added: 0, removed: 0, modified: 1, unchanged: 1 });
    const modified = result.rows.find(r => r.type === 'modified');
    assert.strictEqual(modified.oldLineNumber, 1);
    assert.strictEqual(modified.newLineNumber, 1);
    assert.deepStrictEqual(modified.fieldChanges, [
        { path: 'name', type: 'changed', oldValue: 'Alice', newValue: 'Alicia' }
    ]);
}

// --- nested and array field changes ---
{
    const oldLine = JSON.stringify({ id: 7, user: { name: 'Ann', address: { city: 'Wien' } }, tags: ['a', 'b'] });
    const newLine = JSON.stringify({ id: 7, user: { name: 'Ann', address: { city: 'Graz' } }, tags: ['a', 'b', 'c'], active: true });
    const changes = diffRowPair(oldLine, newLine);
    assert.ok(changes, 'expected the pair to be treated as modified');
    const byPath = Object.fromEntries(changes.map(c => [c.path, c]));
    assert.deepStrictEqual(byPath['user.address.city'], { path: 'user.address.city', type: 'changed', oldValue: 'Wien', newValue: 'Graz' });
    assert.deepStrictEqual(byPath['tags[2]'], { path: 'tags[2]', type: 'added', newValue: 'c' });
    assert.deepStrictEqual(byPath['active'], { path: 'active', type: 'added', newValue: true });
    assert.strictEqual(changes.length, 3);
}

// --- removed field ---
{
    const changes = diffRowPair('{"id":1,"legacy":true,"x":1}', '{"id":1,"x":1}');
    assert.deepStrictEqual(changes, [{ path: 'legacy', type: 'removed', oldValue: true }]);
}

// --- completely different records are NOT paired as modified ---
{
    const oldText = '{"id":1,"name":"Alice","age":30}\n';
    const newText = '{"id":99,"name":"Zed","age":77}\n';
    const result = computeJsonlDiff(oldText, newText);
    assert.deepStrictEqual(result.summary, { added: 1, removed: 1, modified: 0, unchanged: 0 });
}

// --- invalid JSON lines fall back to plain add/remove ---
{
    const oldText = 'not json at all\n';
    const newText = 'also not json\n';
    const result = computeJsonlDiff(oldText, newText);
    assert.deepStrictEqual(result.summary, { added: 1, removed: 1, modified: 0, unchanged: 0 });
}

// --- empty old document (e.g. file not yet in HEAD): everything added ---
{
    const result = computeJsonlDiff('', '{"id":1}\n{"id":2}\n');
    assert.deepStrictEqual(result.summary, { added: 2, removed: 0, modified: 0, unchanged: 0 });
}

// --- key reorder with equal values: raw lines differ but values equal -> add/remove (no empty modified row) ---
{
    const result = computeJsonlDiff('{"a":1,"b":2}\n', '{"b":2,"a":1}\n');
    assert.deepStrictEqual(result.summary, { added: 1, removed: 1, modified: 0, unchanged: 0 });
}

// --- interleaved edits keep line numbers consistent ---
{
    const oldText = [
        '{"id":1,"v":"keep"}',
        '{"id":2,"v":"old"}',
        '{"id":3,"v":"keep"}',
        '{"id":4,"v":"gone"}',
        '{"id":5,"v":"keep"}'
    ].join('\n') + '\n';
    const newText = [
        '{"id":1,"v":"keep"}',
        '{"id":2,"v":"new"}',
        '{"id":3,"v":"keep"}',
        '{"id":5,"v":"keep"}',
        '{"id":6,"v":"fresh"}'
    ].join('\n') + '\n';
    const result = computeJsonlDiff(oldText, newText);
    assert.deepStrictEqual(result.summary, { added: 1, removed: 1, modified: 1, unchanged: 3 });
    const modified = result.rows.find(r => r.type === 'modified');
    assert.strictEqual(modified.oldLineNumber, 2);
    assert.strictEqual(modified.newLineNumber, 2);
    const removed = result.rows.find(r => r.type === 'removed');
    assert.strictEqual(removed.oldLineNumber, 4);
    const added = result.rows.find(r => r.type === 'added');
    assert.strictEqual(added.newLineNumber, 5);
    // Rows appear in document order
    const types = result.rows.map(r => r.type);
    assert.deepStrictEqual(types, ['unchanged', 'modified', 'unchanged', 'removed', 'unchanged', 'added']);
}

// --- large input takes the positional fallback path without throwing ---
{
    const oldRows = [];
    const newRows = [];
    for (let i = 0; i < 2500; i++) {
        oldRows.push(JSON.stringify({ id: i, value: 'row-' + i }));
        newRows.push(JSON.stringify({ id: i, value: i === 1250 ? 'edited' : 'row-' + i }));
    }
    // Force distinct prefix/suffix so the trimmed middle stays large
    oldRows.unshift('{"head":"old"}');
    newRows.unshift('{"head":"new"}');
    oldRows.push('{"tail":"old"}');
    newRows.push('{"tail":"new"}');
    const result = computeJsonlDiff(oldRows.join('\n') + '\n', newRows.join('\n') + '\n');
    assert.strictEqual(result.summary.unchanged, 2499);
    assert.ok(result.summary.modified >= 1);
}

console.log('diff tests passed');
