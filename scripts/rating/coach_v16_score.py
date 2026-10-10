#!/usr/bin/env python3
"""
Coach cards from coach_v16's measurements.

    python3 -m scripts.rating.coach_v16_score

One published conversion, no per-person terms:
- each of 战术 / 培养 / 激励 = BASE + c x (shrunk residual), where c = the live
  players' personal-score spread / the true between-coach spread of that part
  (split-half covariance, coach_v16_prior): the same ruler as the players;
- the career record (O capped 10, titles H capped 4) is added to all three;
- the players' compression above 85 and the cap at 92 apply to each;
- rating = round(0.45 战术 + 0.30 培养 + 0.25 激励), the game's coachRating;
  metal by each pool's own 20/35/45 quantile lines (active / not active).
A coach with no measured events sits at BASE on that part and is marked 证据不足.
"""
import json
import statistics
from collections import Counter
from pathlib import Path

from scripts.rating.history_v16 import BASE, compress, quantile_lines

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "analysis" / "rating" / "history_v16"
# "enough" = at least the measured prior: the evidence is trusted half way or more
_PRIOR = json.loads((OUT / "coach_prior.json").read_text())
ENOUGH = {"tactics": ("eventWeight", _PRIOR["tactics"]["prior"]), "development": ("playerWeight", _PRIOR["development"]["prior"]),
          "motivation": ("seriesWeight", _PRIOR["motivation"]["prior"])}


def main() -> int:
    raw = json.loads((OUT / "coach_raw.json").read_text())
    rows = raw["coaches"]
    v15 = json.loads((ROOT / "analysis/rating/region_calibration_v15/players.json").read_text())
    target = statistics.pstdev([p["personal"] for p in v15 if p.get("personal") and (p.get("effective_rounds") or 0) >= 400])
    # the true between-coach spread of each part (split-half covariance) is put on
    # the width of the players' personal score: a fully evidenced coach spreads
    # like a player, a thinly evidenced one is shrunk towards the middle
    scale = {part: target / _PRIOR[part]["between"] ** .5 for part in ENOUGH}
    out = []
    for r in rows:
        rec = r["record"]
        bonus = min(10, rec["O"]) + min(4, rec["H"])
        parts = {}
        for part, (ev, lo) in ENOUGH.items():
            pts = BASE + scale[part] * r[f"{part}_raw"]
            parts[part] = {"points": round(pts, 2), "value": int(compress(pts + bonus) + .5),
                           "evidence": r["evidence"][ev], "enough": r["evidence"][ev] >= lo}
        rating = round(.45 * parts["tactics"]["value"] + .30 * parts["development"]["value"] + .25 * parts["motivation"]["value"])
        out.append({**{k: r[k] for k in ("key", "name", "vlrId", "real", "nat", "status", "lastEvent")},
                    "rating": rating,
                    "tactics": parts["tactics"]["value"], "development": parts["development"]["value"],
                    "motivation": parts["motivation"]["value"], "parts": parts, "record": rec, "bonus": round(bonus, 3),
                    "measured": any(p["evidence"] > 0 for p in parts.values())})
    # metal by each pool's own 20/35/45 lines (owner, 2026-10-10): the coaches in
    # the game today, and the ones who are not (the future retired-coach pack)
    lines = {}
    for pool in ("active", "inactive"):
        members = [c for c in out if c["status"] == pool]
        gold, silver = quantile_lines([c["rating"] for c in members])
        lines[pool] = {"gold": gold, "silver": silver, "pool": len(members)}
        for c in members:
            c["rarity"] = "gold" if c["rating"] >= gold else "silver" if c["rating"] >= silver else "bronze"
    print("coach lines", lines)
    (OUT / "coaches.json").write_text(json.dumps({"targetSd": target, "scale": scale, "lines": lines, "coaches": out}, ensure_ascii=False, indent=1))
    m = [c for c in out if c["measured"]]
    print(f"target sd {target:.2f}; scale {({k: round(v, 1) for k, v in scale.items()})}")
    print(len(out), "coaches;", len(m), "measured; ratings mean", round(statistics.mean(c["rating"] for c in m), 1),
          "sd", round(statistics.pstdev(c["rating"] for c in m), 1), Counter(c["rarity"] for c in m))
    for c in sorted(m, key=lambda c: -c["rating"])[:20]:
        print(f'{c["name"]:12} {c["rating"]} T{c["tactics"]} D{c["development"]} M{c["motivation"]} bonus {c["bonus"]:.1f} {c["status"]}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
