#!/usr/bin/env python3
"""
历史档的真实新人: who joined a modelled roster in 2024, 2025 and 2026 and was
not in the world the year before — so a career started in 2023, 2024 or 2025
can have them arrive when they really did.

    python3 scripts/build_arrivals.py

Writes src/data/arrivals.json, loaded only by historical careers (eras.ts
loadArrivals; src/engine/arrivals.ts brings them in). For each year Y, every
player on a club in world_Y (world.json for 2026) whose id is not in
world_{Y-1}. Ids are the worlds' own: a year world reuses the 2026 P-id for the
same vlr id and gives everyone else Hv<vlrId>, so an id is one person in every
file (scripts/build_world_year.py, check_people.ts).

Kept: a newcomer at a club that existed the year before (his club can sign
him), and any tier-one newcomer (a new club's signing still walks into the
world as a free agent). Dropped: tier-two newcomers at clubs new that year —
two hundred names a year a save would carry and nobody would sign.

Nothing is invented: each row is that year's record of the man, rated on the
card scale like the rest of that world.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p)))
worlds = {y: J("src", "data", f"world_{y}.json") for y in (2023, 2024, 2025)}
worlds[2026] = J("src", "data", "world.json")

out = {"_note": "built by scripts/build_arrivals.py — real newcomers by year for historical careers",
       "ratingScale": worlds[2025].get("meta", {}).get("ratingScale") or worlds[2026].get("meta", {}).get("ratingScale"),
       "years": {}}
for y in (2024, 2025, 2026):
    prev_players = {p["id"] for p in worlds[y - 1]["players"]}
    prev_teams = {t["id"]: t for t in worlds[y - 1]["teams"]}
    teams = {t["id"]: t for t in worlds[y]["teams"]}
    rows = []
    for p in worlds[y]["players"]:
        if p["id"] in prev_players or not p.get("teamId") or p.get("nowCoach"):
            continue
        t = teams.get(p["teamId"])
        if not t:
            continue
        known = p["teamId"] in prev_teams and prev_teams[p["teamId"]]["tag"] == t["tag"]
        if not known and t["tier"] != 1:
            continue
        rec = {k: v for k, v in p.items() if k not in ("agentR",)}
        rec["clubTag"] = t["tag"]
        rec["clubTier"] = t["tier"]
        rows.append(rec)
    out["years"][str(y)] = rows
    print(y, len(rows), "newcomers:", sum(r["clubTier"] == 1 for r in rows), "tier one")

json.dump(out, open(os.path.join(ROOT, "src", "data", "arrivals.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print("bytes", os.path.getsize(os.path.join(ROOT, "src", "data", "arrivals.json")))
