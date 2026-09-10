"""
Every VCT event's stats page, with the counts this time.

    python3 scripts/fetch_vlr_event_stats.py [--limit N]

scripts/cache/vlr_seasons.json kept one averaged line per player per event and
dropped what the rating work needs: the agents he played there and how much,
the raw counts (K, D, A, FK, FD), clutches won AND played, maps, and the
event's dates. Ratios cannot be re-derived or re-combined without the counts
(KPR from K/rnd, first-contact share from (FK+FD)/rnd, clutch rate from won/
played), and a rating with no date cannot be back-tested without leaking the
future. So the same 45 pages (plus the 2026 Challengers events already listed
in vlr_challengers.json) are read again into their own cache, one event per
request, 6 s apart, resume-safe.

Cache: scripts/cache/vlr_event_stats.json
  events: { id: { slug, year, tier, dates, region } }
  stats:  { id: [ { vlrId, ign, club, nat, agents: [[slug, share%], …],
                    maps, rnd, rating2, acs, kd, kast, adr, kpr, apr, fkfd,
                    fkpr, fdpr, hs, clp, clw, clt, kmax, k, d, a, fk, fd } ] }
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vlr_career as vlr  # noqa: E402
from fetch_vlr_seasons import SEASON_PAGES, tier_of  # noqa: E402

vlr.MIN_INTERVAL = 6.0
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_event_stats.json"
VCL = ROOT / "scripts" / "cache" / "vlr_challengers.json"

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _num(s: str):
    s = s.strip().replace("%", "")
    if s in ("", "—", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _text(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def parse_dates(txt: str, year: int) -> tuple[str | None, str | None]:
    """'Jul 17—Sep 7' -> ('2026-07-17', '2026-09-07'); a wrap past December rolls the year."""
    m = re.match(r"(\w{3}) (\d+)\s*[—–-]\s*(?:(\w{3}) )?(\d+)", txt.strip())
    if not m:
        return None, None
    m1, d1, m2, d2 = m.group(1), int(m.group(2)), m.group(3) or m.group(1), int(m.group(4))
    y2 = year + (1 if MONTHS.get(m2, 1) < MONTHS.get(m1, 1) else 0)
    return f"{year}-{MONTHS[m1]:02d}-{d1:02d}", f"{y2}-{MONTHS[m2]:02d}-{d2:02d}"


def discover() -> dict[str, dict]:
    events: dict[str, dict] = {}
    for year, url in SEASON_PAGES:
        html = vlr._get(url)
        for eid, slug, card in re.findall(r'<a class="wf-card mod-flex event-item" href="/event/(\d+)/([^"]+)"(.*?)</a>', html, re.S):
            dm = re.search(r'mod-dates">\s*(.*?)\s*<', card, re.S)
            start, end = parse_dates(dm.group(1), int(year)) if dm else (None, None)
            events.setdefault(eid, {"slug": slug, "year": int(year), "tier": tier_of(slug),
                                    "dates": dm.group(1).strip() if dm else None, "start": start, "end": end})
    if VCL.exists():
        for url, rows in (json.loads(VCL.read_text("utf-8")).get("stats") or {}).items():
            m = re.search(r"/event/(\d+)/([^/?]+)", url)
            if m and m.group(1) not in events:
                events[m.group(1)] = {"slug": m.group(2), "year": 2026, "tier": "challengers",
                                      "dates": None, "start": None, "end": None}
    return events


def event_rows(eid: str, slug: str) -> list[dict]:
    html = vlr._get(f"https://www.vlr.gg/event/stats/{eid}/{slug}?min_rounds=0&agent=all")
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        if '<td class="mod-player' not in tr:
            continue
        pm = re.search(r'href="/player/(\d+)/', tr)
        ign = re.search(r'st-pl-name[^>]*>(.*?)</div>', tr, re.S)
        club = re.search(r'st-pl-country[^>]*>(.*?)</div>', tr, re.S)
        nat = re.search(r'class="flag mod-([a-z]+)"', tr)
        row = {
            "vlrId": pm.group(1) if pm else None,
            "ign": _text(ign.group(1)) if ign else "",
            "club": _text(club.group(1)) if club else "",
            "nat": nat.group(1) if nat else "",
            "agents": [[a, _num(p)] for a, p in re.findall(
                r'/img/vlr/game/agents/([a-z0-9_-]+)\.png">\s*<span class="st-agent-n">([^<]*)<', tr)],
        }
        for col in ("maps", "rnd", "rating2", "acs", "kd", "kast", "adr", "kpr", "apr", "fkfd",
                    "fbpr", "fdpr", "hsp", "clp", "kmax", "k", "d", "a", "fk", "fd"):
            m = re.search(rf'data-col="{col}"[^>]*>(.*?)</td>', tr, re.S)
            key = {"fbpr": "fkpr", "hsp": "hs"}.get(col, col)
            row[key] = _num(_text(m.group(1))) if m else None
        cl = re.search(r'st-cl-x">(\d+)</span>/<span class="st-cl-y">(\d+)', tr)
        row["clw"], row["clt"] = (int(cl.group(1)), int(cl.group(2))) if cl else (None, None)
        if row["rnd"]:
            out.append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {"events": {}, "stats": {}}
    try:
        events = discover()
        cache["events"].update(events)
        todo = [e for e in events if e not in cache["stats"]]
        if args.limit:
            todo = todo[: args.limit]
        print(f"{len(events)} events, {len(todo)} to fetch (~{len(todo) * vlr.MIN_INTERVAL / 60:.0f} min)", flush=True)
        for i, eid in enumerate(todo, 1):
            rows = event_rows(eid, events[eid]["slug"])
            cache["stats"][eid] = rows
            cache["fetched"] = date.today().isoformat()
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
            print(f"  [{i}/{len(todo)}] {events[eid]['slug'][:44]:44} {len(rows):3} lines  {events[eid].get('dates') or ''}", flush=True)
    except vlr.RateLimited as e:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print(f"!! {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
