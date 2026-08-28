# -*- coding: utf-8 -*-
"""Generates StrideBridge.maxpat.

The 16 voices are INLINED with literal buffer names (sb_buf_1..sb_buf_16), not
abstractions: on the rig (2026-08-26) the abstraction route collapsed every
voice onto one buffer - four lanes with four verified-distinct WAVs all played
the last-written curve. Literal names leave Max nothing to resolve, and the
whole device becomes self-contained (no stride_voice.maxpat to deploy).

144 repetitive boxes is exactly why this file exists - never hand-write it.

32 voices since 2026-08-26: a rack COPY next to its original doubles the bank.
"""
import json

NUM = 32

boxes = []
lines = []


def box(bid, maxclass, x, y, w, h, **kw):
    b = {"id": bid, "maxclass": maxclass, "patching_rect": [x, y, w, h]}
    b.update(kw)
    boxes.append({"box": b})


def obj(bid, x, y, w, text, nin, nout, outlettype=None):
    box(bid, "newobj", x, y, w, 22, numinlets=nin, numoutlets=nout,
        outlettype=(outlettype if outlettype is not None else [""] * nout), text=text)


def msg(bid, x, y, w, text):
    box(bid, "message", x, y, w, 22, numinlets=2, numoutlets=1, outlettype=[""], text=text)


def wire(src, so, dst, di):
    lines.append({"patchline": {"source": [src, so], "destination": [dst, di]}})


# ── the DEVICE FACE (presentation view): Live shows THIS, not the wiring canvas.
# Without it the device renders the full 1000px patching rect (field report: "too
# wide"). Branded like the product: zinc-950 ground, orange-500 STRIDE, Outfit
# (installed per-user by the deploy script; Max needs a SYSTEM font, it cannot
# read the VST's embedded webfont).
# Z-ORDER RULE (field 2026-08-28, Mac: the shipped face rendered FULL BLACK): Max
# draws EARLIER boxes in this array ON TOP. The ground panel therefore must be the
# LAST box appended (see the end of this file), never the first - Yossi's hand-fixed
# device proved it (his send-to-back moved obj-face-bg to the array's end).
ZINC950 = [0.035, 0.035, 0.043, 1.0]
ORANGE500 = [0.976, 0.451, 0.086, 1.0]
ZINC400 = [0.631, 0.631, 0.667, 1.0]
box("obj-face-t1", "comment", 100, 4, 84, 24,
    presentation=1, presentation_rect=[3.0, 56.0, 84.0, 24.0],
    fontname="Outfit", fontsize=15.0, fontface=1,
    textcolor=ORANGE500, textjustification=1, text="STRIDE")
box("obj-face-t2", "comment", 100, 30, 84, 18,
    presentation=1, presentation_rect=[3.0, 80.0, 84.0, 18.0],
    fontname="Outfit", fontsize=9.0, fontface=1,
    textcolor=ZINC400, textjustification=1, text="B R I D G E")
box("obj-face-rule", "panel", 100, 52, 60, 2,
    presentation=1, presentation_rect=[15.0, 104.0, 60.0, 2.0],
    mode=0, rounded=0,
    bgfillcolor_type="color", bgfillcolor_color=[0.976, 0.451, 0.086, 0.55],
    bgfillcolor_angle=270.0, bgfillcolor_proportion=0.39, bgfillcolor_autogradient=0)
# live readout on the face: ACTIVE (owns the VST link) / STANDBY (another bridge does).
# Fed by node via [route ... status] -> "set <text>". Answers the field question
# "is it the two bridges?" from inside Live. (A lane count used to sit under it: removed
# 2026-08-27, Yossi did not want it.)
box("obj-face-st", "comment", 100, 56, 84, 16,
    numinlets=1, numoutlets=0,
    presentation=1, presentation_rect=[3.0, 112.0, 84.0, 16.0],
    fontname="Outfit", fontsize=9.0, fontface=1,
    textcolor=ZINC400, textjustification=1, text="STANDBY")
