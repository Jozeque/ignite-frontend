/**
 * Integration test: verifies the full chain of the Pattern Library — from
 * .mid bytes through the parser, loop-expansion math, and .alc note
 * injection — produces a coherent end result.
 *
 * Does NOT touch DOM or WebSocket. Exercises the *data* pipeline that
 * runs from Library pick → canvas arming → injectMidiNotes.
 *
 * Run: node test/test-pattern-integration.js
 */

const fs = require('fs');
const path = require('path');
const midi = require('../app/renderer/midi-parser.js');
const loader = require('../app/renderer/pattern-loader.js');
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

const MINIMAL_ALC = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5">
  <LiveSet>
    <Tracks>
      <MidiTrack>
        <DeviceChain><MainSequencer><ClipSlotList><ClipSlot><Value>
          <MidiClip>
            <Loop><LoopEnd Value="16"/><HiddenLoopEnd Value="16"/><OutMarker Value="16"/></Loop>
            <Notes>
              <KeyTracks><KeyTrack Id="1"><Notes/><MidiKey Value="60"/></KeyTrack></KeyTracks>
              <PerNoteEventStore><EventLists/></PerNoteEventStore>
              <NoteProbabilityGroups/>
              <ProbabilityGroupIdGenerator><NextId Value="1"/></ProbabilityGroupIdGenerator>
              <NoteIdGenerator><NextId Value="2"/></NoteIdGenerator>
            </Notes>
          </MidiClip>
        </Value></ClipSlot></ClipSlotList></MainSequencer></DeviceChain>
      </MidiTrack>
    </Tracks>
  </LiveSet>
</Ableton>`;

console.log('\n── Pattern integration ─────────────────────────\n');

test('full chain: parse 1-bar drum pattern → expand to 8 bars → inject into .alc', () => {
    // Step 1: Parse the bundled four-on-floor pattern (1 bar)
    const buf = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'patterns', 'drums', 'four_on_floor_01.mid'));
    const parsed = midi.parse(buf);
    assertEq(parsed.notes.length, 4, 'parser should give us 4 kicks');

    // Step 2: Expand to fit an 8-bar canvas (1 bar → 8 reps)
    const expanded = loader.expandToCanvasLength(parsed.notes, 1, 8);
    assertEq(expanded.length, 32, 'expected 8 × 4 = 32 kicks after looping');

    // Step 3: Inject into .alc XML
    const doc = new DOMParser().parseFromString(MINIMAL_ALC, 'text/xml');
    const r = injector.injectMidiNotes(doc, doc.documentElement, expanded, 32);
    assertEq(r.notesWritten, 32);
    assertEq(r.pitchCount, 1, 'all kicks have same pitch (36)');

    // Step 4: Sanity-check the resulting XML structure
    const keyTracks = doc.getElementsByTagName('KeyTrack');
    assertEq(keyTracks.length, 1);
    const events = keyTracks[0].getElementsByTagName('MidiNoteEvent');
    assertEq(events.length, 32);
    const firstTime = parseFloat(events[0].getAttribute('Time'));
    const lastTime = parseFloat(events[events.length - 1].getAttribute('Time'));
    assert(firstTime === 0, 'first kick at beat 0');
    assert(lastTime > 25 && lastTime < 32, `last kick should be in last bar of 8-bar clip; got ${lastTime}`);
});

test('full chain: parse 8-bar chord pattern → fit 8-bar canvas → inject', () => {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'patterns', 'chords', 'dreamy_chords_01.mid'));
    const parsed = midi.parse(buf);
    const expanded = loader.expandToCanvasLength(parsed.notes, 8, 8);
    // Exact fit: 16 notes (4 chords × 4 voices), no looping
    assertEq(expanded.length, parsed.notes.length);

    const doc = new DOMParser().parseFromString(MINIMAL_ALC, 'text/xml');
    const r = injector.injectMidiNotes(doc, doc.documentElement, expanded, 32);
    assertEq(r.notesWritten, 16);
    // The Cmaj7/Am7/Fmaj7/G7 progression spans 10 unique pitches across
    // the four chord voicings. Accept any sensible number in range.
    assert(r.pitchCount >= 4 && r.pitchCount <= 16, `unexpected pitch count: ${r.pitchCount}`);
    const keyTracks = doc.getElementsByTagName('KeyTrack');
    assertEq(keyTracks.length, r.pitchCount, 'KeyTrack count must match pitchCount');
});

test('full chain: 8-bar pattern → 16-bar canvas → duplicated exactly twice', () => {
    // Real-world ask: user has an 8-bar MIDI pattern and a 16-bar canvas.
    // Expanded notes should fill the full 16 bars by repeating the pattern
    // verbatim — no truncation, no overlap, no missing tail.
    const buf = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'patterns', 'chords', 'dreamy_chords_01.mid'));
    const parsed = midi.parse(buf);
    const sourceCount = parsed.notes.length;

    const expanded = loader.expandToCanvasLength(parsed.notes, 8, 16);
    assertEq(expanded.length, sourceCount * 2, 'expected 2x the source notes after duplication');

    // The second half must mirror the first, shifted by exactly 8 bars (32 beats).
    const firstHalf = expanded.slice(0, sourceCount);
    const secondHalf = expanded.slice(sourceCount);
    for (let i = 0; i < sourceCount; i++) {
        assertEq(firstHalf[i].pitch, secondHalf[i].pitch, `note ${i} pitch mismatch`);
        assertEq(firstHalf[i].duration, secondHalf[i].duration, `note ${i} duration mismatch`);
        assertEq(secondHalf[i].time - firstHalf[i].time, 32, `note ${i} second-rep offset must be exactly 32 beats`);
    }

    // No note should land at or past beat 64 (end of the 16-bar canvas).
    for (const n of expanded) {
        assert(n.time < 64, `note at beat ${n.time} is past clip end`);
    }

    // Inject into .alc and confirm everything writes.
    const doc = new DOMParser().parseFromString(MINIMAL_ALC, 'text/xml');
    const r = injector.injectMidiNotes(doc, doc.documentElement, expanded, 64);
    assertEq(r.notesWritten, sourceCount * 2, 'injector must write every duplicated note');
});

test('full chain: 16-bar pattern truncated to fit 8-bar canvas', () => {
    // Build a synthetic 16-bar pattern (16 notes, one per bar)
    const notes = [];
    for (let i = 0; i < 16; i++) {
        notes.push({ pitch: 60 + i, time: i * 4, duration: 1, velocity: 100 });
    }
    const expanded = loader.expandToCanvasLength(notes, 16, 8);
    // Canvas is 8 bars = 32 beats; only notes with time < 32 survive
    assertEq(expanded.length, 8);
    assertEq(expanded[0].time, 0);
    assertEq(expanded[7].time, 28);
});

test('regression: empty midi_notes leaves .alc envelopes untouched', () => {
    // Build an .alc with an existing ClipEnvelope, run injectMidiNotes
    // with an empty array — the envelope must remain bit-equal.
    const docWithEnv = new DOMParser().parseFromString(`<?xml version="1.0"?>
