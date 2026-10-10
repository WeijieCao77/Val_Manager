#!/usr/bin/env python3
"""
The public page for the retired-player and coach numbers.

    python3 -m scripts.rating.publish_retired_stats

Writes public/cards/retired/stats/: index.html (the page), retired.json and
coaches.json (everything the page shows, per person), and the two CSVs. Served
at https://vctgames.com/cards/retired/stats. Nothing here changes a card in the
game; the page explains numbers, it does not grant them.

Copy is plain Chinese with only the key facts (memory: copy-style). The method
text below is the published explanation — change the model, change this text.
"""
from __future__ import annotations

import csv
import json
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "analysis" / "rating" / "history_v16"
DST = ROOT / "public" / "cards" / "retired" / "stats"
DOSSIER = json.loads((ROOT / "src" / "data" / "dossier.json").read_text())
PEOPLE = json.loads((ROOT / "data-raw" / "people.json").read_text())
PEOPLE = PEOPLE.get("people", PEOPLE)
RARITY = {"gold": "金卡", "silver": "银卡", "bronze": "铜卡"}
EVENTS = json.loads((SRC / "events.json").read_text())
VLR_NAMES = {}
for _p in json.loads((ROOT / "scripts" / "cache" / "vlr_people.json").read_text()).values():
    for _e in _p.get("events", []):
        VLR_NAMES.setdefault(_e["id"], _e["event"])
_LEDGER_IDS = {t["event"]: t["event_id"] for t in json.loads((ROOT / "analysis/rating/career_history_v8/merged_international_ledger.json").read_text())}


def event_name(key: str) -> str:
    """a readable event name for an id, or for the slug a ledger row carries"""
    eid = key if key in EVENTS else _LEDGER_IDS.get(key) or next((k for k, e in EVENTS.items() if e.get("slug") == key), None)
    if eid and VLR_NAMES.get(eid):
        return VLR_NAMES[eid]
    name = (EVENTS.get(eid) or {}).get("name") if eid else None
    if name and "-" not in name:
        return name
    return key.replace("-", " ").title()


def r2(x, n=2):
    return None if x is None else round(x, n)


def name_of(pid: str) -> str:
    return (PEOPLE.get(pid) or {}).get("ign") or pid


def retired_rows() -> list[dict]:
    out = []
    for p in json.loads((SRC / "players.json").read_text()):
        if not p.get("rated") or p.get("class") not in ("retired",):
            continue
        h = DOSSIER["hist"].get(f"Hv{p['vlrId']}") or {}
        out.append({
            "id": p["vlrId"], "ign": p["ign"], "real": h.get("real"), "nat": h.get("nat"),
            "img": f"/faces/{h['img']}?v={h.get('v', '')}" if h.get("img") else None,
            "rating": p["rating"], "rarity": RARITY[p["rarity"]], "last": p["last"],
            "role": (p.get("card") or {}).get("role"), "attrs": (p.get("card") or {}).get("attrs"),
            "personal": r2(p["P"]), "career": r2(p["careerL"], 4), "peakYear": p["peakYear"], "peak": r2(p["peakL"], 4),
            "N": r2(p["careerN"], 0), "rounds": r2(p["rounds"], 0),
            "parts": {k: r2(p[k], 3) for k in ("Q", "Sd", "T", "D", "E", "I", "F", "breakout", "O", "H", "G", "S")},
            "seasons": p["seasons"],
            "international": [{"event": event_name(x["eid"]), "team": x["team"], "place": x["place"], "part": x["participation"],
                               "Q": r2(x["Q"], 3), "T": r2(x["T"], 3), "H": r2(x["H"], 3)} for x in p["international"]],
            "regional": [{k: x[k] for k in ("year", "slot", "team", "place", "field", "participation")} | {"event": event_name(x["eid"]), "u": r2(x["u"], 3)}
                         for x in p["regional"]],
            "records": [{"event": event_name(x["eid"]), "date": x["date"], "level": "一线" if x["level"] == "top" else "次级",
                         "stage": {"main": "正赛", "qualifier": "预选赛"}.get(x.get("stage"), ""), "rounds": int(x["rounds"]),
                         "club": x["club"], "agents": [[a, round(s, 2)] for a, s in x["agents"]][:3], "q": x["q"],
                         "coverage": x["coverage"]} for x in p["records"]],
        })
    return sorted(out, key=lambda r: -r["rating"])


def photo_key(name: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in s if ch.isalnum())


