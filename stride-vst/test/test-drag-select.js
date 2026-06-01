/**
 * Behavior tests for the multi-view drag-select gesture
 * (canvas.js, multi-view + Select Mode).
 *
 * Spec rules under test:
 *   - Drag activates once cursor movement passes SD_DRAG_SELECT_THRESHOLD_PX (3px)
 *   - Sub-threshold mousedown+up stays a click — original toggle is preserved
 *   - Visited set: every lane the cursor passes is marked once per drag, no
 *     repeat work on re-entry (prevents flicker)
 *   - Drag is ADDITIVE ONLY — never deselects, even if the cursor passes
 *     over an already-selected lane (user removes by clicking, not dragging)
 *   - Locked lanes: marked visited so they don't get re-considered, but
 *     selection is never touched
 *   - First-lane revert: when drag activates, the starting lane is forced
 *     back to selected — the toggle from the mousedown click is overridden,
 *     because the user's intent was clearly drag, not toggle
 *   - Edge-scroll cadence: three-tier ramp by distance from edge
 *     (<10px → 30ms, <20px → 50ms, <40px → 80ms, ≥40px → 0 [out of zone])
 *
 * Pure-logic specs — DOM-bound canvas.js can't be loaded directly. The
 * real behavior is in the event wiring. If you change the rules in
 * canvas.js, mirror the change here. The user verifies DOM wiring in the
 * running Electron app.
 *
 * Run: node test/test-drag-select.js
 */

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || 'not equal') + ` — got ${a}, expected ${b}`); }

// ─── Spec mirror of canvas.js drag-select rules ──────────────────
// Must stay identical to the constants + decision logic in canvas.js.

const SD_DRAG_SELECT_THRESHOLD_PX = 3;
const SD_EDGE_SCROLL_ZONE_PX = 40;

function thresholdReached(dx, dy) {
    return Math.hypot(dx, dy) >= SD_DRAG_SELECT_THRESHOLD_PX;
}

// Decision rule applied per lane the cursor passes during an active drag.
// Returns { add, markVisited }:
//   - add: should the lane's selected flag be set to true?
//   - markVisited: should the lane be added to the visited set?
// Note: locked lanes are marked visited (so subsequent passes don't waste
// work) but their selection is never touched.
function dragSelectDecision({ lane, visited }) {
    if (visited.has(lane.envelopeId)) return { add: false, markVisited: false };
    if (lane.locked) return { add: false, markVisited: true };
    if (lane.selected) return { add: false, markVisited: true };
    return { add: true, markVisited: true };
}

// Drag promotion never modifies the start lane's selection — that was set
// by the mousedown toggle (Ctrl+click). Critical so Ctrl+click-to-deselect
// works reliably: any tiny mouse wobble between click and release would
// otherwise force the lane back to selected. Kept as an explicit no-op
// function so the spec is visible in writing.
function startLaneAfterDragPromotion(start) {
    return { ...start };
}

// Edge-scroll cadence (ms between auto-scroll ticks) given distance from
// the top OR bottom edge of the canvas. Returns 0 if outside the zone.
function edgeScrollCadenceMs(distFromEdge) {
    if (distFromEdge < 0 || distFromEdge >= SD_EDGE_SCROLL_ZONE_PX) return 0;
    if (distFromEdge < 10) return 30;
    if (distFromEdge < 20) return 50;
    return 80;
}

// ─── Test fixtures ──────────────────────────────────────────────

function makeLanes(n) {
    return Array.from({ length: n }, (_, i) => ({
        envelopeId: 'lane-' + i,
        locked: false,
        selected: false,
    }));
}

