"""Club crests, for the back of an ordinary card.

A gold card is a player at a club, and the club was only ever three letters in
small type. The crest goes behind the portrait as a watermark — enough to read
the badge across a grid without competing with the face.

Team ids come from scripts/cache/vlr_staff.json, which already mapped all 78
clubs, so this is one request per club and nothing has to be resolved again.

Writes public/logos/<worldTeamId>.webp and scripts/cache/vlr_logos.json.
Same rules: >= 3s between requests, abort and save on 429/403.
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
STAFF = ROOT / "scripts" / "cache" / "vlr_staff.json"
OUT_JSON = ROOT / "scripts" / "cache" / "vlr_logos.json"
OUT_DIR = ROOT / "public" / "logos"
WORLD = ROOT / "src" / "data" / "world.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0
SIDE = 256
QUALITY = 82

LOGO = re.compile(r'team-header-logo[\s\S]{0,200}?<img\s+src="([^"]+)"')


class RateLimited(RuntimeError):
    pass


def get(url: str, binary: bool = False):
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw if binary else raw.decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code}") from e
        raise


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    world = load(WORLD, {"teams": []})
    teams = (load(STAFF, {}) or {}).get("teams") or {}
    cache = load(OUT_JSON, {})

    done = failed = 0
    try:
        for t in world["teams"]:
            vid = teams.get(t["id"])
            dest = OUT_DIR / f"{t['id']}.webp"
            if not vid:
                print(f"  ?  {t['tag']}: 没有 vlr 战队 id", file=sys.stderr)
                continue
            if dest.exists() and not args.refresh:
                continue
            h = get(f"https://www.vlr.gg/team/{vid}/x")
            m = LOGO.search(h)
            if not m:
                print(f"  ?  {t['tag']}: 页面上没有找到队标", file=sys.stderr)
                continue
            url = m.group(1)
            if url.startswith("//"):
                url = "https:" + url
            try:
                raw = get(url, binary=True)
                im = Image.open(io.BytesIO(raw)).convert("RGBA")
                # square canvas, logo centred, transparency kept — the card
                # tints it, so anything baked onto a background would fight it
                side = max(im.size)
                canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
                canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
                canvas.resize((SIDE, SIDE), Image.LANCZOS).save(
                    dest, "WEBP", quality=QUALITY, method=6)
                cache[t["id"]] = {"tag": t["tag"], "vlrId": vid, "url": url}
                done += 1
                print(f"  ok {t['tag']:<6} {dest.stat().st_size / 1024:5.1f}KB", flush=True)
            except (urllib.error.URLError, OSError, ValueError) as e:
                failed += 1
                print(f"  !! {t['tag']}: {e}", file=sys.stderr)
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saving and stopping", file=sys.stderr)
    finally:
        OUT_JSON.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    have = len(list(OUT_DIR.glob("*.webp")))
    total = sum(f.stat().st_size for f in OUT_DIR.glob("*.webp"))
    print(f"\n队标 {have}/{len(world['teams'])} 张，{total / 1024:.0f}KB（本次新增 {done}，失败 {failed}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
