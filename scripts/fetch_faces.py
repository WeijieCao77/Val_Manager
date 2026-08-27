"""Download every face once, and keep a small copy in the repo.

Hotlinking somebody else's CDN on every card flip would spend their bandwidth
for us, so each picture is fetched once here, cut down to what a card actually
shows, and committed. Sources and credit are recorded in dossier.json's meta.

Three inputs, in order of preference:
  vlr_profiles.json   the player's own vlr.gg page      (399 players)
  vlr_staff.json      the club's staff listing on vlr    (coaches, 54)
  lp_faces.json       Liquipedia, for what neither has   (31 + 6)

Skips anything already on disk, so re-running after a partial scrape costs only
the new faces.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache"
PROFILES = CACHE / "vlr_profiles.json"
STAFF = CACHE / "vlr_staff.json"
LP = CACHE / "lp_faces.json"
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


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def coach_file(name: str) -> str:
    """A filename for a coach. Names carry accents and hangul; ids do not."""
    slug = re.sub(r"[^a-z0-9]", "", name.lower())
    if not slug:
        slug = hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
    return f"c-{slug}.webp"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    profiles = load(PROFILES, {})
    staff = load(STAFF, {"people": {}})
    lp = load(LP, {"players": {}, "coaches": {}})
    world = load(WORLD, {"players": [], "teams": []})

    # (label, destination filename, url) — players first, then the staff
    jobs: list[tuple[str, str, str]] = []
    for p in world["players"]:
        ign = p["ign"]
        url = (profiles.get(ign.lower()) or {}).get("img") \
            or (lp["players"].get(ign) or {}).get("url")
        if url:
            jobs.append((ign, f"{p['id']}.webp", url))

    names = set()
    for t in world["teams"]:
        c = t.get("coach") or {}
        if c.get("name"):
            names.add(c["name"])
    for a in (world.get("meta", {}).get("analysts") or []):
        names.add(a["name"])
    for name in sorted(names):
        url = (staff["people"].get(name.lower()) or {}).get("img") \
            or (lp["coaches"].get(name) or {}).get("url")
        if url:
            jobs.append((name, coach_file(name), url))

    done = skipped = failed = 0
    for label, fname, url in jobs:
        dest = OUT / fname
        if dest.exists() and not args.refresh:
            skipped += 1
            continue
        try:
            raw = get(url)
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            # webp keeps the transparent cut-outs vlr uses for some players
            square(im).save(dest, "WEBP", quality=QUALITY, method=6)
            done += 1
            print(f"  {label:<16} {dest.stat().st_size/1024:5.1f}KB", flush=True)
        except (urllib.error.URLError, OSError, ValueError) as e:
            failed += 1
            print(f"  !! {label}: {e}", file=sys.stderr, flush=True)
        if args.limit and done >= args.limit:
            break

    total = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"\nfaces: {done} new, {skipped} already had, {failed} failed"
          f" | {len(list(OUT.glob('*.webp')))} on disk, {total/1024/1024:.1f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
