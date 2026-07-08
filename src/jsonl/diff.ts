/**
 * JSONL-aware diff engine.
 *
 * Aligns the rows of two JSONL documents (line-based LCS with a size guard),
 * then computes field-level changes for row pairs that look like edits of the
 * same record. Pure module (no vscode imports) so it can be unit tested.
 */

export type RowChangeType = 'unchanged' | 'added' | 'removed' | 'modified';

export interface FieldChange {
    /** Dot/bracket path of the changed field, e.g. "user.name" or "tags[2]" */
    path: string;
    type: 'added' | 'removed' | 'changed';
    oldValue?: any;
    newValue?: any;
}

export interface DiffRow {
    type: RowChangeType;
    /** 1-based line number in the old document (null for added rows) */
    oldLineNumber: number | null;
    /** 1-based line number in the new document (null for removed rows) */
    newLineNumber: number | null;
    oldText: string | null;
    newText: string | null;
    /** Present for 'modified' rows */
    fieldChanges?: FieldChange[];
}

export interface JsonlDiffSummary {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
}

export interface JsonlDiffResult {
    rows: DiffRow[];
    summary: JsonlDiffSummary;
}

/** Maximum number of DP cells for the exact LCS; beyond this we fall back to positional pairing. */
const MAX_LCS_CELLS = 4_000_000;

/** Maximum field changes reported per row (safety cap for pathological rows). */
const MAX_FIELD_CHANGES_PER_ROW = 200;

/**
 * Fraction of top-level fields that must be identical for a removed/added row
 * pair to be reported as a single 'modified' row instead of remove + add.
 */
const MODIFIED_SIMILARITY_THRESHOLD = 0.3;

export function computeJsonlDiff(oldText: string, newText: string): JsonlDiffResult {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);

    const rows: DiffRow[] = [];

    // Trim common prefix
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
        rows.push(unchangedRow(oldLines[start], start + 1, start + 1));
        start++;
    }

    // Trim common suffix
    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    const suffixRows: DiffRow[] = [];
    while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
        suffixRows.unshift(unchangedRow(oldLines[oldEnd - 1], oldEnd, newEnd));
        oldEnd--;
        newEnd--;
    }

    const oldMid = oldLines.slice(start, oldEnd);
    const newMid = newLines.slice(start, newEnd);

    const ops = diffLines(oldMid, newMid);

    // Walk the edit script, converting remove+add runs into modified rows where possible
    let i = 0;
    let oldLineNo = start; // 0-based index into full old doc
    let newLineNo = start;
    while (i < ops.length) {
        const op = ops[i];
        if (op === 0) {
            rows.push(unchangedRow(oldMid[oldLineNo - start], oldLineNo + 1, newLineNo + 1));
            oldLineNo++;
            newLineNo++;
            i++;
            continue;
        }

        // Collect a full changed region (everything between two matches). The
        // removed lines are consecutive in the old doc and the added lines are
        // consecutive in the new doc, regardless of op interleaving.
        let removed = 0;
        let added = 0;
        while (i < ops.length && ops[i] !== 0) {
            if (ops[i] === -1) { removed++; } else { added++; }
            i++;
        }

        const paired = Math.min(removed, added);
        for (let k = 0; k < paired; k++) {
            const oldRaw = oldMid[oldLineNo - start];
            const newRaw = newMid[newLineNo - start];
            const pair = diffRowPair(oldRaw, newRaw);
            if (pair) {
                rows.push({
                    type: 'modified',
                    oldLineNumber: oldLineNo + 1,
                    newLineNumber: newLineNo + 1,
                    oldText: oldRaw,
                    newText: newRaw,
                    fieldChanges: pair
                });
            } else {
                rows.push({ type: 'removed', oldLineNumber: oldLineNo + 1, newLineNumber: null, oldText: oldRaw, newText: null });
                rows.push({ type: 'added', oldLineNumber: null, newLineNumber: newLineNo + 1, oldText: null, newText: newRaw });
            }
            oldLineNo++;
            newLineNo++;
        }
        for (let k = paired; k < removed; k++) {
            rows.push({ type: 'removed', oldLineNumber: oldLineNo + 1, newLineNumber: null, oldText: oldMid[oldLineNo - start], newText: null });
            oldLineNo++;
        }
        for (let k = paired; k < added; k++) {
            rows.push({ type: 'added', oldLineNumber: null, newLineNumber: newLineNo + 1, oldText: null, newText: newMid[newLineNo - start] });
            newLineNo++;
        }
    }

    rows.push(...suffixRows);

    const summary: JsonlDiffSummary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const row of rows) {
        summary[row.type]++;
    }

    return { rows, summary };
}

