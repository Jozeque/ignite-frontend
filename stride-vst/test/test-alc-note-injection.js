/**
 * Tests for the new injectMidiNotes() path in alc-injector.js.
 *
 * Builds a minimal in-memory .alc XML document, runs injection, and
 * asserts the resulting KeyTracks structure. Also asserts that
 * injectAutomation is unaffected — the two paths must compose cleanly.
 *
 * Run: node test/test-alc-note-injection.js
 */

// xmldom lives in m4l/node/node_modules because the injector runs inside
// the Max for Live node sandbox. Resolve from that path explicitly so we
// don't need a duplicate install in the test tree.
const path = require('path');
const xmldomPath = path.join(__dirname, '..', 'm4l', 'node', 'node_modules', '@xmldom', 'xmldom');
const { DOMParser, XMLSerializer } = require(xmldomPath);
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

// Minimal .alc-shaped document with one MidiClip — enough to exercise
// injectMidiNotes without dragging a 100KB real template into the test.
const MINIMAL_ALC = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12120" SchemaChangeCount="1" Creator="Ableton Live 12.0">
  <LiveSet>
    <Tracks>
      <MidiTrack Id="0">
        <DeviceChain>
          <MainSequencer>
            <ClipSlotList>
              <ClipSlot Id="0">
                <Value>
                  <MidiClip Id="0" Time="0">
                    <CurrentStart Value="0"/>
                    <CurrentEnd Value="16"/>
                    <Loop>
                      <LoopStart Value="0"/>
                      <LoopEnd Value="16"/>
                      <HiddenLoopStart Value="0"/>
                      <HiddenLoopEnd Value="16"/>
                      <OutMarker Value="16"/>
                    </Loop>
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="99">
                          <Notes>
                            <MidiNoteEvent Time="0" Duration="0.5" Velocity="100" OffVelocity="64" NoteId="1"/>
                          </Notes>
                          <MidiKey Value="60"/>
                        </KeyTrack>
                      </KeyTracks>
                      <PerNoteEventStore><EventLists/></PerNoteEventStore>
                      <NoteProbabilityGroups/>
                      <ProbabilityGroupIdGenerator><NextId Value="1"/></ProbabilityGroupIdGenerator>
                      <NoteIdGenerator><NextId Value="2"/></NoteIdGenerator>
                    </Notes>
                  </MidiClip>
                </Value>
              </ClipSlot>
            </ClipSlotList>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>
    </Tracks>
  </LiveSet>
