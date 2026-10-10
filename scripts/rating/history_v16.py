#!/usr/bin/env python3
"""
v16: the live card rating (v15) with the cutoff made a parameter, for retired players.

    python3 -m scripts.rating.history_v16_data   # records + events first
    python3 -m scripts.rating.history_v16

What is the live algorithm, unchanged (analysis/rating/region_calibration_v15/算法说明.md):
- eight measures and the role weights (acs_role_v10), the frozen global SD and the
  frozen score scale BASE/SCALE, the missing-field regression, event totals at
  evidence quality 0.65, the 0.35 cross-tier bridge, 800-round shrinkage, the
  tail above 90, the career items Q/S/T/H/E/D/G with their units, half-lives and
  caps, the compression above 85, the cap at 92, gold 79 / silver 70.
What is re-derived for an earlier era, and why:
- the hero baselines. The live ones were fitted on 2025-26 maps; read against
  them 2022 Viper players lose 0.49 sd and Sage players gain 0.41, which is the
  meta, not the man. Each season gets its own baselines from that season's
  tier-one event totals, so a player is compared with his own era.
What is new, by the owner's decision (2026-10-09, 「生涯平均，巅峰赛季可以占比稍高」):
- a retired card reads the whole career without time decay, blended with his
  best season: L = (1-PEAK) x career + PEAK x best season (seasons with at least
  MIN_PEAK effective rounds). Career items are taken on his last match day, as
  the live study would have scored him that day.
"""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
import sys  # noqa: E402
sys.path.insert(0, str(ROOT))
from scripts.rating.common import AGENT_ROLE  # noqa: E402

OUT = ROOT / "analysis" / "rating" / "history_v16"


def read(p):
    return json.loads((ROOT / p).read_text())


# ---- frozen live constants ------------------------------------------------------
CFG = read("analysis/rating/role_context_v7/model.json")
WTS = read("analysis/rating/acs_role_v10/model.json")["weights"]
GSD = np.array(CFG["global_sd"])
BASE = 72 - 8 * CFG["mu"] / CFG["sd"]
SCALE = 8 / CFG["sd"]
SIGN = np.array([1, 1, 1, 1, 1, 1, 1, -1])
SHRINK = 800
BRIDGE = 0.35
QUALITY_EVENT = 0.65
AGENT_PRIOR = 500
ROLES = ["决斗者", "先锋", "控场", "哨卫"]
# owner's balance, set here and published with the scores
PEAK = 0.0  # owner 2026-10-10: plain career average, the best season not singled out
# off by default: the live cards do not have it (owner's call, see 方案.md)
REGION_BRIDGE = bool(int(__import__("os").environ.get("V16_REGION_BRIDGE", "0")))
MIN_PEAK = 400


def profile(ag: str | None, ro: str) -> str:
    if ro == "决斗者":
        return "进点型决斗"
    if ro == "先锋":
        return "信息先锋" if ag in ("sova", "fade") else "闪光先锋" if ag in ("breach", "skye", "kayo") else "混合先锋"
    if ro == "哨卫":
        return "Chamber接触型哨卫" if ag == "chamber" else "守点型哨卫"
    return "控场"


def values(r: dict) -> list:
    n = r["n"]
    rate = lambda c: None if r.get(c) is None else r[c] / n  # noqa: E731
    return [r.get("rating2"), rate("k"), r.get("adr"), r.get("acs"), rate("a"), r.get("kast"), rate("fk"), rate("fd")]


def shares(r: dict) -> list[tuple[str, float]]:
    arr = [(a.lower(), float(p)) for a, p in r.get("agents") or [] if a.lower() in AGENT_ROLE and p]
    s = sum(p for _, p in arr)
    return [(a, p / s) for a, p in arr] if s else []


# ---- missing-field completion: the live regression, fitted on the live maps -----
TRAIN = [r for r in read("analysis/rating/role_context_v7/scored_maps.json") if r["complete"] and r["date"] < "2026-07-01"]
_fit: dict = {}


