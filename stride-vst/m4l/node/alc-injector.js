/**
 * alc-injector.js — Inject canvas automation into an Ableton template .alc file.
 *
 * 1:1 port of alc_injector.py — zero Python dependency.
 * Uses @xmldom/xmldom for XML DOM manipulation and built-in zlib for gzip.
 *
 * Flow:
 *   1. User creates a clip in Ableton with configured parameters
 *   2. User drags that clip to ~/Desktop/Stride/template/ (creates a template .alc)
 *   3. This module reads the template, replaces FloatEvent data with canvas points
 *   4. Outputs a new .alc ready to drag back into Ableton
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

// Windows MAX_PATH is 260 chars. When the user's rack chain is huge (20+
// devices), the generated .alc filename can blow past that and Node's fs
// rejects the write with ENOENT. The "\\?\" prefix puts Win32 into
// extended-length mode (~32,767 chars). Path must be absolute, normalized,
// and use backslashes — path.join() on Windows already produces all three.
function toLongPath(p) {
    if (process.platform !== 'win32') return p;
    if (!p || p.startsWith('\\\\?\\') || !path.isAbsolute(p)) return p;
    return '\\\\?\\' + path.normalize(p);
}

// ─── DOM Helpers ─────────────────────────────────────────
// ElementTree uses find/findall with XPath-like syntax.
// xmldom uses W3C DOM. These helpers bridge the gap.

/** Find first direct child element with given tag name. (ET: param.find('Min')) */
function findChild(parent, tagName) {
    const children = parent.childNodes;
    if (!children) return null;
    for (let i = 0; i < children.length; i++) {
        if (children[i].nodeType === 1 && children[i].tagName === tagName) {
            return children[i];
        }
    }
    return null;
}

/** Find all direct child elements with given tag name. (ET: param.findall('AutomationTarget')) */
function findChildren(parent, tagName) {
    const result = [];
    const children = parent.childNodes;
    if (!children) return result;
    for (let i = 0; i < children.length; i++) {
        if (children[i].nodeType === 1 && children[i].tagName === tagName) {
            result.push(children[i]);
        }
    }
    return result;
}

/** Find first descendant element with given tag name. (ET: root.find('.//Loop')) */
function findDescendant(parent, tagName) {
    const nodes = parent.getElementsByTagName(tagName);
    return nodes.length > 0 ? nodes[0] : null;
}

/** Find all descendant elements with given tag name. (ET: root.findall('.//ClipEnvelope')) */
function findAllDescendants(parent, tagName) {
    const nodes = parent.getElementsByTagName(tagName);
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
        result.push(nodes[i]);
    }
    return result;
}

/** Get all direct child elements (nodeType 1 only). */
function childElements(parent) {
    const result = [];
    const children = parent.childNodes;
    if (!children) return result;
    for (let i = 0; i < children.length; i++) {
        if (children[i].nodeType === 1) {
            result.push(children[i]);
        }
    }
    return result;
}

/** Iterate all descendant elements (depth-first). (ET: root.iter()) */
function iterElements(root) {
    const result = [];
    function walk(node) {
        if (node.nodeType === 1) result.push(node);
        const children = node.childNodes;
        if (children) {
            for (let i = 0; i < children.length; i++) {
                walk(children[i]);
            }
        }
    }
    walk(root);
    return result;
}

/** Find all descendant elements that have a specific attribute. (ET: root.findall('.//*[@Id]')) */
function findAllWithAttr(root, attrName) {
    const all = iterElements(root);
    return all.filter(el => el.hasAttribute && el.hasAttribute(attrName));
}

// ─── Read .alc ──────────────────────────────────────────

/**
 * Read .alc file (gzip or raw XML) and return parsed DOM document.
 */
