#!/usr/bin/env node
'use strict';

/**
 * Replace an ad set's country targeting — SAFELY.
 * Reads the full targeting spec, swaps ONLY geo_locations.countries
 * (preserving age/gender/interests/placements/etc.), writes it back,
 * and prints the original spec so you can restore if needed.
 *
 * Usage:
 *   $env:META_ACCESS_TOKEN="EAAB..."
 *   node tools/meta-ads/apply-geo.js <adsetId> <CC,CC,CC>
 *   e.g. node tools/meta-ads/apply-geo.js 120250812785600440 GB,DE,FR,IT,ES,CH,NL,AT,BE,IE,SE,NO,DK,FI
 */

const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ID = process.argv[2];
const COUNTRIES = (process.argv[3] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

if (!T || !ID || !COUNTRIES.length) {
  console.error('usage: META_ACCESS_TOKEN=.. node apply-geo.js <adsetId> <CC,CC,..>');
  process.exit(1);
}
const BASE = 'https://graph.facebook.com/' + V;

(async () => {
  const cur = await fetch(BASE + '/' + ID + '?fields=name,targeting&access_token=' + T).then((r) => r.json());
  if (cur.error) { console.error('READ FAILED:', cur.error.message); process.exit(1); }

  console.log('AD SET:', cur.name);
  console.log('\n--- FULL TARGETING BEFORE (save to restore) ---');
  console.log(JSON.stringify(cur.targeting));

  const t = cur.targeting || {};
  const oldGeo = t.geo_locations || {};
  const newGeo = { countries: COUNTRIES };
  if (oldGeo.location_types) newGeo.location_types = oldGeo.location_types;
  t.geo_locations = newGeo;

  console.log('\nNew geo_locations ->', JSON.stringify(newGeo));

  const body = 'targeting=' + encodeURIComponent(JSON.stringify(t)) + '&access_token=' + encodeURIComponent(T);
  const res = await fetch(BASE + '/' + ID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).then((r) => r.json());

  console.log('\nWRITE RESULT:', JSON.stringify(res));
  if (res.error) { console.error('WRITE FAILED (validation = nothing changed):', res.error.message); process.exit(1); }

  const ver = await fetch(BASE + '/' + ID + '?fields=name,targeting&access_token=' + T).then((r) => r.json());
  console.log('\n--- geo_locations AFTER ---');
  console.log(JSON.stringify(ver.targeting && ver.targeting.geo_locations));
  console.log('\nDone.');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
