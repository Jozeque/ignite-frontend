#!/usr/bin/env python3
"""
alc_injector.py — Inject canvas automation into an Ableton template .alc file.

This replicates the web backend's automation injection flow locally:
  1. User creates a clip in Ableton with configured parameters
  2. User drags that clip to ~/Desktop/Stride/template/ (creates a template .alc)
  3. This script reads the template, replaces FloatEvent data with canvas points
  4. Outputs a new .alc ready to drag back into Ableton

Usage:
    python alc_injector.py <template_alc> <automation_json> <output_path>

The automation JSON format:
    {
        "clip_bars": 4,
        "params": [
            {
                "name": "Macro 1",
                "envelope_index": 0,
                "min": 0, "max": 100,
                "points": [{"time": 0, "value": 0.5}, {"time": 4, "value": 1.0}]
            }
        ]
    }
"""

import sys
import os
import gzip
import json
import xml.etree.ElementTree as ET


def read_alc(alc_path):
    """Read .alc file (gzip or raw XML) and return parsed root."""
    with open(alc_path, 'rb') as f:
        data = f.read()
    try:
        xml_str = gzip.decompress(data).decode('utf-8')
    except Exception:
        xml_str = data.decode('utf-8')
    return ET.fromstring(xml_str), xml_str


def build_param_bounds(root):
    """
    Build parameter bounds map from the .alc XML.
    Maps AutomationTarget Id -> {min, max, is_int, is_bool}
    Ported from main.py's two-pass parameter parsing.
    """
    param_id_to_name = {}
    param_bounds = {}

    # Pass 1: Collect bounds from all elements with Id
    for param in root.findall('.//*[@Id]'):
        p_tag = param.tag
        p_id = param.get('Id')
        if not p_id:
            continue

        name = None
        for n_tag in ['UserName', 'Name', 'ParameterName']:
            n_node = param.find(f'.//{n_tag}')
            if n_node is not None and n_node.get('Value'):
                name = n_node.get('Value')
                break
        if name:
            param_id_to_name[p_id] = name

        min_v, max_v = None, None
        for find_tag, target in [('Min', 'min'), ('Max', 'max')]:
            node = param.find(find_tag)
            if node is None:
                node = param.find(f'.//{find_tag}')
            if node is not None:
                val = node.get('Value') or node.text
                if val:
                    try:
                        if target == 'min':
                            min_v = float(val)
                        else:
                            max_v = float(val)
                    except ValueError:
                        pass

        if min_v is not None or max_v is not None:
            bounds = {
                'min': min_v if min_v is not None else 0.0,
                'max': max_v if max_v is not None else 1.0,
                'is_int': ('Int' in p_tag or 'Enum' in p_tag),
                'is_bool': ('Bool' in p_tag),
            }
            param_bounds[p_id] = bounds
            for tgt in param.findall('AutomationTarget') + param.findall('ModulationTarget'):
                t_id = tgt.get('Id')
                if t_id:
                    param_bounds[t_id] = bounds
                    if name:
                        param_id_to_name[t_id] = name

    # Pass 2: MidiControllerRange (authoritative, overwrites Pass 1)
    parent_map = {child: parent for parent in root.iter() for child in parent}
    for tag_name in ['AutomationTarget', 'ModulationTarget']:
        for tgt in root.findall(f'.//{tag_name}'):
            tid = tgt.get('Id')
            if not tid:
                continue
            par = parent_map.get(tgt)
            if par is None:
                continue
            mcr = par.find('MidiControllerRange')
            if mcr is None:
                continue
            minv = maxv = None
            mn = mcr.find('Min')
            mx = mcr.find('Max')
            if mn is not None:
                try:
                    minv = float(mn.get('Value') or mn.text or '')
                except (ValueError, TypeError):
                    pass
            if mx is not None:
                try:
                    maxv = float(mx.get('Value') or mx.text or '')
                except (ValueError, TypeError):
                    pass
            if minv is not None or maxv is not None:
                prev = param_bounds.get(tid, {})
                param_bounds[tid] = {
                    'min': minv if minv is not None else 0.0,
                    'max': maxv if maxv is not None else 1.0,
                    'is_int': prev.get('is_int', False),
                    'is_bool': prev.get('is_bool', False),
                }
                if tid not in param_id_to_name:
                    gpar = parent_map.get(par)
                    for src in ([par, gpar] if gpar is not None else [par]):
                        for ntag in ['ParameterName', 'UserName', 'Name']:
                            nn = src.find(ntag)
                            if nn is not None and nn.get('Value'):
                                param_id_to_name[tid] = nn.get('Value')
                                break
                        if tid in param_id_to_name:
                            break

    return param_bounds, param_id_to_name


