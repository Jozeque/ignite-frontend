/**
 * quickpanel-preload.js — secure IPC bridge for the QuickPanel window ONLY.
 *
 * Exposes a tiny, READ-ONLY surface (window.strideQuick). The QuickPanel never
 * writes canvas state, never connects to the M4L bridge, and never touches the
 * main app's IPC — so it cannot affect the main canvas, app logic, or StrideQuick.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('strideQuick', {
    // Read the most-recently-saved canvas_*.json (read-only snapshot of the rack).
    loadLatestCanvas: () => ipcRenderer.invoke('quickpanel-get-latest'),

    // Fires when any canvas_*.json changes on disk → panel re-reads (near-live).
    onCanvasChanged: (callback) => ipcRenderer.on('canvas-file-changed', () => callback()),

    // Live lane snapshot pushed from the canvas (canvas → panel, one-way).
    // This is how the panel shows the SAME rack as the canvas, 1:1.
    onState: (callback) => ipcRenderer.on('quickpanel-state', (e, state) => callback(state)),

    // Send an edit command back to the canvas (panel → canvas). The canvas is
    // the single source of truth; results return via onState.
    sendCommand: (cmd) => ipcRenderer.send('quickpanel-command', cmd),

    // In-panel "Pin" toggle (alwaysOnTop) so the window stays visible over Ableton.
    setPin: (pinned) => ipcRenderer.send('quickpanel-set-pin', pinned),

    platform: process.platform
});