box("obj-1", "comment", 20, 12, 900, 20,
    numinlets=1, numoutlets=0,
    text="STRIDE BRIDGE - Stride VST's output stage for Ableton's own devices. One ACTIVE instance per set, extra copies stand by (the face says which). 32 voices.")
box("obj-2", "comment", 20, 34, 900, 20,
    numinlets=1, numoutlets=0,
    text="VST link = TCP :9102 (node). Curves arrive as WAVs; each voice: phasor~ @lock 1 -> rate~ -> wave~ -> live.remote~. Voices are INLINE - literal buffer names, nothing to resolve.")

# ── audio passthrough - MANDATORY for a Max Audio Effect ──
# Without plugin~ -> plugout~ the device EATS the track's audio (field report
# 2026-08-26: bridge on = hosted Serum silent; off = audible). The bridge never
# touches the track's audio, so this is a straight stereo wire.
obj("obj-in", 750, 70, 60, "plugin~", 1, 2, ["signal", "signal"])
obj("obj-out", 750, 110, 65, "plugout~", 2, 2, ["", ""])
wire("obj-in", 0, "obj-out", 0)
wire("obj-in", 1, "obj-out", 1)
box("obj-thru", "comment", 690, 140, 220, 33,
    numinlets=1, numoutlets=0,
    text="audio passthrough - the bridge modulates params, never the track's audio")

# node.script server
obj("obj-3", 20, 70, 260, "node.script bridge-server.js @autostart 1 @watch 0", 1, 2, ["", ""])
boxes[-1]["box"]["saved_object_attributes"] = {"autostart": 1, "defer": 0, "node_bin_path": "", "npm_bin_path": "", "watch": 0}

# top-level route from node: voice / probe / status
obj("obj-6", 20, 110, 175, "route voice probe status", 1, 4, ["", "", "", ""])
wire("obj-3", 0, "obj-6", 0)
# face readout: node sends "status set ACTIVE"
wire("obj-6", 2, "obj-face-st", 0)

# probe -> [js bridge_max.js] -> back into node
obj("obj-7", 480, 110, 110, "js bridge_max.js", 1, 1)
# the always-on selected_parameter observer must be created AFTER the Live API is up:
# live.thisdevice bangs exactly then (a loadbang-time LiveAPI is the classic M4L trap)
obj("obj-11", 480, 70, 95, "live.thisdevice", 1, 3, ["bang", "", ""])
msg("obj-12", 590, 70, 40, "init")
wire("obj-11", 0, "obj-12", 0)
wire("obj-12", 0, "obj-7", 0)
wire("obj-6", 1, "obj-7", 0)
wire("obj-7", 0, "obj-3", 0)