// Simulate a Ctrl+click+drag from lane index `fromIdx` to `toIdx` (inclusive),
// mirroring canvas.js end-to-end:
//   1. Mousedown toggle (Ctrl+click): start lane's selected flag flips.
//      Locked lanes no-op (sdToggleLaneSelection skips them).
//   2. Drag promotion: NO-OP for selection state (no force-revert).
//   3. Drag through subsequent lanes: standard additive decision rule.
function simulateDrag(lanes, fromIdx, toIdx) {
    // 1. Mousedown toggle
    if (!lanes[fromIdx].locked) {
        lanes[fromIdx].selected = !lanes[fromIdx].selected;
    }
    // 2. Drag promotion is a no-op for selection state — explicit call so
    //    the spec mirror documents the rule even though it does nothing.
    const after = startLaneAfterDragPromotion(lanes[fromIdx]);
    lanes[fromIdx].selected = after.selected;

    // 3. Subsequent lanes — decision rule applies
    const visited = new Set([lanes[fromIdx].envelopeId]);
    const step = fromIdx <= toIdx ? 1 : -1;
    for (let i = fromIdx + step; i !== toIdx + step; i += step) {
        const lane = lanes[i];
        const dec = dragSelectDecision({ lane, visited });
        if (dec.markVisited) visited.add(lane.envelopeId);
        if (dec.add) lane.selected = true;
    }
    return { lanes, visited };
}

// ─── 1. Threshold detection ────────────────────────────────────
console.log('\n[threshold detection]');

test('exactly 3px movement promotes to drag', () => {
    assert(thresholdReached(3, 0), 'horizontal 3px should promote');
    assert(thresholdReached(0, 3), 'vertical 3px should promote');
});

test('2px movement stays a click (sub-threshold)', () => {
    assert(!thresholdReached(2, 0));
    assert(!thresholdReached(0, 2));
    assert(!thresholdReached(2, 2), '2.82 magnitude still below 3');
});

test('diagonal 3+px promotes', () => {
    assert(thresholdReached(3, 4));    // 5.0
    assert(thresholdReached(2.5, 2.5)); // 3.54
});

test('zero movement never promotes (click-only)', () => {
    assert(!thresholdReached(0, 0));
});

// ─── 2. Visited set semantics ──────────────────────────────────
console.log('\n[visited set]');

test('same lane not re-added once visited', () => {
    const lanes = makeLanes(3);
    const visited = new Set(['lane-1']);
    const dec = dragSelectDecision({ lane: lanes[1], visited });
    assertEq(dec.add, false, 'already-visited lane should not be added again');
    assertEq(dec.markVisited, false, 'already-visited lane should not be re-marked');
});

test('re-entering a lane during the same drag is a no-op', () => {
    const lanes = makeLanes(4);
    // First pass: drag through 0..2
    simulateDrag(lanes, 0, 2);
    const snapshot = lanes.map(l => l.selected);
    // Simulate re-entry on lane 1 (already visited from first pass)
    const visited = new Set(lanes.map(l => l.envelopeId).slice(0, 3));
    const dec = dragSelectDecision({ lane: lanes[1], visited });
    assertEq(dec.add, false, 're-entry should not toggle');
    assertEq(lanes[1].selected, snapshot[1], 'state unchanged after re-entry');
});

// ─── 3. Drag is additive only ───────────────────────────────────
console.log('\n[drag is additive only]');

test('drag through unselected lanes selects all', () => {
    const lanes = makeLanes(5);
    simulateDrag(lanes, 0, 4);
    lanes.forEach((l, i) => assertEq(l.selected, true, `lane ${i} should be selected`));
});

test('drag over already-selected lane does not deselect it', () => {
    const lanes = makeLanes(3);
    lanes[1].selected = true;
    simulateDrag(lanes, 0, 2);
    assertEq(lanes[1].selected, true, 'pre-selected lane stays selected');
    assertEq(lanes[0].selected, true);
    assertEq(lanes[2].selected, true);
});

test('drag through entirely-selected range: start gets toggled off by mousedown, rest untouched', () => {
    const lanes = makeLanes(4);
    lanes.forEach(l => { l.selected = true; });
    simulateDrag(lanes, 0, 3);
    // Lane 0: mousedown toggle flipped selected → unselected. Drag does
    // not revert. The user's Ctrl+click intent is respected.
    assertEq(lanes[0].selected, false, 'start lane gets toggled off by Ctrl+click');
    // Lanes 1..3: already selected when drag passed through → no-op.
    assertEq(lanes[1].selected, true);
    assertEq(lanes[2].selected, true);
    assertEq(lanes[3].selected, true);
});

// ─── 4. Lock skip ───────────────────────────────────────────────
console.log('\n[locked lanes are skipped]');

test('locked lane: marked visited but selection untouched', () => {
    const lane = { envelopeId: 'L', locked: true, selected: false };
    const dec = dragSelectDecision({ lane, visited: new Set() });
    assertEq(dec.add, false);
    assertEq(dec.markVisited, true, 'mark visited so we do not re-check on re-enter');
});

