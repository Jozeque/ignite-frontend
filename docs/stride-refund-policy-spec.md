# Stride Refund Policy Spec (2026-07-02)

> **STATUS — PUSHED 2026-07-02.** Demo is live (the Stride VST3 download runs in demo mode until activated), so the gate is met and the activation-forfeit policy is now APPLIED: `terms.html §4` rewritten (frontend + root synced), plus the landing (`index_v3_two_products.html`) refund + demo FAQ answers and the buy-modal consent line. Model = "free demo → all sales final once you activate → 14-day refund if not yet activated → faulty/won't-run carve-outs." REMAINING: (a) paste the real demo download URL into `DEMO_URL` (currently '' → CTA shows a placeholder alert); (b) the currently-live StrideLink page `frontend/index.html` still has the OLD "14-day full refund" FAQ + old buy checkbox → update if it stays live (confirm StrideLink has a demo path first); (c) set the LS dashboard refund text + verify LS live chargeback figures.

## Objective
Move Stride from an unconditional **14-day money-back guarantee** to the industry-standard **demo-anchored, activation-forfeit** model used by Serum, ShaperBox, Baby Audio, FabFilter, etc. Match the market *exactly* — neither more generous (current) nor stricter (a bare "all sales final") — while staying **legally enforceable** and **chargeback-defensible**.

**Trigger:** Stride is adding a free **demo** version. The demo is what makes "no refunds after activation" fair and standard ("try before you buy").

---

## The shift, in one line
- **Today** (`frontend/terms.html §4` + landing FAQ + buy modal): "14-day money-back guarantee — we'll help or refund." → *more generous than the market.*
- **Ask:** "all sales are final."
- **Verdict from research:** a *naked* "ALL SALES ARE FINAL, no exceptions" is (a) an **outlier** — stricter than Serum/ShaperBox themselves — and (b) **unenforceable** against EU/UK statutory withdrawal. The correct target is **"all sales final once you download or activate your license, because a free demo is available first,"** + the standard carve-outs.

---

## Market findings (how the standards actually word it)

| Vendor | Model | Core stance (verbatim / near-verbatim) |
|---|---|---|
| **Xfer / Serum** | demo + forfeit | "The software license… is not transferable or returnable. However demo versions are provided for evaluation." (demo has a 15–20 min/use limit) |
| **Cableguys / ShaperBox** (Paddle) | demo + waiver-on-use | 14-day withdrawal "unless… you started downloading, streaming, using or benefiting from the Product." Trial versions on product pages. |
| **Baby Audio** ← cleanest to copy | demo + activation-forfeit | "full refund within 14 days if you haven't yet activated your product. Once you activate… you waive your right to a refund. …we may also offer a refund if you have technical issues. All our plugins have free trials." |
| **FabFilter** | 30-day trial, no published refund clause | "fully functional, 30-day trial versions." Refunds via reseller (Cleverbridge), case-by-case. |
| **Native Instruments** ← strict | activation-forfeit | "Registered download products cannot be returned." 14 days only "if the software has not already been downloaded, registered or activated." |
| **Output** ← lenient | use-and-still-refund | "14 days from your purchase date… as long as you've installed, registered, and used the product." |
| **Vital** ← lenient | use-and-still-refund | "full refund if requested within 14 days of payment" even after installing/using. Subscriptions non-refundable. |
| **Paddle / Plugin Boutique** (resellers) | statutory + waiver-on-download | "all Transactions are non-refundable" except statutory withdrawal, which is lost once download/use begins. Faulty/not-as-described carve-out. |

**Norm:** *"14 days, forfeited the moment you download/activate, because a free demo is available"* + carve-outs (technical faults, duplicate/wrong-product, reseller purchases). **Nobody enforces a bare "all sales final."** Strictest = NI, Xfer. Most lenient = Output, Vital. Strict-but-fair middle (our target) = **Baby Audio, ShaperBox**.

---

## Legal + processor mechanics (must respect)