def inject_automation(root, params_data, clip_bars):
    """
    Inject automation points into existing ClipEnvelopes in the template.
    Ported directly from main.py's automate_only flow.
    """
    total_beats = clip_bars * 4.0

    # Update loop length
    loop_node = root.find('.//Loop')
    if loop_node is not None:
        for tag in ['LoopEnd', 'HiddenLoopEnd', 'OutMarker']:
            el = loop_node.find(tag)
            if el is not None:
                el.set('Value', str(total_beats))

    # Find all envelopes
    all_envelopes = root.findall('.//ClipEnvelope') + root.findall('.//AutomationEnvelope')

    if not all_envelopes:
        raise ValueError("Template has no ClipEnvelopes. "
                         "Record automation on each parameter in Ableton first, then re-export the clip.")

    # Build param map by envelope index
    param_map = {}
    for p in params_data:
        idx = p.get('envelope_index')
        if idx is not None:
            param_map[int(idx)] = p

    # Build bounds from XML
    param_bounds, param_id_to_name = build_param_bounds(root)

    params_written = 0
    total_points = 0

    # Debug: print envelope info to stderr (doesn't pollute JSON stdout)
    import sys
    debug_lines = []

    for env_idx, env in enumerate(all_envelopes):
        events_node = env.find('.//Events')
        if events_node is None:
            continue

        # Get PointeeId
        pointee_id = None
        p_node = env.find('.//EnvelopeTarget/PointeeId')
        if p_node is not None:
            pointee_id = p_node.get('Value')

        # Determine event type and bounds
        event_tag = 'FloatEvent'
        template_min = 0.0
        template_max = 1.0

        if pointee_id and pointee_id in param_bounds:
            template_min = param_bounds[pointee_id]['min']
            template_max = param_bounds[pointee_id]['max']
            if param_bounds[pointee_id]['is_int']:
                event_tag = 'IntEvent'
            elif param_bounds[pointee_id]['is_bool']:
                event_tag = 'BoolEvent'

        # Sniff existing events for actual range, then clear
        sniffed_max = template_max
        existing_events = list(events_node)
        for child in existing_events:
            if not (pointee_id and pointee_id in param_bounds):
                event_tag = child.tag
            try:
                val_str = child.get('Value', '1.0')
                if val_str.lower() == 'true':
                    val = 1.0
                elif val_str.lower() == 'false':
                    val = 0.0
                else:
                    val = float(val_str)
                if val > sniffed_max:
                    sniffed_max = val
            except (ValueError, TypeError):
                pass
            events_node.remove(child)

        # Get user params for this envelope
        user_param = param_map.get(env_idx, {})

        # Bounds priority:
        # 1. XML-derived bounds (from build_param_bounds / MidiControllerRange) — most reliable
        # 2. Sniffed from existing FloatEvent values in the template — good fallback
        # 3. User-provided min/max from scanner — only when XML has no bounds and nothing sniffed
        xml_has_bounds = (pointee_id and pointee_id in param_bounds)

        if not xml_has_bounds:
            # No XML bounds — try user-provided, then sniff
            if "min" in user_param and "max" in user_param:
                try:
                    template_min = float(user_param["min"])
                    template_max = float(user_param["max"])
                except (ValueError, TypeError):
                    pass
            # Snap sniffed max to common ranges
            if sniffed_max > template_max:
                if sniffed_max <= 127.0:
                    template_max = 127.0
                elif sniffed_max <= 255.0:
                    template_max = 255.0
                elif sniffed_max <= 256.0:
                    template_max = 256.0
                elif sniffed_max <= 1000.0:
                    template_max = 1000.0
                else:
                    template_max = sniffed_max
            if event_tag in ['IntEvent', 'EnumEvent'] and template_max <= 1.0:
                template_max = 127.0
        else:
            # XML bounds exist — still check sniffed in case XML bounds are too narrow
            if sniffed_max > template_max:
                template_max = sniffed_max

        if template_max <= template_min:
            template_max = template_min + 1.0

        # Detect log-scale (frequency) params from XML name, range, or scanner flag
        env_name = param_id_to_name.get(pointee_id, '?')
        use_log = False
        if event_tag == 'FloatEvent' and template_min > 0 and template_max > template_min:
            if user_param.get('is_log', False):
                use_log = True
            elif any(kw in (env_name or '').lower() for kw in ['cutoff', 'freq']):
                use_log = True
            else:
                ratio = template_max / template_min
                if ratio >= 100 and template_min >= 10 and template_max >= 5000:
                    use_log = True

        # Debug info
        user_name = user_param.get('name', '(none)')
        debug_lines.append(f"env[{env_idx}] pointee={pointee_id} name='{env_name}' → user='{user_name}' "
                          f"xml_bounds={xml_has_bounds} final=[{template_min},{template_max}] sniffed={sniffed_max} "
                          f"user=[{user_param.get('min','?')},{user_param.get('max','?')}] "
                          f"tag={event_tag} useLog={use_log} pts={len(user_param.get('points',[]))}")

        # Write anchor event (value must be in actual parameter space, not 0-1)
        anchor_value = (template_min * (template_max / template_min) ** 0.5) if use_log else (template_min + template_max) / 2
        anchor = ET.SubElement(events_node, event_tag)
        anchor.set('Id', '0')
        anchor.set('Time', '-63072000')
        if event_tag == 'BoolEvent':
            anchor.set('Value', 'false')
        elif event_tag in ['IntEvent', 'EnumEvent']:
            anchor.set('Value', str(int(round(anchor_value))))
        else:
            anchor.set('Value', f"{anchor_value:.5f}".rstrip('0').rstrip('.'))

        # Write automation points
        user_points = user_param.get("points", [])
        event_id = 1

        if user_points:
            user_points.sort(key=lambda x: float(x.get("time", 0.0)))
            for i, pt in enumerate(user_points):
                t = float(pt.get("time", 0.0))
                v = float(pt.get("value", 0.0))
                cv = float(pt.get("curve", 0.0))

                el = ET.SubElement(events_node, event_tag)
                el.set('Id', str(event_id))
                el.set('Time', str(round(t, 5)))

                clamped_v = max(0.0, min(1.0, v))
                if use_log:
                    scaled_v = template_min * (template_max / template_min) ** clamped_v
                else:
                    scaled_v = template_min + (clamped_v * (template_max - template_min))

                if event_tag == 'BoolEvent':
                    el.set('Value', 'true' if v >= 0.5 else 'false')
                elif event_tag in ['IntEvent', 'EnumEvent']:
                    el.set('Value', str(int(round(scaled_v))))
                else:
                    el.set('Value', f"{scaled_v:.5f}".rstrip('0').rstrip('.'))
                    if abs(cv) > 0.01 and i < len(user_points) - 1 and event_tag == 'FloatEvent':
                        el.set('CurveControl1X', str(0.5))
                        el.set('CurveControl1Y', str(-cv * 0.5))
                        el.set('CurveControl2X', str(0.5))
                        el.set('CurveControl2Y', str(cv * 0.5))

                event_id += 1
                total_points += 1

            params_written += 1

    # Print debug to stderr
    for line in debug_lines:
        print(line, file=sys.stderr)

    return params_written, total_points


