# Stride 2.0

Stride now moves the knobs of Ableton's own devices. Map any parameter of any device in your Live set to a Stride lane, draw, press play.

## StrideBridge (Ableton Live 11+ with Max for Live)

- **Map Live.** Press it, click knobs in Live, each one lands as a lane, exactly like your hosted plugins. Press again to stop. Menus work too (Roar's distortion style, filter types): values snap to the options, S&H curves fit them best.
- **Locked to the transport.** Sample accurate, no clips, no automation lanes. Keeps running with the Stride window closed, starts by itself when the project loads, renders when you bounce.
- **Find a lane.** Press Stop, click the knob in Live and its lane lights up in Stride. Click a device's title bar to light up every lane it owns. Click again, it lights again.
- **Racks travel.** Save Stride and its Ableton devices as a rack. The lanes find their knobs wherever the rack lands: another track, another set, or right next to the original. Two of the same device in the set? Press Map Live and click the title bar of the one you mean. All its lanes follow.
- **32 knobs at once.** One StrideBridge per set is enough. Extra copies (say, inside a saved rack) stand by, and the device face says ACTIVE or STANDBY so you always know which one is talking.
- **Install once.** Copy the StrideBridge folder from your download into Ableton's User Library, drag StrideBridge.amxd onto any track. No installer, no terminal.

## Also in 2.0

- Map Live turns yellow and pulses while armed, same as Map.
- The value readout on a Compact card is half the size.
- Stop-to-find: while the transport is stopped, mapped knobs are yours to move by hand. Play snaps them back onto the curve.

## Good to know

- A knob driven by Stride cannot be moved by hand or automated while the transport runs. Press Stop and it is yours again.
- Each step of a menu lane lands in Live's undo history. That is how Live counts them.
- Everything else in Stride works in any VST3 or AU host as before. StrideBridge needs Live with Max for Live.

## Files

- `Stride-VST3-Windows-v2.0.4.zip` and `Stride-VST3-Mac-v2.0.4.zip`: `Stride.vst3` (and `Stride.component` on Mac), `README.txt`, and the `StrideBridge` folder.

## 2.0.4

- StrideBridge's device face renders correctly on every machine (it could show as a solid black block).
- Bridge lanes hold their knobs steadily through long sessions. Two watchdogs that could briefly release working lanes on a busy system now leave them alone.
- Shift+click selects a range of lanes, from the highlighted lane to the one you click. Cmd/Ctrl+click still toggles one at a time.
- Applying curves to a selection now includes the highlighted lane. It always looked selected; now it behaves selected.

## 2.0.3

- **Every knob sweeps its real range.** Stride reads each parameter's own range from Live at map time and drives it in those units: pitch in semitones, gain in dB, frequency with a musical taper. Knobs that already ran 0 to 1 sound exactly as before.
- Mapped knobs land only in the Stride window that pressed Map Live. A window closing mid-mapping takes the mapping session down with it, so lanes can no longer appear in a window that never asked for them.
- Select All plus a Motion now hits every lane it says it will. Mapping, adding a device or an undo no longer quietly drops your selection or moves your focused lane.
- If StrideBridge ever stops answering, the Map Live button says so and tells you the fix, instead of staying lit over a dead session. A stale bridge process frees the port on its own within half a minute.

## 2.0.2

- **Live's MIDI effects now modulate.** Arpeggiator, Chord, Scale, Note Length: map their knobs like any other. They run through Live's own control path, so they stay yours to move by hand while the transport is stopped. Each move a MIDI effect knob makes lands in Live's undo history, which is how Live counts it.
- Map Live stays armed while you go and fetch a device. The window is two minutes now, and adding a device no longer ends the mapping session.
- Mapping can no longer go quiet mid-session. Pressing Map Live always starts a fresh listener, so knob clicks keep landing without reloading StrideBridge.
- The StrideBridge device face shows ACTIVE or STANDBY, and nothing else.

## 2.0.1

- The Discovery Pass works the same for StrideBridge lanes as for hosted lanes: full during the pass, your existing lanes keep playing after it ends, no new mapping until you activate. A shared project opened on a machine without a pass plays dry, Ableton lanes included.
