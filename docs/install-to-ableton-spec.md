# Stride — Install-to-Ableton Path Resolution Spec

**Status:** Locked, ready to implement
**Author:** Joe (with research from in-thread debugging session)
**Scope:** Fixes the cluster of path-detection bugs that broke install + watcher + template detection for users with non-standard User Library locations (OneDrive-redirected Documents, custom-relocated libraries, etc.)

---

## Summary

Make "Install to Ableton" a one-click, no-fail operation for the ~95% case, with a discoverable manual picker only when path detection genuinely fails. Eliminate the silent-failure modes that bit the recent customer (keifr) — false-success installs into ghost folders, dead library watchers, and "template not found" with no recovery path.

---

## Goal

| | |
|---|---|
| **Primary goal** | Click "Install to Ableton" → it installs. One click. Across every reasonable Windows / macOS config — including OneDrive-redirected Documents and Ableton libraries relocated to non-standard paths. |
| **Secondary goal** | When detection genuinely can't find the library, fall through to a clear, always-available manual picker — never a dead button or silent fail. |
| **Tertiary goal** | The same path resolution powers the template watcher and template auto-detection — fixing those bugs as a side effect. |

**Non-goals:**

- Replacing the `.alc`-based template flow (that's covered by the separate Bezier API spec).
- Cross-DAW support (Stride is Ableton-only by design).
- Migrating already-installed users — they already work; we just need new installs to be robust.

---

## Root cause recap

Three independent code paths all guess the User Library from the same hardcoded list:

| File | Function | Currently does |
|---|---|---|
| `main.js:470` | `getDefaultUserLibraryPath()` | Drives install detection |
| `main.js:731` | `_findUserLibraryDir()` | Drives the library watcher + trigger-scan |
| Both | (same hardcoded paths) | `~/Documents/Ableton/User Library` and `~/Music/Ableton/User Library` only |

Each function returns `null` independently when the real library is elsewhere — and the consequences differ wildly: install shows an error, the watcher silently never starts, template detection silently fails. The user sees three different surface symptoms of one bug.

Additional sharp edges discovered:

- **Folder picker only appears on `userLibraryNotFound`** (`canvas.js:6187`) — a stale empty `~/Documents/Ableton/User Library` from a prior install causes false success, no picker.
- **`copyDirRecursive`** (`main.js:480`) has no `\\?\` long-path guard — deep `node_modules` under a long OneDrive path can silently partial-copy.
- **No post-install verification** — install reports success even when files didn't land where Ableton actually scans.
- **The watcher does `if (!libDir) return;`** with no surfaced state — user has no idea it's not running.

---

## Resolution architecture — four layers

Path resolution becomes a single function with a clear precedence order. Higher layers override lower ones.

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — M4L self-report (most authoritative)              │
│ StrideLink is INSIDE the User Library. server.js knows the  │
│ real path: path.dirname(__dirname). Reported on every       │
│ WebSocket handshake. Overrides anything else.               │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 — Persisted setting                                  │
│ Whatever path was last confirmed-working (auto or manual).  │
│ Stored in settings.json. Validated for existence on read.   │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Smart detection                                    │
│ Standard paths + OneDrive variants + Ableton prefs parsing. │
│ Validates candidates aren't stale husks before trusting.    │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 4 — Manual picker (last resort)                        │
│ Only shown when Layers 1-3 all came up empty. Once user     │
│ picks, the choice persists in Layer 2 forever.              │
└─────────────────────────────────────────────────────────────┘
```

**Key property:** the layers self-heal. The first time StrideLink connects, Layer 1 takes over and persists to Layer 2. So even if the first-install detection picked the wrong folder (e.g. a stale husk), the moment Ableton loads StrideLink, Stride corrects itself silently. **This single property would have fully fixed the keifr case.**

---

## New module: `stride-vst/app/lib/library-path.js`

A clean, testable resolver module that owns all path logic.

### API surface

```js
const libraryPath = require('./lib/library-path');

// Returns { path: string, source: 'persisted'|'detected'|'manual'|'m4l' } or null
libraryPath.resolve();

// Run detection only (skip persisted cache). Returns string or null.
libraryPath.detect();

// Validate a candidate folder is plausibly a real User Library
libraryPath.validate(candidatePath);

// Persist a confirmed path with its source.
libraryPath.persist(path, source);

// Drop the persisted value (e.g. user clicks "Re-detect").
libraryPath.forget();

// Get the current cached value without re-running detection.
libraryPath.cached();
```

### Detection algorithm

In priority order — first one that validates wins:

1. **Standard paths**
   - Windows: `~/Documents/Ableton/User Library`, `~/Music/Ableton/User Library`
   - macOS: `~/Music/Ableton/User Library`, `~/Documents/Ableton/User Library`

2. **OneDrive variants (Windows)**
   - `~/OneDrive/Documents/Ableton/User Library`
   - Glob: `~/OneDrive - */Documents/Ableton/User Library` (org accounts)
   - Read `OneDriveCommercial` env var if present
   - Read `OneDrive` env var if present (Microsoft sets these reliably when OneDrive is active)

3. **Ableton preferences parsing**
   - Windows: walk `%APPDATA%\Ableton\Live *\Preferences\` for the latest version folder
   - macOS: walk `~/Library/Preferences/Ableton/Live */`
   - Look for the user-library config entry. **Implementation note:** the exact filename/format needs verification against current Live versions during implementation — likely `Library.cfg` or similar. If parsing fails for any reason, skip this layer cleanly.

4. **Last-resort heuristic (skip if 1-3 hit anything plausible)**
   - Scan known parent paths for a folder literally named `User Library` containing valid markers.

### Stale-husk validation

A path passes `validate()` only if **at least one** of these is true:

- Contains `StrideLink.amxd` already (proves Ableton has been pointed here and we've installed before — definitive).
- Contains **2 or more** of: `Presets/`, `Samples/`, `Sounds/`, `Defaults/`, `Templates/`, `Live Recordings/`, `Drums/`, `Grooves/`, `Lessons/`.

This kills the "stale empty `~/Documents/Ableton/User Library` from a long-ago Live install" false positive that previously caused install to silently target the wrong place.

If a candidate fails validation, the resolver logs it (for diagnostics) and continues to the next candidate.

---

## M4L self-report

The killer feature — and the smallest code change.

### In `server.js`

```js
// At the top, before `startServer`:
function computeUserLibraryPath() {
    // server.js installed location: <UserLibrary>/Stride/server.js
    // __dirname is <UserLibrary>/Stride
    const parent = path.dirname(__dirname);
    // Dev guard: in the repo, __dirname is stride-vst/m4l/node — not a library.
    // Only trust the path if the parent is literally "User Library" or
    // contains User Library markers (Presets, Samples, etc.).
    if (path.basename(parent) === 'User Library') return parent;
    const markers = ['Presets', 'Samples', 'Sounds', 'Defaults'];
    const present = markers.filter(m => {
        try { return fs.statSync(path.join(parent, m)).isDirectory(); }
        catch { return false; }
    });
    if (present.length >= 2) return parent;
    return null;
}

// Modify the m4l_ready handshake at server.js:231
sendToApp({
    type: 'm4l_ready',
    version: VERSION,
    user_library_path: computeUserLibraryPath(),
});
```

### In the Electron app

```js
// canvas.js, where m4l_ready is currently handled
strideLink.on('m4l_ready', (msg) => {
    if (msg.user_library_path && window.stride && window.stride.persistLibraryPath) {
        // Tell main to update Layer 2. M4L always wins over anything else.
        window.stride.persistLibraryPath(msg.user_library_path, 'm4l');
    }
});
```

```js
// main.js — new IPC handler
ipcMain.handle('persist-library-path', async (event, { path, source }) => {
    return libraryPath.persist(path, source);
});
```

When `libraryPath.persist()` is called with a new path:
- Updates `settings.json`.
- If the new path differs from the previous one, **re-initializes the watcher** at the new location.

**Effect:** any user who manages to get StrideLink loaded *anywhere* — even via manual copy like keifr — sees the watcher and template detection start working automatically on next launch. No UI, no prompts, just self-healing.

---

## The 1-click install flow

```
User clicks "Install to Ableton"
    │
    ▼
1. Resolve target library
   ├─ libraryPath.cached() → use it (set previously, confirmed)
   ├─ libraryPath.detect() → standard/OneDrive/prefs parsing
   └─ neither → show picker step in same modal (don't bail to a separate flow)
    │
    ▼
2. Copy bundled M4L → <library>/Stride/   (long-path-safe)
    │
    ▼
3. Verify (all three must exist):
   ├─ <library>/Stride/StrideLink.amxd
   ├─ <library>/Stride/server.js
   └─ <library>/Stride/node_modules/ws/   (proves node_modules copied fully)
    │
    ▼
4a. ✓ → Persist path as 'detected' or 'manual', show success, auto-close
4b. ✗ → Show specific error ("Partial copy — check antivirus" /
        "Library moved" / "Path too long"). Offer Retry + Pick Folder.
```

### Happy path UI (≥95% of users)

```
┌──────────────────────────────────────────┐
│  Install to Ableton                       │
│                                          │
│  Stride will install StrideLink to:      │
│  C:\Users\…\Documents\Ableton\User Lib   │
│  (Auto-detected ✓)                       │
│                                          │
│  [ Install to Ableton ]                  │
│  [ Choose a different folder ]           │
└──────────────────────────────────────────┘
```

Single primary button, single click. The "Choose different folder" link is a quiet secondary affordance — visible but de-emphasized. **This is the critical 1-click property the user asked for.**

### Picker fallback UI (rare — Layer 1-3 all failed)

```
┌──────────────────────────────────────────┐
│  Install to Ableton                       │
│                                          │
│  Stride couldn't find your Ableton User  │
│  Library automatically.                  │
│                                          │
│  Open Ableton → right-click User Library │
│  in the browser → Show in Explorer. That │
│  folder is what we need.                 │
│                                          │
│  [ Choose User Library folder… ]         │
└──────────────────────────────────────────┘
```

After they pick, the resolver validates → if it passes, the modal flips back to the happy-path layout with a green "Selected: …" line and the primary Install button. One more click.

### Post-install verification

`installStrideLinkToAbleton` (`main.js:502`) gains a verification step:

```js
const verify = ['StrideLink.amxd', 'server.js', path.join('node_modules', 'ws')];
const missing = verify.filter(v => !fs.existsSync(path.join(target, v)));
if (missing.length > 0) {
    return {
        success: false,
        error: 'install_verification_failed',
        missing,
        targetDir: target,
    };
}
libraryPath.persist(path.dirname(target), 'detected');
return { success: true, targetDir: target };
```

No more "Installed!" toast for a half-copied folder.

### Long-path fix

`copyDirRecursive` (`main.js:480`) adopts the `toLongPath()` helper from `alc-injector.js`:

```js
function copyDirRecursive(src, dest) {
    const longDest = toLongPath(dest);
    fs.mkdirSync(longDest, { recursive: true });
    for (const entry of fs.readdirSync(toLongPath(src), { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d);
        else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(toLongPath(s)), toLongPath(d));
        else fs.copyFileSync(toLongPath(s), toLongPath(d));
    }
}
```

Prevents the silent partial-copy failure mode when `node_modules` nested paths exceed Windows MAX_PATH under a deep OneDrive-prefixed library location.

---

## Watcher + template detection

`_findUserLibraryDir()` is **deleted**. The watcher and trigger-scan call `libraryPath.cached()` instead.

```js
// Replaces startLibraryWatcher() at main.js:760
function startLibraryWatcher() {
    const libDir = libraryPath.cached() || libraryPath.resolve()?.path;
    if (!libDir) {
        log('Library watcher: no library path known yet — will start when one is set');
        return;
    }
    libWatcher = fs.watch(libDir, { recursive: true }, /* ...existing logic... */);
}
```

A new `restartLibraryWatcher()` is called from `libraryPath.persist()` whenever the path changes — so when M4L self-reports a path that wasn't known before, the watcher comes alive without an app restart.

```js
// At the bottom of libraryPath.persist():
const { ipcMain } = require('electron');
ipcMain.emit('library-path-changed', null, { path: newPath });
// main.js subscribes:
ipcMain.on('library-path-changed', () => restartLibraryWatcher());
```

The `trigger-library-scan` IPC handler at `main.js:804` likewise uses `libraryPath.cached()`.

**Net effect on the keifr scenario:** he installs manually → loads StrideLink → M4L reports path → watcher starts → drag a clip into the User Library → auto-imports as template → no more "template not found." Zero manual file picking needed after the first manual M4L install.

---

## Settings UI

A new section in Settings (and surfaced once in the diagnostics popover) makes the path state always-visible.

```
┌─────────────────────────────────────────────────────────┐
│  Ableton User Library                                    │
│                                                          │
│  C:\Users\keifr\Desktop\Plugins\User Library             │
│  Reported by StrideLink ✓                                │
│                                                          │
│  [ Re-detect ]  [ Change folder… ]                       │
└─────────────────────────────────────────────────────────┘
```

Source badges:
- **Reported by StrideLink ✓** (source: `'m4l'`) — highest confidence
- **Auto-detected ✓** (source: `'detected'`)
- **Manually set** (source: `'manual'`)
- **Not configured** (no path) — only when Layer 1-3 came up empty AND user hasn't picked

Clicking **Re-detect** clears the cache and runs Layer 3 detection fresh. Clicking **Change folder…** opens the picker. Both surface clear feedback on success/failure.

---

## Edge cases & failure modes

| Scenario | Behavior |
|---|---|
| Fresh install, library at standard path | Layer 3 finds it on click → 1-click install ✓ |
| Fresh install, OneDrive Documents | Layer 3's OneDrive variants find it → 1-click install ✓ |
| Fresh install, custom library location | Layer 3's prefs parsing finds it → 1-click install ✓; if prefs parsing fails, fall to picker |
| Stale empty `~/Documents/Ableton/User Library` from old Live install | `validate()` rejects it → continue to next candidate → finds real one or falls to picker |
| Re-install (StrideLink already present, Ableton open with it loaded) | `fs.rmSync` may fail (EBUSY/EPERM on Windows). Surface as actionable error: "Close Ableton and try again." |
| Library moves between launches | Persisted path no longer exists → resolver falls back through layers → user prompted only if all fail |
| Multiple Ableton versions installed (Live 11 + Live 12) | Prefs parsing picks the most-recently-modified version folder. User can override via picker. |
| M4L self-report disagrees with persisted setting | M4L wins (authoritative). Silent correction, log entry for diagnostics. |
| User manually picks wrong folder (e.g. `Documents` not `User Library`) | `validate()` rejects → modal shows: "That doesn't look like an Ableton User Library — try again?" with link to the right-click-Show-in-Explorer instructions. |
| Long path on copy | `toLongPath()` handles it. If it still fails, surface error with the failing path so the user knows it's a path-length issue. |
| OneDrive paused / files on-demand | Detection finds the path (OneDrive paths exist as folder entries even when files are sync-paused). Copy may fail if OneDrive blocks writes — surface error. |
| Antivirus blocks the copy | `copyFileSync` throws EPERM. Surface specific error: "Copy blocked — check antivirus settings." |
| Dev mode (running from repo) | `computeUserLibraryPath()` returns null (dev guard). Self-report is just absent from handshake. Detection still works normally. |

---

## Implementation phases

### Phase 1 — Core resolver + persistence (foundation)

**Files:**
- `stride-vst/app/lib/library-path.js` (NEW, ~150 lines)
- `stride-vst/app/main.js` — wire in the new resolver, register `persist-library-path` IPC handler
- `stride-vst/app/preload.js` — expose `persistLibraryPath` and `getCachedLibraryPath` IPC

**Tests:** unit tests for `detect()`, `validate()`, `persist()` round-trips.

**Effort:** 1 day. No UI changes, no behavior change yet for users.

### Phase 2 — M4L self-report

**Files:**
- `stride-vst/m4l/node/server.js` (`computeUserLibraryPath`, update handshake)
- `stride-vst/app/renderer/canvas.js` (handle the new handshake field)

**Tests:** mock-handshake test that the path persists when M4L reports one; dev-mode test that absent self-report doesn't clobber an existing valid path.

**Effort:** 0.5 day. Smallest, highest-leverage change.

### Phase 3 — 1-click install rewrite + verification + long-path

**Files:**
- `stride-vst/app/main.js` — `install-stride-link-to-ableton` handler rewrite (use resolver, verify, long-path), `copyDirRecursive` uses `toLongPath`
- `stride-vst/app/renderer/canvas.js` — `sdShowInstallM4LOverlay` shows detected path + picker affordance, simplified state machine
- `stride-vst/app/renderer/index.html` — install modal layout: detected-path readout + primary "Install" + secondary "Choose different folder"

**Tests:** end-to-end: standard path, OneDrive path, custom path via picker, verification-fail path, retry path.

**Effort:** 1.5 days. Most of the user-visible improvement lands here.

### Phase 4 — Watcher lifecycle + template detection consolidation

**Files:**
- `stride-vst/app/main.js` — replace `_findUserLibraryDir` calls with `libraryPath.cached()`, add `restartLibraryWatcher`, hook into the path-changed event

**Tests:** watcher starts on app launch when path is known; watcher comes alive after M4L self-report when path was previously unknown; trigger-scan uses the same path.

**Effort:** 0.5 day.

### Phase 5 — Settings UI + diagnostics

**Files:**
- `stride-vst/app/renderer/index.html` — Settings panel "Ableton User Library" section
- `stride-vst/app/renderer/canvas.js` — wire up Re-detect, Change folder buttons; surface source badge

**Tests:** UI snapshot for each source variant; Re-detect actually re-runs detection; Change folder validates.

**Effort:** 1 day.

**Total: ~4.5 days of focused work.**

### Suggested commit cadence

One PR per phase. Phase 1 is mergeable on its own (no behavior change). Phase 2 lands the self-report (small, low-risk). Phase 3 ships the user-visible 1-click flow. Phase 4 + 5 polish.

---

## Testing strategy

### Unit tests (Phase 1-2)

- `library-path.test.js`:
  - `detect()` returns standard path when present
  - `detect()` finds OneDrive variant when standard absent
  - `validate()` rejects empty folders
  - `validate()` accepts folders with marker subfolders
  - `validate()` accepts folders containing existing StrideLink install
  - `persist()` survives a round-trip through settings.json
  - `forget()` clears persisted state
- `m4l-self-report.test.js`:
  - `computeUserLibraryPath()` returns parent when basename is `User Library`
  - Returns null in dev-mode-like locations
  - Returns parent when 2+ markers present even with non-standard basename

### Integration tests (Phase 3-4)

- Mock filesystem: install → verify → persist → re-launch → cached path is used
- Mock M4L handshake with `user_library_path` → watcher starts at that path
- Mock M4L handshake disagreeing with persisted → M4L wins, watcher restarts
- Stale husk scenario: standard path is empty husk + OneDrive path is real → detection picks the real one

### Manual QA checklist

1. Fresh Windows VM, standard Documents (no OneDrive): install in one click, StrideLink loads, watcher works ✓
2. Fresh Windows VM with OneDrive Documents redirect: install in one click, library path shows OneDrive path with auto-detected badge ✓
3. Ableton library relocated to Desktop (keifr's case): install in one click via prefs parsing, OR via picker if parsing fails ✓
4. Stale empty `~/Documents/Ableton/User Library` from old Live + real library elsewhere: detection picks the real one ✓
5. Re-install when Ableton is open with StrideLink loaded: clear "Close Ableton" error ✓
6. Manual copy install (current workaround) → load StrideLink → watcher auto-starts via M4L self-report ✓
7. Long path: install into a 4-level-nested OneDrive org path without ENAMETOOLONG ✓
8. macOS standard, macOS with relocated library: same behavior parity ✓

---

## Backwards compatibility

**No user-visible regressions.** Existing users with already-installed StrideLink:

- On next launch, M4L self-reports → settings updated to source `'m4l'`. Invisible.
- Existing template registry at `~/Desktop/Stride/template/` untouched.
- Existing settings.json key names preserved; new `user_library_path` / `user_library_path_source` keys added.

**Rollback:** each phase ships behind no flags but each commit is revertable independently. Phases 1-2 add infrastructure without changing behavior, so even if 3-5 are rolled back, nothing breaks.

---

## File touchpoints (summary)

| Phase | File | Change |
|---|---|---|
| 1 | `stride-vst/app/lib/library-path.js` | **NEW** — resolver module |
| 1 | `stride-vst/app/main.js` | Wire new resolver, add `persist-library-path` IPC |
| 1 | `stride-vst/app/preload.js` | Expose resolver IPC |
| 2 | `stride-vst/m4l/node/server.js` | `computeUserLibraryPath()`, update `m4l_ready` handshake |
| 2 | `stride-vst/app/renderer/canvas.js` | Handle `user_library_path` in `m4l_ready` |
| 3 | `stride-vst/app/main.js` | Rewrite `install-stride-link-to-ableton`, long-path copy, verification |
| 3 | `stride-vst/app/renderer/canvas.js` | Simplified `sdShowInstallM4LOverlay` state machine |
| 3 | `stride-vst/app/renderer/index.html` | Install modal layout |
| 4 | `stride-vst/app/main.js` | Delete `_findUserLibraryDir`, use resolver, watcher restart hook |
| 5 | `stride-vst/app/renderer/index.html` | Settings panel section |
| 5 | `stride-vst/app/renderer/canvas.js` | Re-detect / Change folder UI handlers |
| All | `stride-vst/test/library-path.test.js` | **NEW** — unit + integration tests |

**Lines deleted/replaced (rough estimate):** ~80 lines of duplicated path-guessing logic across `main.js` removed. Replaced by ~150-line cohesive `library-path.js` module + small consumer call-sites.

---

## What this spec doesn't change

To keep scope tight, these adjacent concerns are explicitly out of scope:

- The `.alc` template flow itself (creating templates, exact device-name matching) — already works once the watcher works.
- The "Browse for .alc" manual template import (`canvas.js:1012`) — still useful as a final safety net for users with truly broken setups, no changes needed.
- The `STRIDE_DIR` template-storage location (`~/Desktop/Stride/template/`) — internally consistent between main and M4L, leave it alone.
- Bezier API integration (separate spec lives at `docs/bezier-envelope-api-proposal.md`).
- Mac-side packaging changes (covered by the recent Mac DMG work).

---

## Resume checklist

If implementation pauses and resumes:

1. Re-read this spec.
2. Check which phases are merged (look for `lib/library-path.js` for Phase 1, `computeUserLibraryPath` in server.js for Phase 2, etc.).
3. Continue from the next unmerged phase.
4. Run the manual QA checklist before declaring done — the failure modes are subtle and the wins are invisible to users (one click vs. one click + error + recovery) if you only test the happy path.
