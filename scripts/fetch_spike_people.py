#!/usr/bin/env python3
"""
thespike.gg player pages, as a third opinion on who somebody is.

    python3 scripts/fetch_spike_people.py [--limit N]

A Spike player page is Next.js and ships its record in __NEXT_DATA__: name,
surname, nickname, country, a photograph, a biography sentence carrying the
birthdate ("born March 2 1998"), current and past teams with join/leave days
and a position (Player / Coach / Inactive), and the latest matches. That is
everything Liquipedia gives us for a person, from a site that has not
blocked this project — so it is both a fallback and a cross-check.

Slugs come from the site's own sitemap (scripts/cache/spike_player_index.json,
slug -> ids). One slug can be several people (311 of our handles), so every
candidate is fetched and kept; build_people_audit.py decides which one is
ours by flag and clubs, never by handle alone.

robots.txt allows /player/. One request at a time, >= 3 s apart, stop and
save on 403/429, cache merges.
"""
from __future__ import annotations
import argparse, gzip, json, re, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "scripts" / "cache" / "spike_player_index.json"
OUT = ROOT / "scripts" / "cache" / "spike_people.json"
REG = ROOT / "scripts" / "cache" / "people_registry.json"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact yankejing711@gmail.com)"
MIN_INTERVAL = 3.0
_last = 0.0
MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}


class RateLimited(RuntimeError):
    pass


def get(url: str) -> str:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return (gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw).decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code} on {url}") from e
        raise


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse(h: str) -> dict | None:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m:
        return None
    p = (json.loads(m.group(1)).get("props", {}).get("pageProps", {}) or {}).get("player")
    if not p:
        return None
    born = re.search(r"born (\w+) (\d{1,2}),? (\d{4})", p.get("biography") or "")
    birth = None
    if born and born.group(1) in MONTHS:
        birth = f"{int(born.group(3)):04d}-{MONTHS[born.group(1)]:02d}-{int(born.group(2)):02d}"
    team = lambda t: {"title": t.get("title"), "position": t.get("position"),
                      "from": t.get("dateJoined"), "to": t.get("dateLeft")}
    rm = p.get("recentMatches") or []
    img = p.get("profileImageUrl") or None
    return {
        "id": str(p.get("id")), "slug": p.get("slug"), "nickname": p.get("nickname"),
        "name": p.get("name"), "surname": p.get("surname"),
        "country": p.get("country"), "nat": (p.get("countryCode") or "").lower() or None,
        "birth": birth, "img": img,
        "current": [team(t) for t in p.get("currentTeams") or []],
        "past": [team(t) for t in p.get("pastTeams") or []],
        "lastMatch": (rm[0].get("startTime") or "")[:10] if rm else None,
        "matches": p.get("recentMatchesCount"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    idx = json.loads(INDEX.read_text())
    reg = json.loads(REG.read_text())
    cache = json.loads(OUT.read_text()) if OUT.exists() else {}
    people = list(reg["people"].values()) + [{"ign": l["ign"], "years": {"x": l}} for l in reg["loose"]]
    # whoever is missing something goes first; the rest are fetched to cross-check
    def gaps(q):
        rs = q["years"].values()
        return sum(not any(r.get(k) for r in rs) for k in ("img", "birth", "real"))
    people.sort(key=lambda q: -gaps(q))
    # a man vlr lists under an alias is on The Spike under the id he registers
    # with (overrides.json `handles`): FiNESSE is /player/fns
    handles = json.loads((ROOT / "data-raw" / "overrides.json").read_text()).get("handles") or {}
    also = {v["vlr"].lower(): v["ign"] for v in handles.values() if isinstance(v, dict)}
    todo, queued = [], set()
    for q in people:
        for name in filter(None, (q["ign"], also.get(q["ign"].lower()))):
            for sid in idx.get(norm(name), []):
                if sid not in cache and sid not in queued:
                    queued.add(sid)
                    todo.append((norm(name), sid))
    print(f"{len(todo)} pages to fetch", flush=True)
    n = 0
    try:
        for slug, sid in todo:
            try:
                rec = parse(get(f"https://www.thespike.gg/player/{slug}/{sid}"))
            except RateLimited:
                raise
            except Exception as e:
                print(f"  !! {slug}/{sid}: {e}", flush=True); continue
            cache[sid] = rec or {"id": sid, "slug": slug, "miss": True}
            n += 1
            if rec:
                print(f"  ok {slug:<16} {sid:<6} {rec['nat'] or '--'} birth={rec['birth']} img={'y' if rec['img'] else '-'} "
                      f"cur={','.join(str(t['title']) for t in rec['current']) or '-'}", flush=True)
            if n % 20 == 0:
                OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
            if a.limit and n >= a.limit:
                break
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saved, stopping", file=sys.stderr, flush=True)
    finally:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    print(f"cached {len(cache)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
