const assert = require('assert');
const { scripts } = require('../out/webview/scripts');

// The "row moved" notice only exists inside the webview script string, so it is
// exercised here against a minimal stub DOM. This is deliberately small: enough
// of the DOM for the notice and the jump to run, nothing more.

function makeElement(tag) {
    return {
        tagName: tag,
        children: [],
        dataset: {},
        style: {},
        textContent: '',
        innerHTML: '',
        title: '',
        offsetWidth: 1,
        scrolledIntoView: false,
        classList: {
            names: new Set(),
            add(name) { this.names.add(name); },
            remove(name) { this.names.delete(name); },
            contains(name) { return this.names.has(name); }
        },
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1 }; },
        closest() { return null; },
        remove() {},
        setAttribute() {},
        focus() {},
        scrollIntoView() { this.scrolledIntoView = true; }
    };
}

const elementsById = {};
const stubDocument = {
    getElementById: id => elementsById[id] || (elementsById[id] = makeElement('div')),
    createElement: makeElement,
    createTextNode: text => ({ textContent: text, children: [], classList: { contains: () => false } }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};

const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => null, setState: () => {} }),
    document: stubDocument,
    window: {
        innerWidth: 1000,
        innerHeight: 800,
        addEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener() {} })
    },
    requestAnimationFrame: () => {},
    setTimeout: () => 1,
    setInterval: () => {},
    clearTimeout: () => {},
    console,
    navigator: { clipboard: {} },
    require: undefined
};

const harness = scripts + `
;return {
    watchSortJump: watchSortJump,
    checkSortJump: checkSortJump,
    hideSortJumpNotice: hideSortJumpNotice,
    jumpToDisplayRow: jumpToDisplayRow,
    setDisplaySort: setDisplaySort,
    setCurrentData: data => { currentData = data; },
    getWatch: () => pendingSortJumpWatch,
    setRenderState: (rendered, total) => {
        tableRenderState.renderedRows = rendered;
        tableRenderState.totalRows = total;
    },
    getSelectedRowActualIndex: () => selectedRowActualIndex
};`;
const webview = new Function(...Object.keys(sandbox), harness)(...Object.values(sandbox));

const notice = stubDocument.getElementById('sortJumpNotice');
const noticeText = stubDocument.getElementById('sortJumpNoticeText');

// File rows 0,1,2 shown sorted as [2,0,1] - so file row 0 sits at position 1
function sortedView(rowIndices) {
    return {
        rowIndices: rowIndices,
        displaySort: { columnPath: 'ts', direction: 'asc' },
        rows: [{}, {}, {}]
    };
}

function isNoticeVisible() {
    return notice.style.display === 'flex';
}

// A row that moves produces the notice, tracking the row it should jump to
webview.setCurrentData(sortedView([2, 0, 1]));
webview.watchSortJump(0, 'ts');
assert.ok(webview.getWatch(), 'editing the sorted column must arm the watch');
webview.setCurrentData(sortedView([0, 2, 1]));
webview.checkSortJump();
assert.ok(isNoticeVisible(), 'a row that moved must produce the notice');
assert.strictEqual(notice.dataset.targetRow, '0', 'notice must track the row, not a position that can go stale');
assert.strictEqual(webview.getWatch(), null, 'the watch must be consumed');
// Names the file line and both display positions - the # column shows positions,
// so "row 1 moved to row 1" would otherwise be unreadable
assert.ok(/file line 1/.test(noticeText.textContent), 'notice should name the file line');
assert.ok(/#2 to #1/.test(noticeText.textContent), 'notice should name both positions');

// A row that stays put produces nothing
webview.hideSortJumpNotice();
webview.setCurrentData(sortedView([2, 0, 1]));
webview.watchSortJump(0, 'ts');
webview.checkSortJump();
assert.ok(!isNoticeVisible(), 'an unmoved row must not produce a notice');

// Editing any other column cannot reorder a stable sort, so it is not watched
webview.setCurrentData(sortedView([2, 0, 1]));
webview.watchSortJump(0, 'name');
assert.strictEqual(webview.getWatch(), null, 'edits outside the sorted column must not arm the watch');

// Nothing to report when no sort is active
webview.setCurrentData({ rowIndices: [0, 1, 2], displaySort: null, rows: [{}, {}, {}] });
webview.watchSortJump(0, 'ts');
assert.strictEqual(webview.getWatch(), null, 'an unsorted view must not arm the watch');

// A row filtered out of the view entirely has nowhere to jump to
webview.hideSortJumpNotice();
webview.setCurrentData(sortedView([2, 0, 1]));
webview.watchSortJump(0, 'ts');
webview.setCurrentData(sortedView([2, 1]));
webview.checkSortJump();
assert.ok(!isNoticeVisible(), 'a row filtered out of the view must not produce a notice');

// Regression: clearing or changing the sort before the update lands means any
// movement is down to the re-sort, not the edit - reporting it would misattribute
webview.hideSortJumpNotice();
webview.setCurrentData(sortedView([2, 0, 1]));
webview.watchSortJump(0, 'ts');
webview.setDisplaySort(null, null);
webview.setCurrentData({ rowIndices: [0, 1, 2], displaySort: null, rows: [{}, {}, {}] });
webview.checkSortJump();
assert.ok(!isNoticeVisible(), 'clearing the sort mid-edit must not produce a notice');

webview.hideSortJumpNotice();
webview.setCurrentData(sortedView([2, 0, 1]));
webview.watchSortJump(0, 'ts');
webview.setCurrentData({
    rowIndices: [1, 0, 2],
    displaySort: { columnPath: 'ts', direction: 'desc' }, // direction flipped
    rows: [{}, {}, {}]
});
webview.checkSortJump();
assert.ok(!isNoticeVisible(), 'reversing the sort mid-edit must not produce a notice');

// Jumping scrolls the row into view, selects it and flashes it
const tbody = stubDocument.getElementById('tableBody');
const displayedIndices = [2, 0, 1];
tbody.children = displayedIndices.map(actualIndex => {
    const tr = makeElement('tr');
    tr.dataset.actualIndex = String(actualIndex);
    return tr;
});
webview.setCurrentData(sortedView(displayedIndices));
webview.setRenderState(3, 3);
webview.jumpToDisplayRow(1);
const target = tbody.children[1];
assert.ok(target.scrolledIntoView, 'jump must scroll the row into view');
assert.ok(target.classList.contains('selected'), 'jump must select the row');
assert.ok(target.classList.contains('row-flash'), 'jump must flash the row');
assert.strictEqual(webview.getSelectedRowActualIndex(), 0, 'selection must track the file index');

console.log('sortJumpNotice tests passed');
