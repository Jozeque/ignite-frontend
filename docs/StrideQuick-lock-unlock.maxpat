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
		"rect" : [ 100.0, 100.0, 620.0, 320.0 ],
		"openinpresentation" : 1,
		"gridsize" : [ 15.0, 15.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-1",
					"linecount" : 3,
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 20.0, 14.0, 560.0, 44.0 ],
					"text" : "LOCK / UNLOCK cluster. Wire 3 cords: (1) 'quick lockcurrent' out -> node.script INLET.  (2) 'quick unlockall' out -> node.script INLET.  (3) node.script OUTLET -> 'route quick_locked' inlet (drag a 2nd cord off the same outlet that feeds your other routes). The number under the Lock button shows how many lanes are frozen.",
					"textcolor" : [ 0.8, 0.78, 0.74, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"bgcolor" : [ 0.145, 0.129, 0.098, 1.0 ],
					"bgoncolor" : [ 0.247, 0.212, 0.129, 1.0 ],
					"fontsize" : 11.0,
					"id" : "obj-2",
					"maxclass" : "textbutton",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "int" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 30.0, 74.0, 140.0, 26.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 20.0, 140.0, 26.0 ],
					"rounded" : 6.0,
					"text" : "Lock current lanes",
					"textcolor" : [ 0.722, 0.678, 0.608, 1.0 ],
					"textoncolor" : [ 0.925, 0.894, 0.839, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-3",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 30.0, 110.0, 130.0, 22.0 ],
					"text" : "quick lockcurrent"
				}

			}
, 			{
				"box" : 				{
					"bgcolor" : [ 0.145, 0.129, 0.098, 1.0 ],
					"bgoncolor" : [ 0.247, 0.212, 0.129, 1.0 ],
					"fontsize" : 11.0,
					"id" : "obj-4",
					"maxclass" : "textbutton",
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "int" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 200.0, 74.0, 140.0, 26.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 82.0, 140.0, 26.0 ],
					"rounded" : 6.0,
					"text" : "Unlock all",
					"textcolor" : [ 0.722, 0.678, 0.608, 1.0 ],
					"textoncolor" : [ 0.925, 0.894, 0.839, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-5",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 200.0, 110.0, 130.0, 22.0 ],
					"text" : "quick unlockall"
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 11.0,
					"id" : "obj-6",
					"maxclass" : "newobj",
					"numinlets" : 2,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 380.0, 74.0, 116.0, 21.0 ],
					"text" : "route quick_locked"
				}

			}
, 			{
				"box" : 				{
					"bgcolor" : [ 0.106, 0.094, 0.071, 1.0 ],
					"fontsize" : 12.0,
					"htricolor" : [ 0.345, 0.282, 0.149, 1.0 ],
					"id" : "obj-7",
					"maxclass" : "number",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "bang" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 380.0, 110.0, 60.0, 22.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 54.0, 48.0, 22.0 ],
					"textcolor" : [ 0.788, 0.635, 0.294, 1.0 ],
					"tricolor" : [ 0.247, 0.212, 0.129, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"fontsize" : 10.0,
					"id" : "obj-8",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 446.0, 112.0, 60.0, 18.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 74.0, 57.0, 60.0, 18.0 ],
					"text" : "locked",
					"textcolor" : [ 0.62, 0.585, 0.53, 1.0 ]
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
					"destination" : [ "obj-7", 0 ],
					"source" : [ "obj-6", 0 ]
				}

			}
 ],
		"dependency_cache" : [  ],
		"autosave" : 0,
		"oscreceiveudpport" : 0
	}

}
