"""Download every face once, and keep a small copy in the repo.

Hotlinking somebody else's CDN on every card flip would spend their bandwidth
for us, so each picture is fetched once here, cut down to what a card actually
shows, and committed. Sources and credit are recorded in dossier.json's meta.

Four inputs, in order of preference:
  vlr_profiles.json   the player's own vlr.gg page      (399 players)
  vlr_staff.json      the club's staff listing on vlr    (coaches, 54)
  lp_faces.json       Liquipedia, for what neither has   (40 + 6)
  haojiao_faces.json  号角 haojiao.cc, for the Chinese and Pacific rosters that
                      none of the above photograph (21). Matched on exact tag
                      AND agreeing club, and the site's own default_player.png
                      is filtered out — it is a placeholder, not a person.
  legend_faces.json   Liquipedia event photos for the彩卡 (20) — a彩卡 is a
                      night, so it gets a picture from that night rather than
                      the studio portrait the ordinary card uses

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
LEGEND = CACHE / "legend_faces.json"
HAOJIAO = CACHE / "haojiao_faces.json"
WORLD = ROOT / "src" / "data" / "world.json"
OUT = ROOT / "public" / "faces"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 1.0          # a CDN image, not a rendered page
SIDE = 192                  # twice the largest size a round avatar is drawn at
# A彩卡 is the photograph — it fills the card — so those are kept as a portrait
# at card proportions instead of the square an avatar needs.
LEGEND_W, LEGEND_H = 360, 500
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


def is_placeholder(im: Image.Image) -> bool:
    """
    A grey cut-out standing in for a person, dressed up as a photograph.

    vlr serves /img/base/ph/sil.png for most players it has no picture of, and
    that one is filtered at the scrape. brawk had a different one — a
    per-player upload that is a flat grey bust — so it came through as a real
    photograph and sat on his card looking nothing like the silhouette the game
    draws for everyone else. No press photograph is entirely colourless: across
    the 430 faces the median saturation is 17 and the next lowest after brawk's
    zero is well clear of this line.
    """
    small = im.convert("RGB").resize((64, 64))
    px = list(small.getdata())
    sat = sum(max(p) - min(p) for p in px) / len(px)
    return sat < 3.0


def portrait(im: Image.Image, crop: dict | None = None) -> Image.Image:
    """
    Crop to the card's shape.

    By default: centre horizontally, take from the top, because the bottom
    third of a card is caption and a face that lands there is a face nobody
    sees. `crop` overrides that for the photographs where the subject is low
    in the frame — `cy` is where his face is as a fraction of the height, and
    `zoom` is how much of the frame to keep.
    """
    want = LEGEND_W / LEGEND_H
    w, h = im.size
    if crop:
        keep_h = max(1, int(h * float(crop.get("zoom", 1.0))))
        keep_w = max(1, int(keep_h * want))
        if keep_w > w:
            keep_w, keep_h = w, int(w / want)
        # put the face a third of the way down the kept region, which is where
        # the card shows it above the caption
        cy = float(crop.get("cy", 0.4)) * h
        y = int(min(max(0, cy - keep_h * 0.34), h - keep_h))
        cx = float(crop.get("cx", 0.5)) * w
        x = int(min(max(0, cx - keep_w / 2), w - keep_w))
        im = im.crop((x, y, x + keep_w, y + keep_h))
    elif w / h > want:
        new_w = int(h * want)
        x = (w - new_w) // 2
        im = im.crop((x, 0, x + new_w, h))
    else:
        new_h = int(w / want)
        y = min(int(h * 0.08), max(0, h - new_h))
        im = im.crop((0, y, w, y + new_h))
    return im.resize((LEGEND_W, LEGEND_H), Image.LANCZOS)


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


def legend_file(lid: str) -> str:
    """`L:zeek-champions-2021` is not a filename; `l-zeek-champions-2021` is."""
    return "l-" + re.sub(r"[^a-z0-9-]", "-", lid.split(":", 1)[-1].lower()) + ".webp"


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
    hj = load(HAOJIAO, {"players": {}})
    world = load(WORLD, {"players": [], "teams": []})

    # (label, destination filename, [urls to try in order]) — players first,
    # then the staff. A LIST, not one url: the preferred source can turn out to
    # be a grey cut-out dressed as a photograph, and when it does the next
    # source should get its turn rather than the player being left faceless.
    jobs: list[tuple[str, str, list[str]]] = []
    for p in world["players"]:
        ign = p["ign"]
        urls = [u for u in [(profiles.get(ign.lower()) or {}).get("img"),
                            (lp["players"].get(ign) or {}).get("url"),
                            (hj["players"].get(ign) or {}).get("url")] if u]
        if urls:
            jobs.append((ign, f"{p['id']}.webp", urls))

    names = set()
    for t in world["teams"]:
        c = t.get("coach") or {}
        if c.get("name"):
            names.add(c["name"])
    for a in (world.get("meta", {}).get("analysts") or []):
        names.add(a["name"])
    for name in sorted(names):
        urls = [u for u in [(staff["people"].get(name.lower()) or {}).get("img"),
                            (lp["coaches"].get(name) or {}).get("url")] if u]
        if urls:
            jobs.append((name, coach_file(name), urls))

    manual = load(CACHE / "manual_faces.json", {})
    crops: dict[str, dict] = {}
    for lid, pick in (load(LEGEND, {}).get("picks") or {}).items():
        if lid in manual:
            continue              # imported by hand; leave it alone
        if pick.get("url"):
            jobs.append((lid, legend_file(lid), [pick["url"]]))
            if pick.get("crop"):
                crops[legend_file(lid)] = pick["crop"]

    done = skipped = failed = skipped_grey = 0
    for label, fname, urls in jobs:
        dest = OUT / fname
        if dest.exists() and not args.refresh:
            skipped += 1
            continue
        saved = False
        for i, url in enumerate(urls):
            try:
                raw = get(url)
                im = Image.open(io.BytesIO(raw)).convert("RGBA")
                if is_placeholder(im):
                    skipped_grey += 1
                    nxt = "，改用下一个来源" if i + 1 < len(urls) else "，没有别的来源了"
                    print(f"  -- {label:<16} 是灰度剪影，不是照片{nxt}", flush=True)
                    continue
                # webp keeps the transparent cut-outs vlr uses for some players
                shaped = (portrait(im.convert("RGB"), crops.get(fname))
                          if fname.startswith("l-") else square(im))
                shaped.save(dest, "WEBP", quality=QUALITY, method=6)
                saved = True
                done += 1
                print(f"  {label:<16} {dest.stat().st_size/1024:5.1f}KB", flush=True)
                break
            except (urllib.error.URLError, OSError, ValueError) as e:
                print(f"  !! {label}: {e}", file=sys.stderr, flush=True)
        if not saved and urls:
            failed += 1
        if args.limit and done >= args.limit:
            break

    total = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"\nfaces: {done} new, {skipped} already had, {failed} failed,"
          f" {skipped_grey} 灰度剪影已剔除"
          f" | {len(list(OUT.glob('*.webp')))} on disk, {total/1024/1024:.1f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
