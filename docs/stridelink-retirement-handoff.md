# Retiring StrideLink: one workflow, Stride VST + StrideBridge

**Status: handoff, nothing done yet.** Written 2026-08-31 on Yossi's call: the product is now
Stride VST plus StrideBridge, and StrideLink comes off the landing page and out of Lemon Squeezy.

This is the survey plus the plan. Read the two hard rules first, they are the ones that can
break paying customers.

---

## 1. The two rules that must not be broken

### Rule 1: NEVER remove the `stridelink` entitlement from the backend

`firebase_cloud/functions/main.py:975-976` maps every Lemon Squeezy product to entitlements:

```python
{"ents": ["stridelink", "vst"], "ids": ["973706"],  "names": [...]},
{"ents": ["stridelink", "vst"], "ids": ["1188468"], "names": ["stride vst", "stride vst3"]},
```

Both shipping products already grant **both** entitlements, and there is a giveaway cutoff
(`ENT_GIVEAWAY_CUTOFF_MS`, `main.py:1021`) that upgrades older StrideLink-only buyers to `vst`.

Retiring the product in Lemon Squeezy must not touch any of this. Existing customers validate
against these ids forever, including people who bought StrideLink alone in 2026. Deleting the
mapping, or the entitlement string, invalidates their key.

**What to do instead:** stop *selling* it, keep *honouring* it. The map is append-only.

### Rule 2: StrideLink the DEVICE keeps shipping and keeps working

Retiring it from the shop is a marketing change, not a product deletion. `stride-vst/` (the
Electron desktop app) and `stride-vst/m4l/` (the StrideLink Max device) are what existing
customers already have installed, and they will keep opening projects that contain it.

Nothing in `stride-vst/m4l/`, `stride-vst/app/`, the build scripts or the CI zips should be
deleted as part of this. Out of the shop and off the site, still in the repo, still maintained.

---

## 2. What actually changed in the product

The reason this retirement is now possible: **StrideBridge closed the last gap.**

| Job | Old answer | Now |
|---|---|---|
| Modulate a hosted synth chain in any DAW | Stride VST | Stride VST |
| Modulate Ableton's OWN devices (Operator, Roar, filters) | StrideLink | **StrideBridge** |
| Print modulation into a clip as automation | StrideLink's Inject to Clip | **StrideBridge's INJECT button** (2026-08-31) |
| Print a HOSTED synth's modulation into a clip | not possible | **INJECT, via the DAW-facing macro** (2026-08-31) |
| Hand the knob to the DAW after printing | manual | automatic, per lane, with TAKE BACK to reverse |

So the Ableton user no longer needs a second app. They install one plugin, drop one Max device
on the track, and get both live modulation of Live's devices and printed clip automation.

**Careful with the claim.** Stride VST hosts plugins inside itself; StrideLink drove an Ableton
instrument RACK from outside. Those are not identical workflows. Anyone whose whole method is
"my own Ableton rack, modulated in place" is a StrideLink user, and the honest line is that
StrideBridge covers the modulation and the clip automation, not that the rack workflow is
identical. Do not write copy that claims a straight one-for-one replacement.

---

## 3. Surfaces to change

### 3.1 `/setup` page: `frontend/setup.html` (310 lines)

The whole page is written for StrideLink. Five direct mentions: lines 132, 145, 201, 202, 238.

Current shape:

```
One-time setup
  1. First launch pop-up -> "Install to Ableton" -> installs StrideLink + StrideInject
The Workflow
  1. Load StrideLink on your track
  2. Map your parameters (Record button, blue = Arrangement, red = Session)
  3. ... draw ...
  4. Inject to Clip
```

Proposed shape (Stride VST + StrideBridge):