test('drag through 5 lanes with middle locked: locked stays, others selected', () => {
    const lanes = makeLanes(5);
    lanes[2].locked = true;
    simulateDrag(lanes, 0, 4);
    assertEq(lanes[0].selected, true);
    assertEq(lanes[1].selected, true);
    assertEq(lanes[2].selected, false, 'locked lane never gets selected');
    assertEq(lanes[3].selected, true);
    assertEq(lanes[4].selected, true);
});

// ─── 5. Drag promotion never modifies start lane ──────────────
// CRITICAL: this is what makes Ctrl+click-to-deselect reliable. Without
// this rule, any tiny hand wobble after Ctrl+click would re-select the
// lane the user just clicked to deselect.
console.log('\n[drag promotion never modifies start lane]');

test('start lane unselected by mousedown toggle → stays unselected after promotion', () => {
    // Lane was selected. Mousedown toggle made it unselected (user
    // Ctrl+clicked to deselect). Drag promotion must NOT revert it.
    const start = { envelopeId: 'A', locked: false, selected: false };
    const after = startLaneAfterDragPromotion(start);
    assertEq(after.selected, false, 'drag never overrides — Ctrl+click-deselect must stick');
});

test('start lane selected by mousedown toggle → stays selected after promotion', () => {
    // Lane was unselected. Mousedown toggle made it selected. Promotion
    // is a no-op; lane stays as the toggle left it.
    const start = { envelopeId: 'A', locked: false, selected: true };
    const after = startLaneAfterDragPromotion(start);
    assertEq(after.selected, true);
});

test('locked start lane: promotion is a no-op (matches locked-skip rule)', () => {
    const start = { envelopeId: 'A', locked: true, selected: false };
    const after = startLaneAfterDragPromotion(start);
    assertEq(after.selected, false, 'locked lane stays as-is on drag start');
});

// ─── 6. Edge-scroll cadence math ───────────────────────────────
console.log('\n[edge-scroll cadence math]');

test('fast tier (<10px from edge) → 30ms', () => {
    assertEq(edgeScrollCadenceMs(0), 30);
    assertEq(edgeScrollCadenceMs(5), 30);
    assertEq(edgeScrollCadenceMs(9), 30);
});

test('medium tier (10..19px) → 50ms', () => {
    assertEq(edgeScrollCadenceMs(10), 50);
    assertEq(edgeScrollCadenceMs(15), 50);
    assertEq(edgeScrollCadenceMs(19), 50);
});

test('slow tier (20..39px) → 80ms', () => {
    assertEq(edgeScrollCadenceMs(20), 80);
    assertEq(edgeScrollCadenceMs(30), 80);
    assertEq(edgeScrollCadenceMs(39), 80);
});

test('out of zone (≥40px) → 0 (no scrolling)', () => {
    assertEq(edgeScrollCadenceMs(40), 0);
    assertEq(edgeScrollCadenceMs(100), 0);
});

test('negative distance (cursor past edge) → 0', () => {
    // Cursor outside canvas above the top reads as negative distFromEdge.
    // Callers should not auto-scroll in this case (out of zone).
    assertEq(edgeScrollCadenceMs(-1), 0);
    assertEq(edgeScrollCadenceMs(-50), 0);
});

// ─── 7. End-to-end scenarios ───────────────────────────────────
console.log('\n[end-to-end scenarios]');

test('scenario: select 10 lanes by dragging through them', () => {
    const lanes = makeLanes(10);
    simulateDrag(lanes, 0, 9);
    assertEq(lanes.filter(l => l.selected).length, 10);
});

test('scenario: drag downwards then upwards over same range — no flicker', () => {
    const lanes = makeLanes(5);
    simulateDrag(lanes, 0, 4);    // down
    // After down pass, all visited. Re-walking up should change nothing.
    const visited = new Set(lanes.map(l => l.envelopeId));
    for (let i = 4; i >= 0; i--) {
        const dec = dragSelectDecision({ lane: lanes[i], visited });
        assertEq(dec.add, false, `lane ${i} should not be re-added on upward pass`);
    }
    assertEq(lanes.filter(l => l.selected).length, 5);
});

