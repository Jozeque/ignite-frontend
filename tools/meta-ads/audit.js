#!/usr/bin/env node
'use strict';

/**
 * Stride — Meta Ads audit (READ-ONLY)
 * ------------------------------------------------------------
 * Pulls every campaign -> ad set -> ad with insights from the Meta
 * Marketing API and flags problems. Makes ONLY GET requests — it can
 * never change, pause, or spend anything on your account.
 *
 * Usage (PowerShell):
 *   $env:META_ACCESS_TOKEN="EAAB..."          # token with ads_read (+ads_management for fixes later)
 *   $env:META_AD_ACCOUNT_ID="act_1234567890"  # from Ads Manager (act_ optional)
 *   node tools/meta-ads/audit.js
 *
 * Optional:
 *   $env:META_DATE_PRESET="last_30d"   # last_7d | last_14d | last_30d | last_90d | maximum
 *   $env:META_API_VERSION="v23.0"      # bump if Meta rejects the version
 *   $env:META_TIME_RANGE='{"since":"2026-05-01","until":"2026-05-31"}'  # overrides date preset
 *
 * Writes a full machine-readable report to tools/meta-ads/report.json
 */

const fs = require('fs');
const path = require('path');

// ─── config ──────────────────────────────────────────────────────────
const TOKEN = require('./_token')();
let ACCOUNT = process.env.META_AD_ACCOUNT_ID || 'act_3411622499006924';
const VERSION = process.env.META_API_VERSION || 'v23.0';
const DATE_PRESET = process.env.META_DATE_PRESET || 'last_30d';
const TIME_RANGE = process.env.META_TIME_RANGE; // raw JSON string, optional
const BASE = `https://graph.facebook.com/${VERSION}`;
const OUT = path.join(__dirname, 'report.json');

if (!TOKEN || !ACCOUNT) {
  console.error('\nMissing credentials.\n');
  console.error('  Set META_ACCESS_TOKEN  (token with ads_read scope)');
  console.error('  Set META_AD_ACCOUNT_ID (e.g. act_1234567890 — find it in Ads Manager)\n');
  process.exit(1);
}
if (!ACCOUNT.startsWith('act_')) ACCOUNT = 'act_' + ACCOUNT.replace(/\D/g, '');

// ─── heuristic thresholds (tunable) ──────────────────────────────────
const T = {
  minImpressions: 1000,      // ignore CTR/fatigue noise below this
  highFrequency: 3.0,        // ad fatigue over the window
  lowLinkCtrPct: 0.7,        // weak creative / targeting (link CTR %)
  cpaMultiplier: 1.5,        // "expensive" = > 1.5x account avg CPA
  budgetConcentration: 0.5,  // one ad set eating >50% of spend
  zeroConvMinSpendUsd: 25,   // 0 conversions but spent at least this much
};

const PURCHASE_TYPES = [
  'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase',
  'onsite_web_app_purchase', 'web_in_store_purchase',
];
const LEAD_TYPES = [
  'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped',
];

