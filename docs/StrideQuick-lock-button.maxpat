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
		"rect" : [ 120.0, 120.0, 540.0, 280.0 ],
		"openinpresentation" : 1,
		"gridonopen" : 1,
		"gridsize" : [ 15.0, 15.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"id" : "obj-1",
					"maxclass" : "comment",
					"text" : "LOCK CURRENT LANES. Wire the message box outlet into your node.script INLET (the same inlet your Chaos/Reflector buttons feed). Then place the button in Presentation.",
					"patching_rect" : [ 30.0, 18.0, 480.0, 33.0 ],
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
					"patching_rect" : [ 30.0, 66.0, 140.0, 26.0 ],
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
					"patching_rect" : [ 30.0, 108.0, 120.0, 22.0 ],
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
 ]
	}

}
