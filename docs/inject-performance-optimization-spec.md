# Direct-Inject Performance — Optimization Specs

**Status:** specced, not implemented. Spec-first per project rules.
**Scope:** `stride-vst/remote_script/StrideInject/` only. No canvas, no `.alc` path, no web app.
**Goal:** cut the 1–2 min drain on a 32-bar / ~30-param inject to seconds, without losing audible fidelity and without re-introducing the bulk-write freeze.

---

## Root cause (confirmed)

The "Inject to Clip" green toast fires *early* (`__init__.py:695`, before the drain). The 1–2 minutes the user watches is the **background drain** in `_flush_chunk`, which writes automation via `env.insert_step` in batches of `CHUNK_SIZE = 400`, yielding `schedule_message(1, …)` between batches.

Two costs stack, both scaling with **total step count = `bars × params × curve-activity`**:

1. **Idle clock.** `schedule_message(1)` → `Task.delay(1)` waits for the *next* Ableton scheduler tick (`DelayTask` counts one `update()` call). That tick is Live's control-surface refresh — on the order of **~100 ms**. With ~337 chunks for a busy 32-bar/30-param inject, that's **~34 s of pure waiting**. `CHUNK_SIZE = 400` is far too small: it pays a ~100 ms tax to do ~10–120 ms of work.
2. **Work clock.** The raw `insert_step` throughput (Boost.Python + envelope mutation). Per-call cost is the one number not yet measured on the user's machine — Spec 5 settles it.

Step count is driven by the probe grid in `_curve.py:adaptive_steps`:
```
grid_points_per_param = clip_bars × 4 ÷ PROBE_BEATS(0.02) = clip_bars × 200
```
→ 8 bars = 1,600 · 16 bars = 3,200 · 32 bars = 6,400 probe points **per param**. This is why time is ~linear in bars (8→16→32 roughly doubles each step).

**Bezier path is permanently out.** Live exposes no writable per-point envelope API (`create_event` not exposed at the Remote Script layer; Extensions SDK re-checked — no curve write). Step-mode is the only path. All specs below optimize step-mode.

---

## Invariants every spec must preserve (verified)

- **Draw-math parity is untouched.** `sample_segment` / `scale_value` / `should_use_log` are the lockstep contract with `shared/rasterizer.js` + `test-rasterizer.js`. No spec here modifies them → canvas render, `.alc` path, and `live.remote~` preview are unaffected.
- **`_busy` state machine.** `_write_inject` rejects a second inject while `_busy` (`__init__.py:584`). Drain sets `_busy=True` at start, `False` at completion. Any writer change keeps this exactly.
- **Early success report stays.** `_ok(...)` is sent before the drain so a big clip never trips the bridge's 120 s timeout (`inject-writer.js:33`). Faster drains only *reduce* total time → no timeout risk.
- **Safety bound holds.** Emitted steps ≤ `clip_len / PROBE_BEATS`. Coarsening the probe *lowers* this ceiling → strictly safer vs the 128k-step freeze it was added to prevent.
- **Routing is orthogonal.** Step count/timing changes never touch `_resolve_param` / `envelope_index` → no relation to the historical misroute bugs (Nigel non-default-library, v1.2.0 sort-misroute).

---

## Spec 5 — Drain timing instrumentation  *(do this FIRST; gates Spec 1)*

**Why first:** it tells us the real `insert_step` per-call cost, which sets the correct batch size for Spec 1 and reveals whether we're idle-bound or work-bound.

**Change** — `__init__.py`:
- Add `import time` to the import block (top of file).
- In `_flush_chunk`, stamp `t0 = time.time()` at entry; on the final chunk (queue drained) log:
  `"StrideInject: drained N steps in Xs (Y steps/s, Z ms/step)"` using an accumulator started in `_write_inject` when the queue is built.

**Blast radius:** logging only. No behavior change. `time` is available in Ableton's CPython.
**Tests:** none needed; manual — read the Max/Live log line after one 32-bar/30-param inject.
**Rollback:** delete the log lines.
**Expected gain:** 0 (diagnostic). Produces the number that makes Spec 1 precise.

---

## Spec 1 — Time-budgeted chunked writer  *(the main win)*

Replace the fixed `CHUNK_SIZE = 400` with a **wall-clock budget**: write `insert_step`s in a tight loop until ~60 ms elapsed (or a hard step cap), then yield once. Self-tuning: fast machines write thousands per tick, slow machines fewer — and the number of ~100 ms idle yields collapses by the same factor.

