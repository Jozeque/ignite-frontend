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

// 3) Apply log scaling for a filter-cutoff target (20 Hz - 20 kHz). live.remote~
//    will receive these native-range values directly. For a different param,
//    change paramScale or pass {} to keep [0..1] normalized output.
const paramScale = { name: 'Filter Cutoff', min: 20, max: 20000, is_log: true };
const samples = rasterizeCurve(points, beatsPerLoop, sampleCount, paramScale);

// 4) Write Float32 mono WAV. buffer~ accepts this without conversion.
//    WAV header layout (44 bytes):
//      RIFF[4] size[4] WAVE[4]
//      fmt [4] 16[4] format[2] channels[2] rate[4] byteRate[4] blockAlign[2] bitsPerSample[2]
//      data[4] dataSize[4] [samples...]
function writeFloatWav(filename, float32Samples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 32;
    const formatCode = 3;  // 3 = IEEE float (1 = PCM int)
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = float32Samples.length * 4;
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

    // Important: live.remote~ expects values in the param's native range.
    // For our 20..20000 Hz log-scaled cutoff, that means samples are real
    // frequency values, NOT [0..1]. The buffer~ can hold any Float32 — Live
    // will interpret them as parameter values when fed via live.remote~.
    for (let i = 0; i < float32Samples.length; i++) {
        buffer.writeFloatLE(float32Samples[i], headerSize + i * 4);
    }

    fs.writeFileSync(filename, buffer);
}

const outPath = path.join(__dirname, '..', 'stride_q_poc.wav');
writeFloatWav(outPath, samples, SAMPLE_RATE);

console.log(`StrideQuick POC buffer ready.`);
console.log(`  preset:        ${preset}`);
console.log(`  bars:          ${bars}  (${beatsPerLoop} beats)`);
console.log(`  bpm:           ${bpm}`);
console.log(`  param target:  ${paramScale.name}  range=[${paramScale.min}..${paramScale.max}]  log=${!!paramScale.is_log}`);
console.log(`  samples:       ${sampleCount} @ ${SAMPLE_RATE} Hz`);
console.log(`  output:        ${outPath}`);
console.log(`  size:          ${(samples.length * 4 / 1024).toFixed(1)} KB`);
console.log(`\nDrop this WAV into a buffer~ in Max via the [replace ${outPath}] message.`);
console.log(`Or via the buffer~ inspector: Sample = ${path.relative(process.cwd(), outPath)}`);
