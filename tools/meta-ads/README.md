# Meta Ads tooling

Local scripts to audit and (later) optimize the Stride Meta ad account via the
Marketing API. **`audit.js` is read-only** — only GET requests, it cannot change
or spend anything.

## What you need

1. **Ad Account ID** — Ads Manager → top-left account dropdown. Format
   `act_1234567890` (the number under the account name).

2. **Access token with `ads_read`** (add `ads_management` later for fixes).
   Your CAPI token will *not* work — it's scoped to the dataset, not ads.

   **Quick (good for an audit, expires in ~1–2 h):**
   - developers.facebook.com/tools/explorer
   - Pick your app → **Generate Access Token**
   - Add permissions: `ads_read`, `ads_management`, `business_management`
   - Copy the token

   **Persistent (system user, long-lived):**
   - Business Settings → Users → **System Users** → add one
   - Assign the ad account with full control
   - **Generate token** → select `ads_read` + `ads_management`

## Run the audit

```powershell
$env:META_ACCESS_TOKEN="EAAB..."
$env:META_AD_ACCOUNT_ID="act_1234567890"
node tools/meta-ads/audit.js
```

Optional: `META_DATE_PRESET` (last_7d / last_30d / last_90d / maximum),
`META_API_VERSION` (bump if rejected), `META_TIME_RANGE` (custom JSON range).

Output: console summary + full `report.json` (gitignored).
