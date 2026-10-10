#!/usr/bin/env python3
"""
The retired 彩卡: one night each, scored by how he played that night.

    python3 -m scripts.rating.history_v16_mythic

The owner picked the eight (2026-10-10). For each, the event is his defining
international. Rating = 90 + 5 x (his percentile among every player of that
event with at least 100 rounds, by the same per-event index the 普卡 uses);
never below his own 普卡 + LEGEND_EDGE (2), never above 95 — the live 彩卡 band.
A title is not added again: winning is already in his own numbers, and adding
it twice was one of Codex's mistakes. Attributes keep his 普卡 shape, moved by
the gap (the live rule for 彩卡, cards.ts).
"""
import json
import math
from collections import defaultdict
from pathlib import Path

from scripts.rating import history_v16 as H

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating" / "history_v16"
PICKS = [  # (handle, event id, why)
    ("TenZ", "353", "2021 雷克雅未克大师赛冠军"),
    ("Sacy", "1015", "2022 冠军赛冠军"),
    ("Leo", "1188", "2023 LOCK//IN 圣保罗冠军"),
    ("yay", "926", "2022 雷克雅未克大师赛冠军"),
    ("ScreaM", "449", "2021 冠军赛四强"),
    ("FNS", "926", "2022 雷克雅未克大师赛冠军（指挥）"),
    ("Zest", "1015", "2022 冠军赛季军"),
    ("BONECOLD", "449", "2021 冠军赛冠军"),
]
EDGE, LO, HI, MIN_ROUNDS = 2, 90, 95, 100


def main() -> int:
    events, recs = H.load()
    bases = H.fit_baselines(recs)
    players = {p["ign"]: p for p in json.loads((OUT / "players.json").read_text()) if p.get("rated")}
    by_event = defaultdict(list)
    for r in recs:
        if r["eid"] in {e for _, e, _ in PICKS}:
            s = H.score_record(r, bases)
            if s and r["n"] >= MIN_ROUNDS:
                by_event[r["eid"]].append({**r, **s})
    out = []
    for ign, eid, why in PICKS:
        p = players[ign]
        field = sorted(by_event[eid], key=lambda r: r["q"])
        me = next(r for r in field if r["pid"] == p["vlrId"])
        rank = sum(r["q"] < me["q"] for r in field) + .5 * (sum(r["q"] == me["q"] for r in field) - 1)
        pct = rank / (len(field) - 1)
        raw = LO + 5 * pct
        rating = int(min(HI, max(raw, p["rating"] + EDGE, LO)) + .5)
        card = p.get("card") or {}
        attrs = {k: max(1, min(99, v + rating - p["rating"])) for k, v in (card.get("attrs") or {}).items()}
        out.append({"ign": ign, "vlrId": p["vlrId"], "event": events[eid].get("name") or events[eid]["slug"], "eid": eid,
                    "why": why, "q": round(me["q"], 4), "rounds": me["n"], "field": len(field), "percentile": round(pct, 3),
                    "byPercentile": round(raw, 2), "normal": p["rating"], "rating": rating, "role": card.get("role"), "attrs": attrs})
        print(f"{ign:9} {out[-1]['event'][:44]:44} pct {pct:.2f} ({len(field)} players) -> {raw:.1f}; 普卡 {p['rating']} -> 彩卡 {rating}")
    (OUT / "mythics.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