# ── re-click finder ──
# Live's selected_parameter observer is CHANGE-driven: clicking the already-selected
# knob again fires nothing (field report 2026-08-27: "press again, it won't show").
# [mousestate] sees every mouse-down globally; the js compares the click position with
# where the selected knob (or device header) was last clicked and re-flashes on a match.
# Output order on a down: y -> x -> button, so x/y sit in the [int]s before [sel 1]
# fires; [t b b] then bangs y (cold pack inlet) and x (hot) -> "mdown x y" -> js.
MY = 200 + (NUM // 4) * 210 + 50
box("obj-ms-cmt", "comment", 20, MY - 22, 700, 20,
    numinlets=1, numoutlets=0,
    text="re-click finder: global mouse-down -> js compares with where the selected knob was last clicked -> flashes it again")
msg("obj-ms-init", 20, MY, 90, "mode 0, poll")
obj("obj-ms", 20, MY + 28, 80, "mousestate", 1, 5, ["int", "int", "int", "int", "int"])
obj("obj-ms-sel", 20, MY + 56, 45, "sel 1", 2, 2, ["bang", ""])
obj("obj-ms-t", 20, MY + 84, 45, "t b b", 1, 2, ["bang", "bang"])
obj("obj-ms-x", 20, MY + 112, 40, "int", 2, 1, ["int"])
obj("obj-ms-y", 80, MY + 112, 40, "int", 2, 1, ["int"])
obj("obj-ms-pack", 20, MY + 140, 60, "pack 0 0", 2, 1, [""])
obj("obj-ms-pre", 20, MY + 168, 100, "prepend mdown", 1, 1)
wire("obj-11", 0, "obj-ms-init", 0)      # start polling once the device is up
wire("obj-ms-init", 0, "obj-ms", 0)
wire("obj-ms", 0, "obj-ms-sel", 0)       # button state (poll mode: on change)
wire("obj-ms", 1, "obj-ms-x", 1)         # x -> stored, cold
wire("obj-ms", 2, "obj-ms-y", 1)         # y -> stored, cold
wire("obj-ms-sel", 0, "obj-ms-t", 0)
wire("obj-ms-t", 1, "obj-ms-y", 0)       # right first: y -> pack's cold inlet
wire("obj-ms-t", 0, "obj-ms-x", 0)       # then x -> pack's hot inlet -> list out
wire("obj-ms-x", 0, "obj-ms-pack", 0)
wire("obj-ms-y", 0, "obj-ms-pack", 1)
wire("obj-ms-pack", 0, "obj-ms-pre", 0)
wire("obj-ms-pre", 0, "obj-7", 0)

# debug tap (the route's unmatched outlet)
obj("obj-8", 620, 110, 90, "print bridge", 1, 0, [])
wire("obj-6", 3, "obj-8", 0)

# voice fan-out
route_args = " ".join(str(i) for i in range(1, NUM + 1))
obj("obj-9", 20, 150, 620, "route " + route_args, 1, NUM + 1)
wire("obj-6", 0, "obj-9", 0)

# ── NUM inline voices, literal buffer names, 4 columns ──
for i in range(1, NUM + 1):
    col = (i - 1) % 4
    row = (i - 1) // 4
    x = 20 + col * 235
    y = 200 + row * 210
    buf = "sb_buf_%d" % i

    vroute  = "v%d-route" % i
    vprep   = "v%d-prep" % i
    vbuf    = "v%d-buf" % i
    vphasor = "v%d-phasor" % i
    vrate   = "v%d-rate" % i
    vwave   = "v%d-wave" % i
    vremote = "v%d-remote" % i
    vbind   = "v%d-bind" % i
    vunbind = "v%d-unbind" % i

    obj(vroute, x, y, 175, "route replace rate bind unbind bindq", 6, 6, ["", "", "", "", "", ""])
    obj(vprep, x, y + 28, 100, "prepend replace", 1, 1)
    obj(vbuf, x, y + 56, 150, "buffer~ %s 4000 1" % buf, 1, 2, ["float", "bang"])
    obj(vphasor, x, y + 84, 115, "phasor~ 1n @lock 1", 2, 1, ["signal"])
    obj(vrate, x, y + 112, 120, "rate~ 4. @sync lock", 2, 1, ["signal"])
    obj(vwave, x, y + 140, 110, "wave~ %s" % buf, 3, 1, ["signal"])
    msg(vbind, x + 130, y + 112, 55, "id $1")
    msg(vunbind, x + 130, y + 140, 40, "id 0")
    obj(vremote, x, y + 168, 85, "live.remote~", 2, 1)

    # quantized/menu path: live.remote~ cannot drive enums, so a stepped setter
    # samples the SAME transport-locked wave~ and writes the option index through
    # live.object. [change] means only real STEP transitions fire (each one lands
    # in Live's undo history - inherent to LOM sets, documented).
    vsnap   = "v%d-snap" % i
    vchange = "v%d-change" % i
    vgate   = "v%d-qgate" % i
    vsetm   = "v%d-set" % i
    vlobj   = "v%d-lobj" % i
    vbindq  = "v%d-bindq" % i
    vqon    = "v%d-qon" % i
    vqoff   = "v%d-qoff" % i
    vunbq   = "v%d-unbq" % i
    # 100 ms, NOT 30: this is the write rate of the live.object paths, and every write
    # there is one Live undo step + one main-thread hop. At 33 ms, three continuous
    # MIDI-effect lanes froze Live (field 2026-08-27). Must match SNAPSHOT_MS in
    # bridge-server.js; a MIDI effect reads its params per note, so 10 Hz is plenty.
    obj(vsnap, x + 200, y + 84, 90, "snapshot~ 100", 2, 1, ["float"])
    obj(vchange, x + 200, y + 112, 70, "change -1.", 1, 3, ["", "", ""])
    obj(vgate, x + 200, y + 140, 45, "gate", 2, 1)
    msg(vsetm, x + 200, y + 168, 85, "set value $1")
    obj(vlobj, x + 200, y + 196, 75, "live.object", 2, 1)
    msg(vbindq, x + 260, y + 56, 55, "id $1")
    msg(vqon, x + 320, y + 56, 30, "1")
    msg(vqoff, x + 320, y + 84, 30, "0")
    msg(vunbq, x + 260, y + 84, 40, "id 0")

    wire("obj-9", i - 1, vroute, 0)
    wire(vroute, 0, vprep, 0)
    wire(vprep, 0, vbuf, 0)
    wire(vroute, 1, vrate, 1)
    wire(vroute, 2, vbind, 0)
    wire(vroute, 3, vunbind, 0)
    wire(vphasor, 0, vrate, 0)
    wire(vrate, 0, vwave, 0)
    wire(vwave, 0, vremote, 0)
    wire(vbind, 0, vremote, 1)
    wire(vunbind, 0, vremote, 1)
    # quantized path wiring: continuous bind CLOSES the step gate, bindq OPENS it;
    # unbind releases both targets
    wire(vwave, 0, vsnap, 0)
    wire(vsnap, 0, vchange, 0)
    wire(vchange, 0, vgate, 1)
    wire(vgate, 0, vsetm, 0)
    wire(vsetm, 0, vlobj, 0)
    wire(vroute, 4, vbindq, 0)
    wire(vbindq, 0, vlobj, 1)
    wire(vroute, 4, vqon, 0)
    wire(vqon, 0, vgate, 0)
    wire(vroute, 2, vqoff, 0)
    wire(vqoff, 0, vgate, 0)
    wire(vroute, 3, vqoff, 0)
    wire(vroute, 3, vunbq, 0)
    wire(vunbq, 0, vlobj, 1)

box("obj-10", "comment", 20, 200 + (NUM // 4) * 210, 900, 33,
    numinlets=1, numoutlets=0,
    text="Save this patcher as StrideBridge.amxd (Max Audio Effect) in THIS folder so bridge-server.js, bridge_max.js, rasterizer.js, log-scaling.js and node_modules travel with it.")

# the face GROUND, appended last = drawn at the BACK (see the z-order rule above)
box("obj-face-bg", "panel", 4, 4, 90, 169,
    presentation=1, presentation_rect=[0.0, 0.0, 90.0, 169.0],
    mode=0, proportion=0.5, saved_attribute_attributes={"valueof": {}},
    bgfillcolor_type="color", bgfillcolor_color=ZINC950,
    bgfillcolor_angle=270.0, bgfillcolor_proportion=0.39, bgfillcolor_autogradient=0,
    rounded=0)

doc = {"patcher": {
    "fileversion": 1,
    "appversion": {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [40.0, 40.0, 1000.0, 520.0 + (NUM // 4) * 210.0],
    "bglocked": 0,
    "openinpresentation": 0,
    "default_fontsize": 12.0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [15.0, 15.0],
    "openinpresentation": 1,
    "boxes": boxes,
    "lines": lines,
}}

with open("StrideBridge.maxpat", "w", encoding="utf-8", newline="\n") as f:
    json.dump(doc, f, indent=1)
print("StrideBridge.maxpat: %d boxes, %d lines (voices inlined)" % (len(boxes), len(lines)))