<Ableton><LiveSet><Tracks><MidiTrack><DeviceChain><MainSequencer><ClipSlotList><ClipSlot><Value>
<MidiClip>
  <Envelopes>
    <ClipEnvelope Id="7"><PointeeId Value="42"/>
      <Events>
        <FloatEvent Time="-63072000" Value="0.5"/>
        <FloatEvent Time="0" Value="0.7"/>
        <FloatEvent Time="4" Value="0.3"/>
      </Events>
    </ClipEnvelope>
  </Envelopes>
  <Notes>
    <KeyTracks><KeyTrack Id="1"><Notes><MidiNoteEvent Time="0" Duration="0.5" Velocity="100" OffVelocity="64" NoteId="1"/></Notes><MidiKey Value="60"/></KeyTrack></KeyTracks>
    <NoteIdGenerator><NextId Value="2"/></NoteIdGenerator>
  </Notes>
</MidiClip>
</Value></ClipSlot></ClipSlotList></MainSequencer></DeviceChain></MidiTrack></Tracks></LiveSet></Ableton>`, 'text/xml');

    const envBefore = docWithEnv.getElementsByTagName('Envelopes')[0];
    const eventsBefore = envBefore.getElementsByTagName('FloatEvent');
    const beforeStr = Array.from(eventsBefore).map(e =>
        e.getAttribute('Time') + '/' + e.getAttribute('Value')).join('|');

    // Inject with no notes — should wipe KeyTracks but never touch <Envelopes>
    injector.injectMidiNotes(docWithEnv, docWithEnv.documentElement, [], 16);

    const envAfter = docWithEnv.getElementsByTagName('Envelopes')[0];
    const eventsAfter = envAfter.getElementsByTagName('FloatEvent');
    const afterStr = Array.from(eventsAfter).map(e =>
        e.getAttribute('Time') + '/' + e.getAttribute('Value')).join('|');

    assertEq(beforeStr, afterStr, 'envelope events must be byte-equal');
});

test('regression: injectAutomation + injectMidiNotes compose without interference', () => {
    // Inject curves on a ClipEnvelope, then inject notes — assert both
    // remain intact in the resulting XML.
    const doc = new DOMParser().parseFromString(`<?xml version="1.0"?>
<Ableton><LiveSet><Tracks><MidiTrack><DeviceChain><MainSequencer><ClipSlotList><ClipSlot><Value>
<MidiClip>
  <Loop><LoopEnd Value="4"/><HiddenLoopEnd Value="4"/><OutMarker Value="4"/></Loop>
  <Envelopes>
    <ClipEnvelope Id="7"><EnvelopeTarget><PointeeId Value="42"/></EnvelopeTarget>
      <Events>
        <FloatEvent Time="-63072000" Value="0.5"/>
      </Events>
    </ClipEnvelope>
  </Envelopes>
  <Notes>
    <KeyTracks/>
    <NoteIdGenerator><NextId Value="1"/></NoteIdGenerator>
  </Notes>
</MidiClip>
</Value></ClipSlot></ClipSlotList></MainSequencer></DeviceChain></MidiTrack></Tracks></LiveSet></Ableton>`, 'text/xml');

    // Step A: injectAutomation
    injector.injectAutomation(doc, doc.documentElement, [{
        envelope_index: 0,
        name: 'test',
        points: [{ time: 0, value: 0.2 }, { time: 1, value: 0.8 }],
    }], 4);

    // Step B: injectMidiNotes
    const r = injector.injectMidiNotes(doc, doc.documentElement, [
        { pitch: 60, time: 0, duration: 1, velocity: 100 },
        { pitch: 64, time: 2, duration: 1, velocity: 100 },
    ], 16);
    assertEq(r.notesWritten, 2);

    // Assert envelope still has its points (plus anchor that injectAutomation writes)
    const events = doc.getElementsByTagName('FloatEvent');
    assert(events.length >= 2, 'envelope events should survive note injection');

    // Assert notes are present
    const keyTracks = doc.getElementsByTagName('KeyTrack');
    assertEq(keyTracks.length, 2);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
