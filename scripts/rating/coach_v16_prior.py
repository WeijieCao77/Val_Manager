#!/usr/bin/env python3
"""
How many pseudo-observations each coach part should be shrunk with — measured.

    python3 -m scripts.rating.coach_v16_prior

Empirical Bayes: for each part, the noise variance of one observation (within
a coach) and the true between-coach variance (variance of coach means minus
the noise share). The prior count is their ratio: a coach with that many
observations is trusted half way. Written to coach_prior.json and read by
coach_v16.
"""
import json
import statistics
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating" / "history_v16"


def split_half(groups: list[list[tuple[float, float]]]) -> tuple[float, int]:
    """true between-coach variance = covariance of the two halves of each coach's
    observations (odd vs even in time order): noise does not co-vary, ability does"""
    xs, ys = [], []
    for g in groups:
        if len(g) < 6:
            continue
        a, b = g[0::2], g[1::2]
        m = lambda q: sum(w * r for w, r in q) / sum(w for w, _ in q)  # noqa: E731
        xs.append(m(a))
        ys.append(m(b))
    return (statistics.covariance(xs, ys) if len(xs) > 3 else 0.0), len(xs)


def estimate(groups: list[list[tuple[float, float]]]) -> dict:
    groups = [g for g in groups if len(g) >= 2]
    within, nw = 0.0, 0.0
    means, ns = [], []
    for g in groups:
        w = sum(x for x, _ in g)
        m = sum(x * r for x, r in g) / w
        within += sum(x * (r - m) ** 2 for x, r in g)
        nw += w - 1
        means.append(m)
        ns.append(w)
    noise = within / nw
    between, halves = split_half(groups)
    between = max(1e-9, between)
    return {"coaches": len(groups), "noise": noise, "between": between, "splitHalfCoaches": halves,
            "prior": noise / between}


def main() -> int:
    raw = json.loads((OUT / "coach_raw.json").read_text())["coaches"]
    out = {
        "tactics": estimate([[(e["w"], e["r"]) for e in sorted(c["events"], key=lambda e: e["end"])] for c in raw]),
        "development": estimate([[(e["w"], e["r"]) for e in sorted(c["development"], key=lambda e: e["to"])] for c in raw]),
        "motivation": estimate([[(e["w"], e["r"]) for e in sorted(c["series"], key=lambda e: e["end"])] for c in raw]),
    }
    (OUT / "coach_prior.json").write_text(json.dumps(out, indent=1))
    for k, v in out.items():
        print(k, {a: round(b, 5) for a, b in v.items()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
