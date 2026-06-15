#!/usr/bin/env node
'use strict';

/**
 * Clone an ad set's audience/optimization into a NEW ad set (for isolated
 * creative testing), with its own name + budget, created PAUSED. Copies
 * targeting, optimization_goal, billing_event, bid_strategy, promoted_object,
 * attribution_spec, destination_type — everything except the ads.
 *
 *   SRC_ADSET=<id> NEW_NAME="..." BUDGET=<agorot> node tools/meta-ads/create-test-adset.js
 */

const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ACCOUNT = 'act_3411622499006924';
const BASE = 'https://graph.facebook.com/' + V;

const SRC_ADSET = process.env.SRC_ADSET || '120250812785600440'; // winner
const CAMPAIGN = process.env.CAMPAIGN || '120250228243680440';   // purchase campaign
const NEW_NAME = process.env.NEW_NAME || 'Hook 2 Video Test (EU)';
const BUDGET = process.env.BUDGET || '3000';                     // agorot (₪30/day)

(async () => {
  const src = await fetch(BASE + '/' + SRC_ADSET + '?fields=optimization_goal,billing_event,bid_strategy,promoted_object,targeting,attribution_spec,destination_type&access_token=' + T).then((r) => r.json());
  if (src.error) { console.error('FETCH FAILED:', src.error.message); process.exit(1); }
  console.log('cloning winner → opt=' + src.optimization_goal + ' billing=' + src.billing_event + ' bid=' + src.bid_strategy);
  console.log('promoted_object:', JSON.stringify(src.promoted_object || null));

  // Meta now requires "explore" whenever "explore_home" is present (newer rule)
  if (src.targeting && Array.isArray(src.targeting.instagram_positions)) {
    const ip = src.targeting.instagram_positions;
    if (ip.indexOf('explore_home') !== -1 && ip.indexOf('explore') === -1) { ip.push('explore'); console.log('targeting fix: added IG "explore" position'); }
  }

  const p = new URLSearchParams();
  p.append('name', NEW_NAME);
  p.append('campaign_id', CAMPAIGN);
  p.append('daily_budget', BUDGET);
  p.append('billing_event', src.billing_event || 'IMPRESSIONS');
  p.append('optimization_goal', src.optimization_goal || 'OFFSITE_CONVERSIONS');
  if (src.bid_strategy) p.append('bid_strategy', src.bid_strategy);
  if (src.promoted_object) p.append('promoted_object', JSON.stringify(src.promoted_object));
  if (src.attribution_spec) p.append('attribution_spec', JSON.stringify(src.attribution_spec));
  if (src.destination_type) p.append('destination_type', src.destination_type);
  p.append('targeting', JSON.stringify(src.targeting));
  p.append('status', 'PAUSED');
  p.append('access_token', T);

  const res = await fetch(BASE + '/' + ACCOUNT + '/adsets', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p }).then((r) => r.json());
  if (res.error) { console.error('CREATE FAILED:', JSON.stringify(res.error)); process.exit(1); }
  console.log('\nNEW AD SET id =', res.id, '(PAUSED, ₪' + (Number(BUDGET) / 100) + '/day)');
  console.log('next → ADSET_ID=' + res.id + ' AD_NAME="Hook 2 Final - Captions (test)" VIDEO_ID=998571512964782 node tools/meta-ads/create-video-ad.js');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
