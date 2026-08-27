{
 "patcher": {
  "fileversion": 1,
  "appversion": {
   "major": 8,
   "minor": 6,
   "revision": 0,
   "architecture": "x64",
   "modernui": 1
  },
  "classnamespace": "box",
  "rect": [
   40.0,
   40.0,
   1000.0,
   2200.0
  ],
  "bglocked": 0,
  "openinpresentation": 1,
  "default_fontsize": 12.0,
  "default_fontname": "Arial",
  "gridonopen": 1,
  "gridsize": [
   15.0,
   15.0
  ],
  "boxes": [
   {
    "box": {
     "id": "obj-face-bg",
     "maxclass": "panel",
     "patching_rect": [
      4,
      4,
      90,
      169
     ],
     "presentation": 1,
     "presentation_rect": [
      0.0,
      0.0,
      90.0,
      169.0
     ],
     "mode": 0,
     "proportion": 0.5,
     "saved_attribute_attributes": {
      "valueof": {}
     },
     "bgfillcolor_type": "color",
     "bgfillcolor_color": [
      0.035,
      0.035,
      0.043,
      1.0
     ],
     "bgfillcolor_angle": 270.0,
     "bgfillcolor_proportion": 0.39,
     "bgfillcolor_autogradient": 0,
     "rounded": 0
    }
   },
   {
    "box": {
     "id": "obj-face-t1",
     "maxclass": "comment",
     "patching_rect": [
      100,
      4,
      84,
      24
     ],
     "presentation": 1,
     "presentation_rect": [
      3.0,
      56.0,
      84.0,
      24.0
     ],
     "fontname": "Outfit",
     "fontsize": 15.0,
     "fontface": 1,
     "textcolor": [
      0.976,
      0.451,
      0.086,
      1.0
     ],
     "textjustification": 1,
     "text": "STRIDE"
    }
   },
   {
    "box": {
     "id": "obj-face-t2",
     "maxclass": "comment",
     "patching_rect": [
      100,
      30,
      84,
      18
     ],
     "presentation": 1,
     "presentation_rect": [
      3.0,
      80.0,
      84.0,
      18.0
     ],
     "fontname": "Outfit",
     "fontsize": 9.0,
     "fontface": 1,
     "textcolor": [
      0.631,
      0.631,
      0.667,
      1.0
     ],
     "textjustification": 1,
     "text": "B R I D G E"
    }
   },
   {
    "box": {
     "id": "obj-face-rule",
     "maxclass": "panel",
     "patching_rect": [
      100,
      52,
      60,
      2
     ],
     "presentation": 1,
     "presentation_rect": [
      15.0,
      104.0,
      60.0,
      2.0
     ],
     "mode": 0,
     "rounded": 0,
     "bgfillcolor_type": "color",
     "bgfillcolor_color": [
      0.976,
      0.451,
      0.086,
      0.55
     ],
     "bgfillcolor_angle": 270.0,
     "bgfillcolor_proportion": 0.39,
     "bgfillcolor_autogradient": 0
    }
   },
   {
    "box": {
     "id": "obj-face-st",
     "maxclass": "comment",
     "patching_rect": [
      100,
      56,
      84,
      16
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "presentation": 1,
     "presentation_rect": [
      3.0,
      112.0,
      84.0,
      16.0
     ],
     "fontname": "Outfit",
     "fontsize": 9.0,
     "fontface": 1,
     "textcolor": [
      0.631,
      0.631,
      0.667,
      1.0
     ],
     "textjustification": 1,
     "text": "STANDBY"
    }
   },
   {
    "box": {
     "id": "obj-face-n",
     "maxclass": "comment",
     "patching_rect": [
      100,
      74,
      84,
      14
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "presentation": 1,
     "presentation_rect": [
      3.0,
      128.0,
      84.0,
      14.0
     ],
     "fontname": "Outfit",
     "fontsize": 8.0,
     "fontface": 0,
     "textcolor": [
      0.631,
      0.631,
      0.667,
      1.0
     ],
     "textjustification": 1,
     "text": "0 lanes"
    }
   },
   {
    "box": {
     "id": "obj-1",
     "maxclass": "comment",
     "patching_rect": [
      20,
      12,
      900,
      20
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "text": "STRIDE BRIDGE - Stride VST's output stage for Ableton's own devices. One ACTIVE instance per set, extra copies stand by (the face says which). 32 voices."
    }
   },
   {
    "box": {
     "id": "obj-2",
     "maxclass": "comment",
     "patching_rect": [
      20,
      34,
      900,
      20
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "text": "VST link = TCP :9102 (node). Curves arrive as WAVs; each voice: phasor~ @lock 1 -> rate~ -> wave~ -> live.remote~. Voices are INLINE - literal buffer names, nothing to resolve."
    }
   },
   {
    "box": {
     "id": "obj-in",
     "maxclass": "newobj",
     "patching_rect": [
      750,
      70,
      60,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "signal",
      "signal"
     ],
     "text": "plugin~"
    }
   },
   {
    "box": {
     "id": "obj-out",
     "maxclass": "newobj",
     "patching_rect": [
      750,
      110,
      65,
      22
     ],
     "numinlets": 2,
     "numoutlets": 2,
     "outlettype": [
      "",
      ""
     ],
     "text": "plugout~"
    }
   },
   {
    "box": {
     "id": "obj-thru",
     "maxclass": "comment",
     "patching_rect": [
      690,
      140,
      220,
      33
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "text": "audio passthrough - the bridge modulates params, never the track's audio"
    }
   },
   {
    "box": {
     "id": "obj-3",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      70,
      260,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      ""
     ],
     "text": "node.script bridge-server.js @autostart 1 @watch 0",
     "saved_object_attributes": {
      "autostart": 1,
      "defer": 0,
      "node_bin_path": "",
      "npm_bin_path": "",
      "watch": 0
     }
    }
   },
   {
    "box": {
     "id": "obj-6",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      110,
      200,
      22
     ],
     "numinlets": 1,
     "numoutlets": 5,
     "outlettype": [
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route voice probe status count"
    }
   },
   {
    "box": {
     "id": "obj-7",
     "maxclass": "newobj",
     "patching_rect": [
      480,
      110,
      110,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "js bridge_max.js"
    }
   },
   {
    "box": {
     "id": "obj-11",
     "maxclass": "newobj",
     "patching_rect": [
      480,
      70,
      95,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "bang",
      "",
      ""
     ],
     "text": "live.thisdevice"
    }
   },
   {
    "box": {
     "id": "obj-12",
     "maxclass": "message",
     "patching_rect": [
      590,
      70,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "init"
    }
   },
   {
    "box": {
     "id": "obj-ms-cmt",
     "maxclass": "comment",
     "patching_rect": [
      20,
      1908,
      700,
      20
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "text": "re-click finder: global mouse-down -> js compares with where the selected knob was last clicked -> flashes it again"
    }
   },
   {
    "box": {
     "id": "obj-ms-init",
     "maxclass": "message",
     "patching_rect": [
      20,
      1930,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "mode 0, poll"
    }
   },
   {
    "box": {
     "id": "obj-ms",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1958,
      80,
      22
     ],
     "numinlets": 1,
     "numoutlets": 5,
     "outlettype": [
      "int",
      "int",
      "int",
      "int",
      "int"
     ],
     "text": "mousestate"
    }
   },
   {
    "box": {
     "id": "obj-ms-sel",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1986,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      ""
     ],
     "text": "sel 1"
    }
   },
   {
    "box": {
     "id": "obj-ms-t",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      2014,
      45,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "bang",
      "bang"
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "obj-ms-x",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      2042,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "int"
     ],
     "text": "int"
    }
   },
   {
    "box": {
     "id": "obj-ms-y",
     "maxclass": "newobj",
     "patching_rect": [
      80,
      2042,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "int"
     ],
     "text": "int"
    }
   },
   {
    "box": {
     "id": "obj-ms-pack",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      2070,
      60,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "pack 0 0"
    }
   },
   {
    "box": {
     "id": "obj-ms-pre",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      2098,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend mdown"
    }
   },
   {
    "box": {
     "id": "obj-8",
     "maxclass": "newobj",
     "patching_rect": [
      620,
      110,
      90,
      22
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "outlettype": [],
     "text": "print bridge"
    }
   },
   {
    "box": {
     "id": "obj-9",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      150,
      620,
      22
     ],
     "numinlets": 1,
     "numoutlets": 33,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32"
    }
   },
   {
    "box": {
     "id": "v1-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      200,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v1-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      228,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v1-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      256,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_1 4000 1"
    }
   },
   {
    "box": {
     "id": "v1-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      284,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v1-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      312,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v1-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      340,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_1"
    }
   },
   {
    "box": {
     "id": "v1-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      312,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v1-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      340,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v1-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v1-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      284,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v1-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      312,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v1-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      340,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v1-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v1-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      396,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v1-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      256,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v1-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      256,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v1-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      284,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v1-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      284,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v2-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      200,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v2-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      228,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v2-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      256,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_2 4000 1"
    }
   },
   {
    "box": {
     "id": "v2-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      284,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v2-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      312,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v2-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      340,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_2"
    }
   },
   {
    "box": {
     "id": "v2-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      312,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v2-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      340,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v2-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v2-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      284,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v2-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      312,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v2-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      340,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v2-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v2-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      396,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v2-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      256,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v2-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      256,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v2-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      284,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v2-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      284,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v3-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      200,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v3-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      228,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v3-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      256,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_3 4000 1"
    }
   },
   {
    "box": {
     "id": "v3-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      284,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v3-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      312,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v3-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      340,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_3"
    }
   },
   {
    "box": {
     "id": "v3-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      312,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v3-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      340,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v3-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v3-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      284,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v3-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      312,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v3-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      340,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v3-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v3-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      396,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v3-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      256,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v3-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      256,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v3-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      284,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v3-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      284,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v4-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      200,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v4-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      228,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v4-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      256,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_4 4000 1"
    }
   },
   {
    "box": {
     "id": "v4-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      284,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v4-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      312,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v4-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      340,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_4"
    }
   },
   {
    "box": {
     "id": "v4-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      312,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v4-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      340,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v4-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v4-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      284,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v4-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      312,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v4-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      340,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v4-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      368,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v4-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      396,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v4-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      256,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v4-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      256,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v4-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      284,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v4-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      284,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v5-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      410,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v5-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      438,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v5-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      466,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_5 4000 1"
    }
   },
   {
    "box": {
     "id": "v5-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      494,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v5-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      522,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v5-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      550,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_5"
    }
   },
   {
    "box": {
     "id": "v5-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      522,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v5-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      550,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v5-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v5-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      494,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v5-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      522,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v5-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      550,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v5-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v5-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      606,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v5-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      466,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v5-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      466,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v5-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      494,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v5-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      494,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v6-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      410,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v6-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      438,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v6-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      466,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_6 4000 1"
    }
   },
   {
    "box": {
     "id": "v6-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      494,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v6-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      522,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v6-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      550,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_6"
    }
   },
   {
    "box": {
     "id": "v6-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      522,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v6-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      550,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v6-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v6-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      494,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v6-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      522,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v6-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      550,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v6-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v6-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      606,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v6-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      466,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v6-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      466,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v6-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      494,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v6-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      494,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v7-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      410,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v7-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      438,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v7-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      466,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_7 4000 1"
    }
   },
   {
    "box": {
     "id": "v7-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      494,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v7-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      522,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v7-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      550,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_7"
    }
   },
   {
    "box": {
     "id": "v7-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      522,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v7-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      550,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v7-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v7-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      494,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v7-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      522,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v7-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      550,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v7-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v7-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      606,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v7-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      466,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v7-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      466,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v7-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      494,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v7-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      494,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v8-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      410,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v8-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      438,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v8-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      466,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_8 4000 1"
    }
   },
   {
    "box": {
     "id": "v8-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      494,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v8-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      522,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v8-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      550,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_8"
    }
   },
   {
    "box": {
     "id": "v8-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      522,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v8-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      550,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v8-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v8-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      494,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v8-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      522,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v8-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      550,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v8-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      578,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v8-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      606,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v8-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      466,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v8-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      466,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v8-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      494,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v8-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      494,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v9-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      620,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v9-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      648,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v9-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      676,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_9 4000 1"
    }
   },
   {
    "box": {
     "id": "v9-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      704,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v9-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      732,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v9-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      760,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_9"
    }
   },
   {
    "box": {
     "id": "v9-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      732,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v9-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      760,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v9-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v9-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      704,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v9-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      732,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v9-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      760,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v9-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v9-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      816,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v9-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      676,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v9-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      676,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v9-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      704,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v9-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      704,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v10-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      620,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v10-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      648,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v10-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      676,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_10 4000 1"
    }
   },
   {
    "box": {
     "id": "v10-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      704,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v10-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      732,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v10-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      760,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_10"
    }
   },
   {
    "box": {
     "id": "v10-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      732,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v10-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      760,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v10-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v10-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      704,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v10-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      732,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v10-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      760,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v10-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v10-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      816,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v10-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      676,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v10-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      676,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v10-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      704,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v10-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      704,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v11-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      620,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v11-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      648,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v11-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      676,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_11 4000 1"
    }
   },
   {
    "box": {
     "id": "v11-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      704,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v11-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      732,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v11-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      760,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_11"
    }
   },
   {
    "box": {
     "id": "v11-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      732,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v11-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      760,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v11-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v11-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      704,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v11-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      732,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v11-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      760,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v11-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v11-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      816,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v11-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      676,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v11-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      676,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v11-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      704,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v11-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      704,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v12-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      620,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v12-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      648,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v12-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      676,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_12 4000 1"
    }
   },
   {
    "box": {
     "id": "v12-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      704,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v12-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      732,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v12-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      760,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_12"
    }
   },
   {
    "box": {
     "id": "v12-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      732,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v12-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      760,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v12-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v12-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      704,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v12-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      732,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v12-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      760,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v12-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      788,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v12-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      816,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v12-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      676,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v12-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      676,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v12-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      704,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v12-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      704,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v13-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      830,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v13-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      858,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v13-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      886,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_13 4000 1"
    }
   },
   {
    "box": {
     "id": "v13-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      914,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v13-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      942,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v13-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      970,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_13"
    }
   },
   {
    "box": {
     "id": "v13-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      942,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v13-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      970,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v13-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v13-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      914,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v13-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      942,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v13-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      970,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v13-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v13-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1026,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v13-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      886,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v13-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      886,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v13-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      914,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v13-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      914,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v14-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      830,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v14-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      858,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v14-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      886,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_14 4000 1"
    }
   },
   {
    "box": {
     "id": "v14-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      914,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v14-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      942,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v14-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      970,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_14"
    }
   },
   {
    "box": {
     "id": "v14-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      942,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v14-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      970,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v14-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v14-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      914,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v14-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      942,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v14-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      970,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v14-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v14-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1026,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v14-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      886,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v14-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      886,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v14-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      914,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v14-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      914,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v15-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      830,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v15-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      858,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v15-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      886,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_15 4000 1"
    }
   },
   {
    "box": {
     "id": "v15-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      914,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v15-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      942,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v15-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      970,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_15"
    }
   },
   {
    "box": {
     "id": "v15-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      942,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v15-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      970,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v15-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v15-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      914,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v15-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      942,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v15-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      970,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v15-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v15-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1026,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v15-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      886,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v15-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      886,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v15-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      914,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v15-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      914,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v16-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      830,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v16-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      858,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v16-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      886,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_16 4000 1"
    }
   },
   {
    "box": {
     "id": "v16-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      914,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v16-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      942,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v16-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      970,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_16"
    }
   },
   {
    "box": {
     "id": "v16-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      942,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v16-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      970,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v16-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v16-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      914,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v16-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      942,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v16-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      970,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v16-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      998,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v16-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1026,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v16-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      886,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v16-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      886,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v16-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      914,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v16-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      914,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v17-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1040,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v17-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1068,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v17-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1096,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_17 4000 1"
    }
   },
   {
    "box": {
     "id": "v17-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1124,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v17-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1152,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v17-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1180,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_17"
    }
   },
   {
    "box": {
     "id": "v17-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1152,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v17-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1180,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v17-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v17-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1124,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v17-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1152,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v17-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1180,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v17-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v17-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1236,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v17-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1096,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v17-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      1096,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v17-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      1124,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v17-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1124,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v18-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1040,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v18-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1068,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v18-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1096,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_18 4000 1"
    }
   },
   {
    "box": {
     "id": "v18-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1124,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v18-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1152,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v18-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1180,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_18"
    }
   },
   {
    "box": {
     "id": "v18-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1152,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v18-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1180,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v18-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v18-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1124,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v18-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1152,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v18-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1180,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v18-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v18-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1236,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v18-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1096,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v18-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      1096,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v18-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      1124,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v18-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1124,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v19-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1040,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v19-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1068,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v19-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1096,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_19 4000 1"
    }
   },
   {
    "box": {
     "id": "v19-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1124,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v19-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1152,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v19-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1180,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_19"
    }
   },
   {
    "box": {
     "id": "v19-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1152,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v19-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1180,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v19-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v19-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1124,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v19-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1152,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v19-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1180,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v19-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v19-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1236,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v19-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1096,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v19-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      1096,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v19-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      1124,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v19-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1124,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v20-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1040,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v20-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1068,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v20-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1096,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_20 4000 1"
    }
   },
   {
    "box": {
     "id": "v20-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1124,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v20-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1152,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v20-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1180,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_20"
    }
   },
   {
    "box": {
     "id": "v20-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1152,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v20-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1180,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v20-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v20-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1124,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v20-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1152,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v20-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1180,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v20-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      1208,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v20-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1236,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v20-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1096,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v20-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1096,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v20-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1124,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v20-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1124,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v21-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1250,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v21-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1278,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v21-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1306,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_21 4000 1"
    }
   },
   {
    "box": {
     "id": "v21-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1334,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v21-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1362,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v21-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1390,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_21"
    }
   },
   {
    "box": {
     "id": "v21-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1362,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v21-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1390,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v21-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v21-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1334,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v21-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1362,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v21-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1390,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v21-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v21-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1446,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v21-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1306,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v21-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      1306,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v21-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      1334,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v21-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1334,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v22-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1250,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v22-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1278,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v22-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1306,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_22 4000 1"
    }
   },
   {
    "box": {
     "id": "v22-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1334,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v22-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1362,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v22-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1390,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_22"
    }
   },
   {
    "box": {
     "id": "v22-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1362,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v22-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1390,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v22-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v22-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1334,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v22-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1362,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v22-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1390,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v22-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v22-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1446,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v22-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1306,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v22-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      1306,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v22-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      1334,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v22-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1334,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v23-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1250,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v23-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1278,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v23-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1306,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_23 4000 1"
    }
   },
   {
    "box": {
     "id": "v23-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1334,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v23-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1362,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v23-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1390,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_23"
    }
   },
   {
    "box": {
     "id": "v23-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1362,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v23-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1390,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v23-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v23-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1334,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v23-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1362,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v23-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1390,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v23-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v23-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1446,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v23-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1306,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v23-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      1306,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v23-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      1334,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v23-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1334,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v24-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1250,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v24-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1278,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v24-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1306,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_24 4000 1"
    }
   },
   {
    "box": {
     "id": "v24-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1334,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v24-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1362,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v24-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1390,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_24"
    }
   },
   {
    "box": {
     "id": "v24-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1362,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v24-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1390,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v24-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v24-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1334,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v24-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1362,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v24-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1390,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v24-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      1418,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v24-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1446,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v24-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1306,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v24-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1306,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v24-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1334,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v24-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1334,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v25-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1460,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v25-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1488,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v25-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1516,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_25 4000 1"
    }
   },
   {
    "box": {
     "id": "v25-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1544,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v25-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1572,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v25-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1600,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_25"
    }
   },
   {
    "box": {
     "id": "v25-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1572,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v25-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1600,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v25-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v25-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1544,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v25-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1572,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v25-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1600,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v25-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v25-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1656,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v25-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1516,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v25-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      1516,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v25-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      1544,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v25-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1544,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v26-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1460,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v26-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1488,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v26-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1516,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_26 4000 1"
    }
   },
   {
    "box": {
     "id": "v26-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1544,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v26-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1572,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v26-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1600,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_26"
    }
   },
   {
    "box": {
     "id": "v26-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1572,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v26-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1600,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v26-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v26-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1544,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v26-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1572,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v26-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1600,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v26-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v26-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1656,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v26-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1516,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v26-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      1516,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v26-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      1544,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v26-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1544,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v27-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1460,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v27-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1488,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v27-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1516,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_27 4000 1"
    }
   },
   {
    "box": {
     "id": "v27-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1544,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v27-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1572,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v27-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1600,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_27"
    }
   },
   {
    "box": {
     "id": "v27-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1572,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v27-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1600,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v27-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v27-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1544,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v27-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1572,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v27-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1600,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v27-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v27-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1656,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v27-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1516,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v27-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      1516,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v27-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      1544,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v27-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1544,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v28-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1460,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v28-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1488,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v28-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1516,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_28 4000 1"
    }
   },
   {
    "box": {
     "id": "v28-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1544,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v28-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1572,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v28-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1600,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_28"
    }
   },
   {
    "box": {
     "id": "v28-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1572,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v28-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1600,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v28-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v28-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1544,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v28-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1572,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v28-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1600,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v28-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      1628,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v28-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1656,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v28-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1516,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v28-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1516,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v28-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1544,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v28-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1544,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v29-route",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1670,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v29-prep",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1698,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v29-buf",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1726,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_29 4000 1"
    }
   },
   {
    "box": {
     "id": "v29-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1754,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v29-rate",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1782,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v29-wave",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1810,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_29"
    }
   },
   {
    "box": {
     "id": "v29-bind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1782,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v29-unbind",
     "maxclass": "message",
     "patching_rect": [
      150,
      1810,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v29-remote",
     "maxclass": "newobj",
     "patching_rect": [
      20,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v29-snap",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1754,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v29-change",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1782,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v29-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1810,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v29-set",
     "maxclass": "message",
     "patching_rect": [
      220,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v29-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      220,
      1866,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v29-bindq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1726,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v29-qon",
     "maxclass": "message",
     "patching_rect": [
      340,
      1726,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v29-qoff",
     "maxclass": "message",
     "patching_rect": [
      340,
      1754,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v29-unbq",
     "maxclass": "message",
     "patching_rect": [
      280,
      1754,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v30-route",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1670,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v30-prep",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1698,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v30-buf",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1726,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_30 4000 1"
    }
   },
   {
    "box": {
     "id": "v30-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1754,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v30-rate",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1782,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v30-wave",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1810,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_30"
    }
   },
   {
    "box": {
     "id": "v30-bind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1782,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v30-unbind",
     "maxclass": "message",
     "patching_rect": [
      385,
      1810,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v30-remote",
     "maxclass": "newobj",
     "patching_rect": [
      255,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v30-snap",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1754,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v30-change",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1782,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v30-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1810,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v30-set",
     "maxclass": "message",
     "patching_rect": [
      455,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v30-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      455,
      1866,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v30-bindq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1726,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v30-qon",
     "maxclass": "message",
     "patching_rect": [
      575,
      1726,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v30-qoff",
     "maxclass": "message",
     "patching_rect": [
      575,
      1754,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v30-unbq",
     "maxclass": "message",
     "patching_rect": [
      515,
      1754,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v31-route",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1670,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v31-prep",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1698,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v31-buf",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1726,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_31 4000 1"
    }
   },
   {
    "box": {
     "id": "v31-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1754,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v31-rate",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1782,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v31-wave",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1810,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_31"
    }
   },
   {
    "box": {
     "id": "v31-bind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1782,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v31-unbind",
     "maxclass": "message",
     "patching_rect": [
      620,
      1810,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v31-remote",
     "maxclass": "newobj",
     "patching_rect": [
      490,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v31-snap",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1754,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v31-change",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1782,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v31-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1810,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v31-set",
     "maxclass": "message",
     "patching_rect": [
      690,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v31-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      690,
      1866,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v31-bindq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1726,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v31-qon",
     "maxclass": "message",
     "patching_rect": [
      810,
      1726,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v31-qoff",
     "maxclass": "message",
     "patching_rect": [
      810,
      1754,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v31-unbq",
     "maxclass": "message",
     "patching_rect": [
      750,
      1754,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v32-route",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1670,
      175,
      22
     ],
     "numinlets": 6,
     "numoutlets": 6,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route replace rate bind unbind bindq"
    }
   },
   {
    "box": {
     "id": "v32-prep",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1698,
      100,
      22
     ],
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "prepend replace"
    }
   },
   {
    "box": {
     "id": "v32-buf",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1726,
      150,
      22
     ],
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "float",
      "bang"
     ],
     "text": "buffer~ sb_buf_32 4000 1"
    }
   },
   {
    "box": {
     "id": "v32-phasor",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1754,
      115,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "phasor~ 1n @lock 1"
    }
   },
   {
    "box": {
     "id": "v32-rate",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1782,
      120,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "rate~ 4. @sync lock"
    }
   },
   {
    "box": {
     "id": "v32-wave",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1810,
      110,
      22
     ],
     "numinlets": 3,
     "numoutlets": 1,
     "outlettype": [
      "signal"
     ],
     "text": "wave~ sb_buf_32"
    }
   },
   {
    "box": {
     "id": "v32-bind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1782,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v32-unbind",
     "maxclass": "message",
     "patching_rect": [
      855,
      1810,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "v32-remote",
     "maxclass": "newobj",
     "patching_rect": [
      725,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.remote~"
    }
   },
   {
    "box": {
     "id": "v32-snap",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1754,
      90,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "float"
     ],
     "text": "snapshot~ 30"
    }
   },
   {
    "box": {
     "id": "v32-change",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1782,
      70,
      22
     ],
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "change -1."
    }
   },
   {
    "box": {
     "id": "v32-qgate",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1810,
      45,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "gate"
    }
   },
   {
    "box": {
     "id": "v32-set",
     "maxclass": "message",
     "patching_rect": [
      925,
      1838,
      85,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "set value $1"
    }
   },
   {
    "box": {
     "id": "v32-lobj",
     "maxclass": "newobj",
     "patching_rect": [
      925,
      1866,
      75,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "live.object"
    }
   },
   {
    "box": {
     "id": "v32-bindq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1726,
      55,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id $1"
    }
   },
   {
    "box": {
     "id": "v32-qon",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1726,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "1"
    }
   },
   {
    "box": {
     "id": "v32-qoff",
     "maxclass": "message",
     "patching_rect": [
      1045,
      1754,
      30,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "0"
    }
   },
   {
    "box": {
     "id": "v32-unbq",
     "maxclass": "message",
     "patching_rect": [
      985,
      1754,
      40,
      22
     ],
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "text": "id 0"
    }
   },
   {
    "box": {
     "id": "obj-10",
     "maxclass": "comment",
     "patching_rect": [
      20,
      1880,
      900,
      33
     ],
     "numinlets": 1,
     "numoutlets": 0,
     "text": "Save this patcher as StrideBridge.amxd (Max Audio Effect) in THIS folder so bridge-server.js, bridge_max.js, rasterizer.js, log-scaling.js and node_modules travel with it."
    }
   }
  ],
  "lines": [
   {
    "patchline": {
     "source": [
      "obj-in",
      0
     ],
     "destination": [
      "obj-out",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-in",
      1
     ],
     "destination": [
      "obj-out",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-3",
      0
     ],
     "destination": [
      "obj-6",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      2
     ],
     "destination": [
      "obj-face-st",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      3
     ],
     "destination": [
      "obj-face-n",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-11",
      0
     ],
     "destination": [
      "obj-12",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-12",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      1
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-7",
      0
     ],
     "destination": [
      "obj-3",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-11",
      0
     ],
     "destination": [
      "obj-ms-init",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-init",
      0
     ],
     "destination": [
      "obj-ms",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms",
      0
     ],
     "destination": [
      "obj-ms-sel",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms",
      1
     ],
     "destination": [
      "obj-ms-x",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms",
      2
     ],
     "destination": [
      "obj-ms-y",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-sel",
      0
     ],
     "destination": [
      "obj-ms-t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-t",
      1
     ],
     "destination": [
      "obj-ms-y",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-t",
      0
     ],
     "destination": [
      "obj-ms-x",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-x",
      0
     ],
     "destination": [
      "obj-ms-pack",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-y",
      0
     ],
     "destination": [
      "obj-ms-pack",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-pack",
      0
     ],
     "destination": [
      "obj-ms-pre",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-ms-pre",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      4
     ],
     "destination": [
      "obj-8",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      0
     ],
     "destination": [
      "obj-9",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      0
     ],
     "destination": [
      "v1-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      0
     ],
     "destination": [
      "v1-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-prep",
      0
     ],
     "destination": [
      "v1-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      1
     ],
     "destination": [
      "v1-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      2
     ],
     "destination": [
      "v1-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      3
     ],
     "destination": [
      "v1-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-phasor",
      0
     ],
     "destination": [
      "v1-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-rate",
      0
     ],
     "destination": [
      "v1-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-wave",
      0
     ],
     "destination": [
      "v1-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-bind",
      0
     ],
     "destination": [
      "v1-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-unbind",
      0
     ],
     "destination": [
      "v1-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-wave",
      0
     ],
     "destination": [
      "v1-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-snap",
      0
     ],
     "destination": [
      "v1-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-change",
      0
     ],
     "destination": [
      "v1-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-qgate",
      0
     ],
     "destination": [
      "v1-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-set",
      0
     ],
     "destination": [
      "v1-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      4
     ],
     "destination": [
      "v1-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-bindq",
      0
     ],
     "destination": [
      "v1-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      4
     ],
     "destination": [
      "v1-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-qon",
      0
     ],
     "destination": [
      "v1-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      2
     ],
     "destination": [
      "v1-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-qoff",
      0
     ],
     "destination": [
      "v1-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      3
     ],
     "destination": [
      "v1-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-route",
      3
     ],
     "destination": [
      "v1-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v1-unbq",
      0
     ],
     "destination": [
      "v1-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      1
     ],
     "destination": [
      "v2-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      0
     ],
     "destination": [
      "v2-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-prep",
      0
     ],
     "destination": [
      "v2-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      1
     ],
     "destination": [
      "v2-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      2
     ],
     "destination": [
      "v2-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      3
     ],
     "destination": [
      "v2-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-phasor",
      0
     ],
     "destination": [
      "v2-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-rate",
      0
     ],
     "destination": [
      "v2-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-wave",
      0
     ],
     "destination": [
      "v2-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-bind",
      0
     ],
     "destination": [
      "v2-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-unbind",
      0
     ],
     "destination": [
      "v2-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-wave",
      0
     ],
     "destination": [
      "v2-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-snap",
      0
     ],
     "destination": [
      "v2-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-change",
      0
     ],
     "destination": [
      "v2-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-qgate",
      0
     ],
     "destination": [
      "v2-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-set",
      0
     ],
     "destination": [
      "v2-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      4
     ],
     "destination": [
      "v2-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-bindq",
      0
     ],
     "destination": [
      "v2-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      4
     ],
     "destination": [
      "v2-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-qon",
      0
     ],
     "destination": [
      "v2-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      2
     ],
     "destination": [
      "v2-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-qoff",
      0
     ],
     "destination": [
      "v2-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      3
     ],
     "destination": [
      "v2-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-route",
      3
     ],
     "destination": [
      "v2-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v2-unbq",
      0
     ],
     "destination": [
      "v2-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      2
     ],
     "destination": [
      "v3-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      0
     ],
     "destination": [
      "v3-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-prep",
      0
     ],
     "destination": [
      "v3-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      1
     ],
     "destination": [
      "v3-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      2
     ],
     "destination": [
      "v3-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      3
     ],
     "destination": [
      "v3-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-phasor",
      0
     ],
     "destination": [
      "v3-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-rate",
      0
     ],
     "destination": [
      "v3-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-wave",
      0
     ],
     "destination": [
      "v3-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-bind",
      0
     ],
     "destination": [
      "v3-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-unbind",
      0
     ],
     "destination": [
      "v3-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-wave",
      0
     ],
     "destination": [
      "v3-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-snap",
      0
     ],
     "destination": [
      "v3-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-change",
      0
     ],
     "destination": [
      "v3-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-qgate",
      0
     ],
     "destination": [
      "v3-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-set",
      0
     ],
     "destination": [
      "v3-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      4
     ],
     "destination": [
      "v3-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-bindq",
      0
     ],
     "destination": [
      "v3-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      4
     ],
     "destination": [
      "v3-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-qon",
      0
     ],
     "destination": [
      "v3-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      2
     ],
     "destination": [
      "v3-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-qoff",
      0
     ],
     "destination": [
      "v3-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      3
     ],
     "destination": [
      "v3-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-route",
      3
     ],
     "destination": [
      "v3-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v3-unbq",
      0
     ],
     "destination": [
      "v3-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      3
     ],
     "destination": [
      "v4-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      0
     ],
     "destination": [
      "v4-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-prep",
      0
     ],
     "destination": [
      "v4-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      1
     ],
     "destination": [
      "v4-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      2
     ],
     "destination": [
      "v4-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      3
     ],
     "destination": [
      "v4-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-phasor",
      0
     ],
     "destination": [
      "v4-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-rate",
      0
     ],
     "destination": [
      "v4-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-wave",
      0
     ],
     "destination": [
      "v4-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-bind",
      0
     ],
     "destination": [
      "v4-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-unbind",
      0
     ],
     "destination": [
      "v4-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-wave",
      0
     ],
     "destination": [
      "v4-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-snap",
      0
     ],
     "destination": [
      "v4-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-change",
      0
     ],
     "destination": [
      "v4-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-qgate",
      0
     ],
     "destination": [
      "v4-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-set",
      0
     ],
     "destination": [
      "v4-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      4
     ],
     "destination": [
      "v4-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-bindq",
      0
     ],
     "destination": [
      "v4-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      4
     ],
     "destination": [
      "v4-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-qon",
      0
     ],
     "destination": [
      "v4-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      2
     ],
     "destination": [
      "v4-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-qoff",
      0
     ],
     "destination": [
      "v4-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      3
     ],
     "destination": [
      "v4-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-route",
      3
     ],
     "destination": [
      "v4-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v4-unbq",
      0
     ],
     "destination": [
      "v4-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      4
     ],
     "destination": [
      "v5-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      0
     ],
     "destination": [
      "v5-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-prep",
      0
     ],
     "destination": [
      "v5-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      1
     ],
     "destination": [
      "v5-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      2
     ],
     "destination": [
      "v5-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      3
     ],
     "destination": [
      "v5-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-phasor",
      0
     ],
     "destination": [
      "v5-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-rate",
      0
     ],
     "destination": [
      "v5-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-wave",
      0
     ],
     "destination": [
      "v5-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-bind",
      0
     ],
     "destination": [
      "v5-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-unbind",
      0
     ],
     "destination": [
      "v5-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-wave",
      0
     ],
     "destination": [
      "v5-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-snap",
      0
     ],
     "destination": [
      "v5-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-change",
      0
     ],
     "destination": [
      "v5-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-qgate",
      0
     ],
     "destination": [
      "v5-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-set",
      0
     ],
     "destination": [
      "v5-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      4
     ],
     "destination": [
      "v5-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-bindq",
      0
     ],
     "destination": [
      "v5-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      4
     ],
     "destination": [
      "v5-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-qon",
      0
     ],
     "destination": [
      "v5-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      2
     ],
     "destination": [
      "v5-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-qoff",
      0
     ],
     "destination": [
      "v5-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      3
     ],
     "destination": [
      "v5-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-route",
      3
     ],
     "destination": [
      "v5-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v5-unbq",
      0
     ],
     "destination": [
      "v5-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      5
     ],
     "destination": [
      "v6-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      0
     ],
     "destination": [
      "v6-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-prep",
      0
     ],
     "destination": [
      "v6-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      1
     ],
     "destination": [
      "v6-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      2
     ],
     "destination": [
      "v6-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      3
     ],
     "destination": [
      "v6-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-phasor",
      0
     ],
     "destination": [
      "v6-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-rate",
      0
     ],
     "destination": [
      "v6-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-wave",
      0
     ],
     "destination": [
      "v6-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-bind",
      0
     ],
     "destination": [
      "v6-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-unbind",
      0
     ],
     "destination": [
      "v6-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-wave",
      0
     ],
     "destination": [
      "v6-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-snap",
      0
     ],
     "destination": [
      "v6-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-change",
      0
     ],
     "destination": [
      "v6-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-qgate",
      0
     ],
     "destination": [
      "v6-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-set",
      0
     ],
     "destination": [
      "v6-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      4
     ],
     "destination": [
      "v6-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-bindq",
      0
     ],
     "destination": [
      "v6-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      4
     ],
     "destination": [
      "v6-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-qon",
      0
     ],
     "destination": [
      "v6-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      2
     ],
     "destination": [
      "v6-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-qoff",
      0
     ],
     "destination": [
      "v6-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      3
     ],
     "destination": [
      "v6-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-route",
      3
     ],
     "destination": [
      "v6-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v6-unbq",
      0
     ],
     "destination": [
      "v6-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      6
     ],
     "destination": [
      "v7-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      0
     ],
     "destination": [
      "v7-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-prep",
      0
     ],
     "destination": [
      "v7-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      1
     ],
     "destination": [
      "v7-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      2
     ],
     "destination": [
      "v7-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      3
     ],
     "destination": [
      "v7-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-phasor",
      0
     ],
     "destination": [
      "v7-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-rate",
      0
     ],
     "destination": [
      "v7-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-wave",
      0
     ],
     "destination": [
      "v7-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-bind",
      0
     ],
     "destination": [
      "v7-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-unbind",
      0
     ],
     "destination": [
      "v7-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-wave",
      0
     ],
     "destination": [
      "v7-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-snap",
      0
     ],
     "destination": [
      "v7-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-change",
      0
     ],
     "destination": [
      "v7-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-qgate",
      0
     ],
     "destination": [
      "v7-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-set",
      0
     ],
     "destination": [
      "v7-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      4
     ],
     "destination": [
      "v7-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-bindq",
      0
     ],
     "destination": [
      "v7-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      4
     ],
     "destination": [
      "v7-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-qon",
      0
     ],
     "destination": [
      "v7-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      2
     ],
     "destination": [
      "v7-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-qoff",
      0
     ],
     "destination": [
      "v7-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      3
     ],
     "destination": [
      "v7-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-route",
      3
     ],
     "destination": [
      "v7-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v7-unbq",
      0
     ],
     "destination": [
      "v7-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      7
     ],
     "destination": [
      "v8-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      0
     ],
     "destination": [
      "v8-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-prep",
      0
     ],
     "destination": [
      "v8-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      1
     ],
     "destination": [
      "v8-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      2
     ],
     "destination": [
      "v8-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      3
     ],
     "destination": [
      "v8-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-phasor",
      0
     ],
     "destination": [
      "v8-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-rate",
      0
     ],
     "destination": [
      "v8-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-wave",
      0
     ],
     "destination": [
      "v8-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-bind",
      0
     ],
     "destination": [
      "v8-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-unbind",
      0
     ],
     "destination": [
      "v8-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-wave",
      0
     ],
     "destination": [
      "v8-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-snap",
      0
     ],
     "destination": [
      "v8-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-change",
      0
     ],
     "destination": [
      "v8-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-qgate",
      0
     ],
     "destination": [
      "v8-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-set",
      0
     ],
     "destination": [
      "v8-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      4
     ],
     "destination": [
      "v8-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-bindq",
      0
     ],
     "destination": [
      "v8-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      4
     ],
     "destination": [
      "v8-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-qon",
      0
     ],
     "destination": [
      "v8-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      2
     ],
     "destination": [
      "v8-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-qoff",
      0
     ],
     "destination": [
      "v8-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      3
     ],
     "destination": [
      "v8-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-route",
      3
     ],
     "destination": [
      "v8-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v8-unbq",
      0
     ],
     "destination": [
      "v8-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      8
     ],
     "destination": [
      "v9-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      0
     ],
     "destination": [
      "v9-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-prep",
      0
     ],
     "destination": [
      "v9-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      1
     ],
     "destination": [
      "v9-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      2
     ],
     "destination": [
      "v9-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      3
     ],
     "destination": [
      "v9-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-phasor",
      0
     ],
     "destination": [
      "v9-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-rate",
      0
     ],
     "destination": [
      "v9-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-wave",
      0
     ],
     "destination": [
      "v9-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-bind",
      0
     ],
     "destination": [
      "v9-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-unbind",
      0
     ],
     "destination": [
      "v9-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-wave",
      0
     ],
     "destination": [
      "v9-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-snap",
      0
     ],
     "destination": [
      "v9-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-change",
      0
     ],
     "destination": [
      "v9-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-qgate",
      0
     ],
     "destination": [
      "v9-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-set",
      0
     ],
     "destination": [
      "v9-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      4
     ],
     "destination": [
      "v9-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-bindq",
      0
     ],
     "destination": [
      "v9-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      4
     ],
     "destination": [
      "v9-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-qon",
      0
     ],
     "destination": [
      "v9-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      2
     ],
     "destination": [
      "v9-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-qoff",
      0
     ],
     "destination": [
      "v9-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      3
     ],
     "destination": [
      "v9-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-route",
      3
     ],
     "destination": [
      "v9-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v9-unbq",
      0
     ],
     "destination": [
      "v9-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      9
     ],
     "destination": [
      "v10-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      0
     ],
     "destination": [
      "v10-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-prep",
      0
     ],
     "destination": [
      "v10-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      1
     ],
     "destination": [
      "v10-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      2
     ],
     "destination": [
      "v10-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      3
     ],
     "destination": [
      "v10-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-phasor",
      0
     ],
     "destination": [
      "v10-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-rate",
      0
     ],
     "destination": [
      "v10-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-wave",
      0
     ],
     "destination": [
      "v10-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-bind",
      0
     ],
     "destination": [
      "v10-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-unbind",
      0
     ],
     "destination": [
      "v10-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-wave",
      0
     ],
     "destination": [
      "v10-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-snap",
      0
     ],
     "destination": [
      "v10-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-change",
      0
     ],
     "destination": [
      "v10-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-qgate",
      0
     ],
     "destination": [
      "v10-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-set",
      0
     ],
     "destination": [
      "v10-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      4
     ],
     "destination": [
      "v10-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-bindq",
      0
     ],
     "destination": [
      "v10-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      4
     ],
     "destination": [
      "v10-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-qon",
      0
     ],
     "destination": [
      "v10-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      2
     ],
     "destination": [
      "v10-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-qoff",
      0
     ],
     "destination": [
      "v10-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      3
     ],
     "destination": [
      "v10-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-route",
      3
     ],
     "destination": [
      "v10-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v10-unbq",
      0
     ],
     "destination": [
      "v10-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      10
     ],
     "destination": [
      "v11-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      0
     ],
     "destination": [
      "v11-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-prep",
      0
     ],
     "destination": [
      "v11-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      1
     ],
     "destination": [
      "v11-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      2
     ],
     "destination": [
      "v11-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      3
     ],
     "destination": [
      "v11-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-phasor",
      0
     ],
     "destination": [
      "v11-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-rate",
      0
     ],
     "destination": [
      "v11-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-wave",
      0
     ],
     "destination": [
      "v11-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-bind",
      0
     ],
     "destination": [
      "v11-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-unbind",
      0
     ],
     "destination": [
      "v11-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-wave",
      0
     ],
     "destination": [
      "v11-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-snap",
      0
     ],
     "destination": [
      "v11-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-change",
      0
     ],
     "destination": [
      "v11-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-qgate",
      0
     ],
     "destination": [
      "v11-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-set",
      0
     ],
     "destination": [
      "v11-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      4
     ],
     "destination": [
      "v11-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-bindq",
      0
     ],
     "destination": [
      "v11-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      4
     ],
     "destination": [
      "v11-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-qon",
      0
     ],
     "destination": [
      "v11-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      2
     ],
     "destination": [
      "v11-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-qoff",
      0
     ],
     "destination": [
      "v11-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      3
     ],
     "destination": [
      "v11-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-route",
      3
     ],
     "destination": [
      "v11-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v11-unbq",
      0
     ],
     "destination": [
      "v11-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      11
     ],
     "destination": [
      "v12-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      0
     ],
     "destination": [
      "v12-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-prep",
      0
     ],
     "destination": [
      "v12-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      1
     ],
     "destination": [
      "v12-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      2
     ],
     "destination": [
      "v12-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      3
     ],
     "destination": [
      "v12-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-phasor",
      0
     ],
     "destination": [
      "v12-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-rate",
      0
     ],
     "destination": [
      "v12-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-wave",
      0
     ],
     "destination": [
      "v12-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-bind",
      0
     ],
     "destination": [
      "v12-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-unbind",
      0
     ],
     "destination": [
      "v12-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-wave",
      0
     ],
     "destination": [
      "v12-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-snap",
      0
     ],
     "destination": [
      "v12-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-change",
      0
     ],
     "destination": [
      "v12-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-qgate",
      0
     ],
     "destination": [
      "v12-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-set",
      0
     ],
     "destination": [
      "v12-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      4
     ],
     "destination": [
      "v12-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-bindq",
      0
     ],
     "destination": [
      "v12-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      4
     ],
     "destination": [
      "v12-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-qon",
      0
     ],
     "destination": [
      "v12-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      2
     ],
     "destination": [
      "v12-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-qoff",
      0
     ],
     "destination": [
      "v12-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      3
     ],
     "destination": [
      "v12-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-route",
      3
     ],
     "destination": [
      "v12-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v12-unbq",
      0
     ],
     "destination": [
      "v12-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      12
     ],
     "destination": [
      "v13-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      0
     ],
     "destination": [
      "v13-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-prep",
      0
     ],
     "destination": [
      "v13-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      1
     ],
     "destination": [
      "v13-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      2
     ],
     "destination": [
      "v13-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      3
     ],
     "destination": [
      "v13-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-phasor",
      0
     ],
     "destination": [
      "v13-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-rate",
      0
     ],
     "destination": [
      "v13-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-wave",
      0
     ],
     "destination": [
      "v13-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-bind",
      0
     ],
     "destination": [
      "v13-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-unbind",
      0
     ],
     "destination": [
      "v13-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-wave",
      0
     ],
     "destination": [
      "v13-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-snap",
      0
     ],
     "destination": [
      "v13-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-change",
      0
     ],
     "destination": [
      "v13-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-qgate",
      0
     ],
     "destination": [
      "v13-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-set",
      0
     ],
     "destination": [
      "v13-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      4
     ],
     "destination": [
      "v13-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-bindq",
      0
     ],
     "destination": [
      "v13-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      4
     ],
     "destination": [
      "v13-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-qon",
      0
     ],
     "destination": [
      "v13-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      2
     ],
     "destination": [
      "v13-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-qoff",
      0
     ],
     "destination": [
      "v13-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      3
     ],
     "destination": [
      "v13-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-route",
      3
     ],
     "destination": [
      "v13-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v13-unbq",
      0
     ],
     "destination": [
      "v13-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      13
     ],
     "destination": [
      "v14-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      0
     ],
     "destination": [
      "v14-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-prep",
      0
     ],
     "destination": [
      "v14-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      1
     ],
     "destination": [
      "v14-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      2
     ],
     "destination": [
      "v14-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      3
     ],
     "destination": [
      "v14-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-phasor",
      0
     ],
     "destination": [
      "v14-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-rate",
      0
     ],
     "destination": [
      "v14-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-wave",
      0
     ],
     "destination": [
      "v14-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-bind",
      0
     ],
     "destination": [
      "v14-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-unbind",
      0
     ],
     "destination": [
      "v14-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-wave",
      0
     ],
     "destination": [
      "v14-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-snap",
      0
     ],
     "destination": [
      "v14-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-change",
      0
     ],
     "destination": [
      "v14-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-qgate",
      0
     ],
     "destination": [
      "v14-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-set",
      0
     ],
     "destination": [
      "v14-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      4
     ],
     "destination": [
      "v14-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-bindq",
      0
     ],
     "destination": [
      "v14-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      4
     ],
     "destination": [
      "v14-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-qon",
      0
     ],
     "destination": [
      "v14-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      2
     ],
     "destination": [
      "v14-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-qoff",
      0
     ],
     "destination": [
      "v14-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      3
     ],
     "destination": [
      "v14-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-route",
      3
     ],
     "destination": [
      "v14-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v14-unbq",
      0
     ],
     "destination": [
      "v14-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      14
     ],
     "destination": [
      "v15-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      0
     ],
     "destination": [
      "v15-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-prep",
      0
     ],
     "destination": [
      "v15-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      1
     ],
     "destination": [
      "v15-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      2
     ],
     "destination": [
      "v15-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      3
     ],
     "destination": [
      "v15-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-phasor",
      0
     ],
     "destination": [
      "v15-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-rate",
      0
     ],
     "destination": [
      "v15-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-wave",
      0
     ],
     "destination": [
      "v15-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-bind",
      0
     ],
     "destination": [
      "v15-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-unbind",
      0
     ],
     "destination": [
      "v15-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-wave",
      0
     ],
     "destination": [
      "v15-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-snap",
      0
     ],
     "destination": [
      "v15-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-change",
      0
     ],
     "destination": [
      "v15-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-qgate",
      0
     ],
     "destination": [
      "v15-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-set",
      0
     ],
     "destination": [
      "v15-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      4
     ],
     "destination": [
      "v15-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-bindq",
      0
     ],
     "destination": [
      "v15-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      4
     ],
     "destination": [
      "v15-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-qon",
      0
     ],
     "destination": [
      "v15-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      2
     ],
     "destination": [
      "v15-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-qoff",
      0
     ],
     "destination": [
      "v15-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      3
     ],
     "destination": [
      "v15-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-route",
      3
     ],
     "destination": [
      "v15-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v15-unbq",
      0
     ],
     "destination": [
      "v15-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      15
     ],
     "destination": [
      "v16-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      0
     ],
     "destination": [
      "v16-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-prep",
      0
     ],
     "destination": [
      "v16-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      1
     ],
     "destination": [
      "v16-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      2
     ],
     "destination": [
      "v16-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      3
     ],
     "destination": [
      "v16-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-phasor",
      0
     ],
     "destination": [
      "v16-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-rate",
      0
     ],
     "destination": [
      "v16-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-wave",
      0
     ],
     "destination": [
      "v16-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-bind",
      0
     ],
     "destination": [
      "v16-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-unbind",
      0
     ],
     "destination": [
      "v16-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-wave",
      0
     ],
     "destination": [
      "v16-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-snap",
      0
     ],
     "destination": [
      "v16-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-change",
      0
     ],
     "destination": [
      "v16-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-qgate",
      0
     ],
     "destination": [
      "v16-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-set",
      0
     ],
     "destination": [
      "v16-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      4
     ],
     "destination": [
      "v16-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-bindq",
      0
     ],
     "destination": [
      "v16-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      4
     ],
     "destination": [
      "v16-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-qon",
      0
     ],
     "destination": [
      "v16-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      2
     ],
     "destination": [
      "v16-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-qoff",
      0
     ],
     "destination": [
      "v16-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      3
     ],
     "destination": [
      "v16-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-route",
      3
     ],
     "destination": [
      "v16-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v16-unbq",
      0
     ],
     "destination": [
      "v16-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      16
     ],
     "destination": [
      "v17-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      0
     ],
     "destination": [
      "v17-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-prep",
      0
     ],
     "destination": [
      "v17-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      1
     ],
     "destination": [
      "v17-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      2
     ],
     "destination": [
      "v17-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      3
     ],
     "destination": [
      "v17-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-phasor",
      0
     ],
     "destination": [
      "v17-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-rate",
      0
     ],
     "destination": [
      "v17-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-wave",
      0
     ],
     "destination": [
      "v17-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-bind",
      0
     ],
     "destination": [
      "v17-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-unbind",
      0
     ],
     "destination": [
      "v17-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-wave",
      0
     ],
     "destination": [
      "v17-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-snap",
      0
     ],
     "destination": [
      "v17-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-change",
      0
     ],
     "destination": [
      "v17-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-qgate",
      0
     ],
     "destination": [
      "v17-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-set",
      0
     ],
     "destination": [
      "v17-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      4
     ],
     "destination": [
      "v17-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-bindq",
      0
     ],
     "destination": [
      "v17-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      4
     ],
     "destination": [
      "v17-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-qon",
      0
     ],
     "destination": [
      "v17-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      2
     ],
     "destination": [
      "v17-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-qoff",
      0
     ],
     "destination": [
      "v17-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      3
     ],
     "destination": [
      "v17-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-route",
      3
     ],
     "destination": [
      "v17-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v17-unbq",
      0
     ],
     "destination": [
      "v17-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      17
     ],
     "destination": [
      "v18-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      0
     ],
     "destination": [
      "v18-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-prep",
      0
     ],
     "destination": [
      "v18-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      1
     ],
     "destination": [
      "v18-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      2
     ],
     "destination": [
      "v18-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      3
     ],
     "destination": [
      "v18-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-phasor",
      0
     ],
     "destination": [
      "v18-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-rate",
      0
     ],
     "destination": [
      "v18-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-wave",
      0
     ],
     "destination": [
      "v18-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-bind",
      0
     ],
     "destination": [
      "v18-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-unbind",
      0
     ],
     "destination": [
      "v18-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-wave",
      0
     ],
     "destination": [
      "v18-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-snap",
      0
     ],
     "destination": [
      "v18-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-change",
      0
     ],
     "destination": [
      "v18-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-qgate",
      0
     ],
     "destination": [
      "v18-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-set",
      0
     ],
     "destination": [
      "v18-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      4
     ],
     "destination": [
      "v18-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-bindq",
      0
     ],
     "destination": [
      "v18-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      4
     ],
     "destination": [
      "v18-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-qon",
      0
     ],
     "destination": [
      "v18-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      2
     ],
     "destination": [
      "v18-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-qoff",
      0
     ],
     "destination": [
      "v18-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      3
     ],
     "destination": [
      "v18-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-route",
      3
     ],
     "destination": [
      "v18-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v18-unbq",
      0
     ],
     "destination": [
      "v18-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      18
     ],
     "destination": [
      "v19-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      0
     ],
     "destination": [
      "v19-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-prep",
      0
     ],
     "destination": [
      "v19-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      1
     ],
     "destination": [
      "v19-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      2
     ],
     "destination": [
      "v19-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      3
     ],
     "destination": [
      "v19-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-phasor",
      0
     ],
     "destination": [
      "v19-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-rate",
      0
     ],
     "destination": [
      "v19-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-wave",
      0
     ],
     "destination": [
      "v19-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-bind",
      0
     ],
     "destination": [
      "v19-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-unbind",
      0
     ],
     "destination": [
      "v19-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-wave",
      0
     ],
     "destination": [
      "v19-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-snap",
      0
     ],
     "destination": [
      "v19-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-change",
      0
     ],
     "destination": [
      "v19-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-qgate",
      0
     ],
     "destination": [
      "v19-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-set",
      0
     ],
     "destination": [
      "v19-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      4
     ],
     "destination": [
      "v19-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-bindq",
      0
     ],
     "destination": [
      "v19-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      4
     ],
     "destination": [
      "v19-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-qon",
      0
     ],
     "destination": [
      "v19-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      2
     ],
     "destination": [
      "v19-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-qoff",
      0
     ],
     "destination": [
      "v19-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      3
     ],
     "destination": [
      "v19-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-route",
      3
     ],
     "destination": [
      "v19-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v19-unbq",
      0
     ],
     "destination": [
      "v19-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      19
     ],
     "destination": [
      "v20-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      0
     ],
     "destination": [
      "v20-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-prep",
      0
     ],
     "destination": [
      "v20-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      1
     ],
     "destination": [
      "v20-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      2
     ],
     "destination": [
      "v20-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      3
     ],
     "destination": [
      "v20-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-phasor",
      0
     ],
     "destination": [
      "v20-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-rate",
      0
     ],
     "destination": [
      "v20-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-wave",
      0
     ],
     "destination": [
      "v20-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-bind",
      0
     ],
     "destination": [
      "v20-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-unbind",
      0
     ],
     "destination": [
      "v20-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-wave",
      0
     ],
     "destination": [
      "v20-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-snap",
      0
     ],
     "destination": [
      "v20-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-change",
      0
     ],
     "destination": [
      "v20-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-qgate",
      0
     ],
     "destination": [
      "v20-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-set",
      0
     ],
     "destination": [
      "v20-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      4
     ],
     "destination": [
      "v20-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-bindq",
      0
     ],
     "destination": [
      "v20-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      4
     ],
     "destination": [
      "v20-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-qon",
      0
     ],
     "destination": [
      "v20-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      2
     ],
     "destination": [
      "v20-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-qoff",
      0
     ],
     "destination": [
      "v20-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      3
     ],
     "destination": [
      "v20-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-route",
      3
     ],
     "destination": [
      "v20-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v20-unbq",
      0
     ],
     "destination": [
      "v20-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      20
     ],
     "destination": [
      "v21-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      0
     ],
     "destination": [
      "v21-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-prep",
      0
     ],
     "destination": [
      "v21-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      1
     ],
     "destination": [
      "v21-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      2
     ],
     "destination": [
      "v21-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      3
     ],
     "destination": [
      "v21-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-phasor",
      0
     ],
     "destination": [
      "v21-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-rate",
      0
     ],
     "destination": [
      "v21-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-wave",
      0
     ],
     "destination": [
      "v21-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-bind",
      0
     ],
     "destination": [
      "v21-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-unbind",
      0
     ],
     "destination": [
      "v21-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-wave",
      0
     ],
     "destination": [
      "v21-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-snap",
      0
     ],
     "destination": [
      "v21-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-change",
      0
     ],
     "destination": [
      "v21-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-qgate",
      0
     ],
     "destination": [
      "v21-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-set",
      0
     ],
     "destination": [
      "v21-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      4
     ],
     "destination": [
      "v21-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-bindq",
      0
     ],
     "destination": [
      "v21-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      4
     ],
     "destination": [
      "v21-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-qon",
      0
     ],
     "destination": [
      "v21-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      2
     ],
     "destination": [
      "v21-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-qoff",
      0
     ],
     "destination": [
      "v21-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      3
     ],
     "destination": [
      "v21-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-route",
      3
     ],
     "destination": [
      "v21-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v21-unbq",
      0
     ],
     "destination": [
      "v21-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      21
     ],
     "destination": [
      "v22-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      0
     ],
     "destination": [
      "v22-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-prep",
      0
     ],
     "destination": [
      "v22-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      1
     ],
     "destination": [
      "v22-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      2
     ],
     "destination": [
      "v22-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      3
     ],
     "destination": [
      "v22-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-phasor",
      0
     ],
     "destination": [
      "v22-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-rate",
      0
     ],
     "destination": [
      "v22-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-wave",
      0
     ],
     "destination": [
      "v22-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-bind",
      0
     ],
     "destination": [
      "v22-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-unbind",
      0
     ],
     "destination": [
      "v22-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-wave",
      0
     ],
     "destination": [
      "v22-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-snap",
      0
     ],
     "destination": [
      "v22-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-change",
      0
     ],
     "destination": [
      "v22-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-qgate",
      0
     ],
     "destination": [
      "v22-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-set",
      0
     ],
     "destination": [
      "v22-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      4
     ],
     "destination": [
      "v22-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-bindq",
      0
     ],
     "destination": [
      "v22-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      4
     ],
     "destination": [
      "v22-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-qon",
      0
     ],
     "destination": [
      "v22-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      2
     ],
     "destination": [
      "v22-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-qoff",
      0
     ],
     "destination": [
      "v22-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      3
     ],
     "destination": [
      "v22-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-route",
      3
     ],
     "destination": [
      "v22-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v22-unbq",
      0
     ],
     "destination": [
      "v22-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      22
     ],
     "destination": [
      "v23-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      0
     ],
     "destination": [
      "v23-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-prep",
      0
     ],
     "destination": [
      "v23-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      1
     ],
     "destination": [
      "v23-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      2
     ],
     "destination": [
      "v23-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      3
     ],
     "destination": [
      "v23-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-phasor",
      0
     ],
     "destination": [
      "v23-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-rate",
      0
     ],
     "destination": [
      "v23-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-wave",
      0
     ],
     "destination": [
      "v23-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-bind",
      0
     ],
     "destination": [
      "v23-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-unbind",
      0
     ],
     "destination": [
      "v23-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-wave",
      0
     ],
     "destination": [
      "v23-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-snap",
      0
     ],
     "destination": [
      "v23-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-change",
      0
     ],
     "destination": [
      "v23-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-qgate",
      0
     ],
     "destination": [
      "v23-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-set",
      0
     ],
     "destination": [
      "v23-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      4
     ],
     "destination": [
      "v23-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-bindq",
      0
     ],
     "destination": [
      "v23-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      4
     ],
     "destination": [
      "v23-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-qon",
      0
     ],
     "destination": [
      "v23-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      2
     ],
     "destination": [
      "v23-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-qoff",
      0
     ],
     "destination": [
      "v23-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      3
     ],
     "destination": [
      "v23-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-route",
      3
     ],
     "destination": [
      "v23-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v23-unbq",
      0
     ],
     "destination": [
      "v23-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      23
     ],
     "destination": [
      "v24-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      0
     ],
     "destination": [
      "v24-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-prep",
      0
     ],
     "destination": [
      "v24-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      1
     ],
     "destination": [
      "v24-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      2
     ],
     "destination": [
      "v24-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      3
     ],
     "destination": [
      "v24-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-phasor",
      0
     ],
     "destination": [
      "v24-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-rate",
      0
     ],
     "destination": [
      "v24-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-wave",
      0
     ],
     "destination": [
      "v24-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-bind",
      0
     ],
     "destination": [
      "v24-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-unbind",
      0
     ],
     "destination": [
      "v24-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-wave",
      0
     ],
     "destination": [
      "v24-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-snap",
      0
     ],
     "destination": [
      "v24-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-change",
      0
     ],
     "destination": [
      "v24-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-qgate",
      0
     ],
     "destination": [
      "v24-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-set",
      0
     ],
     "destination": [
      "v24-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      4
     ],
     "destination": [
      "v24-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-bindq",
      0
     ],
     "destination": [
      "v24-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      4
     ],
     "destination": [
      "v24-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-qon",
      0
     ],
     "destination": [
      "v24-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      2
     ],
     "destination": [
      "v24-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-qoff",
      0
     ],
     "destination": [
      "v24-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      3
     ],
     "destination": [
      "v24-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-route",
      3
     ],
     "destination": [
      "v24-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v24-unbq",
      0
     ],
     "destination": [
      "v24-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      24
     ],
     "destination": [
      "v25-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      0
     ],
     "destination": [
      "v25-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-prep",
      0
     ],
     "destination": [
      "v25-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      1
     ],
     "destination": [
      "v25-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      2
     ],
     "destination": [
      "v25-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      3
     ],
     "destination": [
      "v25-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-phasor",
      0
     ],
     "destination": [
      "v25-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-rate",
      0
     ],
     "destination": [
      "v25-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-wave",
      0
     ],
     "destination": [
      "v25-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-bind",
      0
     ],
     "destination": [
      "v25-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-unbind",
      0
     ],
     "destination": [
      "v25-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-wave",
      0
     ],
     "destination": [
      "v25-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-snap",
      0
     ],
     "destination": [
      "v25-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-change",
      0
     ],
     "destination": [
      "v25-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-qgate",
      0
     ],
     "destination": [
      "v25-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-set",
      0
     ],
     "destination": [
      "v25-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      4
     ],
     "destination": [
      "v25-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-bindq",
      0
     ],
     "destination": [
      "v25-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      4
     ],
     "destination": [
      "v25-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-qon",
      0
     ],
     "destination": [
      "v25-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      2
     ],
     "destination": [
      "v25-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-qoff",
      0
     ],
     "destination": [
      "v25-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      3
     ],
     "destination": [
      "v25-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-route",
      3
     ],
     "destination": [
      "v25-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v25-unbq",
      0
     ],
     "destination": [
      "v25-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      25
     ],
     "destination": [
      "v26-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      0
     ],
     "destination": [
      "v26-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-prep",
      0
     ],
     "destination": [
      "v26-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      1
     ],
     "destination": [
      "v26-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      2
     ],
     "destination": [
      "v26-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      3
     ],
     "destination": [
      "v26-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-phasor",
      0
     ],
     "destination": [
      "v26-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-rate",
      0
     ],
     "destination": [
      "v26-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-wave",
      0
     ],
     "destination": [
      "v26-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-bind",
      0
     ],
     "destination": [
      "v26-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-unbind",
      0
     ],
     "destination": [
      "v26-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-wave",
      0
     ],
     "destination": [
      "v26-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-snap",
      0
     ],
     "destination": [
      "v26-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-change",
      0
     ],
     "destination": [
      "v26-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-qgate",
      0
     ],
     "destination": [
      "v26-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-set",
      0
     ],
     "destination": [
      "v26-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      4
     ],
     "destination": [
      "v26-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-bindq",
      0
     ],
     "destination": [
      "v26-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      4
     ],
     "destination": [
      "v26-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-qon",
      0
     ],
     "destination": [
      "v26-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      2
     ],
     "destination": [
      "v26-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-qoff",
      0
     ],
     "destination": [
      "v26-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      3
     ],
     "destination": [
      "v26-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-route",
      3
     ],
     "destination": [
      "v26-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v26-unbq",
      0
     ],
     "destination": [
      "v26-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      26
     ],
     "destination": [
      "v27-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      0
     ],
     "destination": [
      "v27-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-prep",
      0
     ],
     "destination": [
      "v27-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      1
     ],
     "destination": [
      "v27-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      2
     ],
     "destination": [
      "v27-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      3
     ],
     "destination": [
      "v27-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-phasor",
      0
     ],
     "destination": [
      "v27-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-rate",
      0
     ],
     "destination": [
      "v27-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-wave",
      0
     ],
     "destination": [
      "v27-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-bind",
      0
     ],
     "destination": [
      "v27-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-unbind",
      0
     ],
     "destination": [
      "v27-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-wave",
      0
     ],
     "destination": [
      "v27-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-snap",
      0
     ],
     "destination": [
      "v27-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-change",
      0
     ],
     "destination": [
      "v27-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-qgate",
      0
     ],
     "destination": [
      "v27-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-set",
      0
     ],
     "destination": [
      "v27-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      4
     ],
     "destination": [
      "v27-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-bindq",
      0
     ],
     "destination": [
      "v27-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      4
     ],
     "destination": [
      "v27-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-qon",
      0
     ],
     "destination": [
      "v27-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      2
     ],
     "destination": [
      "v27-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-qoff",
      0
     ],
     "destination": [
      "v27-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      3
     ],
     "destination": [
      "v27-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-route",
      3
     ],
     "destination": [
      "v27-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v27-unbq",
      0
     ],
     "destination": [
      "v27-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      27
     ],
     "destination": [
      "v28-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      0
     ],
     "destination": [
      "v28-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-prep",
      0
     ],
     "destination": [
      "v28-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      1
     ],
     "destination": [
      "v28-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      2
     ],
     "destination": [
      "v28-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      3
     ],
     "destination": [
      "v28-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-phasor",
      0
     ],
     "destination": [
      "v28-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-rate",
      0
     ],
     "destination": [
      "v28-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-wave",
      0
     ],
     "destination": [
      "v28-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-bind",
      0
     ],
     "destination": [
      "v28-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-unbind",
      0
     ],
     "destination": [
      "v28-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-wave",
      0
     ],
     "destination": [
      "v28-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-snap",
      0
     ],
     "destination": [
      "v28-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-change",
      0
     ],
     "destination": [
      "v28-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-qgate",
      0
     ],
     "destination": [
      "v28-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-set",
      0
     ],
     "destination": [
      "v28-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      4
     ],
     "destination": [
      "v28-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-bindq",
      0
     ],
     "destination": [
      "v28-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      4
     ],
     "destination": [
      "v28-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-qon",
      0
     ],
     "destination": [
      "v28-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      2
     ],
     "destination": [
      "v28-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-qoff",
      0
     ],
     "destination": [
      "v28-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      3
     ],
     "destination": [
      "v28-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-route",
      3
     ],
     "destination": [
      "v28-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v28-unbq",
      0
     ],
     "destination": [
      "v28-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      28
     ],
     "destination": [
      "v29-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      0
     ],
     "destination": [
      "v29-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-prep",
      0
     ],
     "destination": [
      "v29-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      1
     ],
     "destination": [
      "v29-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      2
     ],
     "destination": [
      "v29-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      3
     ],
     "destination": [
      "v29-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-phasor",
      0
     ],
     "destination": [
      "v29-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-rate",
      0
     ],
     "destination": [
      "v29-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-wave",
      0
     ],
     "destination": [
      "v29-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-bind",
      0
     ],
     "destination": [
      "v29-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-unbind",
      0
     ],
     "destination": [
      "v29-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-wave",
      0
     ],
     "destination": [
      "v29-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-snap",
      0
     ],
     "destination": [
      "v29-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-change",
      0
     ],
     "destination": [
      "v29-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-qgate",
      0
     ],
     "destination": [
      "v29-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-set",
      0
     ],
     "destination": [
      "v29-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      4
     ],
     "destination": [
      "v29-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-bindq",
      0
     ],
     "destination": [
      "v29-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      4
     ],
     "destination": [
      "v29-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-qon",
      0
     ],
     "destination": [
      "v29-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      2
     ],
     "destination": [
      "v29-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-qoff",
      0
     ],
     "destination": [
      "v29-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      3
     ],
     "destination": [
      "v29-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-route",
      3
     ],
     "destination": [
      "v29-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v29-unbq",
      0
     ],
     "destination": [
      "v29-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      29
     ],
     "destination": [
      "v30-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      0
     ],
     "destination": [
      "v30-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-prep",
      0
     ],
     "destination": [
      "v30-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      1
     ],
     "destination": [
      "v30-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      2
     ],
     "destination": [
      "v30-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      3
     ],
     "destination": [
      "v30-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-phasor",
      0
     ],
     "destination": [
      "v30-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-rate",
      0
     ],
     "destination": [
      "v30-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-wave",
      0
     ],
     "destination": [
      "v30-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-bind",
      0
     ],
     "destination": [
      "v30-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-unbind",
      0
     ],
     "destination": [
      "v30-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-wave",
      0
     ],
     "destination": [
      "v30-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-snap",
      0
     ],
     "destination": [
      "v30-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-change",
      0
     ],
     "destination": [
      "v30-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-qgate",
      0
     ],
     "destination": [
      "v30-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-set",
      0
     ],
     "destination": [
      "v30-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      4
     ],
     "destination": [
      "v30-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-bindq",
      0
     ],
     "destination": [
      "v30-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      4
     ],
     "destination": [
      "v30-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-qon",
      0
     ],
     "destination": [
      "v30-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      2
     ],
     "destination": [
      "v30-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-qoff",
      0
     ],
     "destination": [
      "v30-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      3
     ],
     "destination": [
      "v30-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-route",
      3
     ],
     "destination": [
      "v30-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v30-unbq",
      0
     ],
     "destination": [
      "v30-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      30
     ],
     "destination": [
      "v31-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      0
     ],
     "destination": [
      "v31-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-prep",
      0
     ],
     "destination": [
      "v31-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      1
     ],
     "destination": [
      "v31-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      2
     ],
     "destination": [
      "v31-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      3
     ],
     "destination": [
      "v31-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-phasor",
      0
     ],
     "destination": [
      "v31-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-rate",
      0
     ],
     "destination": [
      "v31-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-wave",
      0
     ],
     "destination": [
      "v31-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-bind",
      0
     ],
     "destination": [
      "v31-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-unbind",
      0
     ],
     "destination": [
      "v31-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-wave",
      0
     ],
     "destination": [
      "v31-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-snap",
      0
     ],
     "destination": [
      "v31-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-change",
      0
     ],
     "destination": [
      "v31-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-qgate",
      0
     ],
     "destination": [
      "v31-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-set",
      0
     ],
     "destination": [
      "v31-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      4
     ],
     "destination": [
      "v31-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-bindq",
      0
     ],
     "destination": [
      "v31-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      4
     ],
     "destination": [
      "v31-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-qon",
      0
     ],
     "destination": [
      "v31-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      2
     ],
     "destination": [
      "v31-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-qoff",
      0
     ],
     "destination": [
      "v31-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      3
     ],
     "destination": [
      "v31-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-route",
      3
     ],
     "destination": [
      "v31-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v31-unbq",
      0
     ],
     "destination": [
      "v31-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-9",
      31
     ],
     "destination": [
      "v32-route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      0
     ],
     "destination": [
      "v32-prep",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-prep",
      0
     ],
     "destination": [
      "v32-buf",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      1
     ],
     "destination": [
      "v32-rate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      2
     ],
     "destination": [
      "v32-bind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      3
     ],
     "destination": [
      "v32-unbind",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-phasor",
      0
     ],
     "destination": [
      "v32-rate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-rate",
      0
     ],
     "destination": [
      "v32-wave",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-wave",
      0
     ],
     "destination": [
      "v32-remote",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-bind",
      0
     ],
     "destination": [
      "v32-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-unbind",
      0
     ],
     "destination": [
      "v32-remote",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-wave",
      0
     ],
     "destination": [
      "v32-snap",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-snap",
      0
     ],
     "destination": [
      "v32-change",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-change",
      0
     ],
     "destination": [
      "v32-qgate",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-qgate",
      0
     ],
     "destination": [
      "v32-set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-set",
      0
     ],
     "destination": [
      "v32-lobj",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      4
     ],
     "destination": [
      "v32-bindq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-bindq",
      0
     ],
     "destination": [
      "v32-lobj",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      4
     ],
     "destination": [
      "v32-qon",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-qon",
      0
     ],
     "destination": [
      "v32-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      2
     ],
     "destination": [
      "v32-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-qoff",
      0
     ],
     "destination": [
      "v32-qgate",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      3
     ],
     "destination": [
      "v32-qoff",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-route",
      3
     ],
     "destination": [
      "v32-unbq",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "v32-unbq",
      0
     ],
     "destination": [
      "v32-lobj",
      1
     ]
    }
   }
  ]
 }
}