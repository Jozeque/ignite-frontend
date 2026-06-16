/**
 * TENDRIL — Parameter Contract (single source of truth)
 * ======================================================
 * This list defines the device's automatable surface AND the UI.
 *
 * CRITICAL: order is the API. Stride targets parameters by their
 * position (envelope_index). NEVER reorder this list — append only,
 * and keep the reserved slots. (See PRD §7 + the v1.2.0 misroute
 * regression that proved positional injection is load-bearing.)
 *
 * In Max:
 *   - Each `stride:true` entry becomes a [live.*] object whose
 *     "Long Name" == longName and "Scripting Name" == scripting,
 *     **Type = Float**, "Automated and Stored".
 *   - LIVE-FACING RANGE = **0.–127. Float** for the normalized macros
 *     (the ones whose min/max below are 0..1). This matches Ableton's
 *     macro convention Stride is tuned for, and — crucially — keeps
 *     Stride writing smooth FloatEvents. (A 0..1 *Int* dial = 2 values
 *     = ON/OFF; an Int/Bool type is what makes Stride inject on/off.
 *     Float is mandatory; 0–127 is the safe span.) The min/max/def
 *     below are the **DSP-normalized 0..1** values the gen~ Params want
 *     — so SCALE the dial into gen~ with [/ 127.] (dial 0–127 -> 0–1).
 *   - Params with real musical ranges (Pitch ±24, Octave ±2, Fine ±50)
 *     use those ranges directly as Float (no /127) — they're already
 *     wide enough to inject smoothly.
 *   - `log:true` -> set the live.dial/live.numbox Exponent so the
 *     control (and Stride's is_log) scales perceptually, and mark
 *     is_log when TENDRIL answers Stride's scan.
 *   - `stride:false` (selectors / structural) -> "Stored Only" or
 *     "Hidden"; hand-set, NOT a Stride lane (discrete, can't be
 *     smoothly automated).
 *
 * Field reference:
 *   index     fixed position (= Stride envelope_index). DO NOT CHANGE.
 *   longName  human label shown in Live automation + Stride lane list
 *   scripting unique scripting name (matches genexpr Param where DSP-side)
 *   group     UI section
 *   min/max   range
 *   def       default
 *   unit      display unit (UI only)
 *   log       perceptual/exponential scaling
 *   stride    exposed to Stride as a continuous modulation-safe lane
 *   type      'float' | 'enum'
 *   options   for enum selectors
 */

