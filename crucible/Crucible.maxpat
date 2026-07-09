{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 0,
      "revision": 9,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      120.0,
      100.0,
      720.0,
      680.0
    ],
    "openinpresentation": 1,
    "default_fontsize": 10.0,
    "gridsize": [
      8.0,
      8.0
    ],
    "boxes": [
      {
        "box": {
          "id": "obj-1",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12.0,
            2.0,
            200.0,
            18.0
          ],
          "text": "CRUCIBLE",
          "presentation": 1,
          "presentation_rect": [
            12.0,
            2.0,
            200.0,
            16.0
          ],
          "fontface": 1,
          "fontsize": 13.0,
          "textcolor": [
            0.86,
            0.55,
            0.24,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-2",
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "signal"
          ],
          "patching_rect": [
            40.0,
            470.0,
            80.0,
            22.0
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 9,
              "minor": 0,
              "revision": 9,
              "architecture": "x64",
              "modernui": 1
            },
            "rect": [
              0.0,
              0.0,
              760.0,
              700.0
            ],
            "boxes": [
              {
                "box": {
                  "id": "obj-3",
                  "maxclass": "newobj",
                  "text": "in 1",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    40.0,
                    40.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-4",
                  "maxclass": "codebox",
                  "fontface": 0,
                  "fontname": "Lato",
                  "fontsize": 12.0,
                  "numinlets": 1,
                  "numoutlets": 2,
                  "outlettype": [
                    "",
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    90.0,
                    680.0,
                    520.0
                  ],
                  "style": "",
                  "code": "/* two additive spectral-morph oscillators. 8 positions, 16 harmonics.\n   MORPH interpolates harmonic bin amplitudes (tent basis = exact linear\n   spectral interp), all bins same phase. bin1=1 + weights sum to 1 ->\n   fundamental is constant (bass never thins). Two oscs summed. */\nParam morph(0);    Param morph2(0.35);  Param rips(0);  Param ripshape(0.3);\nParam pulsar(0);   Param formant(0.5);\nHistory mph(0);    History fsm(55);     History dph(0);\nHistory s_m1(0);   History s_m2(0.35);  History s_rp(0);  History s_rp2(0.3);\nHistory s_pu(0);   History s_fo(0.5);\nsr = samplerate; isr = 1/sr; nyq = sr*0.5; sc = 0.0022;\nf0in = fsm + 0.0016*(in1 - fsm); fsm = f0in; f0 = clamp(f0in, 8, nyq);\nm1 = s_m1 + sc*(morph  - s_m1); s_m1 = m1;\nm2 = s_m2 + sc*(morph2 - s_m2); s_m2 = m2;\nrps = s_rp + sc*(rips  - s_rp); s_rp = rps;\nshp = s_rp2 + sc*(ripshape - s_rp2); s_rp2 = shp;\npu  = s_pu + sc*(pulsar - s_pu); s_pu = pu;\nfo  = s_fo + sc*(formant - s_fo); s_fo = fo;\np1 = m1*7; p2 = m2*7;\nu0 = clamp(1 - abs(p1 - 0), 0, 1);\nu1 = clamp(1 - abs(p1 - 1), 0, 1);\nu2 = clamp(1 - abs(p1 - 2), 0, 1);\nu3 = clamp(1 - abs(p1 - 3), 0, 1);\nu4 = clamp(1 - abs(p1 - 4), 0, 1);\nu5 = clamp(1 - abs(p1 - 5), 0, 1);\nu6 = clamp(1 - abs(p1 - 6), 0, 1);\nu7 = clamp(1 - abs(p1 - 7), 0, 1);\nv0 = clamp(1 - abs(p2 - 0), 0, 1);\nv1 = clamp(1 - abs(p2 - 1), 0, 1);\nv2 = clamp(1 - abs(p2 - 2), 0, 1);\nv3 = clamp(1 - abs(p2 - 3), 0, 1);\nv4 = clamp(1 - abs(p2 - 4), 0, 1);\nv5 = clamp(1 - abs(p2 - 5), 0, 1);\nv6 = clamp(1 - abs(p2 - 6), 0, 1);\nv7 = clamp(1 - abs(p2 - 7), 0, 1);\naaf = 1/2200;\nmph = mph + f0*isr; mph = mph - floor(mph);\ndph = dph + 1/512; dph = dph - floor(dph);\nacc = 0; dacc = 0; nrm = 0.0001;\n/* h1 */\nakA = u0 + u1 + u2 + u3 + u4 + u5 + u6 + u7;\nakB = v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7;\nfk = f0*1; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 1*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 1*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h2 */\nakA = 0.5*u1 + 0.1*u2 + 0.65*u3 + 0.3*u4 + 0.707107*u6 + 0.5*u7;\nakB = 0.5*v1 + 0.1*v2 + 0.65*v3 + 0.3*v4 + 0.707107*v6 + 0.5*v7;\nfk = f0*2; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 2*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 2*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h3 */\nakA = u1 + 0.333*u2 + 0.4225*u3 + 0.85*u4 + 0.333333*u5 + 0.333333*u6 + 0.333333*u7;\nakB = v1 + 0.333*v2 + 0.4225*v3 + 0.85*v4 + 0.333333*v5 + 0.333333*v6 + 0.333333*v7;\nfk = f0*3; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 3*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 3*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h4 */\nakA = 0.75*u2 + 0.274625*u3 + 0.6*u4 + 4.32978e-17*u6 + 0.25*u7;\nakB = 0.75*v2 + 0.274625*v3 + 0.6*v4 + 4.32978e-17*v6 + 0.25*v7;\nfk = f0*4; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 4*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 4*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h5 */\nakA = 0.178506*u3 + 0.3*u4 + 0.2*u5 + 0.2*u6 + 0.2*u7;\nakB = 0.178506*v3 + 0.3*v4 + 0.2*v5 + 0.2*v6 + 0.2*v7;\nfk = f0*5; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 5*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 5*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h6 */\nakA = 0.116029*u3 + 0.45*u4 + 0.235702*u6 + 0.166667*u7;\nakB = 0.116029*v3 + 0.45*v4 + 0.235702*v6 + 0.166667*v7;\nfk = f0*6; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 6*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 6*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h7 */\nakA = 0.0754189*u3 + 0.55*u4 + 0.142857*u5 + 0.142857*u6 + 0.142857*u7;\nakB = 0.0754189*v3 + 0.55*v4 + 0.142857*v5 + 0.142857*v6 + 0.142857*v7;\nfk = f0*7; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 7*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 7*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h8 */\nakA = 0.0490223*u3 + 0.3*u4 + 4.32978e-17*u6 + 0.125*u7;\nakB = 0.0490223*v3 + 0.3*v4 + 4.32978e-17*v6 + 0.125*v7;\nfk = f0*8; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 8*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 8*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h9 */\nakA = 0.0318645*u3 + 0.12*u4 + 0.111111*u5 + 0.111111*u6 + 0.111111*u7;\nakB = 0.0318645*v3 + 0.12*v4 + 0.111111*v5 + 0.111111*v6 + 0.111111*v7;\nfk = f0*9; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 9*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 9*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h10 */\nakA = 0.0207119*u3 + 0.08*u4 + 0.141421*u6 + 0.1*u7;\nakB = 0.0207119*v3 + 0.08*v4 + 0.141421*v6 + 0.1*v7;\nfk = f0*10; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 10*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 10*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h11 */\nakA = 0.0134627*u3 + 0.0909091*u5 + 0.0909091*u6 + 0.0909091*u7;\nakB = 0.0134627*v3 + 0.0909091*v5 + 0.0909091*v6 + 0.0909091*v7;\nfk = f0*11; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 11*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 11*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h12 */\nakA = 0.00875078*u3 + 4.32978e-17*u6 + 0.0833333*u7;\nakB = 0.00875078*v3 + 4.32978e-17*v6 + 0.0833333*v7;\nfk = f0*12; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 12*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 12*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h13 */\nakA = 0.00568801*u3 + 0.0769231*u5 + 0.0769231*u6 + 0.0769231*u7;\nakB = 0.00568801*v3 + 0.0769231*v5 + 0.0769231*v6 + 0.0769231*v7;\nfk = f0*13; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 13*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 13*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h14 */\nakA = 0.00369721*u3 + 0.101015*u6 + 0.0714286*u7;\nakB = 0.00369721*v3 + 0.101015*v6 + 0.0714286*v7;\nfk = f0*14; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 14*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 14*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h15 */\nakA = 0.00240318*u3 + 0.0666667*u5 + 0.0666667*u6 + 0.0666667*u7;\nakB = 0.00240318*v3 + 0.0666667*v5 + 0.0666667*v6 + 0.0666667*v7;\nfk = f0*15; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 15*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 15*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* h16 */\nakA = 0.00156207*u3 + 4.32978e-17*u6 + 0.0625*u7;\nakB = 0.00156207*v3 + 4.32978e-17*v6 + 0.0625*v7;\nfk = f0*16; aa = clamp((nyq - fk)*aaf, 0, 1);\nak = (akA + akB)*aa;\npp = 16*mph; pp = pp - floor(pp);\nacc = acc + sin(pp*2*pi)*ak;\ndp = 16*dph; dp = dp - floor(dp);\ndacc = dacc + sin(dp*2*pi)*ak;\nnrm = nrm + ak*ak;\n/* each path: morph sum -> DRIVE (sat->fold) -> RIPS (tear only the non-peak regions) */\nsig  = acc * 0.25;\ndisp = dacc / (sqrt(nrm) + 0.5);\nduty = 0.08 + (1 - fo)*0.9; pg = 1/sqrt(duty + 0.05);\nwpa = (mph < duty) ? sin((mph/duty)*pi) : 0;\nsig = sig + (sig*wpa*pg - sig)*pu;\nwpd = (dph < duty) ? sin((dph/duty)*pi) : 0;\ndisp = disp + (disp*wpd*pg - disp)*pu;\ncnt = 1 + floor(shp*3.99);\nwa = clamp(1 - abs(sig)*3.5, 0, 1);\ncpa = mph*cnt; cpa = cpa - floor(cpa);\nga = pow(clamp(1 - abs(2*cpa - 1), 0, 1), 1 + shp*6);\nrpa = tanh(sig*(1.5 + rps*35));\nout1 = sig + (rpa - sig)*wa*ga*rps;\nwd = clamp(1 - abs(disp)*3.5, 0, 1);\ncpd = dph*cnt; cpd = cpd - floor(cpd);\ngd = pow(clamp(1 - abs(2*cpd - 1), 0, 1), 1 + shp*6);\nrpd = tanh(disp*(1.5 + rps*35));\nout2 = disp + (rpd - disp)*wd*gd*rps;\n"
                }
              },
              {
                "box": {
                  "id": "obj-5",
                  "maxclass": "newobj",
                  "text": "out 1",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    630.0,
                    44.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-6",
                  "maxclass": "newobj",
                  "text": "out 2",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    660.0,
                    44.0,
                    22.0
                  ]
                }
              }
            ],
            "lines": [
              {
                "patchline": {
                  "source": [
                    "obj-3",
                    0
                  ],
                  "destination": [
                    "obj-4",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-4",
                    0
                  ],
                  "destination": [
                    "obj-5",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-4",
                    1
                  ],
                  "destination": [
                    "obj-6",
                    0
                  ]
                }
              }
            ],
            "dependency_cache": [],
            "autosave": 0
          }
        }
      },
      {
        "box": {
          "id": "obj-7",
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            150.0,
            470.0,
            90.0,
            22.0
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 9,
              "minor": 0,
              "revision": 9,
              "architecture": "x64",
              "modernui": 1
            },
            "rect": [
              0.0,
              0.0,
              760.0,
              700.0
            ],
            "boxes": [
              {
                "box": {
                  "id": "obj-8",
                  "maxclass": "newobj",
                  "text": "in 1",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    40.0,
                    40.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-9",
                  "maxclass": "newobj",
                  "text": "in 2",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    100.0,
                    40.0,
                    40.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-10",
                  "maxclass": "codebox",
                  "fontface": 0,
                  "fontname": "Lato",
                  "fontsize": 12.0,
                  "numinlets": 2,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    90.0,
                    680.0,
                    520.0
                  ],
                  "style": "",
                  "code": "/* MODAL resonator bank (Fors Tela/Mass). in1=audio, in2=f0(Hz). out1=mono.\n   6 two-pole resonators tuned to f0*ratio, excited by the osc, summed.\n   RESONATE = dry/modal mix, TUNE = harmonic<->inharmonic, DECAY = ring time. */\nParam resonate(0); Param tune(0); Param decay(0.5);\nHistory s_re(0); History s_tn(0); History s_de(0.5);\nHistory a0(0); History b0(0);\nHistory a1(0); History b1(0);\nHistory a2(0); History b2(0);\nHistory a3(0); History b3(0);\nHistory a4(0); History b4(0);\nHistory a5(0); History b5(0);\nsr = samplerate; nyq = sr*0.5; sc = 0.0022; tp = 2*pi;\nre = s_re + sc*(resonate - s_re); s_re = re;\ntn = s_tn + sc*(tune - s_tn); s_tn = tn;\nde = s_de + sc*(decay - s_de); s_de = de;\nf0 = clamp(in2, 8, nyq);\nr = 0.9 + de*0.0985; rr = r*r; ig = 1 - r;\nexc = in1; acc = 0;\nrat = pow(1, 1 + tn*0.55);\nwf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;\ncf = 2*r*cos(wf);\nyo = exc*ig + cf*a0 - rr*b0;\nb0 = a0; a0 = yo;\nacc = acc + yo;\nrat = pow(2, 1 + tn*0.55);\nwf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;\ncf = 2*r*cos(wf);\nyo = exc*ig + cf*a1 - rr*b1;\nb1 = a1; a1 = yo;\nacc = acc + yo;\nrat = pow(3, 1 + tn*0.55);\nwf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;\ncf = 2*r*cos(wf);\nyo = exc*ig + cf*a2 - rr*b2;\nb2 = a2; a2 = yo;\nacc = acc + yo;\nrat = pow(4, 1 + tn*0.55);\nwf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;\ncf = 2*r*cos(wf);\nyo = exc*ig + cf*a3 - rr*b3;\nb3 = a3; a3 = yo;\nacc = acc + yo;\nrat = pow(5, 1 + tn*0.55);\nwf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;\ncf = 2*r*cos(wf);\nyo = exc*ig + cf*a4 - rr*b4;\nb4 = a4; a4 = yo;\nacc = acc + yo;\nrat = pow(6, 1 + tn*0.55);\nwf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;\ncf = 2*r*cos(wf);\nyo = exc*ig + cf*a5 - rr*b5;\nb5 = a5; a5 = yo;\nacc = acc + yo;\nmout = acc * 0.3;\nout1 = in1 + (mout - in1)*re;\n"
                }
              },
              {
                "box": {
                  "id": "obj-11",
                  "maxclass": "newobj",
                  "text": "out 1",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    630.0,
                    44.0,
                    22.0
                  ]
                }
              }
            ],
            "lines": [
              {
                "patchline": {
                  "source": [
                    "obj-8",
                    0
                  ],
                  "destination": [
                    "obj-10",
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
                    "obj-10",
                    1
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-10",
                    0
                  ],
                  "destination": [
                    "obj-11",
                    0
                  ]
                }
              }
            ],
            "dependency_cache": [],
            "autosave": 0
          }
        }
      },
      {
        "box": {
          "id": "obj-12",
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            260.0,
            470.0,
            80.0,
            22.0
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 9,
              "minor": 0,
              "revision": 9,
              "architecture": "x64",
              "modernui": 1
            },
            "rect": [
              0.0,
              0.0,
              760.0,
              700.0
            ],
            "boxes": [
              {
                "box": {
                  "id": "obj-13",
                  "maxclass": "newobj",
                  "text": "in 1",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    40.0,
                    40.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-14",
                  "maxclass": "codebox",
                  "fontface": 0,
                  "fontname": "Lato",
                  "fontsize": 12.0,
                  "numinlets": 1,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    90.0,
                    680.0,
                    520.0
                  ],
                  "style": "",
                  "code": "/* DRIVE saturation (Roar-like). in1=audio, out1=mono.\n   AMOUNT = drive (subtle, squared), CHARACTER = soft->asymmetric->fold,\n   FEEDBACK = bounded saturating loop (saturator clamps it -> screams, never blows up). */\nParam amount(0); Param character(0); Param feedback(0);\nHistory fb(0); History dcx(0); History dcy(0);\nHistory s_am(0); History s_ch(0); History s_fb(0);\nsr = samplerate; sc = 0.0022;\nam  = s_am + sc*(amount    - s_am); s_am = am;\nch  = s_ch + sc*(character - s_ch); s_ch = ch;\nfbk = s_fb + sc*(feedback  - s_fb); s_fb = fbk;\ndrv = 1 + am*am*6;\nx = (in1 + fb*fbk*0.85)*drv;\ns1 = tanh(x);\ns2 = tanh(x*1.3 + 0.4) - 0.379949;\ns3 = sin(x*1.05);\nca = clamp(ch*2, 0, 1); cb = clamp(ch*2 - 1, 0, 1);\nsh = s1 + (s2 - s1)*ca; sh = sh + (s3 - sh)*cb;\nhp = sh - dcx + 0.9995*dcy; dcx = sh; dcy = hp; fb = hp;\nwet = sh*(0.7 + 0.3/drv);\nout1 = in1 + (wet - in1)*clamp(am*1.6, 0, 1);\n"
                }
              },
              {
                "box": {
                  "id": "obj-15",
                  "maxclass": "newobj",
                  "text": "out 1",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    630.0,
                    44.0,
                    22.0
                  ]
                }
              }
            ],
            "lines": [
              {
                "patchline": {
                  "source": [
                    "obj-13",
                    0
                  ],
                  "destination": [
                    "obj-14",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-14",
                    0
                  ],
                  "destination": [
                    "obj-15",
                    0
                  ]
                }
              }
            ],
            "dependency_cache": [],
            "autosave": 0
          }
        }
      },
      {
        "box": {
          "id": "obj-16",
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "signal"
          ],
          "patching_rect": [
            360.0,
            470.0,
            80.0,
            22.0
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 9,
              "minor": 0,
              "revision": 9,
              "architecture": "x64",
              "modernui": 1
            },
            "rect": [
              0.0,
              0.0,
              760.0,
              700.0
            ],
            "boxes": [
              {
                "box": {
                  "id": "obj-17",
                  "maxclass": "newobj",
                  "text": "in 1",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    40.0,
                    40.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-18",
                  "maxclass": "codebox",
                  "fontface": 0,
                  "fontname": "Lato",
                  "fontsize": 12.0,
                  "numinlets": 1,
                  "numoutlets": 2,
                  "outlettype": [
                    "",
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    90.0,
                    680.0,
                    520.0
                  ],
                  "style": "",
                  "code": "/* amp ADSR (gen~).  in1 = gate (0/1).\n   out1 = 0..1 envelope (drives the amp).  out2 = display sweep of the CURRENT\n   ADSR shape (always on, independent of playing) for the envelope-graph scope. */\nParam attack(0.02); Param adecay(0.25); Param sustain(0.7); Param release(0.3);\nHistory env(0); History stg(0); History pg(0); History eph(0);\nsr = samplerate;\nasec = 0.002 + attack*3; dsec = 0.002 + adecay*3; rsec = 0.002 + release*4;\ng = (in1 > 0.5);\nrising = (g > 0.5) * (pg < 0.5); pg = g;\nstg = (rising > 0.5) ? 1 : ((g < 0.5) ? 0 : stg);\nainc = 1/(asec*sr); dinc = 1/(dsec*sr); rinc = 1/(rsec*sr);\nenv = (stg == 1) ? clamp(env + ainc, 0, 1) : ((stg == 2) ? clamp(env - dinc, sustain, 1) : clamp(env - rinc, 0, 1));\nstg = ((stg == 1)*(env >= 1) > 0.5) ? 2 : stg;\nout1 = env;\n/* ---- envelope-shape display sweep (512-sample window = scope buffer) ---- */\neph = eph + 1/512; eph = eph - floor(eph);\ntS = 0.22*(asec + dsec + rsec) + 0.03;\ntot = asec + dsec + tS + rsec;\ntd = eph*tot;\nvA = td/asec;\nvD = 1 + (sustain - 1)*((td - asec)/dsec);\nvR = sustain*(1 - (td - asec - dsec - tS)/rsec);\nev = (td < asec) ? vA : ((td < asec + dsec) ? vD : ((td < asec + dsec + tS) ? sustain : vR));\nout2 = clamp(ev, 0, 1);\n"
                }
              },
              {
                "box": {
                  "id": "obj-19",
                  "maxclass": "newobj",
                  "text": "out 1",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    630.0,
                    44.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-20",
                  "maxclass": "newobj",
                  "text": "out 2",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    660.0,
                    44.0,
                    22.0
                  ]
                }
              }
            ],
            "lines": [
              {
                "patchline": {
                  "source": [
                    "obj-17",
                    0
                  ],
                  "destination": [
                    "obj-18",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-18",
                    0
                  ],
                  "destination": [
                    "obj-19",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-18",
                    1
                  ],
                  "destination": [
                    "obj-20",
                    0
                  ]
                }
              }
            ],
            "dependency_cache": [],
            "autosave": 0
          }
        }
      },
      {
        "box": {
          "id": "obj-21",
          "maxclass": "newobj",
          "text": "gen~",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            260.0,
            560.0,
            80.0,
            22.0
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 9,
              "minor": 0,
              "revision": 9,
              "architecture": "x64",
              "modernui": 1
            },
            "rect": [
              0.0,
              0.0,
              760.0,
              700.0
            ],
            "boxes": [
              {
                "box": {
                  "id": "obj-22",
                  "maxclass": "newobj",
                  "text": "in 1",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    40.0,
                    40.0,
                    22.0
                  ]
                }
              },
              {
                "box": {
                  "id": "obj-23",
                  "maxclass": "codebox",
                  "fontface": 0,
                  "fontname": "Lato",
                  "fontsize": 12.0,
                  "numinlets": 1,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    40.0,
                    90.0,
                    680.0,
                    520.0
                  ],
                  "style": "",
                  "code": "/* parallel multiband crush + 3 parallel band-OTTs.  in1=audio, out1=mono.\n   CRUSH = bit+sample-rate reduction, heaviest on the LOW band.\n   GRIND = depth of the 3 parallel per-band OTTs. */\nParam crush(0);\nParam grind(0);\nHistory xlo(0); History xhi(0);\nHistory phlo(0); History phmid(0); History phhi(0);\nHistory shlo(0); History shmid(0); History shhi(0);\nHistory elo(0); History emid(0); History ehi(0);\nHistory s_cr(0); History s_gr(0);\nsr = samplerate; sc = 0.0022;\ncr = s_cr + sc*(crush - s_cr); s_cr = cr;\ngr = s_gr + sc*(grind - s_gr); s_gr = gr;\nloc = 1 - exp(-2*pi*200/sr);\nhic = 1 - exp(-2*pi*2000/sr);\natk = 0.01; rel = 0.0009; tgt = 0.2;\nxlo = xlo + loc*(in1 - xlo); blo = xlo;\nxhi = xhi + hic*(in1 - xhi); bml = xhi;\nbhi = in1 - bml; bmid = bml - blo;\nsrl = 1 - cr*0.92;\nphlo = phlo + srl; tlo = (phlo >= 1); phlo = phlo - (tlo ? floor(phlo) : 0);\nlevlo = pow(2, 12 - cr*10); shlo = tlo ? (round(blo*levlo)/levlo) : shlo;\nsrm = 1 - cr*0.7;\nphmid = phmid + srm; tmid = (phmid >= 1); phmid = phmid - (tmid ? floor(phmid) : 0);\nlevmid = pow(2, 12 - cr*7); shmid = tmid ? (round(bmid*levmid)/levmid) : shmid;\nsrh = 1 - cr*0.4;\nphhi = phhi + srh; thi = (phhi >= 1); phhi = phhi - (thi ? floor(phhi) : 0);\nlevhi = pow(2, 12 - cr*4); shhi = thi ? (round(bhi*levhi)/levhi) : shhi;\nael = abs(shlo);  elo  = (ael > elo)  ? elo  + atk*(ael-elo)  : elo  + rel*(ael-elo);\naem = abs(shmid); emid = (aem > emid) ? emid + atk*(aem-emid) : emid + rel*(aem-emid);\naeh = abs(shhi);  ehi  = (aeh > ehi)  ? ehi  + atk*(aeh-ehi)  : ehi  + rel*(aeh-ehi);\nglo  = clamp(pow((tgt+0.0001)/(elo+0.0001),  gr*0.7), 0.3, 6);\ngmid = clamp(pow((tgt+0.0001)/(emid+0.0001), gr*0.7), 0.3, 6);\nghi  = clamp(pow((tgt+0.0001)/(ehi+0.0001),  gr*0.7), 0.3, 6);\nsig = shlo*glo + shmid*gmid + shhi*ghi;\nout1 = tanh(sig*0.9);\n"
                }
              },
              {
                "box": {
                  "id": "obj-24",
                  "maxclass": "newobj",
                  "text": "out 1",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    40.0,
                    630.0,
                    44.0,
                    22.0
                  ]
                }
              }
            ],
            "lines": [
              {
                "patchline": {
                  "source": [
                    "obj-22",
                    0
                  ],
                  "destination": [
                    "obj-23",
                    0
                  ]
                }
              },
              {
                "patchline": {
                  "source": [
                    "obj-23",
                    0
                  ],
                  "destination": [
                    "obj-24",
                    0
                  ]
                }
              }
            ],
            "dependency_cache": [],
            "autosave": 0
          }
        }
      },
      {
        "box": {
          "id": "obj-25",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 3,
          "patching_rect": [
            40.0,
            360.0,
            90.0,
            20.0
          ],
          "outlettype": [
            "int",
            "int",
            "int"
          ],
          "text": "notein"
        }
      },
      {
        "box": {
          "id": "obj-26",
          "maxclass": "kslider",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            150.0,
            360.0,
            224.0,
            53.0
          ],
          "outlettype": [
            "",
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-27",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            40.0,
            395.0,
            50.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "mtof"
        }
      },
      {
        "box": {
          "id": "obj-28",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            40.0,
            425.0,
            50.0,
            20.0
          ],
          "outlettype": [
            "signal"
          ],
          "text": "sig~"
        }
      },
      {
        "box": {
          "id": "obj-29",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            40.0,
            510.0,
            60.0,
            22.0
          ],
          "outlettype": [
            "signal"
          ],
          "text": "*~"
        }
      },
      {
        "box": {
          "id": "obj-30",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "patching_rect": [
            150.0,
            395.0,
            40.0,
            20.0
          ],
          "outlettype": [
            "int"
          ],
          "text": "> 0"
        }
      },
      {
        "box": {
          "id": "obj-31",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            150.0,
            420.0,
            50.0,
            20.0
          ],
          "outlettype": [
            "signal"
          ],
          "text": "sig~"
        }
      },
      {
        "box": {
          "id": "obj-32",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12.0,
            20.0,
            100.0,
            16.0
          ],
          "text": "OSC",
          "presentation": 1,
          "presentation_rect": [
            12.0,
            20.0,
            100.0,
            14.0
          ],
          "fontface": 1,
          "fontsize": 10.0,
          "textcolor": [
            0.72,
            0.53,
            0.33,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-33",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            12.0,
            120.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            12.0,
            33.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "morph",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Morph 1",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Morph 1",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-34",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            12.0,
            184.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend morph"
        }
      },
      {
        "box": {
          "id": "obj-35",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            72.0,
            120.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            72.0,
            33.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "morph2",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.35
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Morph 2",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Morph 2",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-36",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            72.0,
            184.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend morph2"
        }
      },
      {
        "box": {
          "id": "obj-37",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            132.0,
            120.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            132.0,
            33.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "pulsar",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Pulsar",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Pulsar",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-38",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            132.0,
            184.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend pulsar"
        }
      },
      {
        "box": {
          "id": "obj-39",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            192.0,
            120.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            192.0,
            33.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "formant",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.5
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Formant",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Formant",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-40",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            192.0,
            184.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend formant"
        }
      },
      {
        "box": {
          "id": "obj-41",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            252.0,
            120.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            252.0,
            33.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "rips",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Rips",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Rips",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-42",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            252.0,
            184.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend rips"
        }
      },
      {
        "box": {
          "id": "obj-43",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            312.0,
            120.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            312.0,
            33.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "ripshape",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.3
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Shape",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Shape",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-44",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            312.0,
            184.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend ripshape"
        }
      },
      {
        "box": {
          "id": "obj-45",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            12.0,
            91.0,
            100.0,
            16.0
          ],
          "text": "MODAL",
          "presentation": 1,
          "presentation_rect": [
            12.0,
            91.0,
            100.0,
            14.0
          ],
          "fontface": 1,
          "fontsize": 10.0,
          "textcolor": [
            0.72,
            0.53,
            0.33,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-46",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            12.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            12.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "resonate",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Resonate",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Reson",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-47",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            12.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend resonate"
        }
      },
      {
        "box": {
          "id": "obj-48",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            72.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            72.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "tune",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Tune",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Tune",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-49",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            72.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend tune"
        }
      },
      {
        "box": {
          "id": "obj-50",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            132.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            132.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "decay",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.5
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Ring",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Ring",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-51",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            132.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend decay"
        }
      },
      {
        "box": {
          "id": "obj-52",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            200.0,
            91.0,
            100.0,
            16.0
          ],
          "text": "SATURATION",
          "presentation": 1,
          "presentation_rect": [
            200.0,
            91.0,
            100.0,
            14.0
          ],
          "fontface": 1,
          "fontsize": 10.0,
          "textcolor": [
            0.72,
            0.53,
            0.33,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-53",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            200.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            200.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "amount",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Amount",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Amount",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-54",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            200.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend amount"
        }
      },
      {
        "box": {
          "id": "obj-55",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            260.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            260.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "character",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Character",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Charactr",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-56",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            260.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend character"
        }
      },
      {
        "box": {
          "id": "obj-57",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            320.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            320.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "feedback",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Feedback",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Feedbk",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-58",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            320.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend feedback"
        }
      },
      {
        "box": {
          "id": "obj-59",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            388.0,
            91.0,
            100.0,
            16.0
          ],
          "text": "GRIND",
          "presentation": 1,
          "presentation_rect": [
            388.0,
            91.0,
            100.0,
            14.0
          ],
          "fontface": 1,
          "fontsize": 10.0,
          "textcolor": [
            0.72,
            0.53,
            0.33,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-60",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            388.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            388.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "crush",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Crush",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Crush",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-61",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            388.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend crush"
        }
      },
      {
        "box": {
          "id": "obj-62",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            448.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            448.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "grind",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.0
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Grind",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Grind",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-63",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            448.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend grind"
        }
      },
      {
        "box": {
          "id": "obj-64",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            532.0,
            20.0,
            100.0,
            16.0
          ],
          "text": "AMP",
          "presentation": 1,
          "presentation_rect": [
            532.0,
            20.0,
            100.0,
            14.0
          ],
          "fontface": 1,
          "fontsize": 10.0,
          "textcolor": [
            0.72,
            0.53,
            0.33,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-65",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            532.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            532.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "attack",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.02
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Attack",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Attack",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-66",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            532.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend attack"
        }
      },
      {
        "box": {
          "id": "obj-67",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            592.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            592.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "adecay",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.25
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Decay",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Decay",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-68",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            592.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend adecay"
        }
      },
      {
        "box": {
          "id": "obj-69",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            652.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            652.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "sustain",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.7
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Sustain",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Sustain",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-70",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            652.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend sustain"
        }
      },
      {
        "box": {
          "id": "obj-71",
          "maxclass": "live.dial",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            712.0,
            210.0,
            48.0,
            48.0
          ],
          "outlettype": [
            ""
          ],
          "presentation": 1,
          "presentation_rect": [
            712.0,
            105.0,
            52.0,
            54.0
          ],
          "parameter_enable": 1,
          "varname": "release",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_initial": [
                0.3
              ],
              "parameter_initial_enable": 1,
              "parameter_longname": "Release",
              "parameter_mmax": 1.0,
              "parameter_mmin": 0.0,
              "parameter_modmode": 0,
              "parameter_shortname": "Release",
              "parameter_type": 0,
              "parameter_unitstyle": 1
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-72",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            712.0,
            274.0,
            110.0,
            20.0
          ],
          "outlettype": [
            ""
          ],
          "text": "prepend release"
        }
      },
      {
        "box": {
          "id": "obj-73",
          "maxclass": "scope~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            420.0,
            320.0,
            290.0,
            74.0
          ],
          "presentation": 1,
          "presentation_rect": [
            532.0,
            33.0,
            232.0,
            66.0
          ],
          "range": [
            -0.05,
            1.05
          ],
          "bufsize": 512,
          "calccount": 1,
          "bgcolor": [
            0.08,
            0.08,
            0.09,
            1.0
          ],
          "gridcolor": [
            0.08,
            0.08,
            0.09,
            1.0
          ],
          "fgcolor": [
            1.0,
            0.66,
            0.28,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-74",
          "maxclass": "live.gain~",
          "numinlets": 2,
          "numoutlets": 2,
          "patching_rect": [
            300.0,
            560.0,
            48.0,
            90.0
          ],
          "outlettype": [
            "signal",
            "signal"
          ],
          "presentation": 1,
          "presentation_rect": [
            776.0,
            24.0,
            40.0,
            130.0
          ],
          "parameter_enable": 1,
          "varname": "master_gain",
          "saved_attribute_attributes": {
            "valueof": {
              "parameter_longname": "Gain",
              "parameter_shortname": "Gain",
              "parameter_mmin": -70.0,
              "parameter_mmax": 6.0,
              "parameter_type": 0,
              "parameter_unitstyle": 4,
              "parameter_initial_enable": 1,
              "parameter_initial": [
                -6.0
              ]
            }
          }
        }
      },
      {
        "box": {
          "id": "obj-75",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            376.0,
            20.0,
            100.0,
            16.0
          ],
          "text": "WAVE",
          "presentation": 1,
          "presentation_rect": [
            376.0,
            20.0,
            100.0,
            14.0
          ],
          "fontface": 1,
          "fontsize": 10.0,
          "textcolor": [
            0.72,
            0.53,
            0.33,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-76",
          "maxclass": "scope~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            420.0,
            250.0,
            290.0,
            74.0
          ],
          "presentation": 1,
          "presentation_rect": [
            376.0,
            33.0,
            146.0,
            54.0
          ],
          "range": [
            -0.9,
            0.9
          ],
          "bufsize": 512,
          "calccount": 1,
          "bgcolor": [
            0.08,
            0.08,
            0.09,
            1.0
          ],
          "gridcolor": [
            0.08,
            0.08,
            0.09,
            1.0
          ],
          "fgcolor": [
            1.0,
            0.66,
            0.28,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-77",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            420.0,
            590.0,
            110.0,
            20.0
          ],
          "text": "plugout~ 1 2"
        }
      },
      {
        "box": {
          "id": "obj-78",
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            420.0,
            620.0,
            45.0,
            45.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-79",
          "maxclass": "toggle",
          "numinlets": 1,
          "numoutlets": 1,
          "patching_rect": [
            420.0,
            560.0,
            24.0,
            24.0
          ],
          "outlettype": [
            "int"
          ]
        }
      },
      {
        "box": {
          "id": "obj-80",
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            450.0,
            562.0,
            340.0,
            16.0
          ],
          "text": "AUDITION - standalone Max only (Ctrl/Cmd+E); OFF in Ableton",
          "fontsize": 9.0,
          "textcolor": [
            0.6,
            0.56,
            0.5,
            1.0
          ]
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "obj-25",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-26",
            0
          ],
          "destination": [
            "obj-27",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-27",
            0
          ],
          "destination": [
            "obj-28",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-28",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-2",
            0
          ],
          "destination": [
            "obj-29",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-25",
            1
          ],
          "destination": [
            "obj-30",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-26",
            1
          ],
          "destination": [
            "obj-30",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-30",
            0
          ],
          "destination": [
            "obj-31",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-31",
            0
          ],
          "destination": [
            "obj-16",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-16",
            0
          ],
          "destination": [
            "obj-29",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-33",
            0
          ],
          "destination": [
            "obj-34",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-34",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-35",
            0
          ],
          "destination": [
            "obj-36",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-36",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-37",
            0
          ],
          "destination": [
            "obj-38",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-38",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-39",
            0
          ],
          "destination": [
            "obj-40",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-40",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-41",
            0
          ],
          "destination": [
            "obj-42",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-42",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-43",
            0
          ],
          "destination": [
            "obj-44",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-44",
            0
          ],
          "destination": [
            "obj-2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-46",
            0
          ],
          "destination": [
            "obj-47",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-47",
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
            "obj-48",
            0
          ],
          "destination": [
            "obj-49",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-49",
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
            "obj-50",
            0
          ],
          "destination": [
            "obj-51",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-51",
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
            "obj-53",
            0
          ],
          "destination": [
            "obj-54",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-54",
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
            "obj-55",
            0
          ],
          "destination": [
            "obj-56",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-56",
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
            "obj-57",
            0
          ],
          "destination": [
            "obj-58",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-58",
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
            "obj-60",
            0
          ],
          "destination": [
            "obj-61",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-61",
            0
          ],
          "destination": [
            "obj-21",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-62",
            0
          ],
          "destination": [
            "obj-63",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-63",
            0
          ],
          "destination": [
            "obj-21",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-65",
            0
          ],
          "destination": [
            "obj-66",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-66",
            0
          ],
          "destination": [
            "obj-16",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-67",
            0
          ],
          "destination": [
            "obj-68",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-68",
            0
          ],
          "destination": [
            "obj-16",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-69",
            0
          ],
          "destination": [
            "obj-70",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-70",
            0
          ],
          "destination": [
            "obj-16",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-71",
            0
          ],
          "destination": [
            "obj-72",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-72",
            0
          ],
          "destination": [
            "obj-16",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-29",
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
            "obj-28",
            0
          ],
          "destination": [
            "obj-7",
            1
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
            "obj-21",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-21",
            0
          ],
          "destination": [
            "obj-74",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-21",
            0
          ],
          "destination": [
            "obj-74",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-2",
            1
          ],
          "destination": [
            "obj-76",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-16",
            1
          ],
          "destination": [
            "obj-73",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            0
          ],
          "destination": [
            "obj-77",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            1
          ],
          "destination": [
            "obj-77",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            0
          ],
          "destination": [
            "obj-78",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-74",
            1
          ],
          "destination": [
            "obj-78",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-79",
            0
          ],
          "destination": [
            "obj-78",
            0
          ]
        }
      }
    ],
    "parameters": {
      "obj-33": [
        "Morph 1",
        "Morph 1",
        0
      ],
      "obj-35": [
        "Morph 2",
        "Morph 2",
        1
      ],
      "obj-37": [
        "Pulsar",
        "Pulsar",
        2
      ],
      "obj-39": [
        "Formant",
        "Formant",
        3
      ],
      "obj-41": [
        "Rips",
        "Rips",
        4
      ],
      "obj-43": [
        "Shape",
        "Shape",
        5
      ],
      "obj-46": [
        "Resonate",
        "Reson",
        6
      ],
      "obj-48": [
        "Tune",
        "Tune",
        7
      ],
      "obj-50": [
        "Ring",
        "Ring",
        8
      ],
      "obj-53": [
        "Amount",
        "Amount",
        9
      ],
      "obj-55": [
        "Character",
        "Charactr",
        10
      ],
      "obj-57": [
        "Feedback",
        "Feedbk",
        11
      ],
      "obj-60": [
        "Crush",
        "Crush",
        12
      ],
      "obj-62": [
        "Grind",
        "Grind",
        13
      ],
      "obj-65": [
        "Attack",
        "Attack",
        14
      ],
      "obj-67": [
        "Decay",
        "Decay",
        15
      ],
      "obj-69": [
        "Sustain",
        "Sustain",
        16
      ],
      "obj-71": [
        "Release",
        "Release",
        17
      ],
      "obj-74": [
        "Gain",
        "Gain",
        18
      ],
      "inherited_shortname": 1
    },
    "dependency_cache": [],
    "autosave": 0,
    "is_mpe": 0,
    "latency": 0,
    "project": {
      "version": 1,
      "creationdate": 3590000000,
      "modificationdate": 3590000000,
      "viewrect": [
        0.0,
        0.0,
        300.0,
        500.0
      ],
      "autoorganize": 1,
      "hideprojectwindow": 1,
      "showdependencies": 1,
      "autolocalize": 0,
      "contents": {
        "patchers": {},
        "code": {}
      },
      "layout": {},
      "searchpath": {},
      "detailsvisible": 0,
      "amxdtype": 1768515945,
      "readonly": 0,
      "devpathtype": 0,
      "devpath": ".",
      "sortmode": 0,
      "viewmode": 0,
      "includepackages": 0
    },
    "oscreceiveudpport": 0
  }
}