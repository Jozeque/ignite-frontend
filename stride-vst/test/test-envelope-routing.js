/**
 * Regression tests for envelope routing — locks the v1.2.1 fix for the
 * v1.2.0 alphabetical-sort misroute bug.
 *
 * THE BUG (v1.2.0): canvas.js sorts lanes alphabetically for display
 * (_sdSortByName) and assigned envelope_index = position in that sorted
 * array. The injector routes purely by position (envelope_index → the Nth
 * template envelope in document order), and template envelopes sit in
 * device-parameter order. Alphabetical position ≠ device position ⟹ curves
 * silently landed on the WRONG parameter on any multi-distinct-param rack.
 *
 * THE FIX (canvas.js applyToAbleton): envelope_index is now the rank of the
 * param by its numeric envelopeId (the scanner's sequential device-order id),
 * which reconstructs device order regardless of display sort or session load
 * order. This file pins both halves of the contract:
 *
 *   Part A — REAL injector: envelope_index N writes into the Nth template
 *            envelope in document order (the contract the renderer relies on).
 *   Part B — renderer rank logic (spec mirror, per the test-drag-select.js
 *            convention — DOM-bound canvas.js can't be required directly):
 *            given alphabetically-sorted display params, envelope_index
 *            follows device order, and the old "array index" approach would
 *            have misrouted.
 *
 * Run: node test/test-envelope-routing.js
 */

const path = require('path');
const xmldomPath = path.join(__dirname, '..', 'm4l', 'node', 'node_modules', '@xmldom', 'xmldom');
const { DOMParser } = require(xmldomPath);
const injector = require('../m4l/node/alc-injector.js');

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

// ─── Part A — REAL injector contract ──────────────────────────────
// Minimal .alc with three ClipEnvelopes in a fixed document order. We inject
// params with DISTINCT point counts and assert which envelope received which
// param's points (count = 1 anchor + N points). Proves envelope_index N maps
// to the Nth envelope in document order, nothing else.

