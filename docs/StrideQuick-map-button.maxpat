{
	"patcher" : 	{
		"fileversion" : 1,
		"appversion" : 		{
			"major" : 9,
			"minor" : 0,
			"revision" : 9,
			"architecture" : "x64",
			"modernui" : 1
		}
,
		"classnamespace" : "box",
		"rect" : [ 100.0, 100.0, 1000.0, 760.0 ],
		"openinpresentation" : 1,
		"gridsize" : [ 15.0, 15.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"fontsize" : 10.0,
					"id" : "obj-1",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 20.0, 12.0, 60.0, 18.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 8.0, 60.0, 18.0 ],
					"text" : "map",
					"textcolor" : [ 0.78, 0.6, 0.36, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"bgcolor" : [ 0.34, 0.35, 0.37, 1.0 ],
					"bgoncolor" : [ 0.85, 0.22, 0.22, 1.0 ],
					"fontsize" : 13.0,
					"id" : "obj-2",
					"maxclass" : "textbutton",
					"mode" : 1,
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "int" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 20.0, 40.0, 50.0, 30.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 26.0, 52.0, 28.0 ],
					"rounded" : 6.0,
					"text" : "Map",
					"textcolor" : [ 0.82, 0.83, 0.84, 1.0 ],
					"textoncolor" : [ 1.0, 1.0, 1.0, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-3",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "bang", "bang", "" ],
					"patching_rect" : [ 20.0, 100.0, 60.0, 21.0 ],
					"text" : "sel 1 0"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-9",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "bang", "bang" ],
					"patching_rect" : [ 20.0, 140.0, 40.0, 21.0 ],
					"text" : "t b b"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-15",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 110.0, 140.0, 30.0, 22.0 ],
					"text" : "0"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-10",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 20.0, 185.0, 180.0, 22.0 ],
					"text" : "get focused_document_view"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-8",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 220.0, 185.0, 90.0, 21.0 ],
					"saved_object_attributes" : 					{
						"_persistence" : 1
					}
,
					"text" : "live.object"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-11",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 20.0, 225.0, 185.0, 21.0 ],
					"text" : "route focused_document_view"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-12",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "bang", "bang", "" ],
					"patching_rect" : [ 20.0, 265.0, 150.0, 21.0 ],
					"text" : "sel Session Arranger"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-13",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 20.0, 305.0, 160.0, 22.0 ],
					"text" : "set session_record 1"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-14",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 200.0, 305.0, 150.0, 22.0 ],
					"text" : "set record_mode 1"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-6",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 20.0, 365.0, 90.0, 21.0 ],
					"saved_object_attributes" : 					{
						"_persistence" : 1
					}
,
					"text" : "live.object"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-16",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "bang" ],
					"patching_rect" : [ 430.0, 140.0, 70.0, 21.0 ],
					"text" : "metro 150"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-17",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 430.0, 180.0, 110.0, 22.0 ],
					"text" : "get is_playing"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-18",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 430.0, 260.0, 120.0, 21.0 ],
					"text" : "route is_playing"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-19",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "bang", "bang", "" ],
					"patching_rect" : [ 430.0, 300.0, 70.0, 21.0 ],
					"text" : "sel 0 1"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-20",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 610.0, 260.0, 30.0, 22.0 ],
					"text" : "1"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-21",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "int" ],
					"patching_rect" : [ 560.0, 300.0, 40.0, 21.0 ],
					"text" : "int"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-22",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 2,
					"outlettype" : [ "bang", "" ],
					"patching_rect" : [ 560.0, 340.0, 50.0, 21.0 ],
					"text" : "sel 1"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-23",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 430.0, 400.0, 160.0, 22.0 ],
					"text" : "set session_record 0"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-24",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 600.0, 400.0, 150.0, 22.0 ],
					"text" : "set record_mode 0"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-25",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 760.0, 400.0, 30.0, 22.0 ],
					"text" : "0"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-26",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 800.0, 400.0, 50.0, 22.0 ],
					"text" : "set 0"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-4",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "bang" ],
					"patching_rect" : [ 700.0, 24.0, 65.0, 21.0 ],
					"text" : "loadbang"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-5",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "" ],
					"patching_rect" : [ 700.0, 64.0, 120.0, 21.0 ],
					"text" : "live.path live_set"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-7",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "" ],
					"patching_rect" : [ 700.0, 104.0, 140.0, 21.0 ],
					"text" : "live.path live_app view"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-27",
					"linecount" : 12,
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 20.0, 440.0, 600.0, 170.0 ],
					"text" : "MAP button (view-aware TOGGLE, auto-off). Records from the device into the focused view's record button. SESSION view -> set session_record 1 (Session Overdub): with your selected clip PLAYING it overdubs automation into THAT clip in place; Overdub never creates a clip, so a selected clip records onto itself (the clip must be playing to capture). ARRANGER view -> set record_mode 1 (Arrangement Record). It reads live_app view focused_document_view on each ON press and branches. OFF (click again) or AUTO-OFF zeroes BOTH session_record and record_mode. AUTO-OFF: [metro 150] runs only while armed and polls Song is_playing; once playback has been 1 and then hits 0 (you press stop) it disarms, greys the button, and stops the metro, so you never leave it armed. The [int] flag gates it so arming BEFORE playback does not instantly disarm. Needs Ableton pref Record/Warp/Launch > 'Record Session automation in: All Tracks' (then no track arm needed). Does NOT touch Automation Arm (session_automation_record). SELF-CONTAINED: drives live_set / live_app directly, no scanner_max.js or node.script. WIRING: select all (Ctrl A), copy, paste into StrideLink (Ctrl E to unlock), drop the 'Map' button into Presentation, save / freeze. parameter_enable is 0 so it stays out of the param list.",
					"textcolor" : [ 0.8, 0.78, 0.74, 1.0 ]
				}

			}
 ],
		"lines" : [ 			{
				"patchline" : { "destination" : [ "obj-5", 0 ], "source" : [ "obj-4", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-7", 0 ], "source" : [ "obj-4", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-6", 0 ], "source" : [ "obj-5", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-8", 0 ], "source" : [ "obj-7", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-3", 0 ], "source" : [ "obj-2", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-16", 0 ], "source" : [ "obj-2", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-9", 0 ], "source" : [ "obj-3", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-5", 0 ], "source" : [ "obj-9", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-7", 0 ], "source" : [ "obj-9", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-10", 0 ], "source" : [ "obj-9", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-15", 0 ], "source" : [ "obj-9", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-21", 1 ], "source" : [ "obj-15", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-8", 0 ], "source" : [ "obj-10", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-11", 0 ], "source" : [ "obj-8", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-12", 0 ], "source" : [ "obj-11", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-13", 0 ], "source" : [ "obj-12", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-14", 0 ], "source" : [ "obj-12", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-6", 0 ], "source" : [ "obj-13", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-6", 0 ], "source" : [ "obj-14", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-23", 0 ], "source" : [ "obj-3", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-24", 0 ], "source" : [ "obj-3", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-25", 0 ], "source" : [ "obj-3", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-6", 0 ], "source" : [ "obj-23", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-6", 0 ], "source" : [ "obj-24", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-16", 0 ], "source" : [ "obj-25", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-2", 0 ], "source" : [ "obj-26", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-17", 0 ], "source" : [ "obj-16", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-6", 0 ], "source" : [ "obj-17", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-18", 0 ], "source" : [ "obj-6", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-19", 0 ], "source" : [ "obj-18", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-21", 0 ], "source" : [ "obj-19", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-20", 0 ], "source" : [ "obj-19", 1 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-21", 1 ], "source" : [ "obj-20", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-22", 0 ], "source" : [ "obj-21", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-23", 0 ], "source" : [ "obj-22", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-24", 0 ], "source" : [ "obj-22", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-25", 0 ], "source" : [ "obj-22", 0 ] }
			}
, 			{
				"patchline" : { "destination" : [ "obj-26", 0 ], "source" : [ "obj-22", 0 ] }
			}
 ],
		"parameters" : 		{
			"parameterbanks" : 			{
				"0" : 				{
					"index" : 0,
					"name" : "",
					"parameters" : [ "-", "-", "-", "-", "-", "-", "-", "-" ],
					"buttons" : [ "-", "-", "-", "-", "-", "-", "-", "-" ]
				}

			}
,
			"inherited_shortname" : 1
		}
,
		"dependency_cache" : [  ],
		"autosave" : 0,
		"oscreceiveudpport" : 0
	}

}
