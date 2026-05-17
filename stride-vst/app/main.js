/**
 * Stride Canvas — Electron Main Process
 * Creates the main window and manages app lifecycle.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const libraryPath = require('./lib/library-path');

let mainWindow = null;

// Data directory for local state (canvas saves, license, settings)
const DATA_DIR = path.join(app.getPath('userData'), 'stride-data');

// Wire the User Library resolver to our data directory. It caches its own
// state in <DATA_DIR>/library-path.json — separate from settings.json so the
// renderer's whole-file save-settings IPC can't race with M4L self-report
// writes from main. See docs/install-to-ableton-spec.md.
libraryPath._setDataDir(DATA_DIR);

// Template storage
const STRIDE_DIR = path.join(os.homedir(), 'Desktop', 'Stride');
const TEMPLATE_DIR = path.join(STRIDE_DIR, 'template');
const SESSIONS_DIR = path.join(STRIDE_DIR, 'sessions');
const REGISTRY_FILE = path.join(TEMPLATE_DIR, 'registry.json');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#09090b',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#09090b',
            symbolColor: '#a1a1aa',
            height: 36
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Open DevTools in dev mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ─── IPC Handlers ─────────────────────────────────────────

// Focus window (called from M4L via WebSocket)
ipcMain.on('focus-window', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        // Windows requires alwaysOnTop toggle to steal focus from other apps
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
    }
});

// Save canvas state locally
ipcMain.handle('save-canvas-state', async (event, data) => {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const filePath = path.join(DATA_DIR, `canvas_${data.rackId || 'default'}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data.state, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Load canvas state
ipcMain.handle('load-canvas-state', async (event, rackId) => {
    try {
        const filePath = path.join(DATA_DIR, `canvas_${rackId || 'default'}.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return { success: true, state: data };
        }
        return { success: true, state: null };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Built-in license keys stored as SHA-256 hashes (originals never shipped)
const BUILTIN_KEY_HASHES = {
    '074ac7dc594a379be6e5bdfbaab4d16d5400a19cc2f2af9f8c83e88612efdb62': { tier: 'master', label: 'Master' },
    'f6485506181c07fc0c1513f18de67be3c06828b94d1dd1cdf5bcc1196ad40bb9': { tier: 'ambassador', label: 'Ambassador #1' },
    '44e1f552ff072c6f1da59c74027aec8f10c2dedd9112059b34db01a30f37ed3c': { tier: 'ambassador', label: 'Ambassador #2' },
    '858d56da08c740df788f7897938d9f8059261aae942036eeaac52a0831dcecd4': { tier: 'ambassador', label: 'Ambassador #3' },
    '11837c8ab57deb3cd307fa7f2ad9eeaafdd31d9c7670dcfaa041b13a08d57dfb': { tier: 'ambassador', label: 'Ambassador #4' },
    '1076e40ca485c754409c235f658f7dc4397f2a89320f4b109bbfda3ada531bb2': { tier: 'ambassador', label: 'Ambassador #5' },
    '0333a6cb94d67b15cdd146a08a202de830018d8ea573adf73bb152d790848053': { tier: 'ambassador', label: 'Ambassador #6' },
    'fe9eb70e860352f000a56d9d63fce7effdbf589c05504e4c1d59ee15b1bad6ea': { tier: 'ambassador', label: 'Ambassador #7' },
    '0474f1fb9cf93ab2b53f10ca69b9c095bd84aff6ba06c8f99ae132ac9244ef65': { tier: 'ambassador', label: 'Ambassador #8' },
    '6434242c08eb442f27c68ddb23d471f6e43b01159b73ac2e4f5cc2d1dbf48681': { tier: 'ambassador', label: 'Ambassador #9' },
    '934fb5c23d1285b79f32e0458ac50ad99b1a0a0c67029b2c47edfa8533fb5b54': { tier: 'ambassador', label: 'Ambassador #10' },
    '796d3cf2bb41c7bb5682143ee0b2bf3e0a910e51194b8195c5215a6ad0bcde20': { tier: 'ambassador', label: 'Ambassador #11' },
    'afe99867541df34bce675d0d5a44b585556396cd21438987337ee69bcb2a8a42': { tier: 'ambassador', label: 'Ambassador #12' },
    '36129c1682dd13bfb260b28545a4e4ce03371e425bdd05a3c3fc8b35df414369': { tier: 'ambassador', label: 'Ambassador #13' },
    'e1ba03fa1978ddb39e186a9ed6c65b7969f90d3c2a3badec94e3a96269551a21': { tier: 'ambassador', label: 'Ambassador #14' },
    'a3fcd7166cec022bd629cd408c81999d95b22f99a5111d7665da1ae091f79b7e': { tier: 'ambassador', label: 'Ambassador #15' },
    '967f5404c56687f0fd7cbcdde0d47d694d3cfc0e9a60b55aa207575e63eead7c': { tier: 'ambassador', label: 'Ambassador #16' },
    '1e9f68e8e33345bc9496efb17f0ff60aefa0a410cc99204ec3e7695c7bc07f96': { tier: 'ambassador', label: 'Ambassador #17' },
    '28082797a73f7c2b16c6e625898d4b69617f4602dee9306a1ce10881782de72a': { tier: 'ambassador', label: 'Ambassador #18' },
    'ff2fce5c727259e4b596ed3e9a8a7a89f31c86c65051da1676ae262aefba6474': { tier: 'ambassador', label: 'Ambassador #19' },
    '18bf914c5d3b4fa50b15bd7fdb41af741726359d9d2623186c72aba3d68ef4df': { tier: 'ambassador', label: 'Ambassador #20' },
};

// Backend endpoint that proxies license validation through to Lemon Squeezy.
// Same Cloud Function as everything else — no separate service.
const LICENSE_ENDPOINT = 'https://generate-midi-z3spyrafvq-uc.a.run.app';

// Offline grace period: if the backend can't be reached, trust a cached "valid"
// result for this many days before forcing a fresh online check.
const LICENSE_OFFLINE_GRACE_DAYS = 14;

// Validate a license key.
//   1. Fast path: SHA-256 hash check against the built-in ambassador/master keys.
//      Works offline, zero network, no instance tracking.
//   2. Slow path: POST to the backend, which proxies to LS /licenses/activate
//      (first use, no instance_id) or /licenses/validate (subsequent, with instance_id).
//   3. Offline fallback: if the network fails, trust a recently cached valid result.
ipcMain.handle('validate-license-key', async (event, key) => {
    const upper = (key || '').toUpperCase().trim();
    if (!upper) return { valid: false, error: 'Empty key', builtin: false };

    // --- 1. Built-in ambassador/master hash check ---
    const hash = crypto.createHash('sha256').update(upper).digest('hex');
    const entry = BUILTIN_KEY_HASHES[hash];
    if (entry) {
        return { valid: true, tier: entry.tier, customer_name: entry.label, builtin: true };
    }

    // --- 2. Backend proxy to Lemon Squeezy ---
    // Reuse any previously-stored instance_id so we hit /validate instead of
    // burning another activation slot on /activate.
    let cachedInstanceId = null;
    try {
        const licenseFile = path.join(DATA_DIR, 'license.json');
        if (fs.existsSync(licenseFile)) {
            const cached = JSON.parse(fs.readFileSync(licenseFile, 'utf8'));
            if (cached && cached.key === upper && cached.instance_id) {
                cachedInstanceId = cached.instance_id;
            }
        }
    } catch (e) { /* cache miss is fine */ }

    const instanceName = `Stride on ${os.hostname() || 'unknown-host'}`;
    const body = {
        action: 'validate_license',
        key: upper,
        instance_name: instanceName,
    };
    if (cachedInstanceId) body.instance_id = cachedInstanceId;

    // Timeout the network call so a hung/slow server doesn't freeze the
    // activation button forever. 10s is plenty for LS → Firebase → us.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(LICENSE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const result = await res.json().catch(() => ({}));
        if (result && result.valid) {
            return {
                valid: true,
                tier: 'pro',
                customer_name: result.customer_name || null,
                customer_email: result.customer_email || null,
                product_name: result.product_name || null,
                activation_limit: result.activation_limit || null,
                activation_usage: result.activation_usage || null,
                expires_at: result.expires_at || null,
                instance_id: result.instance_id || cachedInstanceId || null,
                status: result.status || 'active',
                builtin: false,
            };
        }
        return {
            valid: false,
            error: (result && result.error) || 'License key is not valid',
            builtin: false,
        };
    } catch (netErr) {
        clearTimeout(timeoutId);
        // --- 3. Offline fallback: trust recent cached valid result ---
        try {
            const licenseFile = path.join(DATA_DIR, 'license.json');
            if (fs.existsSync(licenseFile)) {
                const cached = JSON.parse(fs.readFileSync(licenseFile, 'utf8'));
                if (cached && cached.key === upper && cached.valid && cached.cached_at) {
                    const ageMs = Date.now() - cached.cached_at;
                    const graceMs = LICENSE_OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
                    if (ageMs < graceMs) {
                        return {
                            ...cached,
                            offline: true,
                            builtin: false,
                        };
                    }
                }
            }
        } catch (e) { /* no cache, fall through */ }
        // AbortError = our own timeout; network errors = DNS/offline/etc.
        const isTimeout = netErr && netErr.name === 'AbortError';
        return {
            valid: false,
            error: isTimeout
                ? 'License server is taking too long to respond. Check your internet connection and try again.'
                : 'License server unreachable. Check your internet connection and try again.',
            builtin: false,
        };
    }
});

