#!/usr/bin/env node
'use strict';

/**
 * Create (or reuse) a Meta Customer List custom audience and upload SHA256-hashed
 * emails from a CSV. Raw emails are hashed locally — only hashes are sent to Meta.
 *
 *   CSV="path.csv" AUD_NAME="..." [AUD_ID=<existing>] [DESC="..."] \
 *   node tools/meta-ads/upload-customer-list.js
 *
 * Emails are extracted by pattern (the email column is the only place they appear),
 * normalized (trim+lowercase) and de-duped before hashing.
 */

const fs = require('fs');
const crypto = require('crypto');
const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ACCOUNT = 'act_3411622499006924';
const BASE = 'https://graph.facebook.com/' + V;

const CSV = process.env.CSV;
const AUD_NAME = process.env.AUD_NAME || 'Stride - Customer List (upload)';
const DESC = process.env.DESC || 'Uploaded from CRM';
const sha = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

(async () => {
  if (!T) { console.error('no token'); process.exit(1); }
  if (!CSV || !fs.existsSync(CSV)) { console.error('CSV not found:', CSV); process.exit(1); }

  const txt = fs.readFileSync(CSV, 'utf8');
  const emails = [...new Set(
    (txt.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [])
      .map((e) => e.trim().toLowerCase())
  )];
  console.log('unique valid emails found:', emails.length);
  if (!emails.length) { console.error('no emails extracted'); process.exit(1); }

  // 1. create (or reuse) the Customer List audience
  let audId = process.env.AUD_ID;
  if (!audId) {
    const b = new URLSearchParams({
      name: AUD_NAME,
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
      description: DESC,
      access_token: T,
    });
    const r = await (await fetch(BASE + '/' + ACCOUNT + '/customaudiences', { method: 'POST', body: b })).json();
    if (r.error) {
      console.error('CREATE FAILED:', r.error.message);
      if (/terms|tos/i.test(r.error.message)) console.error('  -> Accept the Custom Audience Terms once in Business Settings, then re-run.');
      process.exit(1);
    }
    audId = r.id;
    console.log('created audience:', audId, '|', AUD_NAME);
  } else {
    console.log('reusing audience:', audId);
  }

  // 2. upload hashed emails (one batch; cap is 10k/call, far above this)
  const data = emails.map((e) => [sha(e)]);
  const b2 = new URLSearchParams({ payload: JSON.stringify({ schema: ['EMAIL'], data }), access_token: T });
  const r2 = await (await fetch(BASE + '/' + audId + '/users', { method: 'POST', body: b2 })).json();
  if (r2.error) { console.error('UPLOAD FAILED:', JSON.stringify(r2.error)); process.exit(1); }
  console.log('upload result:', JSON.stringify(r2));
  console.log('\nDONE: audience', audId, '— sent', emails.length, 'hashed emails (num_received in result above).');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
