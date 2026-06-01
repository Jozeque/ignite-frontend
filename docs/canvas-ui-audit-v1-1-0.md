# Stride Canvas UI Audit — v1.1.0 Pre-Build Review

Auditor: senior product designer (music software lens — Ableton, Bitwig, NI, Splice, Arturia)
Files audited:
- `C:\Users\Yossi\Desktop\Desktop_MIDI_APP\stride-vst\app\renderer\index.html` (~1,082 lines static shell)
- `C:\Users\Yossi\Desktop\Desktop_MIDI_APP\stride-vst\app\renderer\canvas.js` (~5,937 lines dynamic rendering)

---

## TL;DR

- **Five distinct text sizes (8/9/10/11/12/13 px) are used somewhat interchangeably for the same role**. The biggest inconsistency: section headers in the sidebar (`text-[8px]`/`text-[9px]`), tool button labels (mostly `text-[9px]`, occasionally `text-[10px]` for Stretch), and pill text (`text-[8px]`/`text-[9px]`). A 3-tier scale (8 / 10 / 12) used semantically would tighten the whole UI.
- **A real bug**: the bars-pill row (`Loop 2/4/8/16/32`) renders with `px-2 py-0.5` from static HTML but JS rebuilds it with `px-3 py-1` after first user click — buttons noticeably **jump in size** the first time you switch loop length. (`index.html:599-603` vs `canvas.js:170, 172, 207, 208`)
- **Color semantics drift**: violet, fuchsia, and rose all read as "primary purple" at small sizes. Active lane = `#a855f7` (violet-500), Bloom = amber, Prism = violet (same as active lane), Chaos = fuchsia, Presets = rose, Recent Generations LED = yellow→lime. Eight palette colors compete inside one screen.
- **Toolbar button heights vary by ~6 px between rows**. Row 0 (Loop/Multi/Presets) uses `py-1`, Row 1 (Shapes) uses `py-0.5` for the inner buttons but `py-0.5` for the row container with no wrapper, Row 2 (Mirror/Flip etc.) uses `py-0.5` for buttons. The vertical rhythm reads as 3 rows of slightly different weight.
- **Quick wins exist**: standardize the `sd-bars-btn` rebuild to match initial markup; pick one tracking value for section headers (currently `tracking-[0.2em]` AND `tracking-widest` AND `tracking-wider`); add a missing tooltip to the Loop label; unify the Saved presets bar height with the Shapes bar.

---

## Audit methodology

Read in full:
- `index.html` — entire file, every modal/overlay/toolbar/sidebar block.
- `canvas.js` — sidebar render functions, tool panels (`_sdRenderGenerativeDefault` / `_sdRenderBloomPanel` / `_sdRenderPrismPanel`), preset bar, sessions, generations dock, multi-view canvas renderer, lock icon drawing.

Programmatic class-frequency analysis on both files for: text sizes, font weights, tracking, padding, gap, rounded, color tokens. (Numbers in this doc are real counts.)

Did NOT read:
- `ws-client.js` (158 lines, network only)
- `cloud-client.js` (168 lines, network only)
- `main.js` / `preload.js` (Electron lifecycle, no UI)
- `StrideLink.amxd` (binary, by spec)

Blind spots:
- **Visual rendering wasn't observed live** — all critique is from code reading. A small handful of "this looks cramped" comments may read fine in practice; flagging them anyway because the producer audience scans toolbars constantly.
- The fly-orb LED animation on the dock card was inferred from CSS, not seen in motion. If it's already polished in motion, ignore the comment about it competing with the dock cards.

---

## Findings by category

### 1. Visual consistency

**Distinct text sizes in use**: `text-[8px]`, `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`, plus `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-4xl`. **13 distinct sizes**.

The custom `[Xpx]` scale (8/9/10/11/12/13) is essentially a one-pixel-per-step gradient — humans can't perceptually differentiate 8px from 9px. The result: every developer-eye choice is "well, 10 felt slightly bigger than I wanted, let me try 9," and no shared scale emerges.

| Issue | Location | Recommendation |
|---|---|---|
| `Loop` label is `text-[9px]` (`index.html:598`) but `Stretch` group label is `text-[9px]` AND its inner buttons are `text-[10px]` (`index.html:690-692`). Visual hierarchy says the buttons are bigger than their own group label. | `index.html:689-693` | Make Stretch label and buttons same size as the rest of Row 2 (`text-[9px]`). The 10px is a leftover from when this group was intended to feel "louder." |
| Section headers split between three sizes: `text-[8px]` for `Edit` (`index.html:229`), `text-[8px]` for `Generative` (`canvas.js:3157`), but `text-[9px]` for `Parameters` (`index.html:178`). | index.html:178, 229; canvas.js:3157 | Pick one (`text-[9px]` reads better at this density — 8 is borderline-illegible at standard DPI). |
| The bars-pill row uses `text-[11px]`, but the matched view-mode toggle next to it uses `text-[9px]`. They sit side-by-side in Row 0 and look mismatched. | `index.html:599-603` (11px) vs `index.html:605` (9px) | Make both `text-[9px]` — the bars are a tight numeric scale, no need for them to be larger than other toolbar elements. |
| Recent Generations dock title (`text-[9px]`) and its `Clear` button (`text-[8px]`) — a label and its companion action at different sizes. | `index.html:772, 773` | Match. 9px on both. |
| Connection pill label is `text-[10px]` (`index.html:137`), but inner help title is `text-[12px]` (`index.html:147`). 2px jump for the "title" of the same modal. | `index.html:137, 147` | Connection pill label down to `text-[9px]` (matches sidebar header style); help title can stay 12 if it's playing "modal H1." |
| The empty-canvas CTA H2 is `text-lg` (`index.html:753`) — a single Tailwind size used nowhere else inside the canvas chrome. Looks like a marketing-page heading dropped into the app. | `index.html:753` | `text-base` or `text-sm` — match the welcome / install overlays which use `text-xl`/`text-base` deliberately as gates, not in-canvas chrome. |