def main():
    if len(sys.argv) < 4:
        print(json.dumps({
            "success": False,
            "error": "Usage: alc_injector.py <template_alc> <automation_json> <output_path>"
        }))
        sys.exit(1)

    template_path = sys.argv[1]
    auto_json_path = sys.argv[2]
    output_path = sys.argv[3]

    try:
        with open(auto_json_path, 'r') as f:
            auto_data = json.load(f)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to read automation JSON: {e}"}))
        sys.exit(1)

    clip_bars = auto_data.get('clip_bars', 4)
    params = auto_data.get('params', [])

    if not params:
        print(json.dumps({"success": False, "error": "No parameters in automation data"}))
        sys.exit(1)

    try:
        root, _ = read_alc(template_path)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to read template .alc: {e}"}))
        sys.exit(1)

    try:
        params_written, total_points = inject_automation(root, params, clip_bars)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Injection failed: {e}"}))
        sys.exit(1)

    # Serialize and compress
    try:
        new_xml = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        compressed = gzip.compress(new_xml)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'wb') as f:
            f.write(compressed)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to write .alc: {e}"}))
        sys.exit(1)

    # Count results — after injection, count what's actually there
    all_envelopes = root.findall('.//ClipEnvelope') + root.findall('.//AutomationEnvelope')
    envelope_count = len(all_envelopes)
    total_param_count = auto_data.get('total_param_count', len(params))
    requested_count = len(params)
    # Skipped = params with points that couldn't be written (no matching AutomationTarget)
    active_with_points = len([p for p in params if p.get('points') and len(p['points']) > 0])
    skipped_active = max(0, active_with_points - params_written)
    # Mismatched = total canvas params vs written (rack changed or no targets)
    mismatch_count = max(0, total_param_count - envelope_count)

    print(json.dumps({
        "success": True,
        "params_written": params_written,
        "total_points": total_points,
        "output_path": output_path,
        "envelope_count": envelope_count,
        "requested_count": requested_count,
        "total_param_count": total_param_count,
        "skipped_count": skipped_active,
        "mismatch_count": mismatch_count,
    }))


if __name__ == '__main__':
    main()
