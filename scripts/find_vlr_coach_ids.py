"""
Find vlr ids for the coaches the dossier has none for, and fetch their careers.

    python3 scripts/find_vlr_coach_ids.py

Merges into scripts/cache/vlr_coach_careers.json (same shape as
fetch_vlr_coach_careers.py writes), plus an "unconfirmed" list for review.

vlr's plain /search (not /search/auto, which robots.txt disallows) lists
results as /search/r/player/<id>/idx links. Several of these names are common
words — Ann, Pablo, style, 742 — so a hit is never taken on the name alone: the
candidate's own page must list, under Current Teams, the club this game has
him at. Anyone who cannot be confirmed that way is left out and listed, not
guessed. Same pace and rules as the career fetcher: 8 s apart, stop and save on
429/403, cache merged after every coach.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_vlr_coach_careers import (  # noqa: E402
    DOSSIER, WORLD, RateLimited, _get, coaches, load_cache, save_cache, stints,
)

SUFFIX = re.compile(r"\s+(esports|e-sports|gaming|club|team|esport)$", re.I)


def key(name: str | None) -> str:
    s = (name or "").strip().lower().replace(".", "").replace("$", "s")
    prev = None
    while prev != s:
        prev, s = s, SUFFIX.sub("", s).strip()
    return s


def expected_clubs() -> dict[str, set[str]]:
    """coach name -> the keys of the club this game has him at (name and tag)"""
    world = json.loads(WORLD.read_text("utf-8"))
    out: dict[str, set[str]] = {}
    for t in world["teams"]:
        c = (t.get("coach") or {}).get("name")
        if c:
            out.setdefault(c, set()).update({key(t["name"]), key(t["tag"])})
    for a in (world.get("meta") or {}).get("analysts") or []:
        if a.get("name") and a.get("from"):
            out.setdefault(a["name"], set()).add(key(a["from"]))
            club = next((t for t in world["teams"] if t["name"] == a["from"] or t["tag"] == a["from"]), None)
            if club:
                out[a["name"]].update({key(club["name"]), key(club["tag"])})
    return out


def main() -> int:
    cache = load_cache()
    want = expected_clubs()
    missing = [n for n, v in coaches() if not v and n not in cache]
    unconfirmed = cache.setdefault("_unconfirmed", {})
    print(f"{len(missing)} coaches to search: {missing}", flush=True)
    try:
        for name in missing:
            page = _get("https://www.vlr.gg/search/?" + urllib.parse.urlencode({"q": name, "type": "players"}))
            ids = list(dict.fromkeys(re.findall(r'href="/search/r/player/(\d+)/', page)))[:4]
            confirmed = None
            tried = []
            for vid in ids:
                html = _get(f"https://www.vlr.gg/player/{vid}/x")
                got = stints(html)
                now = [s["team"] for s in got if s["current"]]
                tried.append({"vlrId": vid, "current": now})
                if any(key(t) in want.get(name, set()) for t in now):
                    confirmed = (vid, got)
                    break
            if confirmed:
                vid, got = confirmed
                cache[name] = {"vlrId": vid, "stints": got, "fetched": dt.date.today().isoformat(), "via": "search"}
                unconfirmed.pop(name, None)
                coaching = [s for s in got if s["role"] and "coach" in s["role"].lower()]
                print(f"  {name}: vlr {vid}, {len(coaching)} coaching stints", flush=True)
            else:
                unconfirmed[name] = {"candidates": tried, "expected": sorted(want.get(name, set()))}
                print(f"  {name}: not confirmed — candidates {tried}, expected club {sorted(want.get(name, set()))}", flush=True)
            save_cache(cache)
    except RateLimited as e:
        save_cache(cache)
        print(str(e), flush=True)
        return 2
    except urllib.error.HTTPError as e:
        save_cache(cache)
        print(f"HTTP {e.code}; stopping, progress saved", flush=True)
        return 1
    print(f"done; unconfirmed: {sorted(unconfirmed)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
