#!/usr/bin/env python3
"""
历代强队: twelve teams that won (or nearly won) a world event, as they were
that week — src/data/history_teams.json.

    python3 -m scripts.rating.build_history_teams

The five: the men who played the most rounds for the team at that event
(vlr's event page lists the roster; records.json has the rounds).

Each man's rating is the live algorithm (v15, as history_v16 runs it) taken
on the day after the event, the way the live card reads a player today: the
180-day decay and the 90-day recent channel on his own records up to then,
the career items (Q S T H E D, G, IGL, flexibility, breakout) at that cutoff,
compressed above 85, capped at 92. So 2021 Sentinels is rated on 2021 vlr
numbers, compared with 2021's hero baselines.

Attributes are his own shape moved to that rating (the live shiftAttrs rule):
the 2023-25 world's shape for an event from 2023 on, the world builder's
formulas on 2020-22 tier-one totals for 2021-22 events (retired_attrs_v16),
whichever exists when the preferred one does not, and the 2026 world's for a
man in neither (PatMen joined after the 2025 world was frozen). The caller bump follows
Liquipedia's verified IGL. Role is the role he played at that event.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from scripts.rating import history_v16 as H
from scripts.rating.retired_attrs_v16 import formula_shapes

ROOT = Path(__file__).resolve().parents[2]
B = ROOT / "analysis" / "rating" / "history_v16"
OUT = ROOT / "src" / "data" / "history_teams.json"

# chapter, event id, team name on the vlr event page, result, short label, region.
# Chapters run by measured difficulty, not by year (scripts/measure_history_teams.ts,
# 300 BO3 each, a middling silver retired five at +0, each opponent in the slot of his
# role — historyTeams.ts seated(): 39/27/23% · 16/8/8% · 7/6/8% · 8/6/6%), so the first
# chapter is the one a starting collection can clear and 2021 Sentinels — TenZ's
# Reykjavík — is the last.
STAGES = [
    (1, "449", "Acend", "冠军", "21 冠军赛", "EMEA"),
    (1, "466", "Gambit Esports", "冠军", "21 柏林", "EMEA"),
    (1, "1657", "Evil Geniuses", "冠军", "23 冠军赛", "Americas"),
    (2, "2097", "EDward Gaming", "冠军", "24 冠军赛", "China"),
    (2, "1014", "FunPlus Phoenix", "冠军", "22 哥本哈根", "EMEA"),
    (2, "1999", "Gen.G", "冠军", "24 上海", "Pacific"),
    (3, "2282", "Paper Rex", "冠军", "25 多伦多", "Pacific"),
    (3, "926", "OpTic Gaming", "冠军", "22 雷克雅未克", "Americas"),
    (3, "1921", "Sentinels", "冠军", "24 马德里", "Americas"),
    (4, "1188", "FNATIC", "冠军", "23 圣保罗", "EMEA"),
    (4, "1015", "LOUD", "冠军", "22 冠军赛", "Americas"),
    (4, "353", "Sentinels", "冠军", "21 雷克雅未克", "Americas"),
]
CITY = {"353": "雷克雅未克大师赛", "466": "柏林大师赛", "449": "2021 冠军赛", "926": "雷克雅未克大师赛",
        "1014": "哥本哈根大师赛", "1015": "2022 冠军赛", "1188": "LOCK//IN 圣保罗", "1657": "2023 冠军赛",
        "1921": "马德里大师赛", "1999": "上海大师赛", "2097": "2024 冠军赛", "2282": "多伦多大师赛"}


def main() -> int:
    events, recs = H.load()
    bases = H.fit_baselines(recs)
    scored = []
    for r in recs:
        if r["eid"] == "2766":
            continue
        s = H.score_record(r, bases)
        if s:
            scored.append({**r, **s})
    by = defaultdict(list)
    for r in scored:
        by[r["pid"]].append(r)
    car = H.Career(events, scored)
    igl = H.igl_years()
    worlds = H.world_shapes()

    # breakout (C_b), as history_v16 finds it: a first tier-one season in the top quarter of its region and role
    seasons, first_top = defaultdict(list), {}
    for pid, rr in by.items():
        top = [r for r in rr if r["level"] == "top"]
        for y in sorted({r["era"] for r in top}):
            yy = [r for r in top if r["era"] == y]
            if sum(r["n"] for r in yy) < 400:
                continue
            regs, roles = defaultdict(float), defaultdict(float)
            for r in yy:
                reg = H.region_of(events[r["eid"]]["slug"])
                if reg:
                    regs[reg] += r["n"]
                roles[r["role"]] += r["n"]
            if regs:
                seasons[(y, max(regs, key=regs.get), max(roles, key=roles.get))].append((H.personal(yy)["L"], pid))
            first_top.setdefault(pid, y)
    breakout = set()
    for (y, _, _), arr in seasons.items():
        arr.sort(reverse=True)
        for L, pid in arr[:max(1, math.ceil(len(arr) * .25))]:
            if first_top.get(pid) == y:
                breakout.add((pid, y))

    def era_rating(pid: str, cut: str) -> dict:
        rr = sorted((r for r in by.get(pid, []) if r["date"] < cut), key=lambda r: r["date"])
        pers = H.personal(rr, decay_to=cut)
        intl = car.international(pid, cut)
        sea = car.seasons(pid, cut, rr)
        w = [r["n"] * r["coverage"] * H.QUALITY_EVENT * H.dec(r["date"], cut, 180) for r in rr]
        G = 1.5 * sum(wi * car.environment(r) for wi, r in zip(w, rr)) / (pers["N"] + H.SHRINK)
        I = 2.0 if igl.get(pid) else 0.0
        F, _ = H.flexibility(rr)
        Cb = 1.0 if any((pid, y) in breakout for y in {r["era"] for r in rr}) else 0.0
        O = intl["Q"] + intl["S"] + intl["T"] + sea["D"] + intl["E"] + I + F + Cb
        S = pers["P"] + min(10, O) + min(4, intl["H"]) + G
        return {"rating": math.floor(H.compress(S) + .5), "P": round(pers["P"], 2), "O": round(O, 2),
                "H": round(intl["H"], 2), "G": round(G, 2), "N": round(pers["N"], 1)}

    picks = []
    for ch, eid, team, result, short, region in STAGES:
        ev = events[eid]
        roster = next(t for t in ev["teams"] if t["team"] == team)
        mine = [r for r in by_event(scored, eid) if r["pid"] in set(roster["players"])]
        five = sorted(mine, key=lambda r: -r["n"])[:5]
        assert len(five) == 5, (eid, team, [r["ign"] for r in mine])
        picks.append((ch, eid, team, result, short, region, ev, five))

    early = [r["pid"] for *_, ev, five in picks if ev["year"] <= 2022 for r in five]
    formula, pool = formula_shapes(set(early), events, recs)

    dossier = json.loads((ROOT / "src" / "data" / "dossier.json").read_text())
    now = {p["id"]: p for p in json.loads((ROOT / "src" / "data" / "world.json").read_text())["players"]}
    for wid, d in dossier["players"].items():
        if d.get("vlr") and wid in now and str(d["vlr"]) not in worlds:
            w = now[wid]
            worlds[str(d["vlr"])] = {2026: {"attrs": w["attrs"], "overall": w["overall"], "role": w["role"], "isIgl": bool(w.get("isIgl"))}}
    faces = {}
    for d in [*dossier["players"].values(), *dossier["hist"].values()]:
        if d.get("vlr") and d.get("img"):
            faces.setdefault(str(d["vlr"]), (d["img"], d.get("v")))
    for vid, f in json.loads((B / "early_faces.json").read_text()).items():
        faces.setdefault(vid, (f["file"], None))

    stages = []
    for i, (ch, eid, team, result, short, region, ev, five) in enumerate(picks):
        cut = (date.fromisoformat(ev["end"]) + timedelta(days=1)).isoformat()
        players = []
        for r in five:
            pid = r["pid"]
            er = era_rating(pid, cut)
            world = worlds.get(pid) or {}
            form = {0: formula[pid]} if pid in formula else {}
            prefer, other = (form, world) if ev["year"] <= 2022 else (world, form)
            shape = H.shaped(prefer or other, ev["year"], er["rating"], bool(igl.get(pid)))
            assert shape, (team, r["ign"], "no attribute shape")
            face = faces.get(pid)
            players.append({
                "vlrId": pid, "ign": r["ign"], "role": r["role"], "isIgl": bool(igl.get(pid)),
                "agents": [a for a, _ in sorted(r["sh"], key=lambda x: -x[1])[:3]],
                "rating": er["rating"], "attrs": shape["attrs"], "shapeFrom": "formula" if shape["year"] == 0 else shape["year"],
                "face": face[0] if face else None, "faceV": face[1] if face else None,
                "rounds": r["n"], "why": er,
            })
        stages.append({
            "id": f"h{ch}-{i % 3 + 1}", "chapter": ch, "eid": eid, "event": CITY[eid], "short": short,
            "year": ev["year"], "end": ev["end"], "team": team, "tag": five[0]["club"], "region": region,
            "result": result, "players": players,
            "rating": round(sum(p["rating"] for p in players) / 5, 1),
        })
        print(f"{short:10} {team:16} {stages[-1]['rating']:5}  " + "  ".join(f"{p['ign']} {p['rating']}" for p in players))
    OUT.write_text(json.dumps({"_note": "Generated by scripts/rating/build_history_teams.py; do not edit by hand.",
                               "formulaPool": pool, "stages": stages}, ensure_ascii=False, indent=1) + "\n")
    return 0


def by_event(scored: list[dict], eid: str) -> list[dict]:
    return [r for r in scored if r["eid"] == eid and r["level"] == "top"]


if __name__ == "__main__":
    raise SystemExit(main())