function readAlc(alcPath) {
    const data = fs.readFileSync(alcPath);
    let xmlStr;
    try {
        xmlStr = zlib.gunzipSync(data).toString('utf-8');
    } catch (e) {
        xmlStr = data.toString('utf-8');
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');
    return { doc, xmlStr };
}

/**
 * Quick count of ClipEnvelopes + AutomationEnvelopes in a template .alc file.
 * Used for pre-flight validation before injection.
 */
function countEnvelopes(alcPath) {
    const { doc } = readAlc(alcPath);
    const root = doc.documentElement;
    const clip = findAllDescendants(root, 'ClipEnvelope');
    const auto = findAllDescendants(root, 'AutomationEnvelope');
    return clip.length + auto.length;
}

// ─── Build Parameter Bounds ─────────────────────────────

/**
 * Build parameter bounds map from the .alc XML.
 * Maps AutomationTarget Id -> {min, max, is_int, is_bool}
 * Ported from alc_injector.py's two-pass parameter parsing.
 */
function buildParamBounds(root) {
    const paramIdToName = {};
    const paramBounds = {};

    // Pass 1: Collect bounds from all elements with Id
    const allWithId = findAllWithAttr(root, 'Id');

    for (const param of allWithId) {
        const pTag = param.tagName;
        const pId = param.getAttribute('Id');
        if (!pId) continue;

        let name = null;
        for (const nTag of ['UserName', 'Name', 'ParameterName']) {
            const nNode = findDescendant(param, nTag);
            if (nNode && nNode.getAttribute('Value')) {
                name = nNode.getAttribute('Value');
                break;
            }
        }
        if (name) {
            paramIdToName[pId] = name;
        }

        let minV = null, maxV = null;
        for (const [findTag, target] of [['Min', 'min'], ['Max', 'max']]) {
            // Try direct child first, then any descendant
            let node = findChild(param, findTag);
            if (!node) {
                node = findDescendant(param, findTag);
            }
            if (node) {
                const val = node.getAttribute('Value') || (node.textContent ? node.textContent.trim() : null);
                if (val) {
                    try {
                        const fval = parseFloat(val);
                        if (!isNaN(fval)) {
                            if (target === 'min') minV = fval;
                            else maxV = fval;
                        }
                    } catch (e) {}
                }
            }
        }

        if (minV !== null || maxV !== null) {
            const bounds = {
                min: minV !== null ? minV : 0.0,
                max: maxV !== null ? maxV : 1.0,
                is_int: pTag.includes('Int') || pTag.includes('Enum'),
                is_bool: pTag.includes('Bool'),
            };
            paramBounds[pId] = bounds;

            // Map AutomationTarget and ModulationTarget children
            const targets = [
                ...findChildren(param, 'AutomationTarget'),
                ...findChildren(param, 'ModulationTarget'),
            ];
            for (const tgt of targets) {
                const tId = tgt.getAttribute('Id');
                if (tId) {
                    paramBounds[tId] = bounds;
                    if (name) paramIdToName[tId] = name;
                }
            }
        }
    }

    // Pass 2: MidiControllerRange (authoritative, overwrites Pass 1)
    for (const tagName of ['AutomationTarget', 'ModulationTarget']) {
        const allTargets = findAllDescendants(root, tagName);
        for (const tgt of allTargets) {
            const tid = tgt.getAttribute('Id');
            if (!tid) continue;

            const par = tgt.parentNode;
            if (!par || par.nodeType !== 1) continue;

            const mcr = findChild(par, 'MidiControllerRange');
            if (!mcr) continue;

            let minv = null, maxv = null;
            const mn = findChild(mcr, 'Min');
            const mx = findChild(mcr, 'Max');
            if (mn) {
                const v = mn.getAttribute('Value') || (mn.textContent ? mn.textContent.trim() : '');
                const f = parseFloat(v);
                if (!isNaN(f)) minv = f;
            }
            if (mx) {
                const v = mx.getAttribute('Value') || (mx.textContent ? mx.textContent.trim() : '');
                const f = parseFloat(v);
                if (!isNaN(f)) maxv = f;
            }

            if (minv !== null || maxv !== null) {
                const prev = paramBounds[tid] || {};
                paramBounds[tid] = {
                    min: minv !== null ? minv : 0.0,
                    max: maxv !== null ? maxv : 1.0,
                    is_int: prev.is_int || false,
                    is_bool: prev.is_bool || false,
                };

                if (!paramIdToName[tid]) {
                    const gpar = par.parentNode;
                    const sources = gpar && gpar.nodeType === 1 ? [par, gpar] : [par];
                    for (const src of sources) {
                        let found = false;
                        for (const ntag of ['ParameterName', 'UserName', 'Name']) {
                            const nn = findChild(src, ntag);
                            if (nn && nn.getAttribute('Value')) {
                                paramIdToName[tid] = nn.getAttribute('Value');
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                }
            }
        }
    }

    return { paramBounds, paramIdToName };
}

// ─── Inject Automation ──────────────────────────────────

/**
 * Inject automation points into existing ClipEnvelopes in the template.
 * Ported directly from alc_injector.py's inject_automation.
 *
 * @param {Document} doc - The parsed XML document
 * @param {Element} root - The root element
 * @param {Array} paramsData - Array of param objects with points
 * @param {number} clipBars - Clip length in bars
 * @returns {{ paramsWritten: number, totalPoints: number, debugLines: string[] }}
 */
function injectAutomation(doc, root, paramsData, clipBars) {
    const totalBeats = clipBars * 4.0;

    // Update loop length
    const loopNode = findDescendant(root, 'Loop');
    if (loopNode) {
        for (const tag of ['LoopEnd', 'HiddenLoopEnd', 'OutMarker']) {
            const el = findChild(loopNode, tag);
            if (el) el.setAttribute('Value', String(totalBeats));
        }
    }

    // Find all envelopes
    const allEnvelopes = [
        ...findAllDescendants(root, 'ClipEnvelope'),
        ...findAllDescendants(root, 'AutomationEnvelope'),
    ];

    if (allEnvelopes.length === 0) {
        throw new Error(
            'Template has no ClipEnvelopes. ' +
            'Draw automation on each parameter in Ableton first, then re-export the clip.'
        );
    }

    // Build param map by envelope index
    const paramMap = {};
    for (const p of paramsData) {
        const idx = p.envelope_index;
        if (idx != null) {
            paramMap[parseInt(idx)] = p;
        }
    }

    // Build bounds from XML
    const { paramBounds, paramIdToName } = buildParamBounds(root);

    let paramsWritten = 0;
    let totalPoints = 0;
    const debugLines = [];

    for (let envIdx = 0; envIdx < allEnvelopes.length; envIdx++) {
        const env = allEnvelopes[envIdx];
        const eventsNode = findDescendant(env, 'Events');
        if (!eventsNode) continue;

        // Get PointeeId
        let pointeeId = null;
        const envelopeTarget = findDescendant(env, 'EnvelopeTarget');
        if (envelopeTarget) {
            const pNode = findChild(envelopeTarget, 'PointeeId');
            if (pNode) pointeeId = pNode.getAttribute('Value');
        }

        // Determine event type and bounds
        let eventTag = 'FloatEvent';
        let templateMin = 0.0;
        let templateMax = 1.0;

        if (pointeeId && paramBounds[pointeeId]) {
            templateMin = paramBounds[pointeeId].min;
            templateMax = paramBounds[pointeeId].max;
            if (paramBounds[pointeeId].is_int) {
                eventTag = 'IntEvent';
            } else if (paramBounds[pointeeId].is_bool) {
                eventTag = 'BoolEvent';
            }
        }

        // Sniff existing events for actual range, then clear
        let sniffedMax = templateMax;
        const existingEvents = childElements(eventsNode);
        for (const child of existingEvents) {
            if (!(pointeeId && paramBounds[pointeeId])) {
                eventTag = child.tagName;
            }
            try {
                const valStr = child.getAttribute('Value') || '1.0';
                let val;
                if (valStr.toLowerCase() === 'true') val = 1.0;
                else if (valStr.toLowerCase() === 'false') val = 0.0;
                else val = parseFloat(valStr);
                if (!isNaN(val) && val > sniffedMax) {
                    sniffedMax = val;
                }
            } catch (e) {}
            eventsNode.removeChild(child);
        }

        // Get user params for this envelope
        const userParam = paramMap[envIdx] || {};

        // Bounds priority:
        // 1. XML-derived bounds (from buildParamBounds / MidiControllerRange) — most reliable
        // 2. Sniffed from existing FloatEvent values in the template — good fallback
        // 3. User-provided min/max from scanner — only when XML has no bounds and nothing sniffed
        const xmlHasBounds = !!(pointeeId && paramBounds[pointeeId]);

        if (!xmlHasBounds) {
            // No XML bounds — try user-provided, then sniff
            if (userParam.min != null && userParam.max != null) {
                const uMin = parseFloat(userParam.min);
                const uMax = parseFloat(userParam.max);
                if (!isNaN(uMin)) templateMin = uMin;
                if (!isNaN(uMax)) templateMax = uMax;
            }
            // Snap sniffed max to common ranges
            if (sniffedMax > templateMax) {
                if (sniffedMax <= 127.0) templateMax = 127.0;
                else if (sniffedMax <= 255.0) templateMax = 255.0;
                else if (sniffedMax <= 256.0) templateMax = 256.0;
                else if (sniffedMax <= 1000.0) templateMax = 1000.0;
                else templateMax = sniffedMax;
            }
            if ((eventTag === 'IntEvent' || eventTag === 'EnumEvent') && templateMax <= 1.0) {
                templateMax = 127.0;
            }
        } else {
            // XML bounds exist — still check sniffed in case XML bounds are too narrow
            if (sniffedMax > templateMax) {
                templateMax = sniffedMax;
            }
        }

        if (templateMax <= templateMin) {
            templateMax = templateMin + 1.0;
        }

        // Detect log-scale (frequency) params from XML name, range, or scanner flag
        const envName = paramIdToName[pointeeId] || '?';
        const useLog = (function() {
            if (eventTag !== 'FloatEvent') return false;
            if (templateMin <= 0 || templateMax <= templateMin) return false;
            // 1. Scanner-provided flag
            if (userParam.is_log) return true;
            // 2. Name-based: "Cutoff" or "Freq" strongly indicates frequency
            const pName = (envName || '').toLowerCase();
            if (/cutoff|freq/.test(pName)) return true;
            // 3. Range heuristic: classic audio frequency range
            const ratio = templateMax / templateMin;
            if (ratio >= 100 && templateMin >= 10 && templateMax >= 5000) return true;
            return false;
        })();

        // Debug info
        const userName = userParam.name || '(none)';
        const userPts = userParam.points || [];
        debugLines.push(
            `env[${envIdx}] pointee=${pointeeId} name='${envName}' → user='${userName}' ` +
            `xml_bounds=${xmlHasBounds} final=[${templateMin},${templateMax}] sniffed=${sniffedMax} ` +
            `user=[${userParam.min != null ? userParam.min : '?'},${userParam.max != null ? userParam.max : '?'}] ` +
            `tag=${eventTag} useLog=${useLog} pts=${userPts.length}`
        );

        // Write anchor event (value must be in actual parameter space, not 0-1)
        const anchorValue = useLog
            ? templateMin * Math.pow(templateMax / templateMin, 0.5)
            : (templateMin + templateMax) / 2;
        const anchor = doc.createElement(eventTag);
        anchor.setAttribute('Id', '0');
        anchor.setAttribute('Time', '-63072000');
        if (eventTag === 'BoolEvent') {
            anchor.setAttribute('Value', 'false');
        } else if (eventTag === 'IntEvent' || eventTag === 'EnumEvent') {
            anchor.setAttribute('Value', String(Math.round(anchorValue)));
        } else {
            let fmtAnchor = anchorValue.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
            anchor.setAttribute('Value', fmtAnchor);
        }
        eventsNode.appendChild(anchor);

        // Write automation points
        const userPoints = userParam.points || [];
        let eventId = 1;

        if (userPoints.length > 0) {
            userPoints.sort((a, b) => parseFloat(a.time || 0) - parseFloat(b.time || 0));

            for (let i = 0; i < userPoints.length; i++) {
                const pt = userPoints[i];
                const t = parseFloat(pt.time || 0);
                const v = parseFloat(pt.value || 0);
                const cv = parseFloat(pt.curve || 0);

                const el = doc.createElement(eventTag);
                el.setAttribute('Id', String(eventId));
                el.setAttribute('Time', String(Math.round(t * 100000) / 100000));

                const clampedV = Math.max(0.0, Math.min(1.0, v));
                const scaledV = useLog
                    ? templateMin * Math.pow(templateMax / templateMin, clampedV)
                    : templateMin + (clampedV * (templateMax - templateMin));

                if (eventTag === 'BoolEvent') {
                    el.setAttribute('Value', v >= 0.5 ? 'true' : 'false');
                } else if (eventTag === 'IntEvent' || eventTag === 'EnumEvent') {
                    el.setAttribute('Value', String(Math.round(scaledV)));
                } else {
                    // Match Python's f"{scaled_v:.5f}".rstrip('0').rstrip('.')
                    let formatted = scaledV.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
                    el.setAttribute('Value', formatted);

                    if (Math.abs(cv) > 0.01 && i < userPoints.length - 1 && eventTag === 'FloatEvent') {
                        el.setAttribute('CurveControl1X', '0.5');
                        el.setAttribute('CurveControl1Y', String(-cv * 0.5));
                        el.setAttribute('CurveControl2X', '0.5');
                        el.setAttribute('CurveControl2Y', String(cv * 0.5));
                    }
                }

                eventsNode.appendChild(el);
                eventId++;
                totalPoints++;
            }

            paramsWritten++;
        }
    }

    return { paramsWritten, totalPoints, debugLines };
}

// ─── Main: Inject and Write ─────────────────────────────

/**
 * Full injection pipeline: read template, inject automation, write output.
 * Called directly from alc-generator.js — no subprocess needed.
 *
 * @param {string} templatePath - Path to template .alc file
 * @param {Object} autoData - Automation data { clip_bars, params, total_param_count }
 * @param {string} outputPath - Where to write the output .alc
 * @returns {Object} Result object matching the Python version's JSON output
 */
function injectAlcFile(templatePath, autoData, outputPath) {
    const clipBars = autoData.clip_bars || 4;
    const params = autoData.params || [];

    if (params.length === 0) {
        return { success: false, error: 'No parameters in automation data' };
    }

    // Read template
    let doc;
    try {
        const result = readAlc(templatePath);
        doc = result.doc;
    } catch (e) {
        return { success: false, error: 'Failed to read template .alc: ' + e.message };
    }

    const root = doc.documentElement;

    // Inject automation
    let paramsWritten, totalPoints, debugLines;
    try {
        const result = injectAutomation(doc, root, params, clipBars);
        paramsWritten = result.paramsWritten;
        totalPoints = result.totalPoints;
        debugLines = result.debugLines;
    } catch (e) {
        return { success: false, error: 'Injection failed: ' + e.message };
    }

    // Serialize and compress
    try {
        const serializer = new XMLSerializer();
        let xmlStr = serializer.serializeToString(doc);

        // Ensure XML declaration is present
        if (!xmlStr.startsWith('<?xml')) {
            xmlStr = '<?xml version="1.0" encoding="UTF-8"?>' + xmlStr;
        }

        const compressed = zlib.gzipSync(Buffer.from(xmlStr, 'utf-8'));

        const longOut = toLongPath(outputPath);
        const dir = path.dirname(longOut);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(longOut, compressed);
    } catch (e) {
        return { success: false, error: 'Failed to write .alc: ' + e.message };
    }

    // Count results — after injection, count what's actually there
    const allEnvelopes = [
        ...findAllDescendants(root, 'ClipEnvelope'),
        ...findAllDescendants(root, 'AutomationEnvelope'),
    ];
    const envelopeCount = allEnvelopes.length;
    const totalParamCount = autoData.total_param_count || params.length;
    const requestedCount = params.length;
    const activeWithPoints = params.filter(p => p.points && p.points.length > 0).length;
    const skippedActive = Math.max(0, activeWithPoints - paramsWritten);
    const mismatchCount = Math.max(0, totalParamCount - envelopeCount);

    return {
        success: true,
        params_written: paramsWritten,
        total_points: totalPoints,
        output_path: outputPath,
        envelope_count: envelopeCount,
        requested_count: requestedCount,
        total_param_count: totalParamCount,
        skipped_count: skippedActive,
        mismatch_count: mismatchCount,
        debug_lines: debugLines,
    };
}

module.exports = {
    injectAlcFile,
    readAlc,
    countEnvelopes,
    buildParamBounds,
    injectAutomation,
};