function buildAlc() {
    // env doc order: PointeeId 10, 20, 30 (think: device params P0, P1, P2).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12120" Creator="Ableton Live 12.0">
  <LiveSet>
    <Tracks><MidiTrack Id="0"><DeviceChain><MainSequencer><ClipSlotList><ClipSlot Id="0"><Value>
      <MidiClip Id="0" Time="0">
        <Loop><LoopStart Value="0"/><LoopEnd Value="16"/><HiddenLoopStart Value="0"/><HiddenLoopEnd Value="16"/><OutMarker Value="16"/></Loop>
        <Envelopes><Envelopes>
          <ClipEnvelope><EnvelopeTarget><PointeeId Value="10"/></EnvelopeTarget><Automation><Events></Events></Automation></ClipEnvelope>
          <ClipEnvelope><EnvelopeTarget><PointeeId Value="20"/></EnvelopeTarget><Automation><Events></Events></Automation></ClipEnvelope>
          <ClipEnvelope><EnvelopeTarget><PointeeId Value="30"/></EnvelopeTarget><Automation><Events></Events></Automation></ClipEnvelope>
        </Envelopes></Envelopes>
      </MidiClip>
    </Value></ClipSlot></ClipSlotList></MainSequencer></DeviceChain></MidiTrack></Tracks>
  </LiveSet>
</Ableton>`;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return { doc, root: doc.documentElement };
}

// Count FloatEvents inside each ClipEnvelope, in document order. Each injected
// envelope carries 1 anchor + (its routed param's points). An envelope that
// received no param still gets the lone anchor.
function floatCountsPerEnvelope(doc) {
    const envs = Array.from(doc.getElementsByTagName('ClipEnvelope'));
    return envs.map(env => env.getElementsByTagName('FloatEvent').length);
}

function pts(n) {
    // n breakpoints at evenly-spaced times, mid value.
    return Array.from({ length: n }, (_, i) => ({ time: i, value: 0.5, curve: 0 }));
}

test('A1: envelope_index N routes to the Nth envelope in document order', () => {
    const { doc, root } = buildAlc();
    // params already in device order; distinct point counts per slot.
    const params = [
        { name: 'P0', envelope_index: 0, min: 0, max: 1, points: pts(1) },
        { name: 'P1', envelope_index: 1, min: 0, max: 1, points: pts(2) },
        { name: 'P2', envelope_index: 2, min: 0, max: 1, points: pts(3) },
    ];
    injector.injectAutomation(doc, root, params, 4);
    const counts = floatCountsPerEnvelope(doc); // 1 anchor + N
    assertEq(counts[0], 1 + 1, 'env0 should hold P0 (1 pt)');
    assertEq(counts[1], 1 + 2, 'env1 should hold P1 (2 pts)');
    assertEq(counts[2], 1 + 3, 'env2 should hold P2 (3 pts)');
});

test('A2: routing strictly follows envelope_index, not param array order', () => {
    const { doc, root } = buildAlc();
    // Scramble: the param listed first targets the LAST envelope, etc.
    const params = [
        { name: 'P2', envelope_index: 2, min: 0, max: 1, points: pts(3) },
        { name: 'P0', envelope_index: 0, min: 0, max: 1, points: pts(1) },
        { name: 'P1', envelope_index: 1, min: 0, max: 1, points: pts(2) },
    ];
    injector.injectAutomation(doc, root, params, 4);
    const counts = floatCountsPerEnvelope(doc);
    // env0 must still get envelope_index 0 (P0, 1pt), regardless of array order.
    assertEq(counts[0], 1 + 1, 'env0 ← envelope_index 0 (P0)');
    assertEq(counts[1], 1 + 2, 'env1 ← envelope_index 1 (P1)');
    assertEq(counts[2], 1 + 3, 'env2 ← envelope_index 2 (P2)');
});

// ─── Part B — renderer rank logic (spec mirror of canvas.js applyToAbleton) ──
// MUST stay identical to the _routeRank computation in canvas.js. If you
// change one, change the other. See the comment block at applyToAbleton.

function computeEnvelopeIndices(canvasParams) {
    const routeRank = new Map(
        canvasParams
            .map(p => p.envelopeId)
            .sort((a, b) => {
                const na = Number(a), nb = Number(b);
                if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
                return String(a).localeCompare(String(b));
            })
            .map((eid, i) => [eid, i])
    );
    return canvasParams.map(p => ({ name: p.name, envelopeId: p.envelopeId, envelope_index: routeRank.get(p.envelopeId) }));
}

// Reproduce the alphabetical display sort the canvas applies after a scan.
function displaySort(params) {
    return params.slice().sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return String(a.envelopeId).localeCompare(String(b.envelopeId));
    });
}

test('B1: alphabetical display order does NOT change device-order routing', () => {
    // Device order (scan ids): Q=0, Cutoff=1. Alphabetical display: Cutoff, Q.
    const scanned = [
        { name: 'Q', envelopeId: '0' },
        { name: 'Cutoff', envelopeId: '1' },
    ];
    const displayed = displaySort(scanned);
    assertEq(displayed[0].name, 'Cutoff', 'display sorts alphabetically');
    const routed = computeEnvelopeIndices(displayed);
    const byName = Object.fromEntries(routed.map(r => [r.name, r.envelope_index]));
    // Q is device-param 0 → envelope_index 0; Cutoff device-param 1 → 1.
    assertEq(byName['Q'], 0, 'Q keeps device slot 0');
    assertEq(byName['Cutoff'], 1, 'Cutoff keeps device slot 1');
});

test('B2: the OLD array-index approach would have misrouted (bug is real)', () => {
    const scanned = [
        { name: 'Q', envelopeId: '0' },
        { name: 'Cutoff', envelopeId: '1' },
    ];
    const displayed = displaySort(scanned); // [Cutoff, Q]
    const oldEnvelopeIndex = displayed.map((p, idx) => ({ name: p.name, envelope_index: idx }));
    const oldByName = Object.fromEntries(oldEnvelopeIndex.map(r => [r.name, r.envelope_index]));
    // Under the bug, Cutoff would have taken slot 0 (Q's envelope) — a misroute.
    assertEq(oldByName['Cutoff'], 0, 'old approach put Cutoff in slot 0 (wrong)');
    assertEq(oldByName['Q'], 1, 'old approach put Q in slot 1 (wrong)');
});

test('B3: multi-param rack — every param lands on its own device slot', () => {
    // Device order F1 Slider A..C, Filter In, Cutoff (ids 0..4) — not alphabetical.
    const scanned = [
        { name: 'F1 Slider A', envelopeId: '0' },
        { name: 'F1 Slider B', envelopeId: '1' },
        { name: 'F1 Slider C', envelopeId: '2' },
        { name: 'F1 Filter In', envelopeId: '3' },
        { name: 'F1 Cutoff', envelopeId: '4' },
    ];
    const routed = computeEnvelopeIndices(displaySort(scanned));
    const byName = Object.fromEntries(routed.map(r => [r.name, r.envelope_index]));
    assertEq(byName['F1 Slider A'], 0);
    assertEq(byName['F1 Slider B'], 1);
    assertEq(byName['F1 Slider C'], 2);
    assertEq(byName['F1 Filter In'], 3);
    assertEq(byName['F1 Cutoff'], 4);
});

test('B4: already-alphabetical racks are unchanged (no regression)', () => {
    const scanned = [
        { name: 'Alpha', envelopeId: '0' },
        { name: 'Beta', envelopeId: '1' },
        { name: 'Gamma', envelopeId: '2' },
    ];
    const routed = computeEnvelopeIndices(displaySort(scanned));
    const byName = Object.fromEntries(routed.map(r => [r.name, r.envelope_index]));
    assertEq(byName['Alpha'], 0);
    assertEq(byName['Beta'], 1);
    assertEq(byName['Gamma'], 2);
});

test('B5: session-loaded params (preserved envelopeId) route by device order', () => {
    // A session saved under v1.2 stores params in alphabetical order, but each
    // param keeps its original device-order envelopeId. Routing must follow it.
    const sessionParams = [ // saved alphabetical
        { name: 'Cutoff', envelopeId: '3' },
        { name: 'Drive', envelopeId: '0' },
        { name: 'Resonance', envelopeId: '1' },
        { name: 'Wave', envelopeId: '2' },
    ];
    const routed = computeEnvelopeIndices(sessionParams);
    const byName = Object.fromEntries(routed.map(r => [r.name, r.envelope_index]));
    // device order is Drive(0), Resonance(1), Wave(2), Cutoff(3)
    assertEq(byName['Drive'], 0);
    assertEq(byName['Resonance'], 1);
    assertEq(byName['Wave'], 2);
    assertEq(byName['Cutoff'], 3);
});

test('B6: identical param names stay stable (Macro x N, Acid On x N)', () => {
    const scanned = [
        { name: 'Acid On', envelopeId: '0' },
        { name: 'Acid On', envelopeId: '1' },
        { name: 'Acid On', envelopeId: '2' },
    ];
    const routed = computeEnvelopeIndices(displaySort(scanned));
    // each distinct envelopeId keeps its own slot in id order
    const byId = Object.fromEntries(routed.map(r => [r.envelopeId, r.envelope_index]));
    assertEq(byId['0'], 0);
    assertEq(byId['1'], 1);
    assertEq(byId['2'], 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
