const assert = require('assert');
const { scripts } = require('../out/webview/scripts');

// The badge that counts hidden columns on the row-number header, and the
// left-click shortcut it provides to the unhide menu, live inside the webview
// script string. Exercised here against a minimal stub DOM.

function makeElement(tag) {
    return {
        tagName: tag,
        children: [],
        dataset: {},
        style: {},
        className: '',
        textContent: '',
        title: '',
        offsetWidth: 1,
        listeners: {},
        classList: {
            names: new Set(),
            add(name) { this.names.add(name); },
            remove(...names) { names.forEach(name => this.names.delete(name)); },
            contains(name) { return this.names.has(name); },
            toggle(name, force) {
                const next = force === undefined ? !this.names.has(name) : force;
                if (next) { this.names.add(name); } else { this.names.delete(name); }
                return next;
            }
        },
        // innerHTML = '' is how the real code clears a container, so mirror that
        set innerHTML(value) { if (value === '') { this.children = []; } this.html = value; },
        get innerHTML() { return this.html || ''; },
        appendChild(child) { this.children.push(child); return child; },
        addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
        dispatch(type, event) { (this.listeners[type] || []).forEach(handler => handler(event)); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1 }; },
        closest() { return null; },
        remove() {},
        setAttribute() {},
        focus() {},
        scrollIntoView() {}
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

const posted = [];
const sandbox = {
    acquireVsCodeApi: () => ({ postMessage: message => posted.push(message), getState: () => null, setState: () => {} }),
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

const webview = new Function(...Object.keys(sandbox), scripts + `
;return {
    buildTableHeader: buildTableHeader,
    handleContextMenu: handleContextMenu,
    setCurrentData: data => { currentData = data; }
};`)(...Object.values(sandbox));

const column = (path, extra) => Object.assign({ path, displayName: path, visible: true }, extra);

function renderHeader(columns) {
    const data = { rows: [{}], rowIndices: [0], columns, displaySort: null, columnTypes: {} };
    webview.setCurrentData(data);
    webview.buildTableHeader(data);
    const headerRow = stubDocument.getElementById('tableHead').children[0];
    const rowNumberHeader = headerRow.children[0];
    return {
        rowNumberHeader,
        badge: rowNumberHeader.children.find(child => child.className === 'hidden-columns-badge')
    };
}

// Nothing hidden: no badge, and the row-number column keeps its narrow width
const allVisible = renderHeader([column('a'), column('b')]);
assert.strictEqual(allVisible.badge, undefined, 'no badge when every column is visible');
assert.strictEqual(allVisible.rowNumberHeader.style.minWidth, '40px');

// Hidden columns: badge shows how many, and the column widens to fit it
const withHidden = renderHeader([column('a'), column('b', { visible: false }), column('c', { visible: false })]);
assert.ok(withHidden.badge, 'expected a badge when columns are hidden');
assert.strictEqual(withHidden.badge.children.map(child => child.textContent).join(''), '2',
    'badge should show the number of hidden columns');
assert.ok(/2 hidden columns/.test(withHidden.badge.title), 'badge tooltip should say how many');
assert.notStrictEqual(withHidden.rowNumberHeader.style.minWidth, '40px',
    'the row-number column should widen to fit the badge');

// Singular wording for one hidden column
const withOne = renderHeader([column('a'), column('b', { visible: false })]);
assert.ok(/1 hidden column\b/.test(withOne.badge.title), 'badge tooltip should read naturally for one column');

// Columns hidden by expand/collapse bookkeeping are not "hidden" to the user,
// so they must not raise a badge (same rule as the unhide menu itself)
const expanded = renderHeader([column('parent', { visible: false, isExpanded: true }), column('parent.a')]);
assert.strictEqual(expanded.badge, undefined, 'an expanded parent must not count as a hidden column');

// Clicking the badge opens the column menu straight onto the unhide list.
// Re-render first so the badge matches the currently rendered data, as it
// always does in the app.
const badge = renderHeader([column('a'), column('b', { visible: false }), column('c', { visible: false })]).badge;
let propagationStopped = false;
badge.dispatch('click', {
    preventDefault() {},
    stopPropagation() { propagationStopped = true; },
    pageX: 10, pageY: 10, clientX: 10, clientY: 10
});
assert.ok(propagationStopped,
    'the click must stop propagating, or the outside-click handler closes the menu immediately');
assert.strictEqual(stubDocument.getElementById('contextMenu').style.display, 'block', 'the menu should open');
assert.ok(stubDocument.getElementById('unhideColumnsMenuItem').classList.contains('submenu-open'),
    'the unhide submenu should already be open, so unhiding is one click away');

const entries = stubDocument.getElementById('unhideColumnsSubmenu').children;
assert.deepStrictEqual(
    entries.filter(entry => entry.dataset.action === 'unhideColumn').map(entry => entry.dataset.columnPath),
    ['b', 'c'],
    'the submenu should list the hidden columns');
assert.ok(entries.some(entry => entry.dataset.action === 'unhideAllColumns'),
    'more than one hidden column should offer unhiding them all');

// Choosing an entry unhides that column
posted.length = 0;
webview.handleContextMenu({
    target: { closest: () => ({ dataset: { action: 'unhideColumn', columnPath: 'b' }, classList: makeElement('div').classList }) }
});
assert.deepStrictEqual(posted, [{ type: 'showColumns', columnPaths: ['b'] }],
    'choosing a column should ask the extension to show it');

console.log('hiddenColumnsBadge tests passed');
