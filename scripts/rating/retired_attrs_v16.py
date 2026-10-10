#!/usr/bin/env python3
"""
Attributes for retired players who were never in a saved world (2020-22 retirees, Hiko).

    python3 -m scripts.rating.retired_attrs_v16

Everyone else's card keeps the shape his 2023-25 world gave him. These men have
no world, so their shape is built the way scripts/build_world.py builds every
world player — the same formulas, the same weights, the same 44-98 scale —
measured against their own era: every player with at least 800 tier-one rounds
in 2020-2022, career totals over that window. Rating is ranked within role, as
the world builder does. The result is a shape; history_v16 moves it to the
card's rating like any other.
Writes analysis/rating/history_v16/attr_shapes.json.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from scripts.rating import history_v16 as H
from scripts.rating.common import AGENT_ROLE, ROLE_WEIGHT

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating" / "history_v16"
ROLE_UTIL = {"控场": 1.0, "先锋": 0.95, "哨卫": 0.7, "自由人": 0.55, "决斗者": 0.25}
ROLE_COMM = {"控场": 0.8, "先锋": 0.85, "哨卫": 0.6, "自由人": 0.7, "决斗者": 0.4}
MIN_ROUNDS = 800
CL_PRIOR = 20


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def scale(p, lo=44, hi=98):
    return int(round(clamp(lo + (hi - lo) * p, 20, 99)))


def axis(specific, quality):
    return 0.58 * specific + 0.42 * quality


def pctiles(rows: dict, key: str, invert=False) -> dict:
    vals = sorted((v[key], k) for k, v in rows.items() if v.get(key) is not None)
    n = len(vals)
    out = {}
    for i, (_, k) in enumerate(vals):
        p = i / (n - 1) if n > 1 else 0.5
        out[k] = 1 - p if invert else p
    return out


def main() -> int:
    events, recs = H.load()
    agg = defaultdict(lambda: defaultdict(float))
    roles = defaultdict(lambda: defaultdict(float))
    for r in recs:
        if r["level"] != "top" or r["date"] >= "2023-01-01" or events[r["eid"]].get("tier") is None:
            continue
        a, n = agg[r["pid"]], r["n"]
        a["n"] += n
        for k in ("k", "d", "a", "fk", "fd"):
            if r.get(k) is not None:
                a[k] += r[k]
                a[k + "_n"] += n
        for k in ("acs", "adr", "kast", "rating2", "hs"):
            if r.get(k) is not None:
                a[k] += r[k] * n
                a[k + "_n"] += n
        if r.get("clt"):
            a["clw"] += r["clw"]
            a["clt"] += r["clt"]
        for ag, p in r["sh"]:
            roles[r["pid"]][AGENT_ROLE[ag]] += p * n
    rows = {}
    for pid, a in agg.items():
        if a["n"] < MIN_ROUNDS:
            continue
        mean = lambda k: a[k] / a[k + "_n"] if a.get(k + "_n") else None  # noqa: E731
        rate = lambda k: a[k] / a[k + "_n"] if a.get(k + "_n") else None  # noqa: E731
        rows[pid] = {"acs": mean("acs"), "adr": mean("adr"), "hs": mean("hs"), "kast": mean("kast"), "R": mean("rating2"),
                     "kpr": rate("k"), "apr": rate("a"), "fkpr": rate("fk"), "fdpr": rate("fd"),
                     "kd": (a["k"] / a["d"]) if a.get("d") else None, "clw": a.get("clw", 0), "clt": a.get("clt", 0),
                     "role": max(roles[pid], key=roles[pid].get) if roles[pid] else "先锋"}
    tw = sum(r["clw"] for r in rows.values())
    tt = sum(r["clt"] for r in rows.values()) or 1
    for r in rows.values():
        r["clutch_pct"] = (r["clw"] + CL_PRIOR * tw / tt) / (r["clt"] + CL_PRIOR) if r["clt"] else None
    P = {k: pctiles(rows, k) for k in ("acs", "adr", "hs", "kpr", "fkpr", "kast", "apr", "kd", "clutch_pct")}
    P["fdpr"] = pctiles(rows, "fdpr", invert=True)
    P["R"] = {}
    for role in {r["role"] for r in rows.values()}:
        peers = {k: v for k, v in rows.items() if v["role"] == role}
        P["R"].update(pctiles(peers if len(peers) >= 12 else rows, "R"))

    want = set()
    status = json.loads((OUT / "status_verified.json").read_text())
    want |= {k for k, v in status.items() if v.get("early") or v["ign"] == "Hiko"}
    shapes = {}
    for pid in want:
        if pid not in rows:
            continue
        r = rows[pid]
        g = lambda k: P[k].get(pid, 0.5)  # noqa: E731
        q = g("R")
        attrs = {
            "aim": scale(axis(0.5 * g("acs") + 0.3 * g("adr") + 0.2 * g("hs"), q)),
            "reaction": scale(axis(0.55 * g("fkpr") + 0.3 * g("kpr") + 0.15 * g("acs"), q)),
            "awareness": scale(axis(0.5 * g("kast") + 0.35 * g("fdpr") + 0.15 * q, q)),
            "utility": scale(axis(0.55 * g("apr") + 0.45 * ROLE_UTIL[r["role"]], q)),
            "clutch": scale(axis(0.5 * g("clutch_pct") + 0.3 * q + 0.2 * g("kd"), q)) if r["clutch_pct"] is not None
            else scale(axis(0.6 * q + 0.4 * g("kd"), q)),
            "teamwork": scale(axis(0.5 * g("kast") + 0.5 * g("apr"), q)),
            "communication": scale(axis(0.55 * g("kast") + 0.45 * ROLE_COMM[r["role"]], q)),
            "igl": scale(axis(0.4 * g("apr") + 0.3 * g("kast") + 0.3 * ROLE_COMM[r["role"]], q), 35, 84),
        }
        w = ROLE_WEIGHT[r["role"]]
        shapes[pid] = {"role": r["role"], "attrs": attrs, "overall": round(sum(attrs[k] * w[k] for k in attrs)),
                       "pool": len(rows), "source": "build_world.py formulas on 2020-22 tier-one career totals"}
    (OUT / "attr_shapes.json").write_text(json.dumps(shapes, ensure_ascii=False, indent=1))
    print(f"{len(shapes)} shapes from a pool of {len(rows)} players; missing: {sorted(want - set(shapes))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
