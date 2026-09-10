"""Shared constants and small maths for the offline rating study. Pure Python on purpose."""
from __future__ import annotations

import math
import statistics
from datetime import date

# agent slug (vlr) -> role, the same grouping the game uses (src/engine/content.ts)
AGENT_ROLE: dict[str, str] = {}
for _role, _names in {
    "决斗者": ["jett", "raze", "phoenix", "reyna", "yoru", "neon", "iso", "waylay"],
    "先锋": ["sova", "breach", "skye", "kayo", "fade", "gekko", "tejo"],
    "控场": ["brimstone", "viper", "omen", "astra", "harbor", "clove", "miks"],
    "哨卫": ["sage", "cypher", "killjoy", "chamber", "deadlock", "vyse", "veto"],
}.items():
    for _n in _names:
        AGENT_ROLE[_n] = _role
ROLES = ["决斗者", "先锋", "控场", "哨卫"]

# event tier -> environment group for the correction tables
TIER_GROUP = {"champions": "intl", "masters": "intl", "league": "vct", "kickoff": "vct", "challengers": "t2"}

# the six statistically estimable abilities and the owner's function templates
# (initial values to be back-tested, not verified optima)
STAT_ABILITIES = ["aim", "reaction", "awareness", "utility", "clutch", "teamwork"]
TEMPLATES: dict[str, dict[str, float]] = {
    "决斗者": {"aim": .30, "reaction": .25, "awareness": .15, "utility": .08, "clutch": .10, "teamwork": .12},
    "先锋": {"aim": .18, "reaction": .10, "awareness": .18, "utility": .28, "clutch": .08, "teamwork": .18},
    "控场": {"aim": .18, "reaction": .08, "awareness": .24, "utility": .25, "clutch": .12, "teamwork": .13},
    "哨卫": {"aim": .24, "reaction": .10, "awareness": .25, "utility": .15, "clutch": .16, "teamwork": .10},
}

# the game's current weights, for the reconstruction of the current scheme
ATTR_WEIGHT = {"aim": 0.20, "reaction": 0.15, "awareness": 0.17, "utility": 0.14,
               "clutch": 0.12, "teamwork": 0.10, "communication": 0.08, "igl": 0.04}
ROLE_WEIGHT = {
    "决斗者": {"aim": 0.28, "reaction": 0.22, "clutch": 0.16, "awareness": 0.12, "utility": 0.08, "teamwork": 0.07, "communication": 0.05, "igl": 0.02},
    "先锋": {"aim": 0.17, "reaction": 0.15, "awareness": 0.20, "utility": 0.20, "clutch": 0.09, "teamwork": 0.10, "communication": 0.07, "igl": 0.02},
    "控场": {"aim": 0.15, "reaction": 0.11, "awareness": 0.20, "utility": 0.22, "clutch": 0.09, "teamwork": 0.13, "communication": 0.08, "igl": 0.02},
    "哨卫": {"aim": 0.19, "reaction": 0.12, "awareness": 0.22, "utility": 0.15, "clutch": 0.15, "teamwork": 0.10, "communication": 0.05, "igl": 0.02},
}
ROLE_UTIL = {"决斗者": 0.35, "先锋": 0.75, "控场": 0.85, "哨卫": 0.6, "自由人": 0.55}
ROLE_COMM = {"决斗者": 0.45, "先锋": 0.7, "控场": 0.75, "哨卫": 0.6, "自由人": 0.6}


def parse_date(s: str | None) -> date | None:
    if not s:
        return None
    y, m, d = (int(x) for x in s.split("-"))
    return date(y, m, d)


def half_life_weight(age_days: float, half_life: float) -> float:
    return 2.0 ** (-max(0.0, age_days) / half_life)


def wmean(pairs: list[tuple[float, float]]) -> float | None:
    """weighted mean of (value, weight); None when nothing carries weight"""
    w = sum(x[1] for x in pairs)
    return sum(v * ww for v, ww in pairs) / w if w > 0 else None


def mean_sd(xs: list[float]) -> tuple[float, float]:
    if len(xs) < 2:
        return (xs[0] if xs else 0.0), 1.0
    return statistics.fmean(xs), max(statistics.pstdev(xs), 1e-6)


def rank(xs: list[float]) -> list[float]:
    """average ranks, 1-based"""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


def spearman(a: list[float], b: list[float]) -> float | None:
    if len(a) < 5 or len(a) != len(b):
        return None
    ra, rb = rank(a), rank(b)
    ma, mb = statistics.fmean(ra), statistics.fmean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else None


def pearson(a: list[float], b: list[float]) -> float | None:
    if len(a) < 5 or len(a) != len(b):
        return None
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else None


def percentile_map(xs: list[float]) -> dict[int, float]:
    """index -> percentile in [0,1] (average rank / n), as build_world does"""
    r = rank(xs)
    n = len(xs)
    return {i: (r[i] - 0.5) / n for i in range(n)}


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))
