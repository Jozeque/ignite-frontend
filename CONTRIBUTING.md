# Contributing to stridehub.io

Short version: branch, open a PR, wait for the preview URL, get Yossi's approval.
Nothing reaches the live site any other way.

---

## The workflow

```bash
git checkout main
git pull
git checkout -b cro/hero-headline-test     # or fix/... , copy/... , offer/...
# edit, commit
git push -u origin cro/hero-headline-test
```

Then open a Pull Request against `main`. A preview URL is posted on the PR. Review
it there, on desktop **and** on a phone, before asking for approval.

**Never push to `main`.** It is protected: pushes are rejected, PRs need one
approving review, and approval is dismissed when you push again. `main` deploys
straight to stridehub.io within about a minute of a merge, so `main` and
"production" are the same thing.

---

## The one thing that trips everybody up

**Every page exists twice.** `frontend/` is the source of truth, the copy at the
repo root is what GitHub Pages actually serves.

Edit `frontend/`, then copy to root, in the same commit:

```bash
cp frontend/index.html   ./index.html
cp frontend/samples.html ./samples.html
```

Edit only `frontend/` and **nothing happens on the live site** and nothing warns
you. Edit only the root and your change is silently reverted the next time
someone syncs properly. The preview URL serves the root copy, so if the preview
does not show your change, this is why.

Pages that exist in both places: `index.html`, `samples.html`, `app.html`,
`admin.html`, `growth.html`, `privacy.html`, `terms.html`, `setup.html`,
`blog.html`, `chains.html`.

---

## Needs Yossi's explicit approval before you change it

These are listed in `.github/CODEOWNERS`, so a PR touching them cannot merge
without his review. Do not treat that as a formality, ask first.

**Checkout, pricing and tracking — inside `index.html` and `samples.html`:**

- `STRIDE_CHECKOUT_URL`, `STRIDE_COLLECTION_CHECKOUT_URL` — a wrong URL sends
  buyers to the wrong product or a dead checkout
- `STRIDE_PRICE`, `COLLECTION_ADDON_PRICE` — these drive every price printed on
  the page. If they disagree with what Lemon Squeezy charges, the page is lying
- `submitBuyForm()` — builds the checkout URL and carries `event_id`, `fbc`,
  `fbclid`, `fbp`, `ua`, `ad_id`, `gclid`, `wbraid`, `gbraid`. Break this and
  attribution silently dies: no error, no visible symptom, just wrong numbers
- the Meta Pixel block and the `InitiateCheckout` value

Changing a displayed price is not a copy change. The number on the page and the
number the checkout charges have to match.

**Product source, not marketing:** `firebase_cloud/`, `stride-vst/`,
`stride-wrapper/`, `tendril/`.

**Never touch:** `.github/workflows/` and the `release` environment. Those build
and sign the Mac app with Apple credentials. `CNAME` too, it is what points
stridehub.io at this repo.

---

## Copy rules

Stride is a **Sound Design Engine for Ableton Live**. It is sold to producers.

- **Never mention AI, machine learning, or the models behind anything.** Not in
  copy, not in UI text, not in alt text. Ever.
- Producer language: racks, patches, automation, Live, clips, bars, grooves.
- **No em dashes.** Comma, period, or colon. Grep before you push.
- Short and concrete. No "unlock", "endless possibilities", "take it further",
  "built to inspire", "complete your setup".
- Confidence without hype. Never compare Stride to a DAW.

Claims have to be true. If you write a number, it has to match what actually
ships. Ask rather than round up.

---

## Before you request review

- Preview URL opened on desktop and mobile, both checked
- `frontend/` and the root copy are identical for every page you touched
- No horizontal scrolling at 390px
- Any price you touched matches the live Lemon Squeezy checkout
- No AI mentions, no em dashes
- The PR description says what you changed and what you want looked at

If something looks broken on the live site and you did not cause it, say so
rather than pushing a fix. Reverting is one command and production is public.

<!-- protection test, deleted after verification -->
