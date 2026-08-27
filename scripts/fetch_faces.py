"""Download each player's photograph once, and keep a small copy in the repo.

Hotlinking owcdn.net from a deployed game would spend somebody else's
bandwidth on every card flip, so the picture is fetched once here, cut down to
what a card actually shows, and committed. Source and credit are recorded in
dossier.json's meta and shown on the credits panel.

Reads photo URLs out of scripts/cache/vlr_profiles.json (run
fetch_vlr_profiles.py first). Skips anything already on disk, so re-running
after a partial scrape costs only the new faces.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PROFILES = ROOT / "scripts" / "cache" / "vlr_profiles.json"
WORLD = ROOT / "src" / "data" / "world.json"
OUT = ROOT / "public" / "faces"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 1.0          # a CDN image, not a rendered page
SIDE = 192                  # twice the largest size a card draws it at
QUALITY = 80
_last = 0.0


def get(url: str) -> bytes:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def square(im: Image.Image) -> Image.Image:
    """Centre-crop to a square, biased to the top — these are head-and-shoulders."""
    w, h = im.size
    if w == h:
        box = im
    elif w > h:
        x = (w - h) // 2
        box = im.crop((x, 0, x + h, h))
    else:
        # keep the head, drop the jersey
        box = im.crop((0, 0, w, w))
    return box.resize((SIDE, SIDE), Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    profiles = json.loads(PROFILES.read_text(encoding="utf-8"))
    world = json.loads(WORLD.read_text(encoding="utf-8"))

    done = skipped = failed = 0
    for p in world["players"]:
        pid, ign = p["id"], p["ign"]
        prof = profiles.get(ign.lower()) or {}
        url = prof.get("img")
        dest = OUT / f"{pid}.webp"
        if not url:
            continue
        if dest.exists() and not args.refresh:
            skipped += 1
            continue
        try:
            raw = get(url)
            im = Image.open(io.BytesIO(raw))
            im = im.convert("RGBA")
            # webp keeps the transparent cut-outs vlr uses for some players
            square(im).save(dest, "WEBP", quality=QUALITY, method=6)
            done += 1
            print(f"  {ign:<16} {dest.stat().st_size/1024:5.1f}KB", flush=True)
        except (urllib.error.URLError, OSError, ValueError) as e:
            failed += 1
            print(f"  !! {ign}: {e}", file=sys.stderr, flush=True)
        if args.limit and done >= args.limit:
            break

    total = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"\nfaces: {done} new, {skipped} already had, {failed} failed"
          f" | {len(list(OUT.glob('*.webp')))} on disk, {total/1024/1024:.1f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
