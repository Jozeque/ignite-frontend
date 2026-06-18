#!/usr/bin/env node
'use strict';

/**
 * Send a plain-text, personalized email to a list — ONE individual message per
 * recipient via Resend. No CC/BCC (nobody sees anyone else), no Gmail limit,
 * Primary-friendly (plain text, real From + Reply-To).
 *
 * SAFETY: dry-run by DEFAULT. It only sends for real when you add --send.
 *
 * Env (needed for --send):
 *   RESEND_API_KEY   from resend.com -> API Keys
 *   MAIL_FROM        e.g.  "Yossi from Stride <home@stridehub.io>"   (verified domain)
 *   MAIL_REPLY_TO    e.g.  "home@stridehub.io"
 *
 * Usage:
 *   node tools/email/send-list.js --file recipients.json --template templates/cart-recovery-1.txt           # DRY RUN (preview)
 *   node tools/email/send-list.js --file recipients.json --template templates/cart-recovery-1.txt --limit 3 # test 3 to yourself
 *   node tools/email/send-list.js --file recipients.json --template templates/cart-recovery-1.txt --send     # REAL send
 *
 * recipients --file : .json  -> [{ "email": "...", "name": "..." }, ...]
 *                     .csv   -> header row with `email,name`
 * template          : .txt, first line "Subject: ...", blank line, then the body. {{first_name}} is replaced.
 *
 * Resume-safe: every send is logged to sent-log.csv; re-running SKIPS anyone already sent,
 * so a mid-run failure (or a second run) never double-emails.
 */

const fs = require('fs');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

const FILE = arg('file');
const TEMPLATE = arg('template');
const SEND = process.argv.includes('--send');
const LIMIT = arg('limit') ? parseInt(arg('limit'), 10) : null;
const DELAY = arg('delay') ? parseInt(arg('delay'), 10) : 250; // ms between sends (~4/sec)
const LOG = arg('log', 'sent-log.csv');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM;
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';

if (!FILE || !TEMPLATE) {
  console.error('usage: --file recipients.(json|csv) --template path.txt [--send] [--limit N]');
  process.exit(1);
}
if (SEND && (!RESEND_API_KEY || !MAIL_FROM)) {
  console.error('to --send you must set env RESEND_API_KEY and MAIL_FROM');
  process.exit(1);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function loadRecipients(path) {
  const raw = fs.readFileSync(path, 'utf8');
  let list;
  if (path.endsWith('.json')) {
    list = JSON.parse(raw);
  } else {
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const header = lines.shift().split(',').map((h) => h.trim().toLowerCase());
    const ei = header.indexOf('email');
    const ni = header.indexOf('name');
    list = lines.map((l) => { const c = l.split(','); return { email: (c[ei] || ''), name: ni > -1 ? (c[ni] || '') : '' }; });
  }
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: String(r.name || '').trim() });
  }
  return out;
}

function loadTemplate(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  let subject = '';
  let start = 0;
  if (lines[0] && lines[0].toLowerCase().startsWith('subject:')) {
    subject = lines[0].slice(8).trim();
    start = 1;
    while (lines[start] === '') start++;
  }
  return { subject, body: lines.slice(start).join('\n') };
}

function render(text, r) {
  const first = (r.name || '').split(/\s+/)[0] || 'there';
  return text.replace(/\{\{\s*first_name\s*\}\}/g, first);
}

function loadSent() {
  try {
    return new Set(fs.readFileSync(LOG, 'utf8').split(/\r?\n/).slice(1).map((l) => l.split(',')[0]).filter(Boolean));
  } catch (e) { return new Set(); }
}
function logSend(email, status, info) {
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'email,status,info\n');
  fs.appendFileSync(LOG, [email, status, String(info || '').replace(/[\n,]/g, ' ')].join(',') + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendOne(r, subjT, bodyT) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [r.email],
      reply_to: MAIL_REPLY_TO || undefined,
      subject: render(subjT, r),
      text: render(bodyT, r),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j && j.message) || ('HTTP ' + res.status));
  return j.id || 'sent';
}

(async () => {
  const recipients = loadRecipients(FILE);
  const { subject, body } = loadTemplate(TEMPLATE);
  if (!subject) { console.error('template needs a "Subject: ..." first line'); process.exit(1); }

  const sent = loadSent();
  const fresh = recipients.filter((r) => !sent.has(r.email));
  const toSend = LIMIT ? fresh.slice(0, LIMIT) : fresh;

  console.log('recipients in file : ' + recipients.length);
  console.log('already sent (skip): ' + (recipients.length - fresh.length));
  console.log('TO SEND            : ' + toSend.length + (LIMIT ? ' (limited to ' + LIMIT + ')' : ''));
  console.log('From    : ' + (MAIL_FROM || '(set MAIL_FROM)'));
  console.log('Reply-To: ' + (MAIL_REPLY_TO || '(none)'));
  console.log('\n--- PREVIEW (first recipient) ---');
  if (toSend[0]) {
    console.log('To: ' + toSend[0].email);
    console.log('Subject: ' + render(subject, toSend[0]) + '\n');
    console.log(render(body, toSend[0]));
  } else { console.log('(nobody to send to)'); }
  console.log('---------------------------------');

  if (!SEND) { console.log('\nDRY RUN — nothing sent. Add --send to send for real.'); return; }
  if (!toSend.length) { console.log('\nNothing to send.'); return; }

  console.log('\n*** SENDING to ' + toSend.length + ' people in 4s — Ctrl-C to abort ***');
  await sleep(4000);

  let ok = 0, fail = 0;
  for (const r of toSend) {
    try {
      const id = await sendOne(r, subject, body);
      logSend(r.email, 'sent', id);
      ok++;
      if (ok % 25 === 0) console.log('  ...' + ok + ' sent');
    } catch (e) {
      logSend(r.email, 'FAILED', e.message);
      fail++;
      console.error('  FAIL ' + r.email + ': ' + e.message);
      if (/rate|429|too many/i.test(e.message)) await sleep(3000);
    }
    await sleep(DELAY);
  }
  console.log('\nDone. sent=' + ok + '  failed=' + fail + '  (log: ' + LOG + ')');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
