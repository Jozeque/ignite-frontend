/**
 * _scan_alc_anomalies.js — TEMP diagnostic (not committed).
 *
 * Scans every generated .alc under ~/Desktop/Stride/ and flags envelope data
 * that Ableton could choke on while RENDERING the clip (on play, or on draw):
 *   - non-numeric / NaN / empty Value or Time
 *   - duplicate or non-monotonic breakpoint Time within one envelope
 *   - CurveControl handles out of expected range (X must be 0..1, Y sane)
 *   - breakpoint Time beyond the clip loop length
 *   - degenerate equal control-X (the 0.5/0.5 we hardcode)
 *
 * Usage: node _scan_alc_anomalies.js  [optional path or dir]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');

function readXml(p) {
    const data = fs.readFileSync(p);
    let xml;
    try { xml = zlib.gunzipSync(data).toString('utf-8'); }
    catch (e) { xml = data.toString('utf-8'); }
    return new DOMParser().parseFromString(xml, 'text/xml');
}

function num(s) {
    if (s == null) return NaN;
    const t = String(s).trim().toLowerCase();
    if (t === 'true') return 1;
    if (t === 'false') return 0;
    return parseFloat(s);
}

function loopEnd(root) {
    const loops = root.getElementsByTagName('Loop');
    if (!loops.length) return null;
    const kids = loops[0].childNodes;
    for (let i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 1 && kids[i].tagName === 'LoopEnd') {
            return num(kids[i].getAttribute('Value'));
        }
    }
    return null;
}

function scanFile(p) {
    const issues = [];
    let doc;
    try { doc = readXml(p); } catch (e) { return [`READ-FAIL: ${e.message}`]; }
    const root = doc.documentElement;
    const lEnd = loopEnd(root);

    const envTags = ['ClipEnvelope', 'AutomationEnvelope'];
    let envIdx = -1;
    for (const tag of envTags) {
        const envs = doc.getElementsByTagName(tag);
        for (let e = 0; e < envs.length; e++) {
            envIdx++;
            const events = envs[e].getElementsByTagName('Events');
            if (!events.length) continue;
            const kids = events[0].childNodes;
            let prevT = -Infinity;
            const seenT = new Set();
            for (let i = 0; i < kids.length; i++) {
                const ev = kids[i];
                if (ev.nodeType !== 1) continue;
                const tag2 = ev.tagName;
                const tStr = ev.getAttribute('Time');
                const vStr = ev.getAttribute('Value');
                const t = num(tStr);
                const v = num(vStr);
                const isAnchor = t <= -1e6; // the -63072000 anchor

                if (vStr == null || vStr === '' || Number.isNaN(v))
                    issues.push(`env#${envIdx} ${tag2} BAD Value="${vStr}"`);
                if (tStr == null || tStr === '' || Number.isNaN(t))
                    issues.push(`env#${envIdx} ${tag2} BAD Time="${tStr}"`);

                if (!isAnchor && !Number.isNaN(t)) {
                    if (t < prevT) issues.push(`env#${envIdx} non-monotonic Time ${t} < ${prevT}`);
                    if (seenT.has(t)) issues.push(`env#${envIdx} DUPLICATE Time=${t}`);
                    seenT.add(t);
                    prevT = t;
                    if (lEnd != null && t > lEnd + 1e-6)
                        issues.push(`env#${envIdx} Time ${t} > loopEnd ${lEnd}`);
                }

                // CurveControl handle checks
                const c1x = ev.getAttribute('CurveControl1X');
                if (c1x != null) {
                    const vals = {
                        c1x: num(c1x),
                        c1y: num(ev.getAttribute('CurveControl1Y')),
                        c2x: num(ev.getAttribute('CurveControl2X')),
                        c2y: num(ev.getAttribute('CurveControl2Y')),
                    };
                    for (const [k, val] of Object.entries(vals)) {
                        if (Number.isNaN(val)) issues.push(`env#${envIdx} ${k}=NaN`);
                    }
                    if (vals.c1x < 0 || vals.c1x > 1 || vals.c2x < 0 || vals.c2x > 1)
                        issues.push(`env#${envIdx} controlX out of [0,1]: ${vals.c1x},${vals.c2x}`);
                    if (Math.abs(vals.c1y) > 1.0001 || Math.abs(vals.c2y) > 1.0001)
                        issues.push(`env#${envIdx} controlY |>1|: ${vals.c1y},${vals.c2y}`);
                    // curve on the LAST event of an envelope is invalid (no next pt)
                    let isLast = true;
                    for (let j = i + 1; j < kids.length; j++) {
                        if (kids[j].nodeType === 1) { isLast = false; break; }
                    }
                    if (isLast) issues.push(`env#${envIdx} CurveControl on LAST event (no following breakpoint)`);
                }
            }
        }
    }
    return issues;
}

const arg = process.argv[2];
let files = [];
if (arg && fs.statSync(arg).isFile()) {
    files = [arg];
} else {
    const dir = arg || path.join(os.homedir(), 'Desktop', 'Stride');
    const scan = (d) => {
        if (!fs.existsSync(d)) return;
        for (const f of fs.readdirSync(d)) {
            if (f.endsWith('.alc')) files.push(path.join(d, f));
        }
    };
    scan(dir);
    scan(path.join(dir, 'template'));
}

let flagged = 0, clean = 0;
const summary = {};
for (const f of files) {
    const issues = scanFile(f);
    if (issues.length) {
        flagged++;
        // collapse repeated issue strings
        const counts = {};
        for (const it of issues) {
            const key = it.replace(/env#\d+/g, 'env#N').replace(/[-\d.]+/g, '#');
            counts[key] = (counts[key] || 0) + 1;
            summary[key] = (summary[key] || 0) + 1;
        }
        console.log(`\n[FLAG] ${path.basename(f)}`);
        for (const [k, c] of Object.entries(counts)) console.log(`   ${c}x  ${k}`);
    } else {
        clean++;
    }
}
console.log(`\n================ SUMMARY ================`);
console.log(`files scanned: ${files.length}  clean: ${clean}  flagged: ${flagged}`);
console.log(`--- issue classes (count across all files) ---`);
for (const [k, c] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(5)}  ${k}`);
}