**Distinct font weights**: `font-medium` (8), `font-bold` (155), `font-black` (74). Three weights used, one of which (`medium`) appears almost incidentally:
- `font-medium` is used in 8 places for body copy (e.g., the "checking license" form) — fine.
- `font-bold` and `font-black` are used interchangeably for buttons/labels with no clear rule. E.g., Mirror/Flip buttons are `font-bold` (`index.html:662-663`) but Stretch 2x/1/2x are `font-black` (`index.html:691-692`). Same toolbar row.

Recommendation: rule of thumb — **`font-black` for caps-only labels (CTA buttons, section headers); `font-bold` for everything else**. Apply across the board. Many `font-bold` toolbar buttons would actually benefit from being downgraded so the section-header `font-black`s stand out.

**Distinct letter-spacings in use**: `tracking-tight`, `tracking-tighter`, `tracking-wider`, `tracking-widest`, `tracking-[0.2em]`, `tracking-[0.3em]`. **6 distinct values**.

Counts:
- `tracking-widest` — 51 uses
- `tracking-wider` — 56 uses
- `tracking-[0.2em]` — 10 uses
- `tracking-[0.3em]` — 5 uses
- `tracking-tight` — 4 uses
- `tracking-tighter` — 1 use

The 0.2em / 0.3em arbitrary values are virtually identical to widest (0.1em) at 8-9px sizes. **The mix of `tracking-[0.2em]` (Edit/Generative section headers) and `tracking-widest` (Parameters section header) on adjacent labels in the same sidebar is very visible** — they read as different fonts.

