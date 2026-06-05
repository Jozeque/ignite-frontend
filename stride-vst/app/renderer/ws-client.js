/**
 * Stride Canvas — WebSocket Client
 * Connects to the M4L device's WebSocket server on localhost:9100
 */

class StrideLink {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.handlers = {};
        this.version = '1.0.0';
    }

    connect() {
        if (this.ws && this.ws.readyState <= 1) return;

        try {
            this.ws = new WebSocket('ws://localhost:9100');
        } catch (e) {
            this._onDisconnect();
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            clearTimeout(this.reconnectTimer);
            this.send({ type: 'app_ready', version: this.version });
            this._emit('connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                // The IPC bridge is exposed as `window.stride` (preload.js).
                // The previous reference to `window.electronAPI` was a stale
                // name from an earlier rename; it silently dropped focus
                // requests when the user pressed Launch while Stride was
                // already running but minimized/hidden, making the launch
                // button look broken until they removed and re-added the M4L
                // device.
                if (msg.type === 'focus_window' && window.stride && window.stride.focusWindow) {
                    window.stride.focusWindow();
                }
                this._emit(msg.type, msg);
            } catch (e) {
                console.warn('Stride Link: Invalid message', e);
            }
        };

        this.ws.onclose = () => {
            this._onDisconnect();
        };

        this.ws.onerror = () => {
            // onclose will fire after this
        };
    }

    disconnect() {
        clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    send(msg) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(msg));
            return true;
        }
        return false;
    }

    // ─── Commands ──────────────────────────────────────

    requestScan() {
        return this.send({ type: 'request_scan' });
    }

    requestScanMapped() {
        return this.send({ type: 'request_scan_mapped' });
    }

    applyAutomation(params, clipBars, deviceName, templatePath, createIfMissing = true, clipName = null, midiNotes = null) {
        return this.send({
            type: 'apply_automation',
            create_clip_if_missing: createIfMissing,
            clip_bars: clipBars,
            device_name: deviceName || null,
            template_path: templatePath || null,
            clip_name: clipName || null,
            total_param_count: params._totalParamCount || params.length,
            // Pattern Library v1.2: if user has armed a pattern, its
            // pre-expanded notes ride along on the same apply message.
            // Null/empty = curves-only flow (the v1.1 default, unchanged).
            midi_notes: Array.isArray(midiNotes) && midiNotes.length > 0 ? midiNotes : null,
            parameters: params.map(p => ({
                id: p.id,
                name: p.name,
                _path: p._path || null,
                min: p.min != null ? p.min : 0,
                max: p.max != null ? p.max : 1,
                is_log: p.is_log || false,
                envelope_index: p.envelope_index != null ? p.envelope_index : null,
                points: (p.points || []).map(pt => ({
                    time: pt.time,
                    value: pt.value,
                    curve: pt.curve || 0
                }))
            }))
        });
    }

    /**
     * v.next direct-inject path. Writes envelopes straight into the selected
     * clip via the StrideInject Remote Script — no .alc file, no drag.
     *
     * The caller is responsible for waiting on 'inject_success' / 'inject_error'
     * events to confirm the write. Falls back to insert_step subdivision inside
     * StrideInject if Live's bezier classes aren't available.
     *
     * @param {Array}   params
     * @param {number}  clipBars
     * @param {Object}  [opts]
     * @param {boolean} [opts.createIfMissing=true]
     * @param {boolean} [opts.forceLegacyStep=false]  Skip bezier even if available
     * @param {number}  [opts.clipSlot=0]
     */
    applyDirectInject(params, clipBars, opts) {
        const o = opts || {};
        return this.send({
            type: 'apply_inject',
            create_clip_if_missing: o.createIfMissing !== false,
            clip_bars: clipBars,
            clip_slot: o.clipSlot || 0,
            force_legacy_step: o.forceLegacyStep === true,
            // Armed Pattern Library notes ride the same inject (curves + notes).
            notes: Array.isArray(o.notes) && o.notes.length > 0 ? o.notes : [],
            parameters: params.map(p => ({
                id: p.id,
                name: p.name,
                _path: p._path || null,
                min: p.min != null ? p.min : 0,
                max: p.max != null ? p.max : 1,
                is_log: p.is_log || false,
                points: (p.points || []).map(pt => ({
                    time: pt.time,
                    value: pt.value,
                    curve: pt.curve || 0
                }))
            }))
        });
    }

    applyMidi(notes, clipBars, createIfMissing = true) {
        return this.send({
            type: 'apply_midi',
            create_clip_if_missing: createIfMissing,
            clip_bars: clipBars,
            notes: notes
        });
    }

    previewParam(id, value) {
        return this.send({ type: 'preview_param', id, value });
    }

    stopPreview() {
        return this.send({ type: 'stop_preview' });
    }

    requestCreateClip(bars, slotIndex = 0) {
        return this.send({ type: 'request_create_clip', bars, slot_index: slotIndex });
    }

    // ─── Event System ──────────────────────────────────

    on(event, handler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
        return this;
    }

    off(event, handler) {
        if (!this.handlers[event]) return;
        this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }

    _emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(h => h(data));
        }
    }

    _onDisconnect() {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        if (wasConnected) this._emit('disconnected');

        // Auto-reconnect every 3 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    }
}

// Singleton
window.strideLink = new StrideLink();
