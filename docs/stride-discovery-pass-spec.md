# Stride VST — 24-hour "Discovery Pass" (replaces the freeze demo)

**Status:** SPEC (not built). 2026-07-08. Target build: **v1.0.3**.
**Decision (Yossi):** flip the demo to a **24-hour fully-working Stride**, then it **locks until purchase**.
Non-renewable: **one email · one device · one 24-hour pass** (so accounts can't be cycled).
Demo baseline before this: 75 demos → 6 paid (8%). The pass is the conversion lever for the other 92%.

---

## 1. The model (single binary, four states)

`entitled` stays the master switch; we add a **time-limited signed entitlement** (a pass) as a
new way to be entitled. All in ONE build (no separate "demo version").

| State | When | Behaviour |
|---|---|---|
| **Paid** | valid VST license (builtin/signed) | Full, forever. (unchanged) |
| **Pass active** | server-signed ent with `exp`, `now < exp`, device+email match | **Full, no caps** + a countdown + a 2-hours-left nudge |
| **No pass yet** | fresh install, no license | "Start your 24-hour Discovery Pass" screen (enter email → start) |
| **Pass ended / used** | `exp` passed, OR this email/device already spent its pass | **Locked** (purchase screen). Projects untouched (see §5) |

The old demo caps (10s/60s freeze, save-off, offline-noise, unlimited-but-limited) are **removed** —
during the pass it's the *real* full Stride; after the pass it's locked, not a freeze demo.

## 2. Why signed + server (least crackable of the practical options)

Reuse the existing **Ed25519 signed-entitlement** system; add an `exp` field to the signed payload.
- **Expiry is inside the signature** → can't be edited/extended without the server's private key.
- **Pass is issued + tracked server-side** (Firestore) → deleting local files / reinstalling does NOT
  reset it; re-requesting returns the same `exp` (or "used").
- **Not uncrackable** (no offline trial is — binary patch / new-email+new-machine remain). The bar is
  casual-proof + lead-capture, correct for a conversion tool.

## 3. Non-renewable gate (one email, one device)

Backend `start_pass(email, device_id)`:
1. If **this email OR this device** already has a pass:
   - still valid → return the **same** pass (same `exp`) — a reinstall mid-pass just resumes.
   - expired → **refuse** ("your pass has ended"). → non-renewable.
2. Else → create `{email, device_id, started_at, exp = started_at + 24h}` in Firestore, sign
   `{key: device_id, ents:['vst'], iat, exp}`, return the signed ent. Reuses `_sign_entitlements`.

`device_id` = `juce::SystemStats::getUniqueDeviceID()` (stable per machine, hashed — not PII).
Gate on **email OR device** so: same email+new machine = refused; new email+same machine = refused;
new email **and** new machine = the accepted residual (VM/second PC + throwaway email — ignore).

## 4. Client (C++ `License.h` + JS `entitlements.js`, ~a day)

- `computeEntitled`: a signed ent that carries `exp` → entitled only if `now < exp`. Expired → not
  entitled → locked. (~10 lines each side, additive.)
- **First launch, no license** → the Discovery Pass start screen (email box). Submit → `start_pass`
  → cache the signed ent → full for 24h. (Online required ONCE to start; then it runs offline for the
  24h off the cached ent.)
- **Timer**: remaining = `exp - now`; show a subtle countdown; fire the 2-hours-left nudge once.
- **Clock-rollback guard**: store the max real-time ever seen (server time on activation + a launch
  stamp); refuse `now < maxSeen`. Kills the "roll the clock back" exploit. (~1h.)
- **Expiry** → swap to the locked/purchase screen.

## 5. ✅ DECIDED — SOFT LOCK (2026-07-08)

After 24h the **editor locks** (can't map / draw / create — a purchase overlay), but the plugin
**keeps hosting the synth and driving the curves already in the project**, so existing projects sound
**exactly the same** ("your projects remain untouched" is literal). The **create-gate** is the forcing
function: to make anything new, you buy. Premium feel, honest with the copy.

Implementation notes:
- Locked ≠ demoMode-caps. Locked = full audio/drive continues; only the EDITOR (map/unmap/draw/
  generators/templates + the canvas edit surface) is disabled + overlaid with the purchase screen.
- The processor keeps driving `driveLanes` normally when locked (so projects play). The UI blocks edits.
- New device added / new mapping while locked → blocked (that's "creating").

## 6. Copy (Yossi's — verbatim; tone = premium, never "BUY NOW!")

- **Welcome (pass start / first full launch):**
  > Welcome to your 24-hour Discovery Pass. Explore without limits.
  > When your pass ends, your projects remain untouched — but you'll need a license to continue exploring.
- **2 hours left:**
  > You've got 2 hours left in your Discovery Pass. Found something you love? Keep exploring with the full version.
- **Ended (needs Yossi's wording; draft):**
  > Your Discovery Pass has ended. Your projects are safe. When you're ready, a license picks up right where you left off.
  > → "Get Stride VST" (checkout).

## 7. Rollout

- The 75 existing demo installs run the OLD freeze-demo build (no pass logic) → they must **update**.
  Pairs perfectly with the email: *"New update (Kontakt fix + more) — and here's your 24-hour Discovery Pass."*
- `exp` / pass length is **server-set** → can A/B 24 vs 48 vs 72h later without a rebuild.
- Sequence: finish v1.0.2 upload → build v1.0.3 (pass) → email demo downloaders + cart-abandoners.

## 8. Effort

~1 day client + backend, because the full↔lock switch, Ed25519 signing, Firestore, and the emailed-code
mailer all already exist. New: `exp` check, `start_pass` endpoint + email/device dedup, the pass UI
(start screen + countdown + 2h nudge + locked screen), the clock guard, device id.

## 9. Open items for Yossi
1. **§5 A vs B** (soft lock vs firm lock) — the one real product fork.
2. **Ended-state copy** (§6).
3. Email required to START the pass (assumed yes — it's the one-email gate + the lead). Confirm.
