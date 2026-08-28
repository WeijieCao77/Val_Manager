"""Turn the scraped candidates into the youth pool the game reads.

scripts/fetch_prospects.py collects raw rows from vlr.gg and dates them from
Liquipedia. This is the step that decides who is actually eligible and writes
src/data/prospects.json.

The rules are all about honesty, because these are real people:

  * A prospect must have a REAL recorded birthdate. Anyone Liquipedia has no
    date for is dropped rather than assigned a plausible age — the game already
    made that mistake once, aged an 18-year-old to a guessed 27, and the fix
    was to stop guessing.
  * Nobody already in world.json, by handle or by vlr id.
  * Young enough that arriving years from now still leaves a career: born
    recently enough to be under MAX_ARRIVAL_AGE in the first intake season.

Nothing here invents a person. Ability is not scraped and cannot be — these
players have no top-flight record — so the game derives it, unproven and with
a deliberately wide ceiling, in src/engine/prospects.ts.

    python3 scripts/build_prospects.py
    python3 scripts/build_prospects.py --from 2028   # different intake year
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_prospects.json"
WORLD = ROOT / "src" / "data" / "world.json"
OUT = ROOT / "src" / "data" / "prospects.json"

# Older than this on arrival and he is not a prospect, he is a journeyman —
# the game's growth curve has already flattened by 24.
MAX_ARRIVAL_AGE = 26


def load(p: Path, fallback):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return fallback


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="year", type=int, default=2030,
                    help="the season the first intake arrives")
    args = ap.parse_args()

    cache = load(CACHE, {})
    rows = list((cache.get("players") or {}).values())
    world = load(WORLD, {"players": []})
    known = {p["ign"].lower() for p in world["players"]}

    kept, no_date, too_old, dupes = [], 0, 0, 0
    seen: set[str] = set()
    for r in rows:
        ign = (r.get("ign") or "").strip()
        if not ign or ign.lower() in known or ign.lower() in seen:
            dupes += 1
            continue
        born = r.get("born")
        if not born:
            no_date += 1
            continue
        birth_year = int(str(born)[:4])
        if args.year - birth_year > MAX_ARRIVAL_AGE:
            too_old += 1
            continue
        # vlr writes "un" where it has no flag for a player. That is missing
        # data, not a country — storing it would make the import rule think it
        # knows where he is from, and this project's rule is that missing data
        # is never treated as fact.
        nat = (r.get("nat") or "").lower()
        if nat in ("un", ""):
            nat = None
        seen.add(ign.lower())
        kept.append({
            "id": f"Y{r['vlr']}",
            "ign": ign,
            "real": r.get("real") or None,
            "nat": nat,
            "born": born,
            "agents": (r.get("agents") or [])[:6],
        })

    kept.sort(key=lambda x: x["born"], reverse=True)
    OUT.write_text(json.dumps({
        "meta": {
            "built": "scripts/build_prospects.py",
            "source": "vlr.gg rosters below the simulated leagues; "
                      "birthdates from liquipedia",
            "intakeFrom": args.year,
            "count": len(kept),
        },
        "players": kept,
    }, ensure_ascii=False, indent=1))

    print(f"候选 {len(rows)} → 收录 {len(kept)} 人")
    print(f"  没有真实生日 {no_date}｜{args.year} 年已超过 "
          f"{MAX_ARRIVAL_AGE} 岁 {too_old}｜重复或已在世界中 {dupes}")
    if kept:
        ages = Counter(args.year - int(x["born"][:4]) for x in kept)
        print("  入池当年的年龄分布：",
              "，".join(f"{a} 岁 {n} 人" for a, n in sorted(ages.items())))
        nats = Counter(x["nat"] for x in kept if x["nat"])
        print("  国籍前八：",
              "，".join(f"{k} {v}" for k, v in nats.most_common(8)))
        print(f"  按每年 10~15 人算，可支撑约 "
              f"{len(kept) // 12} 个赛季")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