// ─── graph helpers ───────────────────────────────────────────────────
function buildUrl(node, params = {}) {
  const url = new URL(`${BASE}/${node}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function graphGet(node, params) {
  const res = await fetch(buildUrl(node, params));
  const json = await res.json();
  if (json.error) throw new Error(`Graph API: ${json.error.message} (code ${json.error.code}${json.error.error_subcode ? '/' + json.error.error_subcode : ''})`);
  return json;
}

async function graphGetAll(node, params) {
  let url = buildUrl(node, params);
  const out = [];
  while (url) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) throw new Error(`Graph API: ${json.error.message} (code ${json.error.code})`);
    out.push(...(json.data || []));
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return out;
}

// ─── insights field expansion ────────────────────────────────────────
const METRICS = [
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks',
  'ctr', 'inline_link_click_ctr', 'cpc', 'cpm', 'actions', 'action_values',
  'cost_per_action_type', 'purchase_roas',
].join(',');

const insightWindow = TIME_RANGE ? `time_range(${TIME_RANGE})` : `date_preset(${DATE_PRESET})`;
const insightsField = `insights.${insightWindow}{${METRICS}}`;

// ─── extractors ──────────────────────────────────────────────────────
function pickAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return Number(a.value || 0);
  }
  return 0;
}

function metrics(entity) {
  const i = entity.insights && entity.insights.data && entity.insights.data[0];
  if (!i) return null;
  const spend = Number(i.spend || 0);
  const purchases = pickAction(i.actions, PURCHASE_TYPES);
  const leads = pickAction(i.actions, LEAD_TYPES);
  const roasArr = i.purchase_roas && i.purchase_roas[0];
  return {
    spend,
    impressions: Number(i.impressions || 0),
    reach: Number(i.reach || 0),
    frequency: Number(i.frequency || 0),
    clicks: Number(i.clicks || 0),
    linkClicks: Number(i.inline_link_clicks || 0),
    ctr: Number(i.ctr || 0),
    linkCtr: Number(i.inline_link_click_ctr || 0),
    cpc: Number(i.cpc || 0),
    cpm: Number(i.cpm || 0),
    purchases,
    leads,
    cpa: purchases > 0 ? spend / purchases : null,
    roas: roasArr ? Number(roasArr.value || 0) : null,
  };
}

const budgetOf = (e) => {
  const d = Number(e.daily_budget || 0);
  const l = Number(e.lifetime_budget || 0);
  if (d) return { type: 'daily', amount: d / 100 };
  if (l) return { type: 'lifetime', amount: l / 100 };
  return null;
};

// ─── fetch ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\nStride · Meta Ads audit`);
  console.log(`Account ${ACCOUNT} · window ${TIME_RANGE ? 'custom range' : DATE_PRESET} · API ${VERSION}\n`);

  const acct = await graphGet(ACCOUNT, {
    fields: 'name,currency,account_status,amount_spent,balance,spend_cap,disable_reason',
  });
  const cur = acct.currency || 'USD';

  const [campaigns, adsets, ads] = await Promise.all([
    graphGetAll(`${ACCOUNT}/campaigns`, {
      fields: `name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,${insightsField}`,
      limit: '200',
    }),
    graphGetAll(`${ACCOUNT}/adsets`, {
      fields: `name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,${insightsField}`,
      limit: '200',
    }),
    graphGetAll(`${ACCOUNT}/ads`, {
      fields: `name,adset_id,campaign_id,status,effective_status,${insightsField}`,
      limit: '300',
    }),
  ]);

  // attach metrics
  for (const c of campaigns) c._m = metrics(c);
  for (const s of adsets) s._m = metrics(s);
  for (const a of ads) a._m = metrics(a);

  // account-level rollup from ads (most granular spend)
  const totalSpend = ads.reduce((s, a) => s + (a._m ? a._m.spend : 0), 0);
  const totalPurch = ads.reduce((s, a) => s + (a._m ? a._m.purchases : 0), 0);
  const acctCpa = totalPurch > 0 ? totalSpend / totalPurch : null;

  // ─── diagnostics ───────────────────────────────────────────────────
  const issues = [];
  const flag = (level, scope, name, id, message, spendAtStake, action) =>
    issues.push({ level, scope, name, id, message, spendAtStake: Number(spendAtStake.toFixed(2)), suggestedAction: action });

  // disapprovals / delivery errors (any level — start with ads)
  for (const a of ads) {
    const es = a.effective_status;
    if (es === 'DISAPPROVED' || es === 'WITH_ISSUES') {
      flag('high', 'ad', a.name, a.id, `Ad delivery blocked: ${es}`, a._m ? a._m.spend : 0,
        'Review policy issue and resubmit, or replace creative');
    }
  }

  // ad-level performance flags
  for (const a of ads) {
    const m = a._m;
    if (!m || a.effective_status !== 'ACTIVE') continue;

    if (m.spend >= T.zeroConvMinSpendUsd && m.purchases === 0 && m.leads === 0) {
      flag('high', 'ad', a.name, a.id,
        `Spent ${cur} ${m.spend.toFixed(2)} with 0 conversions`, m.spend,
        'Pause this ad — money with nothing to show');
    } else if (acctCpa && m.cpa && m.cpa > acctCpa * T.cpaMultiplier && m.spend >= T.zeroConvMinSpendUsd) {
      flag('medium', 'ad', a.name, a.id,
        `CPA ${cur} ${m.cpa.toFixed(2)} is ${(m.cpa / acctCpa).toFixed(1)}x account avg (${cur} ${acctCpa.toFixed(2)})`, m.spend,
        'Pause or cut budget — well above account average cost');
    }

    if (m.impressions >= T.minImpressions && m.frequency >= T.highFrequency) {
      flag('medium', 'ad', a.name, a.id,
        `Frequency ${m.frequency.toFixed(1)} — audience is seeing this too often (fatigue)`, m.spend,
        'Refresh creative or widen the audience');
    }

    if (m.impressions >= T.minImpressions && m.linkCtr > 0 && m.linkCtr < T.lowLinkCtrPct) {
      flag('low', 'ad', a.name, a.id,
        `Link CTR ${m.linkCtr.toFixed(2)}% is weak (<${T.lowLinkCtrPct}%)`, m.spend,
        'Creative/hook not landing — test a new angle');
    }
  }

  // budget concentration across active ad sets
  const activeSets = adsets.filter((s) => s._m && s.effective_status === 'ACTIVE' && s._m.spend > 0);
  const setSpendTotal = activeSets.reduce((s, x) => s + x._m.spend, 0);
  if (setSpendTotal > 0) {
    for (const s of activeSets) {
      const share = s._m.spend / setSpendTotal;
      if (share > T.budgetConcentration && acctCpa && s._m.cpa && s._m.cpa > acctCpa) {
        flag('medium', 'adset', s.name, s.id,
          `Eating ${(share * 100).toFixed(0)}% of spend at above-avg CPA (${cur} ${s._m.cpa.toFixed(2)})`, s._m.spend,
          'Rebalance budget toward cheaper ad sets');
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => (order[a.level] - order[b.level]) || (b.spendAtStake - a.spendAtStake));

  // ─── report object ─────────────────────────────────────────────────
  const report = {
    account: {
      id: ACCOUNT, name: acct.name, currency: cur,
      status: acct.account_status, amountSpentLifetime: Number(acct.amount_spent || 0) / 100,
    },
    window: TIME_RANGE ? JSON.parse(TIME_RANGE) : { date_preset: DATE_PRESET },
    totals: {
      spend: Number(totalSpend.toFixed(2)),
      purchases: totalPurch,
      avgCpa: acctCpa ? Number(acctCpa.toFixed(2)) : null,
      activeAds: ads.filter((a) => a.effective_status === 'ACTIVE').length,
      activeAdSets: adsets.filter((s) => s.effective_status === 'ACTIVE').length,
      activeCampaigns: campaigns.filter((c) => c.effective_status === 'ACTIVE').length,
    },
    issues,
    campaigns: campaigns.map((c) => ({
      id: c.id, name: c.name, objective: c.objective, status: c.effective_status,
      budget: budgetOf(c), metrics: c._m,
    })),
    adsets: adsets.map((s) => ({
      id: s.id, name: s.name, campaignId: s.campaign_id, status: s.effective_status,
      optimizationGoal: s.optimization_goal, bidStrategy: s.bid_strategy,
      budget: budgetOf(s), metrics: s._m,
    })),
    ads: ads.map((a) => ({
      id: a.id, name: a.name, adsetId: a.adset_id, campaignId: a.campaign_id,
      status: a.effective_status, metrics: a._m,
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // ─── console summary ───────────────────────────────────────────────
  const money = (n) => `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  console.log(`Account: ${acct.name}`);
  console.log(`Window spend: ${money(totalSpend)}  ·  purchases: ${totalPurch}  ·  avg CPA: ${acctCpa ? money(acctCpa) : 'n/a'}`);
  console.log(`Active: ${report.totals.activeCampaigns} campaigns · ${report.totals.activeAdSets} ad sets · ${report.totals.activeAds} ads\n`);

  if (!issues.length) {
    console.log('No problems flagged by the heuristics. 🎉  (Full data in report.json)\n');
  } else {
    const counts = issues.reduce((m, i) => ((m[i.level] = (m[i.level] || 0) + 1), m), {});
    console.log(`Issues: ${counts.high || 0} high · ${counts.medium || 0} medium · ${counts.low || 0} low\n`);
    for (const i of issues.slice(0, 25)) {
      const tag = i.level === 'high' ? '[HIGH]  ' : i.level === 'medium' ? '[MED]   ' : '[LOW]   ';
      console.log(`${tag}${i.scope}: ${i.name}`);
      console.log(`        ${i.message}`);
      console.log(`        -> ${i.suggestedAction}  (spend at stake: ${money(i.spendAtStake)})\n`);
    }
    if (issues.length > 25) console.log(`...and ${issues.length - 25} more in report.json\n`);
  }
  console.log(`Full report written to: ${OUT}\n`);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  if (/code 190|access token/i.test(e.message)) console.error('  -> Token invalid/expired. Generate a fresh one (see README).');
  if (/code 100|nonexisting field|version/i.test(e.message)) console.error('  -> Try setting META_API_VERSION to a current version, e.g. v22.0 or v24.0.');
  if (/code 200|permission/i.test(e.message)) console.error('  -> Token is missing ads_read permission for this ad account.');
  process.exit(1);
});