test('scenario: Ctrl+click on selected lane with hand wobble reliably deselects', () => {
    // Regression test for the user-reported bug: Ctrl+click on a selected
    // lane was failing to deselect because hand wobble triggered drag
    // promotion, which used to force the lane back to selected. The fix
    // is that drag promotion never touches the start lane's state.
    const lanes = makeLanes(3);
    lanes[1].selected = true;
    // Ctrl+click on lane 1 (the target deselect) — simulateDrag from 1 to 1
    // models a click with a tiny wobble that crosses the 3px threshold.
    simulateDrag(lanes, 1, 1);
    assertEq(lanes[1].selected, false, 'lane 1 must be deselected after Ctrl+click');
});

test('scenario: half the lanes locked → only unlocked join the selection', () => {
    const lanes = makeLanes(10);
    for (let i = 0; i < 10; i += 2) lanes[i].locked = true;  // even lanes locked
    simulateDrag(lanes, 0, 9);
    lanes.forEach((l, i) => {
        if (i % 2 === 0) assertEq(l.selected, false, `even lane ${i} (locked) stays unselected`);
        else assertEq(l.selected, true, `odd lane ${i} (unlocked) selected`);
    });
});

// ─── 8. Gesture classification matrix ──────────────────────────
// Mirrors the priority order in canvas.js multi-view mousedown branch.
// Ctrl/Cmd is the ONLY modifier that enters selection-without-activating
// (besides the Select All toolbar button, which is its own action). Plain
// click/drag in non-Ctrl cases either activates a lane or draws on it —
// exactly as before drag-select existed.
console.log('\n[gesture classification matrix]');

function classifyMousedown({ inLockZone, ctrlOrMeta, activeIsThisLane, onLabelCol }) {
    if (inLockZone) return 'lock-toggle';
    if (ctrlOrMeta) return 'select-toggle+arm';
    if (!activeIsThisLane) return 'activate-only';
    // Already-active lane: label column is a no-op; curve area falls through to draw.
    if (onLabelCol) return 'noop';
    return 'draw';
}

test('lock zone always wins, even with Ctrl', () => {
    assertEq(classifyMousedown({ inLockZone: true, ctrlOrMeta: false, activeIsThisLane: false, onLabelCol: true }), 'lock-toggle');
    assertEq(classifyMousedown({ inLockZone: true, ctrlOrMeta: true,  activeIsThisLane: false, onLabelCol: true }), 'lock-toggle');
});

test('Ctrl+click on curve area → select-toggle+arm (no draw)', () => {
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: true, activeIsThisLane: true, onLabelCol: false }), 'select-toggle+arm');
});

test('Ctrl+click on label column → select-toggle+arm', () => {
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: true, activeIsThisLane: false, onLabelCol: true }), 'select-toggle+arm');
});

test('Plain click on non-active lane (anywhere) → activate-only', () => {
    // Activate first; nothing else fires. No drag-select arm without Ctrl.
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: false, activeIsThisLane: false, onLabelCol: true  }), 'activate-only');
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: false, activeIsThisLane: false, onLabelCol: false }), 'activate-only');
});

test('Plain click on active lane, label column → noop', () => {
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: false, activeIsThisLane: true, onLabelCol: true }), 'noop');
});

test('Plain click on active lane, curve area → draw (editing flow untouched)', () => {
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: false, activeIsThisLane: true, onLabelCol: false }), 'draw');
});

test('No non-Ctrl path produces a select-toggle or arm — Ctrl is the only selection modifier', () => {
    const nonCtrlCombos = [
        { activeIsThisLane: false, onLabelCol: false },
        { activeIsThisLane: false, onLabelCol: true  },
        { activeIsThisLane: true,  onLabelCol: false },
        { activeIsThisLane: true,  onLabelCol: true  },
    ];
    for (const combo of nonCtrlCombos) {
        const result = classifyMousedown({ inLockZone: false, ctrlOrMeta: false, ...combo });
        assert(result !== 'select-toggle+arm',
            `non-Ctrl combo should never select-toggle+arm: ${JSON.stringify(combo)} → ${result}`);
    }
});

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────`);
console.log(`  ${passed} passed   ${failed} failed`);
console.log(`────────────────────────────────────────`);

process.exit(failed);
