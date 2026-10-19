#!/usr/bin/env python3
"""
娱乐模式 (beta) free-agent pool: retired players and streamers who come back
for one manager's club.

    python3 scripts/build_fun_pool.py

Writes src/data/funPool.json, which a 2026 career in 娱乐模式 loads (lazily —
a normal career never downloads it) and turns into players with
src/engine/fun.ts. Nobody here is invented; every row is a real person.

Two kinds of row:

  retired   everyone in src/data/retired.json who is not on a bench now
            (`coach`), plus a 退役普卡 holder with no photograph. Since
            2026-10-18 a man with a 退役普卡 (src/data/retired_cards.json)
            comes back at that card: its eight attributes, its roles, its
            number (overall and peak), his last club and the year of his last
            match. The record from the last year he played
            (world_<lastYear>.json) still gives traits and agents; the early
            retirees (2020–22) have no such year and get the card's agents.
            fun.ts adds the rust of the years away.

  streamer  people with no top-flight season in any of our worlds, entered by
            hand in STREAMERS below with where each number came from. Their
            attributes are the mean of real players with the same kind of stat
            line, from the same world files (NEIGHBOURS), so they sit on the
            same scale as everyone else.

`fame` (人气) is set by hand for the streamers the owner named and the
retired players who stream to a large audience: 3 顶流, 2 知名, 1 主播. It is
only ever used for the 娱乐模式 sponsorship and wage effects in fun.ts.
"""
import json, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_world_ratings as sw  # noqa: E402  (raw / recompute: player.ts recomputeOverall)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p)))
ATTRS = ["aim", "reaction", "awareness", "utility", "clutch", "teamwork", "communication", "igl"]

retired = J("src", "data", "retired.json")
worlds = {y: J("src", "data", f"world_{y}.json") for y in (2023, 2024, 2025)}
by_id = {y: {p["id"]: p for p in w["players"]} for y, w in worlds.items()}
team_of = {y: {t["id"]: t for t in w["teams"]} for y, w in worlds.items()}

# 人气 of the retired players who stream to a big audience (owner's list, 2026-10-03)
FAME = {"tenz": 3, "sacy": 2, "yay": 2, "babyblue": 2}

# the whole year-world record but where he was and when he joined: he arrives without a club
DROP = {"teamId", "joined", "contractYears"}


def bare(r, card):
    """a whole record for a man in no world year (the 2020–22 retirees): who he is, and the card's agents"""
    agents = [AGENT_NAME.get(a, a.capitalize()) for a in card.get("agents") or []]
    return {
        "id": r["id"], "vlrId": card["vlrId"], "ign": r["ign"], "region": r.get("region") or card["region"],
        "nat": r.get("nat") or card.get("nat"), "realName": r.get("real") or card.get("realName"), "birth": r.get("birth"),
        "role": card["role"], "roles": card["roles"], "flex": len(card["roles"]) > 1, "traits": [],
        "agentPool": agents, "agentUse": {a: 1 for a in card.get("agents") or []}, "isIgl": bool(card.get("isIgl")),
        "attrs": dict(card["attrs"]), "overall": card["rating"], "rounds": 0, "stageBonus": 0.0, "potential": None,
        "form": 70, "morale": 70, "fatigue": 0, "salary": 0, "value": 0, "loyalty": 50, "ambition": 55,
    }


def neighbours(region, tier, rating, acs, roles=None, k=8, years=(2023, 2024, 2025)):
    """the k players of this region and tier whose vlr line is nearest (rating, ACS/200), optionally by role"""
    pool = []
    for y in years:
        for p in worlds[y]["players"]:
            t = team_of[y].get(p.get("teamId"))
            v = p.get("vlr") or {}
            if not t or t["region"] != region or t["tier"] != tier or not v.get("rating") or not v.get("acs"):
                continue
            if roles and p["role"] not in roles:
                continue
            pool.append((abs(v["rating"] - rating) + abs(v["acs"] - acs) / 200, y, p))
    pool.sort(key=lambda x: x[0])
    near = pool[:k]
    attrs = {a: round(statistics.mean(p["attrs"][a] for _, _, p in near)) for a in ATTRS}
    return attrs, [f"{p['ign']} ({y} {team_of[y][p['teamId']]['tag']} R{p['vlr']['rating']})" for _, y, p in near]


