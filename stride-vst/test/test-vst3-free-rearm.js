/**
 * test-vst3-free-rearm.js
 *
 * Covers the Notes-FREE auto-re-arm (field report 2026-08-04, Hyby): a producer
 * composing in Session view wants the modulation to start WITH each new clip and
 * then run continuously through the clip's rests — no per-stab retriggering.
 * FREE ran continuously but was deaf after its very first note AND its clock kept
 * advancing through a stopped transport, so every next clip started at a
 * wall-clock-random phase (the original "doesn't restart" complaint, plus drift).
 *
 * The fix: FREE re-arms on the HOST-transport true→false edge — stop parks the
 * phrase at zero with the clock closed; the next clip's first note launches it
 * fresh and it free-runs from there. Retrig / Transport / standalone untouched.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-free-rearm.js');

const W     = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd    = (p) => fs.readFileSync(p, 'utf8');
const procC = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH = rd(path.join(W, 'src', 'PluginProcessor.h'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — gate replica (mirrors the processBlock Notes-run block)
// ─────────────────────────────────────────────────────────────
const TRANSPORT = 0, RETRIG = 1, FREE = 2;
function mkGate() { return { held: 0n, latched: false, phase: 0, lastRm: -1, hostWas: false }; }
// One audio block: run-mode reset → FREE stop-edge re-arm → note scan → clock.
function block(g, rm, hostPlaying, notes, blockBeats) {
    if (rm !== g.lastRm) { g.held = 0n; g.latched = false; g.phase = 0; g.lastRm = rm; }
    if (rm === FREE && g.hostWas && !hostPlaying) { g.latched = false; g.phase = 0; }
    g.hostWas = hostPlaying;
    if (rm !== RETRIG && rm !== FREE) return { phase: null, open: hostPlaying };
    for (const n of (notes || [])) {
        if (n.on) {
            const fromSilence = g.held === 0n;
            if (rm === RETRIG ? fromSilence : !g.latched) g.phase = 0;
            g.latched = true;
            g.held |= (1n << BigInt(n.note));
        } else g.held &= ~(1n << BigInt(n.note));
    }
    const open = (rm === FREE) ? g.latched : g.held !== 0n;
    if (open) g.phase += blockBeats;
    return { phase: g.phase, open };
}

// FREE: the composing loop — play clip 1, stop, launch clip 2 — clip 2 starts at ZERO.
(function () {
    const g = mkGate();
    block(g, FREE, true, [{ on: true, note: 60 }], 1);       // clip 1, first note → launch
    block(g, FREE, true, [{ on: false, note: 60 }], 1);      // note ends → keeps running (deaf)
    const runMid = block(g, FREE, true, [], 1);
    ok('FREE runs continuously through rests (no per-stab resets)', runMid.open && runMid.phase === 3);
    block(g, FREE, true, [{ on: true, note: 62 }], 1);       // another stab mid-clip → NO reset
    ok('FREE stays deaf to later notes while playing', g.phase === 4);

    const stopped = block(g, FREE, false, [], 1);            // transport STOPS → re-arm
    ok('stop parks the phrase at zero with the clock closed', !stopped.open && stopped.phase === 0);
    block(g, FREE, false, [], 1); block(g, FREE, false, [], 1);
    ok('parked clock does not drift while stopped (the old wall-clock drift)', g.phase === 0);

    block(g, FREE, true, [], 1);                             // play pressed, clip 2 pre-roll silence
    ok('play alone does not start it — the first NOTE does', g.phase === 0);
    const clip2 = block(g, FREE, true, [{ on: true, note: 64 }], 1);
    ok('clip 2 first note launches the phrase FROM THE BEGINNING', clip2.phase === 1 && clip2.open);
})();

// FREE: jamming with the transport never started (standalone-style) — behavior unchanged.
(function () {
    const g = mkGate();
    block(g, FREE, false, [{ on: true, note: 60 }], 1);
    block(g, FREE, false, [{ on: false, note: 60 }], 1);
    block(g, FREE, false, [{ on: true, note: 61 }], 1);
    ok('no transport edges = classic FREE (starts once, runs forever, later notes ignored)', g.phase === 3);
})();

// RETRIG: completely untouched by the edge — silence still re-anchors, stop changes nothing.
(function () {
    const g = mkGate();
    block(g, RETRIG, true, [{ on: true, note: 60 }], 1);
    block(g, RETRIG, true, [{ on: false, note: 60 }], 1);    // silence → clock holds
    ok('RETRIG holds while silent', g.phase === 1);
    block(g, RETRIG, false, [], 1);                          // transport stop = NO phase touch for RETRIG
    ok('transport stop does not reset RETRIG (its anchor is silence, not the edge)', g.phase === 1);
    block(g, RETRIG, true, [{ on: true, note: 61 }], 1);     // next note-from-silence retrigs
    ok('note-from-silence still retrigs after the stop', g.phase === 1 && g.latched);
})();

// Mode re-select still re-arms (the pre-fix escape hatch keeps working).
(function () {
    const g = mkGate();
    block(g, FREE, true, [{ on: true, note: 60 }], 1);
    block(g, TRANSPORT, true, [], 1);
    const back = block(g, FREE, true, [], 1);
    ok('switching modes still resets the gate clock', back.phase === 0 && !g.latched);
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — the edge lives in the right place, gated to FREE only
// ─────────────────────────────────────────────────────────────
ok('hostWasPlaying tracked (audio-thread member)',
   /bool\s+hostWasPlaying = false;/.test(procH));
ok('re-arm fires ONLY for FREE, on the true→false host edge, resetting latch + phase',
   /if \(rm == \(int\) RunMode::NotesFree && hostWasPlaying && ! transportPlaying\)\s*\n\s*\{\s*\n\s*noteGateLatched = false;\s*\n\s*noteGatePhase = 0\.0;\s*\n\s*\}/.test(procC));
ok('edge is read from HOST truth — before the gate overwrites transportPlaying',
   (() => {
       const edge = procC.indexOf('RunMode::NotesFree && hostWasPlaying');
       const overwrite = procC.indexOf('transportPlaying = gateOpen');
       return edge > 0 && overwrite > edge;
   })());
ok('tracker updates every block (edge cannot double-fire across stopped blocks)',
   /hostWasPlaying = transportPlaying;\s*\n\s*if \(rm == \(int\) RunMode::NotesRetrig \|\| rm == \(int\) RunMode::NotesFree\)/.test(procC));
ok('RETRIG note-from-silence logic untouched',
   /const bool fromSilence = \(gateHeld\[0\] \| gateHeld\[1\]\) == 0;/.test(procC));
ok('mode-switch clean-slate untouched (re-select still re-arms)',
   /if \(rm != lastRunModeSeen\)[\s\S]{0,300}noteGatePhase = 0\.0;[\s\S]{0,100}lastRunModeSeen = rm;/.test(procC));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
