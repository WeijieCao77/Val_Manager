"""
Player × map × agent lines from vlr match pages, for the agent correction.

    python3 scripts/fetch_vlr_matches.py [--limit N] [--events id,id,...]

The event stats pages give a man's numbers over an event with his agents as
shares; the correction needs the numbers ON each agent. A match page holds,
per map, every player's agent and Rating, ACS, K/D/A, KAST, ADR, HS%, FK, FD
(both sides, T, CT). This reads the event's match list (/event/matches/<id>
?series_id=all) and then each match, one request per page, 6 s apart,
resume-safe; a match not yet played has no rows and is skipped.

The default event set is representative rather than complete — the 2026
Stage 1 and Stage 2 of all four leagues, Masters London 2026, Champions
2025, and two 2026 Challengers events — roughly 600 matches, an hour.

Cache: scripts/cache/vlr_matches.json
  events:  { eid: [match ids] }
  matches: { mid: { eid, maps: [ { game, map, teams: [tag, tag], score: [a, b],
                     rows: [ { vlrId, ign, tag, agent, rating2, acs, k, d, a, kast, adr, hs, fk, fd } ] } ] } }
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vlr_career as vlr  # noqa: E402

vlr.MIN_INTERVAL = 6.0
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_matches.json"
EVENTS = ROOT / "scripts" / "cache" / "vlr_event_stats.json"
DEFAULT_SLUGS = [
    "vct-2026-americas-stage-1", "vct-2026-emea-stage-1", "vct-2026-pacific-stage-1", "vct-2026-china-stage-1",
    "vct-2026-americas-stage-2", "vct-2026-emea-stage-2", "vct-2026-pacific-stage-2", "vct-2026-china-stage-2",
    "valorant-masters-london-2026", "valorant-champions-2025",
    "challengers-2026-north-america-ace-stage-3", "challengers-2026-brazil-gamers-club-stage-2",
]


def _num(s):
    s = re.sub(r"[%+]", "", s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _both(cell: str):
    m = re.search(r'class="side mod-both[^"]*">([^<]*)', cell)
    return _num(m.group(1)) if m else None


def parse_match(html: str) -> list[dict]:
    maps = []
    blocks = re.findall(r'<div class="vm-stats-game ?" data-game-id="(\d+)"(.*?)(?=<div class="vm-stats-game |<div class="vm-stats-container-end|$)', html, re.S)
    for gid, body in blocks:
        head = body.split('<div style="text-align: center; margin-top: 15px;">')[0]
        teams = [re.sub(r"\s+", " ", t).strip() for t in re.findall(r'team-name">\s*(.*?)\s*</div>', head, re.S)]
        scores = [int(x) for x in re.findall(r'class="score[^"]*"[^>]*>\s*(\d+)', head)]
        mp = re.search(r'<div class="map">.*?<span style="position: relative; display: inline-block;">\s*([^<]+?)\s*<', head, re.S)
        rows = []
        for row in re.findall(r'<div class="ovw-row">(.*?)</div>\s*</div>\s*(?=<div class="ovw-row">|</div>)', body, re.S):
            pm = re.search(r'href="/player/(\d+)/', row)
            ign = re.search(r'ovw-player-name[^>]*>\s*([^<]*?)\s*<', row)
            tag = re.search(r'ovw-player-tag[^>]*>\s*([^<]*?)\s*<', row)
            agent = re.search(r'/img/vlr/game/agents/([a-z0-9_-]+)\.png', row)
            cell = lambda col: _both(re.search(rf'data-col="{col}"[^>]*>(.*?)</(?:div|span)>', row, re.S).group(1)) if re.search(rf'data-col="{col}"', row) else None  # noqa: E731
            rows.append({"vlrId": pm.group(1) if pm else None, "ign": ign.group(1) if ign else "", "tag": tag.group(1) if tag else "",
                         "agent": agent.group(1) if agent else None,
                         "rating2": cell("rating2"), "acs": cell("acs"), "k": cell("kills"), "d": cell("deaths"), "a": cell("assists"),
                         "kast": cell("kast"), "adr": cell("adr"), "hs": cell("hsp"), "fk": cell("fb"), "fd": cell("fd")})
        if rows and len(scores) >= 2:
            maps.append({"game": gid, "map": mp.group(1).strip() if mp else None, "teams": teams[:2], "score": scores[:2], "rows": rows})
    return maps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--events", default="")
    args = ap.parse_args()
    evc = json.loads(EVENTS.read_text("utf-8"))["events"]
    by_slug = {e["slug"]: eid for eid, e in evc.items()}
    eids = [x for x in args.events.split(",") if x] or [by_slug[s] for s in DEFAULT_SLUGS if s in by_slug]
    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {"events": {}, "matches": {}}
    try:
        for eid in eids:
            if eid not in cache["events"]:
                html = vlr._get(f"https://www.vlr.gg/event/matches/{eid}/{evc[eid]['slug']}/?series_id=all")
                ids = list(dict.fromkeys(re.findall(r'href="/(\d+)/[^"]*"', html)))
                cache["events"][eid] = ids
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
                print(f"{evc[eid]['slug']}: {len(ids)} matches listed", flush=True)
        todo = [(eid, mid) for eid in eids for mid in cache["events"].get(eid, []) if mid not in cache["matches"]]
        if args.limit:
            todo = todo[: args.limit]
        print(f"{len(todo)} matches to fetch (~{len(todo) * vlr.MIN_INTERVAL / 60:.0f} min)", flush=True)
        for i, (eid, mid) in enumerate(todo, 1):
            maps = parse_match(vlr._get(f"https://www.vlr.gg/{mid}/"))
            cache["matches"][mid] = {"eid": eid, "maps": maps}
            if i % 5 == 0 or i == len(todo):
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
                print(f"  [{i}/{len(todo)}] {mid}: {len(maps)} maps", flush=True)
    except vlr.RateLimited as e:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print(f"!! {e}", file=sys.stderr)
        return 2
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
