#!/usr/bin/env python3
"""
The retired series as game data: src/data/retired_cards.json.

    python3 -m scripts.rating.build_retired_cards

Reads the v16 study (analysis/rating/history_v16: players.json, mythics.json,
status_verified.json, early_faces.json, liquipedia_roles.json) and writes what
the game builds its 退役 cards from (src/engine/cards.ts):

  normals  one 普卡 per retired man — id r:<vlr id>, the career rating and
           metal, his own attribute shape, his LAST club (the last event he
           played 100+ rounds of), the career span, his face.
  legends  the eight 彩卡 — id R:<ign>-<event>, the night's rating and
           attributes, the Riot photo.

Identity is the vlr id everywhere: playerId is Hv<vlr id>, the same key the
historical worlds and the dossier use, so a man has one 普卡 and his 彩卡 is
recognised as the same person (personOf).
Region is the league region of his last club, folded to the game's four.
Age is his age on his last match day from a real birthdate; unknown is 0, as
the 曼谷 cards do — never a guess.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
B = ROOT / "analysis" / "rating" / "history_v16"
OUT = ROOT / "src" / "data" / "retired_cards.json"
FOUR = {"Americas": "Americas", "NA": "Americas", "BR": "Americas", "LATAM": "Americas",
        "EMEA": "EMEA", "EU": "EMEA", "CIS": "EMEA", "TR": "EMEA",
        "Pacific": "Pacific", "APAC": "Pacific", "KR": "Pacific", "JP": "Pacific", "China": "China"}
# the eight nights (city, result, short line); the rest comes from mythics.json
NIGHT = {
    "TenZ": ("2021 雷克雅未克大师赛冠军", "21 雷克雅未克", "SEN", "Sentinels 首夺世界冠军，VALORANT 第一个国际赛冠军。"),
    "Sacy": ("2022 伊斯坦布尔冠军赛冠军", "22 伊斯坦布尔", "LOUD", "LOUD 夺冠，巴西赛区第一座世界冠军。"),
    "Leo": ("2023 LOCK//IN 圣保罗冠军", "23 圣保罗", "FNC", "FNATIC 在 32 支队伍里夺冠。"),
    "yay": ("2022 雷克雅未克大师赛冠军", "22 雷克雅未克", "OPTC", "OpTic 夺冠，那一年的「Chamber 之神」。"),
    "ScreaM": ("2021 柏林冠军赛四强", "21 柏林", "TL", "Team Liquid 打进第一届冠军赛四强。"),
    "FNS": ("2022 雷克雅未克大师赛冠军", "22 雷克雅未克", "OPTC", "OpTic 的指挥，带队夺冠。"),
    "Zest": ("2022 伊斯坦布尔冠军赛季军", "22 伊斯坦布尔", "DRX", "DRX 打进冠军赛前三。"),
    "BONECOLD": ("2021 柏林冠军赛冠军", "21 柏林", "ACE", "Acend 3–2 Gambit，VALORANT 史上第一座世界冠军。"),
}


def stamp(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()[:8]


def main() -> int:
    players = [p for p in json.loads((B / "players.json").read_text()) if p.get("rated") and p["class"] == "retired"]
    status = json.loads((B / "status_verified.json").read_text())
    early_faces = json.loads((B / "early_faces.json").read_text())
    roles_lp = json.loads((B / "liquipedia_roles.json").read_text())
    events = json.loads((B / "events.json").read_text())
    retired = {r["id"][2:]: r for r in json.loads((ROOT / "src" / "data" / "retired.json").read_text())["players"]}
    dossier = json.loads((ROOT / "src" / "data" / "dossier.json").read_text())["hist"]
    people = json.loads((ROOT / "data-raw" / "people.json").read_text())
    people = people.get("people", people)
    def region_of(slug: str) -> str | None:  # the same table as history_v16.region_of
        for pat, reg in [("china", "China"), ("americas", "Americas"), ("asia-pacific|apac", "APAC"), ("pacific", "Pacific"),
                         ("emea", "EMEA"), ("north-america", "NA"), ("brazil", "BR"), ("latam|latin-america|south-america", "LATAM"),
                         ("korea", "KR"), ("japan", "JP"), ("cis", "CIS"), ("turkey", "TR"), ("europe", "EU"),
                         ("asia-pacific|apac|sea|southeast-asia|east-asia", "APAC")]:
            if re.search(pat, slug.lower()):
                return reg
        return None

    normals = []
    for p in sorted(players, key=lambda p: (-p["rating"], p["ign"].lower())):
        vid = p["vlrId"]
        rr = sorted(p["records"], key=lambda r: (r["date"], r["rounds"]))
        real = [r for r in rr if r["rounds"] >= 100 and r["club"] not in ("Team", "TBD", "")] or rr
        last = real[-1]
        years = sorted({int(r["date"][:4]) for r in rr})
        h = dossier.get("Hv" + vid) or {}
        r0 = retired.get(vid) or {}
        st = status.get(vid) or {}
        face_file = h.get("img") or (early_faces.get(vid) or {}).get("file")
        face_v = h.get("v") or (stamp(ROOT / "public" / "faces" / face_file) if face_file and (ROOT / "public" / "faces" / face_file).exists() else None)
        region = r0.get("region") or FOUR.get(region_of(events.get(last["eid"], {}).get("slug", "")) or "", None)
        birth = r0.get("birth") or (people.get(vid) or {}).get("birth")
        age = 0
        if birth and re.match(r"^\d{4}-\d{2}-\d{2}$", birth) and not r0.get("ageEstimated"):
            b, d = date.fromisoformat(birth), date.fromisoformat(p["last"])
            age = d.year - b.year - ((d.month, d.day) < (b.month, b.day))
        card = p.get("card") or {}
        normals.append({
            "id": f"r:{vid}", "playerId": f"Hv{vid}", "vlrId": vid, "ign": p["ign"],
            "realName": h.get("real") or r0.get("real") or st.get("real"), "nat": h.get("nat") or r0.get("nat") or st.get("nat"),
            "faceFile": face_file, "faceV": face_v, "region": region or "EMEA", "clubTag": last["club"],
            "role": card.get("role"), "roles": [card.get("role")], "isIgl": bool((roles_lp.get(vid) or {}).get("igl")),
            "age": age, "attrs": card.get("attrs"), "rating": p["rating"], "rarity": p["rarity"],
            "span": [max(2020, years[0]), years[-1]], "last": p["last"], "early": bool(p.get("early")),
        })
    by_ign = {n["ign"]: n for n in normals}
    legends = []
    for m in json.loads((B / "mythics.json").read_text()):
        base = by_ign[m["ign"]]
        title, short, club, note = NIGHT[m["ign"]]
        photo = ROOT / "public" / "events" / "afterglow" / "portraits" / f"{m['ign'].lower()}-action.webp"
        legends.append({
            "id": f"R:{m['ign'].lower()}-{m['eid']}", "playerId": base["playerId"], "vlrId": base["vlrId"], "ign": m["ign"],
            "title": title, "short": short, "year": int(events[m["eid"]]["end"][:4]), "clubTag": club, "note": note,
            "rating": m["rating"], "attrs": m["attrs"], "role": base["role"],
            "photo": f"events/afterglow/portraits/{photo.name}", "photoV": stamp(photo),
            "evidence": {"event": m["eid"], "percentile": m["percentile"], "field": m["field"], "byPercentile": m["byPercentile"]},
        })
    gold = sum(n["rarity"] == "gold" for n in normals)
    OUT.write_text(json.dumps({"_note": "Generated by scripts/rating/build_retired_cards.py from the v16 study; do not edit by hand.",
                               "normals": normals, "legends": legends}, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(normals)} 普卡 ({gold} gold), {len(legends)} 彩卡; no face: {[n['ign'] for n in normals if not n['faceFile']]}; "
          f"age unknown: {sum(1 for n in normals if not n['age'])}; no attrs: {[n['ign'] for n in normals if not n['attrs']]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
