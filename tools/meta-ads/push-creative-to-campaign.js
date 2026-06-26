#!/usr/bin/env node
'use strict';

/**
 * Upload a local video ONCE, build one creative with the standard purchase copy,
 * and create an ad (default ACTIVE) for it in EVERY active ad set of a campaign.
 * Reuses the single creative across all ads (shared post = pooled social proof).
 *
 *   VIDEO_PATH="..." CAMPAIGN=<id> AD_BASENAME="..." AD_STATUS=ACTIVE \
 *   [VIDEO_ID=<id>] [DRY=1] node tools/meta-ads/push-creative-to-campaign.js
 *
 * DRY=1 → just enumerate the active ad sets + check the file, change nothing.
 */

const fs = require('fs');
const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ACCOUNT = 'act_3411622499006924';
const BASE = 'https://graph.facebook.com/' + V;

const CFG = {
  videoPath: process.env.VIDEO_PATH || 'D:/Stridehub content/fresh creative/final renders/final with subs.mp4',
  campaign: process.env.CAMPAIGN || '120250228243680440', // purchase campaign
  adBasename: process.env.AD_BASENAME || 'Fresh Creative - Subs',
  adStatus: process.env.AD_STATUS || 'ACTIVE',
  pageId: '1161197470406860',
  igUserId: '17841440065213071',
  link: 'https://stridehub.io/',
  linkCaption: 'stridehub.io/20%Discount',
  cta: 'SHOP_NOW',
  title: 'Get Stride Now for 20% OFF',
  message: 'Get Stride Now for 20% OFF\nDiscount code: REKZ\n\nInject dozens of unique automation lanes into your rack with one click.\n\nPick your parameters, inject unique curves, apply them to your clip, and iterate again.\n\nBuild endless sound design sessions that keep you creative.',
};
const DRY = process.env.DRY === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJ = async (node, params = {}) => {
  const u = new URL(BASE + '/' + node);
  u.searchParams.set('access_token', T);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const j = await (await fetch(u)).json();
  if (j.error) throw new Error(node + ' GET -> ' + j.error.message);
  return j;
};
const postJ = async (node, params) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  body.append('access_token', T);
  const j = await (await fetch(BASE + '/' + node, { method: 'POST', body })).json();
  if (j.error) throw new Error(node + ' POST -> ' + j.error.message + (j.error.error_user_msg ? ' | ' + j.error.error_user_msg : ''));
  return j;
};
const geoSuffix = (t) => {
  const c = t && t.geo_locations && t.geo_locations.countries;
  if (Array.isArray(c) && c.length === 1) return c[0];
  if (Array.isArray(c) && c.length > 1) return 'EU';
  return 'X';
};

(async () => {
  if (!T) { console.error('no token'); process.exit(1); }

  // 1. enumerate ACTIVE ad sets in the campaign
  const all = await getJ(CFG.campaign + '/adsets', { fields: 'name,effective_status,daily_budget,targeting{geo_locations}', limit: '100' });
  const active = (all.data || []).filter((s) => s.effective_status === 'ACTIVE');
  console.log('Active ad sets in campaign ' + CFG.campaign + ': ' + active.length);
  for (const s of active) console.log('  - ' + s.name + ' (' + s.id + ') | ₪' + (s.daily_budget/100) + '/day | geo ' + geoSuffix(s.targeting) + ' -> ad "' + CFG.adBasename + ' (' + geoSuffix(s.targeting) + ')"');

  const fileOk = fs.existsSync(CFG.videoPath);
  console.log('\nvideo file: ' + CFG.videoPath + ' -> ' + (fileOk ? 'FOUND' : 'MISSING'));
  console.log('ad status will be: ' + CFG.adStatus);

  if (DRY) { console.log('\n[DRY RUN] nothing created.'); return; }
  if (!active.length) { console.error('no active ad sets — abort'); process.exit(1); }

  // 2. upload video once (or reuse VIDEO_ID)
  let videoId = process.env.VIDEO_ID;
  if (!videoId) {
    if (!fileOk) { console.error('video not found:', CFG.videoPath); process.exit(1); }
    const buf = fs.readFileSync(CFG.videoPath);
    console.log('\nuploading', (buf.length / 1048576).toFixed(1), 'MB ...');
    const fd = new FormData();
    fd.append('access_token', T);
    fd.append('name', CFG.adBasename);
    fd.append('source', new Blob([buf]), 'fresh.mp4');
    const up = await (await fetch(BASE + '/' + ACCOUNT + '/advideos', { method: 'POST', body: fd })).json();
    if (up.error) { console.error('UPLOAD FAILED:', up.error.message); process.exit(1); }
    videoId = up.id;
    console.log('video_id =', videoId, '(resume with VIDEO_ID=' + videoId + ')');
  } else { console.log('\nreusing video_id =', videoId); }

  // 3. wait for processing
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const st = await getJ(videoId, { fields: 'status' });
    const vs = st.status && st.status.video_status;
    if (vs === 'ready') { ready = true; break; }
    if (vs === 'error') { console.error('processing error:', JSON.stringify(st.status)); process.exit(1); }
    if (i % 3 === 0) console.log('  processing...', vs || 'pending');
    await sleep(4000);
  }
  if (!ready) { console.error('not ready; rerun with VIDEO_ID=' + videoId); process.exit(2); }
  console.log('video ready.');

  // 4. preferred thumbnail
  const th = await getJ(videoId + '/thumbnails');
  const thumbs = (th && th.data) || [];
  const pref = thumbs.find((x) => x.is_preferred) || thumbs[0];
  const imageUrl = pref && pref.uri;

  // 5. one creative
  const storySpec = {
    page_id: CFG.pageId,
    instagram_user_id: CFG.igUserId,
    video_data: {
      video_id: videoId,
      message: CFG.message,
      title: CFG.title,
      call_to_action: { type: CFG.cta, value: { link: CFG.link, link_caption: CFG.linkCaption } },
    },
  };
  if (imageUrl) storySpec.video_data.image_url = imageUrl;
  const cr = await postJ(ACCOUNT + '/adcreatives', { name: CFG.adBasename + ' — creative', object_story_spec: JSON.stringify(storySpec) });
  console.log('creative_id =', cr.id);

  // 6. one ad per active ad set
  console.log('\ncreating ads:');
  const made = [];
  for (const s of active) {
    const name = CFG.adBasename + ' (' + geoSuffix(s.targeting) + ')';
    try {
      const ad = await postJ(ACCOUNT + '/ads', { name, adset_id: s.id, creative: JSON.stringify({ creative_id: cr.id }), status: CFG.adStatus });
      console.log('  + [' + CFG.adStatus + '] ' + name + ' -> ad ' + ad.id + ' (in ' + s.name + ')');
      made.push(ad.id);
    } catch (e) { console.error('  ! FAILED ' + name + ': ' + e.message); }
  }
  console.log('\nDONE: ' + made.length + '/' + active.length + ' ads created from creative ' + cr.id + ' (video ' + videoId + ').');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