function unchangedRow(text: string, oldLine: number, newLine: number): DiffRow {
    return { type: 'unchanged', oldLineNumber: oldLine, newLineNumber: newLine, oldText: text, newText: text };
}

/**
 * Split document text into lines, dropping the trailing empty line produced
 * by a final newline character.
 */
export function splitLines(text: string): string[] {
    if (text === '') {
        return [];
    }
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

/**
 * Line diff over the (already prefix/suffix-trimmed) middle sections.
 * Returns an edit script as an array of ops: 0 = keep, -1 = remove old line, 1 = add new line.
 * Removals in a replace block are emitted before additions.
 */
function diffLines(oldLines: string[], newLines: string[]): number[] {
    const m = oldLines.length;
    const n = newLines.length;
    if (m === 0 && n === 0) {
        return [];
    }
    if (m === 0) {
        return new Array(n).fill(1);
    }
    if (n === 0) {
        return new Array(m).fill(-1);
    }

    if (m * n > MAX_LCS_CELLS) {
        // Too large for exact LCS: pair lines positionally. For JSONL datasets
        // (append/edit-heavy, prefix/suffix already trimmed) this is a
        // reasonable approximation and keeps memory bounded.
        const ops: number[] = [];
        const paired = Math.min(m, n);
        for (let i = 0; i < paired; i++) {
            if (oldLines[i] === newLines[i]) {
                ops.push(0);
            } else {
                ops.push(-1, 1);
            }
        }
        for (let i = paired; i < m; i++) { ops.push(-1); }
        for (let i = paired; i < n; i++) { ops.push(1); }
        return ops;
    }

    // Intern lines as integers for fast comparison
    const ids = new Map<string, number>();
    const oldIds = new Int32Array(m);
    const newIds = new Int32Array(n);
    for (let i = 0; i < m; i++) {
        let id = ids.get(oldLines[i]);
        if (id === undefined) { id = ids.size; ids.set(oldLines[i], id); }
        oldIds[i] = id;
    }
    for (let j = 0; j < n; j++) {
        let id = ids.get(newLines[j]);
        if (id === undefined) { id = ids.size; ids.set(newLines[j], id); }
        newIds[j] = id;
    }

    // Standard LCS DP table
    const width = n + 1;
    const table = new Uint32Array((m + 1) * width);
    for (let i = 1; i <= m; i++) {
        const rowBase = i * width;
        const prevBase = rowBase - width;
        for (let j = 1; j <= n; j++) {
            if (oldIds[i - 1] === newIds[j - 1]) {
                table[rowBase + j] = table[prevBase + j - 1] + 1;
            } else {
                const up = table[prevBase + j];
                const left = table[rowBase + j - 1];
                table[rowBase + j] = up >= left ? up : left;
            }
        }
    }

    // Backtrack (collect ops in reverse, removals preferred first when walking forward)
    const reversed: number[] = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        if (oldIds[i - 1] === newIds[j - 1]) {
            reversed.push(0);
            i--;
            j--;
        } else if (table[(i - 1) * width + j] >= table[i * width + j - 1]) {
            reversed.push(-1);
            i--;
        } else {
            reversed.push(1);
            j--;
        }
    }
    while (i > 0) { reversed.push(-1); i--; }
    while (j > 0) { reversed.push(1); j--; }
    return reversed.reverse();
}

