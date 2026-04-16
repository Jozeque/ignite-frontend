/**
 * Stride Canvas — Electron Main Process
 * Creates the main window and manages app lifecycle.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

let mainWindow = null;

// Data directory for local state (canvas saves, license, settings)
const DATA_DIR = path.join(app.getPath('userData'), 'stride-data');

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

    try {
        const res = await fetch(LICENSE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
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
        return {
            valid: false,
            error: `Cannot reach license server: ${netErr.message}`,
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

function startLibraryWatcher() {
    const candidates = [
        path.join(os.homedir(), 'Documents', 'Ableton', 'User Library'),
        path.join(os.homedir(), 'Music', 'Ableton', 'User Library'),
    ];
    const libDir = candidates.find(d => fs.existsSync(d));
    if (!libDir) return;

    let debounceTimer = null;
    let lastDetected = null;

    libWatcher = fs.watch(libDir, { recursive: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.alc') || filename.startsWith('.')) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const fullPath = path.join(libDir, filename);
            if (!fs.existsSync(fullPath)) return;
            if (lastDetected === fullPath) return;
            lastDetected = fullPath;

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('alc-detected', { filename, filePath: fullPath });
            }
        }, 1500);
    });
}

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
