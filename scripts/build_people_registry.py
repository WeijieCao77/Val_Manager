#!/usr/bin/env python3
"""
One row per real person across the four worlds (2023, 2024, 2025, 2026), keyed
by vlr.gg player id — the only key that survives a handle change or a homonym.

    python3 scripts/build_people_registry.py

Writes scripts/cache/people_registry.json: for every person the years he is in,
the id he has in each, his club in each, and what the game currently says
about him (flag, real name, birthdate, photo). Reads caches only.
"""
import json, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p)))

ev = J("scripts", "cache", "vlr_event_stats.json")
ch = J("scripts", "cache", "vlr_challengers_hist.json")
profiles = J("scripts", "cache", "vlr_profiles.json")
dossier = J("src", "data", "dossier.json")
faces = set(os.listdir(os.path.join(ROOT, "public", "faces")))
over = J("data-raw", "overrides.json")

# ign(lower) -> [(year, club, vlrId, nat)]
rows = defaultdict(list)
for src in (ev, ch):
    for eid, lines in src["stats"].items():
        y = src["events"][eid]["year"]
        for l in lines:
            rows[l["ign"].lower()].append((y, l.get("club") or "", str(l["vlrId"]), l.get("nat") or ""))

def vlr_of(ign, year, tag):
    cands = rows.get(ign.lower(), [])
    ids = {c[2] for c in cands}
    if len(ids) == 1:
        return ids.pop(), "unique"
    # several men behind one handle: the one on this club this year
    hit = {c[2] for c in cands if c[0] == year and c[1].lower() == (tag or "").lower()}
    if len(hit) == 1:
        return hit.pop(), "club+year"
    hit = {c[2] for c in cands if c[1].lower() == (tag or "").lower()}
    if len(hit) == 1:
        return hit.pop(), "club"
    return None, "ambiguous" if ids else "absent"

people, loose = {}, []
for year in (2026, 2025, 2024, 2023):
    w = J("src", "data", "world.json" if year == 2026 else f"world_{year}.json")
    teams = {t["id"]: t for t in w["teams"]}
    for p in w["players"]:
        t = teams.get(p.get("teamId")) or {}
        d = dossier["players"].get(p["id"], {}) if not p["id"].startswith("H") else {}
        vid = d.get("vlr") if year == 2026 else (p.get("vlrId") or None)
        how = "dossier" if vid and year == 2026 else "world" if vid else None
        if not vid:
            vid, how = vlr_of(p["ign"], year, t.get("tag"))
        rec = {"year": year, "id": p["id"], "ign": p["ign"], "club": t.get("tag"), "tier": t.get("tier"),
               "region": p.get("region"), "nat": p.get("nat") or d.get("nat"), "real": p.get("realName") or d.get("real"),
               "birth": p.get("birth"), "img": bool(d.get("img") and d["img"] in faces), "overall": p.get("overall")}
        if not vid:
            loose.append({**rec, "why": how}); continue
        q = people.setdefault(vid, {"vlr": vid, "ign": p["ign"], "years": {}, "how": how})
        q["years"][str(year)] = rec

json.dump({"people": people, "loose": loose}, open(os.path.join(ROOT, "scripts", "cache", "people_registry.json"), "w"),
          ensure_ascii=False, indent=1)
n = len(people)
miss = lambda k: sum(1 for q in people.values() if not any(r.get(k) for r in q["years"].values()))
print(f"people {n}  loose rows {len(loose)}")
print("no photo", miss("img"), " no birth", miss("birth"), " no real name", miss("real"), " no flag", miss("nat"))
print("not in 2026:", sum(1 for q in people.values() if "2026" not in q["years"]))
print("vlr profile cached:", sum(1 for q in people.values() if q["ign"].lower() in profiles))
for l in loose[:40]: print("  loose", l["year"], l["id"], l["ign"], l["club"], l["why"])
