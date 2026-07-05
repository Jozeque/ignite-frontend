/**
 * test-vst3-device-reorder.js
 *
 * Drag-reorder of the hosted chain (moveNode). Moving a device shifts node indices, so every
 * mapped param + drive lane must be reindexed to keep pointing at the SAME device — otherwise a
 * drawn curve/lock would jump to the wrong knob. This test PROVES that invariant across arbitrary
 * move sequences (behavioural replica of the C++ remap), plus asserts the engine/editor/UI wiring.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-device-reorder.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));

// ─────────────────────────────────────────────────────────────
// 1. Engine — moveNode reorders + reindexes
// ─────────────────────────────────────────────────────────────
ok('moveNode declared', /void\s+moveNode\s*\(int from, int to\)/.test(procH));
ok('moveNode defined + under hostLock', /void\s+StrideWrapperProcessor::moveNode[\s\S]{0,120}ScopedLock sl \(hostLock\)/.test(procC));
ok('moveNode moves the Node (erase + insert)', /moveNode[\s\S]{0,400}chain\.erase\s*\(chain\.begin\(\) \+ from\)[\s\S]{0,120}chain\.insert\s*\(chain\.begin\(\) \+ to/.test(procC));
ok('moveNode reindexes mapped + drive lanes', /moveNode[\s\S]{0,900}for \(auto& m : mapped\)\s*m\.node = remap[\s\S]{0,120}for \(auto& l : driveLanes\)\s*l\.node = remap/.test(procC));
ok('moveNode is a no-op on bad/equal indices', /moveNode[\s\S]{0,200}from == to\)\s*return/.test(procC));

// ─────────────────────────────────────────────────────────────
// 2. Editor + UI wiring
// ─────────────────────────────────────────────────────────────
ok('editor has a moveDevice listener -> proc.moveNode', /withEventListener\s*\("moveDevice"[\s\S]{0,900}proc\.moveNode\s*\(from, to\)/.test(editor));
ok('editor reorders the synth windows with the device', /withEventListener\s*\("moveDevice"[\s\S]{0,700}synthWindows\.erase[\s\S]{0,140}synthWindows\.insert/.test(editor));
ok('chips are draggable', /chip\.draggable = true/.test(shim));
ok('chip drop emits moveDevice{from,to}', /emit\('moveDevice',\s*\{\s*from:\s*from,\s*to:\s*i\s*\}\)/.test(shim));
ok('drag hover uses an outline (not the ring — no filter clash)', /chip\.style\.outline = '2px solid/.test(shim));
ok('chips have a drag grip affordance', /Drag to reorder/.test(shim));

// ─────────────────────────────────────────────────────────────
// 3. BEHAVIOURAL — the reindex invariant (curves never jump knobs)
// ─────────────────────────────────────────────────────────────
// Replica of the C++ remap: new index for `idx` after moving element `from` -> `to`.
function remap(idx, from, to) {
    if (idx === from) return to;
    if (from < to) return (idx > from && idx <= to) ? idx - 1 : idx;
    return (idx >= to && idx < from) ? idx + 1 : idx;
}
function moveArr(arr, from, to) { const x = arr.splice(from, 1)[0]; arr.splice(to, 0, x); return arr; }

// One move keeps every mapped param on its device + the chain matches the array move.
(function () {
    const chain = ['A', 'B', 'C', 'D', 'E'];
    // mapped: a curve on a param of each device, tagged by device identity.
    const mapped = chain.map((dev, node) => ({ dev, node }));
    const from = 1, to = 3;                         // move B past C,D
    const expected = moveArr(chain.slice(), from, to);   // ['A','C','D','B','E']
    moveArr(chain, from, to);
    mapped.forEach(m => { m.node = remap(m.node, from, to); });
    ok('chain array move matches expected order', chain.join('') === 'ACDBE' && chain.join('') === expected.join(''));
    ok('every mapped param still points at its own device after the move',
       mapped.every(m => chain[m.node] === m.dev));
    ok('no two mapped params collide on the same node', new Set(mapped.map(m => m.node)).size === mapped.length);
})();

// Fuzz: many random move sequences, invariant must hold every step (and for drive lanes too).
(function () {
    let worstOk = true, collisionsOk = true, boundsOk = true;
    for (let trial = 0; trial < 400; trial++) {
        const size = 2 + Math.floor(Math.random() * 7);
        const chain = Array.from({ length: size }, (_, k) => 'D' + k);   // stable identities
        // map a random subset of devices (a curve + a lane each), tagged by identity
        const mapped = [];
        for (let k = 0; k < size; k++) if (Math.random() < 0.7) mapped.push({ dev: chain[k], node: k });
        const lanes = mapped.map(m => ({ dev: m.dev, node: m.node }));   // drive lanes track the same way
        const moves = 1 + Math.floor(Math.random() * 6);
        for (let mv = 0; mv < moves; mv++) {
            const from = Math.floor(Math.random() * size);
            let to = Math.floor(Math.random() * size);
            if (from === to) continue;
            moveArr(chain, from, to);
            mapped.forEach(m => { m.node = remap(m.node, from, to); });
            lanes.forEach(l => { l.node = remap(l.node, from, to); });
        }
        if (! mapped.every(m => m.node >= 0 && m.node < size)) boundsOk = false;
        if (! mapped.every(m => chain[m.node] === m.dev)) worstOk = false;       // param -> its device
        if (! lanes.every(l => chain[l.node] === l.dev)) worstOk = false;        // lane  -> its device
        if (new Set(mapped.map(m => m.node)).size !== mapped.length) collisionsOk = false;
    }
    ok('fuzz: mapped params ALWAYS stay on their device (400 random move sequences)', worstOk);
    ok('fuzz: node indices stay in range', boundsOk);
    ok('fuzz: mapped params never collide onto one node', collisionsOk);
})();

// Edge cases: adjacent swap (A/B), first<->last, move to same (no-op-ish).
(function () {
    const swap = ['R', 'O'];                      // "reverb, ott" -> swap to "ott, reverb"
    const m = swap.map((dev, node) => ({ dev, node }));
    moveArr(swap, 0, 1); m.forEach(x => x.node = remap(x.node, 0, 1));
    ok('adjacent A/B swap (reverb<->ott) keeps both mappings correct',
       swap.join('') === 'OR' && m.every(x => swap[x.node] === x.dev));

    const big = ['A', 'B', 'C', 'D']; const mb = big.map((dev, node) => ({ dev, node }));
    moveArr(big, 0, 3); mb.forEach(x => x.node = remap(x.node, 0, 3));
    ok('move first -> last', big.join('') === 'BCDA' && mb.every(x => big[x.node] === x.dev));

    const big2 = ['A', 'B', 'C', 'D']; const mb2 = big2.map((dev, node) => ({ dev, node }));
    moveArr(big2, 3, 0); mb2.forEach(x => x.node = remap(x.node, 3, 0));
    ok('move last -> first', big2.join('') === 'DABC' && mb2.every(x => big2[x.node] === x.dev));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
