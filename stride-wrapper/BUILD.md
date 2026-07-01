# Building Stride VST3 (Windows + Mac)

You don't build Mac and Windows by hand — GitHub does it. Pushing a version tag
triggers a GitHub Action that compiles both Windows and Mac (Mac is auto-signed +
notarized) and produces two downloadable zips.

- **Repo:** github.com/Jozeque/ignite-frontend
- **Branch:** `stride-vst3-wrapper`
- **Workflow:** GitHub → Actions tab → "Build Stride VST3 (Win + Mac)"

## A) Build the current code (no changes)

1. Repo on GitHub → **Actions** tab.
2. Click **"Build Stride VST3 (Win + Mac)"** on the left.
3. **"Run workflow"** (top-right) → pick branch `stride-vst3-wrapper` → Run.
4. Wait ~10–15 min. When it's green, open the run and scroll to **Artifacts**.

## B) Ship a new version (after code changes)

```bash
# from the repo folder, on the stride-vst3-wrapper branch
git add <the files you changed>
git commit -m "what you changed"
git push origin stride-vst3-wrapper

# tag it — the tag name MUST start with "vst3-v" (that's the build trigger)
git tag vst3-v0.1.0-beta8
git push origin vst3-v0.1.0-beta8
```

Pushing the `vst3-v...` tag automatically starts the build. Bump the number each
time (beta7 → beta8 → …).

## Where the finished builds are

Actions tab → click your run → **Artifacts**:

- **Stride-VST3-Windows** (zip)
- **Stride-VST3-Mac** (zip, signed + notarized)

Each zip has `Stride.vst3` + a README.

## Installing the .vst3 (for testers)

- **Windows:** unzip → put `Stride.vst3` in `C:\Program Files\Common Files\VST3\`
- **Mac:** unzip → put `Stride.vst3` in `/Library/Audio/Plug-Ins/VST3/`
- Fully quit and reopen the DAW (the plugin doesn't hot-reload).

**Notes:** whoever runs this needs push access to the repo and must be logged into
GitHub to download artifacts. The Apple signing keys are stored in the repo's
secrets, so Mac "just works."