def complete_z(z: np.ndarray, obs: list[bool], role: str) -> np.ndarray:
    known = tuple(i for i, b in enumerate(obs) if b)
    missing = tuple(i for i, b in enumerate(obs) if not b)
    if not known:
        return np.zeros(8)
    if missing:
        key = role, known
        if key not in _fit:
            tt = [t for t in TRAIN if t["role"] == role]
            x = np.array([[1] + [t["z_map"][j] for j in known] for t in tt])
            y = np.array([[t["z_map"][j] for j in missing] for t in tt])
            w = np.array([t["n"] / 20 for t in tt])
            pen = np.eye(len(known) + 1) * 50
            pen[0, 0] = 1
            _fit[key] = np.linalg.solve(x.T @ (w[:, None] * x) + pen, x.T @ (w[:, None] * y))
        for j, v in zip(missing, np.array([1] + [z[j] for j in known]) @ _fit[key]):
            z[j] = float(np.clip(v, -3, 3))
    return z


# ---- era baselines ---------------------------------------------------------------
def era_of(day: str) -> int:
    """2020 First Strike belongs with 2021: one meta, a few weeks apart"""
    return max(2021, int(day[:4]))


def fit_baselines(recs: list[dict]) -> dict:
    """per era: hero baselines solved from tier-one event totals.

    A line is a mix of heroes, so its expected value is Σ share_a x base_a. Each
    measure is solved as ridge least squares over all lines of the era, weighted
    by rounds, pulled towards the role mean with AGENT_PRIOR pseudo-rounds — the
    live study's 500-round hero prior, on the granularity we have.
    """
    out = {}
    by = defaultdict(list)
    for r in recs:
        if r["level"] == "top" and r["sh"]:
            by[r["era"]].append(r)
    for era, rr in by.items():
        agents = sorted({a for r in rr for a, _ in r["sh"]})
        ai = {a: i for i, a in enumerate(agents)}
        res = {}
        for j in range(8):
            rows = [r for r in rr if r["vals"][j] is not None]
            if not rows:
                continue
            X = np.zeros((len(rows), len(agents)))
            y = np.array([r["vals"][j] for r in rows])
            w = np.array([r["n"] for r in rows])
            for k, r in enumerate(rows):
                for a, p in r["sh"]:
                    X[k, ai[a]] = p
            # role mean of this measure, from lines played mostly on one role
            role_mean = {}
            for ro in ROLES:
                sel = [k for k, r in enumerate(rows) if sum(p for a, p in r["sh"] if AGENT_ROLE[a] == ro) >= .7]
                role_mean[ro] = float(np.average(y[sel], weights=w[sel])) if sel else float(np.average(y, weights=w))
            prior = np.array([role_mean[AGENT_ROLE[a]] for a in agents])
            # pseudo-rounds per hero: (sum share*rounds) gets AGENT_PRIOR rounds of the role mean
            A = X.T @ (w[:, None] * X) + AGENT_PRIOR * np.eye(len(agents))
            b = X.T @ (w * y) + AGENT_PRIOR * prior
            sol = np.linalg.solve(A, b)
            res[j] = ({a: float(sol[ai[a]]) for a in agents}, role_mean)
        out[era] = res
    return out


def score_record(r: dict, bases: dict) -> dict | None:
    sh = r["sh"]
    role = r["role"]
    era = bases.get(r["era"]) or bases[max(bases)]
    if not sh:
        sh = [(None, 1.0)]
    weights = sum((p * np.array(WTS[profile(a, AGENT_ROLE.get(a, role) if a else role)]) for a, p in sh), start=np.zeros(8))
    base = np.zeros(8)
    for j in range(8):
        if j not in era:
            continue
        hero, rmean = era[j]
        base[j] = sum(p * (hero.get(a, rmean[AGENT_ROLE.get(a, role)]) if a else rmean[role]) for a, p in sh)
    obs = [v is not None for v in r["vals"]]
    if sum(obs) < 2:
        return None
    v = np.array([0 if x is None else x for x in r["vals"]])
    z = complete_z((v - base) / GSD * SIGN, obs, role)
    q = float(weights @ z)
    cov = float(weights @ np.array(obs, float))
    return {"q": q, "z": z.tolist(), "coverage": cov, "weights": weights.tolist(),
            "x": q - BRIDGE * (r["level"] == "t2")}


def tail(b: float) -> float:
    return b if b <= 90 else 90 + .35 * (b - 90)


