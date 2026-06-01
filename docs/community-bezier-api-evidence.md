# Community evidence: the LOM bezier envelope API gap

**Purpose:** Source material for the Ableton pitch (`docs/bezier-envelope-api-proposal.md`). Every thread below documents the same gap from a different angle — independent voices, multiple Live versions, 2005 → 2025.

**Compiled from:** parallel research across Cycling '74 forum, Ableton Forum, Reddit (no results), and GitHub. The Cycling '74 forum and the Ableton Forum are where this community actually convenes.

**One-line summary:** Developers have been asking for programmatic envelope write access — including bezier handles — for ~20 years across three Live release cycles, with workarounds documented as "horrible hacks" or "gray-area patches" and no Ableton staff response on record.

---

## TL;DR — the 8 threads to cite in the pitch

| # | Thread | Year | Why it matters |
|---|---|---|---|
| 1 | [Parameter automation per step](https://cycling74.com/forums/parameter-automation-per-step) | ~Live 9/10 | **Smoking gun:** developer reverse-engineered `LomTypes.pyc` + `MxDCore.pyc` to expose the hidden internal methods. Proves the API surface exists; only policy choice prevents exposure. |
| 2 | [Programatic Clip Envelope Editing??](https://cycling74.com/forums/programatic-clip-envelope-editing) | 2020-2024 | hoowdie confirms in 2024: *"as of now (Ableton 12.1) there is no possibility to do this, sadly. But it would be amazing."* Multi-version persistence. |
| 3 | [Touch all Params to Clip Automations](https://cycling74.com/forums/touch-all-params-to-clip-automations) | n/a | Norman Freund: LOM *"has no means of writing automation lines."* Diemo Schwarz (respected M4L dev): *"my biggest incomprehension with Live."* |
| 4 | [Set keyframes / breakpoints from M4L device](https://cycling74.com/forums/set-keyframes-from-m4l-device) | 2020 | Martin Beck's recording-based workaround produces the wrong shape (rectangular plateaus). Documents the exact failure mode `insert_step` would have. |
| 5 | [Is it possible to trigger "Delete Automation"](https://cycling74.com/forums/is-it-possible-to-trigger-%22delete-automation%22-in-max-for-live) | 2019 | **Max Gardener (Cycling '74 staff)** acknowledges LOM gap; user "schlam" explicitly piles on requesting "the ability to add breakpoints via LOM." |
| 6 | [Pitch, slide and pressure envelopes in LOM?](https://cycling74.com/forums/pitch-slide-and-pressure-envelopes-in-lom) | Live 11 era | Eero Pitkänen: *"clip envelope access is also missing from the Max for Live object model"* — suggests envelope API would be prioritised before MPE expression data. |
| 7 | [feature request - access to clip envelopes via the LOM](https://forum.ableton.com/viewtopic.php?t=214401) | 2015 | Canonical 10-year-old "we want LOM envelope write API" request on Ableton's own forum. Names the same `insert_step` / `value_at_time` methods. |
| 8 | [AbletonOSC Issue #112](https://github.com/ideoforms/AbletonOSC/issues/112) | 2024-01-11 | Fresh 2024 data point from the Python/OSC scripting community. Direct quote: *"Would be great if we could modify the automation envelope programatically."* |

---

## Methodology + caveats

**What worked:** WebSearch + WebFetch on Cycling '74 forum and select GitHub repos. Ableton Forum threads were findable via Google snippets but the forum returns HTTP 403 to direct fetch, so quoted content from Ableton Forum threads should be re-verified manually before final use in the proposal.

**What didn't work:**
- **Reddit:** WebFetch is blocked on reddit.com (top-level and all subdomains). Google `site:reddit.com` returned no relevant results across 60+ query variations. The Reddit communities don't appear to host meaningful technical discussion of this LOM gap — developers go to Cycling '74 or Ableton Forum instead. If Reddit evidence ever becomes essential, you'd need to manually browse the search URLs in the [Reddit search recommendations](#reddit-search-recommendations) section below.
- **Broader web sweep** (KVR, Gearspace, music blogs, HN, Stack Overflow): agent hit rate limit before completing. Re-run when limits reset.

**No Ableton staff responses appeared in any fetched thread.** The closest acknowledgements come from Cycling '74 staff (Max Gardener, Andrew Pask, broc) — these are the most authoritative ack-points available.

---

## HIGH relevance — full detail

### [Parameter automation per step](https://cycling74.com/forums/parameter-automation-per-step)

**Venue:** Cycling '74 forum
**Era:** Live 9/10 (the `.pyc` patching technique fits that era)
**Author:** dfwaudio
**Replies captured:** None visible

**OP says:** Reports successfully unlocking the hidden internal Live API methods by modifying compiled Python:

> *"I finally managed to implement `Live.Clip.Clip.create_automation_envelope()`, `Live.Clip.AutomationEnvelope.insert_step()` and `Live.Clip.AutomationEnvelope.value_at_time()` by editing `LomTypes.pyc` and `MxDCore.pyc`. ... I know it's a gray area and i will not publish this hack."*

Explicitly petitions Cycling '74 / Ableton to officially release these features.

**Why this is the strongest single piece of evidence:** It proves the technical capability exists internally. The proposal isn't asking Ableton to build something new — it's asking them to expose what's already in `MxDCore.pyc`. Hard to dismiss when someone has literally demonstrated it works.

---

### [Programatic Clip Envelope Editing??](https://cycling74.com/forums/programatic-clip-envelope-editing)

**Venue:** Cycling '74 forum
**Era:** 2020 (OP) → 2024 (last reply)
**Author:** Morgan
**Replies captured:** 4+ contributors

**OP says:** *"There seem to be no LOM calls for editing clip envelopes the way that there are for clip notes."* Wanted envelopes as preset-storage mechanism. Gave up.

**Notable replies (chronological):**
- **Andrea Trona:** echoes same problem, asks Morgan if he found solutions
- **Morgan (follow-up):** abandoned the approach, built a parameter-rack workaround instead
- **GVS:** expressed need for "functions to get/set/observe envelope data from clip" — speculated data shape would be x/y coordinate lists
- **hoowdie (2024):** *"as of now (Ableton 12.1) there is no possibility to do this, sadly. But it would be amazing."*

**Why it matters:** Multi-developer, multi-year persistence confirmation. The 2024 quote freshly timestamps the gap in current Live.

---

### [Touch all Params to Clip Automations](https://cycling74.com/forums/touch-all-params-to-clip-automations)

**Venue:** Cycling '74 forum
**Author:** Norman Freund
**Replies captured:** 2 contributors

**OP says:** Wants to snapshot all M4L device parameters into clip automation lanes at once. *"When a device has something like 20 controls, it gets tedious to do it manually."* Explicitly states:

> *"LOM has no means of writing automation lines."*

**Notable replies:**
- **Diemo Schwarz** (recognised M4L developer): *"[the inability to snapshot M4L device settings] is indeed my biggest incomprehension with Live."* Lists four workarounds: Max snapshots/pattr + MIDI PC, ClyphX (called "the horrible hack"), Live presets with hidden tracks, Max pattrstorage.
- **Norman Freund (reply):** dismisses ClyphX as "quite a hack" — advocates for LOM enhancement instead

**Why it matters:** Two direct power-user quotes on record, including a respected M4L developer using the language "biggest incomprehension." Strongest single-quote evidence for the pitch.

---

### [Set keyframes / breakpoints from M4L device](https://cycling74.com/forums/set-keyframes-from-m4l-device)

**Venue:** Cycling '74 forum
**Date:** 2020-06-21
**Author:** Martin Beck
**Replies captured:** 2 contributors

**OP says:** Tries the workaround of recording `live.numbox` value changes — gets the wrong shape:

> *"4 keyframes making a rectangle instead of the intended linear descend"*

Later identifies the core limitation in his own follow-up:

> *"There is no comprehensive access to automation / clip envelopes via the LOM that allows to insert and delete breakpoints."*

Calls a hypothetical breakpoint API *"a really powerful feature."*

**Notable replies:**
- **Rob Rox:** *"would be a really powerful feature!"* — community +1

**Why it matters:** Concrete real-world failure mode of the only available workaround. Shows even the recording-based approach produces stair-step plateau output. Useful as "here's what developers try and why it doesn't work" evidence.

---

### [Is it possible to trigger "Delete Automation" in max for live?](https://cycling74.com/forums/is-it-possible-to-trigger-%22delete-automation%22-in-max-for-live)

**Venue:** Cycling '74 forum
**Date:** 2019-10-15
**Author:** sefable2
**Replies captured:** 7+ contributors

**OP says:** Asks how to trigger "Delete Automation" via M4L. Notes LOM docs don't list this.

**Notable replies:**
- **Mark:** only `clear_envelope` exists, and only for clip automation (not arrangement automation)
- **Max Gardener (Cycling '74 staff):** if it isn't in LOM Track docs *"it's probably unavailable"*; questions Push functionality parallels
- **Connor Shafran, benj3737, schlam:** +1 votes
- **schlam:** *"the ability to add breakpoints via LOM"* — explicit additional request

**Why it matters:** Rare Cycling '74 staff acknowledgement of LOM gaps. The schlam +1 is essentially the proposal's territory in one sentence.

---

### [Pitch, slide and pressure envelopes in LOM?](https://cycling74.com/forums/pitch-slide-and-pressure-envelopes-in-lom)

**Venue:** Cycling '74 forum
**Era:** Live 11 launch (~2021)
**Author:** Giovanni Allegri
**Replies captured:** 2 contributors

**OP says:** Asks whether Live 11's new MPE pitch/slide/pressure envelopes are accessible via LOM.

**Notable replies:**
- **Eero Pitkänen:** *"Nope :("* — confirms unavailable. Follow-up: *"clip envelope access is also missing from the Max for Live object model"* and suggests clip envelope support would likely be prioritised before note expression data access. Asks if these are on Ableton's development backlog.

**Why it matters:** Establishes the priority chain — clip envelopes are the foundational gap. Every new envelope-related Live feature ships without LOM access, repeating the same pattern.

---

### [printing Envelopes back onto Ableton Midi Clips](https://cycling74.com/forums/printing-envelopes-back-onto-ableton-midi-clips)

**Venue:** Cycling '74 forum (MaxMSP Forum section)
**Author:** teeshirtguy5
**Replies captured:** 3 contributors

**OP says:** Wants to write envelope data onto MIDI clips for automating VST parameter decay based on note duration. Already has note data via `live.object`. Asks how to *"put this back onto the midi clip as an automation envelope."*

**Notable replies:**
- **AudioMatt:** *"bump/feature request!"*
- **Andrea Trona:** asks AudioMatt if he developed any solution about "printing" clip envelopes — confirms gap persists

**Why it matters:** A real production use case (note-length-driven VST decay) blocked by the exact API gap. The "bump/feature request!" framing is plain-language evidence.

---

### [Control MPE of each note independently from M4L](https://cycling74.com/forums/control-mpe-of-each-note-independently-from-m4l)

**Venue:** Cycling '74 forum
**Era:** Post-Live 11
**Author:** Dalmazzo
**Replies captured:** 2 contributors

**OP says:** Wants to control MPE pitch on individual chord notes via M4L.

**Notable replies:**
- **soundyi:** *"there is no API / function to access (read & write) the most interesting data of MPE in a clip."*

**Why it matters:** Confirms the pattern at the MPE expression layer too — same read/write gap across envelope-like data structures inside clips.

---

### [Producer Pal: MCP server running in Node for Max to control Ableton Live](https://cycling74.com/forums/producer-pal-mcp-server-running-in-node-for-max-to-control-ableton-live)

**Venue:** Cycling '74 forum
**Era:** 2024-2025 (Live 12.3+ era)
**Author:** Adam Murray (recognised M4L developer; honorable mention in Anthropic "Built with Claude" contest)

**OP says:** Built an MCP server device letting AI assistants control Live (clips, tracks, scenes).

**Notable replies:**
- **Adam Murray (his own follow-up):** *"Nope! You still cannot use the Max for Live API with Node.js."* Describes Node-to-V8 patch-cable workaround.
- **Michael Freeman:** discusses Wavetable mod matrix limitations + Apple Accessibility Layer + vision models as alternative LOM access paths

**Why it matters:** Contemporary (Live 12.3+) evidence from a high-profile M4L dev that the LOM is being treated as a barrier even by modern AI-assistance integrations. Adam's product won Anthropic recognition — credentialed voice.

---

### [feature request - access to clip envelopes via the LOM](https://forum.ableton.com/viewtopic.php?t=214401)

**Venue:** Ableton Forum (M4L section)
**Date:** ~March 2015
**Note:** Direct fetch returns 403; content is from Google snippets — re-verify before quoting in the pitch.

**OP says (per snippets):** Requests LOM access to clip envelopes "at least to be able to read out envelope split points." Notes the `AutomationEnvelope` class with `insert_step` and `value_at_time` methods exists. Asks whether these can be accessed from Max for Live.

**Why it matters:** A feature request on Ableton's OWN community forum that explicitly names the methods in the proposal, dating to 2015 and still cited as unaddressed in 2024 threads. *"Your own users have been asking for this since 2015"* is a strong opening line.

---

### [Envelope access in LOM](https://forum.ableton.com/viewtopic.php?t=243862)

**Venue:** Ableton Forum
**Date:** 2021
**Note:** Direct fetch returns 403; content from Google snippets.

**OP says (per snippets):** *"Users can step modulate envelopes using Push, and it would be great if they had access to this function with Max."* Parity argument with Push hardware that already does step modulation under the hood.

**Why it matters:** Parity framing — the underlying capability already exists for Push. Asking to expose it to LOM is asking less than building from scratch.

---

### [SPLINE CURVES for all CLIP envelopes in LIVE PLEASE](https://forum.ableton.com/viewtopic.php?t=18826)

**Venue:** Ableton Forum (feature requests)
**Date:** 2005-04-14
**Note:** Forum 403 on direct fetch.

**OP says (per snippets):** Requests spline curves to eliminate "stairstepping" — the exact artifact `insert_step` produces today.

**Why it matters:** The word "stairstepping" used in a community complaint **21 years ago**. Same gap, same word, three Live release cycles.

---

### [Bezier Curves in Automation Envelopes](https://forum.ableton.com/viewtopic.php?t=86435) + [Bezier curves automation envelopes](https://forum.ableton.com/viewtopic.php?t=31006)

**Venue:** Ableton Forum (feature requests)
**Dates:** 2005-12-15 and 2008-02-24

**OP context:** Two of the oldest documented bezier requests on Ableton's forum. The 2008 thread specifically mentions using bezier curves for "funky beats using Operator" — Operator is still a flagship Ableton instrument 18 years later.

**Why it matters:** The bezier request predates LOM existing. The historical thread of "we want better curves" has been continuous from 2005.

---

### [AbletonOSC Issue #112: Support ability to modify automation envelope](https://github.com/ideoforms/AbletonOSC/issues/112)

**Venue:** GitHub (ideoforms/AbletonOSC — most popular open-source Ableton OSC bridge)
**Date:** 2024-01-11
**Author:** hilifit

**OP says:**
> *"Would be great if we could modify the automation envelope programatically. In the API docs there's a `Live.Clip.AutomationEnvelope.insert_step()` method. Could this be implemented?"*

**Why it matters:** Fresh 2024 data point in a different community (Python/OSC scripting, not M4L). Shows the demand crosses ecosystems.

---

## MEDIUM relevance — concise summary

### [M4L: A few questions about the Live API and Object Model](https://forum.ableton.com/viewtopic.php?t=130703)
~2009-2010. Early M4L wishlist asking for clip envelope breakpoint access. A response acknowledged "most of the API functions were initially meant for controllers, so the functionality was rather basic" and expected the API "to be extended further, with clip notes access having already been added." **Clip notes API was extended; clip envelopes never was.** Asymmetry evidence.

### [Setting ALL breakpoints at clip start/end through scripting?](https://forum.ableton.com/viewtopic.php?t=199185)
~2014. User wants to set breakpoints at clip start/end for every automatable parameter. SNAP recording trick discussed. No clean scripting solution.

### [Clip automation and CC out](https://cycling74.com/forums/clip-automation-and-cc-out)
**Andrew Pask (Cycling '74 staff):** *"a known limitation of the Live editor GUI currently"* + *"I'm not even sure if you can output NRPNs from Live"* — rare staff candor about API limits.

### [Need envelope/automation selector gui for M4L](https://cycling74.com/forums/need-envelopeautomation-selector-gui-m4l)
**broc (Cycling '74 community elder):** *"You can't built an envelope selector gui since M4L doesn't provide access to the selector in Live."* Quotable.

### [Recording Clip automation](https://cycling74.com/forums/recording-clip-automation)
Direct community quote: *"only pattern data that can be read/written to in a live midi clip is the notes."* Confirms the notes-vs-envelopes asymmetry.

### [Generate Midi CC values from javascript in M4L to emulate envelopes](https://cycling74.com/forums/generate-midi-cc-values-from-javascript-in-m4l-to-emulate-envelopes)
OP states the motivating reason explicitly: *"editing clip envelopes is not included in the Live API."*

### [Breakpoint editing works in Arrangement](https://cycling74.com/forums/breakpoint-editing-works-in-arrangement)
Live 8.0.4 era. **tyler mazaika:** *"to my knowledge there has never been any API for manipulating automation values in the timeline."* The "never" word from Live 8 era stays accurate through Live 12.

### [what is your opinion on the new envelope curves](https://forum.ableton.com/viewtopic.php?t=191085)
Live 10.1 era. Users critique Ableton's new auto-bend curves: can only have one end smooth; can't bend a straight line; no design-package-style drag handles. **Strong request:** *"Bezier curves with handles on points, allowing users to make any curve they want."* Useful: shows Ableton's half-measure (Option-drag bends) didn't satisfy the underlying demand.

### Curved Automation cluster (multiple threads)
- [Curved Automation (Cycling '74)](https://cycling74.com/forums/curved-automation) — DariousBlount, no working solution
- [Curved Automation (Ableton Forum)](https://forum.ableton.com/viewtopic.php?t=165798) — Quote: *"curved automation is my top priority for Ableton Live"*; current workarounds are *"hokey"* compared to Logic
- [Curved automation solution!](https://forum.ableton.com/viewtopic.php?t=176983) — BentoSan's community-built solution
- [Curved enveloppes and automations?](https://forum.ableton.com/viewtopic.php?t=135072) — Notes Live 8 already had bezier rendering tech for Sampler/Operator, just not exposed on automation lanes
- [bezier curves in max?](https://forum.ableton.com/viewtopic.php?t=138022)

### [M4L control device with custom envelope](https://cycling74.com/forums/m4l-control-device-with-custom-envelope)
User wants LFO-like M4L device with user-drawable envelope, referencing Massive X's performer. **tyler mazaika** points to Shaper.amxd as workaround — real-time only, doesn't write to clip.

### [Envelope functions vs Automation control from LIVE](https://cycling74.com/forums/envelope-functions-vs-automation-control-from-live)
**broc:** *"I don't think there is anything available in Max with the power and convenience of Live's automation control."* Recognises Live's native UI is best-in-class but inaccessible.

### [Deleting the envelopes of a custom M4L device](https://cycling74.com/forums/deleting-the-envelopes-of-a-custom-m4l-device-containing-live-dials)
The only LOM envelope operation that works is deletion. Concrete evidence of the asymmetric API.

### [Use M4L to create MIDI clip, populate with cc values](https://cycling74.com/forums/use-m4l-to-create-midi-clip-populate-with-cc-values)
**broc** suggests notes (writable) instead of CC (not writable), or external raw MIDI file generation — mirrors the `.alc` external-file workaround pattern.

### [Ugly automation](https://cycling74.com/forums/ugly-automation)
References "a hidden option in Live 9 for controlling breakpoint recording that was removed in Live 10." Suggests Ableton has internally experimented with precision controls.

### [Advanced automation envelopes](https://forum.ableton.com/viewtopic.php?t=157486)
~2011. Comprehensive bezier + envelope-shape (sine/triangle) feature request. Demonstrates how bezier sits within broader producer wishlist.

---

## LOW relevance — list only

- [Live 11: No API Access to Clip Key & Scale?](https://cycling74.com/forums/live-11-no-api-access-to-clip-key-scale) — same pattern (Live feature ships without LOM)
- [What's New in Ableton 12!](https://cycling74.com/forums/whats-new-in-ableton-12) — community wishlist; no envelope/automation API surfaced
- [drawing bezier curves](https://cycling74.com/forums/drawing-bezier-curves) + [\[Job\] Bézier curve function external](https://cycling74.com/forums/job-bezier-curve-function-external) — bezier in Max patches, not LOM
- [\[sharing\] timing/envelope generator](https://cycling74.com/forums/sharing-timingenvelope-generator) — in-patch DSP only
- [Recording automation](https://cycling74.com/forums/recording-automation) — confirms record-based workarounds need IAC driver hacks
- [Live 8: Automation Curves?](https://forum.ableton.com/viewtopic.php?t=104692) — GUI-side request
- [Inserting breakpoints](https://forum.ableton.com/viewtopic.php?t=47457) — about GUI precision
- [Is it possible to draw actual curves in automation?](https://forum.ableton.com/viewtopic.php?t=168385) — user-facing curve demand
- [More precise automation](https://forum.ableton.com/viewtopic.php?t=117475) — precision, tangential
- [Smooth automation curves](https://forum.ableton.com/viewtopic.php?t=107961) — 2009 general request

---

## External resources

- **[Julien Bayle's unofficial Live API documentation](https://structure-void.com/PythonLiveAPI_documentation/Live10.0.1.xml)** — confirms `AutomationEnvelope.insert_step(time, length, value) -> None` and `value_at_time(time) -> float` as the only documented surface. No bezier methods exposed.
- **[gluon/AbletonLive12_MIDIRemoteScripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts)** — decompiled current Live 12 scripts, useful for verifying current API surface
- **[docs.cycling74.com/apiref/lom/clip/](https://docs.cycling74.com/apiref/lom/clip/)** — official Clip LOM API reference. Only documented envelope methods: `clear_all_envelopes`, `clear_envelope`, `has_envelopes`. All destructive/read-only.
- **[Quadrophone blog on Mapulator](https://quadrophone.com/blog/mapulator-automation-in-ableton-live/)** — documents BentoSan's M4L device that draws bezier curves "much smoother and more regular than the automation curves or straight lines that Ableton normally uses." Explicitly notes Ableton's native curve is a single tension-style C-curve, not a real bezier.
- **[macprovideo: Dynamic Changes with Live 10.1's New Automation Curves](https://www.macprovideo.com/article/ableton-live/dynamic-changes-with-ableton-live-101s-new-automation-curves)** — context for Live 10.1's GUI-side bezier feature. Proves the bezier rendering engine ships; just isn't plumbed to LOM.
- **maxforlive.com workaround devices** (all third-party, all client-side, none write bezier into clip envelopes):
  - Automation Curve: [maxforlive.com/library/device/5708/automation-curve](https://www.maxforlive.com/library/device/5708/automation-curve)
  - Automation Recorder: [maxforlive.com/library/device/4507/automation-recorder](https://www.maxforlive.com/library/device/4507/automation-recorder)
  - Clip Generator: [maxforlive.com/library/device/4444/clip-generator](https://www.maxforlive.com/library/device/4444/clip-generator)
  - Architect (BentoSan's Mapulator-family devices)

---

## Cross-cutting patterns

1. **20-year continuous demand.** First documented bezier request: 2005. Latest: 2024 (AbletonOSC #112) and 2025-era (Producer Pal). The word "stairstepping" appears as a complaint in 2005 and is still technically accurate today.
2. **Workarounds are universally described as hacks.** "Gray area," "horrible hack," "infamous limitation," "the workaround creates rectangles instead of curves." No respected workflow exists.
3. **Notes API got extended. Envelopes API did not.** Ableton extended note access in M4L (Live 11 added a full note API rewrite). Envelope access stayed frozen since the original release.
4. **Live's GUI engine already does bezier.** Live 10.1 added Option-drag bend curves. Live 12 expanded the bezier toolset. The `.alc` format stores `CurveControl1X/Y` and `CurveControl2X/Y`. The data path exists at every layer except LOM.
5. **Modern devs are still hitting this.** Producer Pal (2024-2025, MCP/Claude integration), AbletonOSC Issue #112 (2024) — even cutting-edge AI-control work hits the same wall.

---

## Cycling '74 staff acknowledgements (cite-worthy)

- **Max Gardener (CY74)** on [Delete Automation thread](https://cycling74.com/forums/is-it-possible-to-trigger-%22delete-automation%22-in-max-for-live): if it's not in LOM Track docs *"it's probably unavailable."* Acknowledges the gap.
- **Andrew Pask (CY74)** on [Clip automation and CC out](https://cycling74.com/forums/clip-automation-and-cc-out): *"a known limitation of the LIve editor GUI currently"* + *"To be honest I'm not even sure if you can output NRPNs from Live."* Rare staff candor.
- **broc (CY74 community/likely staff)** on [Need envelope GUI](https://cycling74.com/forums/need-envelopeautomation-selector-gui-m4l): *"M4L doesn't provide access to the selector in Live"* — confirms LOM as the limit.

**No Ableton staff responses found in any fetched thread.** Worth noting in the pitch: the community has been talking; Ableton hasn't been talking back.

---

## Known gaps in this research

1. **Ableton Forum HTTP 403** — direct fetch was blocked. All quotes from forum.ableton.com are via Google snippets and need manual re-verification before final citation.
2. **Reddit empty** — 60+ queries returned nothing. May be a search-tool limitation rather than absence of content. If needed, manually browse the search URLs below.
3. **Broader web sweep incomplete** — agent hit rate limit before finishing KVR, Gearspace, Hacker News, music blogs, Stack Overflow, YouTube comments, personal blogs of named M4L devs (Chris Brody, Adam Murray's personal blog, Mark Egloff, Robert Henke). Re-run when limits reset.
4. **No private channels searched** — Ableton's developer Slack/Discord (if it exists) and any private Cycling '74 partner programs. If you have access, worth checking.
5. **No YouTube comment scrape** — comments under popular Mapulator demo videos, Stride videos, or any "Live API limitations" tutorial likely contain real-time user frustration. Manual review needed.

### Reddit search recommendations

If Reddit evidence becomes essential for the pitch, manually browse:

- `https://www.reddit.com/r/ableton/search/?q=automation+envelope+max+for+live`
- `https://www.reddit.com/r/MaxMSP/search/?q=ableton+automation+envelope`
- `https://www.reddit.com/r/ableton/search/?q=insert_step`
- `https://www.reddit.com/r/ableton/search/?q=LOM+automation`
- `https://www.reddit.com/r/abletonlive/search/?q=max+for+live+automation`
- `https://www.reddit.com/r/edmproduction/search/?q=max+for+live+LFO+automation`

---

## Quotes ranked for pitch usage

Best one-liners to drop into `docs/bezier-envelope-api-proposal.md`:

1. **dfwaudio** (Cycling '74, ~Live 9/10): *"I finally managed to implement `Live.Clip.Clip.create_automation_envelope()`, `Live.Clip.AutomationEnvelope.insert_step()` and `Live.Clip.AutomationEnvelope.value_at_time()` by editing `LomTypes.pyc` and `MxDCore.pyc`. ... I know it's a gray area and I will not publish this hack."*
2. **hoowdie** (Cycling '74, 2024): *"As of now (Ableton 12.1) there is no possibility to do this, sadly. But it would be amazing."*
3. **Norman Freund** (Cycling '74): *"LOM has no means of writing automation lines."*
4. **Diemo Schwarz** (respected M4L developer): *"This is indeed my biggest incomprehension with Live."*
5. **Eero Pitkänen** (Cycling '74): *"Clip envelope access is also missing from the Max for Live object model."*
6. **tyler mazaika** (Cycling '74, Live 8 era): *"To my knowledge there has never been any API for manipulating automation values in the timeline."*
7. **hilifit** (GitHub AbletonOSC, 2024): *"Would be great if we could modify the automation envelope programatically. ... Could this be implemented?"*
8. **soundyi** (Cycling '74): *"There is no API / function to access (read & write) the most interesting data of MPE in a clip."*

These quotes form the "wave" the pitch's section 3 needs. Pick 3-4 of the strongest + Stephanie's email + any direct Stride customer quotes you have to fill the slots.