const SPECTRA_PARAMS = [
  // ─── GLOBAL ───────────────────────────────────────────────
  { index:0,  longName:'Pitch',        scripting:'pitch',     group:'Global', min:-24, max:24, def:0,    unit:'st', log:false, stride:true,  type:'float' },
  { index:1,  longName:'Glide',        scripting:'glide',     group:'Global', min:0,   max:1,  def:0.05, unit:'',   log:true,  stride:true,  type:'float' },
  { index:2,  longName:'Filter Cutoff',scripting:'cutoff',    group:'Global', min:0,   max:1,  def:0.7,  unit:'',   log:true,  stride:true,  type:'float' },
  { index:3,  longName:'Filter Reso',  scripting:'reso',      group:'Global', min:0,   max:1,  def:0.2,  unit:'',   log:false, stride:true,  type:'float' },

  // ─── OSC A ────────────────────────────────────────────────
  { index:4,  longName:'A Tone',       scripting:'a_tone',    group:'Osc A',  min:0,   max:1,  def:0.5,  unit:'X',  log:false, stride:true,  type:'float' },
  { index:5,  longName:'A Body',       scripting:'a_body',    group:'Osc A',  min:0,   max:1,  def:0.5,  unit:'Y',  log:false, stride:true,  type:'float' },
  { index:6,  longName:'A Air',        scripting:'a_air',     group:'Osc A',  min:0,   max:1,  def:0.5,  unit:'Z',  log:false, stride:true,  type:'float' },
  { index:7,  longName:'A Bank',       scripting:'a_bank',    group:'Osc A',  min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' }, // continuous crossfade morph axis
  { index:8,  longName:'A Level',      scripting:'a_level',   group:'Osc A',  min:0,   max:1,  def:0.85, unit:'',   log:false, stride:true,  type:'float' },
  { index:9,  longName:'A Octave',     scripting:'a_oct',     group:'Osc A',  min:-2,  max:2,  def:0,    unit:'oct',log:false, stride:true,  type:'float' },
  { index:10, longName:'A Fine',       scripting:'a_fine',    group:'Osc A',  min:-50, max:50, def:0,    unit:'ct', log:false, stride:true,  type:'float' },

  // ─── OSC B ────────────────────────────────────────────────
  { index:11, longName:'B Tone',       scripting:'b_tone',    group:'Osc B',  min:0,   max:1,  def:0.5,  unit:'X',  log:false, stride:true,  type:'float' },
  { index:12, longName:'B Body',       scripting:'b_body',    group:'Osc B',  min:0,   max:1,  def:0.5,  unit:'Y',  log:false, stride:true,  type:'float' },
  { index:13, longName:'B Air',        scripting:'b_air',     group:'Osc B',  min:0,   max:1,  def:0.5,  unit:'Z',  log:false, stride:true,  type:'float' },
  { index:14, longName:'B Bank',       scripting:'b_bank',    group:'Osc B',  min:0,   max:1,  def:0.4,  unit:'',   log:false, stride:true,  type:'float' },
  { index:15, longName:'B Level',      scripting:'b_level',   group:'Osc B',  min:0,   max:1,  def:0.5,  unit:'',   log:false, stride:true,  type:'float' },
  { index:16, longName:'B Octave',     scripting:'b_oct',     group:'Osc B',  min:-2,  max:2,  def:0,    unit:'oct',log:false, stride:true,  type:'float' },
  { index:17, longName:'B Fine',       scripting:'b_fine',    group:'Osc B',  min:-50, max:50, def:0,    unit:'ct', log:false, stride:true,  type:'float' },

  // ─── CROSS-MOD ────────────────────────────────────────────
  { index:18, longName:'FM Amount',    scripting:'fm_amt',    group:'Cross',  min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:19, longName:'Ring Amount',  scripting:'ring_amt',  group:'Cross',  min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:20, longName:'Sync',         scripting:'sync_amt',  group:'Cross',  min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:21, longName:'Sub Level',    scripting:'sub_lvl',   group:'Cross',  min:0,   max:1,  def:0.3,  unit:'',   log:false, stride:true,  type:'float' },
  { index:22, longName:'Noise Level',  scripting:'noise_lvl', group:'Cross',  min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },

  // ─── SPECTRAL (add/remove frequencies on the same table) ──
  { index:23, longName:'Density',      scripting:'density',   group:'Spectral', min:0, max:1, def:0.3,  unit:'',   log:false, stride:true,  type:'float' },
  { index:24, longName:'Comb',         scripting:'comb',      group:'Spectral', min:0, max:1, def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:25, longName:'Fold',         scripting:'fold_amt',  group:'Spectral', min:0, max:1, def:0,    unit:'',   log:false, stride:true,  type:'float' }, // gen Param 'fold' clashed w/ operator -> fold_amt
  { index:26, longName:'Tilt',         scripting:'tilt',      group:'Spectral', min:0, max:1, def:0.5,  unit:'',   log:false, stride:true,  type:'float' },
  { index:27, longName:'Formant',      scripting:'formant',   group:'Spectral', min:0, max:1, def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:28, longName:'Warp',         scripting:'warp',      group:'Spectral', min:0, max:1, def:0,    unit:'',   log:false, stride:true,  type:'float' },

  // ─── FX MODULE MACROS (engines = ABL objects + gen~) ──────
  { index:29, longName:'Resonate',     scripting:'fx_reson',  group:'FX',     min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:30, longName:'Reson Tune',   scripting:'fx_resontune',group:'FX',   min:0,   max:1,  def:0.5,  unit:'',   log:true,  stride:true,  type:'float' },
  { index:31, longName:'Drive',        scripting:'fx_drive',  group:'FX',     min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:32, longName:'Drive Char',   scripting:'fx_drivechar',group:'FX',   min:0,   max:1,  def:0.5,  unit:'',   log:false, stride:true,  type:'float' },
  { index:33, longName:'Crush',        scripting:'fx_crush',  group:'FX',     min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:34, longName:'Crush Rate',   scripting:'fx_crushrate',group:'FX',   min:0,   max:1,  def:1,    unit:'',   log:true,  stride:true,  type:'float' },
  { index:35, longName:'Glue Amount',  scripting:'fx_glue',   group:'FX',     min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:36, longName:'Space Size',   scripting:'fx_spacesize',group:'FX',   min:0,   max:1,  def:0.4,  unit:'',   log:false, stride:true,  type:'float' },
  { index:37, longName:'Space Mix',    scripting:'fx_spacemix', group:'FX',   min:0,   max:1,  def:0.2,  unit:'',   log:false, stride:true,  type:'float' },
  { index:38, longName:'Motion Fb',    scripting:'fx_motionfb', group:'FX',   min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:39, longName:'Motion Time',  scripting:'fx_motiontime',group:'FX',  min:0,   max:1,  def:0.3,  unit:'',   log:true,  stride:true,  type:'float' },
  { index:40, longName:'Amp Env Mod',  scripting:'env_mod',   group:'FX',     min:0,   max:1,  def:0.5,  unit:'',   log:false, stride:true,  type:'float' },

  // ─── FX ROUTING (continuous, modulation-safe) ─────────────
  { index:41, longName:'Parallel Blend',scripting:'fx_blend', group:'Routing',min:0,   max:1,  def:0.5,  unit:'',   log:false, stride:true,  type:'float' },
  { index:42, longName:'Feedback Amount',scripting:'fx_fbamt',group:'Routing',min:0,   max:0.98,def:0,   unit:'',   log:false, stride:true,  type:'float' },
  { index:43, longName:'Reserved 1',   scripting:'rsv1',      group:'Routing',min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:44, longName:'Reserved 2',   scripting:'rsv2',      group:'Routing',min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },

  // ─── META MACROS (each maps to a curated bundle of targets) ─
  { index:45, longName:'Macro 1',      scripting:'macro1',    group:'Macros', min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:46, longName:'Macro 2',      scripting:'macro2',    group:'Macros', min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:47, longName:'Macro 3',      scripting:'macro3',    group:'Macros', min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },
  { index:48, longName:'Macro 4',      scripting:'macro4',    group:'Macros', min:0,   max:1,  def:0,    unit:'',   log:false, stride:true,  type:'float' },

  // ─── SELECTORS / STRUCTURAL (Hidden from Stride, hand-set) ─
  // Appended after 48. Discrete -> NOT smoothly automatable.
  { index:49, longName:'Filter Type',  scripting:'ftype',     group:'Hidden', min:0, max:5, def:0, unit:'', log:false, stride:false, type:'enum',
    options:['LP24','LP12','HP','BP','Notch','Peak'] },            // (Ladder/Comb/Formant/SVF/Phaser = v1.x additions, append here)
  { index:50, longName:'Distortion Type', scripting:'dtype',  group:'Hidden', min:0, max:8, def:0, unit:'', log:false, stride:false, type:'enum',
    options:['Tube','Tape','Diode','Wavefold','Foldback','HardClip','Sine','Asym','RoarMB'] },
  // Routing structure (slot order / lane / split / bypass) is held as
  // additional Hidden params/state; append from index 51 onward when built.
];

// ─── Helpers ───────────────────────────────────────────────
const strideParams  = () => SPECTRA_PARAMS.filter(p => p.stride);          // the ~49 lanes Stride sees
const byScripting   = (s) => SPECTRA_PARAMS.find(p => p.scripting === s);
const byIndex       = (i) => SPECTRA_PARAMS.find(p => p.index === i);
const groups        = () => [...new Set(SPECTRA_PARAMS.filter(p=>p.group!=='Hidden').map(p=>p.group))];

if (typeof module !== 'undefined') {
  module.exports = { SPECTRA_PARAMS, strideParams, byScripting, byIndex, groups };
}
