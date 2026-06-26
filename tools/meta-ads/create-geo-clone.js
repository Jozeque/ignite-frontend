#!/usr/bin/env node
'use strict';

/**
 * Clone a source ad set into a NEW ad set in the same campaign, changing ONLY
 * the target country, and re-create its ACTIVE ads pointing at the SAME creative
 * objects (no re-upload). Everything else (age, interests, Advantage+ audience,
 * exclusions, placements, optimization, pixel, bid) is copied verbatim.
 *
 *   SRC_ADSET=<id> CAMPAIGN=<id> COUNTRY=BR NEW_NAME="..." BUDGET=5000 \
 *   STATUS=ACTIVE AD_STATUS=ACTIVE node tools/meta-ads/create-geo-clone.js
 *
 * BUDGET is in agorot (5000 = ₪50/day). Token auto-loads from env or .token.
 */

const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ACCOUNT = 'act_3411622499006924';
const BASE = 'https://graph.facebook.com/' + V;

const SRC_ADSET = process.env.SRC_ADSET || '120251119848790440'; // US ad set
const CAMPAIGN  = process.env.CAMPAIGN  || '120250228243680440'; // purchase campaign
const COUNTRY   = process.env.COUNTRY   || 'BR';
// Match the US set's naming ("פרסומת פנים רק אמריקה" = "face ad, X only").
const NAMES = { BR: 'פרסומת פנים רק ברזיל', AU: 'פרסומת פנים רק אוסטרליה' };
const NEW_NAME  = process.env.NEW_NAME  || NAMES[COUNTRY] || ('פרסומת פנים ' + COUNTRY);
const BUDGET    = process.env.BUDGET    || '5000';               // agorot
const STATUS    = process.env.STATUS    || 'ACTIVE';
const AD_STATUS = process.env.AD_STATUS || 'ACTIVE';

const post = async (node, params) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  body.append('access_token', T);
  const j = await (await fetch(BASE + '/' + node, { method: 'POST', body })).json();
  if (j.error) throw new Error(node + ' POST -> ' + j.error.message + (j.error.error_user_msg ? ' | ' + j.error.error_user_msg : ''));
  return j;
};
const get = async (node, fields) => {
  const j = await (await fetch(BASE + '/' + node + '?fields=' + encodeURIComponent(fields) + '&access_token=' + T)).json();
  if (j.error) throw new Error(node + ' GET -> ' + j.error.message);
  return j;
};

(async () => {
  if (!T) { console.error('no token'); process.exit(1); }

  // 1. read the source ad set
  const src = await get(SRC_ADSET, 'optimization_goal,billing_event,bid_strategy,promoted_object,targeting,attribution_spec,destination_type');
  const tgt = src.targeting || {};

  // 2. swap ONLY the country; keep location_types + everything else
  tgt.geo_locations = Object.assign({}, tgt.geo_locations, { countries: [COUNTRY] });
  // strip name from excluded_custom_audiences (id is all the API needs)
  if (Array.isArray(tgt.excluded_custom_audiences)) {
    tgt.excluded_custom_audiences = tgt.excluded_custom_audiences.map((a) => ({ id: a.id }));
  }

  console.log('--- cloning US ad set -> ' + COUNTRY + ' ---');
  console.log('opt=' + src.optimization_goal + ' billing=' + src.billing_event + ' bid=' + src.bid_strategy);
  console.log('pixel/promoted_object:', JSON.stringify(src.promoted_object || null));
  console.log('geo now:', JSON.stringify(tgt.geo_locations));

  // 3. create the ad set
  const setParams = {
    name: NEW_NAME,
    campaign_id: CAMPAIGN,
    daily_budget: BUDGET,
    billing_event: src.billing_event || 'IMPRESSIONS',
    optimization_goal: src.optimization_goal || 'OFFSITE_CONVERSIONS',
    targeting: JSON.stringify(tgt),
    status: STATUS,
  };
  if (src.bid_strategy) setParams.bid_strategy = src.bid_strategy;
  if (src.promoted_object) setParams.promoted_object = JSON.stringify(src.promoted_object);
  if (src.attribution_spec) setParams.attribution_spec = JSON.stringify(src.attribution_spec);
  if (src.destination_type && src.destination_type !== 'UNDEFINED') setParams.destination_type = src.destination_type;

  const set = await post(ACCOUNT + '/adsets', setParams);
  console.log('\nNEW AD SET (' + STATUS + ') id =', set.id, '| ₪' + (Number(BUDGET) / 100) + '/day | ' + NEW_NAME);

  // 4. re-create the SOURCE ad set's ACTIVE ads, reusing the same creative objects
  const ads = await get(SRC_ADSET + '/ads', 'name,status,effective_status,creative{id}');
  const active = (ads.data || []).filter((a) => a.status === 'ACTIVE' && a.creative && a.creative.id);
  console.log('\nreplicating ' + active.length + ' active creative(s):');
  const made = [];
  for (const a of active) {
    const adName = a.name.indexOf('(US)') !== -1
      ? a.name.replace('(US)', '(' + COUNTRY + ')')
      : a.name + ' (' + COUNTRY + ')';
    try {
      const ad = await post(ACCOUNT + '/ads', {
        name: adName,
        adset_id: set.id,
        creative: JSON.stringify({ creative_id: a.creative.id }),
        status: AD_STATUS,
      });
      console.log('  + [' + AD_STATUS + '] ' + adName + ' (creative ' + a.creative.id + ') -> ad ' + ad.id);
      made.push(ad.id);
    } catch (e) {
      console.error('  ! FAILED ' + adName + ': ' + e.message);
    }
  }
  console.log('\nDONE ' + COUNTRY + ': ad set ' + set.id + ' with ' + made.length + '/' + active.length + ' ads.');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