def personal(rr: list[dict], decay_to: str | None = None, half: float = 180) -> dict:
    """the live estimator. decay_to=None reads a career with no time decay."""
    if decay_to:
        cut = date.fromisoformat(decay_to)
        dw = lambda d: 2 ** (-max(0, (cut - date.fromisoformat(d)).days) / half)  # noqa: E731
    else:
        dw = lambda d: 1.0  # noqa: E731
    w = np.array([r["n"] * dw(r["date"]) * r["coverage"] * QUALITY_EVENT for r in rr])
    N = float(w.sum())
    if not rr or N <= 0:
        return {"N": 0.0, "L": 0.0, "B": BASE, "P": tail(BASE)}
    ML = float(sum(wi * r["x"] for wi, r in zip(w, rr)) / N)
    M = ML
    if decay_to:
        # the live 90-day channel: an event total counts as recent only when
        # the whole event lies inside the window
        lo = (date.fromisoformat(decay_to).toordinal() - 90)
        rec = [(wi, r) for wi, r in zip(w, rr) if date.fromisoformat(r.get("start") or r["date"]).toordinal() >= lo]
        NR = sum(wi for wi, _ in rec)
        if NR > 0:
            MR = sum(wi * r["x"] for wi, r in rec) / NR
            a = .70 * NR / (NR + 150)
            M = (1 - a) * ML + a * MR
    L = N / (N + SHRINK) * M
    return {"N": N, "L": L, "B": BASE + SCALE * L, "P": tail(BASE + SCALE * L)}


# ---- career items (v8 / v9 / v11 rules, cutoff as a parameter) -------------------
LEDGER = read("analysis/rating/career_history_v8/merged_international_ledger.json")
VLR_PEOPLE = read("scripts/cache/vlr_people.json")
STRENGTH = {1: 1, 2: 1, 3: .75, 4: .6, 5: .4, 6: .4, 7: .2, 8: .2}


def days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def dec(day: str, cut: str, half: float) -> float:
    return 2 ** (-max(0, days(day, cut)) / half)


def region_of(slug: str) -> str | None:
    s = slug.lower()
    for pat, reg in [("china", "China"), ("americas", "Americas"), ("asia-pacific|apac", "APAC"), ("pacific", "Pacific"), ("emea", "EMEA"),
                     ("north-america", "NA"), ("brazil", "BR"), ("latam|latin-america|south-america", "LATAM"),
                     ("korea", "KR"), ("japan", "JP"), ("cis", "CIS"), ("turkey", "TR"),
                     ("europe", "EU"), ("asia-pacific|apac|sea|southeast-asia|east-asia", "APAC")]:
        if __import__("re").search(pat, s):
            return reg
    return None


def slot_of(slug: str, year: int) -> str | None:
    s = slug.lower()
    if "last-chance" in s or "lcq" in s:
        return "lcq"
    if "kickoff" in s or "first-strike" in s:
        return "kickoff"
    for k in ("stage-1", "stage-2", "stage-3"):
        if k in s:
            return k
    if year == 2023 and "league" in s:
        return "stage-1"
    return None


# the international each regional stage fed (v11's links, written out for 2021-23)
LINKS = {(2021, "stage-2"): "353", (2021, "stage-3"): "466", (2021, "lcq"): "449",
         (2022, "stage-1"): "926", (2022, "stage-2"): "1014", (2022, "lcq"): "1015",
         (2023, "stage-1"): "1494", (2023, "lcq"): "1657",
         (2024, "kickoff"): "1921", (2024, "stage-1"): "1999", (2024, "stage-2"): "2097",
         (2025, "kickoff"): "2281", (2025, "stage-1"): "2282", (2025, "stage-2"): "2283",
         (2026, "kickoff"): "2760", (2026, "stage-1"): "2765"}


def team_place(eid: str, pid: str, events: dict) -> tuple[float | None, str | None]:
    """overall standing of the team this man played the event for (vlr_people names the team)"""
    st = (events.get(eid) or {}).get("standings") or []
    if not st:
        return None, None
    team = next((e["team"] for e in (VLR_PEOPLE.get(pid) or {}).get("events", []) if e["id"] == eid), None)
    if not team:
        return None, None
    team = __import__("re").sub(r"^\$[\d,.]+\s*", "", team).strip().lower()
    hit = next((t for t in st if t["team"].lower() == team), None)
    return ((hit["lo"] + hit["hi"]) / 2, hit["team"]) if hit else (None, team)


