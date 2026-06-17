{
	"patcher" : 	{
		"fileversion" : 1,
		"appversion" : 		{
			"major" : 8,
			"minor" : 5,
			"revision" : 5,
			"architecture" : "x64",
			"modernui" : 1
		}
,
		"classnamespace" : "box",
		"rect" : [ 120.0, 120.0, 560.0, 320.0 ],
		"openinpresentation" : 1,
		"gridonopen" : 1,
		"gridsize" : [ 15.0, 15.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"id" : "obj-1",
					"maxclass" : "comment",
					"text" : "STATUS readout. Wire your node.script OUTLET into [route quick_status]. The [fromsymbol] splits the text into words so the box shows spaces, not commas. Put the message box in Presentation where the old label was.",
					"patching_rect" : [ 30.0, 18.0, 490.0, 47.0 ],
					"fontsize" : 11.0,
					"textcolor" : [ 0.8, 0.78, 0.74, 1.0 ],
					"numinlets" : 1,
					"numoutlets" : 0
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-2",
					"maxclass" : "newobj",
					"text" : "route quick_status",
					"patching_rect" : [ 30.0, 78.0, 122.0, 22.0 ],
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-3",
					"maxclass" : "newobj",
					"text" : "fromsymbol",
					"patching_rect" : [ 30.0, 116.0, 74.0, 22.0 ],
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "" ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-4",
					"maxclass" : "newobj",
					"text" : "prepend set",
					"patching_rect" : [ 30.0, 154.0, 78.0, 22.0 ],
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "" ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-5",
					"maxclass" : "message",
					"text" : "Connected",
					"patching_rect" : [ 30.0, 192.0, 220.0, 21.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 20.0, 210.0, 20.0 ],
					"fontname" : "Space Mono",
					"fontsize" : 11.0,
					"textcolor" : [ 0.9255, 0.8941, 0.8392, 1.0 ],
					"bgfillcolor" : 					{
						"type" : "color",
						"color" : [ 0.1137, 0.1059, 0.0863, 1.0 ]
					}
,
					"bgcolor" : [ 0.1137, 0.1059, 0.0863, 1.0 ],
					"bordercolor" : [ 0.1137, 0.1059, 0.0863, 1.0 ],
					"border" : 0,
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ]
				}

			}
 ],
		"lines" : [ 			{
				"patchline" : 				{
					"source" : [ "obj-2", 0 ],
					"destination" : [ "obj-3", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"source" : [ "obj-3", 0 ],
					"destination" : [ "obj-4", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"source" : [ "obj-4", 0 ],
					"destination" : [ "obj-5", 0 ]
				}

			}
 ]
	}

}
