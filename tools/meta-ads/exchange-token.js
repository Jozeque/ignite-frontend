#!/usr/bin/env node
'use strict';

/**
 * Exchange a short-lived user token for a long-lived (~60-day) one and save it
 * to tools/meta-ads/.token (gitignored). Retries on Meta's transient OAuth errors.
 * The app secret is read from env at runtime and never written to disk.
 *
 * Usage (PowerShell):
 *   $env:META_APP_ID="1550729296644079"
 *   $env:META_APP_SECRET="...."
 *   $env:META_SHORT_TOKEN="EAAB...."   # fresh token from Graph API Explorer
 *   node tools/meta-ads/exchange-token.js
 */

const fs = require('fs');
const path = require('path');
const V = process.env.META_API_VERSION || 'v23.0';
const APP = process.env.META_APP_ID;
const SEC = process.env.META_APP_SECRET;
const TOK = process.env.META_SHORT_TOKEN || process.env.META_ACCESS_TOKEN;

if (!APP || !SEC || !TOK) {
  console.error('need META_APP_ID, META_APP_SECRET, and META_SHORT_TOKEN (or META_ACCESS_TOKEN)');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = 'https://graph.facebook.com/' + V + '/oauth/access_token?grant_type=fb_exchange_token'
  + '&client_id=' + APP + '&client_secret=' + SEC + '&fb_exchange_token=' + TOK;

(async () => {
  for (let i = 1; i <= 6; i++) {
    const j = await fetch(url).then((r) => r.json());
    if (!j.error) {
      const out = path.join(__dirname, '.token');
      fs.writeFileSync(out, j.access_token);
      console.log('EXCHANGE OK (attempt ' + i + '); ~' + Math.round((j.expires_in || 0) / 86400) + ' days; saved -> ' + out);
      return;
    }
    console.log('attempt ' + i + ' failed: ' + j.error.message + ' (transient=' + j.error.is_transient + ')');
    if (!j.error.is_transient) process.exit(1);
    await sleep(4000);
  }
  console.error('Still transient after 6 tries — Meta OAuth is flaky right now. Your short token is still valid, so we can keep working and exchange later.');
  process.exit(2);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