1. **EU CRD 2011/83 Art. 16(m) + UK CCR 2013 reg. 37.** Consumers of digital content get a **14-day right of withdrawal** (clock runs from purchase). It can be extinguished **only** by: immediate access + the buyer's **prior express consent** to begin + **acknowledgment they lose the withdrawal right**. A "all sales final" sentence alone does **not** do this. (2019/2161 sanction: if the waiver isn't captured correctly, the consumer doesn't have to pay.)
2. **Lemon Squeezy is Merchant of Record.** LS is the legal seller to the customer; **LS's checkout/buyer terms already carry the Art. 16(m) consent** ("by downloading… you consent to immediate performance… and acknowledge you lose your right of withdrawal"). Our policy is a **commercial overlay**, not the statutory mechanism.
3. **LS overrides.** LS lets sellers set their own policy **but reserves the right to refund within ~60 days to prevent chargebacks**; chargebacks carry a dispute fee (~$15) and meritless ones can incur penalties (~$100). → "no refunds" is never absolute; LS can refund on our behalf. **[VERIFY exact numbers on live LS docs before publishing — LS docs 403'd the automated fetch.]**
4. **The demo's role.** No effect on statutory rights, but a strong **practical + chargeback defense**: the buyer verified compatibility and fit before paying, which defeats the most common digital-goods disputes ("didn't work" / "not as described"). Stride's **license activation is logged** (license.json validation) — that activation record is dispute evidence. **Do not** claim "we have a demo, therefore no statutory refund" — that's not how the law works.

---

## Recommended Stride policy (the model)
1. **Lead with the demo.** "Try Stride free before you buy." Primary refund-avoidance + dispute defense.
2. **All sales final once you download or activate your license** (digital software, delivered instantly, cannot be returned).
3. **Preserve statutory rights explicitly** (this makes it *more* enforceable): EU/UK 14-day withdrawal applies **until** download/activation; by activating you expressly consent to immediate supply and acknowledge losing that right (mirrors LS checkout).
4. **Not activated yet?** Full refund within 14 days.
5. **Faulty / not-as-described** → repair, replacement, or refund (statutory; keep it).
6. **Technical faults we can't fix** → refund at our discretion (Baby Audio-style safety valve).
7. **Rely on LS checkout** for the load-bearing Art. 16(m) consent capture; keep our buy-modal acknowledgment aligned, not substituted.

**Why this is right for the "don't be over-strict" goal:** it's identical to Serum/ShaperBox/Baby Audio (demo + activation-forfeit), keeps the carve-outs everyone keeps, honors the user's "all sales final" (correctly scoped to post-activation), and won't clash with LS's own buyer terms.

---

## Sequencing / dependencies (IMPORTANT)
- **The demo must be LIVE and linked at/near checkout BEFORE this policy activates.** The whole fairness/defensibility rests on "you could try it free first." Until the demo ships, keep a real window (current 14-day, or "14-day if not activated") — do **not** tighten to activation-forfeit with no demo to try.
- **Stride already has license activation** (built-in/LS keys → license.json). Activation = the clean, trackable forfeiture trigger + chargeback evidence. No new engineering needed for the trigger.
- **Verify LS live figures** (60-day window, dispute/penalty fees) and confirm LS buyer terms carry the waiver for our regions; set the LS dashboard refund policy to match this text.
- Keep the buy-modal consent checkbox aligned (we already have an Art. 16(m)-style acknowledgment from the earlier waitlist work).

---

## Exact copy to ship

### A) `terms.html` — replace §4 "Refund Policy"
> Stride is available as a **free demo** — please try it before you buy. The demo is the best way to confirm Stride runs on your system and does what you need.
>
> **Once you download or activate your Stride license, all sales are final.** Stride is digital software delivered instantly and can't be returned. By downloading or activating, you expressly consent to immediate access and acknowledge that you thereby waive any right of withdrawal or cancellation for the delivered software.
>
> **Not activated yet?** If you've bought but haven't downloaded or activated your license, email us within 14 days for a full refund.
>
> **Your statutory rights are unaffected.** If Stride is faulty or not as described, you're entitled to a repair, replacement, or refund. Customers in the EU/UK keep the statutory 14-day right of withdrawal until download or activation begins.
>
> **If it won't run,** reach out — if we can't get it working together, we'll refund you.
>
> **How to request:** email home@stridehub.io with your order number (from Lemon Squeezy) within 14 days; we reply within 48 hours. Payments and refunds are processed by Lemon Squeezy, our merchant of record.

### B) Buy modal — consent checkbox (align, don't weaken)
> I've read the [system requirements](#), [refund policy](#) and [Terms of Service](#). I understand Stride is delivered instantly, and that **once I download or activate my license the sale is final** — I consent to immediate access and waive my 14-day right of withdrawal for the delivered software.

(Keep the "Secure checkout via Lemon Squeezy" line. The legally load-bearing consent is captured again on LS's checkout.)

### C) Landing FAQ — "Can I get a refund?"
> Try the free demo first — it's the best way to know Stride fits your setup. Once you download or activate your license, all sales are final, the same as most plugins you already own. Haven't activated yet? Email us within 14 days for a full refund. And if Stride won't run and we can't fix it together, we'll refund you.

### D) Lemon Squeezy dashboard
Set the store/product refund policy text to a short version of (A). Note LS may still refund within ~60 days to prevent chargebacks regardless of this text.

---

## Handling refund requests — objections & buyer's remorse

**Principle: the demo is the filter; separate a genuine FAULT from buyer's REMORSE.**
- **Fault** (won't install/authorize, crashes, a real performance bug we can't fix, not-as-described) → help first; **refund if we can't fix it.** Always, regardless of policy.
- **Remorse** ("too much CPU," "doesn't fit my workflow," "changed my mind," "can't afford it") → once the **demo is live**, decline: the free demo let them check CPU, fit and sound before paying, and activation forfeits the refund. This is the Serum/ShaperBox line.

**Pre-demo launch caveat:** while on the unconditional 14-day guarantee (launch, no demo yet), a remorse request *inside* 14 days is covered by what we promised — lead with "let's fix it," but if they insist, grant it. We only gain the clean "no" once the demo ships.

| They say | Usually | Once demo is live | During launch (14-day) |
|---|---|---|---|
| "Too much CPU" | remorse; sometimes a real perf bug | Decline (demo shows CPU on their rig) unless a genuine bug we can't fix → refund. Offer freeze / lower oversampling / bigger buffer first. | Try to fix first; honor within 14 days if unresolved. |
| "I'm in debt / can't afford" | pure remorse | Decline, kindly; point to the free demo (runs indefinitely). | Within 14 days it's covered — grant it. |
| "Doesn't fit my workflow" | didn't try first | Decline — the demo exists for exactly this. Ask "what were you trying to do?" first. | Honor within 14 days. |
| Serial refunder / "bought to buy" | refund abuse | Decline + flag; LS can ban / charge liquidated damages for meritless chargebacks. | Grant once, flag, watch for a pattern. |

**Chargeback reality (don't over-fight):** a stated "no refund" does not stop a chargeback, and LS may refund within ~60 days anyway — costing the sale **plus** a dispute fee. For a $59–99 product, fighting a determined remorse refund usually costs more than granting it. Decline politely on principle, but if someone will clearly just dispute, refund + log + move on. Reserve the hard "no" (and LS abuse tooling) for repeat refunders.

**Tone (on-brand: human, no hype, help-first):** open by trying to solve it (most "CPU"/"workflow" complaints are one setting), then either fix it (best outcome — keep the sale and a happy user) or refund cleanly if it's a fault or inside the window. Never argue, never stonewall.

**Templates:**
- *CPU:* "Fair to worry about CPU. Let's get it light first — try freezing the track, lowering oversampling, or a bigger buffer. If it still won't sit right and it's a genuine bug, I'll sort you out."
- *Can't afford:* "No hard feelings. [inside 14 days: done, refunded.] [post-demo: since the license is activated I can't refund it, but the free demo runs indefinitely — grab Stride when the timing's better.]"
- *Workflow:* "Sorry it's not clicking — what were you trying to do? Often it's one step. [genuinely not for you: inside window → refunded; post-demo → the demo's there for exactly this check, so activated sales are final, but happy to help you get more from it.]"

### Sub-case: "It's buggy / it crashes — just refund, I won't troubleshoot and I have no proof"
You can't distinguish a real-but-impatient user from remorse-in-disguise with zero info, so don't try to win it on evidence:
1. **Lower the ask, drop the "meeting."** A screen-share to return a cheap plugin is an unreasonable bar and reads as stonewalling. Ask for ONE message, framed as "help me fix it," not "prove it": *"No call needed — just reply with one line on what happened + a screenshot if handy, so I can fix it. Or, if you're within 14 days, I'll refund you now."* Converts genuine reporters, filters the rest.
2. **Still refuses → decide by window + economics.** Inside 14 days (all launch buyers): just refund — the window is the no-questions period, don't demand proof. Activated + past window + zero info + won't engage: you MAY decline, but a "defective" chargeback will likely succeed against you (you have no evidence either; "worked for others" is weak), so refusing usually just adds a dispute fee — refund is often cheaper.
3. **Never fight over $59–99.** Refund + log the buyer; reserve the hard "no" and LS abuse tooling for the PATTERN (serial refunder / wave of identical no-detail "it crashes" claims), not the first claim.
4. **Real fix = product, not policy.** Make proof automatic: add a one-click **"Send diagnostics / crash report"** (Stride already logs internally — `[SD-DIAG]`, license-activation logs, error surfacing). Then "it crashes" is checkable against real data → genuine crash = real fix + saved sale; fabricated = nothing behind it. This + the demo dissolves the category.
5. **Activated + won't collaborate + pure regret (the hard core):** once the demo policy is live you ARE entitled to decline (activation forfeits it) — but a "no" doesn't stop a chargeback. Ladder: (a) **decline ONCE**, cleanly + logged, restating the agreed terms (demo + activation waiver) and offering to fix a genuine fault; (b) if they escalate toward a chargeback, **refund proactively + blacklist** (email/card) — a refund is cheaper than a lost dispute + ~$15 fee + dispute-ratio damage; (c) repeat offender → **LS ban / abuse tooling**. Separate *"do I owe it"* (no) from *"should I fight it"* (for $59–99, usually no). Note: at LAUNCH (unconditional 14-day, no demo) you cannot cleanly decline these yet — the teeth arrive with the demo.

**Manage the RATE, not the case.** Track refund + chargeback rate; under ~1–2% is normal leakage every plugin eats (Serum included) — budget for it, don't fight each small-ticket case. Only a spike is worth investigating (real bug, or an abuse wave). Levers that shrink the population: demo (filters regret before payment), a clear checkout line ("activated = final, demo available first"), one-click crash report (kills "no proof"), blacklist + LS abuse tools (stops serial farming).

**Bottom line:** the demo does the heavy lifting — it turns "I changed my mind" into "you tried it free first," a fair and defensible no. Until it ships, expect to grant some remorse refunds within 14 days; that's the tradeoff. For unverifiable "it's buggy" claims, ask once (no meeting), refund cheaply on first contact, and police the pattern — not the person.

## Implementation checklist
- [ ] Demo build live + download link in place (GATES everything below)
- [ ] `frontend/terms.html §4` → new copy (A); sync to root `terms.html`
- [ ] Landing FAQ updated (`frontend/index.html` + the working `index_v3_two_products.html`)
- [ ] Buy-modal consent line updated (B)
- [ ] LS dashboard refund policy text set (D)
- [ ] Verify LS live refund/chargeback figures
- [ ] Update the mobile/other refund mentions site-wide (grep "14-day money-back", "money-back")
