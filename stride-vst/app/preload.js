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

    // Window control
    focusWindow: () =>
        ipcRenderer.send('focus-window'),

    // Open URL in system browser
    openExternal: (url) =>
        ipcRenderer.invoke('open-external', url),

    // Open the shipped Guide folder (tutorial videos) in Explorer/Finder
    openGuideFolder: () =>
        ipcRenderer.invoke('open-guide-folder'),

    // Reveal a specific file in Explorer/Finder (highlighted)
    revealInFolder: (filePath) =>
        ipcRenderer.invoke('reveal-in-folder', filePath),

    // Native file drag-out (drag .alc into Ableton)
    startDrag: (filePath) =>
        ipcRenderer.send('ondragstart', filePath),

    // Platform info
    platform: process.platform
});
