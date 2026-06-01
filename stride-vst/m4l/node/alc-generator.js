/**
 * alc-generator.js — Inject automation into template .alc files
 *
 * Flow:
 *   1. User creates a clip in Ableton with configured parameters
 *   2. User drags that clip to ~/Desktop/Stride/template/ folder
 *   3. This module calls alc-injector.js to inject canvas automation
 *   4. Outputs a new .alc the user drags back into Ableton
 *
 * This replicates the web backend's template-based flow locally.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const alcInjector = require('./alc-injector');

const STRIDE_DIR = path.join(os.homedir(), 'Desktop', 'Stride');
const TEMPLATE_DIR = path.join(STRIDE_DIR, 'template');
const REGISTRY_FILE = path.join(TEMPLATE_DIR, 'registry.json');

// ─── Template Registry ──────────────────────────────────

/**
 * Registry maps device names to .alc filenames in the template folder.
 * { "Serum FX": { "filename": "Serum_FX.alc", "saved_at": "2026-04-03T..." }, ... }
 */

function loadRegistry() {
    try {
        if (fs.existsSync(REGISTRY_FILE)) {
            return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveRegistry(registry) {
    if (!fs.existsSync(TEMPLATE_DIR)) {
        fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    }
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Import a .alc file as a template for a given device name.
 * Copies the file into the template folder and registers it.
 */
function importTemplate(deviceName, sourcePath) {
    if (!fs.existsSync(TEMPLATE_DIR)) {
        fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    }

    // Sanitize device name for filename
    const safeName = deviceName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const filename = safeName + '.alc';
    const destPath = path.join(TEMPLATE_DIR, filename);

    // Copy file (overwrite if exists)
    fs.copyFileSync(sourcePath, destPath);

    // Update registry
    const registry = loadRegistry();
    registry[deviceName] = {
        filename,
        saved_at: new Date().toISOString()
    };
    saveRegistry(registry);

    return { deviceName, filename, path: destPath };
}

/**
 * List all registered rack templates.
 */
function listTemplates() {
    const registry = loadRegistry();
    const templates = [];

    for (const [deviceName, info] of Object.entries(registry)) {
        const filePath = path.join(TEMPLATE_DIR, info.filename);
        const exists = fs.existsSync(filePath);
        if (exists) {
            templates.push({
                device_name: deviceName,
                filename: info.filename,
                file_path: filePath,
                saved_at: info.saved_at
            });
        }
    }

    return templates;
}

/**
 * Delete a rack template by device name.
 */
function deleteTemplate(deviceName) {
    const registry = loadRegistry();
    const info = registry[deviceName];
    if (!info) return false;

    // Delete file
    const filePath = path.join(TEMPLATE_DIR, info.filename);
    try { fs.unlinkSync(filePath); } catch (e) {}

    // Remove from registry
    delete registry[deviceName];
    saveRegistry(registry);
    return true;
}

/**
 * Find the template .alc for a specific device name.
 * Falls back to most recent .alc if no registry match.
 */
function findTemplateForDevice(deviceName) {
    const registry = loadRegistry();
    const keys = Object.keys(registry);

    // Exact match in registry
    if (deviceName && registry[deviceName]) {
        const filePath = path.join(TEMPLATE_DIR, registry[deviceName].filename);
        if (fs.existsSync(filePath)) return { path: filePath, matched: true, matchedName: deviceName };
    }

    // No fuzzy matching — exact device name match required
    return null;
}

/**
 * Find the most recent .alc template file in the template folder (fallback).
 */
function findTemplate() {
    if (!fs.existsSync(TEMPLATE_DIR)) {
        fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
        return null;
    }

    let bestFile = null;
    let bestTime = 0;

    try {
        const entries = fs.readdirSync(TEMPLATE_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.alc')) continue;
            if (entry.name.startsWith('.') || entry.name === 'registry.json') continue;
            const full = path.join(TEMPLATE_DIR, entry.name);
            try {
                const stat = fs.statSync(full);
                if (stat.mtimeMs > bestTime) {
                    bestTime = stat.mtimeMs;
                    bestFile = full;
                }
            } catch (e) {}
        }
    } catch (e) {}

    return bestFile;
}

// ─── .alc Generation via Template Injection ──────────────

/**
 * Inject automation into template .alc file.
 *
 * @param {Object} msg - The apply_automation message from the canvas app
 * @param {string} [templatePath] - Optional explicit template path
 * @returns {Object} { success, filePath, filename, paramsWritten, error, needsTemplate }
 */
function createAlcFile(msg, templatePath) {
    // Use explicit path from message if provided
    if (!templatePath && msg.template_path) {
        templatePath = msg.template_path;
        if (templatePath && !fs.existsSync(templatePath)) {
            templatePath = null; // Path doesn't exist, fall through to registry
        }
    }
    const params = msg.parameters || [];
    const clipBars = msg.clip_bars || 4;

    if (params.length === 0) {
        return { success: false, error: 'No parameters to write' };
    }

    const activeParams = params.filter(p => p.points && p.points.length > 0);
    if (activeParams.length === 0) {
        return { success: false, error: 'No parameters have automation points' };
    }

    // Find template .alc — try: explicit path → registry by device name → most recent file
    let templateMatched = true;
    let templateMatchedName = null;
    if (!templatePath) {
        const found = findTemplateForDevice(msg.device_name);
        if (found) {
            templatePath = found.path;
            templateMatched = found.matched;
            templateMatchedName = found.matchedName;
        }
    }
    if (!templatePath) {
        return {
            success: false,
            needsTemplate: true,
            error: 'No template found for "' + (msg.device_name || 'unknown') + '". Import a rack template first.',
        };
    }

    // Pre-flight: read template and validate envelope count matches canvas params
    const totalParamCount = msg.total_param_count || params.length;
    let templateEnvelopeCount;
    try {
        templateEnvelopeCount = alcInjector.countEnvelopes(templatePath);
    } catch (e) {
        return { success: false, error: 'Cannot read template: ' + e.message };
    }

    if (templateEnvelopeCount < totalParamCount) {
        return {
            success: false,
            error: `Template has ${templateEnvelopeCount} envelopes but your rack has ${totalParamCount} params. ` +
                   `Drag a fresh MIDI clip to User Library to create a new template.`,
        };
    }

    // Prepare automation data — envelope_index comes from canvas (position in full param list)
    const autoData = {
        clip_bars: clipBars,
        total_param_count: totalParamCount,
        // Optional: armed pattern notes (Pattern Library v1.2). Forwarded
        // verbatim to alc-injector.injectMidiNotes if present.
        midi_notes: Array.isArray(msg.midi_notes) ? msg.midi_notes : null,
        params: activeParams.map((p, idx) => ({
            name: p.name,
            id: p.id != null ? p.id : null,
            envelope_index: p.envelope_index != null ? p.envelope_index : idx,
            min: p.min != null ? p.min : 0,
            max: p.max != null ? p.max : 1,
            is_log: p.is_log || false,
            points: (p.points || []).map(pt => ({
                time: pt.time,
                value: pt.value,
                curve: pt.curve || 0,
            })),
        })),
    };

    // Generate output path
    if (!fs.existsSync(STRIDE_DIR)) {
        fs.mkdirSync(STRIDE_DIR, { recursive: true });
    }

    const now = new Date();
    const ts = String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    const safeDev = (msg.device_name || 'Rack').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const clipName = msg.clip_name ? msg.clip_name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') : null;
    // Filename always leads with the rack/clip identifier (so the user can tell
    // which rack a file is for at a glance) and ends with "_Stride" for branding.
    //
    // The cap here has to cover BOTH constraints, in this order of strictness:
    //   1. Windows Shell drag-and-drop uses an older Win32 API limited to
    //      MAX_PATH = 260 chars TOTAL path. Ableton's drop handler reads
    //      the file via this API. The file's full path C:\Users\<user>\
    //      Desktop\Stride\<filename> must stay under 260 or drag fails
    //      silently — the .alc writes fine but is undraggable.
    //   2. NTFS / APFS / ext4 enforce a 255-char per-filename component.
    //
    // STRIDE_DIR prefix is ~30 chars for most users, up to ~55 for long
    // usernames. Capping the filename at 200 chars guarantees total path
    // stays under 260 even in the worst-case username scenario.
    // The bars/timestamp/_Stride suffix is preserved verbatim so
    // timestamps and bar lengths are never garbled.
    const MAX_FILENAME = 200;
    const suffix = `_${clipBars}bars_${ts}_Stride.alc`;
    const namePortion = clipName || safeDev;
    const truncatedName = namePortion.length + suffix.length > MAX_FILENAME
        ? namePortion.slice(0, MAX_FILENAME - suffix.length)
        : namePortion;
    const filename = truncatedName + suffix;
    const outputPath = path.join(STRIDE_DIR, filename);

    // Call JS injector directly — no Python dependency
    try {
        const result = alcInjector.injectAlcFile(templatePath, autoData, outputPath);

        // Log debug info
        if (result.debug_lines) {
            result.debug_lines.forEach(line => {
                try { Max.post('Stride inject: ' + line); } catch(e) {}
            });
        }

        if (!result.success) {
            return { success: false, error: result.error || 'Injection failed' };
        }

        return {
            success: true,
            filePath: outputPath,
            filename,
            paramsWritten: result.params_written,
            totalPoints: result.total_points,
            envelopeCount: result.envelope_count || 0,
            requestedCount: result.requested_count || 0,
            skippedCount: result.skipped_count || 0,
            mismatchCount: result.mismatch_count || 0,
            totalParamCount: result.total_param_count || 0,
            templateMatched: templateMatched,
            templateMatchedName: templateMatchedName,
            notesWritten: result.notes_written || 0,
            pitchCount: result.pitch_count || 0,
            noteInjectError: result.note_inject_error || null,
        };
    } catch (e) {
        return { success: false, error: 'Failed to inject automation: ' + e.message };
    }
}

module.exports = {
    createAlcFile,
    findTemplate,
    findTemplateForDevice,
    importTemplate,
    listTemplates,
    deleteTemplate,
    TEMPLATE_DIR,
    STRIDE_DIR,
};
