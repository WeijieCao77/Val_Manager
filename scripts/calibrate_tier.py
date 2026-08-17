"""What a lower-tier stat line is worth in VCT, measured rather than guessed.

Ability is ranked on percentiles across one merged pool, which silently assumes
a 250 ACS is a 250 ACS wherever it was earned. It is not: a Challengers roster
puts up its numbers against Challengers opposition, and NRG Academy came out of
the build rated 90 — above every club in VCT Americas.

Two paired measurements, each comparing players to themselves, never to a
notion of who ought to be better:

  step 1  Challengers -> VCT. 72 players appear in both event tables. The
          median change in their own line is what happens to one person when
          the opponents get better.
  step 2  career -> Challengers. A career line is everything vlr has recorded,
          which for a Challengers player means open qualifiers and tier-3
          brackets as well. Comparing the Challengers-only line of players who
          have never touched VCT against their own career line shows how much
          the career average sits above Challengers proper.

The product of the two is what a career line earned outside VCT is worth in
VCT. Reads the two caches, writes nothing. Re-run after either scrape grows and
paste the printed block into build_world.py's SUBTIER_TO_VCT.
"""
from __future__ import annotations

import json
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEASONS = ROOT / "scripts" / "cache" / "vlr_seasons.json"
CHAL = ROOT / "scripts" / "cache" / "vlr_challengers.json"
CAREER = ROOT / "scripts" / "cache" / "vlr_career.json"

COLS = ["rating2", "acs", "kd", "kast", "adr", "kpr", "apr", "fdpr"]
NAME = {"rating2": "R", "acs": "acs", "kd": "kd", "kast": "kast", "adr": "adr",
        "kpr": "kpr", "apr": "apr", "fdpr": "fdpr"}

# a tier-1 line under this many rounds, or a tier-2 line under this many maps,
# is too noisy to be half of a ratio
MIN_T1_ROUNDS = 100
MIN_T2_MAPS = 5
# step 2 compares against a career average, which is only worth comparing to
# once there is a career behind it
MIN_CAREER_ROUNDS = 1000


def num(x):
    try:
        return float(str(x).replace("%", ""))
    except (TypeError, ValueError):
        return None


def accumulate(rows, weight_key, cast):
    """Round/map-weighted mean per player, per column."""
    acc: dict[str, dict] = {}
    for r in rows:
        w = cast(r.get(weight_key)) or 0
        if not w:
            continue
        a = acc.setdefault(r["ign"], {})
        for c in COLS:
            v = cast(r.get(c))
            if v is None:
                continue
            if c == "kast" and v > 1:
                v /= 100
            a[c] = a.get(c, 0.0) + v * w
            a[c + "_w"] = a.get(c + "_w", 0.0) + w
    return acc


def median_ratio(pairs):
    """The median, not the mean: one player whose Challengers split was three
    maps of nothing would otherwise set the factor for everybody."""
    return st.median(pairs) if pairs else None


def main() -> int:
    seasons = json.loads(SEASONS.read_text("utf-8"))
    chal = json.loads(CHAL.read_text("utf-8"))
    career = {k: v for k, v in json.loads(CAREER.read_text("utf-8")).items()
              if not k.startswith("_") and not v.get("miss")}

    t1 = accumulate(
        [r for rows in seasons["stats"].values() for r in rows], "rnd", lambda x: x)
    t2 = accumulate(
        [r for rows in chal["stats"].values() for r in rows], "maps", num)

    both = sorted(set(t1) & set(t2))
    print(f"{len(t1)} players in VCT tables, {len(t2)} in Challengers tables, "
          f"{len(both)} in both")

    print("\nstep 1 — the same player, Challengers line vs VCT line")
    step1 = {}
    for c in COLS:
        ratios = []
        for ign in both:
            a, b = t1[ign], t2[ign]
            if a.get(c + "_w", 0) < MIN_T1_ROUNDS or b.get(c + "_w", 0) < MIN_T2_MAPS:
                continue
            v1, v2 = a[c] / a[c + "_w"], b[c] / b[c + "_w"]
            if v2:
                ratios.append(v1 / v2)
        m = median_ratio(ratios)
        if m is None:
            print(f"  {NAME[c]:5} no paired sample")
            continue
        step1[NAME[c]] = m
        print(f"  {NAME[c]:5} n={len(ratios):3}  x{m:.3f}   "
              f"(mean {sum(ratios) / len(ratios):.3f}, "
              f"range {min(ratios):.2f}–{max(ratios):.2f})")

    print("\nstep 2 — the same player, career line vs Challengers-only line\n"
          "         (players who have never appeared in a VCT table)")
    step2 = {}
    for c in COLS:
        key = NAME[c]
        ratios = []
        for ign, a in t2.items():
            if ign in t1:
                continue
            cc = career.get(ign)
            if not cc or not cc.get(key) or a.get(c + "_w", 0) < MIN_T2_MAPS:
                continue
            if (cc.get("rnd") or 0) < MIN_CAREER_ROUNDS:
                continue
            ratios.append((a[c] / a[c + "_w"]) / cc[key])
        m = median_ratio(ratios)
        if m is None:
            print(f"  {key:5} no paired sample")
            continue
        step2[key] = m
        print(f"  {key:5} n={len(ratios):3}  x{m:.3f}")

    print("\nSUBTIER_TO_VCT = {")
    for k, v in step1.items():
        print(f'    "{k}": {round(v * step2.get(k, 1.0), 3)},')
    print("}")
    print(
        "\nNote which way the bias runs: the 72 are the Challengers players good\n"
        "enough to get called up, so they translate better than the average one.\n"
        "The real gap is wider than this, which makes these a floor, not a guess\n"
        "to be talked down."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