// Save license locally (encrypted cache for offline grace)
ipcMain.handle('save-license', async (event, licenseData) => {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const filePath = path.join(DATA_DIR, 'license.json');
        fs.writeFileSync(filePath, JSON.stringify({
            ...licenseData,
            cached_at: Date.now()
        }));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Load cached license
ipcMain.handle('load-license', async () => {
    try {
        const filePath = path.join(DATA_DIR, 'license.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return { success: true, license: data };
        }
        return { success: true, license: null };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Save settings
ipcMain.handle('save-settings', async (event, settings) => {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const filePath = path.join(DATA_DIR, 'settings.json');
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Load settings
ipcMain.handle('load-settings', async () => {
    try {
        const filePath = path.join(DATA_DIR, 'settings.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return { success: true, settings: data };
        }
        return { success: true, settings: {} };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ─── User Library Path Resolver ───────────────────────────
//
// Persist a confirmed User Library path. Used by:
//   • M4L self-report handshake (Phase 2)        — source: 'm4l'
//   • Install success path (Phase 3)             — source: 'detected' or 'manual'
//   • Settings UI "Change folder" (Phase 5)      — source: 'manual'
//   • Settings UI "Re-detect" (Phase 5)          — calls forget then persist
//
// Returns { ok: true, changed: bool } on success, { ok: false, error } on
// failure. `changed` lets the caller decide whether to restart the library
// watcher when the path moves.
ipcMain.handle('persist-library-path', async (event, { path: libPath, source } = {}) => {
    return libraryPath.persist(libPath, source);
});

// Read the currently-known User Library path without re-running detection.
// Returns { path, source } or null.
ipcMain.handle('get-cached-library-path', async () => {
    const p = libraryPath.cached();
    if (!p) return null;
    return { path: p, source: libraryPath.cachedSource() };
});

// Open the shipped Guide folder (where the tutorial videos live) in Explorer/Finder.
// Resolves the folder location differently in dev vs packaged builds.
function _locateGuideFolder() {
    // Packaged on Windows:  <Stride>/Stride.exe         → <Stride>/Guide
    // Packaged on macOS:    <Stride>/Stride.app/Contents/MacOS/Stride → <Stride>/Guide
    // Dev (npm start):      stride-vst/app/             → stride-vst/Guide (may not exist)
    const candidates = [];
    const exeDir = path.dirname(process.execPath);
    if (process.platform === 'win32') {
        candidates.push(path.join(exeDir, 'Guide'));
    } else if (process.platform === 'darwin') {
        candidates.push(path.join(exeDir, '..', '..', '..', 'Guide'));
    }
    // Dev-mode fallbacks (when running via `npm start`)
    candidates.push(path.join(__dirname, '..', '..', 'Guide'));
    candidates.push(path.join(__dirname, '..', 'Guide'));
    for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch (e) {}
    }
    return null;
}

// Save a thumbnail PNG next to a generated .alc file. The renderer
// captures the canvas at gen-time and sends a data URL; we just decode
// and write to disk. The dock reads sibling .png files via list-recent-generations.
ipcMain.handle('save-generation-thumbnail', async (event, alcPath, dataUrl) => {
    try {
        if (!alcPath || typeof alcPath !== 'string' || !dataUrl) return { success: false };
        const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
        if (!m) return { success: false, error: 'Invalid PNG data URL' };
        const buf = Buffer.from(m[1], 'base64');
        const pngPath = alcPath.replace(/\.alc$/i, '.png');
        fs.writeFileSync(pngPath, buf);
        return { success: true, pngPath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// List the 5 most recently generated .alc files in ~/Desktop/Stride/.
// Pairs each with its sibling thumbnail PNG when present. Powers the dock.
ipcMain.handle('list-recent-generations', async () => {
    try {
        if (!fs.existsSync(STRIDE_DIR)) return [];
        const entries = fs.readdirSync(STRIDE_DIR, { withFileTypes: true })
            .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.alc'))
            .map(d => {
                const alcPath = path.join(STRIDE_DIR, d.name);
                let mtimeMs = 0;
                try { mtimeMs = fs.statSync(alcPath).mtimeMs; } catch (e) {}
                const pngPath = alcPath.replace(/\.alc$/i, '.png');
                return {
                    name: d.name,
                    alcPath,
                    pngPath: fs.existsSync(pngPath) ? pngPath : null,
                    mtimeMs,
                };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
            .slice(0, 5);
        return entries;
    } catch (e) {
        return [];
    }
});

// Open the ~/Desktop/Stride folder (all generated .alc files live here)
ipcMain.handle('open-stride-folder', async () => {
    try {
        if (!fs.existsSync(STRIDE_DIR)) fs.mkdirSync(STRIDE_DIR, { recursive: true });
        const err = await shell.openPath(STRIDE_DIR);
        if (err) return { success: false, error: err };
        return { success: true, path: STRIDE_DIR };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-guide-folder', async () => {
    try {
        const guideDir = _locateGuideFolder();
        if (!guideDir) {
            return { success: false, error: 'Guide folder not found in the distribution' };
        }
        const err = await shell.openPath(guideDir);
        if (err) return { success: false, error: err };
        return { success: true, path: guideDir };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Reveal a specific file in Explorer/Finder (highlighted, folder opens automatically).
// Used by the Apply-to-Clip success toast's "Open folder" button.
ipcMain.handle('reveal-in-folder', async (event, filePath) => {
    try {
        if (!filePath || typeof filePath !== 'string') {
            return { success: false, error: 'No file path provided' };
        }
        if (!fs.existsSync(filePath)) {
            return { success: false, error: 'File no longer exists' };
        }
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Native file drag-out — lets the user drag a .alc file from the Stride
// UI directly into Ableton (or any other app that accepts file drops).
// Electron's webContents.startDrag() initiates a native OS drag event.
ipcMain.on('ondragstart', (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return;
    if (!fs.existsSync(filePath)) {
        console.log('[Drag] File not found:', filePath);
        return;
    }
    // Use the app icon as drag ghost — guaranteed valid nativeImage
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    let icon;
    if (fs.existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    } else {
        // Fallback: create a tiny valid PNG programmatically
        icon = nativeImage.createEmpty();
    }
    try {
        event.sender.startDrag({ file: filePath, icon });
    } catch (e) {
        console.log('[Drag] startDrag failed:', e.message);
    }
});

// Open URL in system browser
ipcMain.handle('open-external', async (event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
        await shell.openExternal(url);
    }
});

// Get app version
ipcMain.handle('get-version', () => {
    return app.getVersion();
});

// ─── StrideLink M4L Installer ─────────────────────────────
//
// The M4L folder (StrideLink.amxd + server.js + node_modules + siblings)
// is bundled inside the Stride app. The user invokes this once from the
// welcome modal or Settings, and we copy the whole folder into their
// Ableton User Library so the device shows up in Ableton's browser and
// the node.script next to it can see its siblings at runtime.
//
// Layout after install:
//   <User Library>/Stride/
//     StrideLink.amxd
//     server.js
//     scanner.js
//     ...
//     node_modules/
//
// User Library defaults:
//   macOS:   ~/Music/Ableton/User Library/
//   Windows: ~/Documents/Ableton/User Library/
// If neither is found the renderer opens a folder picker as fallback.

// Resolve the bundled M4L payload. Returns
//   { primaryDir, extras: [absoluteFilePaths] }
// or null if no source can be found.
//
// Three layouts to support:
//   1. <Stride.exe dir>/M4L/            — legacy Windows portable zip
//                                         (Stride_vX.X.X_Windows.zip). M4L
//                                         sits as a SIBLING of Stride.exe,
//                                         not inside resources/.
//   2. <Resources>/M4L/                 — Mac signed/notarized .app, and
//                                         any future build (Win or Mac)
//                                         that uses extraResources to put
//                                         M4L into the resources folder.
//                                         Single flat layout: StrideLink
//                                         + .js + node_modules/ together.
//   3. Dev mode (repo split layout)     — StrideLink.amxd at m4l/ root,
//                                         server.js + node_modules under
//                                         m4l/node/. Treated as a flat
//                                         "primaryDir = m4l/node + extras
//                                         = [m4l/StrideLink.amxd]" so the
//                                         installer reassembles the flat
//                                         layout at the target.
//
// Resolution priority: sibling-of-exe (1) → resources (2) → dev (3). Sibling
// wins because legacy zip users have a literal M4L folder next to Stride.exe
// and we want to honor that even if process.resourcesPath also resolves to
// a (possibly empty) directory.
function getBundledM4LSource() {
    // 1. Legacy portable zip — M4L sibling of the executable
    try {
        const exeDir = path.dirname(process.execPath || '');
        if (exeDir) {
            const sibling = path.join(exeDir, 'M4L');
            if (fs.existsSync(sibling)) {
                return { primaryDir: sibling, extras: [] };
            }
        }
    } catch (e) { /* fall through to next check */ }

    // 2. Mac signed app or Win build with extraResources — M4L in resources/
    const packaged = process.resourcesPath
        ? path.join(process.resourcesPath, 'M4L')
        : null;
    if (packaged && fs.existsSync(packaged)) {
        return { primaryDir: packaged, extras: [] };
    }

    // 3. Dev mode — repo split layout
    const devNodeDir = path.join(__dirname, '..', 'm4l', 'node');
    const devAmxd = path.join(__dirname, '..', 'm4l', 'StrideLink.amxd');
    if (fs.existsSync(devNodeDir)) {
        const extras = fs.existsSync(devAmxd) ? [devAmxd] : [];
        return { primaryDir: devNodeDir, extras };
    }
    return null;
}

function getDefaultUserLibraryPath() {
    const home = os.homedir();
    const candidates = process.platform === 'darwin'
        ? [path.join(home, 'Music', 'Ableton', 'User Library'),
           path.join(home, 'Documents', 'Ableton', 'User Library')]
        : [path.join(home, 'Documents', 'Ableton', 'User Library'),
           path.join(home, 'Music', 'Ableton', 'User Library')];
    return candidates.find(p => fs.existsSync(p)) || null;
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d);
        else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
        else fs.copyFileSync(s, d);
    }
}

// Report whether StrideLink is already present at the conventional location.
// Renderer uses this to decide whether to show the first-launch prompt.
ipcMain.handle('check-stride-link-installed', async () => {
    const lib = getDefaultUserLibraryPath();
    if (!lib) return { installed: false, libraryFound: false };
    const target = path.join(lib, 'Stride', 'StrideLink.amxd');
    return { installed: fs.existsSync(target), libraryFound: true, targetDir: path.join(lib, 'Stride') };
});

// Critical files we expect inside the M4L bundle. Both pre-flight (source)
// and post-copy (target) verification check for these three — if any are
// missing on either side, we surface a structured error instead of
// reporting a false success. Keeps the install honest in the face of:
//   • empty/incomplete bundled M4L payload (build pipeline regression)
//   • macOS quarantine / app-translocation making the source unreadable
//   • antivirus blocking individual file copies mid-loop
//   • OneDrive sync paused / target write partially failed
//   • any other reason copyDirRecursive silently produces an empty target
// See docs/install-to-ableton-spec.md and the keifr + macOS Sequoia
// customer cases that motivated this guard.
const installVerify = require('./lib/install-verify');
const INSTALL_REQUIRED_FILES = installVerify.INSTALL_REQUIRED_FILES;
const checkInstallFiles = installVerify.checkInstallFiles;

// Copy the bundled M4L folder into the user's Ableton User Library.
// `destDir` is optional — if omitted we use the detected User Library.
ipcMain.handle('install-stride-link-to-ableton', async (event, { destDir } = {}) => {
    try {
        const sourceInfo = getBundledM4LSource();
        if (!sourceInfo) {
            return { success: false, error: 'Bundled M4L folder not found. Please reinstall Stride.' };
        }
        const { primaryDir, extras } = sourceInfo;

        // Pre-flight: confirm the bundle (primary dir + extras combined)
        // has what we're about to copy. The "extras" path matters in dev
        // mode where StrideLink.amxd sits as a sibling of m4l/node/ rather
        // than inside it — without checking extras we'd false-positive
        // "missing StrideLink.amxd" on every dev install.
        const sourceMissing = installVerify.checkInstallSource(primaryDir, extras);
        if (sourceMissing.length > 0) {
            return {
                success: false,
                error: 'source_bundle_incomplete',
                message: `Stride's M4L bundle is missing critical files (${sourceMissing.join(', ')}). The Stride install itself may be corrupt or blocked by antivirus/quarantine — try re-downloading Stride.`,
                missing: sourceMissing,
                sourceDir: primaryDir,
            };
        }

        let target;
        if (destDir && typeof destDir === 'string') {
            target = path.join(destDir, 'Stride');
        } else {
            const lib = getDefaultUserLibraryPath();
            if (!lib) return { success: false, error: 'userLibraryNotFound' };
            target = path.join(lib, 'Stride');
        }

        // "Already installed" short-circuit. If the target exists AND every
        // required file is already there AND the install's version marker
        // matches the current Stride version, return success WITHOUT
        // touching anything. Touching would EBUSY on Windows if Ableton has
        // the .js files locked through node.exe.
        //
        // Version-aware: a stale or missing marker means the user just
        // updated Stride and the User Library copy is from an older build.
        // We fall through to the normal rm + copy so the new files actually
        // land. Without this, "Install to Ableton" after a Stride update
        // would silently skip the copy and the user would run new Stride.exe
        // with stale M4L code — exactly the "ship-with-delete-step" gotcha
        // we're fixing.
        const currentVersion = app.getVersion();
        if (fs.existsSync(target) && checkInstallFiles(target).length === 0) {
            const installedVersion = installVerify.readInstallMarker(target);
            if (installedVersion && installedVersion === currentVersion) {
                return {
                    success: true,
                    targetDir: target,
                    alreadyInstalled: true,
                    version: currentVersion,
                };
            }
            // Marker missing (pre-versioning install) or stale (older build
            // still in User Library) → fall through to fresh copy below.
        }

        // Partial install or fresh target — try to clear and copy fresh.
        // Wrap rmSync because EBUSY/EPERM is the most common Windows
        // failure mode here (Ableton has files locked). Surface it as a
        // clean structured error instead of raw fs exception text.
        if (fs.existsSync(target)) {
            try {
                fs.rmSync(target, { recursive: true, force: true });
            } catch (e) {
                const lockedRe = /EBUSY|EPERM|resource busy|locked/i;
                if (e && (lockedRe.test(e.code || '') || lockedRe.test(e.message || ''))) {
                    return {
                        success: false,
                        error: 'target_locked',
                        message: 'Stride is already installed but the files are locked — close Ableton (which has StrideLink loaded) and try again.',
                        targetDir: target,
                    };
                }
                throw e;
            }
        }
        copyDirRecursive(primaryDir, target);
        // Copy any extras (e.g. StrideLink.amxd in dev) into the target's
        // root so the final layout matches what a packaged install produces.
        for (const extraPath of extras) {
            try {
                fs.copyFileSync(extraPath, path.join(target, path.basename(extraPath)));
            } catch (e) {
                // Surface as a verification failure below — keeps one error path.
            }
        }

        // Post-copy verify: confirm the critical files actually landed.
        // copyDirRecursive can succeed silently with zero files copied
        // (empty source dir, or readdirSync returning [] for any reason).
        // Never report success unless the files are demonstrably present.
        const targetMissing = checkInstallFiles(target);
        if (targetMissing.length > 0) {
            return {
                success: false,
                error: 'install_verification_failed',
                message: `Install ran but ${targetMissing.length} critical file(s) didn't land at ${target}. Try a different folder via "Choose folder manually", or copy the M4L folder by hand.`,
                missing: targetMissing,
                targetDir: target,
            };
        }

        // Stamp the install with the current Stride version. Best-effort
        // — if the marker write fails (read-only fs, quota, etc.) we still
        // report install success; worst case the next click does a redundant
        // fresh copy. See lib/install-verify.js for the read/write helpers.
        installVerify.writeInstallMarker(target, currentVersion);

        return { success: true, targetDir: target, version: currentVersion };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Let the renderer open a folder picker for a custom User Library path.
ipcMain.handle('pick-user-library-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select your Ableton User Library folder",
        properties: ['openDirectory'],
        defaultPath: os.homedir()
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

// ─── Executable Path Registry ─────────────────────────────
//
// Written on every launch so the M4L server (running inside Ableton's Max
// device, which has no idea where Stride lives) can find the Stride
// executable no matter where the user put it. See m4l/node/server.js
// `findStrideExecutable()` for the read side.

function writeAppPathMarker() {
    try {
        const marker = path.join(DATA_DIR, 'app-path.txt');
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        let execPath = process.execPath;

        // Detect dev mode — true when Electron was launched with `electron .`
        // or `npm start` pointing at a source directory rather than a packaged
        // .app / .exe. In that case, process.execPath is the electron.exe
        // binary itself, which if re-launched alone just shows the default
        // "To run a local app" window.
        const isDev = !!process.defaultApp;

        if (process.platform === 'darwin') {
            const appIdx = execPath.indexOf('.app/');
            if (appIdx > 0) execPath = execPath.slice(0, appIdx + 4);
        }

        // Format:
        //   Line 1: absolute path to the executable (Stride.exe / Stride.app
        //           in prod, electron.exe in dev)
        //   Line 2 (dev only): MODE=dev plus the app source directory so the
        //           M4L locator can launch electron.exe with the right arg
        const lines = [execPath];
        if (isDev) {
            lines.push(`MODE=dev`);
            lines.push(`APP_DIR=${app.getAppPath()}`);
        }
        fs.writeFileSync(marker, lines.join('\n'), 'utf8');
    } catch (e) {
        console.log('[Stride] Could not write app-path marker:', e.message);
    }
}

// Open file dialog to pick .alc files
ipcMain.handle('pick-alc-file', async () => {
    // Ableton's User Library default location differs by platform:
    //   Windows: ~/Documents/Ableton/User Library/
    //   macOS:   ~/Music/Ableton/User Library/
    const home = os.homedir();
    const libCandidates = process.platform === 'darwin'
        ? [path.join(home, 'Music', 'Ableton', 'User Library'),
           path.join(home, 'Documents', 'Ableton', 'User Library')]
        : [path.join(home, 'Documents', 'Ableton', 'User Library'),
           path.join(home, 'Music', 'Ableton', 'User Library')];
    const defaultPath = libCandidates.find(p => fs.existsSync(p)) || libCandidates[0];
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select .alc template file',
        filters: [{ name: 'Ableton Clip', extensions: ['alc'] }],
        properties: ['openFile'],
        defaultPath
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

// ─── Template Registry ────────────────────────────────────

function loadRegistry() {
    try {
        if (fs.existsSync(REGISTRY_FILE)) {
            return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveRegistry(registry) {
    if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

ipcMain.handle('import-template', async (event, { deviceName, sourcePath }) => {
    try {
        if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
        const safeName = deviceName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
        const filename = safeName + '.alc';
        const destPath = path.join(TEMPLATE_DIR, filename);
        fs.copyFileSync(sourcePath, destPath);

        const registry = loadRegistry();
        registry[deviceName] = { filename, saved_at: new Date().toISOString() };
        saveRegistry(registry);

        return { success: true, deviceName, filename, filePath: destPath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('list-templates', async () => {
    const registry = loadRegistry();
    const templates = [];
    for (const [deviceName, info] of Object.entries(registry)) {
        const filePath = path.join(TEMPLATE_DIR, info.filename);
        if (fs.existsSync(filePath)) {
            templates.push({
                device_name: deviceName,
                filename: info.filename,
                file_path: filePath,
                saved_at: info.saved_at
            });
        }
    }
    return templates;
});

ipcMain.handle('delete-template', async (event, deviceName) => {
    const registry = loadRegistry();
    const info = registry[deviceName];
    if (info) {
        try { fs.unlinkSync(path.join(TEMPLATE_DIR, info.filename)); } catch (e) {}
        delete registry[deviceName];
        saveRegistry(registry);
    }
    return { success: true };
});

// ─── Sessions (Save/Load full canvas + template state) ────

ipcMain.handle('save-session', async (event, session) => {
    try {
        if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        const safeName = (session.name || 'Untitled').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
        const filename = safeName + '.json';
        fs.writeFileSync(path.join(SESSIONS_DIR, filename), JSON.stringify(session, null, 2));
        return { success: true, filename };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('list-sessions', async () => {
    try {
        if (!fs.existsSync(SESSIONS_DIR)) return [];
        const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
        return files.map(f => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
                return {
                    filename: f,
                    name: data.name || f.replace('.json', ''),
                    device_name: data.device_name || '',
                    template_filename: data.template_filename || '',
                    param_count: (data.params || []).length,
                    clip_bars: data.clip_bars || 4,
                    saved_at: data.saved_at || '',
                };
            } catch (e) { return null; }
        }).filter(Boolean).sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
    } catch (e) {
        return [];
    }
});

ipcMain.handle('load-session', async (event, filename) => {
    try {
        const filePath = path.join(SESSIONS_DIR, filename);
        if (!fs.existsSync(filePath)) return { success: false, error: 'Session file not found' };
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Check if template still exists
        const templatePath = data.template_filename ? path.join(TEMPLATE_DIR, data.template_filename) : null;
        data._template_exists = templatePath && fs.existsSync(templatePath);
        data._template_path = templatePath;
        return { success: true, session: data };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-session', async (event, filename) => {
    try {
        const filePath = path.join(SESSIONS_DIR, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ─── User Library Watcher ─────────────────────────────────

let libWatcher = null;

// Resolve the user's Ableton User Library, ordering candidates by platform.
// Mac defaults to ~/Music/...; Windows to ~/Documents/.... Some Mac users have
// a leftover ~/Documents/Ableton/ from Live auto-create or older versions —
// if we check Documents first we lock onto the wrong path and never see drops
// to their real Music-based library.
function _findUserLibraryDir() {
    const home = os.homedir();
    const candidates = process.platform === 'darwin'
        ? [path.join(home, 'Music', 'Ableton', 'User Library'),
           path.join(home, 'Documents', 'Ableton', 'User Library')]
        : [path.join(home, 'Documents', 'Ableton', 'User Library'),
           path.join(home, 'Music', 'Ableton', 'User Library')];
    return candidates.find(d => fs.existsSync(d)) || null;
}

// Walk a directory tree, calling onAlc(fullPath) for every .alc file found.
// Skips Stride's own User Library/Stride/ folder so we don't surface our
// own templates as "new drops" on subsequent scans.
function _walkAlcFiles(dir, onAlc) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'Stride') continue;
            _walkAlcFiles(fullPath, onAlc);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.alc')) {
            onAlc(fullPath);
        }
    }
}

function startLibraryWatcher() {
    const libDir = _findUserLibraryDir();
    if (!libDir) return;

    let debounceTimer = null;
    let lastDetected = null;

    // recursive: true catches drops into any subfolder of User Library —
    // power users organize into Sounds/, Drums/, custom-pack folders, etc.
    // and never drop into the bare root. Supported on macOS (FSEvents) and
    // Windows (ReadDirectoryChangesW). The reported `filename` may include a
    // relative subpath, so checks/event payload use path.basename().
    libWatcher = fs.watch(libDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const base = path.basename(filename);
        if (!base.endsWith('.alc') || base.startsWith('.')) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const fullPath = path.join(libDir, filename);
            if (!fs.existsSync(fullPath)) return;
            // Dedupe by path + mtime so a drag-replace (same filename, fresh
            // mtime) is treated as a new event. Path-only dedupe silently
            // ate the second drag, which looked like a regression to the user.
            let mtime = 0;
            try { mtime = fs.statSync(fullPath).mtimeMs; } catch (e) {}
            const key = `${fullPath}|${mtime}`;
            if (lastDetected === key) return;
            lastDetected = key;

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('alc-detected', { filename: base, filePath: fullPath });
            }
        }, 1500);
    });
}

// Fired by the renderer right after Scan Mapped completes. Catches the case
// where a user drags a clip to User Library BEFORE opening Stride — the
// watcher only sees events while listening, so prior drops are invisible.
// We pick the most-recently-modified .alc within a 15-min window and fire
// the same alc-detected event the watcher uses, so the renderer's existing
// import flow handles it identically. Returning null means "no recent drop";
// the renderer just shows its usual "no template" state.
const ALC_RECENCY_MS = 15 * 60 * 1000;
ipcMain.handle('trigger-library-scan', async () => {
    const libDir = _findUserLibraryDir();
    if (!libDir) return { found: false };
    const cutoff = Date.now() - ALC_RECENCY_MS;
    let best = null;
    _walkAlcFiles(libDir, (alcPath) => {
        try {
            const mtimeMs = fs.statSync(alcPath).mtimeMs;
            if (mtimeMs >= cutoff && (!best || mtimeMs > best.mtimeMs)) {
                best = { alcPath, mtimeMs };
            }
        } catch (e) {}
    });
    if (!best) return { found: false };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('alc-detected', {
            filename: path.basename(best.alcPath),
            filePath: best.alcPath,
        });
    }
    return { found: true, filename: path.basename(best.alcPath), filePath: best.alcPath };
});

// ─── App Lifecycle ────────────────────────────────────────

// ─── Single Instance Lock ────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        writeAppPathMarker();
        createWindow();
        startLibraryWatcher();
    });

    app.on('window-all-closed', () => {
        app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
}
