#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_crucible.py  -  CRUCIBLE bass spectral-morph synth.

OSC = two additive spectral-morph oscillators (Serum-wavetable style).
Each position is a vector of harmonic BIN amplitudes (all same phase, all
positive); a single MORPH knob linearly interpolates the bins between positions
(tent-basis = exact linear spectral interpolation), so the timbre glides
perfectly smoothly. Because bin 1 = 1 in every position and the interpolation
weights sum to 1, the FUNDAMENTAL is mathematically constant -> the bass never
thins, only the harmonics morph. Two oscs (MORPH 1 / MORPH 2), same pitch, summed.
DRIVE = global sat->fold.

FX  = 6x series OTT (AMOUNT / COLOR) -> parallel multiband GRIND (CRUSH / GRIND).
Live scope. All params smoothed; soft AA near Nyquist. ~140px, no bg panel.
"""

import json, struct, os, math

HERE = os.path.dirname(os.path.abspath(__file__))
APPVERSION = {"major": 9, "minor": 0, "revision": 9, "architecture": "x64", "modernui": 1}
AMXDTYPE_INSTRUMENT = 0x69696969  # "iiii"

# ── morph positions: harmonic BIN amplitudes, built from math (bin1=1 = anchored) ──
NH = 16
def _sinc(x):  return 1.0 if abs(x) < 1e-9 else math.sin(math.pi * x) / (math.pi * x)
def _pad(a):   return (list(a) + [0.0] * NH)[:NH]
def _n1(a):    return [v / a[0] for v in a]            # normalise so bin1 = 1 (anchor)
POS = [
    _pad([1]),                                                       # 0 sine
    _pad([1, 0.5, 1]),                                               # 1 (user)
    _pad([1, 0.1, 0.333, 0.75]),                                     # 2 (user)
    _pad([0.65 ** k for k in range(NH)]),                            # 3 organ  (exp decay 0.65^(k-1))
    _pad([1, 0.3, 0.85, 0.6, 0.3, 0.45, 0.55, 0.3, 0.12, 0.08]),     # 4 vowel  (two formant humps)
    _n1(_pad([(1.0 / (k + 1) if k % 2 == 0 else 0.0) for k in range(NH)])),  # 5 square (odd 1/k)
    _n1(_pad([abs(_sinc((k + 1) * 0.25)) for k in range(NH)])),      # 6 pulse  (25% pulse, sinc envelope)
    _pad([1.0 / (k + 1) for k in range(NH)]),                        # 7 saw    (1/k)
]
KP = len(POS)    # positions

# ───────────────────────── box / line helpers ─────────────────────────
_counter = [0]
def nid():
    _counter[0] += 1
    return "obj-%d" % _counter[0]

boxes, lines = [], []

def add_box(maxclass, *, text=None, code=None, rect, pres=None, numinlets=1,
            numoutlets=0, outlettype=None, oid=None, extra=None):
    b = {"id": oid or nid(), "maxclass": maxclass, "numinlets": numinlets,
         "numoutlets": numoutlets, "patching_rect": [float(v) for v in rect]}
    if outlettype is not None: b["outlettype"] = outlettype
    if text is not None: b["text"] = text
    if code is not None: b["code"] = code
    if pres is not None:
        b["presentation"] = 1
        b["presentation_rect"] = [float(v) for v in pres]
    if extra: b.update(extra)
    boxes.append({"box": b})
    return b["id"]

def connect(src, so, dst, di):
    lines.append({"patchline": {"source": [src, int(so)], "destination": [dst, int(di)]}})

# ───────────────────────── embedded gen~ ─────────────────────────
def gen_patcher(code, n_out, n_in=1):
    g, gl = [], []
    in_ids = []
    for j in range(n_in):
        iid = nid()
        g.append({"box": {"id": iid, "maxclass": "newobj", "text": "in %d" % (j + 1),
                          "numinlets": 0, "numoutlets": 1, "outlettype": [""],
                          "patching_rect": [40.0 + j * 60, 40.0, 40.0, 22.0]}})
        in_ids.append(iid)
    cb = nid()
    g.append({"box": {"id": cb, "maxclass": "codebox", "fontface": 0, "fontname": "Lato",
                      "fontsize": 12.0, "numinlets": n_in, "numoutlets": n_out,
                      "outlettype": [""] * n_out, "patching_rect": [40.0, 90.0, 680.0, 520.0],
                      "style": "", "code": code}})
    for j, iid in enumerate(in_ids):
        gl.append({"patchline": {"source": [iid, 0], "destination": [cb, j]}})
    for k in range(n_out):
        o = nid()
        g.append({"box": {"id": o, "maxclass": "newobj", "text": "out %d" % (k + 1),
                          "numinlets": 1, "numoutlets": 0,
                          "patching_rect": [40.0, 630.0 + k * 30, 44.0, 22.0]}})
        gl.append({"patchline": {"source": [cb, k], "destination": [o, 0]}})
    return {"fileversion": 1, "appversion": APPVERSION, "rect": [0.0, 0.0, 760.0, 700.0],
            "boxes": g, "lines": gl, "dependency_cache": [], "autosave": 0}

def add_gen(code, n_out, rect, n_in=1):
    bid = nid()
    boxes.append({"box": {"id": bid, "maxclass": "newobj", "text": "gen~",
                          "numinlets": n_in, "numoutlets": n_out, "outlettype": ["signal"] * n_out,
                          "patching_rect": [float(v) for v in rect], "patcher": gen_patcher(code, n_out, n_in)}})
    return bid

# ───────────────────────── live.dial macro ─────────────────────────
params_block = {}
_order = [0]
def live_dial(varname, longname, shortname, default, target_gen, x, y, px, py):
    valueof = {"parameter_initial": [float(default)], "parameter_initial_enable": 1,
               "parameter_longname": longname, "parameter_mmax": 1.0, "parameter_mmin": 0.0,
               "parameter_modmode": 0, "parameter_shortname": shortname,
               "parameter_type": 0, "parameter_unitstyle": 1}
    did = add_box("live.dial", rect=[x, y, 48, 48], pres=[px, py, 52, 54],
                  numinlets=1, numoutlets=1, outlettype=[""],
                  extra={"parameter_enable": 1, "varname": varname,
                         "saved_attribute_attributes": {"valueof": valueof}})
    pre = add_box("newobj", text="prepend " + varname, rect=[x, y + 64, 110, 20],
                  numinlets=1, numoutlets=1, outlettype=[""])
    connect(did, 0, pre, 0)
    connect(pre, 0, target_gen, 0)
    params_block[did] = [longname, shortname, _order[0]]
    _order[0] += 1
    return did

# ═══════════════════════════════════════════════════════════════════════
#  OSC - two additive spectral-morph oscillators (tent-basis bin interp)
# ═══════════════════════════════════════════════════════════════════════
def build_osc_code():
    L = ["/* two additive spectral-morph oscillators. %d positions, %d harmonics." % (KP, NH),
         "   MORPH interpolates harmonic bin amplitudes (tent basis = exact linear",
         "   spectral interp), all bins same phase. bin1=1 + weights sum to 1 ->",
         "   fundamental is constant (bass never thins). Two oscs summed. */",
         "Param morph(0);    Param morph2(0.35);  Param rips(0);  Param ripshape(0.3);",
         "Param pulsar(0);   Param formant(0.5);",
         "History mph(0);    History fsm(55);     History dph(0);",
         "History s_m1(0);   History s_m2(0.35);  History s_rp(0);  History s_rp2(0.3);",
         "History s_pu(0);   History s_fo(0.5);",
         "sr = samplerate; isr = 1/sr; nyq = sr*0.5; sc = 0.0022;",
         "f0in = fsm + 0.0016*(in1 - fsm); fsm = f0in; f0 = clamp(f0in, 8, nyq);",
         "m1 = s_m1 + sc*(morph  - s_m1); s_m1 = m1;",
         "m2 = s_m2 + sc*(morph2 - s_m2); s_m2 = m2;",
         "rps = s_rp + sc*(rips  - s_rp); s_rp = rps;",
         "shp = s_rp2 + sc*(ripshape - s_rp2); s_rp2 = shp;",
         "pu  = s_pu + sc*(pulsar - s_pu); s_pu = pu;",
         "fo  = s_fo + sc*(formant - s_fo); s_fo = fo;",
         "p1 = m1*%d; p2 = m2*%d;" % (KP - 1, KP - 1)]
    for j in range(KP):
        L.append("u%d = clamp(1 - abs(p1 - %d), 0, 1);" % (j, j))   # osc1 morph weights
    for j in range(KP):
        L.append("v%d = clamp(1 - abs(p2 - %d), 0, 1);" % (j, j))   # osc2 morph weights
    L += ["aaf = 1/2200;",
          "mph = mph + f0*isr; mph = mph - floor(mph);",
          "dph = dph + 1/512; dph = dph - floor(dph);",   # display phasor, period 512 = scope window
          "acc = 0; dacc = 0; nrm = 0.0001;"]
    for k in range(1, NH + 1):
        def terms(wpfx):
            t = []
            for j in range(KP):
                v = POS[j][k - 1]
                if v == 0: continue
                t.append("%s%d" % (wpfx, j) if v == 1 else "%.6g*%s%d" % (v, wpfx, j))
            return " + ".join(t) if t else "0"
        L += [
            "/* h%d */" % k,
            "akA = %s;" % terms("u"),
            "akB = %s;" % terms("v"),
            "fk = f0*%d; aa = clamp((nyq - fk)*aaf, 0, 1);" % k,
            "ak = (akA + akB)*aa;",
            "pp = %d*mph; pp = pp - floor(pp);" % k,
            "acc = acc + sin(pp*2*pi)*ak;",
            "dp = %d*dph; dp = dp - floor(dp);" % k,         # same harmonics at display phase
            "dacc = dacc + sin(dp*2*pi)*ak;",
            "nrm = nrm + ak*ak;",
        ]
    L += [
        "/* each path: morph sum -> DRIVE (sat->fold) -> RIPS (tear only the non-peak regions) */",
        "sig  = acc * 0.25;",                             # fundamental anchored by construction
        "disp = dacc / (sqrt(nrm) + 0.5);",               # normalised 1-cycle display trace
        "duty = 0.08 + (1 - fo)*0.9; pg = 1/sqrt(duty + 0.05);",  # PULSAR: FORMANT->duty + level-comp so it sweeps audibly
        "wpa = (mph < duty) ? sin((mph/duty)*pi) : 0;",   # pulsaret window (audio)
        "sig = sig + (sig*wpa*pg - sig)*pu;",
        "wpd = (dph < duty) ? sin((dph/duty)*pi) : 0;",   # pulsaret window (display)
        "disp = disp + (disp*wpd*pg - disp)*pu;",
        # ---- RIPS (on the clean morph signal; drive moved to its own DRIVE stage) ----
        "cnt = 1 + floor(shp*3.99);",                     # SHAPE -> 1..4 rips per cycle
        # ---- audio path ----
        "wa = clamp(1 - abs(sig)*3.5, 0, 1);",            # non-peak mask (|sig| high -> 0 -> peaks safe)
        "cpa = mph*cnt; cpa = cpa - floor(cpa);",         # rip phase: cnt windows per cycle
        "ga = pow(clamp(1 - abs(2*cpa - 1), 0, 1), 1 + shp*6);",  # rip window, sharper at high SHAPE
        "rpa = tanh(sig*(1.5 + rps*35));",                # the tear
        "out1 = sig + (rpa - sig)*wa*ga*rps;",
        # ---- display path (so the visualizer shows the rips) ----
        "wd = clamp(1 - abs(disp)*3.5, 0, 1);",
        "cpd = dph*cnt; cpd = cpd - floor(cpd);",
        "gd = pow(clamp(1 - abs(2*cpd - 1), 0, 1), 1 + shp*6);",
        "rpd = tanh(disp*(1.5 + rps*35));",
        "out2 = disp + (rpd - disp)*wd*gd*rps;",
    ]
    return "\n".join(L) + "\n"

# ═══════════════════════════════════════════════════════════════════════
#  6x OTT CHAIN (AMOUNT / COLOR)
# ═══════════════════════════════════════════════════════════════════════
def build_ott_code(n=6):
    L = ["/* 6x OTT chain on ONE macro (smoothed). OTT knob drives density + tone. */",
         "Param color(0);"]
    for i in range(n):
        for s in ("xlo", "xhi", "elo", "emid", "ehi"):
            L.append("History %s%d(0);" % (s, i))
    L += ["History s_col(0);",
          "sr = samplerate;",
          "loc = 1 - exp(-2*pi*250/sr);",
          "hic = 1 - exp(-2*pi*2500/sr);",
          "atk = 0.01; rel = 0.0008; sc = 0.0022;",
          "mo = s_col + sc*(color  - s_col); s_col = mo;",
          "am = mo;",                                     # single OTT knob drives density too
          "tgt = 0.10 + mo*0.14;",
          "sig = in1;"]
    for i in range(n):
        t = round(i * 0.07, 4)
        dirn = 1 if i % 2 == 0 else -1
        L += [
            "/* OTT %d */" % i,
            "xlo%d = xlo%d + loc*(sig - xlo%d); blo = xlo%d;" % (i, i, i, i),
            "xhi%d = xhi%d + hic*(sig - xhi%d); bml = xhi%d;" % (i, i, i, i),
            "bhi = sig - bml; bmid = bml - blo;",
            "al = abs(blo);  elo%d  = (al > elo%d)  ? elo%d  + atk*(al-elo%d)  : elo%d  + rel*(al-elo%d);" % (i, i, i, i, i, i),
            "am2 = abs(bmid); emid%d = (am2 > emid%d) ? emid%d + atk*(am2-emid%d) : emid%d + rel*(am2-emid%d);" % (i, i, i, i, i, i),
            "ah = abs(bhi);  ehi%d  = (ah > ehi%d)  ? ehi%d  + atk*(ah-ehi%d)  : ehi%d  + rel*(ah-ehi%d);" % (i, i, i, i, i, i),
            "wet%d = clamp((am - %g)*1.8, 0, 1);" % (i, t),
            "dep%d = 0.18 + am*0.5 + mo*0.15;" % i,
            "tb%d = (mo - 0.5)*%d;" % (i, dirn),
            "gl = clamp(pow((tgt+0.0001)/(elo%d+0.0001), dep%d), 0.2, 10);" % (i, i),
            "gm = clamp(pow((tgt+0.0001)/(emid%d+0.0001), dep%d), 0.2, 10);" % (i, i),
            "gh = clamp(pow((tgt+0.0001)/(ehi%d+0.0001), dep%d), 0.2, 10);" % (i, i),
            "ott = blo*gl*(1 - tb%d*0.6) + bmid*gm + bhi*gh*(1 + tb%d*0.6);" % (i, i),
            "sig = sig + (ott - sig)*wet%d;" % i,
        ]
    L += ["out1 = tanh(sig*0.8);"]
    return "\n".join(L) + "\n"

# ═══════════════════════════════════════════════════════════════════════
#  GRIND - parallel multiband: bitcrush (heaviest on lows) + parallel band-OTTs
# ═══════════════════════════════════════════════════════════════════════
def build_grind_code():
    L = ["/* parallel multiband crush + 3 parallel band-OTTs.  in1=audio, out1=mono.",
         "   CRUSH = bit+sample-rate reduction, heaviest on the LOW band.",
         "   GRIND = depth of the 3 parallel per-band OTTs. */",
         "Param crush(0);", "Param grind(0);",
         "History xlo(0); History xhi(0);",
         "History phlo(0); History phmid(0); History phhi(0);",
         "History shlo(0); History shmid(0); History shhi(0);",
         "History elo(0); History emid(0); History ehi(0);",
         "History s_cr(0); History s_gr(0);",
         "sr = samplerate; sc = 0.0022;",
         "cr = s_cr + sc*(crush - s_cr); s_cr = cr;",
         "gr = s_gr + sc*(grind - s_gr); s_gr = gr;",
         "loc = 1 - exp(-2*pi*200/sr);",
         "hic = 1 - exp(-2*pi*2000/sr);",
         "atk = 0.01; rel = 0.0009; tgt = 0.2;",
         "xlo = xlo + loc*(in1 - xlo); blo = xlo;",
         "xhi = xhi + hic*(in1 - xhi); bml = xhi;",
         "bhi = in1 - bml; bmid = bml - blo;",
         "srl = 1 - cr*0.92;",
         "phlo = phlo + srl; tlo = (phlo >= 1); phlo = phlo - (tlo ? floor(phlo) : 0);",
         "levlo = pow(2, 12 - cr*10); shlo = tlo ? (round(blo*levlo)/levlo) : shlo;",
         "srm = 1 - cr*0.7;",
         "phmid = phmid + srm; tmid = (phmid >= 1); phmid = phmid - (tmid ? floor(phmid) : 0);",
         "levmid = pow(2, 12 - cr*7); shmid = tmid ? (round(bmid*levmid)/levmid) : shmid;",
         "srh = 1 - cr*0.4;",
         "phhi = phhi + srh; thi = (phhi >= 1); phhi = phhi - (thi ? floor(phhi) : 0);",
         "levhi = pow(2, 12 - cr*4); shhi = thi ? (round(bhi*levhi)/levhi) : shhi;",
         "ael = abs(shlo);  elo  = (ael > elo)  ? elo  + atk*(ael-elo)  : elo  + rel*(ael-elo);",
         "aem = abs(shmid); emid = (aem > emid) ? emid + atk*(aem-emid) : emid + rel*(aem-emid);",
         "aeh = abs(shhi);  ehi  = (aeh > ehi)  ? ehi  + atk*(aeh-ehi)  : ehi  + rel*(aeh-ehi);",
         "glo  = clamp(pow((tgt+0.0001)/(elo+0.0001),  gr*0.7), 0.3, 6);",
         "gmid = clamp(pow((tgt+0.0001)/(emid+0.0001), gr*0.7), 0.3, 6);",
         "ghi  = clamp(pow((tgt+0.0001)/(ehi+0.0001),  gr*0.7), 0.3, 6);",
         "sig = shlo*glo + shmid*gmid + shhi*ghi;",
         "out1 = tanh(sig*0.9);"]
    return "\n".join(L) + "\n"

# ═══════════════════════════════════════════════════════════════════════
#  MODAL - Fors "Tela/Mass" concept: a bank of tuned ringing resonators
#  excited by the osc = "an orchestra of resonant peaks".
# ═══════════════════════════════════════════════════════════════════════
def build_modal_code(n=6):
    L = ["/* MODAL resonator bank (Fors Tela/Mass). in1=audio, in2=f0(Hz). out1=mono.",
         "   %d two-pole resonators tuned to f0*ratio, excited by the osc, summed." % n,
         "   RESONATE = dry/modal mix, TUNE = harmonic<->inharmonic, DECAY = ring time. */",
         "Param resonate(0); Param tune(0); Param decay(0.5);",
         "History s_re(0); History s_tn(0); History s_de(0.5);"]
    for i in range(n):
        L.append("History a%d(0); History b%d(0);" % (i, i))     # y[n-1], y[n-2] per mode
    L += ["sr = samplerate; nyq = sr*0.5; sc = 0.0022; tp = 2*pi;",
          "re = s_re + sc*(resonate - s_re); s_re = re;",
          "tn = s_tn + sc*(tune - s_tn); s_tn = tn;",
          "de = s_de + sc*(decay - s_de); s_de = de;",
          "f0 = clamp(in2, 8, nyq);",
          "r = 0.9 + de*0.0985; rr = r*r; ig = 1 - r;",          # pole radius -> ring time
          "exc = in1; acc = 0;"]
    for i in range(n):
        L += [
            "rat = pow(%d, 1 + tn*0.55);" % (i + 1),              # mode ratio: harmonic..inharmonic
            "wf = tp*clamp(f0*rat, 8, nyq*0.99)/sr;",
            "cf = 2*r*cos(wf);",
            "yo = exc*ig + cf*a%d - rr*b%d;" % (i, i),            # resonant 2-pole
            "b%d = a%d; a%d = yo;" % (i, i, i),
            "acc = acc + yo;",
        ]
    L += ["mout = acc * 0.3;",
          "out1 = in1 + (mout - in1)*re;"]                        # dry at resonate=0
    return "\n".join(L) + "\n"

# ═══════════════════════════════════════════════════════════════════════
#  DRIVE - Roar-style saturation: AMOUNT, CHARACTER (soft->asym->fold),
#  FEEDBACK (bounded saturating loop). Subtle by default.
# ═══════════════════════════════════════════════════════════════════════
def build_drive_code():
    L = ["/* DRIVE saturation (Roar-like). in1=audio, out1=mono.",
         "   AMOUNT = drive (subtle, squared), CHARACTER = soft->asymmetric->fold,",
         "   FEEDBACK = bounded saturating loop (saturator clamps it -> screams, never blows up). */",
         "Param amount(0); Param character(0); Param feedback(0);",
         "History fb(0); History dcx(0); History dcy(0);",
         "History s_am(0); History s_ch(0); History s_fb(0);",
         "sr = samplerate; sc = 0.0022;",
         "am  = s_am + sc*(amount    - s_am); s_am = am;",
         "ch  = s_ch + sc*(character - s_ch); s_ch = ch;",
         "fbk = s_fb + sc*(feedback  - s_fb); s_fb = fbk;",
         "drv = 1 + am*am*6;",                            # subtle drive (squared curve)
         "x = (in1 + fb*fbk*0.85)*drv;",                  # feedback injection + drive
         "s1 = tanh(x);",                                 # soft
         "s2 = tanh(x*1.3 + 0.4) - 0.379949;",            # asymmetric / diode (even harmonics)
         "s3 = sin(x*1.05);",                             # fold (metallic)
         "ca = clamp(ch*2, 0, 1); cb = clamp(ch*2 - 1, 0, 1);",
         "sh = s1 + (s2 - s1)*ca; sh = sh + (s3 - sh)*cb;",
         "hp = sh - dcx + 0.9995*dcy; dcx = sh; dcy = hp; fb = hp;",   # DC-block + store feedback (bounded)
         "wet = sh*(0.7 + 0.3/drv);",                     # makeup
         "out1 = in1 + (wet - in1)*clamp(am*1.6, 0, 1);"]  # dry at amount=0
    return "\n".join(L) + "\n"

# ═══════════════════════════════════════════════════════════════════════
#  ENV - amp ADSR as gen~ (reliable; 4 automatable knobs). in1 = gate (0/1).
# ═══════════════════════════════════════════════════════════════════════
def build_env_code():
    L = ["/* amp ADSR (gen~).  in1 = gate (0/1).",
         "   out1 = 0..1 envelope (drives the amp).  out2 = display sweep of the CURRENT",
         "   ADSR shape (always on, independent of playing) for the envelope-graph scope. */",
         "Param attack(0.02); Param adecay(0.25); Param sustain(0.7); Param release(0.3);",
         "History env(0); History stg(0); History pg(0); History eph(0);",
         "sr = samplerate;",
         "asec = 0.002 + attack*3; dsec = 0.002 + adecay*3; rsec = 0.002 + release*4;",
         "g = (in1 > 0.5);",
         "rising = (g > 0.5) * (pg < 0.5); pg = g;",      # gate rising edge
         "stg = (rising > 0.5) ? 1 : ((g < 0.5) ? 0 : stg);",   # 1=attack, 2=decay/sus, 0=release
         "ainc = 1/(asec*sr); dinc = 1/(dsec*sr); rinc = 1/(rsec*sr);",
         "env = (stg == 1) ? clamp(env + ainc, 0, 1) : ((stg == 2) ? clamp(env - dinc, sustain, 1) : clamp(env - rinc, 0, 1));",
         "stg = ((stg == 1)*(env >= 1) > 0.5) ? 2 : stg;",      # attack done -> decay
         "out1 = env;",
         "/* ---- envelope-shape display sweep (512-sample window = scope buffer) ---- */",
         "eph = eph + 1/512; eph = eph - floor(eph);",
         "tS = 0.22*(asec + dsec + rsec) + 0.03;",        # a little sustain plateau, display only
         "tot = asec + dsec + tS + rsec;",
         "td = eph*tot;",                                 # time along the displayed shape
         "vA = td/asec;",                                 # attack ramp 0->1
         "vD = 1 + (sustain - 1)*((td - asec)/dsec);",    # decay 1->S
         "vR = sustain*(1 - (td - asec - dsec - tS)/rsec);",   # release S->0
         "ev = (td < asec) ? vA : ((td < asec + dsec) ? vD : ((td < asec + dsec + tS) ? sustain : vR));",
         "out2 = clamp(ev, 0, 1);"]
    return "\n".join(L) + "\n"

OSC_CODE = build_osc_code()
OTT_CODE = build_ott_code(6)
GRIND_CODE = build_grind_code()
MODAL_CODE = build_modal_code(6)
DRIVE_CODE = build_drive_code()
ENV_CODE = build_env_code()

# ═══════════════════════════════════════════════════════════════════════
#  ASSEMBLE  (compact, no background panel)
# ═══════════════════════════════════════════════════════════════════════
add_box("comment", text="CRUCIBLE", rect=[12, 2, 200, 18], pres=[12, 2, 200, 16], numinlets=1,
        numoutlets=0, extra={"fontface": 1, "fontsize": 13.0, "textcolor": [0.86, 0.55, 0.24, 1.0]})

OSC = add_gen(OSC_CODE, 2, [40, 470, 80, 22])     # out1 = audio, out2 = 1-cycle display trace
MODAL = add_gen(MODAL_CODE, 1, [150, 470, 90, 22], n_in=2)   # in1=audio, in2=f0
DRIVE = add_gen(DRIVE_CODE, 1, [260, 470, 80, 22])   # Roar-style saturation
ENV = add_gen(ENV_CODE, 2, [360, 470, 80, 22])       # out1 = amp env, out2 = shape-display sweep
GRIND = add_gen(GRIND_CODE, 1, [260, 560, 80, 22])

# MIDI in + standalone keyboard
notein = add_box("newobj", text="notein", rect=[40, 360, 90, 20], numinlets=1, numoutlets=3,
                 outlettype=["int", "int", "int"])
ksl = add_box("kslider", rect=[150, 360, 224, 53], numinlets=2, numoutlets=2, outlettype=["", ""])
mtof = add_box("newobj", text="mtof", rect=[40, 395, 50, 20], numinlets=1, numoutlets=1, outlettype=[""])
sigp = add_box("newobj", text="sig~", rect=[40, 425, 50, 20], numinlets=1, numoutlets=1, outlettype=["signal"])
ampmul = add_box("newobj", text="*~", rect=[40, 510, 60, 22], numinlets=2, numoutlets=1, outlettype=["signal"])
connect(notein, 0, mtof, 0); connect(ksl, 0, mtof, 0)
connect(mtof, 0, sigp, 0); connect(sigp, 0, OSC, 0)
connect(OSC, 0, ampmul, 0)

# --- amp envelope: ADSR gen~, gate = (velocity > 0) ---
gate = add_box("newobj", text="> 0", rect=[150, 395, 40, 20], numinlets=2, numoutlets=1, outlettype=["int"])
gatesig = add_box("newobj", text="sig~", rect=[150, 420, 50, 20], numinlets=1, numoutlets=1, outlettype=["signal"])
connect(notein, 1, gate, 0); connect(ksl, 1, gate, 0)
connect(gate, 0, gatesig, 0); connect(gatesig, 0, ENV, 0)   # velocity>0 -> gate signal -> ADSR
connect(ENV, 0, ampmul, 1)                        # envelope -> *~

# dials grouped into labeled sections, two rows.  Row1 = OSC + MODAL, Row2 = SATURATION + AMP + GRIND
def section(label, x0, dials, row):
    lbl_y, dial_y, py_patch = (20, 33, 120) if row == 1 else (91, 105, 210)
    add_box("comment", text=label, rect=[x0, lbl_y, 100, 16], pres=[x0, lbl_y, 100, 14],
            numinlets=1, numoutlets=0,
            extra={"fontface": 1, "fontsize": 10.0, "textcolor": [0.72, 0.53, 0.33, 1.0]})
    for k, (vn, ln, sn, dv, tg) in enumerate(dials):
        px = x0 + k * 60
        live_dial(vn, ln, sn, dv, tg, px, py_patch, px, dial_y)

section("OSC", 12, [("morph", "Morph 1", "Morph 1", 0.0, OSC), ("morph2", "Morph 2", "Morph 2", 0.35, OSC),
                    ("pulsar", "Pulsar", "Pulsar", 0.0, OSC), ("formant", "Formant", "Formant", 0.5, OSC),
                    ("rips", "Rips", "Rips", 0.0, OSC), ("ripshape", "Shape", "Shape", 0.3, OSC)], 1)
section("MODAL", 12, [("resonate", "Resonate", "Reson", 0.0, MODAL), ("tune", "Tune", "Tune", 0.0, MODAL),
                      ("decay", "Ring", "Ring", 0.5, MODAL)], 2)
section("SATURATION", 200, [("amount", "Amount", "Amount", 0.0, DRIVE),
                            ("character", "Character", "Charactr", 0.0, DRIVE),
                            ("feedback", "Feedback", "Feedbk", 0.0, DRIVE)], 2)
section("GRIND", 388, [("crush", "Crush", "Crush", 0.0, GRIND), ("grind", "Grind", "Grind", 0.0, GRIND)], 2)

# AMP module (Operator-style): envelope graph on top, the 4 ADSR value knobs directly beneath it
AMPX = 532
add_box("comment", text="AMP", rect=[AMPX, 20, 100, 16], pres=[AMPX, 20, 100, 14], numinlets=1, numoutlets=0,
        extra={"fontface": 1, "fontsize": 10.0, "textcolor": [0.72, 0.53, 0.33, 1.0]})
for k, (vn, ln, sn, dv) in enumerate([("attack", "Attack", "Attack", 0.02), ("adecay", "Decay", "Decay", 0.25),
                                      ("sustain", "Sustain", "Sustain", 0.7), ("release", "Release", "Release", 0.3)]):
    px = AMPX + k * 60
    live_dial(vn, ln, sn, dv, ENV, px, 210, px, 105)
envscope = add_box("scope~", rect=[420, 320, 290, 74], pres=[AMPX, 33, 232, 66], numinlets=2, numoutlets=0,
                   extra={"range": [-0.05, 1.05], "bufsize": 512, "calccount": 1,
                          "bgcolor": [0.08, 0.08, 0.09, 1.0],
                          "gridcolor": [0.08, 0.08, 0.09, 1.0],
                          "fgcolor": [1.0, 0.66, 0.28, 1.0]})

gain = add_box("live.gain~", rect=[300, 560, 48, 90], pres=[776, 24, 40, 130],
               numinlets=2, numoutlets=2, outlettype=["signal", "signal"],
               extra={"parameter_enable": 1, "varname": "master_gain",
                      "saved_attribute_attributes": {"valueof": {
                          "parameter_longname": "Gain", "parameter_shortname": "Gain",
                          "parameter_mmin": -70.0, "parameter_mmax": 6.0, "parameter_type": 0,
                          "parameter_unitstyle": 4, "parameter_initial_enable": 1,
                          "parameter_initial": [-6.0]}}})
params_block[gain] = ["Gain", "Gain", _order[0]]; _order[0] += 1

# 1-cycle waveform display (window 512 == display-phasor period), beside the OSC knobs
add_box("comment", text="WAVE", rect=[376, 20, 100, 16], pres=[376, 20, 100, 14], numinlets=1, numoutlets=0,
        extra={"fontface": 1, "fontsize": 10.0, "textcolor": [0.72, 0.53, 0.33, 1.0]})
scope = add_box("scope~", rect=[420, 250, 290, 74], pres=[376, 33, 146, 54], numinlets=2, numoutlets=0,
                extra={"range": [-0.9, 0.9], "bufsize": 512, "calccount": 1,
                       "bgcolor": [0.08, 0.08, 0.09, 1.0],
                       "gridcolor": [0.08, 0.08, 0.09, 1.0],     # grid = bg -> invisible (no grid)
                       "fgcolor": [1.0, 0.66, 0.28, 1.0]})       # bright bold waveform (correct attr)

plugout = add_box("newobj", text="plugout~ 1 2", rect=[420, 590, 110, 20], numinlets=2, numoutlets=0)
ezdac = add_box("ezdac~", rect=[420, 620, 45, 45], numinlets=2, numoutlets=0)
audtog = add_box("toggle", rect=[420, 560, 24, 24], numinlets=1, numoutlets=1, outlettype=["int"])
add_box("comment", text="AUDITION - standalone Max only (Ctrl/Cmd+E); OFF in Ableton",
        rect=[450, 562, 340, 16], numinlets=1, numoutlets=0,
        extra={"fontsize": 9.0, "textcolor": [0.6, 0.56, 0.5, 1.0]})
connect(ampmul, 0, MODAL, 0); connect(sigp, 0, MODAL, 1)   # osc+env -> MODAL (f0-tuned)
connect(MODAL, 0, DRIVE, 0); connect(DRIVE, 0, GRIND, 0)   # -> DRIVE saturation -> GRIND
connect(GRIND, 0, gain, 0); connect(GRIND, 0, gain, 1)
connect(OSC, 1, scope, 0)                         # OSC display trace -> 1-cycle visualizer
connect(ENV, 1, envscope, 0)                      # ADSR shape sweep -> envelope-graph scope
connect(gain, 0, plugout, 0); connect(gain, 1, plugout, 1)
connect(gain, 0, ezdac, 0); connect(gain, 1, ezdac, 1); connect(audtog, 0, ezdac, 0)

# ───────────────────────── patcher + .amxd ─────────────────────────
patcher = {
    "fileversion": 1, "appversion": APPVERSION, "classnamespace": "box",
    "rect": [120.0, 100.0, 720.0, 680.0], "openinpresentation": 1,
    "default_fontsize": 10.0, "gridsize": [8.0, 8.0], "boxes": boxes, "lines": lines,
    "parameters": dict(params_block, inherited_shortname=1),
    "dependency_cache": [], "autosave": 0, "is_mpe": 0, "latency": 0,
    "project": {"version": 1, "creationdate": 3590000000, "modificationdate": 3590000000,
                "viewrect": [0.0, 0.0, 300.0, 500.0], "autoorganize": 1, "hideprojectwindow": 1,
                "showdependencies": 1, "autolocalize": 0, "contents": {"patchers": {}, "code": {}},
                "layout": {}, "searchpath": {}, "detailsvisible": 0,
                "amxdtype": AMXDTYPE_INSTRUMENT, "readonly": 0, "devpathtype": 0,
                "devpath": ".", "sortmode": 0, "viewmode": 0, "includepackages": 0},
    "oscreceiveudpport": 0,
}
patch_str = json.dumps({"patcher": patcher}, indent=2)
with open(os.path.join(HERE, "Crucible.maxpat"), "w", encoding="utf-8") as f:
    f.write(patch_str)

def wrap_amxd(js, t):
    ptch = js.encode("utf-8") + b"\x00"
    return (b"ampf" + struct.pack("<I", 4) + struct.pack("<I", t) +
            b"meta" + struct.pack("<I", 4) + struct.pack("<I", 1) +
            b"ptch" + struct.pack("<I", len(ptch)) + ptch)
with open(os.path.join(HERE, "Crucible.amxd"), "wb") as f:
    f.write(wrap_amxd(patch_str, AMXDTYPE_INSTRUMENT))
with open(os.path.join(HERE, "crucible_osc.genexpr"), "w", encoding="utf-8") as f:
    f.write(OSC_CODE)
with open(os.path.join(HERE, "crucible_ott.genexpr"), "w", encoding="utf-8") as f:
    f.write(OTT_CODE)
with open(os.path.join(HERE, "crucible_grind.genexpr"), "w", encoding="utf-8") as f:
    f.write(GRIND_CODE)

# ───────────────────────── validate ─────────────────────────
rp = json.loads(patch_str); ids = set()
for e in rp["patcher"]["boxes"]:
    assert e["box"]["id"] not in ids; ids.add(e["box"]["id"])
for l in rp["patcher"]["lines"]:
    assert l["patchline"]["source"][0] in ids and l["patchline"]["destination"][0] in ids
assert not any(b["box"]["maxclass"] == "panel" for b in rp["patcher"]["boxes"]), "no panel allowed"
# unique varnames (no param-name collisions)
vns = [b["box"]["varname"] for b in rp["patcher"]["boxes"] if b["box"].get("varname")]
assert len(vns) == len(set(vns)), ("dup varname", vns)
maxy = max((b["box"]["presentation_rect"][1] + b["box"]["presentation_rect"][3])
           for b in rp["patcher"]["boxes"] if b["box"].get("presentation_rect"))
amx = wrap_amxd(patch_str, AMXDTYPE_INSTRUMENT)
assert struct.unpack_from("<I", amx, 28)[0] == len(amx) - 32 and amx[8:12] == b"iiii"
print("OK  boxes=%d lines=%d params=%d  positions=%d harmonics=%d  pres_h=%g  amxd=%d B"
      % (len(boxes), len(lines), len(params_block), KP, NH, maxy, len(amx)))
