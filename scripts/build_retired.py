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
import json, os, re
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

# ---- src/data/retired.json: the ones the game shows (资料库 · 退役, 每日挑战)
# Retired as players — `gone`, `bench`, and since 2026-09-26 `idle` (owner: TenZ,
# Sacy and the rest with no club, whose last games are show matches and
# national sides, count) — with a photograph on file. One man
# with two vlr pages (overrides `samePerson`, wqc = cb) is not retired at all.
#
# Since 2026-10-18 the retired series' study (analysis/rating/history_v16, the
# same one src/data/retired_cards.json is built from) has the last word on who
# is retired: it read every man's own vlr page on 2026-10-09, and a third of
# the `idle` group turned out to be still playing below the leagues the game
# models — they leave the list. Its early retirees (2020–22 internationals:
# SicK, zombs, ShahZaM…) join it, and a man with a 退役普卡 is shown at that
# card's number (`rating`) and its roles.
same = set((J("data-raw", "overrides.json").get("samePerson") or {}).keys())
dossier_hist = J("src", "data", "dossier.json").get("hist") or {}
worlds = {y: {p["id"]: p for p in J("src", "data", f"world_{y}.json")["players"]} for y in (2023, 2024, 2025)}
V16 = {r["vlrId"]: r for r in J("analysis", "rating", "history_v16", "players.json")}
CARDS = {c["vlrId"]: c for c in J("src", "data", "retired_cards.json")["normals"]}
STATUS = J("analysis", "rating", "history_v16", "status_verified.json")
# birthdates for the early retirees, who are in no world and so not in people.json:
# Liquipedia infoboxes (scripts/fetch_liquipedia_people.py --titles, 2026-10-18), by handle
LP = {k.lower(): v for k, v in J("scripts", "cache", "liquipedia_births_hist.json").items()}
LP.update({k.lower(): v for k, v in J("scripts", "cache", "liquipedia_people.json").items() if v.get("page")})


def age_on_2026(birth):
    """age on 1 January 2026 from a full date; None for a partial or missing one"""
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", birth or "")
    if not m:
        return None, None
    y, mo, d = (int(x) for x in m.groups())
    return f"{y}-{mo:02d}-{d:02d}", 2026 - y - (1 if (mo, d) > (1, 1) else 0)


def face_ok(face):
    return bool(face) and os.path.exists(os.path.join(ROOT, "public", "faces", face))


shown = []
for r in rows:
    pid = "Hv" + r["vlr"]
    face = (dossier_hist.get(pid) or {}).get("img")
    cls = (V16.get(r["vlr"]) or {}).get("class")
    if r["group"] not in ("gone", "bench", "idle") or r["vlr"] in same or not face_ok(face) or cls == "still-playing":
        continue
    last = max(r["years"])
    # peak off the year worlds, which are on the card scale (the registry keeps the old ruler)
    best = max((y for y in r["years"] if pid in worlds.get(y, {})), key=lambda y: (worlds[y][pid]["overall"], y == r["peakYear"]), default=None)
    peak_rec = worlds[best][pid] if best else {}
    last_rec = worlds.get(last, {}).get(pid) or peak_rec
    birth = (people.get(r["vlr"]) or {}).get("birth")
    if birth:
        y, m, d = (int(x) for x in birth.split("-"))
        age, est = 2026 - y - (1 if (m, d) > (1, 1) else 0), False
    else:
        # as the historical world had him, carried to 1 January 2026
        age, est = (last_rec.get("age") or 0) + (2026 - last), True
    card = CARDS.get(r["vlr"])
    shown.append({
        "id": pid, "ign": r["ign"], "real": r["real"], "nat": r["nat"], "region": r["region"] or last_rec.get("region"),
        "birth": birth, "age": age, "ageEstimated": est,
        "role": card["role"] if card else peak_rec.get("role") or last_rec.get("role"),
        "roles": card["roles"] if card else peak_rec.get("roles") or last_rec.get("roles"),
        "peak": peak_rec.get("overall", r["peak"]), "peakYear": best or r["peakYear"],
        "peakClub": reg[r["vlr"]]["years"][str(best)].get("club") if best else r["peakClub"],
        "lastYear": last, "lastClub": reg[r["vlr"]]["years"][str(last)].get("club"), "tier1": bool(r["tier1"]),
        "coach": cls == "coach-now" if cls else r["group"] == "bench", "img": face,
        "rating": card["rating"] if card else None, "v": (dossier_hist.get(pid) or {}).get("v"),
    })
have = {x["id"] for x in shown}
early = []
for vid, card in CARDS.items():
    if "Hv" + vid in have or (V16.get(vid) or {}).get("class") != "retired" or not face_ok(card.get("faceFile")):
        continue
    st, lp = STATUS.get(vid) or {}, LP.get(card["ign"].lower()) or {}
    birth, age = age_on_2026(lp.get("birth"))
    est = age is None
    if est:
        y = re.match(r"^(\d{4})", lp.get("birth") or "")
        # a birth year alone, or nothing: 21 in his first season, the way most of them started
        age = 2025 - int(y.group(1)) if y else 21 + (2026 - card["span"][0])
    v = V16[vid]
    shown.append({
        "id": card["playerId"], "ign": card["ign"], "real": st.get("real") or card.get("realName"), "nat": st.get("nat") or card.get("nat"),
        "region": card["region"], "birth": birth, "age": age, "ageEstimated": est, "role": card["role"], "roles": card["roles"],
        "peak": card["rating"], "peakYear": v.get("peakYear") or card["span"][1], "peakClub": card["clubTag"],
        "lastYear": int(card["last"][:4]), "lastClub": card["clubTag"], "tier1": True, "coach": False,
        "img": card["faceFile"], "rating": card["rating"], "v": card.get("faceV"),
    })
    early.append(card["ign"])
shown.sort(key=lambda x: (-x["tier1"], -(x["rating"] or x["peak"] or 0)))
SCALE = J("src", "data", "world_2025.json")["meta"].get("ratingScale")
json.dump({"_note": "built by scripts/build_retired.py — retired players with a photograph, ages on 2026-01-01",
           **({"ratingScale": SCALE} if SCALE else {}), "players": shown},
          open(os.path.join(ROOT, "src", "data", "retired.json"), "w"), ensure_ascii=False, indent=1)
print("src/data/retired.json:", len(shown), "shown,", sum(1 for x in shown if x["tier1"]), "tier-one,",
      sum(1 for x in shown if x["ageEstimated"]), "ages estimated,", sum(1 for x in shown if x["rating"]), "with a 退役普卡,",
      sum(1 for x in shown if x["coach"]), "coaching;", len(early), "early retirees:", ", ".join(early))
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
