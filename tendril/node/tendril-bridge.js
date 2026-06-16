/**
 * TENDRIL — Stride glow bridge   (Node for Max)
 * =============================================
 * OPTIONAL. Pure eye-candy + integration glue: connects to Stride's
 * WebSocket bus (localhost:9100) so TENDRIL's UI knobs glow in their
 * lane color while Stride is drawing/injecting that parameter.
 *
 * This is NOT in the audio path and NOT required for the synth to work.
 * Parameter exposure to Live/Stride happens via the [live.*] objects in
 * the patcher, not here. This only listens for "what is Stride animating
 * right now" and forwards a glow hint to the jweb UI.
 *
 * Wire in Max:
 *   [node.script tendril-bridge.js]
 *      ├─ out 0: ['glow', <scripting>, <laneIdx>]   -> route to [jweb]
 *      └─ out 0: ['glowoff', <scripting>]           -> route to [jweb]
 *
 * Run model mirrors Stride's own m4l/node servers. Requires the 'ws'
 * package available to node.script (same as stride-vst/app deps).
 *
 * Protocol reused from stride-vst/shared/message-types.js:
 *   apply_inject / apply_automation carry { parameters:[{name,...}] }.
 *   We map each parameter name -> our scripting name -> a glow message.
 */

const Max = require('max-api');

let WebSocket;
try { WebSocket = require('ws'); }
catch (e) { Max.post('tendril-bridge: ws module not found; glow disabled', Max.POST_LEVELS.WARN); }

const STRIDE_URL = 'ws://127.0.0.1:9100';
const RECONNECT_MS = 4000;

// longName (as Stride sees it) -> scripting (as the UI knows it).
// Keep in sync with tendril-params.js. Lowercased + trimmed for safety.
const NAME_TO_SCRIPTING = {
  'pitch':'pitch','glide':'glide','filter cutoff':'cutoff','filter reso':'reso',
  'a tone':'a_tone','a body':'a_body','a air':'a_air','a bank':'a_bank','a level':'a_level','a octave':'a_oct','a fine':'a_fine',
  'b tone':'b_tone','b body':'b_body','b air':'b_air','b bank':'b_bank','b level':'b_level','b octave':'b_oct','b fine':'b_fine',
  'fm amount':'fm_amt','ring amount':'ring_amt','sync':'sync_amt','sub level':'sub_lvl','noise level':'noise_lvl',
  'density':'density','comb':'comb','fold':'fold','tilt':'tilt','formant':'formant','warp':'warp',
  'resonate':'fx_reson','reson tune':'fx_resontune','drive':'fx_drive','drive char':'fx_drivechar',
  'crush':'fx_crush','crush rate':'fx_crushrate','glue amount':'fx_glue','space size':'fx_spacesize','space mix':'fx_spacemix',
  'motion fb':'fx_motionfb','motion time':'fx_motiontime','amp env mod':'env_mod',
  'parallel blend':'fx_blend','feedback amount':'fx_fbamt',
  'macro 1':'macro1','macro 2':'macro2','macro 3':'macro3','macro 4':'macro4',
};

let ws = null;
let glowing = new Set();

function connect() {
  if (!WebSocket) return;
  try {
    ws = new WebSocket(STRIDE_URL);
  } catch (e) { return scheduleReconnect(); }

  ws.on('open', () => { Max.post('tendril-bridge: connected to Stride'); Max.outlet('stridelink', 1); });
  ws.on('close', () => { Max.outlet('stridelink', 0); clearGlow(); scheduleReconnect(); });
  ws.on('error', () => { /* close handler reconnects */ });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    // When Stride injects, light up the affected params briefly.
    if ((msg.type === 'apply_inject' || msg.type === 'apply_automation') && Array.isArray(msg.parameters)) {
      clearGlow();
      msg.parameters.forEach((p, i) => {
        const key = (p.name || '').toLowerCase().trim();
        const scripting = NAME_TO_SCRIPTING[key];
        if (scripting) { glowing.add(scripting); Max.outlet('glow', scripting, i % 5); }
      });
      // auto-clear after a window (Stride injection is a burst, not continuous)
      setTimeout(clearGlow, 2500);
    }
  });
}
function clearGlow() {
  glowing.forEach(s => Max.outlet('glowoff', s));
  glowing.clear();
}
function scheduleReconnect() { setTimeout(connect, RECONNECT_MS); }

connect();
Max.post('tendril-bridge: started (glow-only, optional).');