function tryParse(line: string): any {
    const trimmed = line.trim();
    if (trimmed === '') {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}

function isPlainObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Decide whether an old/new line pair represents an edit of the same record.
 * Returns the field-level changes when it does, or null when the rows should
 * be shown as a plain removal + addition.
 */
export function diffRowPair(oldRaw: string, newRaw: string): FieldChange[] | null {
    const oldObj = tryParse(oldRaw);
    const newObj = tryParse(newRaw);
    if (!isPlainObject(oldObj) || !isPlainObject(newObj)) {
        return null;
    }

    const similarity = leafSimilarity(oldObj, newObj);
    if (similarity < MODIFIED_SIMILARITY_THRESHOLD) {
        return null;
    }

    const changes: FieldChange[] = [];
    collectFieldChanges(oldObj, newObj, '', changes);
    if (changes.length === 0) {
        // Raw text differs (formatting/key order) but values are equal;
        // still surface as modified with a whole-row change marker.
        return null;
    }
    return changes;
}

/** Cap on leaves visited by the similarity check, to bound work on huge rows. */
const MAX_SIMILARITY_LEAVES = 5000;

/** Sentinel for "key absent on this side" — never equals a parsed JSON value. */
const MISSING: unique symbol = Symbol('missing');

/**
 * Fraction of leaf values (union of both rows) that are identical.
 * Comparing at leaf level keeps a change deep inside a nested object from
 * disqualifying the whole record.
 */
export function leafSimilarity(oldObj: any, newObj: any): number {
    const counts = { union: 0, equal: 0 };
    countLeaves(oldObj, newObj, counts);
    return counts.union === 0 ? 1 : counts.equal / counts.union;
}

function countLeaves(oldVal: any, newVal: any, counts: { union: number; equal: number }): void {
    if (counts.union >= MAX_SIMILARITY_LEAVES) {
        return;
    }
    const oldIsObj = isPlainObject(oldVal);
    const newIsObj = isPlainObject(newVal);
    const oldIsArr = Array.isArray(oldVal);
    const newIsArr = Array.isArray(newVal);

    if (oldIsObj && newIsObj) {
        const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
        for (const key of keys) {
            countLeaves(key in oldVal ? oldVal[key] : MISSING, key in newVal ? newVal[key] : MISSING, counts);
        }
        return;
    }
    if (oldIsArr && newIsArr) {
        const maxLen = Math.max(oldVal.length, newVal.length);
        for (let i = 0; i < maxLen; i++) {
            countLeaves(i < oldVal.length ? oldVal[i] : MISSING, i < newVal.length ? newVal[i] : MISSING, counts);
        }
        return;
    }

    // At least one side is a leaf (or the container types differ / a side is missing):
    // compare whole subtrees as single units.
    const oldLeaves = oldVal === MISSING ? 0 : subtreeLeafCount(oldVal);
    const newLeaves = newVal === MISSING ? 0 : subtreeLeafCount(newVal);
    if (oldVal !== MISSING && newVal !== MISSING && canonicalStringify(oldVal) === canonicalStringify(newVal)) {
        counts.union += oldLeaves;
        counts.equal += oldLeaves;
    } else {
        counts.union += Math.max(oldLeaves, newLeaves, 1);
    }
}

function subtreeLeafCount(value: any): number {
    if (isPlainObject(value)) {
        let total = 0;
        for (const key of Object.keys(value)) {
            total += subtreeLeafCount(value[key]);
            if (total >= MAX_SIMILARITY_LEAVES) { return total; }
        }
        return Math.max(total, 1);
    }
    if (Array.isArray(value)) {
        let total = 0;
        for (const item of value) {
            total += subtreeLeafCount(item);
            if (total >= MAX_SIMILARITY_LEAVES) { return total; }
        }
        return Math.max(total, 1);
    }
    return 1;
}

/**
 * Recursively collect field-level changes between two values known to be
 * plain objects. Arrays are compared index-wise.
 */
export function collectFieldChanges(oldObj: any, newObj: any, basePath: string, out: FieldChange[]): void {
    const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const key of keys) {
        if (out.length >= MAX_FIELD_CHANGES_PER_ROW) {
            return;
        }
        const path = basePath === '' ? key : `${basePath}.${key}`;
        const inOld = key in oldObj;
        const inNew = key in newObj;
        if (inOld && !inNew) {
            out.push({ path, type: 'removed', oldValue: oldObj[key] });
        } else if (!inOld && inNew) {
            out.push({ path, type: 'added', newValue: newObj[key] });
        } else {
            compareValues(oldObj[key], newObj[key], path, out);
        }
    }
}

function compareValues(oldVal: any, newVal: any, path: string, out: FieldChange[]): void {
    if (out.length >= MAX_FIELD_CHANGES_PER_ROW) {
        return;
    }
    if (canonicalStringify(oldVal) === canonicalStringify(newVal)) {
        return;
    }
    if (isPlainObject(oldVal) && isPlainObject(newVal)) {
        collectFieldChanges(oldVal, newVal, path, out);
        return;
    }
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        const maxLen = Math.max(oldVal.length, newVal.length);
        for (let i = 0; i < maxLen; i++) {
            if (out.length >= MAX_FIELD_CHANGES_PER_ROW) {
                return;
            }
            const itemPath = `${path}[${i}]`;
            if (i >= oldVal.length) {
                out.push({ path: itemPath, type: 'added', newValue: newVal[i] });
            } else if (i >= newVal.length) {
                out.push({ path: itemPath, type: 'removed', oldValue: oldVal[i] });
            } else {
                compareValues(oldVal[i], newVal[i], itemPath, out);
            }
        }
        return;
    }
    out.push({ path, type: 'changed', oldValue: oldVal, newValue: newVal });
}

/**
 * JSON.stringify with object keys sorted, so logically equal values compare equal.
 */
export function canonicalStringify(value: any): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(v => v === undefined ? 'null' : canonicalStringify(v)).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const key of keys) {
        if (value[key] !== undefined) {
            parts.push(JSON.stringify(key) + ':' + canonicalStringify(value[key]));
        }
    }
    return '{' + parts.join(',') + '}';
}
