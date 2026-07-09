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
		"rect" : [ 34.0, 77.0, 1410.0, 969.0 ],
		"openinpresentation" : 1,
		"gridsize" : [ 15.0, 15.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"fontsize" : 10.0,
					"id" : "obj-1",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 30.0, 12.0, 80.0, 18.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 8.0, 60.0, 18.0 ],
					"text" : "motion",
					"textcolor" : [ 0.78, 0.6, 0.36, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"bgcolor" : [ 0.34, 0.35, 0.37, 1.0 ],
					"bgoncolor" : [ 0.18, 0.7, 0.42, 1.0 ],
					"fontsize" : 14.0,
					"id" : "obj-2",
					"maxclass" : "textbutton",
					"mode" : 1,
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "int" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 30.0, 44.0, 30.0, 30.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 26.0, 28.0, 28.0 ],
					"rounded" : 6.0,
					"text" : "↻",
					"textcolor" : [ 0.82, 0.83, 0.84, 1.0 ],
					"texton" : "↻",
					"textoncolor" : [ 1.0, 1.0, 1.0, 1.0 ],
					"tosymbol" : 0,
					"usebgoncolor" : 1
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-3",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 30.0, 100.0, 140.0, 22.0 ],
					"text" : "quick rescan_set $1"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-4",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 230.0, 50.0, 122.0, 21.0 ],
					"text" : "route quick_rescan"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-5",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 230.0, 100.0, 80.0, 21.0 ],
					"text" : "prepend set"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-6",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "bang" ],
					"patching_rect" : [ 400.0, 20.0, 65.0, 21.0 ],
					"text" : "loadbang"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-7",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 400.0, 50.0, 50.0, 22.0 ],
					"text" : "set 1"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-8",
					"linecount" : 9,
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 30.0, 140.0, 505.0, 120.0 ],
					"text" : "AUTO RESCAN button for the Motion buttons. GREEN = ON (Motion buttons rescan the rack then apply, pulling in params mapped since the last sync). GREY = OFF (apply on the loaded params only: no scan, no Ableton freeze, for cranking or recording the same params). Lock the patcher (Ctrl E) to click it. WIRING: textbutton outlet 0 into the message box; message box outlet into your node.script INLET (the same inlet Chaos and Reflector feed). For the color to mirror the canvas, add 'quick_rescan' to your existing [route ...] off the node.script outlet (or wire this [route quick_rescan]), then into [prepend set] into the textbutton. Always use 'set' so reflecting the state never re-fires the command. Put the title and button in Presentation. parameter_enable is 0 so it stays out of the param list and never records into clip automation.",
					"textcolor" : [ 0.8, 0.78, 0.74, 1.0 ]
				}

			}
 ],
		"lines" : [ 			{
				"patchline" : 				{
					"destination" : [ "obj-3", 0 ],
					"source" : [ "obj-2", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-5", 0 ],
					"source" : [ "obj-4", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-2", 0 ],
					"source" : [ "obj-5", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-7", 0 ],
					"source" : [ "obj-6", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-2", 0 ],
					"source" : [ "obj-7", 0 ]
				}

			}
 ],
		"dependency_cache" : [  ],
		"autosave" : 0,
		"oscreceiveudpport" : 0
	}

}
