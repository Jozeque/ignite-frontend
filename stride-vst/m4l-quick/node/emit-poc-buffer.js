/**
 * StrideQuick POC — emit a rasterized curve as a Float32 WAV
 *
 * Usage: node emit-poc-buffer.js [preset] [bars] [bpm]
 *   preset: sine | pump  (default: sine)
 *   bars:   2 | 4 | 8 | 16 (default: 4)
 *   bpm:    project tempo in Ableton (default: 120)
 *
 * Output: stride_q_poc.wav in this folder. Drop into a buffer~ in Max.
 *
 * The WAV format here is Float32 mono so buffer~ reads it without rescaling.
 * Sample rate is the Ableton project rate (assume 44100 unless overridden) so
 * the buffer playback time-aligns when phasor~ @lock 1 drives a play~.
 *
 * What this proves: the JS side of the StrideQuick pipeline produces a
 * deterministic, log-scaled, bezier-rasterized buffer ready for live.remote~
 * to consume. If POC playback in Max sounds identical to the .alc playback
 * of the same preset, the architecture is validated.
 */

const fs = require('fs');
const path = require('path');

const { rasterizeCurve, sampleCountForLoop } = require('../../shared/rasterizer.js');
const { genSine, genPump } = require('../../shared/generators.js');

const args = process.argv.slice(2);
const preset = (args[0] || 'sine').toLowerCase();
const bars = parseInt(args[1] || '4', 10);
const bpm = parseFloat(args[2] || '120');

const SAMPLE_RATE = 44100;
const beatsPerLoop = bars * 4;

const generators = { sine: genSine, pump: genPump };
const gen = generators[preset];
if (!gen) {
    console.error(`Unknown preset: ${preset}. Choose one of: ${Object.keys(generators).join(', ')}`);
    process.exit(1);
}

// 1) Generate the curve points (canvas-style {time,value,curve} array)
const points = gen(beatsPerLoop);

// 2) Rasterize at audio rate. We oversample to 44.1 kHz so the buffer can
//    be played back at any speed without aliasing — same rate as Live's
//    audio engine, which means buffer playback at 1.0 = real-time at any BPM.
const sampleCount = sampleCountForLoop(bars, bpm, SAMPLE_RATE);

// 3) Keep output as normalized [0..1] curve values — NO log scaling baked in.
//    Why: Max's buffer~ doesn't reliably read Float32 WAVs and we want 16-bit
//    PCM. Storing as normalized lets us write standard PCM, then we recover
//    [0..1] in Max and feed to live.remote~ in normalized mode (Live applies
//    the parameter's natural log/linear scaling internally).
const samples = rasterizeCurve(points, beatsPerLoop, sampleCount);

// 4) Write 16-bit PCM mono WAV — universally readable by Max's buffer~.
//    Each sample is normalized [0..1] → int16 [-32768..+32767] using the
//    standard audio convention (0 → -32768, 0.5 → 0, 1 → +32767). When
//    play~ reads back, it outputs values in [-1..+1]. We re-center in Max
//    via [+~ 1 → *~ 0.5] before sending to live.remote~ in normalized mode.
function write16PcmWav(filename, normalizedSamples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const formatCode = 1;  // 1 = PCM int (universally readable)
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = normalizedSamples.length * 2;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(formatCode, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Map normalized [0..1] → audio [-1..+1] → int16 [-32768..+32767].
    for (let i = 0; i < normalizedSamples.length; i++) {
        const v = Math.max(0, Math.min(1, normalizedSamples[i]));
        const audio = v * 2 - 1;            // [-1..+1]
        const int16 = Math.round(audio * 32767);
        buffer.writeInt16LE(int16, headerSize + i * 2);
    }

    fs.writeFileSync(filename, buffer);
}

const outPath = path.join(__dirname, '..', 'stride_q_poc.wav');
write16PcmWav(outPath, samples, SAMPLE_RATE);

console.log(`StrideQuick POC buffer ready.`);
console.log(`  preset:        ${preset}`);
console.log(`  bars:          ${bars}  (${beatsPerLoop} beats)`);
console.log(`  bpm:           ${bpm}`);
console.log(`  format:        16-bit PCM mono (universally readable by Max buffer~)`);
console.log(`  range:         normalized [0..1] → audio [-1..+1] → int16`);
console.log(`  samples:       ${sampleCount} @ ${SAMPLE_RATE} Hz`);
console.log(`  output:        ${outPath}`);
console.log(`  size:          ${(samples.length * 2 / 1024).toFixed(1)} KB`);
console.log(`\nIn Max, send the buffer~ a [replace stride_q_poc.wav] message`);
console.log(`with the WAV in the same folder as the .amxd. After play~, recenter`);
console.log(`with [+~ 1] → [*~ 0.5] before live.remote~, and use live.remote~ in`);
console.log(`normalized mode so Live applies the parameter's natural scaling.`);
