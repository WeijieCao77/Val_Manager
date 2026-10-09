#!/usr/bin/env python3
"""
How much the best season should count: the owner's 「生涯平均，巅峰赛季占比稍高」.

    python3 -m scripts.rating.history_v16_peak

Re-scores every rated retired player with the peak share PEAK from 0 to 0.5
(everything else as in history_v16) and reports the spread, the rarity counts,
how many cards change metal against the pure career average, and the
effective weight of the best season for a typical career.
"""
import json
from collections import Counter
from pathlib import Path

from scripts.rating.history_v16 import BASE, SCALE, compress, tail

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating" / "history_v16"


def main() -> int:
    P = [p for p in json.loads((OUT / "players.json").read_text()) if p["rated"]]
    rows = []
    base = {}
    for a in (0, .1, .2, .3, .4, .5):
        cards = {}
        for p in P:
            L = (1 - a) * p["careerL"] + a * p["peakL"] if p["peakYear"] else p["careerL"]
            S = tail(BASE + SCALE * L) + min(10, p["O"]) + min(4, p["H"]) + p["G"]
            cards[p["vlrId"]] = int(compress(S) + .5)
        if a == 0:
            base = cards
        r = Counter("gold" if v >= 79 else "silver" if v >= 70 else "bronze" for v in cards.values())
        moved = sum(("gold" if v >= 79 else "silver" if v >= 70 else "bronze") !=
                    ("gold" if base[k] >= 79 else "silver" if base[k] >= 70 else "bronze") for k, v in cards.items())
        lift = [cards[k] - base[k] for k in cards]
        seasons = [len(p["seasons"]) for p in P if p["peakYear"]]
        k = sorted(seasons)[len(seasons) // 2]
        rows.append({"peak": a, "gold": r["gold"], "silver": r["silver"], "bronze": r["bronze"],
                     "metalChangedVsCareer": moved, "meanLift": round(sum(lift) / len(lift), 2), "maxLift": max(lift),
                     "bestSeasonWeightTypical": round(a + (1 - a) / k, 2), "typicalSeasons": k})
    (OUT / "peak_sensitivity.json").write_text(json.dumps(rows, indent=1))
    for r in rows:
        print(r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
