# Stride — Three Segment Emails (final copy)

Three dedicated emails, one per audience. Final copy below.

**Segments map to CRM status** (`build_crm_audience.py --statuses ...`):

| Email | Audience | CRM status | Angle |
|-------|----------|-----------|-------|
| 1 | Existing customers | `purchased, active` | The Unmap button |
| 2 | Abandoned carts | `abandoned_cart` | Full Stride free for 24h (Discovery Pass) |
| 3 | Demo downloaders (not yet buyers) | `demo` | Your demo is now a 24-hour Discovery Pass |

> ⚠️ **When sending:** give each campaign its **own** `--log sent-<name>.csv` (the mailer's default log is shared and will skip people across campaigns), and mind the **Resend daily quota** (space the three out, or send across days).

---

## Email 1 — Existing Customers  (`purchased, active`)

**Subject:** New in Stride: Unmap

Hi{name_part},

Quick update.

You can now unmap any parameter from Stride with a single click.

No rescanning. No rebuilding your mapping.

If there's a parameter you want to keep out of the process, simply unmap it and keep going.

You decide exactly what Stride touches, and what it leaves alone.

It joins a few recent additions:

SEL for modulating only the parameters you choose
Print modulation directly into your DAW
Drag to reorder your plugin chain
Load Kontakt inside Stride

Open Stride and give it a try.

As always, if something gets in your way, just reply to this email.

Joe

---

## Email 2 — Abandoned Cart  (`abandoned_cart`)

**Subject:** Try the full Stride. Free for 24 hours.

Hi{name_part},

You made it all the way to checkout, but never completed your purchase.

That's okay.

Stride is something you need to experience.

We're giving you the full version for 24 hours.

No restrictions.

Every feature unlocked.

Load your favorite synths and effects.

Map as many parameters as you want.

Explore Stride's motion styles and uncover endless variations from the gear you already own.

Press play.

The best sounds are rarely planned.

They're discovered.

Spend an evening exploring what your instruments are truly capable of.

If Stride earns a place in your workflow, we'd love to have you.

Start your 24-hour Discovery Pass

[24H PASS LINK]

Joe

---

## Email 3 — Demo Users  (`demo`)

**Subject:** Your Stride demo just got better

Hi{name_part},

Thanks for trying Stride.

The original demo gave you a glimpse of what Stride could do.

Now you can experience the whole thing.

Your demo is now a full 24-hour Discovery Pass.

No restrictions.

No interruptions.

Every feature unlocked.

Load your favorite synths and effects.

Map as many parameters as you want.

Explore Stride's motion styles and uncover endless variations from the gear you already own.

Press play.

The best sounds are rarely planned.

They're discovered.

Spend an evening exploring what your instruments are truly capable of.

Start your 24-hour Discovery Pass

[24H PASS LINK]

Joe

---

## To send, I need two things

1. **The `[24H PASS LINK]`** for emails 2 and 3 — where should "Start your 24-hour Discovery Pass" point?
2. **Format** — send plain text, or drop each into the branded HTML shell (like the new welcome email, with the Discovery‑Pass button in copper)?

Then: build the three audiences (`build_crm_audience.py`, one per status), self-test each, and send with a dedicated `--log` per campaign, spaced for the Resend quota.