class Career:
    def __init__(self, events: dict, recs: list[dict]):
        self.events = events
        self.by_event = defaultdict(list)
        for r in recs:
            self.by_event[r["eid"]].append(r)
        self.intl = {}
        for t in LEDGER:
            self.intl.setdefault(t["event_id"], []).append(t)
        # a team's region in a year: where its players played their regional stages
        self.team_region = {}
        home = defaultdict(lambda: defaultdict(float))
        for r in recs:
            ev = events.get(r["eid"]) or {}
            if r["level"] == "top" and ev.get("tier") in ("league", "kickoff") and slot_of(ev["slug"], ev["year"]) != "lcq":
                reg = region_of(ev["slug"])
                if reg:
                    home[(ev["year"], r["pid"])][reg] += r["n"]
        for eid, tt in self.intl.items():
            for t in tt:
                votes = defaultdict(float)
                for p in t["participants"]:
                    for reg, n in home[(t["year"], str(p["pid"]))].items():
                        votes[reg] += n
                self.team_region[(eid, t["team_id"])] = max(votes, key=votes.get) if votes else None
        self.env = {}
        for eid, tt in self.intl.items():
            placed = [t for t in tt if t.get("place_high") is not None and self.team_region.get((eid, t["team_id"]))]
            if eid == "2766" or len(placed) < 8:
                continue
            u = lambda p: .30 * (p <= 8) + .50 * (p <= 4) + .15 * (p <= 2) + .05 * (p == 1)  # noqa: E731
            mu = sum(u(t["place_high"]) for t in placed) / len(placed)
            regs = defaultdict(list)
            for t in placed:
                regs[self.team_region[(eid, t["team_id"])]].append(t)
            self.env[eid] = {"end": tt[0]["end"], "g": {reg: max(-1.5, min(1.5, 8 * (sum(u(t["place_high"]) for t in rr) - len(rr) * mu) / (len(rr) + 4)))
                                                        for reg, rr in regs.items()}}

    def part(self, team: dict, pid: str) -> float:
        peers = [p.get("rounds") or 0 for p in team["participants"] if p.get("appearance") == "played"]
        mx = max(peers or [0])
        me = next((p for p in team["participants"] if str(p["pid"]) == pid and p.get("appearance") == "played"), None)
        return min(1, (me.get("rounds") or 0) / mx) if me and mx > 0 else 0.0

    def international(self, pid: str, cut: str) -> dict:
        done = {eid: tt for eid, tt in self.intl.items() if tt[0].get("end") and tt[0]["end"] < cut}
        factor = lambda t: 1.25 if t["tier"] == "champions" else .75 if t["event_id"] == "1188" else 1  # noqa: E731
        qw = {eid: factor(tt[0]) * dec(tt[0]["date"], cut, 365) for eid, tt in done.items()}
        tw = {eid: dec(tt[0]["end"], cut, 730) for eid, tt in done.items()}
        qd, td = sum(qw.values()) or 1, sum(tw.values()) or 1
        Q = S = T = H = X = 0.0
        rows = []
        for eid, tt in done.items():
            for t in tt:
                a = self.part(t, pid)
                if a <= 0:
                    continue
                place = t.get("place_high")
                q = 3 * qw[eid] / qd * a
                s = qw[eid] / qd * {1: 1, 2: 2 / 3, 3: 1 / 3, 4: 0}.get(t.get("seed"), 0) * a
                res = 3 * tw[eid] / td * STRENGTH.get(place, 0) * a
                h = (2.5 if t["tier"] == "champions" else 1.25) * dec(t["end"], cut, 1460) * a \
                    if t.get("place_low") == t.get("place_high") == 1 else 0
                Q += q; S += s; T += res; H += h; X += a * dec(t["end"], cut, 1460)
                rows.append({"event": t["event"], "eid": eid, "team": t["team_name"], "place": t.get("place_label"),
                             "participation": round(a, 3), "Q": q, "S": s, "T": res, "H": h})
        E = 3 * (1 - math.exp(-X / 3))
        return {"Q": Q, "S": S, "T": T, "H": H, "E": E, "rows": rows}

    def seasons(self, pid: str, cut: str, mine: list[dict]) -> dict:
        """D: fixed three stage slots a year, overall standings, participation by rounds"""
        yearly = defaultdict(lambda: defaultdict(list))
        titles = defaultdict(float)
        rows = []
        for r in mine:
            ev = self.events.get(r["eid"]) or {}
            if r["level"] != "top" or ev.get("tier") not in ("league", "kickoff") or not ev.get("end") or ev["end"] >= cut:
                continue
            slot = slot_of(ev["slug"], ev["year"])
            mid, team = team_place(r["eid"], pid, self.events)
            mates = [x for x in self.by_event[r["eid"]] if x["club"] == r["club"] and x["level"] == "top"]
            a = min(1, r["n"] / max(x["n"] for x in mates)) if mates else 1
            field = max(len({t["team"] for t in ev.get("standings") or []}),
                        len({x["club"] for x in self.by_event[r["eid"]] if x["level"] == "top"}))
            u = (field - mid) / (field - 1) if mid is not None and field > 1 else None
            rows.append({"event": ev.get("name") or ev["slug"], "eid": r["eid"], "year": ev["year"], "slot": slot,
                         "team": team, "place": mid, "field": field, "u": u, "participation": round(a, 3)})
            if slot and slot != "lcq":
                yearly[ev["year"]][slot].append((u, a, ev["end"]))
            if mid == 1 and slot != "lcq":
                titles[ev["year"]] += .75 * dec(ev["end"], cut, 730) * a
        D = 0.0
        for y, slots in yearly.items():
            parts = [sum((u or 0) * a * dec(d, cut, 730) for u, a, d in es) / max(1, sum(a for _, a, _ in es)) for es in slots.values()]
            D += max(2 * sum(parts) / 3, titles.get(y, 0))
        return {"D": min(3, D), "rows": rows}

    def environment(self, r: dict) -> float:
        ev = self.events.get(r["eid"]) or {}
        if r["level"] != "top" or ev.get("tier") not in ("league", "kickoff"):
            return 0.0
        slot = slot_of(ev["slug"], ev["year"])
        reg = region_of(ev["slug"])
        link = LINKS.get((ev["year"], slot))
        src = self.env.get(link) if link else None
        if src and reg in src["g"]:
            return src["g"][reg]
        # carry the latest finished international before this event, 180-day fade
        prior = [(e["end"], e) for e in self.env.values() if e["end"] < r["date"] and reg in e["g"]]
        if not prior:
            return 0.0
        end, e = max(prior, key=lambda x: x[0])
        return e["g"][reg] * 2 ** (-days(end, r["date"]) / 180)


