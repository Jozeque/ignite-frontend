#!/usr/bin/env node
'use strict';

/**
 * Upload a local video, clone the existing ad copy/CTA onto it, and create the
 * ad PAUSED in the target ad set. Resumable: pass VIDEO_ID=<id> to skip upload.
 *
 * Token auto-loads from env or .token. Run from project root:
 *   node tools/meta-ads/create-video-ad.js
 */

const fs = require('fs');
const T = require('./_token')();
const V = process.env.META_API_VERSION || 'v23.0';
const ACCOUNT = 'act_3411622499006924';
const BASE = 'https://graph.facebook.com/' + V;

const CFG = {
  videoPath: 'D:/Stridehub content/June New Commercial/Finals/Hook 2 Final - Captions.mp4',
  adsetId: process.env.ADSET_ID || '120250812785600440',  // default winner; override via ADSET_ID env
  pageId: '1161197470406860',
  igUserId: '17841440065213071',
  link: 'https://stridehub.io/',
  linkCaption: 'stridehub.io/20%Discount',
  cta: 'SHOP_NOW',
  title: 'Get Stride Now for 20% OFF',
  adName: process.env.AD_NAME || 'Hook 2 Final - Captions',
  message: 'Get Stride Now for 20% OFF\nDiscount code: REKZ\n\nInject dozens of unique automation lanes into your rack with one click.\n\nPick your parameters, inject unique curves, apply them to your clip, and iterate again.\n\nBuild endless sound design sessions that keep you creative.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!T) { console.error('no token'); process.exit(1); }
  let videoId = process.env.VIDEO_ID;

  // 1. upload
  if (!videoId) {
    if (!fs.existsSync(CFG.videoPath)) { console.error('video not found:', CFG.videoPath); process.exit(1); }
    const buf = fs.readFileSync(CFG.videoPath);
    console.log('uploading', (buf.length / 1048576).toFixed(1), 'MB ...');
    const fd = new FormData();
    fd.append('access_token', T);
    fd.append('name', CFG.adName);
    fd.append('source', new Blob([buf]), 'hook2.mp4');
    const up = await fetch(BASE + '/' + ACCOUNT + '/advideos', { method: 'POST', body: fd }).then((r) => r.json());
    if (up.error) { console.error('UPLOAD FAILED:', up.error.message); process.exit(1); }
    videoId = up.id;
    console.log('video_id =', videoId, '(save this to resume: VIDEO_ID=' + videoId + ')');
  } else {
    console.log('reusing video_id =', videoId);
  }

  // 2. wait for processing
  let ready = false;
  for (let i = 0; i < 45; i++) {
    const st = await fetch(BASE + '/' + videoId + '?fields=status&access_token=' + T).then((r) => r.json());
    const vs = st.status && st.status.video_status;
    if (vs === 'ready') { ready = true; break; }
    if (vs === 'error') { console.error('processing error:', JSON.stringify(st.status)); process.exit(1); }
    if (i % 3 === 0) console.log('  processing...', vs || 'pending');
    await sleep(4000);
  }
  if (!ready) { console.error('not ready after wait; rerun with VIDEO_ID=' + videoId); process.exit(2); }
  console.log('video ready.');

  // 3. preferred thumbnail
  const th = await fetch(BASE + '/' + videoId + '/thumbnails?access_token=' + T).then((r) => r.json());
  const thumbs = (th && th.data) || [];
  const pref = thumbs.find((x) => x.is_preferred) || thumbs[0];
  const imageUrl = pref && pref.uri;
  console.log('thumbnail:', imageUrl ? 'ok' : 'none (Meta will pick)');

  // 4. creative
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
  const cfd = new URLSearchParams();
  cfd.append('name', CFG.adName + ' — creative');
  cfd.append('object_story_spec', JSON.stringify(storySpec));
  cfd.append('access_token', T);
  const cr = await fetch(BASE + '/' + ACCOUNT + '/adcreatives', { method: 'POST', body: cfd }).then((r) => r.json());
  if (cr.error) { console.error('CREATIVE FAILED:', JSON.stringify(cr.error)); process.exit(1); }
  console.log('creative_id =', cr.id);

  // 5. ad (PAUSED)
  const afd = new URLSearchParams();
  afd.append('name', CFG.adName);
  afd.append('adset_id', CFG.adsetId);
  afd.append('creative', JSON.stringify({ creative_id: cr.id }));
  afd.append('status', 'PAUSED');
  afd.append('access_token', T);
  const ad = await fetch(BASE + '/' + ACCOUNT + '/ads', { method: 'POST', body: afd }).then((r) => r.json());
  if (ad.error) { console.error('AD FAILED:', JSON.stringify(ad.error)); process.exit(1); }
  console.log('\nAD CREATED (PAUSED) id =', ad.id, '\nPreview it in Ads Manager, then activate.');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