**Change** — `__init__.py`:
- Replace the `CHUNK_SIZE = 400` constant (line 71) with:
  ```python
  CHUNK_MS_BUDGET = 60     # write insert_steps until ~60ms elapsed, then yield one tick
  CHUNK_MAX_STEPS = 6000   # hard cap per tick — never block the main thread longer than this
  CHUNK_MIN_STEPS = 200    # always make progress even if the clock is coarse
  CHUNK_TIME_CHECK = 200   # only sample time.time() every N steps (cheap)
  ```
- Rewrite the body of `_flush_chunk` (lines 704–733) to loop from `self._write_idx`, breaking when `written >= CHUNK_MAX_STEPS`, or (`written >= CHUNK_MIN_STEPS` and `written % CHUNK_TIME_CHECK == 0` and `time.time() - t0 >= CHUNK_MS_BUDGET/1000`). Keep the *exact* tail behavior: `schedule_message(1, self._flush_chunk)` if more remain, else clear `_busy`/`_write_queue`/`_write_idx`/`_pending` and log "finished".
- Update the comment at lines 60–72 and the `_write_inject` log at 700–701 to describe the budget instead of `CHUNK_SIZE`.

**Why safe / blast radius:**
- `_flush_chunk` is internal to the drain; `CHUNK_SIZE` had no external consumer (grep-confirmed).
- The `_busy` state machine and early-success report are unchanged — only the *batch sizing* inside the loop changes.
- Hard `CHUNK_MAX_STEPS` cap bounds the worst-case main-thread block (the freeze was multi-*second*; 60 ms / ≤6000 steps is well inside safe territory — Live audio runs on a separate real-time thread, so a 60 ms main-thread block delays UI/automation application, not the audio callback).
- Bigger/faster batches can only *reduce* total drain → no bridge-timeout risk.

**Tuning gate:** pick `CHUNK_MS_BUDGET` / `CHUNK_MAX_STEPS` from Spec 5's measured ms/step so one chunk never exceeds ~80 ms.
**Tests:** `test_stride_inject_curve.py` is unaffected (it tests generation, not the writer). Add a tiny pure-logic test for the budget loop's chunk-boundary math if extracted into a helper; otherwise manual: inject 32-bar/30-param, confirm same automation result, far shorter drain, no audio dropout while playing.
**Rollback:** restore `CHUNK_SIZE = 400` and the old `_flush_chunk` body.
**Expected gain:** ~5–10× fewer idle yields. Realistically takes ~75 s → well under ~15 s before any step-count reduction.

---

## Spec 2 — Sub-tick scheduler via `Live.Base.Timer`  *(contingency, higher risk — only if Spec 1 isn't enough)*

If, after Spec 1, Spec 5's numbers show we're *still* idle-bound (drain dominated by the ~100 ms inter-chunk tick rather than `insert_step` work), replace the `schedule_message(1, …)` re-arm in `_flush_chunk` with a `Live.Base.Timer` firing at ~10–20 ms, breaking the 100 ms-per-yield floor.

**Change** — `__init__.py`:
- On init, probe for `Live.Base.Timer` (or `from Live.Base import Timer`); store availability.
- In the drain, if available, schedule the next chunk via a one-shot `Timer(callback=self._flush_chunk, interval=15, repeat=False)` instead of `schedule_message(1, …)`. **Fall back to `schedule_message(1, …)` if the class is absent** so older/other Live builds still work.

**Why this is the risky one (be explicit):**
- `Live.Base.Timer` availability/semantics are **not yet verified on the user's Live build** — unlike Specs 1/3/4/5 which touch only our own constants. Must ship behind a capability probe with a `schedule_message` fallback.
- Timer callbacks run on the main thread (same as `update_display`), so LOM writes are valid and there's no new threading hazard — but reentrancy must be impossible: one-shot timer, re-armed only at the end of `_flush_chunk`, `_busy` still guards external triggers.

**Likely unnecessary:** Spec 1's time-budgeting already amortizes the idle cost across large batches; Spec 2 only matters if `insert_step` turns out to be so cheap that idle dominates even at `CHUNK_MAX_STEPS`. Decide from Spec 5.
**Tests:** capability-probe unit (Timer present → use it; absent → fallback path taken). Manual: drain parity + responsiveness.
**Rollback:** delete the Timer branch; the `schedule_message` fallback is the original behavior.
**Expected gain:** removes residual idle if (and only if) idle-bound after Spec 1.

---

## Spec 3 — Length-adaptive probe granularity

Cut the step count at the source by coarsening `PROBE_BEATS`, ideally *scaled by clip length* so a long clip can't blow up the step count while short clips keep full detail.

