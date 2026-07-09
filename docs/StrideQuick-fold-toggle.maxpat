{
	"patcher" : 	{
		"fileversion" : 1,
		"appversion" : 		{
			"major" : 8,
			"minor" : 6,
			"revision" : 0,
			"architecture" : "x64",
			"modernui" : 1
		}
,
		"classnamespace" : "box",
		"rect" : [ 120.0, 120.0, 580.0, 340.0 ],
		"boxes" : [
			{ "box" : { "maxclass" : "comment", "id" : "obj-10", "numinlets" : 1, "numoutlets" : 0, "fontsize" : 11.0, "patching_rect" : [ 20.0, 12.0, 540.0, 20.0 ], "text" : "FOLD TOGGLE  —  set your Quick button to Toggle Mode (so it outputs 1/0). Cover panel Scripting Name must be: qcover" } },
			{ "box" : { "maxclass" : "newobj", "id" : "obj-1", "numinlets" : 1, "numoutlets" : 1, "outlettype" : [ "bang" ], "patching_rect" : [ 30.0, 58.0, 62.0, 22.0 ], "text" : "loadbang" } },
			{ "box" : { "maxclass" : "message", "id" : "obj-2", "numinlets" : 2, "numoutlets" : 1, "outlettype" : [ "" ], "patching_rect" : [ 30.0, 98.0, 32.0, 22.0 ], "text" : "1" } },
			{ "box" : { "maxclass" : "comment", "id" : "obj-11", "numinlets" : 1, "numoutlets" : 0, "fontsize" : 10.0, "patching_rect" : [ 70.0, 100.0, 260.0, 18.0 ], "text" : "①  this '1' OUTLET  →  your Quick button INLET" } },
			{ "box" : { "maxclass" : "message", "id" : "obj-3", "numinlets" : 2, "numoutlets" : 1, "outlettype" : [ "" ], "patching_rect" : [ 340.0, 98.0, 150.0, 22.0 ], "text" : "script hide qcover" } },
			{ "box" : { "maxclass" : "comment", "id" : "obj-12", "numinlets" : 1, "numoutlets" : 0, "fontsize" : 10.0, "patching_rect" : [ 30.0, 168.0, 400.0, 18.0 ], "text" : "②  your Quick button OUTLET  →  this 'if' inlet  ↓" } },
			{ "box" : { "maxclass" : "newobj", "id" : "obj-4", "numinlets" : 1, "numoutlets" : 1, "outlettype" : [ "" ], "patching_rect" : [ 30.0, 188.0, 392.0, 22.0 ], "text" : "if $i1 == 1 then script hide qcover else script show qcover" } },
			{ "box" : { "maxclass" : "newobj", "id" : "obj-5", "numinlets" : 1, "numoutlets" : 2, "outlettype" : [ "", "" ], "patching_rect" : [ 30.0, 240.0, 72.0, 22.0 ], "text" : "thispatcher" } }
		],
		"lines" : [
			{ "patchline" : { "source" : [ "obj-1", 0 ], "destination" : [ "obj-2", 0 ] } },
			{ "patchline" : { "source" : [ "obj-1", 0 ], "destination" : [ "obj-3", 0 ] } },
			{ "patchline" : { "source" : [ "obj-3", 0 ], "destination" : [ "obj-5", 0 ] } },
			{ "patchline" : { "source" : [ "obj-4", 0 ], "destination" : [ "obj-5", 0 ] } }
		]
	}
}
