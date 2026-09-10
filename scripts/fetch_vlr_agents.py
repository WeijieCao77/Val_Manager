"""
Every agent a modelled player has actually played, and how much.

    python3 scripts/fetch_vlr_agents.py [--limit N]

「VCT经理现在所有选手的所有英雄都是0%熟练度」. The game seeded proficiency from
`agentPool`, which is only the three or so agents vlr lists beside a name: those
were 100 and everything else was 0, so a man who has played 400 rounds of Yoru
knew it exactly as well as one who never touched it. A player's page carries the
whole table — Use, Rnd, rating, ACS per agent across his career — and that is
what proficiency should be read off.

One request per player at MIN_INTERVAL (6 s: vlr.gg has limited this IP before,
see scripts/fetch_vlr_career.py). Resume-safe: a player already in the cache is
not fetched again, and the cache is written after every player. Never lower the
interval; never run two vlr scrapers at once.

Cache: scripts/cache/vlr_agents.json
    { ign: { "vlrId": "...", "rnd": total, "agents": [ {a, use, rnd, R, acs, kd}, ... ] } }
"""
import argparse
import json
import re
import sys
import urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vlr_career as vlr  # noqa: E402  (shares the cookie jar, UA and throttle)

vlr.MIN_INTERVAL = 6.0

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_agents.json"
WORLD = ROOT / "src" / "data" / "world.json"
PROFILES = ROOT / "scripts" / "cache" / "vlr_profiles.json"
CAREER = ROOT / "scripts" / "cache" / "vlr_career.json"
VCL = ROOT / "scripts" / "cache" / "vlr_challengers.json"


def _f(x):
    try:
        return float(str(x).replace("%", ""))
    except ValueError:
        return None


def agent_rows(html: str) -> list[dict]:
    """The per-agent career table, one row per agent, in vlr's order (most used first)."""
    out = []
    for blob in re.findall(r'<td class="mod-agent">(.*?)</tr>', html, re.S):
        am = re.search(r"/img/vlr/game/agents/([a-z0-9_-]+)\.png", blob)
        cells = [re.sub(r"<[^>]+>", "", c).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", blob, re.S)]
        #   Use  Rnd  R  ACS  K:D  KAST  ADR  KPR  APR  FK:FD  K  D  A  FK  FD
        if not am or len(cells) < 5:
            continue
        rnd = _f(cells[1])
        if not rnd:
            continue
        use = re.search(r"\((\d+)\)", cells[0])
        row = {"a": am.group(1), "use": int(use.group(1)) if use else None, "rnd": int(rnd)}
        for i, k in ((2, "R"), (3, "acs"), (4, "kd")):
            v = _f(cells[i])
            if v is not None:
                row[k] = v
        out.append(row)
    return out


def known_ids() -> dict[str, str]:
    """{ign.lower(): vlrId} from every cache that has paid for one."""
    ids: dict[str, str] = {}
    if CAREER.exists():
        for roster in json.loads(CAREER.read_text("utf-8")).get("_teams", {}).values():
            for ign, vid in roster.items():
                if vid:
                    ids.setdefault(ign.lower(), str(vid))
    if VCL.exists():
        for t in json.loads(VCL.read_text("utf-8")).get("teams", {}).values():
            for m in t.get("roster", []):
                if m.get("vlrId") and m.get("ign"):
                    ids.setdefault(m["ign"].lower(), str(m["vlrId"]))
    if PROFILES.exists():
        for k, v in json.loads(PROFILES.read_text("utf-8")).items():
            if isinstance(v, dict) and v.get("vlrId"):
                ids[k.lower()] = str(v["vlrId"])  # the profile pass verified the person
    return ids


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}
    ids = known_ids()
    world = json.loads(WORLD.read_text("utf-8"))
    todo, no_id = [], []
    for p in world["players"]:
        ign = p["ign"]
        if ign in cache:
            continue
        vid = ids.get(ign.lower())
        (todo if vid else no_id).append((ign, vid))
    # No id in any cache is not "no page". Ask vlr's plain /search (robots.txt
    # only forbids /search/auto) and keep a hit only when the candidate's own
    # page shows the club the game has him at — common handles return several
    # people. 「vlr没有准确记录就去haojiao看…为什么单vlr没有就放弃了？」
    club_of = {p["ign"]: p.get("teamId") for p in world["players"]}
    tag_of = {t["id"]: (t.get("tag") or "", t.get("name") or "") for t in world["teams"]}
    found = []
    for ign, _ in list(no_id):
        tag, name = tag_of.get(club_of.get(ign) or "", ("", ""))
        if not tag:
            continue
        try:
            page = vlr._get("https://www.vlr.gg/search/?" + urllib.parse.urlencode({"q": ign, "type": "players"}))
        except vlr.RateLimited as e:
            print(f"!! {e}", file=sys.stderr)
            break
        cands = list(dict.fromkeys(re.findall(r'href="/search/r/player/(\d+)/', page)))[:3]
        for vid in cands:
            html = vlr._get(f"https://www.vlr.gg/player/{vid}/x")
            cur = re.search(r"Current Teams(.*?)Past Teams", html, re.S)
            blob = (cur.group(1) if cur else html[:20000]).lower()
            if tag.lower() in blob or name.lower() in blob:
                found.append((ign, vid))
                print(f"  search: {ign} -> vlr {vid} ({tag})", flush=True)
                break
    todo += found
    no_id = [x for x in no_id if x[0] not in {n for n, _ in found}]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(world['players'])} players, {len(cache)} cached, {len(todo)} to fetch "
          f"(~{len(todo) * vlr.MIN_INTERVAL / 60:.0f} min), {len(no_id)} without a vlr id", flush=True)
    if no_id:
        print("  no id: " + ", ".join(n for n, _ in no_id[:40]) + (" …" if len(no_id) > 40 else ""))

    def save():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")

    try:
        for i, (ign, vid) in enumerate(todo, 1):
            slug = re.sub(r"[^a-z0-9]+", "-", ign.lower()).strip("-") or "p"
            rows = agent_rows(vlr._get(f"https://www.vlr.gg/player/{vid}/{slug}/?timespan=all"))
            cache[ign] = {"vlrId": vid, "at": date.today().isoformat(),
                          "rnd": sum(r["rnd"] for r in rows), "agents": rows}
            save()
            if i % 10 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] {ign}: {len(rows)} agents, {cache[ign]['rnd']} rounds", flush=True)
    except vlr.RateLimited as e:
        save()
        print(f"\n!! {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        save()
        print("\ninterrupted — progress saved", file=sys.stderr)
    save()
    return 0


if __name__ == "__main__":
    sys.exit(main())
