/**
 * test-vst3-update.js
 *
 * Covers the one-click "Check for updates" batch (1.1.7): the plugin's ↓ update
 * button asks OUR backend for a SIGNED Lemon Squeezy download URL — the key the
 * plugin already stores is the credential (validated slot-free, consumes no
 * activation), the platform picks the right zip, and the files are whatever is
 * CURRENTLY uploaded on LS (shipping a release updates this path for free).
 * EVERY failure path (old backend = 401, invalid key, LS down, network) degrades
 * to the My Orders portal — the button always opens something useful.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-update.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const licH   = rd(path.join(W, 'src', 'License.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const backend= rd(path.join(root, 'firebase_cloud', 'functions', 'main.py'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — platform pick + fallback decisions
// ─────────────────────────────────────────────────────────────

// file pick (mirrors _handle_get_update): NEWEST file named vst3 + platform token
// (highest file id = latest upload; re-uploads stack entries on LS). NO non-vst3
// fallback — desktop zips must never come out of the VST's update button.
(function () {
    const pick = (files, platform) => {
        const want = platform.startsWith('mac') ? 'mac' : 'windows';
        const c = files.filter(f => (f.name || '').toLowerCase().includes('vst3') && (f.name || '').toLowerCase().includes(want));
        c.sort((a, b) => (b.id | 0) - (a.id | 0));
        return c.length ? c[0] : null;
    };
    // the REAL store layout (verified live): stacked re-uploads + stale desktop builds
    const files = [
        { id: 500001, name: 'Stride-VST3-Windows.zip' }, { id: 500002, name: 'Stride-VST3-Mac.zip' },
        { id: 584259, name: 'Stride-VST3-Windows.zip' }, { id: 584260, name: 'Stride-VST3-Mac.zip' },
        { id: 400000, name: 'Stride_v2.0.0_Windows.zip' },
    ];
    ok('windows picks the NEWEST VST3 Windows zip (not the oldest upload)', pick(files, 'windows').id === 584259);
    ok('mac picks the NEWEST VST3 Mac zip', pick(files, 'mac').id === 584260);
    ok('stale DESKTOP builds are never served by the VST button', pick([{ id: 1, name: 'Stride_v2.0.0_Windows.zip' }], 'windows') === null);
    ok('no files -> null (portal fallback)', pick([], 'windows') === null);
})();

// client fallback decision (mirrors the editor handler): ok -> signed url, anything
// else -> portal; a VOID reply (network fail / 401 old backend) also lands on the portal
(function () {
    const decide = (r) => {
        const ok_ = r && typeof r === 'object' && r.ok === true;
        return ok_ ? r.url : ((r && r.portal) || 'https://app.lemonsqueezy.com/my-orders');
    };
    ok('ok reply opens the signed url', decide({ ok: true, url: 'https://signed', portal: 'p' }) === 'https://signed');
    ok('failed reply opens the returned portal', decide({ ok: false, portal: 'https://app.lemonsqueezy.com/my-orders' }).includes('my-orders'));
    ok('VOID reply (old backend 401 / offline) still opens the portal', decide(undefined).includes('my-orders'));
})();

// ─────────────────────────────────────────────────────────────
// 2. BACKEND — license-gated signed link, always-200, portal on every miss
// ─────────────────────────────────────────────────────────────
ok('public route registered (key is the credential)', /data_pre\.get\("action"\) == "get_update"/.test(backend) && /_handle_get_update\(data_pre\)/.test(backend));
ok('slot-free validation (no instance_id -> consumes no activation)', /_handle_get_update[\s\S]{0,2200}licenses\/validate[\s\S]{0,400}\{"license_key": key\}/.test(backend));
ok('disabled/expired keys get the portal, not files', /lk_status in \("disabled", "expired"\)/.test(backend));
ok('ENTITLEMENT-driven: any vst-entitled key (incl. upgraded desktop buyers) gets VST files', /_resolve_entitlements\(meta\.get\("product_id"\), meta\.get\("product_name"\)/.test(backend) && /if "vst" not in ents:/.test(backend));
ok('files resolved by walking products->variants->files (store-wide list times out; product-scoping lies)', /for prod in _ls_list\("products"\)/.test(backend) && /_ls_list\("variants", \{"filter\[product_id\]": prod\.get\("id"\)\}\)/.test(backend) && /_ls_list\("files", \{"filter\[variant_id\]": v\.get\("id"\)\}\)/.test(backend));
ok('_ls_list walks EVERY page (2026-08-14: unpaginated default = ten OLDEST rows, served a July draft)', /q\["page\[size\]"\] = "100"/.test(backend) && /q\["page\[number\]"\] = str\(page\)/.test(backend) && /"lastPage"/.test(backend));
ok('only PUBLISHED files are servable (dashboard-replaced files live on as drafts)', /def _fpub\(f\)/.test(backend) && /== "published"/.test(backend) && /and _fpub\(f\)\]/.test(backend));
ok('NEWEST vst3+platform file wins; desktop builds are never served', /"vst3" in _fname\(f\) and want in _fname\(f\)/.test(backend) && /key=lambda f: int\(f\.get\("id"\) or 0\), reverse=True/.test(backend) && !/pick = files\[0\]/.test(backend));
ok('signed download_url returned on success', /"download_url"\) or ""/.test(backend) && /"ok": True, "url": url/.test(backend));
ok('EVERY response carries the My Orders portal + HTTP 200', /LS_MY_ORDERS_URL = "https:\/\/app\.lemonsqueezy\.com\/my-orders"/.test(backend) && /fallback = \{"ok": False, "portal": LS_MY_ORDERS_URL\}/.test(backend));
ok('key cleaned exactly like the license path (invisible chars stripped)', (backend.match(/re\.sub\(r"\[\\s\\u00A0\\u200B\\u200C\\u200D\\uFEFF\]", "", raw_key\)\.upper\(\)/g) || []).length >= 2);

// ─────────────────────────────────────────────────────────────
// 3. CLIENT — bridge + button
// ─────────────────────────────────────────────────────────────
ok('License.h fetchUpdateLink posts get_update with the stored key', /fetchUpdateLink[\s\S]{0,900}"get_update"[\s\S]{0,200}setProperty \("key", key\)/.test(licH));
ok('platform sent per build (windows/mac)', /fetchUpdateLink[\s\S]{0,1400}"windows"[\s\S]{0,200}"mac"/.test(licH));
ok('editor bridges checkUpdate and OPENS the result in the browser', /"checkUpdate"[\s\S]{0,1200}launchInDefaultBrowser\(\)/.test(editor));
ok('editor: portal default is baked in (void reply safe)', /getProperty \("portal", "https:\/\/app\.lemonsqueezy\.com\/my-orders"\)/.test(editor));
ok('editor: SafePointer guards the async reply', /"checkUpdate"[\s\S]{0,400}SafePointer<StrideWrapperEditor> safe/.test(editor));
ok('UI: the Update button sits in the TITLEBAR next to Guide', /id="sd-update-btn"[\s\S]{0,400}<!-- Guide -->/.test(rd(path.join(W, 'ui', 'index.html'))));
ok('shim: wires the titlebar button with feedback states', /getElementById\('sd-update-btn'\)/.test(shim) && /emit\('checkUpdate'\)/.test(shim) && /listen\('updateReply'/.test(shim) && /'✓ downloading' : '↗ opened'/.test(shim));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
