#!/usr/bin/env node
'use strict';

/**
 * Duplicate an ad set but swap its audience to a single lookalike (keeping the
 * ORIGINAL geo, age, placements, optimization, exclusions, and creatives).
 * Drops the source's interest/flexible_spec so the lookalike is the audience,
 * and turns Advantage+ Audience OFF so the lookalike is respected (not expanded).
 * Ad set created PAUSED by default; ads created ACTIVE (so flipping the set on
 * runs them). Reuses the source's ACTIVE creatives (no re-upload).
 *
 *   SRC_ADSET=<id> CAMPAIGN=<id> LAL_ID=<id> BUDGET=25000 \
 *   [NEW_NAME="..."] [STATUS=PAUSED] [AD_STATUS=ACTIVE] node tools/meta-ads/create-lal-dup.js
 */

const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ACCOUNT = 'act_3411622499006924';
const BASE = 'https://graph.facebook.com/' + V;

const SRC_ADSET = process.env.SRC_ADSET || '120251119848790440';
const CAMPAIGN  = process.env.CAMPAIGN  || '120250228243680440';
const LAL_ID    = process.env.LAL_ID    || '120251875054610440';
const BUDGET    = process.env.BUDGET    || '25000';   // agorot (₪250)
const STATUS    = process.env.STATUS    || 'PAUSED';
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

  const src = await get(SRC_ADSET, 'name,optimization_goal,billing_event,bid_strategy,promoted_object,targeting,attribution_spec,destination_type');
  const t = src.targeting || {};

  // Swap the audience to the lookalike; keep geo/age/placements/exclusions.
  delete t.flexible_spec;            // drop the interest targeting
  delete t.interests;
  delete t.behaviors;
  delete t.targeting_relaxation_types; // no lookalike/custom-audience expansion override
  t.custom_audiences = [{ id: LAL_ID }];
  if (Array.isArray(t.excluded_custom_audiences)) {
    t.excluded_custom_audiences = t.excluded_custom_audiences.map((a) => ({ id: a.id }));
  }
  // Advantage+ Audience OFF can't use age_range (Advantage-only) — convert the
  // intended range to hard age_min/age_max so we keep 25-50 instead of 18-65.
  const _lo = (Array.isArray(t.age_range) && t.age_range[0]) || t.age_min || 18;
  const _hi = (Array.isArray(t.age_range) && t.age_range[1]) || t.age_max || 65;
  t.age_min = _lo; t.age_max = _hi;
  delete t.age_range;
  t.targeting_automation = { advantage_audience: 0 }; // respect the lookalike, don't expand
  // Meta now requires IG "explore" whenever "explore_home" is present.
  if (Array.isArray(t.instagram_positions) && t.instagram_positions.indexOf('explore_home') !== -1 && t.instagram_positions.indexOf('explore') === -1) {
    t.instagram_positions.push('explore');
  }

  const NEW_NAME = process.env.NEW_NAME || (src.name + ' - LAL Purchase');

  console.log('--- duplicating "' + src.name + '" -> lookalike audience ---');
  console.log('geo kept:', JSON.stringify(t.geo_locations && t.geo_locations.countries));
  console.log('audience set to LAL:', LAL_ID, '| advantage_audience: 0 | interests dropped');

  const setParams = {
    name: NEW_NAME,
    campaign_id: CAMPAIGN,
    daily_budget: BUDGET,
    billing_event: src.billing_event || 'IMPRESSIONS',
    optimization_goal: src.optimization_goal || 'OFFSITE_CONVERSIONS',
    targeting: JSON.stringify(t),
    status: STATUS,
  };
  if (src.bid_strategy) setParams.bid_strategy = src.bid_strategy;
  if (src.promoted_object) setParams.promoted_object = JSON.stringify(src.promoted_object);
  if (src.attribution_spec) setParams.attribution_spec = JSON.stringify(src.attribution_spec);
  if (src.destination_type && src.destination_type !== 'UNDEFINED') setParams.destination_type = src.destination_type;

  const set = await post(ACCOUNT + '/adsets', setParams);
  console.log('\nNEW AD SET (' + STATUS + ') id =', set.id, '| ₪' + (Number(BUDGET) / 100) + '/day | ' + NEW_NAME);

  // Re-create the source's ACTIVE ads, reusing the same creative objects.
  const ads = await get(SRC_ADSET + '/ads', 'name,status,creative{id}');
  const active = (ads.data || []).filter((a) => a.status === 'ACTIVE' && a.creative && a.creative.id);
  console.log('\nreplicating ' + active.length + ' active creative(s) [' + AD_STATUS + ']:');
  let made = 0;
  for (const a of active) {
    const adName = a.name + ' · LAL';
    try {
      const ad = await post(ACCOUNT + '/ads', { name: adName, adset_id: set.id, creative: JSON.stringify({ creative_id: a.creative.id }), status: AD_STATUS });
      console.log('  + ' + adName + ' (creative ' + a.creative.id + ') -> ad ' + ad.id);
      made++;
    } catch (e) { console.error('  ! FAILED ' + adName + ': ' + e.message); }
  }
  console.log('\nDONE: ad set ' + set.id + ' (' + STATUS + ') with ' + made + '/' + active.length + ' ads.');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
