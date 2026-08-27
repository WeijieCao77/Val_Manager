"""The faces vlr.gg does not have, from Liquipedia.

After the vlr pass, 119 of the 518 players and 15 of the 69 coach cards still
had no photograph — mostly tier-two, Chinese and Pacific rosters. Liquipedia
has a picture for about a quarter of them.

Identity is the whole problem here, and it is solved by the filename. Liquipedia
names a player photo after the player — "M80 Boni at VCT 2026 Americas Stage
2.jpg" — while everything else on the page is a team logo or an event card. So
a file is only accepted when the person's own tag appears in it as a whole
word, which is a claim about who is in the picture that we can actually check.
Anything else is skipped. Putting the wrong face on a real professional is a
worse outcome than showing no face.

Liquipedia's terms: >= 2s between API calls, and only the API (direct page
fetches answer 403). Images are CC-BY-SA — the file page URL is kept per photo
so the credit can point at it.

Writes ONLY to scripts/cache/lp_faces.json.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache"
OUT = CACHE / "lp_faces.json"
PROFILES = CACHE / "vlr_profiles.json"
STAFF = CACHE / "vlr_staff.json"
WORLD = ROOT / "src" / "data" / "world.json"

API = "https://liquipedia.net/valorant/api.php"
UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 2.0
_last = 0.0


class RateLimited(RuntimeError):
    pass


def api(params: dict) -> dict:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    url = API + "?" + urllib.parse.urlencode({**params, "action": "query", "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code}") from e
        raise


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def is_photo_of(fname: str, tag: str) -> bool:
    low = fname.lower()
    if "noimage" in low:
        return False
    if not low.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return False
    # the tag as a whole word — "Boni" matches "M80 Boni at ...", not "Bonito"
    return re.search(r"(?<![a-z0-9])" + re.escape(tag.lower()) + r"(?![a-z0-9])", low) is not None


def chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def find_files(names: list[str]) -> dict[str, str]:
    """name -> "File:..." for the ones with a photo we can attribute."""
    out: dict[str, str] = {}
    for batch in chunks(names, 30):
        r = api({"prop": "images", "imlimit": "500", "redirects": "1",
                 "titles": "|".join(batch)})
        q = r.get("query", {})
        back: dict[str, str] = {}
        for k in ("normalized", "redirects"):
            for m in q.get(k, []) or []:
                back[m["to"]] = m["from"]
        for p in (q.get("pages", {}) or {}).values():
            title = p.get("title", "")
            asked = back.get(title, title)
            name = next((x for x in batch if x.lower() == asked.lower()), asked)
            for f in [x["title"] for x in p.get("images", [])]:
                if is_photo_of(f, name):
                    out[name] = f
                    break
    return out


def resolve(files: list[str], width: int = 400) -> dict[str, dict]:
    """"File:..." -> {url, page} at a sane width."""
    out: dict[str, dict] = {}
    for batch in chunks(files, 30):
        r = api({"prop": "imageinfo", "iiprop": "url", "iiurlwidth": str(width),
                 "titles": "|".join(batch)})
        for p in (r.get("query", {}).get("pages", {}) or {}).values():
            info = (p.get("imageinfo") or [{}])[0]
            url = info.get("thumburl") or info.get("url")
            if url:
                out[p["title"]] = {"url": url, "page": info.get("descriptionurl")}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    world = load(WORLD, {"players": [], "teams": []})
    profiles = load(PROFILES, {})
    staff = load(STAFF, {"people": {}})
    cache = load(OUT, {})
    cache.setdefault("players", {})
    cache.setdefault("coaches", {})

    # only the ones still without a face after the two vlr passes
    want_players = [
        p["ign"] for p in world["players"]
        if not (profiles.get(p["ign"].lower()) or {}).get("img")
        and (args.refresh or p["ign"] not in cache["players"])
    ]
    names = set()
    for t in world["teams"]:
        c = t.get("coach") or {}
        if c.get("name"):
            names.add(c["name"])
    for a in (world.get("meta", {}).get("analysts") or []):
        names.add(a["name"])
    want_coaches = [
        n for n in sorted(names)
        if not (staff["people"].get(n.lower()) or {}).get("img")
        and (args.refresh or n not in cache["coaches"])
    ]

    print(f"没有照片的：选手 {len(want_players)}，教练 {len(want_coaches)}")
    try:
        pf = find_files(want_players)
        cf = find_files(want_coaches)
        urls = resolve(sorted({*pf.values(), *cf.values()}))
        for name, f in pf.items():
            if f in urls:
                cache["players"][name] = {"file": f, **urls[f]}
        for name, f in cf.items():
            if f in urls:
                cache["coaches"][name] = {"file": f, **urls[f]}
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saving what we have", file=sys.stderr)
    finally:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Liquipedia 补到：选手 {len(cache['players'])}，教练 {len(cache['coaches'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
