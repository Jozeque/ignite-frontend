#!/usr/bin/env python3
"""
ReelCrop - record (the logger you run alongside OBS)

Watches OBS read-only and logs your cursor in perfect sync with the recording.
You start and stop the recording in OBS yourself - this NEVER controls OBS, it
only observes it - then on stop it maps + renders the finished reel automatically.

One-time setup:
  1. OBS -> Tools -> WebSocket Server Settings -> tick "Enable WebSocket server".
     Note the Server Port (default 4455) and click "Show Connect Info" for the
     password.
  2. Put that port/password into reelcrop_config.json under "obs".
  3. (already done) pip install obsws-python

Use:
  python record.py            (or double-click record.cmd)
    -> it waits, watching OBS
    -> press Record in OBS and do your take (cursor logs in sync)
    -> press Stop in OBS when done (or press any key in this window)
    -> writes cursor_log.jsonl, then auto-renders the reel
"""
import ctypes
import json
import logging
import msvcrt
import os
import subprocess
import sys
import time

# obsws-python / websocket dump a full traceback on a failed connect - keep it quiet
logging.getLogger("obsws_python").setLevel(logging.CRITICAL)
logging.getLogger("websocket").setLevel(logging.CRITICAL)

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "reelcrop_config.json")
POLL_HZ = 60


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def cursor():
    p = POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(p))
    return int(p.x), int(p.y)


def tc_to_sec(tc):
    """'HH:MM:SS.mmm' -> seconds."""
    try:
        h, m, s = tc.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)
    except Exception:
        return 0.0


def newest_recording(cl):
    """Newest video in OBS's recording folder - a reliable fallback for when
    stop_record doesn't hand back the output path."""
    import glob
    try:
        folder = getattr(cl.get_record_directory(), "record_directory", None)
    except Exception:
        folder = None
    if not folder or not os.path.isdir(folder):
        return None
    vids = glob.glob(os.path.join(folder, "*.mp4")) + glob.glob(os.path.join(folder, "*.mkv"))
    return max(vids, key=os.path.getmtime) if vids else None


def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    obs = cfg.get("obs", {"host": "localhost", "port": 4455, "password": ""})

    try:
        import obsws_python as obsws
    except ImportError:
        print("Need obsws-python:  pip install obsws-python")
        return

    try:
        cl = obsws.ReqClient(host=obs.get("host", "localhost"),
                             port=int(obs.get("port", 4455)),
                             password=obs.get("password", ""), timeout=3)
    except Exception as e:
        print("Can't reach OBS WebSocket (%s)." % e)
        print("Enable it in OBS (Tools -> WebSocket Server Settings) and check "
              "host/port/password in reelcrop_config.json.")
        return

    # We only WATCH - you press Record/Stop in OBS yourself. Wait here until OBS
    # actually starts recording, then lock onto its timecode for exact sync.
    print("Ready - watching OBS. Press Record in OBS to begin (Ctrl+C here to quit).")
    try:
        while True:
            try:
                st = cl.get_record_status()
            except Exception:
                st = None
            if st is not None and getattr(st, "output_active", False):
                tc0 = tc_to_sec(getattr(st, "output_timecode", "00:00:00.000"))
                break
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nCancelled - nothing recorded.")
        return
    wall0 = time.perf_counter()

    print("Recording detected - tracking your cursor.")
    print("Stop the recording in OBS when you're done (or press any key here).\n")
    samples = []
    period = 1.0 / POLL_HZ
    next_t = time.perf_counter()
    poll = 0
    try:
        while True:
            now = time.perf_counter()
            t_video = tc0 + (now - wall0)
            x, y = cursor()
            samples.append({"t": round(t_video, 4), "x": x, "y": y})
            sys.stdout.write("\r  rec %6.1fs   x=%5d y=%5d   samples=%d   "
                             % (t_video, x, y, len(samples)))
            sys.stdout.flush()
            if msvcrt.kbhit():       # any key (with this window focused) stops
                msvcrt.getch()
                break
            poll += 1
            if poll >= 30:           # ~2x/sec: did you stop the recording in OBS?
                poll = 0
                try:
                    if not getattr(cl.get_record_status(), "output_active", True):
                        break
                except Exception:
                    pass
            next_t += period
            slack = next_t - time.perf_counter()
            if slack > 0:
                time.sleep(slack)
            else:
                next_t = time.perf_counter()
    except KeyboardInterrupt:
        pass

    # If you stopped logging with a key but OBS is still rolling, wait for OBS to
    # finish so the recording file is complete before we render it.
    try:
        while getattr(cl.get_record_status(), "output_active", False):
            sys.stdout.write("\r  logging stopped - waiting for OBS to stop recording...   ")
            sys.stdout.flush()
            time.sleep(0.3)
    except Exception:
        pass
    time.sleep(1.0)  # let OBS finish writing the file
    video = newest_recording(cl)

    log = os.path.join(HERE, "cursor_log.jsonl")
    with open(log, "w", encoding="utf-8") as f:
        for s in samples:
            f.write(json.dumps(s) + "\n")
    print("\n\nStopped. %d samples. Video: %s" % (len(samples), video))

    if not video or not os.path.exists(video):
        print("Couldn't get the recording path from OBS. Finish manually:")
        print('  python mapper.py cursor_log.jsonl')
        print('  python render_reel.py "<your video>" --keys crop_keys.json')
        return

    keys = os.path.join(HERE, "crop_keys.json")

    # unique output name per take: "<source name> reel.mp4" in the output folder
    out_dir = cfg.get("output_dir") or HERE
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception:
        out_dir = HERE
    base = os.path.splitext(os.path.basename(video))[0]
    reel = os.path.join(out_dir, base + " reel.mp4")

    print("\nMapping + rendering...")
    subprocess.call([sys.executable, os.path.join(HERE, "mapper.py"), log, "-o", keys])
    rc = subprocess.call([sys.executable, os.path.join(HERE, "render_reel.py"),
                          video, "--keys", keys, "-o", reel])
    if rc == 0 and os.path.exists(reel):
        print("\nDone -> " + reel)
        try:
            os.startfile(reel)          # open it in your default player
        except Exception:
            pass
    else:
        print("\nRender failed - check the messages above.")


if __name__ == "__main__":
    main()