def load() -> tuple[dict, list[dict]]:
    events = json.loads((OUT / "events.json").read_text())
    raw = json.loads((OUT / "records.json").read_text())
    recs = []
    for r in raw:
        ev = events.get(r["eid"]) or {}
        day = ev.get("end")
        if not day:
            continue
        sh = shares(r)
        role_n = defaultdict(float)
        for a, p in sh:
            role_n[AGENT_ROLE[a]] += p
        role = max(role_n, key=role_n.get) if role_n else "先锋"
        recs.append({**r, "date": day, "start": ev.get("start") or day, "era": era_of(day), "sh": sh, "role": role, "vals": values(r)})
    return events, recs


def igl_years() -> dict[str, dict]:
    """callers: Liquipedia's role field, the page matched to the man by its vlr id
    (or, on a page without one, by nationality). The historical worlds' isIgl is
    not used: it marks Leo, not Boaster, as FNATIC's 2023 caller."""
    roles = json.loads((OUT / "liquipedia_roles.json").read_text())
    return {vid: r for vid, r in roles.items() if r["igl"]}


def flexibility(rr: list[dict]) -> tuple[float, list]:
    """F: a second role played well — 150 coverage-weighted rounds, 10% share, index ≥ 0"""
    byrole = defaultdict(lambda: [0.0, 0.0])
    for r in rr:
        for a, p in r["sh"] or [(None, 1)]:
            ro = AGENT_ROLE.get(a, r["role"]) if a else r["role"]
            n = r["n"] * r["coverage"] * p
            byrole[ro][0] += n
            byrole[ro][1] += n * r["x"]
    tot = sum(v[0] for v in byrole.values()) or 1
    main_role = max(byrole, key=lambda k: byrole[k][0]) if byrole else None
    ok = [(ro, n) for ro, (n, sx) in byrole.items()
          if ro != main_role and n >= 150 and n / tot >= .10 and sx / n >= 0]
    return min(1.5, .75 * sum(n / (n + 150) for _, n in ok)), [ro for ro, _ in ok]


