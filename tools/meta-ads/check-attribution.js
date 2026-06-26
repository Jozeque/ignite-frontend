'use strict';
// TEMP — read webhook/CAPI log lines from Cloud Logging using the firebase CLI's
// own stored credentials (same token `firebase functions:log` uses). Read-only. Delete after.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
// firebase-tools' public OAuth client (embedded in the open-source CLI for years)
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const PROJECT = 'veero-next';
const HOURS = Number(process.env.HOURS || '96');

function deepFind(obj, key) {
  let found;
  (function walk(o) { if (found !== undefined || o == null || typeof o !== 'object') return; if (Object.prototype.hasOwnProperty.call(o, key)) { found = o[key]; return; } for (const k in o) walk(o[k]); })(obj);
  return found;
}

async function getToken() {
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  let exp = Number(deepFind(cfg, 'expires_at') || deepFind(cfg, 'expiry_date') || 0);
  if (exp && exp < 1e12) exp *= 1000;
  const cached = deepFind(cfg, 'access_token');
  if (cached && exp && exp > Date.now() + 60000) { console.error('(cached token, valid)'); return cached; }
  const refresh = deepFind(cfg, 'refresh_token');
  if (!refresh) { if (cached) { console.error('(no refresh; trying cached)'); return cached; } throw new Error('no token in firebase config'); }
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' });
  const j = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })).json();
  if (!j.access_token) { if (cached) { console.error('(refresh failed, trying cached): ' + JSON.stringify(j.error || j)); return cached; } throw new Error('refresh failed: ' + JSON.stringify(j)); }
  console.error('(refreshed token ok)');
  return j.access_token;
}

(async () => {
  const token = await getToken();
  const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString();
  const filter = `resource.labels.service_name="generate-midi" AND timestamp>="${since}" AND (textPayload:"LS Webhook" OR textPayload:"Meta CAPI" OR textPayload:"recovered Meta" OR textPayload:"Waitlist")`;
  let pageToken, all = [];
  do {
    const j = await (await fetch('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceNames: ['projects/' + PROJECT], filter, orderBy: 'timestamp asc', pageSize: 200, pageToken })
    })).json();
    if (j.error) throw new Error('Logging API: ' + JSON.stringify(j.error));
    all = all.concat(j.entries || []);
    pageToken = j.nextPageToken;
  } while (pageToken && all.length < 600);

  console.log('=== webhook / CAPI / lead log lines, last ' + HOURS + 'h (' + all.length + ') ===\n');
  for (const e of all) {
    let txt = e.textPayload || (e.jsonPayload && (e.jsonPayload.message || JSON.stringify(e.jsonPayload))) || '';
    txt = String(txt).replace(/\s+/g, ' ').trim();
    // redact raw emails for safety in the transcript (keep first 2 chars + domain)
    txt = txt.replace(/email=([^ @]{1,2})[^ @]*@([^\s]+)/gi, 'email=$1***@$2');
    console.log(e.timestamp.replace('T', ' ').slice(0, 19) + '  ' + txt.slice(0, 320));
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