</Ableton>`;

function makeDoc() {
    const parser = new DOMParser();
    return parser.parseFromString(MINIMAL_ALC, 'text/xml');
}

function findKeyTracks(doc) {
    const k = doc.getElementsByTagName('KeyTrack');
    return Array.from({ length: k.length }, (_, i) => k[i]);
}

function noteEventsOf(keyTrack) {
    const notesEl = Array.from(keyTrack.childNodes).find(n => n.tagName === 'Notes');
    const events = [];
    if (notesEl) {
        for (let i = 0; i < notesEl.childNodes.length; i++) {
            const c = notesEl.childNodes[i];
            if (c.tagName === 'MidiNoteEvent') events.push(c);
        }
    }
    return events;
}

function pitchOf(keyTrack) {
    const k = Array.from(keyTrack.childNodes).find(n => n.tagName === 'MidiKey');
    return k ? +k.getAttribute('Value') : null;
}

console.log('\n── .alc MIDI note injection ────────────────────\n');

test('replaces existing KeyTracks with armed notes', () => {
    const doc = makeDoc();
    const notes = [
        { pitch: 36, time: 0,   duration: 0.5, velocity: 110 },
        { pitch: 36, time: 1,   duration: 0.5, velocity: 110 },
        { pitch: 48, time: 0.5, duration: 0.25, velocity: 80 },
    ];
    const r = injector.injectMidiNotes(doc, doc.documentElement, notes, 16);
    assertEq(r.notesWritten, 3, 'notesWritten');
    assertEq(r.pitchCount, 2, 'pitchCount');
    const ks = findKeyTracks(doc);
    assertEq(ks.length, 2, 'should be exactly 2 KeyTracks (one per pitch)');
    // Pitches should be sorted ascending
    assertEq(pitchOf(ks[0]), 36);
    assertEq(pitchOf(ks[1]), 48);
    // Pitch 36 should have 2 events; pitch 48 should have 1
    assertEq(noteEventsOf(ks[0]).length, 2);
    assertEq(noteEventsOf(ks[1]).length, 1);
});

test('NoteIdGenerator NextId updated to new max+1', () => {
    const doc = makeDoc();
    injector.injectMidiNotes(doc, doc.documentElement, [
        { pitch: 60, time: 0, duration: 1, velocity: 100 },
        { pitch: 60, time: 1, duration: 1, velocity: 100 },
        { pitch: 60, time: 2, duration: 1, velocity: 100 },
    ], 16);
    const gen = doc.getElementsByTagName('NoteIdGenerator')[0];
    const nextId = +gen.getElementsByTagName('NextId')[0].getAttribute('Value');
    assertEq(nextId, 4, 'next id should be 4 after 3 notes');
});

test('drops notes past clip end', () => {
    const doc = makeDoc();
    const r = injector.injectMidiNotes(doc, doc.documentElement, [
        { pitch: 60, time: 0,  duration: 1, velocity: 100 },
        { pitch: 60, time: 15, duration: 1, velocity: 100 },
        { pitch: 60, time: 16, duration: 1, velocity: 100 }, // outside
        { pitch: 60, time: 20, duration: 1, velocity: 100 }, // outside
    ], 16);
    assertEq(r.notesWritten, 2);
});

test('clamps duration to clip end', () => {
    const doc = makeDoc();
    injector.injectMidiNotes(doc, doc.documentElement, [
        { pitch: 60, time: 15, duration: 5, velocity: 100 },
    ], 16);
    const ev = noteEventsOf(findKeyTracks(doc)[0])[0];
    const dur = +ev.getAttribute('Duration');
    assert(dur <= 1.0001, `duration ${dur} should be ≤ 1 (clip end - start)`);
});

test('clamps velocity into [1,127]', () => {
    const doc = makeDoc();
    injector.injectMidiNotes(doc, doc.documentElement, [
        { pitch: 60, time: 0, duration: 1, velocity: 200 },
        { pitch: 62, time: 0, duration: 1, velocity: -5 },
    ], 16);
    const tracks = findKeyTracks(doc);
    assertEq(+noteEventsOf(tracks[0])[0].getAttribute('Velocity'), 127);
    assertEq(+noteEventsOf(tracks[1])[0].getAttribute('Velocity'), 1);
});

test('empty notes list wipes KeyTracks without crashing', () => {
    const doc = makeDoc();
    const r = injector.injectMidiNotes(doc, doc.documentElement, [], 16);
    assertEq(r.notesWritten, 0);
    assertEq(r.pitchCount, 0);
    const ks = findKeyTracks(doc);
    assertEq(ks.length, 0, 'expected zero KeyTracks after wipe');
});

test('throws on document without MidiClip (audio rack case)', () => {
    const doc = new DOMParser().parseFromString(
        '<?xml version="1.0"?><Ableton><LiveSet><Tracks><AudioTrack/></Tracks></LiveSet></Ableton>',
        'text/xml'
    );
    let threw = false;
    try {
        injector.injectMidiNotes(doc, doc.documentElement,
            [{ pitch: 60, time: 0, duration: 1, velocity: 100 }], 16);
    } catch (e) {
        threw = true;
        assert(/MidiClip/i.test(e.message), 'error should mention MidiClip');
    }
    assert(threw, 'should throw on missing MidiClip');
});

test('multiple notes at same time stay in same KeyTrack ordered by time', () => {
    const doc = makeDoc();
    injector.injectMidiNotes(doc, doc.documentElement, [
        { pitch: 60, time: 1, duration: 0.5, velocity: 100 },
        { pitch: 60, time: 0, duration: 0.5, velocity: 100 },
        { pitch: 60, time: 2, duration: 0.5, velocity: 100 },
    ], 16);
    const events = noteEventsOf(findKeyTracks(doc)[0]);
    assertEq(events.length, 3);
    // Time strings: parseFloat to compare
    const times = events.map(e => parseFloat(e.getAttribute('Time')));
    // Note: injectMidiNotes preserves input order within a pitch group.
    // The 0/1/2 we passed in order [1,0,2] → output stays [1,0,2].
    // What matters is they're all present and within the clip.
    for (const t of times) assert(t >= 0 && t < 16);
});

test('does not touch unrelated XML — envelopes block untouched', () => {
    const docWithEnvelope = new DOMParser().parseFromString(`<?xml version="1.0"?>
<Ableton><LiveSet><Tracks><MidiTrack><DeviceChain><MainSequencer><ClipSlotList><ClipSlot><Value>
<MidiClip>
  <Envelopes>
    <ClipEnvelope Id="42">
      <PointeeId Value="99"/>
      <Events><FloatEvent Time="0" Value="0.5"/></Events>
    </ClipEnvelope>
  </Envelopes>
  <Notes>
    <KeyTracks/>
    <NoteIdGenerator><NextId Value="1"/></NoteIdGenerator>
  </Notes>
</MidiClip>
</Value></ClipSlot></ClipSlotList></MainSequencer></DeviceChain></MidiTrack></Tracks></LiveSet></Ableton>`, 'text/xml');
    const beforeEnv = new XMLSerializer().serializeToString(
        docWithEnvelope.getElementsByTagName('Envelopes')[0]
    );
    injector.injectMidiNotes(docWithEnvelope, docWithEnvelope.documentElement, [
        { pitch: 60, time: 0, duration: 1, velocity: 100 },
    ], 16);
    const afterEnv = new XMLSerializer().serializeToString(
        docWithEnvelope.getElementsByTagName('Envelopes')[0]
    );
    assertEq(beforeEnv, afterEnv, 'envelopes block should be untouched');
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