def season_index(rr: list[dict]) -> dict[int, dict]:
    out = {}
    for y in sorted({r["era"] for r in rr}):
        out[y] = personal([r for r in rr if r["era"] == y])
    return out


def world_shapes() -> dict[str, dict[int, dict]]:
    """vlr id -> year -> {attrs, overall, role} from the 2023-2025 worlds"""
    out = defaultdict(dict)
    for y in (2023, 2024, 2025):
        for p in read(f"src/data/world_{y}.json")["players"]:
            if p.get("vlrId"):
                out[str(p["vlrId"])][y] = {"attrs": p["attrs"], "overall": p["overall"], "role": p["role"], "isIgl": bool(p.get("isIgl"))}
    return out


def shaped(shapes: dict[int, dict], year: int | None, rating: int, igl: bool | None = None) -> dict | None:
    """the live rule (cards.ts shiftAttrs): his own attribute shape, every one
    moved by the same gap so they sum to the new rating as they did before.

    The caller bump the world builder gives (指挥 +12, 沟通 +4, build_world.py)
    follows the verified caller identity (Liquipedia, by vlr id), not the
    world's isIgl: the 2023-24 worlds made Leo FNATIC's caller, not Boaster."""
    if not shapes:
        return None
    y = min(shapes, key=lambda k: (abs(k - (year or k)), -k))
    w = shapes[y]
    attrs = dict(w["attrs"])
    if igl is not None and bool(w.get("isIgl")) != igl:
        sign = 1 if igl else -1
        attrs["igl"] = int(max(35, min(99, attrs["igl"] + 12 * sign)))
        attrs["communication"] = int(max(25, min(99, attrs["communication"] + 4 * sign)))
    by = rating - w["overall"]
    return {"year": y, "role": w["role"], "igl": bool(igl) if igl is not None else bool(w.get("isIgl")),
            "attrs": {k: max(1, min(99, v + by)) for k, v in attrs.items()}}


