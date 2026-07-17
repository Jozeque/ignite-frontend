/**
 * Behavior tests for the multi-view drag-select gesture
 * (canvas.js, multi-view + Select Mode).
 *
 * Spec rules under test (REVISED 2026-07-16 — gesture decided by WHERE the
 * cursor goes, not by pixels; field report: a Ctrl+drag that STARTED on a
 * selected lane kicked it out of the group):
 *   - Promotion: pending → drag once the cursor REACHES A DIFFERENT LANE.
 *     In-lane wobble (any distance) never promotes.
 *   - Click: released while still on the start lane → the toggle fires on
 *     MOUSEUP (deferred from mousedown), so wobbly Ctrl+clicks still
 *     deselect reliably.
 *   - Promotion makes the start lane part of the sweep: selected and
 *     STAYING selected (drag is additive — including the lane it started on).
 *     Locked start lanes stay untouched.
 *   - Visited set: every lane the cursor passes is marked once per drag, no
 *     repeat work on re-entry (prevents flicker)
 *   - Drag is ADDITIVE ONLY — never deselects, even if the cursor passes
 *     over an already-selected lane (user removes by clicking, not dragging)
 *   - Locked lanes: marked visited so they don't get re-considered, but
 *     selection is never touched
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

const SD_EDGE_SCROLL_ZONE_PX = 40;

// Promotion rule: the gesture becomes a drag-sweep only when the cursor is
// over a DIFFERENT lane than the one it started on. Off-canvas / no lane
// under the cursor never promotes.
function promotesToDrag(startLaneId, cursorLaneId) {
    return cursorLaneId != null && cursorLaneId !== startLaneId;
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

// Promotion makes the START lane part of the sweep: it becomes selected and
// STAYS selected (drag is additive, including the lane it started on). A
// locked start lane stays untouched — same contract as the sweep itself.
function startLaneAfterDragPromotion(start) {
    if (start.locked) return { ...start };
    return { ...start, selected: true };
}

// Click rule (released while still on the start lane): the toggle fires on
// mouseup. sdToggleLaneSelection skips locked lanes.
function clickToggle(lane) {
    if (lane.locked) return { ...lane };
    return { ...lane, selected: !lane.selected };
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

// Simulate a Ctrl+SWEEP from lane index `fromIdx` to a DIFFERENT `toIdx`
// (inclusive), mirroring canvas.js end-to-end:
//   1. Mousedown arms only — NO toggle.
//   2. Promotion (cursor reached another lane): start lane joins the sweep
//      (selected unless locked).
//   3. Drag through subsequent lanes: standard additive decision rule.
function simulateSweep(lanes, fromIdx, toIdx) {
    if (fromIdx === toIdx) throw new Error('a sweep requires reaching a different lane — use simulateClick');
    const after = startLaneAfterDragPromotion(lanes[fromIdx]);
    lanes[fromIdx].selected = after.selected;

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

// Simulate a Ctrl+CLICK on lane `idx` (any amount of in-lane wobble): never
// promotes, so the mouseup toggle fires.
function simulateClick(lanes, idx) {
    const after = clickToggle(lanes[idx]);
    lanes[idx].selected = after.selected;
    return { lanes };
}

// ─── 1. Promotion detection ────────────────────────────────────
console.log('\n[promotion detection]');

test('reaching a DIFFERENT lane promotes to drag', () => {
    assert(promotesToDrag('lane-0', 'lane-1'), 'adjacent lane should promote');
    assert(promotesToDrag('lane-0', 'lane-7'), 'any other lane should promote');
});

test('in-lane wobble never promotes (any distance)', () => {
    assert(!promotesToDrag('lane-0', 'lane-0'), 'same lane = still a click');
});

test('no lane under the cursor never promotes (left the canvas)', () => {
    assert(!promotesToDrag('lane-0', null));
    assert(!promotesToDrag('lane-0', undefined));
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
    // First pass: sweep through 0..2
    simulateSweep(lanes, 0, 2);
    const snapshot = lanes.map(l => l.selected);
    // Simulate re-entry on lane 1 (already visited from first pass)
    const visited = new Set(lanes.map(l => l.envelopeId).slice(0, 3));
    const dec = dragSelectDecision({ lane: lanes[1], visited });
    assertEq(dec.add, false, 're-entry should not toggle');
    assertEq(lanes[1].selected, snapshot[1], 'state unchanged after re-entry');
});

// ─── 3. Drag is additive only ───────────────────────────────────
console.log('\n[drag is additive only]');

test('sweep through unselected lanes selects all (start included)', () => {
    const lanes = makeLanes(5);
    simulateSweep(lanes, 0, 4);
    lanes.forEach((l, i) => assertEq(l.selected, true, `lane ${i} should be selected`));
});

test('sweep over already-selected lane does not deselect it', () => {
    const lanes = makeLanes(3);
    lanes[1].selected = true;
    simulateSweep(lanes, 0, 2);
    assertEq(lanes[1].selected, true, 'pre-selected lane stays selected');
    assertEq(lanes[0].selected, true);
    assertEq(lanes[2].selected, true);
});

test('sweep through entirely-selected range: EVERY lane stays selected (start included)', () => {
    // THE field-reported bug (2026-07-16): the old mousedown-toggle kicked the
    // start lane OUT of an all-selected group when the user swept from it.
    // Additive means additive — nothing deselects during a sweep.
    const lanes = makeLanes(4);
    lanes.forEach(l => { l.selected = true; });
    simulateSweep(lanes, 0, 3);
    lanes.forEach((l, i) => assertEq(l.selected, true, `lane ${i} must stay selected`));
});

// ─── 4. Lock skip ───────────────────────────────────────────────
console.log('\n[locked lanes are skipped]');

test('locked lane: marked visited but selection untouched', () => {
    const lane = { envelopeId: 'L', locked: true, selected: false };
    const dec = dragSelectDecision({ lane, visited: new Set() });
    assertEq(dec.add, false);
    assertEq(dec.markVisited, true, 'mark visited so we do not re-check on re-enter');
});

test('sweep through 5 lanes with middle locked: locked stays, others selected', () => {
    const lanes = makeLanes(5);
    lanes[2].locked = true;
    simulateSweep(lanes, 0, 4);
    assertEq(lanes[0].selected, true);
    assertEq(lanes[1].selected, true);
    assertEq(lanes[2].selected, false, 'locked lane never gets selected');
    assertEq(lanes[3].selected, true);
    assertEq(lanes[4].selected, true);
});

// ─── 5. Promotion makes the start lane part of the sweep ──────
// The old design toggled on mousedown and never touched the start lane on
// promotion — which silently deselected a selected start lane. Now the
// toggle is DEFERRED to mouseup (click case), and promotion pulls the start
// lane INTO the sweep.
console.log('\n[promotion pulls the start lane into the sweep]');

test('unselected start lane → selected on promotion (joins its own sweep)', () => {
    const start = { envelopeId: 'A', locked: false, selected: false };
    const after = startLaneAfterDragPromotion(start);
    assertEq(after.selected, true, 'the sweep includes the lane it started on');
});

test('selected start lane → STAYS selected on promotion (the reported bug)', () => {
    const start = { envelopeId: 'A', locked: false, selected: true };
    const after = startLaneAfterDragPromotion(start);
    assertEq(after.selected, true, 'sweeping from a selected lane must not kick it out');
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

test('scenario: select 10 lanes by sweeping through them', () => {
    const lanes = makeLanes(10);
    simulateSweep(lanes, 0, 9);
    assertEq(lanes.filter(l => l.selected).length, 10);
});

test('scenario: sweep downwards then upwards over same range — no flicker', () => {
    const lanes = makeLanes(5);
    simulateSweep(lanes, 0, 4);    // down
    // After down pass, all visited. Re-walking up should change nothing.
    const visited = new Set(lanes.map(l => l.envelopeId));
    for (let i = 4; i >= 0; i--) {
        const dec = dragSelectDecision({ lane: lanes[i], visited });
        assertEq(dec.add, false, `lane ${i} should not be re-added on upward pass`);
    }
    assertEq(lanes.filter(l => l.selected).length, 5);
});

test('scenario: Ctrl+click on selected lane with hand wobble reliably deselects', () => {
    // The wobble can be any size — as long as the cursor stays on the same
    // lane it never promotes, and the mouseup toggle deselects. (Old design
    // achieved this with a mousedown toggle; the deferral keeps the guarantee
    // while also fixing sweep-from-selected.)
    const lanes = makeLanes(3);
    lanes[1].selected = true;
    simulateClick(lanes, 1);
    assertEq(lanes[1].selected, false, 'lane 1 must be deselected after Ctrl+click');
});

test('scenario: select lane 1, sweep 3 more FROM it — all four selected (the field report)', () => {
    // "when 1 is selected and selecting 3 more, it only changes the other 3" —
    // the sweep started on the selected lane and used to kick it out.
    const lanes = makeLanes(4);
    simulateClick(lanes, 0);                 // Ctrl+click lane 0 → selected
    assertEq(lanes[0].selected, true);
    simulateSweep(lanes, 0, 3);              // Ctrl+drag from lane 0 down through 3
    lanes.forEach((l, i) => assertEq(l.selected, true, `lane ${i} must be selected`));
});

test('scenario: half the lanes locked → only unlocked join the selection', () => {
    const lanes = makeLanes(10);
    for (let i = 0; i < 10; i += 2) lanes[i].locked = true;  // even lanes locked
    simulateSweep(lanes, 0, 9);
    lanes.forEach((l, i) => {
        if (i % 2 === 0) assertEq(l.selected, false, `even lane ${i} (locked) stays unselected`);
        else assertEq(l.selected, true, `odd lane ${i} (unlocked) selected`);
    });
});

// ─── 8. Gesture classification matrix ──────────────────────────
// Mirrors the priority order in canvas.js multi-view mousedown branch.
// Ctrl/Cmd is the ONLY modifier that enters selection (besides the Select
// All toolbar button, which is its own action). The mousedown ARMS the
// gesture only — the toggle happens on mouseup (click) or promotion (sweep).
console.log('\n[gesture classification matrix]');

function classifyMousedown({ inLockZone, ctrlOrMeta, activeIsThisLane, onLabelCol }) {
    if (inLockZone) return 'lock-toggle';
    if (ctrlOrMeta) return 'select-arm';
    if (!activeIsThisLane) return 'activate-only';
    // Already-active lane: label column is a no-op; curve area falls through to draw.
    if (onLabelCol) return 'noop';
    return 'draw';
}

test('lock zone always wins, even with Ctrl', () => {
    assertEq(classifyMousedown({ inLockZone: true, ctrlOrMeta: false, activeIsThisLane: false, onLabelCol: true }), 'lock-toggle');
    assertEq(classifyMousedown({ inLockZone: true, ctrlOrMeta: true,  activeIsThisLane: false, onLabelCol: true }), 'lock-toggle');
});

test('Ctrl+click on curve area → select-arm (no draw, toggle deferred)', () => {
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: true, activeIsThisLane: true, onLabelCol: false }), 'select-arm');
});

test('Ctrl+click on label column → select-arm', () => {
    assertEq(classifyMousedown({ inLockZone: false, ctrlOrMeta: true, activeIsThisLane: false, onLabelCol: true }), 'select-arm');
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

test('No non-Ctrl path produces a select-arm — Ctrl is the only selection modifier', () => {
    const nonCtrlCombos = [
        { activeIsThisLane: false, onLabelCol: false },
        { activeIsThisLane: false, onLabelCol: true  },
        { activeIsThisLane: true,  onLabelCol: false },
        { activeIsThisLane: true,  onLabelCol: true  },
    ];
    for (const combo of nonCtrlCombos) {
        const result = classifyMousedown({ inLockZone: false, ctrlOrMeta: false, ...combo });
        assert(result !== 'select-arm',
            `non-Ctrl combo should never select-arm: ${JSON.stringify(combo)} → ${result}`);
    }
});

// ─── Summary ───────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────────`);

process.exit(failed ? 1 : 0);
