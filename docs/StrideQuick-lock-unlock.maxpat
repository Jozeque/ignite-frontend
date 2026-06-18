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
		"rect" : [ 100.0, 100.0, 620.0, 320.0 ],
		"openinpresentation" : 1,
		"gridonopen" : 1,
		"gridsize" : [ 15.0, 15.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"id" : "obj-1",
					"maxclass" : "comment",
					"text" : "LOCK / UNLOCK cluster. Wire 3 cords: (1) 'quick lockcurrent' out -> node.script INLET.  (2) 'quick unlockall' out -> node.script INLET.  (3) node.script OUTLET -> 'route quick_locked' inlet (drag a 2nd cord off the same outlet that feeds your other routes). The number under the Lock button shows how many lanes are frozen.",
					"patching_rect" : [ 20.0, 14.0, 560.0, 47.0 ],
					"fontsize" : 11.0,
					"textcolor" : [ 0.8, 0.78, 0.74, 1.0 ],
					"numinlets" : 1,
					"numoutlets" : 0
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-2",
					"maxclass" : "textbutton",
					"text" : "Lock current lanes",
					"parameter_enable" : 0,
					"patching_rect" : [ 30.0, 74.0, 140.0, 26.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 20.0, 140.0, 26.0 ],
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "int" ],
					"fontsize" : 11.0,
					"rounded" : 6.0,
					"bgcolor" : [ 0.145, 0.129, 0.098, 1.0 ],
					"bgoncolor" : [ 0.247, 0.212, 0.129, 1.0 ],
					"textcolor" : [ 0.722, 0.678, 0.608, 1.0 ],
					"textoncolor" : [ 0.925, 0.894, 0.839, 1.0 ],
					"bordercolor" : [ 0.227, 0.208, 0.169, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-3",
					"maxclass" : "message",
					"text" : "quick lockcurrent",
					"patching_rect" : [ 30.0, 110.0, 130.0, 22.0 ],
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-4",
					"maxclass" : "textbutton",
					"text" : "Unlock all",
					"parameter_enable" : 0,
					"patching_rect" : [ 200.0, 74.0, 140.0, 26.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 82.0, 140.0, 26.0 ],
					"numinlets" : 1,
					"numoutlets" : 3,
					"outlettype" : [ "", "", "int" ],
					"fontsize" : 11.0,
					"rounded" : 6.0,
					"bgcolor" : [ 0.145, 0.129, 0.098, 1.0 ],
					"bgoncolor" : [ 0.247, 0.212, 0.129, 1.0 ],
					"textcolor" : [ 0.722, 0.678, 0.608, 1.0 ],
					"textoncolor" : [ 0.925, 0.894, 0.839, 1.0 ],
					"bordercolor" : [ 0.227, 0.208, 0.169, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-5",
					"maxclass" : "message",
					"text" : "quick unlockall",
					"patching_rect" : [ 200.0, 110.0, 130.0, 22.0 ],
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-6",
					"maxclass" : "newobj",
					"text" : "route quick_locked",
					"patching_rect" : [ 380.0, 74.0, 116.0, 22.0 ],
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"fontsize" : 11.0
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-7",
					"maxclass" : "number",
					"parameter_enable" : 0,
					"patching_rect" : [ 380.0, 110.0, 60.0, 22.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 20.0, 54.0, 48.0, 22.0 ],
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "bang" ],
					"fontsize" : 12.0,
					"bgcolor" : [ 0.106, 0.094, 0.071, 1.0 ],
					"textcolor" : [ 0.788, 0.635, 0.294, 1.0 ],
					"tricolor" : [ 0.247, 0.212, 0.129, 1.0 ],
					"htricolor" : [ 0.345, 0.282, 0.149, 1.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-8",
					"maxclass" : "comment",
					"text" : "locked",
					"patching_rect" : [ 446.0, 112.0, 60.0, 18.0 ],
					"presentation" : 1,
					"presentation_rect" : [ 74.0, 57.0, 60.0, 17.0 ],
					"fontsize" : 10.0,
					"textcolor" : [ 0.62, 0.585, 0.53, 1.0 ],
					"numinlets" : 1,
					"numoutlets" : 0
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
					"source" : [ "obj-4", 0 ],
					"destination" : [ "obj-5", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"source" : [ "obj-6", 0 ],
					"destination" : [ "obj-7", 0 ]
				}

			}
 ]
	}

}