| Issue | Location | Recommendation |
|---|---|---|
| Sidebar section headers split: `Parameters` uses `tracking-[0.2em]` (`index.html:178`), `Edit` uses `tracking-[0.2em]` (`index.html:229`), `Generative` uses `tracking-[0.2em]` (`canvas.js:3157`). Actually consistent — **but** the matching `text-[10px] font-bold` body labels in connection help / toasts / template status all use `tracking-wider` or `tracking-widest`. | various | Adopt `tracking-[0.2em]` as the universal "section header" spacing, `tracking-widest` for "in-button caps label", `tracking-wider` only for slightly less-prominent labels. Drop `tracking-[0.3em]` (used 5 places, no clear semantic — it's "wider than widest"). Drop `tracking-tighter` (1 use, can use `tracking-tight` instead). |

### 2. Spacing + alignment

**Distinct gaps**: `gap-0.5`, `gap-1`, `gap-1.5`, `gap-2`, `gap-2.5`, `gap-3`, `gap-4`, `gap-5`, `gap-7`. **9 distinct gap values**.

**Distinct paddings (button-relevant)**: `px-1`, `px-1.5`, `px-2`, `px-2.5`, `px-3`, `px-4`, `px-5`, `px-6`, `px-7`; `py-0.5`, `py-1`, `py-1.5`, `py-2`, `py-2.5`, `py-3`, `py-4`, `py-5`, `py-6`.

| Issue | Location | Recommendation |
|---|---|---|
| **Bars-pill rebuild bug**: Initial HTML uses `px-2 py-0.5` (`index.html:599-603`). After first `sdSetBars()` click, `canvas.js:170, 172` rewrite the className to `px-3 py-1`. Same with `sdApplyStickyBars()` at `canvas.js:207-208`. Buttons grow visibly the first time. | `index.html:599-603` vs `canvas.js:170, 172, 207, 208` | Pick one. Recommend `px-2 py-0.5` to match the rest of Row 0's compact density. Update all three call sites. |
| **Tool-btn rebuild bug**: Same pattern. Static HTML at `index.html:632-633` uses `px-2 py-0.5`. JS rebuild at `canvas.js:2271-2272` uses `px-3 py-1`. Point/Free buttons jump on first switch. | `index.html:632-633` vs `canvas.js:2271-2272` | Same fix — pick one and align. |
| Row 0 buttons use `py-1` (Multi, Presets, Generate) but Row 1 buttons use `py-0.5` (Sine, Pump, Glitch...). Row heights are `min-h-[40px]` and `min-h-[36px]` respectively (`index.html:594, 630`) but the visible button differential is jarring. | Row 0: `index.html:594-622`. Row 1: `index.html:630-654`. | Drop Row 0 button padding to `py-0.5` to match toolbar density, OR raise Row 1 to `py-1` if the design prefers more breathable toolbars. Don't mix. |
| Sidebar EDIT section uses `gap-1.5` between sliders (`index.html:230`), but GENERATIVE section uses `gap-1.5` for the 3-button grid AND `gap-2` for tool-panel sliders (`canvas.js:3158, 3182`). Two adjacent "rows of controls" with different vertical density. | `index.html:230` vs `canvas.js:3182` | Pick `gap-1.5` everywhere in the sidebar — keeps vertical rhythm consistent. |
| Section header bottom margins differ: Edit header has `mb-1.5` (`index.html:229`), Generative header (in inline panels) has `mb-2` (`canvas.js:3175`), default Generative header has `mb-1.5` (`canvas.js:3157`). | various | Pick `mb-1.5` everywhere. |
| The "Loop" label inside the bars-pill row has `px-0.5` (`index.html:598`), the "Stretch" label inside the stretch group has no `px` (`index.html:690`) — same role (group label inside a bordered group), inconsistent padding. | `index.html:598` vs `index.html:690` | Both should have either `px-0.5` or `pl-1 pr-0.5` — pick one. |
| The `Shapes:` and `Saved:` labels in Row 1 (`index.html:636, 647`) use `text-[8px] font-bold` with no padding — they sit floating between buttons. The `Stretch` label in Row 2 sits inside a bordered/colored container. **Visually inconsistent role for "group label."** | `index.html:636, 647, 690` | Decide: do group labels go inside their button cluster (Stretch model) or float between (Shapes/Saved model)? Pick one and apply. The Stretch model reads as "this whole thing is a unit"; the floating model reads as "these next buttons share a category." |

### 3. Hierarchy + information architecture

| Issue | Location | Recommendation |
|---|---|---|
| **The most critical action, `Apply to Clip`, is a quiet thin emerald bar in the sidebar** (`index.html:194`) at the same visual weight as `Save Session` and `Load`. Producers will lose this. The marquee feature post-Apply (the floating "Ready to drop" card at `index.html:713`) is gorgeous, but the discovery path "draw curves → look down at sidebar → find Apply" is not signposted. | `index.html:194` | Make `Apply to Clip` substantially more prominent than the Save/Load row. Use the orange/red gradient already in use for the Activate license button (`index.html:112`). Consider 2-line: big primary, "Drag generated .alc into Ableton" hint. |
| **Scan Mapped is fuchsia/pink, Apply to Clip is emerald, Save/Load are sky** — three primary colors in three sequential actions in one column. Producers reading this column don't get a clear "first → next → next" path. | `index.html:192-208` | Use a color gradient that mirrors the workflow: greys/zinc for setup, the brand orange/fuchsia for the primary action, then emerald only for the post-action confirmation toast. Right now every step shouts. |
| **Toolbar Row 1 mixes "Draw tool" (Point/Free) with "Shape templates" (Sine/Pump/...) with "Saved presets bar" with "Save Lane / Clear Lane"**. Four concepts in one row. The vertical dividers help, but at 36px height the user has to read every label. | `index.html:630-654` | Either: (a) split into two rows — input tools above, content tools below — or (b) collapse Saved/Save/Clear to a single "..." overflow menu and reclaim space for the templates which are the more frequently-used elements. |
| **`Lock All` in Row 2 lives next to `Select All` and `Select`** — the lock concept is a per-lane affordance (the lock icon is also in the param sidebar AND drawn directly on the multi-view canvas labels). Three surfaces to lock, two of them next to "select" controls. **Possible mental confusion**: "is selecting locking?" | `index.html:694-699` | Move `Lock All` to a separate group, OR group it with the per-lane lock icon affordances visually (e.g., put the lock icon first, then text, then a divider before Select All / Select). |
| **`Mutate`, `Shuffle`, `Stretch`, `Select All`, `Select`, `Lock All` are in the same row** with no internal grouping clue beyond `\| h-4` dividers (`index.html:683-700`). All same height, similar styling. The user has to read each label. | `index.html:683-700` | Add a category label per group (`Generate:` / `Time:` / `Selection:`) using the same `text-[8px] font-bold uppercase shrink-0` pattern Row 1 already uses for `Shapes:` / `Saved:`. This is the consistency win for free. |
| **The Edit sliders (Smooth/Depth/Curve/Floor/Ceiling) live in the sidebar; the lane modifiers (Mirror/Flip/Copy/Paste/Mutate/Shuffle/Stretch) live in the toolbar**. From a producer's perspective these are all "shape this curve" actions — splitting them across two surfaces (one bottom-left, one top) costs eye-travel time. | `index.html:230-256` (sliders) vs `index.html:660-700` (toolbar) | Worth considering: move sliders into the toolbar (collapsible), OR move all shape-modifiers into the sidebar. v1.1 isn't the moment for this refactor, but flag it for v1.2. |
| **Active state for the bars-pill is `bg-fuchsia-500/20 text-fuchsia-400`** but the active state for `View Mode toggle (Multi)` in the same row is `bg-fuchsia-500/20 border-fuchsia-500/50 text-fuchsia-300` (with a border). Two adjacent buttons with two different definitions of "active." | `index.html:601` vs `index.html:605` | Standardize on the bordered version — the border is a clearer "this is on" affordance against dark backgrounds. Same applies to Point/Free tool buttons (`index.html:632-633`). |

### 4. Density / whitespace

| Issue | Location | Recommendation |
|---|---|---|
| **Sidebar is 224px (`w-56`)** (`index.html:174`) which is tight for 5 sliders + section header + value display. The slider labels are clipped/abbreviated at this width — `Smooth/Depth/Curve/Floor/Ceiling` all use `w-12 shrink-0` (48px) which leaves the slider track small. | `index.html:230-256` | If the sidebar can stretch to `w-64` (256px) the sliders gain ~30% more travel without changing label width. Test at this width — if it doesn't break the canvas viewport, ship it. |
| **The titlebar is overcrowded on right side**: M4L pill, Sidebar toggle, Guide, Install to Ableton, Folder icon, (hidden) Account. Six items + Windows native controls + 144px buffer. Already cramped; will break if anything gets added in v1.2. | `index.html:129-167` | Collapse `Install to Ableton` and `Open folder` into a single "..." overflow on Windows where the controls are widest. Or move `Install to Ableton` into the Guide modal as a callout (it already is — it's the "First-Time Setup" block at the top of the guide), and remove the titlebar duplicate. |
| **The Recent Generations dock has wasted left/right ends**: 88px `Recent Generations` label + Clear button + canvas-status + keyboard-hints column. The middle (cards) gets ~60% of the width. | `index.html:770-781` | The label could collapse to a single small icon or just be smaller (`text-[8px]` matching Clear), gaining ~40px for cards. The keyboard-hints `xl:block` is a nice progressive enhancement; consider making `Recent Generations` similarly hidden below `lg:` to allow narrower windows. |
| **Toolbar Row 1 wraps awkwardly when window is narrow**: `gap-x-1.5 gap-y-0.5` and `flex-wrap` (`index.html:630`). When wrapped, the second line of buttons sits 1px below the first with no clear separation, and the row taller than `min-h-[36px]` can clash with the canvas above/below. | `index.html:630` | Add `gap-y-1` instead of `gap-y-0.5` for clearer separation when wrapped. Alternatively, drop `flex-wrap` and add horizontal scroll if narrower than threshold. |
| **The bars-pill cluster uses `bg-black/50 p-1 rounded-lg border border-fuchsia-500/30`** (`index.html:597`), giving it visual weight — a "container of related buttons." Same pattern at `index.html:631` for tool-btn cluster. **But** Mirror/Flip, Copy/Paste/Inv/Paste-To, Stretch all also use the same pattern (`index.html:661, 666, 689`). Five wrapped clusters with similar borders, all in the same toolbar zone. The eye doesn't get a "this is the special one" hint anywhere. | various | Reserve the bordered cluster style for ONE most-important group. Drop borders from Mirror/Flip and Copy/Paste — let internal `\| h-4` dividers do the work. The bars-pill (`Loop`) deserves the bordered emphasis because it's the loop-length control, used every session. |

### 5. Touch targets + click affordance

| Issue | Location | Recommendation |
|---|---|---|
| **Most toolbar buttons are ~20px tall** (`text-[9px] px-2 py-0.5`). Apple/Microsoft both recommend 24px minimum for desktop click targets. **Producers who scroll-wheel-zoom while drawing will regularly fat-finger.** | most toolbar buttons | Bump `py-0.5` to `py-1` across Row 1 and Row 2 buttons. Adds ~6px height. |
| **Lock-icon buttons in the sidebar param list are 20px square** (`p-1` with `w-3 h-3` SVG = 12px icon + 8px padding). Right at the edge of usable. | `canvas.js:1356` | Increase to `p-1.5` for a 24px target. The visual change is minimal because the icon stays 12px. |
| **The connection pill (M4L status) only has hover state (`hover:bg-white/5`)** — no active/pressed state, no visible click affordance other than the hover. Users may not know it's a button. | `index.html:135-138` | Add a `cursor-pointer` (already implicit on `<button>` but make it explicit), and consider a subtle ring or border on hover so it reads as "clickable" rather than "label." |
| **The titlebar `Sidebar toggle` icon is a hamburger (`index.html:157`)** but it sits next to "Guide" and "Install to Ableton" buttons that are text. The hamburger looks decorative, not functional. Producers will not click it. | `index.html:156-158` | Add a text label or replace with a clearer SVG — e.g., a panel-collapse icon (rectangle with vertical line). |
| **The Apply Reveal × close button** is `w-8 h-8` (32×32) (`index.html:735`) — bigger than any other click target in the app. **Inconsistent with the close × in modals which are typically `text-lg` text glyphs in a `w-5 h-5` container.** | `index.html:735` vs all `&times;` close buttons | Either bump all modal closes up to 32px (better) or shrink Apply Reveal close to 24px (worse for accessibility). Recommend the former. |
| **Recent Generations cards are draggable (`cursor-grab`/`cursor-grabbing`)** — good. The Apply Reveal card is also draggable. **But the apply-toast bottom-right has no drag affordance** even though it shows a generated file. | `index.html:1061-1076` | Either remove the drag concept from the apply-toast (it's just a "saved!" notice now), or also make it draggable to match the dock cards. Currently producers may try to drag and find nothing happens. |

### 6. Empty states + first-run polish

| Issue | Location | Recommendation |
|---|---|---|
| **Two empty-state messages compete**: the sidebar's `no-rack-msg` says "Connect M4L device and click Scan" (`index.html:186-188`), and the empty-canvas CTA says "Press **Scan Mapped** in the sidebar to pull your rack's parameters into the canvas" (`index.html:754-756`). They contradict — sidebar says "click Scan" (no longer the button name), CTA says "Scan Mapped" (correct). | `index.html:186-188` | Update sidebar to match: "Click Scan Mapped to load your rack's parameters." Or remove the sidebar message entirely — the centered canvas CTA is the more visible one. |
| **The empty-canvas CTA is centered absolute over the canvas** with `pointer-events-none` on the wrapper but `pointer-events-auto` on the inner card (`index.html:746-761`). Smart. **But** if the user clicks directly outside the card, nothing happens — they don't get a hint that the canvas is active beneath. | `index.html:746-761` | Add a subtle `cursor-default` to the wrapper and a tooltip-style explanation: hovering anywhere outside the CTA could surface "Scan a rack to start drawing here." Low priority. |
| **The "Heads up" amber callout inside the empty state** (`index.html:758`) introduces an Ableton-specific concept ("opened automation lanes") that a brand-new user won't have context for. The Guide modal explains this in detail at Step 2 (`index.html:355-372`). | `index.html:758` | Replace with: "First time? Open the **Guide** in the titlebar — Step 2 covers automation lanes." Reduces the amount of net-new info in the CTA. |
| **No empty state for "rack scanned but no curves drawn"** — the canvas just shows an empty grid with the active param's range labels. There's no "click to draw your first point" hint. | canvas.js sdDrawCanvasGrid | Add a subtle centered hint inside the active lane: "Click anywhere to add a point" — fades on first click. |
| **No empty state for the Recent Generations dock when the user has applied 0 clips** — currently shows "No generations yet — Apply a clip to start filling this dock." in italic zinc-600 (`index.html:776`). This is functional but tonally out-of-step with the rest of the app's confident voice. | `index.html:776` | "Your generations will appear here." — drop the parenthetical instruction; the user just hit Apply seconds before, they know what filled the dock. |
| **No transition when switching from "no rack scanned" to "rack scanned with empty canvas"** — the empty CTA card disappears abruptly. | `canvas.js:1242-1249` (sdUpdateEmptyState) | Add a `transition-opacity duration-200` on the `#sd-empty-canvas-cta` so it fades. Tiny polish but matters. |

### 7. Modals + popovers

| Issue | Location | Recommendation |
|---|---|---|
| **Close-button styles vary across modals**: Save Session uses `text-lg leading-none` `&times;` (`index.html:264` parent doesn't have one — closes via overlay click). Save Preset same. Load Session same. Guide modal uses an SVG X icon at `w-5 h-5` (`index.html:313-315`). Preset Bank uses `text-lg leading-none` `&times;` (`index.html:887`). Apply Reveal uses an SVG X at `w-4 h-4` in a `w-8 h-8` container (`index.html:735-738`). **Five different close-button implementations.** | various | Pick one. Recommend the SVG X in `w-6 h-6` button — looks more polished than the `&times;` glyph at this scale and is consistent with the Guide modal. |
| **Header styles vary across modals**: Save Session uses `text-xs font-bold uppercase tracking-widest` (`index.html:264`). Guide modal uses `text-lg font-black text-gradient uppercase tracking-widest` (`index.html:310`). Preset Bank uses `text-[13px] text-rose-400 font-black uppercase tracking-widest` (`index.html:884`). Generate panel uses `text-sm font-black text-gradient uppercase tracking-widest` (`index.html:805`). **Four header treatments.** | various | Adopt the gradient-text + `text-sm` standard for "feature-prominent" modal headers (Generate, Guide). Use plain `text-sm font-black uppercase tracking-widest` for "task" modals (Save Session, Save Preset). |
| **Modal background opacities differ**: Guide is `bg-black/80 backdrop-blur-sm` (`index.html:305`). Save Session is `bg-black/70` no backdrop blur (`index.html:262`). Preset modal is `bg-black/60 backdrop-blur-sm` (`index.html:880`). Generate panel is `bg-black/80 backdrop-blur-sm` (`index.html:802`). | various | Standardize on `bg-black/75 backdrop-blur-sm` for all modal overlays. The blur differentiates modals from "quiet toasts" which use no blur. |
| **Z-index conflicts**: install-m4l overlay is `z-[10001]` (`index.html:509`), welcome overlay is `z-[10000]` (`index.html:541`), requirement-modal is `z-[9999]` (`index.html:573`), apply-toast is `z-[9999]` (`index.html:1061`), preset modal is `z-[9999]` (`index.html:880`). **The Apply Toast at z-9999 will overlap the Preset modal at z-9999** — and last-rendered wins. Fragile. | various | Set explicit semantic layers: overlays/full-screen gates = z-9000, toasts = z-8000, popovers = z-7000. Pick one z per layer. |
| **The Connection Help popover is `top-12 right-4`** absolute-positioned (`index.html:143`) — it floats below the titlebar but doesn't visually anchor to the M4L status pill that opened it. No arrow/chevron pointing back. | `index.html:143` | Add a small chevron/arrow at the top-right of the popover pointing to the pill, OR position it directly below the pill (currently `right-4` is far to the right of the pill). |
| **The Paste-To popover is positioned in JS via `getBoundingClientRect`** (`canvas.js:2376-2379`). Good. **But** it's `w-56` (224px) and `max-h-64` (256px) — fixed dimensions even when there are 2 lanes. Looks like a waiting-room. | `index.html:786` | Set `max-h-64` only; let height shrink to content. `min-h-[60px]` if you want to prevent total collapse. |

### 8. Brand cohesion

| Issue | Location | Recommendation |
|---|---|---|
| **The Outfit font weight mix is broad**: `font-weight: 300/400/500/700/900`. The app loads all five weights from Google Fonts (`index.html:9`) but only uses 400/500/700/900 in markup (700 = `font-bold`, 900 = `font-black`, 500 = `font-medium`, 400 = default). 300 is loaded but unused. | `index.html:9` | Drop `300` from the font URL — saves a font-weight download (~20kb). Add `600` if you want a "between bold and medium" option for body emphasis. |
| **Brand gradient (`from-orange-500 to-red-500` / `to-red-600`)** is used on: Activate license button (`index.html:112`), Watch the walkthrough button (`index.html:480`), Generate button (`index.html:846`), apply-reveal close X (no), STRIDE titlebar text (`index.html:130` — uses the `.text-gradient` class which is `from-#f97316 to #ef4444`). **The gradient is the strongest brand signal but it appears in places that aren't the most-important action in the app.** | various | Reserve the gradient for the SINGLE primary action on each screen. In the canvas, that's `Apply to Clip`. Currently it's plain emerald — feels like a casual save button. |
| **Marketing site (stridehub.io) uses Outfit + dark base — consistent with the app**. The accent palette on the marketing site (need to verify) appears to lead with orange → fuchsia. The app uses these colors but adds violet/amber/sky/cyan/rose, diluting the brand signature. | n/a | If marketing leads with orange + fuchsia, reduce the violet/sky/cyan/rose count in the app to use those colors only when they earn it (Prism = violet because of the prism-color metaphor; Bloom = amber because of the warm "bloom" metaphor). Drop sky and cyan entirely — they're cold tones that don't fit the brand. |
| **The `text-gradient` class is defined inline in `<style>`** (`index.html:20`) but is the brand's primary visual signature. It's used in 4 places — should it be more visible? | `index.html:20` | Consider applying `text-gradient` to all section headers in the sidebar (Parameters, Edit, Generative) — gives the sidebar a cohesive brand-stamped feel. |

### 9. Producer-software conventions

| Issue | Location | Recommendation |
|---|---|---|
| **Right-click on a point deletes it** (`canvas.js:2149`) — good, matches Ableton convention. | `canvas.js:2149` | Document this in a tooltip on the canvas (e.g., on first hover, show a one-time "Right-click to delete a point" hint). |
| **Ctrl+Wheel zoom** and **Space+Drag pan** are exposed via the right-side hint pill (`index.html:779`) — visible only on `xl:` (1280px+). At common Stride window sizes (≤1280), these critical shortcuts are HIDDEN. | `index.html:779` | Always show, even if it means truncating to "Ctrl+Wheel · Space+Drag" without Alt+Drag. Or surface in the Guide modal under a "Keyboard shortcuts" section. |
| **No keyboard shortcuts surface at all** beyond Escape (cancel tool) and Enter (license). Ableton/Bitwig users expect Cmd+Z, Cmd+Shift+Z, Cmd+S, etc. The undo/redo system exists (`sdUndo`/`sdRedo`) but isn't wired to keyboard. | `canvas.js:101, 113` | Add `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` for undo/redo. `Ctrl/Cmd+S` for "Apply to Clip" (stretches the metaphor but matches DAW muscle memory). `Ctrl/Cmd+A` for Select All lanes. Surface in the Guide modal. |
| **No scroll-wheel on the multi-view scrollbar** — the indicator at the right (`canvas.js:1903-1913`) is purely decorative. Users can't scroll lanes via wheel when in multi view. | `canvas.js:1903-1913` | Add wheel handler that increments `sdMultiScrollOffset`. This is the #1 producer expectation when seeing a tall vertical list. |
| **Curves draw fuchsia/violet** (`#a855f7`) regardless of which lane is active. Other DAWs color automation lanes per-parameter. Stride's multi-view colors all lanes the same purple, just at different opacities (active = brighter). Not necessarily wrong — but reduces glance-readability with 8+ lanes. | `canvas.js:1865, 1890, 1592, 1615` | Future consideration (not v1.1): allow curve color cycling per lane, e.g., a soft hue shift like Ableton's clip colors. The current single-color approach is a deliberate choice; surface it as a setting if you want both. |
| **No middle-click drag for pan** — Bitwig/Reaper convention. Currently only Space+Drag. | n/a | Worth adding for v1.2; not critical for v1.1. |

### 10. Tooltip + label clarity

Total tooltips: 26 in `index.html`, 15 in `canvas.js` = **41 total**. Most toolbar buttons have them.

| Issue | Location | Recommendation |
|---|---|---|
| **`Loop` group label has no tooltip** (`index.html:597`) — the title attr is on the wrapper saying "Loop length (bars)" but a new user looking at the button row wouldn't see it. | `index.html:597` | Add the title to the inner `<span class="...">Loop</span>` instead of the wrapper, so hovering the visible label triggers the tip. |
| **`Mutate: reshape active`** (`index.html:686`) is too terse — what does "reshape" mean? Cuts? Randomizes? Inverts? | `index.html:686` | Expand: "Mutate — randomly cut, shuffle, and re-layer the active lane's curve. Each press is different." |
| **`Shuffle curves between lanes`** (`index.html:687`) is good. | `index.html:687` | No change. |
| **Stretch 2x / 1/2x** tooltips (`index.html:691-692`) say "Stretch 2x — doubles the lane length." Confusing — does it double the LOOP length (would change the bars setting) or stretch the curve to fill 2x its current span (which means the second half repeats)? Code shows it's the latter. | `index.html:691-692` | "2x — stretch curve to twice its length, looping back if needed." |
| **`Select` tooltip is great** ("...Reverse of Lock — controls only the lanes you pick.") (`index.html:695`) but **the `Select All` tooltip is weaker** ("Select every unlocked lane. Tools then target the whole selection.") (`index.html:694`). The interplay between Select All and Select isn't clear from either. | `index.html:694-695` | "Select All — fill all unlocked lanes into the selection. Click again to clear." |
| **`Lock All` tooltip** (`index.html:696`) doesn't mention the toggle behavior. | `index.html:696` | "Lock All / Unlock All — toggles every lane's lock state." |
| **The `Save Lane` button** has tooltip "Save active lane as preset" (`index.html:652`) — clear. **The `Clear Lane` button** has no tooltip (`index.html:653`). Same row, inconsistent. | `index.html:653` | Add: "Clear curves on the active lane (or selected lanes). Locked lanes are skipped." |
| **Toolbar template buttons (`Sine`, `Pump`, `Glitch`, `Groove`, `Chaos`, `Neuro`)** have NO tooltips. New users see "Glitch" and have no idea what it'll do. | `index.html:637-643` | Add tooltips: "Sine — smooth wave," "Pump — sidechain-style ducking," "Glitch — random on/off bursts," "Groove — sparse → dense → drop → resolve," "Chaos — multi-layer wave noise," "Neuro — drops + stutters + builds across each bar." |
| **`Save Lane`** and **`Apply to Clip`** are different verbs (Save vs Apply) for similar concepts. Producers from Ableton land on "Save" meaning "to disk for later use" and "Apply" meaning "commit to the current clip." Stride uses both correctly but they're never adjacent — the user has to learn each. | n/a | Document in the Guide modal under "Save & Apply." Not a code fix. |

---

## Prioritized fix list

### Quick wins (under 1 hr each)

1. **Fix bars-pill rebuild padding bug** — `canvas.js:170, 172, 207, 208` change `px-3 py-1` to `px-2 py-0.5` (or update `index.html:599-603` to `px-3 py-1`, but compact is better here). Same fix for `tool-btn` at `canvas.js:2271-2272`. — **45 min**
2. **Add tooltips to template buttons** — `index.html:637-643`. Sine/Pump/Glitch/Groove/Chaos/Neuro. — **20 min**
3. **Add tooltip to Clear Lane button** — `index.html:653`. — **5 min**
4. **Standardize section header tracking** — adopt `tracking-[0.2em]` everywhere section headers appear. Currently mixed at `index.html:178, 229` and `canvas.js:3157`. — **15 min**
5. **Standardize section header text size to `text-[9px]`** — currently 8/9 mixed (`index.html:178, 229; canvas.js:3157`). — **15 min**
6. **Fix the empty-state message contradiction** — `index.html:186-188` "Connect M4L device and click Scan" → "Click Scan Mapped to load your rack." — **5 min**
7. **Bump Lock-icon button padding** in sidebar param list from `p-1` to `p-1.5` for 24px touch target — `canvas.js:1356`. — **5 min**
8. **Drop unused font-weight 300** from Google Fonts URL — `index.html:9`. — **2 min**
9. **Match Stretch label/buttons text size** — change `text-[10px]` on the 2x/1/2x buttons to `text-[9px]` to match the rest of Row 2 — `index.html:691-692`. — **5 min**
10. **Recent Generations dock — match label and Clear button text size** — `index.html:772, 773` both to `text-[9px]`. — **3 min**
11. **Always show keyboard shortcuts hint** — remove the `xl:block` gate at `index.html:779`. Optionally truncate the text on small windows. — **5 min**
12. **Add `transition-opacity duration-200` to empty-canvas CTA** — `index.html:746`. — **5 min**

### Medium effort (1-3 hrs each)

1. **Promote `Apply to Clip` visually** — apply the brand orange-red gradient. Make the button ~40% taller. Reduce Save Session/Load to compact icon-buttons in the same column. — **2 hrs** — `index.html:191-208`
2. **Standardize close-button style across all modals** — pick the SVG X in a `w-6 h-6` button. Replace `&times;` glyphs in Save Session, Save Preset, Load Session, Load Preset, Preset Bank, Generate panel, Account panel. — **1.5 hrs**
3. **Standardize modal header style** — pick "feature header" vs "task header" patterns. Apply across Save Session, Save Preset, Load Session, Load Preset, Preset Bank, Generate panel, Account panel, Guide, Connection Help. — **2 hrs**
4. **Standardize modal overlay backgrounds** — `bg-black/75 backdrop-blur-sm` for all modals. — **30 min**
5. **Set explicit z-index layers** — overlays (z-9000), toasts (z-8000), popovers (z-7000). Update all `z-[xxxx]` and `z-[9999]` classes. — **1 hr**
6. **Add category labels to toolbar Row 2** — `Generate:` `Time:` `Selection:` matching the `Shapes:` `Saved:` pattern from Row 1. — **1.5 hrs** (includes wrapping/responsive testing)
7. **Add wheel scroll to multi-view** — `canvas.js sdMultiScrollOffset` += `event.deltaY > 0 ? 1 : -1`. Hook in `setupSdCanvasInteractions`. — **1.5 hrs** (includes scrollbar thumb interactivity)
8. **Add Ctrl/Cmd+Z / Shift+Z keyboard shortcuts** — wire to existing `sdUndo`/`sdRedo`. Also Ctrl+S → Apply, Ctrl+A → Select All. — **2 hrs** (includes platform key detection + Guide doc update)
9. **Drop arbitrary tracking values** — search-and-replace `tracking-[0.3em]` → `tracking-widest`, `tracking-tighter` → `tracking-tight`. Audit visual diff after. — **1 hr**

### Larger refactors (3+ hrs)

1. **Color palette consolidation** — define semantic tokens: PRIMARY (orange), SECONDARY (fuchsia), SUCCESS (emerald), WARNING (amber), DANGER (red), NEUTRAL (zinc). Drop violet/sky/cyan/rose/pink incidental usage; reserve violet for Prism (the metaphor earns it), amber for Bloom (warm = bloom). Unify per-lane curve color to a single brand color. — **6-8 hrs**
2. **Sidebar width refactor** — bump `w-56` → `w-64`, audit slider track length, audit param-list truncation, retest with rack sizes 4/12/24 params. — **3 hrs**
3. **Toolbar restructure** — split Row 1 into "Draw tools" + "Shape templates" + "Saved presets in collapsible drawer." Three rows total (or keep as 2 with overflow menu for Save/Clear). — **4-5 hrs**
4. **Curve-color cycling per lane in multi view** — assign each lane a hue shift (e.g., 360°/N). Setting toggle: "Per-lane colors / Single color." — **3-4 hrs**
5. **Icon-pass on titlebar** — replace text buttons (Guide, Install to Ableton, Account) with icon+tooltip. Cleans up the right side significantly. — **3 hrs**

---

## What's already great

Don't break these:

1. **The fly-orb landing animation on the dock card** — beautiful. The LED border + green flash + yellow→lime orb is delightful.
2. **The Apply Reveal floating card** — the right size, the right amount of "look at me," the countdown bar is a nice touch.
3. **The Connection Help popover** — content-aware (shows different help based on connection state) is excellent UX. Keep this pattern.
4. **The lock-icon design in the multi-view canvas** — the per-lane lock icon drawn directly on the canvas label column is a smart, native-feeling affordance.
5. **The `Heads up` callouts in modals** — the colored borders (red/amber/emerald) with semantic categories ("Important," "Drag the clip, not the rack," "Tip") make the Guide actually scannable.
6. **The Outfit font + dark base** — feels modern without being trendy. Matches DAW conventions while being its own thing.
7. **The Recent Generations dock concept** — having a persistent rail of recent outputs is exactly right for the rapid-iterate workflow.
8. **The empty-canvas CTA** — visible, clear, doesn't block the canvas.
9. **The Multi vs Focus view toggle** — single-purpose, clearly named, well-positioned in the toolbar.
10. **`Scan Mapped` is the primary scan method** — the right call. Removing the multi-step picker for typical use is the right tradeoff.
11. **The template-status pill** in the sidebar (green "Template ready" / red "No template") — perfect at-a-glance state communication.
12. **The Edit slider section using neutral zinc thumbs** — the comment in the code calls out the design rationale (per-slider colors competed with tool-colored generative buttons). This is the kind of considered design that pays off.

---

## Suggested ship order for v1.1.0

Three commits, each independent:

### Commit 1 — Consistency pass (quick wins, low risk)
Items 1-12 from Quick Wins. All cosmetic, no functional change. Visual polish only.
- Padding bug fix (bars + tool buttons)
- Tooltips
- Section header consistency
- Touch-target bumps
- Empty-state copy
- Font-weight URL trim
- Matching label sizes
- Always-show keyboard hints

**Estimated time: 2-3 hours total, ships independently.**

### Commit 2 — Hierarchy + modals
Items 1-5 from Medium Effort. These touch shared modal/header patterns and the most prominent CTA.
- Apply to Clip prominence
- Close-button standardization
- Modal header standardization
- Modal background standardization
- Z-index layers

**Estimated time: 6-8 hours. Independent of Commit 1.**

### Commit 3 — Producer conventions
Items 6-9 from Medium Effort. Adds DAW-native interactions producers will instinctively expect.
- Toolbar category labels
- Wheel-scroll multi-view
- Keyboard shortcuts (Ctrl+Z / Cmd+S / Ctrl+A)
- Tracking value cleanup

**Estimated time: 6 hours. Depends on Commit 2 (toolbar category labels share modal-style consistency rules).**

Larger refactors (color palette, sidebar widening, toolbar restructure, lane colors, titlebar icons) are **v1.2 territory** — they're worth doing but not pre-launch fixes.

---

## Reference: brand inventory

### Distinct text sizes found
- `text-[8px]` — section headers, dock-clear button, badge labels, helper text
- `text-[9px]` — most toolbar buttons, sidebar param items, status text, modal small print
- `text-[10px]` — connection pill, app card metadata, license inputs, modal subtitles
- `text-[11px]` — bars-pill numbers, M4L titlebar, callout body text
- `text-[12px]` — connection help title (only)
- `text-[13px]` — apply-reveal "Ready to drop" text, preset modal header
- `text-xs` — modal section labels (12px) — matches `[12px]`
- `text-sm` — body text in welcome/install modals, button labels
- `text-base` — guide step body, empty-state heading helper text (16px)
- `text-lg` — guide modal header, empty-canvas H2
- `text-xl` — install/welcome modal H1
- `text-2xl` — apply-reveal filename
- `text-4xl` — STRIDE logo on activation gate

**Recommendation**: collapse `text-[8px]/[9px]/[10px]/[11px]/[12px]/[13px]` to a 3-step scale: `text-[9px]` (chrome small), `text-[11px]` (chrome medium), `text-sm` (body). Reserve Tailwind size classes for modal/large-area text only.

### Distinct colors found (Tailwind tokens, not counting opacity variants)
- `zinc` — neutrals (text/bg/border)
- `orange` — primary brand
- `red` — danger / activation gradient pair
- `fuchsia` — secondary brand / Chaos / param-active
- `violet` — Prism / brand accent (overlaps with fuchsia at small sizes)
- `amber` — Bloom / Lock / warnings
- `emerald` — Apply / template-ready / success
- `sky` — Save Session / Load / Time stretch
- `cyan` — Weave (deprecated, retain dormant for code)
- `rose` — Presets

**Recommendation**: drop `cyan` (Weave is dormant), drop `sky` (overlaps with violet/fuchsia for cool tones). Keep 7 tokens max.

### Distinct font weights found
- `font-medium` (500) — 8 uses, mostly form fields
- `font-bold` (700) — 155 uses, default for buttons + body
- `font-black` (900) — 74 uses, all-caps labels + section headers + CTAs
- `font-light` (300) — loaded but unused

**Recommendation**: drop `font-light` from Google Fonts URL. Keep `medium` for body emphasis, `bold` for buttons, `black` only for caps section headers and primary CTAs (rule: `font-black` requires `uppercase`).

### Distinct letter-spacings found
- `tracking-tighter` — 1 use (welcome modal H1, can be replaced with `tracking-tight`)
- `tracking-tight` — 4 uses
- `tracking-wider` — 56 uses
- `tracking-widest` — 51 uses
- `tracking-[0.2em]` — 10 uses (section headers — adopt as standard)
- `tracking-[0.3em]` — 5 uses (cancel — visually identical to widest at 9px)

**Recommendation**: 4-step scale: `tracking-tight` (large display text), `tracking-wider` (mid-density caps), `tracking-widest` (chrome density caps), `tracking-[0.2em]` (section headers only). Drop `tracking-[0.3em]` and `tracking-tighter`.
