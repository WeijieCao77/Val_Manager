"""Clutch records from rib.gg, for the events vlr.gg has no round data for.

Why: vlr.gg's clutch column is blank for every VCT China match of 2026 —
its match pages say "stats from this map are not available yet" — so a CN
player's clutch record in the game stopped at his last international
event. rib.gg has the round data: its event pages carry a stats table with
clutches won AND clutch situations faced, per player, the same two numbers
vlr publishes elsewhere. One page per event.

What is read: the event page HTML, which embeds the table the page renders
(a Next.js RSC payload). Nothing under /api/ — rib's robots.txt disallows
it — and one page every three seconds, which is nowhere near the
"disruptive rate" its terms forbid.

Which events: scripts/cache/rib_events.json lists them — only events where
vlr has no clutch data, so the two sources never count the same clutch
twice when build_world.py adds them up.

  python3 scripts/fetch_rib_clutch.py            # every listed event
  python3 scripts/fetch_rib_clutch.py --refresh  # again, even if cached

Writes scripts/cache/rib_clutch.json; merges, never overwrites.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "scripts" / "cache" / "rib_events.json"
CACHE = ROOT / "scripts" / "cache" / "rib_clutch.json"
UA = ("Mozilla/5.0 (Macintosh) ValManagerGameBuild/0.1 "
      "(hobby esports-manager project; contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0


class RateLimited(RuntimeError):
    pass


def _get(url: str) -> str:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(f"rib.gg answered {e.code}. Stopping and saving.") from e
        raise


ROW = re.compile(
    r'\{"id":(?P<id>\d+),"name":"(?P<name>[^"]*)","photo":(?:"[^"]*"|null),"country":"(?P<country>[^"]*)",'
    r'"teamName":"(?P<team>[^"]*)","teamShortName":"(?P<tag>[^"]*)","agentsPlayed":\[[^\]]*\],'
    r'"mapsPlayed":(?P<maps>\d+),"rounds":(?P<rounds>\d+),"rating":(?P<rating>[\d.]+|null),"acs":(?P<acs>[\d.]+|null),'
    r'"kd":(?P<kd>[\d.]+|null),"kast":(?P<kast>[\d.]+|null),"adr":(?P<adr>[\d.]+|null),"kpr":(?P<kpr>[\d.]+|null),'
    r'"apr":(?P<apr>[\d.]+|null),"fkfd":(?P<fkfd>[\d.]+|null),"fkpr":(?P<fkpr>[\d.]+|null),"fdpr":(?P<fdpr>[\d.]+|null),'
    r'"hsPct":(?P<hs>[\d.]+|null),"clutches":(?P<clw>\d+),"clutchAttempts":(?P<clt>\d+),"clPct":(?P<clp>[\d.]+|null),'
    r'"kmax":(?P<kmax>\d+),"kills":(?P<kills>\d+),"deaths":(?P<deaths>\d+),"assists":(?P<assists>\d+),'
    r'"firstKills":(?P<fk>\d+),"firstDeaths":(?P<fd>\d+)\}'
)


def parse_event(html: str) -> list[dict]:
    """Every player's line in the event's stats table."""
    u = html.replace('\\"', '"').replace("\\\\", "\\")
    i = u.find('"statsData":[')
    if i < 0:
        return []
    out = []
    for m in ROW.finditer(u, i):
        d = m.groupdict()
        num = lambda k: (float(d[k]) if d[k] not in (None, "null") else None)  # noqa: E731
        out.append({
            "ign": d["name"], "tag": d["tag"], "team": d["team"], "country": d["country"],
            "maps": int(d["maps"]), "rnd": int(d["rounds"]),
            "R": num("rating"), "acs": num("acs"), "kd": num("kd"), "kast": num("kast"),
            "adr": num("adr"), "kpr": num("kpr"), "apr": num("apr"), "fkpr": num("fkpr"),
            "fdpr": num("fdpr"), "hs": num("hs"),
            "clw": int(d["clw"]), "clt": int(d["clt"]),
            "kills": int(d["kills"]), "deaths": int(d["deaths"]), "fk": int(d["fk"]), "fd": int(d["fd"]),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="refetch events already cached")
    args = ap.parse_args()
    want = json.loads(EVENTS.read_text("utf-8")) if EVENTS.exists() else {}
    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {"events": {}}
    events: dict = cache.setdefault("events", {})
    todo = [(eid, meta) for eid, meta in want.items()
            if not eid.startswith("_") and (args.refresh or eid not in events)]
    print(f"{sum(1 for k in want if not k.startswith('_'))} events listed, {len(todo)} to fetch", flush=True)
    try:
        for i, (eid, meta) in enumerate(todo, 1):
            html = _get(f"https://rib.gg/events/{eid}/{meta.get('slug') or 'x'}")
            rows = parse_event(html)
            if not rows:
                print(f"  [{i}/{len(todo)}] {eid} {meta.get('slug', '')}: no stats table found", flush=True)
                continue
            events[eid] = {**meta, "rows": rows}
            print(f"  [{i}/{len(todo)}] {eid} {meta.get('slug', '')[:40]:<40} {len(rows)} players, "
                  f"{sum(r['clt'] for r in rows)} clutch situations", flush=True)
    except RateLimited as e:
        print(f"!! {e}", file=sys.stderr)
    # per player, across the listed events
    players: dict = {}
    for eid, rec in events.items():
        for r in rec["rows"]:
            p = players.setdefault(r["ign"], {"tag": r["tag"], "country": r["country"],
                                              "rnd": 0, "clw": 0, "clt": 0, "events": []})
            p["rnd"] += r["rnd"]; p["clw"] += r["clw"]; p["clt"] += r["clt"]
            p["events"].append(eid)
            p["tag"] = r["tag"]
    cache["players"] = players
    cache["fetched"] = time.strftime("%Y-%m-%d")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
    print(f"\n{len(events)} events, {len(players)} players -> {CACHE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