# People with no tier-one season in any world. Every field is sourced:
# identity from their vlr page (and thespike), the stat line from vlr's
# all-time agent table. Birthdates: neither vlr nor thespike has one and
# Liquipedia refused this IP (429) on 2026-10-03, so the age is an estimate
# (ageEstimated) — shown as 约 in the game.
STREAMERS = [
    {
        "id": "Hv31376", "vlrId": "31376", "ign": "tarik", "realName": "Tarik Celik", "nat": "us", "region": "Americas",
        "age": 30, "fame": 3, "role": "决斗者", "roles": ["决斗者", "哨卫"],
        "agentPool": ["Jett", "Chamber", "Raze", "Reyna", "Phoenix"],
        "agentUse": {"jett": 78, "chamber": 67, "raze": 44, "reyna": 41, "phoenix": 28, "iso": 16},
        # vlr 2026-10-03: 274 rounds, all show matches against pros (LOCK//IN São Paulo, Masters Toronto 2025,
        # RBHG 2025) — R 1.01, ACS 229. A show match is not a league, so he is rated like the Americas
        # tier-two duelists and sentinels whose league line is that one, with the CS major winner's
        # composure kept (awareness / communication from the same neighbours, not raised by hand).
        "line": {"rating": 1.01, "acs": 229}, "like": ("Americas", 2, ["决斗者", "哨卫"]),
        "note": "show matches only (vlr 31376); rated as an Americas tier-two duelist with the same line",
    },
    {
        "id": "Hv3018", "vlrId": "3018", "ign": "TryTryz", "realName": "Lu Shiwei", "nat": "cn", "region": "China",
        "age": 27, "fame": 1, "role": "哨卫", "roles": ["哨卫", "决斗者"], "lastYear": 2023, "lastClub": "Weibo Gaming",
        "agentPool": ["Killjoy", "Jett", "Skye", "Breach", "Sage"],
        "agentUse": {"killjoy": 775, "jett": 476, "skye": 289, "breach": 281, "sage": 266, "cypher": 101, "kayo": 90,
                     "raze": 84, "viper": 76, "reyna": 21},
        # vlr 2026-10-03: 2,459 rounds 2021–2023 (LIZHI, Qing Jiu Club, TYLOO, Weibo Gaming; CN Evolution
        # Series 2023 7th–8th), R 0.92, ACS 204 — rated like CN tier-two players of 2023–2025 with that line
        "line": {"rating": 0.92, "acs": 204}, "like": ("China", 2, None),
        "img": "https://owcdn.net/img/6516479b036fb.png",
        "note": "CN tier two 2021–2023 (vlr 3018); rated as CN tier-two players with the same line",
    },
]

# 人气 players the owner named who still play below the modelled leagues (the
# v16 status check, 2026-10-09): they come as streamers, from their last world year
NAMED = [("Hv15302", 2025)]  # Babyblue

cards = {c["playerId"]: c for c in J("src", "data", "retired_cards.json")["normals"]}
# career rounds from the same study: experience (confidentRating, milestones) reads them
V16_ROUNDS = {r["vlrId"]: int(r.get("rounds") or 0) for r in J("analysis", "rating", "history_v16", "players.json")}
# agents.json names (Jett, KAY/O…) by the lower-case id the cards use
AGENT_NAME = {"".join(ch for ch in a.lower() if ch.isalpha()): a
              for w in worlds.values() for p in w["players"] for a in p.get("agentPool") or []}


def from_card(row, card):
    """the 退役普卡's numbers on top of whatever record there is: attrs, roles, the call, overall"""
    row.update({"attrs": dict(card["attrs"]), "role": card["role"], "roles": card["roles"], "flex": len(card["roles"]) > 1,
                "isIgl": bool(card.get("isIgl")), "stageBonus": 0.0, "overall": card["rating"], "peak": card["rating"],
                "lastYear": int(card["last"][:4]), "lastClub": card["clubTag"],
                "rounds": max(V16_ROUNDS.get(card["vlrId"], 0), row.get("rounds") or 0)})
    # the card's number is its own (the 2026-10-11 squeeze moved the top), so what the
    # role weights do not reach sits on stageBonus, as sync_world_ratings does at 99
    if sw.recompute(row) != card["rating"]:
        row["stageBonus"] = round(card["rating"] - sw.raw(row), 4)
    if sw.recompute(row) != card["rating"]:
        raise SystemExit(f"{card['ign']}: attributes read {sw.recompute(row)}, card says {card['rating']}")
    # the vlr line was his last season; the numbers now are the career's
    row.pop("vlr", None)
    return row


