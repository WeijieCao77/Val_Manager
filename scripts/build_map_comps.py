#!/usr/bin/env python3
"""
What pros actually bring to each map: role shapes and per-role agent pick rates.

    python3 scripts/build_map_comps.py

Reads scripts/cache/vlr_matches.json (scripts/fetch_vlr_matches.py: every map
of the cached VCT events, one row per player with his agent) and writes
src/data/mapComps.json, which the manager mode's automatic sheet reads
(engine/agents.ts). For every map and for all maps together:

  shapes  role counts in 决斗者/先锋/控场/哨卫 order, as "2-1-1-1", with their
          share of the comps played there
  picks   per role, each agent's share of comps on the map that ran it

Nothing is weighted or smoothed here; the engine decides what to ignore.
"""
import json, os
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROLES = ["决斗者", "先锋", "控场", "哨卫"]
AGENTS = {
    "决斗者": ["Jett", "Raze", "Phoenix", "Reyna", "Yoru", "Neon", "Iso", "Waylay"],
    "先锋": ["Sova", "Breach", "Skye", "KAY/O", "Fade", "Gekko", "Tejo"],
    "控场": ["Brimstone", "Viper", "Omen", "Astra", "Harbor", "Clove", "Miks"],
    "哨卫": ["Sage", "Cypher", "Killjoy", "Chamber", "Deadlock", "Vyse", "Veto"],
}
NAME = {a.lower().replace("/", ""): a for lst in AGENTS.values() for a in lst}
ROLE_OF = {a: r for r, lst in AGENTS.items() for a in lst}

src = json.load(open(os.path.join(ROOT, "scripts", "cache", "vlr_matches.json")))
shapes, picks, n = defaultdict(Counter), defaultdict(lambda: defaultdict(Counter)), Counter()
unknown = Counter()
for match in src["matches"].values():
    for m in match.get("maps", []):
        rows = m.get("rows") or []
        for tag in {r.get("tag") for r in rows}:
            names = [NAME.get(str(r.get("agent", "")).lower().replace("/", "")) for r in rows if r.get("tag") == tag]
            if len(names) != 5 or not all(names):
                unknown.update(str(r.get("agent")) for r in rows if r.get("tag") == tag and not NAME.get(str(r.get("agent", "")).lower().replace("/", "")))
                continue
            count = Counter(ROLE_OF[a] for a in names)
            key = "-".join(str(count[r]) for r in ROLES)
            for bucket in (m["map"], "*"):
                shapes[bucket][key] += 1
                n[bucket] += 1
                for a in names:
                    picks[bucket][ROLE_OF[a]][a] += 1

out = {"_note": "built by scripts/build_map_comps.py from scripts/cache/vlr_matches.json — "
                "shape = counts of 决斗者-先锋-控场-哨卫; shares of the comps played on that map",
       "maps": {}}
for bucket in sorted(n, key=lambda b: (b != "*", b)):
    total = n[bucket]
    out["maps"][bucket] = {
        "comps": total,
        "shapes": [[k, round(v / total, 4)] for k, v in shapes[bucket].most_common()],
        "picks": {r: [[a, round(v / total, 4)] for a, v in picks[bucket][r].most_common()] for r in ROLES},
    }
json.dump(out, open(os.path.join(ROOT, "src", "data", "mapComps.json"), "w"), ensure_ascii=False, indent=1)
print(f"{len(n) - 1} maps, {n['*']} comps" + (f"; unknown agents {dict(unknown)}" if unknown else ""))
