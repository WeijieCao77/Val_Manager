"""The four VCT league marks, for the front page.

The front page introduces a game about four leagues, and the strip that says so
was standing in one club per region — which reads as "here are four teams", not
"here are four leagues", and put EDward Gaming's badge where VCT CN belongs.

These are the league logos themselves. One request to find the events, one per
league to read its header image: five in total, which is why this is a script
that runs once rather than anything the game does at runtime.

Same rules as every other scraper here: >= 3s between requests, and a 429 or a
403 aborts immediately with whatever was already saved. This project's IP has
been blocked before and the way back is to not earn it again.

    python3 scripts/fetch_league_logos.py
    python3 scripts/fetch_league_logos.py --check   # print what it would fetch
"""
from __future__ import annotations

import argparse
import gzip
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
OUT_JSON = ROOT / "scripts" / "cache" / "vlr_leagues.json"
OUT_DIR = ROOT / "public" / "leagues"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0
SIDE = 256
QUALITY = 84

# The game's own region keys, and how each league names itself on vlr.
LEAGUES = {
    "Americas": ["americas"],
    "EMEA": ["emea"],
    "Pacific": ["pacific"],
    "China": ["china", "cn"],
}

# vlr slugs the four leagues as vct-<year>-<region>-<stage>. It used to look
# for "champions-tour", which is what the events were called years ago and
# matches nothing today — the dry run found zero of four.
EVENT_ROW = re.compile(r'href="/event/(\d+)/(vct-\d{4}-[a-z0-9-]+)"', re.I)
HEADER_IMG = re.compile(r'event-header-thumb[\s\S]{0,300}?<img\s+src="([^"]+)"')


class RateLimited(RuntimeError):
    pass


def get(url: str) -> bytes:
    """One request, never sooner than MIN_INTERVAL after the last."""
    global _last
    wait = MIN_INTERVAL - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Encoding": "gzip",
        "Accept": "*/*",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(f"{e.code} on {url}") from e
        raise
    finally:
        _last = time.time()


# The page is dark. Three of the four marks are a bright single colour and read
# fine on it; VCT EMEA ships as solid black, which is invisible here — the
# official mark is used in white on dark grounds for exactly this reason.
DARK_LIMIT = 46
INK = (236, 232, 225)          # --text


def relight(im: "Image.Image") -> tuple["Image.Image", bool]:
    """Repaint a mark that is essentially black, keeping its alpha shape."""
    px = im.load()
    w, h = im.size
    total = 0
    seen = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            seen += 1
            total += (r * 299 + g * 587 + b * 114) // 1000
    if not seen or total / seen > DARK_LIMIT:
        return im, False
    lit = Image.new("RGBA", im.size, (0, 0, 0, 0))
    lp = lit.load()
    for y in range(h):
        for x in range(w):
            lp[x, y] = (*INK, px[x, y][3])
    return lit, True


def square(data: bytes) -> tuple[bytes, bool]:
    """Trim to content, centre on a transparent square, and write webp."""
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    box = im.getbbox()
    if box:
        im = im.crop(box)
    im, relit = relight(im)
    im.thumbnail((SIDE, SIDE), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
    canvas.paste(im, ((SIDE - im.width) // 2, (SIDE - im.height) // 2), im)
    out = io.BytesIO()
    canvas.save(out, "WEBP", quality=QUALITY, method=6)
    return out.getvalue(), relit


def find_events() -> dict[str, tuple[str, str]]:
    """Region -> (event id, slug), from the events index."""
    html = get("https://www.vlr.gg/events").decode("utf-8", "replace")
    found: dict[str, tuple[str, str]] = {}
    for eid, slug in EVENT_ROW.findall(html):
        for region, needles in LEAGUES.items():
            if region in found:
                continue
            if any(f"-{n}-" in f"{slug}-" for n in needles):
                found[region] = (eid, slug)
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="find the events and print them, fetch nothing else")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        events = find_events()
    except RateLimited as e:
        print(f"限流，已中止：{e}", file=sys.stderr)
        return 2

    for region in LEAGUES:
        got = events.get(region)
        print(f"  {region:<9} {'/event/' + got[0] + '/' + got[1] if got else '没找到'}")
    if args.check:
        return 0
    missing = [r for r in LEAGUES if r not in events]
    if missing:
        print(f"没有找到这些赛区的联赛页：{'、'.join(missing)}", file=sys.stderr)
        return 1

    saved: dict[str, dict[str, str]] = {}
    try:
        for region, (eid, slug) in events.items():
            page = get(f"https://www.vlr.gg/event/{eid}/{slug}").decode("utf-8", "replace")
            m = HEADER_IMG.search(page)
            if not m:
                print(f"  {region}: 页面里没有找到联赛标", file=sys.stderr)
                continue
            url = m.group(1)
            if url.startswith("//"):
                url = "https:" + url
            elif url.startswith("/"):
                url = "https://www.vlr.gg" + url
            img = get(url)
            blob, relit = square(img)
            (OUT_DIR / f"{region}.webp").write_bytes(blob)
            saved[region] = {"event": eid, "slug": slug, "url": url,
                             "relit": relit}
            print(f"  ✓ {region} ← {url}" + ("（原图是黑色，已改为浅色）" if relit else ""))
    except RateLimited as e:
        print(f"限流，已中止并保存进度：{e}", file=sys.stderr)
    finally:
        OUT_JSON.write_text(json.dumps(saved, ensure_ascii=False, indent=1))

    print(f"存下 {len(saved)}/{len(LEAGUES)} 个联赛标 → public/leagues/")
    return 0 if len(saved) == len(LEAGUES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
