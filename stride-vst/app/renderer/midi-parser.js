/**
 * Stride MIDI parser — Standard MIDI File (format 0 + 1) → note list.
 *
 * Returns {bpm, ppq, durationBeats, notes: [{pitch, time, duration, velocity}]}
 * where time/duration are in beats (1 beat = 1 quarter note). Pitch 0-127,
 * velocity 0-127. Multiple tracks merged into a single time-sorted note list.
 *
 * Supports:
 *   - Format 0 (single track)
 *   - Format 1 (simultaneous tracks)
 *   - Running status
 *   - Variable-length quantities (VLQ)
 *   - Tempo meta event (uses first tempo encountered)
 *
 * Ignores: sysex, polyphonic key pressure, channel pressure, controllers,
 * program change, pitch bend, all other meta events. We only care about notes.
 *
 * Exposed as both a CommonJS module (for tests) and window.strideMidi
 * (for the renderer). Pure-logic — no DOM, no fs, no fetch.
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.strideMidi = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    /**
     * Parse a Standard MIDI File. Accepts ArrayBuffer or Node Buffer.
     * Throws on invalid headers or truncated chunks.
     */
    function parse(input) {
        const bytes = toUint8(input);
        if (bytes.length < 14) throw new Error('Not a MIDI file (too short)');
        if (readString(bytes, 0, 4) !== 'MThd') throw new Error('Missing MThd header');

        const headerLen = readUInt32BE(bytes, 4);
        if (headerLen < 6) throw new Error('Invalid header length');
        const format = readUInt16BE(bytes, 8);
        const trackCount = readUInt16BE(bytes, 10);
        const division = readUInt16BE(bytes, 12);

        if (division & 0x8000) {
            throw new Error('SMPTE division not supported (use PPQ files)');
        }
        const ppq = division & 0x7fff;
        if (ppq <= 0) throw new Error('Invalid PPQ');

        let offset = 8 + headerLen;
        const trackEvents = [];
        let firstTempo = null;

        for (let t = 0; t < trackCount; t++) {
            if (offset + 8 > bytes.length) throw new Error('Truncated at track ' + t);
            if (readString(bytes, offset, 4) !== 'MTrk') throw new Error('Missing MTrk at track ' + t);
            const trackLen = readUInt32BE(bytes, offset + 4);
            const trackStart = offset + 8;
            const trackEnd = trackStart + trackLen;
            if (trackEnd > bytes.length) throw new Error('Truncated track body at track ' + t);

            const events = parseTrackEvents(bytes, trackStart, trackEnd);
            for (const e of events) {
                if (e.tempo && firstTempo === null) firstTempo = e.tempo;
            }
            trackEvents.push(events);
            offset = trackEnd;
        }

        const tempoUsPerQuarter = firstTempo || 500000; // 120 BPM default
        const bpm = Math.round((60000000 / tempoUsPerQuarter) * 100) / 100;

        // Merge all tracks into a single note list — pair note-on with note-off.
        const notes = [];
        let maxTick = 0;
        for (const events of trackEvents) {
            const pending = new Map(); // key: pitch_channel -> [{tick, velocity}]
            for (const e of events) {
                if (e.tick > maxTick) maxTick = e.tick;
                if (e.kind === 'noteOn' && e.velocity > 0) {
                    const k = e.pitch * 16 + e.channel;
                    if (!pending.has(k)) pending.set(k, []);
                    pending.get(k).push({ tick: e.tick, velocity: e.velocity });
                } else if (e.kind === 'noteOff' || (e.kind === 'noteOn' && e.velocity === 0)) {
                    const k = e.pitch * 16 + e.channel;
                    const stack = pending.get(k);
                    if (stack && stack.length > 0) {
                        const start = stack.shift();
                        notes.push({
                            pitch: e.pitch,
                            time: start.tick / ppq,
                            duration: Math.max(0.001, (e.tick - start.tick) / ppq),
                            velocity: start.velocity,
                        });
                    }
                }
            }
            // Any orphaned note-ons get a default 1-tick duration so they're not lost.
            pending.forEach((stack, k) => {
                const pitch = Math.floor(k / 16);
                for (const start of stack) {
                    notes.push({
                        pitch,
                        time: start.tick / ppq,
                        duration: 0.001,
                        velocity: start.velocity,
                    });
                }
            });
        }

        notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
        const durationBeats = maxTick / ppq;

        return { bpm, ppq, durationBeats, notes };
    }

    // ─── Track event parser ──────────────────────────────────

    function parseTrackEvents(bytes, start, end) {
        const events = [];
        let pos = start;
        let absTick = 0;
        let runningStatus = 0;

        while (pos < end) {
            const delta = readVLQ(bytes, pos);
            pos = delta.next;
            absTick += delta.value;

            let status = bytes[pos];
            if (status < 0x80) {
                // Running status — reuse last status byte; don't advance pos here
                status = runningStatus;
                if (!status) throw new Error('Running status with no prior status byte');
            } else {
                pos++;
                if (status < 0xf0) runningStatus = status;
            }

            if (status === 0xff) {
                // Meta event: FF type len data
                const type = bytes[pos++];
                const lenVlq = readVLQ(bytes, pos);
                pos = lenVlq.next;
                const len = lenVlq.value;
                const dataStart = pos;
                pos += len;
                if (type === 0x51 && len === 3) {
                    // Tempo: 3 bytes microseconds per quarter
                    const us = (bytes[dataStart] << 16) | (bytes[dataStart + 1] << 8) | bytes[dataStart + 2];
                    events.push({ tick: absTick, kind: 'meta', tempo: us });
                }
                // Other meta events ignored.
            } else if (status === 0xf0 || status === 0xf7) {
                // SysEx
                const lenVlq = readVLQ(bytes, pos);
                pos = lenVlq.next + lenVlq.value;
            } else {
                const channel = status & 0x0f;
                const cmd = status & 0xf0;
                if (cmd === 0x80) {
                    // Note off: pitch, velocity
                    const pitch = bytes[pos++];
                    const velocity = bytes[pos++];
                    events.push({ tick: absTick, kind: 'noteOff', channel, pitch, velocity });
                } else if (cmd === 0x90) {
                    const pitch = bytes[pos++];
                    const velocity = bytes[pos++];
                    events.push({ tick: absTick, kind: 'noteOn', channel, pitch, velocity });
                } else if (cmd === 0xa0 || cmd === 0xb0 || cmd === 0xe0) {
                    pos += 2; // two-byte payload, ignore
                } else if (cmd === 0xc0 || cmd === 0xd0) {
                    pos += 1; // one-byte payload, ignore
                } else {
                    throw new Error('Unknown MIDI status byte 0x' + status.toString(16) + ' at offset ' + pos);
                }
            }
        }
        return events;
    }

    // ─── Binary helpers ──────────────────────────────────────

    function toUint8(input) {
        if (input instanceof Uint8Array) return input;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
            return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        }
        if (input instanceof ArrayBuffer) return new Uint8Array(input);
        if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        throw new Error('Unsupported input type for MIDI parse');
    }

    function readString(bytes, offset, len) {
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
        return s;
    }

    function readUInt32BE(bytes, offset) {
        return (bytes[offset] << 24 >>> 0) +
               (bytes[offset + 1] << 16) +
               (bytes[offset + 2] << 8) +
               bytes[offset + 3];
    }

    function readUInt16BE(bytes, offset) {
        return (bytes[offset] << 8) + bytes[offset + 1];
    }

    function readVLQ(bytes, offset) {
        let value = 0;
        let i = offset;
        while (i < bytes.length) {
            const b = bytes[i++];
            value = (value << 7) | (b & 0x7f);
            if ((b & 0x80) === 0) return { value, next: i };
            if (i - offset > 4) throw new Error('VLQ too long at ' + offset);
        }
        throw new Error('Truncated VLQ at ' + offset);
    }

    return { parse };
}));