def coach_img(name: str, d: dict) -> str | None:
    if d.get("img"):
        return f"/faces/{d['img']}?v={d.get('v', '')}"
    f = DST / "coach-photos" / f"{photo_key(name)}.webp"
    return f"coach-photos/{f.name}" if f.exists() else None


def coach_rows() -> list[dict]:
    raw = {c["key"]: c for c in json.loads((SRC / "coach_raw.json").read_text())["coaches"]}
    scored = json.loads((SRC / "coaches.json").read_text())
    out = []
    for c in scored["coaches"]:
        r = raw[c["key"]]
        d = DOSSIER["coaches"].get(c["name"]) or {}
        out.append({
            "key": c["key"], "name": c["name"], "real": c.get("real") or d.get("real"), "nat": c.get("nat") or d.get("nat"),
            "img": coach_img(c["name"], d),
            "status": "在任" if c["status"] == "active" else "不在任", "measured": c["measured"],
            "rating": c["rating"], "rarity": RARITY[c["rarity"]],
            "tactics": c["tactics"], "development": c["development"], "motivation": c["motivation"],
            "parts": {k: {"points": v["points"], "evidence": r2(v["evidence"], 2), "enough": v["enough"]} for k, v in c["parts"].items()},
            "record": {k: (r2(v, 3) if isinstance(v, float) else v) for k, v in c["record"].items()}, "bonus": c["bonus"],
            "events": [{"event": event_name(e["eid"]), "end": e["end"], "team": e["team"], "role": e["role"], "field": e["field"],
                        "place": e["place"], "expected": r2(e["expected"], 1), "r": r2(e["r"], 3), "w": r2(e["w"], 2),
                        "five": [name_of(p) for p in e["five"]]} for e in sorted(r["events"], key=lambda e: e["end"])],
            "series": [{"round": s["round"], "end": s["end"], "score": s["score"], "p": r2(s["p"], 2), "won": s["won"]}
                       for s in sorted(r["series"], key=lambda s: s["end"])],
            "players": [{"player": name_of(x["pid"]), "from": x["from"], "to": x["to"], "change": r2(x["L1"] - x["L0"], 4),
                             "expected": r2(x["expected"], 4), "r": r2(x["r"], 4)} for x in r["development"]],
        })
    return sorted(out, key=lambda c: (not c["measured"], -c["rating"]))


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    keep = {"coach-photos"}  # verified photos of coaches the game has no face for (coach_photo_sources.json)
    for f in DST.iterdir():
        if f.name not in keep:
            shutil.rmtree(f) if f.is_dir() else f.unlink()
    players, coaches = retired_rows(), coach_rows()
    lines = json.loads((SRC / "lines.json").read_text())
    clines = json.loads((SRC / "coaches.json").read_text()).get("lines", {})
    mythics = [{k: m[k] for k in ("ign", "vlrId", "event", "why", "percentile", "field", "rounds", "byPercentile", "normal", "rating", "role", "attrs")}
               | {"event": event_name(m["eid"])} for m in json.loads((SRC / "mythics.json").read_text())]
    meta = {"date": date.today().isoformat(), "players": len(players), "coaches": len(coaches),
            "lines": {"retired": lines["retired"], "coachActive": clines.get("active"), "coachInactive": clines.get("inactive")}}
    (DST / "retired.json").write_text(json.dumps({"meta": meta, "players": players, "mythics": mythics}, ensure_ascii=False, separators=(",", ":")))
    (DST / "coaches.json").write_text(json.dumps({"meta": meta, "coaches": coaches}, ensure_ascii=False, separators=(",", ":")))
    with (DST / "retired.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["选手", "真名", "评分", "稀有度", "个人分", "巅峰赛季", "履历O", "冠军H", "赛区G", "最后一场"])
        for p in players:
            w.writerow([p["ign"], p["real"], p["rating"], p["rarity"], p["personal"], p["peakYear"], p["parts"]["O"],
                        p["parts"]["H"], p["parts"]["G"], p["last"]])
    with (DST / "coaches.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["教练", "真名", "状态", "评分", "稀有度", "战术", "培养", "激励", "履历加分", "计分赛事", "系列赛", "带过的选手"])
        for c in coaches:
            w.writerow([c["name"], c["real"], c["status"], c["rating"], c["rarity"], c["tactics"], c["development"],
                        c["motivation"], c["bonus"], len(c["events"]), len(c["series"]), len(c["players"])])
    (DST / "index.html").write_text((SRC / "page.html").read_text())
    print(f"{len(players)} retired players, {len(coaches)} coaches -> {DST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