**Change** — `__init__.py`:
- Option A (simple): `PROBE_BEATS = 0.02 → 0.03` (≈ 15 ms grid at 120 BPM). ~1.5× fewer probe points.
- Option B (recommended): make it length-adaptive in `_adaptive_step_tuples` — choose `probe = max(0.02, target_length / PROBE_GRID_CAP)` with `PROBE_GRID_CAP ≈ 3000`, so per-param emitted steps are bounded regardless of bars (32 bars → ~0.043 grid; 8 bars stays at 0.02). Keeps short-clip fidelity, bounds long-clip cost.

**Why safe / blast radius:**
- `PROBE_BEATS` has no external consumer (grep-confirmed); not part of the draw-math parity contract → canvas/`.alc`/preview unaffected.
- Coarser probe *lowers* the safety ceiling → strictly safer vs freeze.
- This is a **deliberate fidelity trade**, not a break: max staircase deviation between grid points grows from ~10 ms to ~15–22 ms of curve movement. Inaudible for parameter modulation; a sharp transient is captured one grid-slot later.

**Tests (required):** `test_stride_inject_curve.py` asserts a continuous-fidelity `< 1%` bound at `PROBE = 0.02`. If production probe changes, **update the test to assert at the new value** and re-state the documented guarantee (e.g. ≥99% → ≥98.5%). The bound-vs-grid and flat-collapse tests still hold (grid is just coarser).
**Rollback:** restore `PROBE_BEATS = 0.02`.
**Expected gain:** ~1.5–2× fewer steps → compounds with Spec 1.

---

## Spec 4 — Relaxed emit threshold `EPS_NORM`

Emit a step only when the normalized value has moved more — fewer redundant steps on smooth curves.

**Change** — `__init__.py:68`: `EPS_NORM = 0.0025 → 0.005` (0.5% value deviation).

**Why safe / blast radius:**
- Local constant, no external consumer; not in the parity contract.
- 0.5% deviation on a 0..1-normalized param is below perceptual and below most params' own step quantization. On a fast LFO this can roughly halve emitted steps; on a slow sweep it changes little.

**Tests (required):** same as Spec 3 — the `≤ EPS` grid-fidelity assertion is parametrized by `EPS`; update the test's local `EPS` and re-state the fidelity guarantee (99.75% → 99.5%). Confirm `_dev_cont < 0.01` still passes at the chosen `PROBE`+`EPS` pair (note: Spec 3 *and* Spec 4 together push continuous deviation up — keep one modest if combining, and re-run the test to confirm it stays under the asserted bound).
**Rollback:** restore `EPS_NORM = 0.0025`.
**Expected gain:** up to ~2× fewer steps on busy curves; compounds with Specs 1 & 3.

---

## Spec 6 (optional) — Trigger-pickup latency

Independent of the drain: `_poll` re-arms at `schedule_message(20, self._poll)` (`__init__.py:162`) ≈ **~2 s**, not the "20 ms" the docstring claims. So every inject can wait up to ~2 s just for the Remote Script to *notice* the trigger file.

**Change** — `__init__.py:162`: lower to `schedule_message(5, self._poll)` (~0.5 s) — or implement an idle/active split (poll slowly when idle, fast once a trigger arrives).
**Why safe:** poll cadence only; faster polling = marginally more idle CPU when no work. No correctness impact.
**Tests:** manual — trigger pickup feels snappier.
**Rollback:** restore `20`.
**Expected gain:** removes up to ~1.5 s of perceived start latency per inject.

---

## Recommended sequencing

1. **Spec 5** (measure) — 2 lines, zero risk, produces the number everything else is tuned to.
2. **Spec 1** (time-budgeted writer) — the main win; tune its budget from Spec 5.
3. **Spec 3 + Spec 4** (step-count reduction) — modest, combined, with the test thresholds updated together; re-run `test_stride_inject_curve.py`.
4. **Spec 6** (optional latency polish) — anytime.
5. **Spec 2** (sub-tick timer) — **only if** Spec 5 says we're still idle-bound after Spec 1. Higher risk; capability-probed with fallback.

Expected combined result: 32-bar / 30-param inject from ~1–2 min to a few seconds, fidelity drop imperceptible, freeze-safety preserved or improved.

## Removed from scope

- **Native bezier `create_event`** — Live exposes no writable per-point envelope API; Extensions SDK re-checked, no curve write. Step-mode is the only path. (`_write_bezier` stays dormant as-is; do not delete.)
