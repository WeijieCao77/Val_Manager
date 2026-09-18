#!/usr/bin/env python3
"""
Who was in a 2023–2025 world and is not in the 2026 one — and where he went.

    python3 scripts/build_retired.py

Reads data-raw/people.json (scripts/build_people.py) and the four worlds and
writes analysis/people/retired.json + retired.md. "Not in the 2026 world" is
not "retired": most of them still play, below the leagues the game models. So
each man is put in one of four groups by what vlr.gg and The Spike show today:

  bench     a staff role now (coach / analyst / manager), on either site or
            on a 2026 club in the game
  gone      no club and no recorded match in the last twelve months
  idle      no club, but a match inside the last twelve months
  playing   on a club as a player, with a match this season

`gone` and `bench` are the candidates for a 退役卡包; `peak` is the best overall
he had in any year's world and `tier1` the years he was on a tier-one roster.
"""
import json, os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p)))
TODAY = date(2026, 9, 18)
YEAR_AGO = "2025-09-18"
SEASON = "2026-01-01"

people = J("data-raw", "people.json")
reg = J("scripts", "cache", "people_registry.json")["people"]
world = J("src", "data", "world.json")
staff26 = {}
for t in world["teams"]:
    c = t.get("coach") or {}
    for n in [c.get("name")] + list(c.get("assistants") or []):
        if n:
            staff26[n.lower()] = t["tag"]

STAFF_WORDS = ("coach", "analyst", "manager", "director", "owner", "staff", "streamer", "content")
rows = []
for vid, q in reg.items():
    if "2026" in q["years"]:
        continue
    who = people.get(vid) or {}
    years = q["years"]
    role = (who.get("currentRole") or "").lower()
    last = who.get("lastMatch")
    if any(w in role for w in STAFF_WORDS) or (q["ign"].lower() in staff26 and not who.get("current")):
        group = "bench"
    elif not who.get("current"):
        group = "gone" if (not last or last < YEAR_AGO) else "idle"
    else:
        group = "playing" if (last and last >= SEASON) else "idle"
    best = max(years.values(), key=lambda r: r.get("overall") or 0)
    rows.append({
        "vlr": vid, "ign": q["ign"], "real": who.get("real"), "nat": who.get("nat"), "group": group,
        "now": ", ".join(who.get("current") or []) or None, "role": who.get("currentRole"), "lastMatch": last,
        "peak": best.get("overall"), "peakYear": best["year"], "peakClub": best.get("club"),
        "tier1": sorted(int(y) for y, r in years.items() if r.get("tier") == 1),
        "years": sorted(int(y) for y in years), "region": best.get("region"), "photo": bool(who.get("img")),
        "coachIn2026": staff26.get(q["ign"].lower()),
    })
rows.sort(key=lambda r: (-(len(r["tier1"]) > 0), -(r["peak"] or 0)))
json.dump(rows, open(os.path.join(ROOT, "analysis", "people", "retired.json"), "w"), ensure_ascii=False, indent=1)

CN = {"bench": "转教练 / 幕后", "gone": "退役或一年以上无比赛", "idle": "无队（近一年有过比赛，含国家队、表演赛）", "playing": "仍在打（游戏没收录的队伍）"}
with open(os.path.join(ROOT, "analysis", "people", "retired.md"), "w") as f:
    f.write(f"# 2023–2025 历史档里有、2026 世界里没有的人\n\n共 {len(rows)} 人。\n\n")
    f.write("| 分组 | 人数 | 其中一级联赛出身 | 有照片 |\n|---|---|---|---|\n")
    for g in ("gone", "bench", "idle", "playing"):
        gr = [r for r in rows if r["group"] == g]
        f.write(f"| {CN[g]} | {len(gr)} | {sum(1 for r in gr if r['tier1'])} | {sum(1 for r in gr if r['photo'])} |\n")
    for g in ("gone", "bench", "idle", "playing"):
        gr = [r for r in rows if r["group"] == g]
        f.write(f"\n## {CN[g]}（{len(gr)}）\n\n| 选手 | 真名 | 国籍 | 巅峰 | 一级联赛年份 | 最后一场 | 现在 | 照片 |\n|---|---|---|---|---|---|---|---|\n")
        for r in gr:
            now = (r["now"] or "—") + (f"（{r['role']}）" if r["role"] else "") + (f" · 游戏内 {r['coachIn2026']} 教练组" if r["coachIn2026"] else "")
            f.write(f"| {r['ign']} | {r['real'] or '—'} | {r['nat'] or '—'} | {r['peak']}（{r['peakYear']} {r['peakClub'] or ''}） | "
                    f"{'/'.join(map(str, r['tier1'])) or '—'} | {r['lastMatch'] or '—'} | {now} | {'有' if r['photo'] else '无'} |\n")
from collections import Counter
print(len(rows), Counter(r["group"] for r in rows))
print("tier-one alumni:", Counter(r["group"] for r in rows if r["tier1"]))
