/**
 * Behavior tests for the lane selection feature.
 *
 *   - sdSelectAll: toggles selection across all unlocked lanes
 *   - sdToggleSelectMode: gesture-mode flag (clicking lanes toggles select)
 *   - sdToggleLaneSelection: per-lane toggle, ignores locked
 *   - Target resolution: selection wins over active; locked always skipped
 *   - Lock interaction: locking a lane clears its selection
 *
 * Pure-logic specs — DOM-bound code in canvas.js can't be loaded directly,
 * so these tests re-implement the same logic and validate the contract.
 * If main canvas.js drifts, update both sides to match.
 *
 * Run: node test/test-select-feature.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

// ─── Spec implementations (mirror canvas.js logic) ───────────────

function specGetTargetParams(params, activeId) {
    // Selection wins when non-empty.
    const selected = params.filter(p => p.selected && !p.locked);
    if (selected.length > 0) return selected;
    const p = params.find(p => p.envelopeId === activeId);
    return (p && !p.locked) ? [p] : [];
}

function specHasSelection(params) {
    return params.some(p => p.selected && !p.locked);
}

function specGetUnlockedParams(params) {
    if (specHasSelection(params)) {
        return params.filter(p => p.selected && !p.locked);
    }
    return params.filter(p => !p.locked);
}

function specSelectAll(params) {
    const unlocked = params.filter(p => !p.locked);
    if (!unlocked.length) return;
    const allSelected = unlocked.every(p => p.selected);
    if (allSelected) {
        // Second click on fully-selected state acts as "deselect all"
        params.forEach(p => { p.selected = false; });
    } else {
        params.forEach(p => {
            if (!p.locked) p.selected = true;
        });
    }
}

function specToggleLaneSelection(params, envelopeId) {
    const p = params.find(p => p.envelopeId === envelopeId);
    if (!p || p.locked) return;
    p.selected = !p.selected;
}

function specToggleLockLane(params, envelopeId) {
    const p = params.find(p => p.envelopeId === envelopeId);
    if (!p) return;
    p.locked = !p.locked;
    if (p.locked) p.selected = false;  // lock clears selection
}

function specToggleLockAll(params) {
    if (!params.length) return;
    const anyUnlocked = params.some(p => !p.locked);
    params.forEach(p => {
        p.locked = anyUnlocked;
        if (p.locked) p.selected = false;
    });
}

// Mode-switching contract: Select All and Select are alternative modes.
// Pressing the OTHER button while one is active SWITCHES — both stay
// enabled at all times. `state` is { params, selectMode }.
function specSelectAllSwitch(state) {
    // Pressing Select All exits select mode if it was on.
    state.selectMode = false;
    specSelectAll(state.params);
}
function specToggleSelectModeSwitch(state) {
    const unlocked = state.params.filter(p => !p.locked);
    const allSelected = unlocked.length > 0 && unlocked.every(p => p.selected);
    // Switching from "all" → "manual" clears selection so user starts fresh.
    if (allSelected && !state.selectMode) {
        state.params.forEach(p => { p.selected = false; });
    }
    state.selectMode = !state.selectMode;
}
// Highlight predicates (must mirror _sdUpdateSelectionButtons logic).
function specSelectAllIsHighlighted(state) {
    const unlocked = state.params.filter(p => !p.locked);
    const allSelected = unlocked.length > 0 && unlocked.every(p => p.selected);
    return allSelected && !state.selectMode;
}
function specSelectModeIsHighlighted(state) {
    return !!state.selectMode;
}

// ─── Test fixture ────────────────────────────────────────────────

function freshLanes() {
    return [
        { envelopeId: 'a', locked: false, selected: false, points: [] },
        { envelopeId: 'b', locked: false, selected: false, points: [] },
        { envelopeId: 'c', locked: false, selected: false, points: [] },
        { envelopeId: 'd', locked: false, selected: false, points: [] },
    ];
}

// ─── Target resolution ───────────────────────────────────────────

console.log('Target resolution\n');

test('No selection, active lane → target = [active]', () => {
    const lanes = freshLanes();
    const t = specGetTargetParams(lanes, 'a');
    assertEq(t.length, 1);
    assertEq(t[0].envelopeId, 'a');
});

test('No selection, no active lane → target = []', () => {
    const lanes = freshLanes();
    const t = specGetTargetParams(lanes, null);
    assertEq(t.length, 0);
});

test('No selection, active lane is locked → target = []', () => {
    const lanes = freshLanes();
    lanes[0].locked = true;
    const t = specGetTargetParams(lanes, 'a');
    assertEq(t.length, 0);
});

test('One selected lane → target = [that one]', () => {
    const lanes = freshLanes();
    lanes[1].selected = true;
    const t = specGetTargetParams(lanes, 'a');  // active is 'a' but selection wins
    assertEq(t.length, 1);
    assertEq(t[0].envelopeId, 'b');
});

test('Three selected lanes → target = those three', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[2].selected = true;
    lanes[3].selected = true;
    const t = specGetTargetParams(lanes, 'a');
    assertEq(t.length, 3);
    assertEq(t.map(l => l.envelopeId).sort().join(','), 'a,c,d');
});

test('Selected + locked → target excludes locked even if selected', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[1].selected = true;
    lanes[1].locked = true;  // 'b' is selected but locked → must be excluded
    const t = specGetTargetParams(lanes, 'a');
    assertEq(t.length, 1);
    assertEq(t[0].envelopeId, 'a');
});

test('All selected lanes are locked → falls back to active (if unlocked)', () => {
    const lanes = freshLanes();
    lanes[0].selected = true; lanes[0].locked = true;
    lanes[1].selected = true; lanes[1].locked = true;
    // Active 'c' is unlocked and not selected
    const t = specGetTargetParams(lanes, 'c');
    assertEq(t.length, 1);
    assertEq(t[0].envelopeId, 'c');
});

// ─── sdSelectAll behavior ────────────────────────────────────────

console.log('\nSelect All toggle\n');

test('First click selects all unlocked lanes', () => {
    const lanes = freshLanes();
    specSelectAll(lanes);
    assert(lanes.every(l => l.selected), 'not all are selected');
});

test('Second click clears the selection entirely', () => {
    const lanes = freshLanes();
    specSelectAll(lanes); // select all
    specSelectAll(lanes); // deselect all
    assert(lanes.every(l => !l.selected), 'not all are deselected');
});

test('Select All skips locked lanes', () => {
    const lanes = freshLanes();
    lanes[1].locked = true;
    lanes[3].locked = true;
    specSelectAll(lanes);
    assertEq(lanes[0].selected, true);
    assertEq(lanes[1].selected, false);  // locked stays unselected
    assertEq(lanes[2].selected, true);
    assertEq(lanes[3].selected, false);  // locked stays unselected
});

test('Select All when partial selection → fills (not toggles) to all', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[2].selected = true;
    // Some are selected, some are not — first click fills the rest, doesn't deselect
    specSelectAll(lanes);
    assert(lanes.every(l => l.selected), 'partial selection should fill, not clear');
});

test('Select All with all locked → no-op', () => {
    const lanes = freshLanes();
    lanes.forEach(l => l.locked = true);
    specSelectAll(lanes);
    assert(lanes.every(l => !l.selected), 'all-locked should not select anything');
});

test('Select All preserves selection state of locked lanes (which is always false)', () => {
    const lanes = freshLanes();
    lanes[1].locked = true;
    specSelectAll(lanes);
    assertEq(lanes[1].selected, false);  // locked never gets selected even by select-all
});

// ─── Per-lane toggle ─────────────────────────────────────────────

console.log('\nPer-lane selection toggle\n');

test('Toggle a lane sets selected=true', () => {
    const lanes = freshLanes();
    specToggleLaneSelection(lanes, 'b');
    assertEq(lanes[1].selected, true);
});

test('Toggle a selected lane sets selected=false', () => {
    const lanes = freshLanes();
    lanes[1].selected = true;
    specToggleLaneSelection(lanes, 'b');
    assertEq(lanes[1].selected, false);
});

test('Toggle is no-op on locked lane', () => {
    const lanes = freshLanes();
    lanes[1].locked = true;
    specToggleLaneSelection(lanes, 'b');
    assertEq(lanes[1].selected, false);  // unchanged
});

test('Toggle on unknown id is no-op', () => {
    const lanes = freshLanes();
    specToggleLaneSelection(lanes, 'ghost');
    assert(lanes.every(l => !l.selected), 'no lane should be affected');
});

test('Toggling multiple lanes builds a selection set', () => {
    const lanes = freshLanes();
    specToggleLaneSelection(lanes, 'a');
    specToggleLaneSelection(lanes, 'c');
    const selected = lanes.filter(l => l.selected).map(l => l.envelopeId);
    assertEq(selected.join(','), 'a,c');
});

// ─── hasSelection / getUnlockedParams contracts ──────────────────

console.log('\nhasSelection + getUnlockedParams contracts\n');

test('hasSelection false on fresh lanes', () => {
    assertEq(specHasSelection(freshLanes()), false);
});

test('hasSelection true when at least one unlocked is selected', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    assertEq(specHasSelection(lanes), true);
});

test('hasSelection false when only locked lanes are selected', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[0].locked = true;
    assertEq(specHasSelection(lanes), false);
});

test('getUnlockedParams returns all unlocked when no selection', () => {
    const lanes = freshLanes();
    lanes[1].locked = true;
    const u = specGetUnlockedParams(lanes);
    assertEq(u.length, 3);
});

test('getUnlockedParams returns selected only when selection exists', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[2].selected = true;
    const u = specGetUnlockedParams(lanes);
    assertEq(u.length, 2);
    assertEq(u.map(l => l.envelopeId).sort().join(','), 'a,c');
});

test('getUnlockedParams excludes locked even if selected', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[1].selected = true; lanes[1].locked = true;
    const u = specGetUnlockedParams(lanes);
    assertEq(u.length, 1);
    assertEq(u[0].envelopeId, 'a');
});

// ─── Lock interaction with selection ─────────────────────────────

console.log('\nLock × selection interaction\n');

test('Locking a selected lane clears its selection', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    specToggleLockLane(lanes, 'a');
    assertEq(lanes[0].locked, true);
    assertEq(lanes[0].selected, false);
});

test('Unlocking a previously-locked lane does NOT auto-select it', () => {
    const lanes = freshLanes();
    lanes[0].locked = true;
    specToggleLockLane(lanes, 'a');  // unlocks
    assertEq(lanes[0].locked, false);
    assertEq(lanes[0].selected, false);  // stays unselected
});

test('Lock All clears selection on every lane', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[2].selected = true;
    specToggleLockAll(lanes);  // locks all
    assert(lanes.every(l => l.locked), 'not all locked');
    assert(lanes.every(l => !l.selected), 'selection not cleared');
});

test('Locking one lane while others are selected leaves the others alone', () => {
    const lanes = freshLanes();
    lanes[0].selected = true;
    lanes[1].selected = true;
    lanes[2].selected = true;
    specToggleLockLane(lanes, 'b');  // lock b
    assertEq(lanes[0].selected, true);
    assertEq(lanes[1].selected, false);  // cleared by lock
    assertEq(lanes[2].selected, true);
});

// ─── End-to-end: tools target the correct set ───────────────────

console.log('\nEnd-to-end: tool would write to these lanes\n');

test('Selection exists → tools target selected only', () => {
    const lanes = freshLanes();
    lanes[1].selected = true;
    lanes[3].selected = true;
    const targets = specGetTargetParams(lanes, 'a');  // active a
    assertEq(targets.map(l => l.envelopeId).sort().join(','), 'b,d');
});

test('No selection + active locked → tools target nothing (cancel safely)', () => {
    const lanes = freshLanes();
    lanes[0].locked = true;
    const targets = specGetTargetParams(lanes, 'a');
    assertEq(targets.length, 0);
});

test('Selection cleared by lock → falls back to active', () => {
    const lanes = freshLanes();
    lanes[1].selected = true;
    specToggleLockLane(lanes, 'b');  // locks b, clears its selection
    const targets = specGetTargetParams(lanes, 'a');
    // Now no selection exists, should fall back to active 'a'
    assertEq(targets.length, 1);
    assertEq(targets[0].envelopeId, 'a');
});

// ─── Mode switching (Select All ↔ Select) ───────────────────────

console.log('\nMode switching: Select All vs Select\n');

test('Default: neither mode highlighted', () => {
    const state = { params: freshLanes(), selectMode: false };
    assertEq(specSelectAllIsHighlighted(state), false);
    assertEq(specSelectModeIsHighlighted(state), false);
});

test('Press Select All → Select All highlighted, Select not', () => {
    const state = { params: freshLanes(), selectMode: false };
    specSelectAllSwitch(state);
    assertEq(specSelectAllIsHighlighted(state), true);
    assertEq(specSelectModeIsHighlighted(state), false);
});

test('Press Select All twice → neither highlighted (toggle off)', () => {
    const state = { params: freshLanes(), selectMode: false };
    specSelectAllSwitch(state);  // on
    specSelectAllSwitch(state);  // off
    assertEq(specSelectAllIsHighlighted(state), false);
    assertEq(specSelectModeIsHighlighted(state), false);
    assert(state.params.every(p => !p.selected), 'selection should be cleared');
});

test('Press Select → Select highlighted, Select All not', () => {
    const state = { params: freshLanes(), selectMode: false };
    specToggleSelectModeSwitch(state);
    assertEq(state.selectMode, true);
    assertEq(specSelectModeIsHighlighted(state), true);
    assertEq(specSelectAllIsHighlighted(state), false);
});

test('Switch from Select All to Select → Select All un-highlights, Select highlights, selection cleared', () => {
    const state = { params: freshLanes(), selectMode: false };
    specSelectAllSwitch(state);  // all selected, Select All highlighted
    specToggleSelectModeSwitch(state);  // press Select → switches to manual
    assertEq(state.selectMode, true);
    assert(state.params.every(p => !p.selected), 'switching to manual should clear selection');
    assertEq(specSelectAllIsHighlighted(state), false);
    assertEq(specSelectModeIsHighlighted(state), true);
});

test('Switch from Select to Select All → Select exits, Select All highlights, all selected', () => {
    const state = { params: freshLanes(), selectMode: false };
    specToggleSelectModeSwitch(state);  // enter select mode
    // User picks one lane manually
    state.params[0].selected = true;
    // Now press Select All → switches to "all" mode
    specSelectAllSwitch(state);
    assertEq(state.selectMode, false);
    assert(state.params.every(p => p.selected), 'all should be selected');
    assertEq(specSelectAllIsHighlighted(state), true);
    assertEq(specSelectModeIsHighlighted(state), false);
});

test('Press Select twice → neither highlighted (toggle off, selection persists if any)', () => {
    const state = { params: freshLanes(), selectMode: false };
    specToggleSelectModeSwitch(state);  // on
    state.params[1].selected = true;    // user picked one lane
    specToggleSelectModeSwitch(state);  // off
    assertEq(state.selectMode, false);
    assertEq(state.params[1].selected, true);  // selection persists outside of mode
});

test('At most one mode is highlighted at any time (mutual exclusion)', () => {
    const state = { params: freshLanes(), selectMode: false };
    // From every reachable state, both can never be highlighted.
    const checks = [
        () => {},                                                                       // default
        () => specSelectAllSwitch(state),                                               // all
        () => { specSelectAllSwitch(state); specToggleSelectModeSwitch(state); },       // all → manual
        () => specToggleSelectModeSwitch(state),                                        // manual
        () => { specToggleSelectModeSwitch(state); specSelectAllSwitch(state); },       // manual → all
    ];
    for (const transition of checks) {
        // reset state
        state.params = freshLanes();
        state.selectMode = false;
        transition();
        const a = specSelectAllIsHighlighted(state);
        const m = specSelectModeIsHighlighted(state);
        assert(!(a && m), `both highlighted after transition ${transition.name || ''}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
