#!/usr/bin/env node
'use strict';

/**
 * Remove the locale (interface-language) restriction from one or more ad sets,
 * preserving ALL other targeting. Read-modify-write + verify, per ad set.
 * Prints the BEFORE locales so you can restore (re-add via targeting POST).
 *
 * Usage:
 *   $env:META_ACCESS_TOKEN="EAAB..."
 *   node tools/meta-ads/broaden-language.js <id1,id2,id3>
 */

const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const IDS = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!T || !IDS.length) {
  console.error('usage: META_ACCESS_TOKEN=.. node broaden-language.js <id1,id2,..>');
  process.exit(1);
}
const BASE = 'https://graph.facebook.com/' + V;

async function one(ID) {
  const cur = await fetch(BASE + '/' + ID + '?fields=name,targeting&access_token=' + T).then((r) => r.json());
  if (cur.error) { console.log(ID, 'READ FAILED:', cur.error.message); return; }
  const t = cur.targeting || {};
  console.log('\n— ' + cur.name + ' (' + ID + ')');
  console.log('  locales BEFORE:', JSON.stringify(t.locales || null));
  if (!t.locales) { console.log('  (no language filter — skipped)'); return; }
  delete t.locales;
  const body = 'targeting=' + encodeURIComponent(JSON.stringify(t)) + '&access_token=' + encodeURIComponent(T);
  const res = await fetch(BASE + '/' + ID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).then((r) => r.json());
  if (res.error) { console.log('  WRITE FAILED:', res.error.message); return; }
  const ver = await fetch(BASE + '/' + ID + '?fields=targeting&access_token=' + T).then((r) => r.json());
  console.log('  locales AFTER :', JSON.stringify((ver.targeting && ver.targeting.locales) || null), '->', JSON.stringify(res));
}

(async () => {
  for (const id of IDS) { await one(id); }
  console.log('\nDone.');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
