/**
 * Stride Canvas — Preload Script
 * Exposes safe IPC bridges to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stride', {
    // Canvas state persistence (local file, not cloud)
    saveCanvasState: (rackId, state) =>
        ipcRenderer.invoke('save-canvas-state', { rackId, state }),
    loadCanvasState: (rackId) =>
        ipcRenderer.invoke('load-canvas-state', rackId),

    // License
    saveLicense: (data) =>
        ipcRenderer.invoke('save-license', data),
    loadLicense: () =>
        ipcRenderer.invoke('load-license'),
    validateLicenseKey: (key) =>
        ipcRenderer.invoke('validate-license-key', key),

    // Settings
    saveSettings: (settings) =>
        ipcRenderer.invoke('save-settings', settings),
    loadSettings: () =>
        ipcRenderer.invoke('load-settings'),

    // App info
    getVersion: () =>
        ipcRenderer.invoke('get-version'),

    // File dialog
    pickAlcFile: () =>
        ipcRenderer.invoke('pick-alc-file'),

    // Template management (local, works without M4L)
    importTemplate: (deviceName, sourcePath) =>
        ipcRenderer.invoke('import-template', { deviceName, sourcePath }),
    listTemplates: () =>
        ipcRenderer.invoke('list-templates'),
    deleteTemplate: (deviceName) =>
        ipcRenderer.invoke('delete-template', deviceName),

    // Sessions (full canvas + template save/load)
    saveSession: (session) =>
        ipcRenderer.invoke('save-session', session),
    listSessions: () =>
        ipcRenderer.invoke('list-sessions'),
    loadSession: (filename) =>
        ipcRenderer.invoke('load-session', filename),
    deleteSession: (filename) =>
        ipcRenderer.invoke('delete-session', filename),

    // User Library watcher events
    onAlcDetected: (callback) =>
        ipcRenderer.on('alc-detected', (event, data) => callback(data)),

    // Trigger a one-shot scan of the User Library for recently-modified .alc
    // files. Used after Scan Mapped so we catch templates dropped while the
    // app was closed (the watcher only fires while listening).
    triggerLibraryScan: () =>
        ipcRenderer.invoke('trigger-library-scan'),

    // Window control
    focusWindow: () =>
        ipcRenderer.send('focus-window'),

    // Open the compact QuickPanel companion window (separate, isolated window)
    openQuickPanel: () =>
        ipcRenderer.send('open-quickpanel'),

    // Mirror the canvas's current lanes to the QuickPanel (one-way push).
    quickPanelPush: (state) =>
        ipcRenderer.send('quickpanel-push-state', state),

    // Compact mode (fused QuickPanel in this same window): shrink + pin / restore.
    setCompactMode: (on) =>
        ipcRenderer.send('set-compact-mode', on),
    setCompactPin: (pinned) =>
        ipcRenderer.send('set-compact-pin', pinned),

    // Receive edit commands FROM the QuickPanel (panel → canvas). The canvas
    // validates + executes them on its real state (single source of truth).
    onQuickPanelCommand: (callback) =>
        ipcRenderer.on('quickpanel-command', (e, cmd) => callback(cmd)),

    // Open URL in system browser
    openExternal: (url) =>
        ipcRenderer.invoke('open-external', url),

    // Open ~/Desktop/Stride folder (all generated .alc files)
    openStrideFolder: () =>
        ipcRenderer.invoke('open-stride-folder'),

    // Generations dock
    saveGenerationThumbnail: (alcPath, dataUrl) =>
        ipcRenderer.invoke('save-generation-thumbnail', alcPath, dataUrl),
    listRecentGenerations: () =>
        ipcRenderer.invoke('list-recent-generations'),
    listAllGenerations: () =>
        ipcRenderer.invoke('list-all-generations'),

    // Open the shipped Guide folder (tutorial videos) in Explorer/Finder
    openGuideFolder: () =>
        ipcRenderer.invoke('open-guide-folder'),

    // Reveal a specific file in Explorer/Finder (highlighted)
    revealInFolder: (filePath) =>
        ipcRenderer.invoke('reveal-in-folder', filePath),

    // StrideLink M4L installer
    checkStrideLinkInstalled: () =>
        ipcRenderer.invoke('check-stride-link-installed'),
    // Stride 2.0: is the StrideInject Remote Script present in the User Library
    // Remote Scripts folder? (Installed, not necessarily enabled.)
    checkStrideInjectInstalled: () =>
        ipcRenderer.invoke('check-strideinject-installed'),
    // Returns { stale, reason, installedVersion?, currentVersion?, targetDir? }
    // Renderer should call this on launch + show a non-dismissible banner if
    // stale === true. See ipcMain handler in main.js for the contract.
    checkStrideLinkStale: () =>
        ipcRenderer.invoke('check-stride-link-stale'),
    installStrideLinkToAbleton: (destDir) =>
        ipcRenderer.invoke('install-stride-link-to-ableton', { destDir }),
    pickUserLibraryFolder: () =>
        ipcRenderer.invoke('pick-user-library-folder'),

    // User Library path resolver (Phase 1 of install-to-ableton-spec.md)
    // Persist a confirmed library path. source ∈ 'detected' | 'manual' | 'm4l'.
    persistLibraryPath: (path, source) =>
        ipcRenderer.invoke('persist-library-path', { path, source }),
    // Read the currently-known library path without re-running detection.
    getCachedLibraryPath: () =>
        ipcRenderer.invoke('get-cached-library-path'),

    // Native file drag-out (drag .alc into Ableton)
    startDrag: (filePath) =>
        ipcRenderer.send('ondragstart', filePath),

    // Pattern Library v1.2 — manifest + .mid byte loaders (CSP blocks
    // fetch() for file:// resources, so the renderer reads pattern
    // assets through IPC). Paths validated server-side.
    loadPatternManifest: () =>
        ipcRenderer.invoke('load-pattern-manifest'),
    loadPatternFile: (relPath) =>
        ipcRenderer.invoke('load-pattern-file', relPath),

    // Platform info
    platform: process.platform
});