```
One-time setup
  1. Install Stride.vst3 into your VST3 folder
  2. Copy the StrideBridge folder into your Ableton User Library
  3. Enable StrideInject: Preferences > Link, Tempo & MIDI > Control Surface > StrideInject
     then restart Live
The Workflow
  1. Drop Stride on a track. Load your instruments and effects INSIDE it.
  2. Drag StrideBridge onto any track (one per set) to also reach Ableton's own devices
  3. Map: touch a knob in Stride, or press MAP LIVE and click a knob in Live
  4. Draw the motion
  5. Press INJECT on the StrideBridge device to print it into the selected clip
```

Assets that will be wrong and need re-shooting or cutting:
- `assets/ss/record-buttons.png` (line 208) shows StrideLink's Record buttons
- the first-launch "Install to Ableton" modal recreation (lines 137-160) is the desktop app's
- the Inject to Clip button recreation (line 238) is StrideLink's, not the device face

**Sync rule (CLAUDE.md):** `frontend/` is the source of truth. After editing, copy to root:
`cp frontend/setup.html ./setup.html`. Both files exist today and must stay identical.

### 3.2 Landing page: `frontend/index.html`, 17 mentions

Root copy `index.html` has the same 17. Same sync rule.

Prior art worth reading before rewriting: `docs/` holds several landing variants including
`frontend/index_v3_two_products.html`, which is the two-product framing being retired. There is
also a memory note on the site's StrideBridge repositioning from 2026-08-27 (commit `0e9ee85`),
which already removed "VST3 only. By design." and reframed explore vs commit. This retirement is
the next step of that same move, so re-read what that commit changed before undoing any of it.

**Open question flagged there and still open:** the spelling, StrideBridge vs "Stride Bridge".
Pick one and make the whole site consistent while you are in there.

### 3.3 Lemon Squeezy

- Stop selling the StrideLink-only product. Archive or unpublish the variant, do NOT delete it.
- Keep the download files in place: existing customers re-download from their receipt.
- `973706` is now the bundle and `1188468` is the VST. Both already grant both entitlements, so
  no licensing change is needed at all.
- **Check first:** the demo variant `1861887` was still on 1.4.1 as of 2026-08-27, which is why
  demo users are sent to `stridehub.io/try/` rather than their LS link. Confirm that is still the
  case before touching anything in LS, and do not accidentally fix or break that route here.

### 3.4 Email and campaign copy

`firebase_cloud/functions/main.py` lines 133, 143, 218, 233 are welcome-email copy that pitches
StrideLink as a second edition ("You picked up both editions..."). Those go out to new buyers, so
they need rewriting to the single workflow, or the two-product paragraph removed entirely.

Also check, but likely leave alone as historical records:
`firebase_cloud/scripts/send_update_email.py`, `build_vst_audience.py`, `hot59_report.py`,
`update_2.2.0-preview.html`.

### 3.5 In-app copy

`stride-wrapper/m0-spike/ui/index.html` has the wrapper's own guide and welcome screens. Grep for
StrideLink there before shipping the next VST build, so the site and the app agree.

`stride-vst/m4l-bridge/README-StrideBridge.txt` is the device's own readme and already documents
the new INJECT TO CLIP flow. Reuse its wording on the site for consistency.

---

## 4. Suggested order

1. **Decide the positioning line** for someone who owns StrideLink today. They lose nothing, so
   say so plainly. This sentence drives all the copy below it.
2. **Rewrite `/setup`** first. It is self-contained, it is the page the retirement is really
   about, and it forces the new workflow to be written down clearly.
3. **Then the landing page**, reusing the setup wording.
4. **Then LS**, once the site no longer links to the retired product.
5. **Then the welcome emails.**
6. Leave the backend map, the entitlements and `stride-vst/` alone throughout.

## 5. Checks before shipping

- `frontend/setup.html` and `./setup.html` identical; same for `index.html`
- No em dashes anywhere in the new copy (house rule)
- No AI or LLM language anywhere (house rule)
- Producer language: racks, clips, automation, lanes. Not "solution" or "workflow optimisation"
- An existing StrideLink customer opening an old project still gets a working device and a valid
  key. Test with a real key against the deployed backend, not just by reading the map
- The demo funnel `/try/` still points where it should
