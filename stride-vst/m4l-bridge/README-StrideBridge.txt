STRIDEBRIDGE - modulate Ableton's own devices from Stride
=========================================================

StrideBridge is a Max for Live device that lets Stride VST move the knobs of
the devices in your Live set: Operator, Roar, Auto Filter, EQ Eight, all of
them. Map a knob, draw a curve in Stride, press Play.

REQUIRES
- Ableton Live 11 or newer with Max for Live (Live Suite has it built in)
- Stride 2.0 or newer in the same set

INSTALL (one time)
1. Copy this whole StrideBridge folder into your Ableton User Library:
   Windows: C:\Users\YOU\Documents\Ableton\User Library\StrideBridge
   Mac:     ~/Music/Ableton/User Library/StrideBridge
   Keep the files together. The device needs them next to it.
2. In Live's browser, open Places > User Library > StrideBridge and drag
   StrideBridge.amxd onto any track. One per set is enough. It passes audio
   straight through, so it can sit anywhere. Extra copies (say, inside a
   saved rack) stand by: the device face reads ACTIVE or STANDBY.

USE
- Open Stride. A MAP LIVE button appears once the bridge is detected.
- Press MAP LIVE, then click any knob in Live. It becomes a Stride lane.
  Keep clicking to map more. Press the button again to stop mapping.
- Draw curves. Press Play. The knobs move, locked to your transport.
- Menus work too (Roar's distortion style, filter types): values snap to the
  options, S&H curves fit them best. Note: each menu step lands in Live's
  undo history. That is how Live counts them, not something we can skip.
- Live's MIDI effects work too (Arpeggiator, Chord, Scale, Note Length).
  Those knobs stay yours to move by hand even while Stride drives them, and
  like menus, their moves land in Live's undo history.

FINDING A LANE
- Press Stop, then click the knob in Live. Its lane lights up in Stride.
- While playing, click a device's title bar to light up all of its lanes.

GOOD TO KNOW
- While the transport runs, mapped knobs are driven by Stride and cannot be
  moved by hand. Press Stop and they are yours again.
- Removing a lane: press the x on the lane in Stride. The knob is released.
- Modulation keeps running with the Stride window closed.
- Racks travel. Save Stride and its Ableton devices as a rack: the lanes
  find their knobs wherever the rack lands, in this set or another.
- Two of the same device in the set (a duplicated track, a rack dropped
  next to its original)? Press MAP LIVE and click the title bar of the one
  you mean. All its lanes follow.
- Mapping and drawing write nothing into clips. This is live modulation, and
  it renders when you bounce or export.

INJECT TO CLIP
- The INJECT button on the device writes your lanes into a clip as real
  automation, so they stay after you remove Stride.
- Select the MIDI clip in Live first, so it shows in the Detail view at the
  bottom. Then press INJECT. The line under the button reports the result.
- Only lanes whose knob lives on that clip's own track can be written, which
  is Live's rule, not ours. "4 OF 6" means four landed and two point at
  another track. Take those to a clip on their track.
- Needs StrideInject: Preferences > Link, Tempo & MIDI > Control Surface >
  StrideInject, then restart Live. The button says STRIDEINJECT? if it is
  missing.
- Injecting replaces the automation for those knobs in that clip. Everything
  else in the clip is untouched, and Ctrl/Cmd-Z undoes it.
- Optional: double-click Outfit.ttf and press Install so the device shows
  the Stride look inside your set.