rows, report = [], []
listed = set()
for r in retired["players"]:
    if r.get("coach"):
        continue  # on a bench now: the same man cannot be a club's coach and a free agent
    card = cards.get(r["id"])
    rec = by_id.get(r["lastYear"], {}).get(r["id"])
    if not rec and not card:
        raise SystemExit(f"{r['ign']}: no {r['lastYear']} record and no card")
    row = {k: v for k, v in rec.items() if k not in DROP} if rec else bare(r, card)
    row.update({
        "kind": "retired", "age": r["age"], "ageEstimated": r.get("ageEstimated", False), "birth": r.get("birth"),
        "lastYear": r["lastYear"], "lastClub": r["lastClub"], "peak": r["peak"], "tier1": r["tier1"],
        "fame": FAME.get(r["ign"].lower(), 0), "img": r.get("img"),
    })
    rows.append(from_card(row, card) if card else row)
    listed.add(r["id"])
# a card holder with no photograph is not in the 资料库 grid, but he can still come back
for pid, card in cards.items():
    if pid in listed:
        continue
    row = bare({"id": pid, "ign": card["ign"], "real": card.get("realName"), "nat": card.get("nat"), "region": card["region"]}, card)
    row.update({"kind": "retired", "age": 21 + (2026 - card["span"][0]), "ageEstimated": True, "birth": None,
                "tier1": True, "fame": FAME.get(card["ign"].lower(), 0), "img": None})
    rows.append(from_card(row, card))
for pid, year in NAMED:
    rec = by_id[year][pid]
    row = {k: v for k, v in rec.items() if k not in DROP}
    row.update({"kind": "streamer", "age": rec["age"] + (2026 - year), "ageEstimated": rec.get("ageEstimated", False),
                "lastYear": year, "lastClub": team_of[year][rec["teamId"]]["tag"] if rec.get("teamId") in team_of[year] else None,
                "peak": rec["overall"], "tier1": True, "fame": FAME.get(rec["ign"].lower(), 0), "img": f"{pid}.webp"})
    row.pop("vlr", None)  # the page would call it 生涯数据; it was one season
    rows.append(row)

for s in STREAMERS:
    region, tier, roles = s["like"]
    attrs, near = neighbours(region, tier, s["line"]["rating"], s["line"]["acs"], roles)
    row = {
        "id": s["id"], "vlrId": s["vlrId"], "ign": s["ign"], "region": s["region"], "nat": s["nat"],
        "realName": s["realName"], "birth": None, "ageEstimated": True, "age": s["age"],
        "role": s["role"], "roles": s["roles"], "flex": len(s["roles"]) > 1, "traits": [],
        "agentPool": s["agentPool"], "agentUse": s["agentUse"], "isIgl": False, "attrs": attrs, "overall": None,
        "vlr": {"rating": s["line"]["rating"], "acs": s["line"]["acs"], "rounds": sum(s["agentUse"].values())},
        "rounds": sum(s["agentUse"].values()), "stageBonus": 0, "potential": None, "form": 70, "morale": 70,
        "fatigue": 0, "salary": 0, "value": 0, "loyalty": 50, "ambition": 55,
        "kind": "streamer", "fame": s["fame"], "peak": None, "tier1": False,
        "lastYear": s.get("lastYear"), "lastClub": s.get("lastClub"),
        "img": f"{s['id']}.webp" if s.get("img") else None, "note": s["note"], "like": near,
    }
    rows.append(row)
    report.append(f"{s['ign']}: {attrs}  ← {', '.join(near)}")

out = {
    "_note": "built by scripts/build_fun_pool.py — 娱乐模式 free agents: retired players and streamers",
    "ratingScale": retired.get("ratingScale"),
    "players": rows,
}
json.dump(out, open(os.path.join(ROOT, "src", "data", "funPool.json"), "w"), ensure_ascii=False, separators=(",", ":"))
# faces for the men the dossier does not know (no season in any of our worlds): dossier.ts FUN_FACES
dossier = J("src", "data", "dossier.json")
known = set(dossier.get("players") or {}) | set(dossier.get("hist") or {})
faces = {}
for r in rows:
    if r["id"] in known or not r.get("img") or not os.path.exists(os.path.join(ROOT, "public", "faces", r["img"])):
        continue
    v = (cards.get(r["id"]) or {}).get("faceV")
    faces[r["id"]] = {"img": r["img"], **({"v": v} if v else {})}
json.dump(faces, open(os.path.join(ROOT, "src", "data", "fun_faces.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(f"fun_faces.json: {len(faces)} faces the dossier does not have")
print(f"{len(rows)} rows: {sum(r['kind'] == 'retired' for r in rows)} retired, {sum(r['kind'] == 'streamer' for r in rows)} streamers")
for line in report:
    print(line)