def region_offsets(scored: list[dict], events: dict) -> dict:
    """per era and region: how much better the same players scored at home than at
    the internationals within a year, relative to the era's average region —
    the cross-tier bridge's idea applied to regions, shrunk with 10 players"""
    by = defaultdict(list)
    for r in scored:
        by[r["pid"]].append(r)
    gaps = defaultdict(lambda: defaultdict(list))
    for pid, rr in by.items():
        intl = [r for r in rr if events[r["eid"]]["tier"] in ("masters", "champions") and r["n"] >= 100]
        for r in rr:
            e = events[r["eid"]]
            if r["level"] != "top" or e["tier"] not in ("league", "kickoff") or r["n"] < 100 or not intl:
                continue
            reg = region_of(e["slug"])
            i = min(intl, key=lambda i: abs(days(i["date"], r["date"])))
            if reg and abs(days(i["date"], r["date"])) <= 365:
                gaps[(era_bucket(e["year"]), reg)][pid].append(r["q"] - i["q"])
    raw = {}
    for k, per in gaps.items():
        meds = sorted(sorted(v)[len(v) // 2] for v in per.values())
        raw[k] = (meds[len(meds) // 2], len(meds))
    out = {}
    for era in {k[0] for k in raw}:
        regs = {k[1]: v for k, v in raw.items() if k[0] == era}
        mean = sum(m for m, _ in regs.values()) / len(regs)
        for reg, (m, n) in regs.items():
            out[(era, reg)] = (m - mean) * n / (n + 10)
    return out


def era_bucket(year: int) -> str:
    return "2020-22" if year <= 2022 else "2023" if year == 2023 else "2024-26"


def quantile_lines(ratings: list[int]) -> tuple[int, int]:
    """the live rule (v15): gold from the 80th percentile, silver from the 45th, ties
    take the higher metal — 20/35/45 of the pool, recomputed every time the pool moves"""
    r = sorted(ratings)
    q = lambda p: r[max(0, math.ceil(p * len(r)) - 1)]  # noqa: E731
    return q(.80), q(.45)


def compress(S: float) -> float:
    return max(40, min(92, S if S <= 85 else 85 + .5 * (S - 85)))


# The retired squeeze (owner, 2026-10-11, players' feedback 「退役卡数值太高」):
# the retired pool is top-heavy — 4% of it at 90+ against 1.5% of the live one,
# because the famous men are the ones who stopped — and three SEN 92s on one
# five was the result. Above RETIRED_PIVOT every point counts RETIRED_SLOPE,
# taken on the uncapped score so the top men keep their order (Leo 89, TenZ
# and Sacy 88, SicK and ScreaM 87); below it nothing moves, nor do the metal lines.
RETIRED_PIVOT, RETIRED_SLOPE = 80, 0.6


def retired_squeeze(S: float) -> float:
    c = max(40, S if S <= 85 else 85 + .5 * (S - 85))
    c = c if c <= RETIRED_PIVOT else RETIRED_PIVOT + (c - RETIRED_PIVOT) * RETIRED_SLOPE
    return min(92, c)


def main() -> int:
    events, recs = load()
    bases = fit_baselines(recs)
    scored = []
    for r in recs:
        if r["eid"] == "2766":
            continue
        s = score_record(r, bases)
        if s:
            scored.append({**r, **s})
    offsets = region_offsets(scored, events) if REGION_BRIDGE else {}
    if offsets:
        for r in scored:
            e = events[r["eid"]]
            if e["tier"] not in ("masters", "champions"):
                r["x"] -= offsets.get((era_bucket(e["year"]), region_of(e["slug"])), 0.0)
        (OUT / "region_offsets.json").write_text(json.dumps({f"{a} {b}": round(v, 4) for (a, b), v in sorted(offsets.items())}, ensure_ascii=False, indent=1))
    by = defaultdict(list)
    for r in scored:
        by[r["pid"]].append(r)
    car = Career(events, scored)
    igl = igl_years()
    shapes = world_shapes()
    plan = json.loads((OUT / "retired_fetch_list.json").read_text())
    status = {c["vlrId"]: c for c in plan["classification"]}
    verdict = json.loads((OUT / "status_verified.json").read_text()) if (OUT / "status_verified.json").exists() else {}
    # the 2020-22 retirees the owner added (2026-10-10): never in a saved world
    for vid, v in verdict.items():
        if v.get("early") and vid not in status:
            status[vid] = {"vlrId": vid, "ign": v["ign"], "class": v["class"], "early": True}
    # men with no world shape get the world builder's formulas on their own era
    derived = json.loads((OUT / "attr_shapes.json").read_text()) if (OUT / "attr_shapes.json").exists() else {}

    # first-season breakout needs everyone's seasons: same region, same role, top quarter
    seasons = defaultdict(list)
    first_top = {}
    for pid, rr in by.items():
        top = [r for r in rr if r["level"] == "top"]
        for y in sorted({r["era"] for r in top}):
            yy = [r for r in top if r["era"] == y]
            if sum(r["n"] for r in yy) < 400:
                continue
            regs = defaultdict(float)
            for r in yy:
                reg = region_of(events[r["eid"]]["slug"])
                if reg:
                    regs[reg] += r["n"]
            roles = defaultdict(float)
            for r in yy:
                roles[r["role"]] += r["n"]
            if regs:
                seasons[(y, max(regs, key=regs.get), max(roles, key=roles.get))].append((personal(yy)["L"], pid))
            first_top.setdefault(pid, y)
    breakout = set()
    for (y, reg, ro), arr in seasons.items():
        arr.sort(reverse=True)
        cut = max(1, math.ceil(len(arr) * .25))
        for L, pid in arr[:cut]:
            if first_top.get(pid) == y:
                breakout.add((pid, y))

    out = []
    for vid, st in status.items():
        cls = verdict.get(vid, {}).get("class", st["class"])
        rr = sorted(by.get(vid, []), key=lambda r: r["date"])
        if not rr:
            out.append({"vlrId": vid, "ign": st["ign"], "class": cls, "rated": False, "why": "no dated event record"})
            continue
        last = rr[-1]["date"]
        cut = (date.fromisoformat(last).toordinal() + 1)
        cut = date.fromordinal(cut).isoformat()
        career = personal(rr)
        per = season_index(rr)
        eligible = {y: v for y, v in per.items() if v["N"] >= MIN_PEAK}
        peak_y = max(eligible, key=lambda y: eligible[y]["L"]) if eligible else None
        L = (1 - PEAK) * career["L"] + PEAK * eligible[peak_y]["L"] if peak_y else career["L"]
        P = tail(BASE + SCALE * L)
        intl = car.international(vid, cut)
        sea = car.seasons(vid, cut, rr)
        w = [r["n"] * r["coverage"] * QUALITY_EVENT for r in rr]
        G = 1.5 * sum(wi * car.environment(r) for wi, r in zip(w, rr)) / (career["N"] + SHRINK)
        I = 2.0 if igl.get(vid) else 0.0
        F, Froles = flexibility(rr)
        Cb = 1.0 if any((vid, y) in breakout for y in per) else 0.0
        O = intl["Q"] + intl["S"] + intl["T"] + sea["D"] + intl["E"] + I + F + Cb
        H = intl["H"]
        S = P + min(10, O) + min(4, H) + G
        C = compress(S)
        live_scale = math.floor(C + .5)
        new = math.floor(retired_squeeze(S) + .5) if cls == "retired" else live_scale
        out.append({
            "vlrId": vid, "ign": st["ign"], "class": cls, "rated": True, "last": last, "cutoff": cut,
            "rating": new, "liveScale": live_scale, "rarity": "gold" if new >= 79 else "silver" if new >= 70 else "bronze",
            "card": shaped(shapes.get(vid) or ({0: derived[vid]} if vid in derived else {}), peak_y, new, bool(igl.get(vid))),
            "early": bool(st.get("early")),
            "S": S, "P": P, "L": L, "careerL": career["L"], "careerN": career["N"], "rounds": sum(r["n"] for r in rr),
            "peakYear": peak_y, "peakL": eligible[peak_y]["L"] if peak_y else None,
            "seasons": {y: {"N": round(v["N"], 1), "L": round(v["L"], 4), "P": round(v["P"], 2)} for y, v in per.items()},
            "O": O, "H": H, "G": G, "Q": intl["Q"], "Sd": intl["S"], "T": intl["T"], "E": intl["E"], "D": sea["D"],
            "I": I, "F": F, "Froles": Froles, "breakout": Cb,
            "international": intl["rows"], "regional": sea["rows"],
            "records": [{"eid": r["eid"], "event": events[r["eid"]].get("name") or events[r["eid"]]["slug"], "date": r["date"],
                         "level": r["level"], "stage": r.get("stage"), "rounds": r["n"], "club": r["club"],
                         "agents": r["sh"], "q": round(r["q"], 4), "coverage": round(r["coverage"], 3)} for r in rr],
        })
    (OUT / "baselines.json").write_text(json.dumps(
        {str(e): {CFG["labels"][j]: {"heroes": h, "roles": rm} for j, (h, rm) in v.items()} for e, v in bases.items()},
        ensure_ascii=False, indent=1))
    # metal by the retired pool's own 20/35/45 lines (owner, 2026-10-10)
    pool = [p for p in out if p["rated"] and p["class"] == "retired"]
    gold, silver = quantile_lines([p["rating"] for p in pool])
    for p in out:
        if p["rated"]:
            p["rarity"] = "gold" if p["rating"] >= gold else "silver" if p["rating"] >= silver else "bronze"
    # the file is written only after the metal is set (a write before this kept the old fixed 79/70 metal)
    share = Counter(p["rarity"] for p in pool)
    assert share["gold"] >= .20 * len(pool) and share["gold"] + share["silver"] >= .55 * len(pool), share
    (OUT / ("players_region_bridge.json" if REGION_BRIDGE else "players.json")).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    (OUT / "lines.json").write_text(json.dumps({"retired": {"gold": gold, "silver": silver, "pool": len(pool)}}, indent=1))
    rated = pool
    print("retired lines: gold", gold, "silver", silver)
    print(len(out), "candidates,", len(rated), "rated;", Counter(p["rarity"] for p in rated))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
