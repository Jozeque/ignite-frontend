/**
 * inspect-alc.js — One-off diagnostic: shows the envelope structure of a
 * generated .alc file. Used to verify what Stride is actually writing
 * (clip envelopes vs other envelope types) before pitching Ableton on
 * the LOM bezier API.
 *
 * Usage:
 *   node inspect-alc.js [path-to-alc]
 *   node inspect-alc.js                    # auto-finds most recent .alc
 *                                          # under ~/Desktop/Stride/
 *
 * Reports:
 *   - Root element + clip type (MidiClip vs AudioClip)
 *   - Counts of ClipEnvelope and AutomationEnvelope elements
 *   - Parent hierarchy of each envelope type (tells us where they live)
 *   - Sample FloatEvent with bezier attributes
 *   - Any other potentially relevant elements (AutomationLane, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');


function findRecentAlc() {
    const strideDir = path.join(os.homedir(), 'Desktop', 'Stride');
    const templateDir = path.join(strideDir, 'template');
    const candidates = [];

    function scan(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isFile() && e.name.endsWith('.alc')) {
                const full = path.join(dir, e.name);
                candidates.push({ path: full, mtime: fs.statSync(full).mtimeMs });
            }
        }
    }
    scan(strideDir);
    scan(templateDir);

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].path;
}


function ancestorChain(el) {
    const chain = [];
    let cur = el.parentNode;
    while (cur && cur.tagName) {
        chain.unshift(cur.tagName);
        cur = cur.parentNode;
    }
    return chain.join(' > ');
}


function directChildTags(el) {
    const tags = [];
    for (let i = 0; i < el.childNodes.length; i++) {
        const c = el.childNodes[i];
        if (c.nodeType === 1) tags.push(c.tagName);
    }
    return tags;
}


function inspect(alcPath) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Inspecting: ${alcPath}`);
    console.log('='.repeat(70));

    const compressed = fs.readFileSync(alcPath);
    const xmlBytes = zlib.gunzipSync(compressed);
    const xmlStr = xmlBytes.toString('utf-8');

    const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
    const root = doc.documentElement;

    console.log(`\nRoot element: <${root.tagName}>`);
    console.log(`Root attributes: ${Array.from(root.attributes || []).map(a => `${a.name}="${a.value}"`).join(' ')}`);
    console.log(`Top-level children: ${directChildTags(root).join(', ')}`);

    // ── Envelope-related elements ──
    const elementTypes = [
        'ClipEnvelope', 'AutomationEnvelope', 'Envelope',
        'AutomationLane', 'AutomationTrack', 'AutomationEnvelopes',
        'ClipEnvelopes', 'EnvelopeAutomationProfile',
        'MidiClip', 'AudioClip', 'MainSequencer',
        'ArrangerAutomation', 'ParameterId', 'PointeeId',
    ];

    console.log(`\n--- Element counts ---`);
    const found = {};
    for (const tag of elementTypes) {
        const list = doc.getElementsByTagName(tag);
        if (list.length > 0) {
            found[tag] = list;
            console.log(`  ${tag.padEnd(30)} ${list.length}`);
        }
    }

    // ── Show hierarchy for ClipEnvelope + AutomationEnvelope ──
    for (const tag of ['ClipEnvelope', 'AutomationEnvelope']) {
        const list = found[tag];
        if (!list || list.length === 0) continue;

        console.log(`\n--- ${tag}[0] structure ---`);
        const first = list[0];
        console.log(`  Hierarchy: ${ancestorChain(first)}`);
        console.log(`  Direct children: ${directChildTags(first).join(', ')}`);
        console.log(`  Attributes: ${Array.from(first.attributes || []).map(a => `${a.name}="${a.value}"`).join(' ') || '(none)'}`);

        // Check if PointeeId / parameter target is visible
        const targets = first.getElementsByTagName('AutomationTarget');
        if (targets.length > 0) {
            console.log(`  AutomationTarget Id: ${targets[0].getAttribute('Id') || '(none)'}`);
        }
    }

    // ── Sample bezier FloatEvent ──
    const floatEvents = doc.getElementsByTagName('FloatEvent');
    let bezierCount = 0;
    let sampleBezier = null;
    for (let i = 0; i < floatEvents.length; i++) {
        const fe = floatEvents[i];
        if (fe.hasAttribute && fe.hasAttribute('CurveControl1Y')) {
            bezierCount++;
            if (!sampleBezier) sampleBezier = fe;
        }
    }

    console.log(`\n--- FloatEvent (breakpoints) ---`);
    console.log(`  Total FloatEvent elements: ${floatEvents.length}`);
    console.log(`  With bezier handles (CurveControl1Y attr): ${bezierCount}`);

    if (sampleBezier) {
        console.log(`\n  Sample bezier FloatEvent attributes:`);
        for (let i = 0; i < sampleBezier.attributes.length; i++) {
            const a = sampleBezier.attributes[i];
            console.log(`    ${a.name} = ${a.value}`);
        }
        console.log(`\n  Sample bezier FloatEvent parent hierarchy:`);
        console.log(`    ${ancestorChain(sampleBezier)}`);
    }

    // ── First 80 lines of pretty-printed XML for orientation ──
    console.log(`\n--- First 80 lines of decompressed XML (for orientation) ---`);
    const lines = xmlStr.split('\n');
    for (let i = 0; i < Math.min(80, lines.length); i++) {
        console.log(`  ${String(i + 1).padStart(3)}: ${lines[i]}`);
    }

    console.log(`\n${'='.repeat(70)}\n`);
}


const arg = process.argv[2];
const target = arg || findRecentAlc();

if (!target) {
    console.error('No .alc file found. Pass a path explicitly:');
    console.error('  node inspect-alc.js path/to/file.alc');
    console.error('Or check that ~/Desktop/Stride/ contains generated .alc files.');
    process.exit(1);
}

inspect(target);
