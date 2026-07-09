#!/bin/bash
# Stride campaign daily runner.
#
# Mails each pending lead segment its offer via Resend, then exits. IDEMPOTENT:
# skips anyone already SUCCESSFULLY sent (sent-<segment>.csv) and retries
# everyone else, including last run's quota-rejected failures. Resend's 100/day
# quota naturally caps each run, so whoever doesn't get through rolls to the
# next day's run. Once a segment's log shows everyone sent, that segment mails 0.
#
# Run daily (Windows Task Scheduler via run_campaign.bat) or by hand:
#   bash run_campaign.sh
set +e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

KEY="C:/Users/Yossi/Downloads/veero-next-firebase-adminsdk-fbsvc-2ed18717ed.json"

# RESEND_API_KEY: prefer a local .env (robust for scheduled runs), else fetch
# the firebase secret (needs the firebase CLI to be logged in + on PATH).
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "$RESEND_API_KEY" ]; then
  export RESEND_API_KEY="$( ( cd .. && firebase functions:secrets:access RESEND_API_KEY ) 2>/dev/null | tail -1 )"
fi
if [ -z "$RESEND_API_KEY" ]; then
  echo "ERROR: RESEND_API_KEY not available (no .env, firebase fetch failed). Aborting."
  exit 1
fi

send () {  # $1 = segment   $2 = template
  echo "--- segment: $1 ($2) ---"
  if [ "$DRY" = "1" ]; then            # DRY=1 bash run_campaign.sh  -> counts only, no sends
    PYTHONIOENCODING=utf-8 python send_campaign.py \
      --segment "$1" --template "$2" --key "$KEY" --dry-run 2>&1 | grep -E "^TO SEND|Would send"
  else
    echo SEND | PYTHONIOENCODING=utf-8 python send_campaign.py \
      --segment "$1" --template "$2" --key "$KEY" --send 2>&1 | tail -2
  fi
}

echo "================ campaign run $(date '+%Y-%m-%d %H:%M:%S') ================"
send abandoned   templates/cart_recovery.txt
send waitlist    templates/waitlist_offer.txt
send sample_pack templates/sample_pack_offer.txt
echo "================ run complete ================"
echo ""
