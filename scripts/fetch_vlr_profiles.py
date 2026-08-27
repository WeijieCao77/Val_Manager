"""Collect the human half of a player's record: face, flag, and what they won.

Why: the card mode needs a photo and a nationality on every card, and the
dossier needs a real trophy cabinet. All three live on one page — a vlr.gg
player profile carries the avatar, the flag, the real name, total winnings and
the full list of event placements — so this is one pass, not three.

Writes ONLY to scripts/cache/vlr_profiles.json. Nothing downstream reads it
until build_world.py is pointed at it.

Rate limits, per scripts/fetch_vlr_career.py and the terms we agreed to
follow: vlr.gg publishes no crawl-delay but has limited this project's IP once
before on volume, so >= 3s between requests, abort and save on 429/403, and the
cache merges rather than overwrites. Resuming a partial run costs nothing.
"""
from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "scripts" / "cache"
OUT = CACHE_DIR / "vlr_profiles.json"
CAREER = CACHE_DIR / "vlr_career.json"
CHALLENGERS = CACHE_DIR / "vlr_challengers.json"
WORLD = ROOT / "src" / "data" / "world.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0

# vlr serves this when a player has no photo of their own; it is not a face and
# should not be stored as one
SILHOUETTE = "/img/base/ph/sil.png"


class RateLimited(RuntimeError):
    pass


def _get(url: str) -> str:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code} on {url}") from e
        raise


def load(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save(data) -> None:
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ ids

def known_ids() -> dict[str, str]:
    """ign (lowercased) -> vlr player id, from every cache we already paid for."""
    out: dict[str, str] = {}

    def put(ign, pid):
        if ign and pid and str(ign).lower() not in out:
            out[str(ign).lower()] = str(pid)

    career = load(CAREER, {})
    for roster in (career.get("_teams") or {}).values():
        for ign, pid in roster.items():
            put(ign, pid)
    chal = load(CHALLENGERS, {})
    for t in (chal.get("teams") or {}).values():
        for r in t.get("roster") or []:
            put(r.get("ign"), r.get("vlrId"))
    for pid, p in (chal.get("players") or {}).items():
        put(p.get("ign"), pid)
    return out


SEARCH_RE = re.compile(
    r'href="/search/r/player/(\d+)/[^"]*"[\s\S]{0,400}?'
    r'class="search-item-title">\s*([^<]+?)\s*</div>')


def search_id(ign: str) -> str | None:
    """Resolve one ign the caches missed. /search is allowed; /search/auto is not."""
    url = "https://www.vlr.gg/search/?q=" + urllib.parse.quote(ign) + "&type=players"
    hits = SEARCH_RE.findall(_get(url))
    for pid, title in hits:
        if html.unescape(title).strip().lower() == ign.lower():
            return pid
    return hits[0][0] if hits else None


# ------------------------------------------------------------------ parse

AVATAR_RE = re.compile(
    r'wf-avatar mod-player[\s\S]{0,300}?<img\s+src="([^"]+)"')
REALNAME_RE = re.compile(r'class="player-real-name[^"]*">\s*([^<]*?)\s*</h2>')
FLAG_RE = re.compile(r'<i class="flag mod-([a-z]{2})"')
WINNINGS_RE = re.compile(r'Total Winnings[\s\S]{0,200}?\$([\d,]+)')
ITEM_RE = re.compile(
    r'<a class="wf-module-item player-event-item[^"]*"\s+href="/event/(\d+)/([^"]+)">'
    r'([\s\S]*?)</a>')
TITLE_RE = re.compile(r'class="text-of"[^>]*>\s*([\s\S]*?)\s*</div>')
PLACE_RE = re.compile(
    r'<span class="ge-text-light">\s*([\s\S]*?)\s*</span>\s*<br>\s*([\s\S]*?)\s*</div>')


def text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(s))).strip()


def parse_profile(h: str) -> dict:
    avatar = AVATAR_RE.search(h)
    img = avatar.group(1) if avatar else None
    if img and SILHOUETTE in img:
        img = None
    if img and img.startswith("//"):
        img = "https:" + img

    real = REALNAME_RE.search(h)
    flag = FLAG_RE.search(h)
    win = WINNINGS_RE.search(h)

    events = []
    start = h.find("Event Placements")
    if start >= 0:
        for eid, slug, body in ITEM_RE.findall(h[start:]):
            t = TITLE_RE.search(body)
            pl = PLACE_RE.search(body)
            year = re.findall(r"<div>\s*(\d{4})\s*</div>", body)
            events.append({
                "id": eid,
                "slug": slug,
                "event": text(t.group(1)) if t else slug,
                # "Playoffs – 1st" splits into the stage reached and the finish
                "stage": text(pl.group(1)).split("–")[0].strip() if pl else None,
                "place": text(pl.group(1)).split("–", 1)[1].strip() if pl and "–" in text(pl.group(1)) else None,
                "team": text(pl.group(2)) if pl else None,
                "year": int(year[-1]) if year else None,
            })

    return {
        "img": img,
        "real": text(real.group(1)) if real and real.group(1).strip() else None,
        "nat": flag.group(1) if flag else None,
        "winnings": int(win.group(1).replace(",", "")) if win else None,
        "events": events,
    }


# ------------------------------------------------------------------ run

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N fetches")
    ap.add_argument("--only", default="", help="comma-separated igns, for testing")
    ap.add_argument("--refresh", action="store_true", help="refetch already-cached players")
    args = ap.parse_args()

    world = load(WORLD, {"players": []})
    cache = load(OUT, {})
    ids = cache.get("_ids") or {}
    ids.update({k: v for k, v in known_ids().items() if k not in ids})

    wanted = [p for p in world["players"]]
    if args.only:
        pick = {s.strip().lower() for s in args.only.split(",")}
        wanted = [p for p in wanted if p["ign"].lower() in pick]

    done = fetched = 0
    try:
        for p in wanted:
            ign = p["ign"]
            key = ign.lower()
            if key in cache and not args.refresh:
                done += 1
                continue
            pid = ids.get(key)
            if not pid:
                pid = search_id(ign)
                fetched += 1
                if pid:
                    ids[key] = pid
                else:
                    cache[key] = {"miss": True, "ign": ign}
                    print(f"  ?  {ign}: no vlr player page", flush=True)
                    continue
            h = _get(f"https://www.vlr.gg/player/{pid}/x")
            fetched += 1
            prof = parse_profile(h)
            prof["vlrId"] = pid
            prof["ign"] = ign
            cache[key] = prof
            done += 1
            print(f"  ok {ign:<16} id={pid:<7} img={'y' if prof['img'] else '-'} "
                  f"nat={prof['nat'] or '--'} events={len(prof['events'])}", flush=True)
            if fetched % 20 == 0:
                cache["_ids"] = ids
                save(cache)
            if args.limit and fetched >= args.limit:
                print("limit reached", flush=True)
                break
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saving {done} and stopping", file=sys.stderr, flush=True)
    except KeyboardInterrupt:
        print("interrupted — saving", file=sys.stderr, flush=True)
    finally:
        cache["_ids"] = ids
        save(cache)

    have = [v for k, v in cache.items() if not k.startswith("_")]
    print(f"\ncached {len(have)}/{len(world['players'])} players "
          f"| photos {sum(1 for v in have if v.get('img'))} "
          f"| nat {sum(1 for v in have if v.get('nat'))} "
          f"| with events {sum(1 for v in have if v.get('events'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
