"""
Round two/three of the offline rating: one pipeline, with the time fusion
as the only thing that changes between the baselines.

Every event a man played is rated on its own (metric z inside its role × tier
group, six abilities, a combat number). The baselines differ ONLY in how those
event lines are weighted:
  decay   weight = age decay × rounds            (one pooled, decayed count)
  stage   weight = age decay × min(rounds, 250)  (one event is at most as loud as 250 rounds)
  split   stage, then normalised inside each split (Kickoff / Stage 1 / Stage
          2 / Masters / Champions of a year) so a split's total weight is
          age decay × min(1, its rounds / 500): a split with many events is
          more reliable, not louder.
Attributes, the per-ability shrinkage (rounds behind aim/awareness/utility/
teamwork, first contacts behind reaction, clutch situations behind clutch,
all age-decayed, none capped) and the frozen score mapping are shared.

Regime (a change of level) is OFF by default. Two soft variants are kept for
comparison, confirmed per split rather than per event: the last two splits
(≥300 rounds each) both sit ≥ τ from the mean of the earlier splits (≥2
splits, ≥600 rounds) on the same side. soft-sym halves the earlier splits'
weight either way; soft-asym halves it on growth and leaves decline to the
smooth baseline.

Form is the last 30 days' deviation from the baseline, reported apart from
it, with the weight share those days already carry in the baseline.

A recorded main caller's overall = (1 − w) × combat + w × caller level +
honours, w FIXED for a confirmed identity (A: recorded and a year at the
club by the cutoff; B: recorded, shorter; C: inferred); the level estimate is
what is shrunk toward the callers' prior when evidence is thin, not the
weight. Honours: strict (dated, seen playing) in the back-test.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from datetime import date

from .common import ROLES, STAT_ABILITIES, TEMPLATES, clamp, half_life_weight, mean_sd, percentile_map
from .dataset import Record
from .honours import Honour, honour_points
from .igl import IglIdentity, IglLevel
from .models import Params, _blend

RND_CAP = 250.0
SPLIT_ROUNDS = 500.0
TAU = 0.35
SOFT_WEIGHT = 0.5


@dataclass
class P2(Params):
    fusion: str = "stage"            # decay / stage / split
    regime: str = "off"              # off / soft-sym / soft-asym
    igl_weight: float = 0.0          # 0 / .25 / .35 / .45, fixed for a confirmed caller
    igl_grades: str = "A"            # which identity grades count: "A" (strict) or "ABC" (sensitivity)
    honour_cap: float = 0.0          # 0 / 3 / 6
    honour_strict: bool = True
    form_days: int = 30


@dataclass
class EventLine:
    end: date
    split: str
    rnd: float
    fc: float                # first contacts behind reaction
    clt: float               # clutch situations behind clutch
    group: str
    role: str
    role_share: dict[str, float]
    z: dict[str, float | None]
    abilities: dict[str, float]
    combat: float


@dataclass
class Rated2:
    key: str
    ign: str
    club: str
    role: str
    combat_z: float
    combat: float
    igl_score: float | None
    igl_weight: float
    igl_grade: str
    igl_note: str
    honours: float
    honours_note: str
    overall: float
    form_z: float | None
    recent_share: float
    regime: str
    n_events: int
    rnd_w: float
    confidence: dict[str, float]
    abilities: dict[str, float]


METRICS = ("adr", "kpr", "hs", "fc_succ", "kd", "kast", "dpr", "fd_rate", "apr", "cl_rate")


def _metrics(r: Record) -> dict[str, float | None]:
    fc = (r.fk or 0) + (r.fd or 0)
    return {
        "adr": r.adr, "kpr": (r.k / r.rnd) if r.k is not None else None, "hs": r.hs,
        "fc_succ": (r.fk / fc) if r.fk is not None and fc >= 10 else None,
        "kd": (r.k / r.d) if r.k is not None and r.d else None, "kast": r.kast,
        "dpr": (r.d / r.rnd) if r.d is not None else None,
        "fd_rate": (r.fd / r.rnd) if r.fd is not None else None,
        "apr": (r.a / r.rnd) if r.a is not None else None,
        "cl_rate": ((r.clw or 0) / r.clt) if r.clt and r.clt >= 5 else None,
    }


def _role(r: Record) -> str:
    return max(r.role_share, key=r.role_share.get) if r.role_share else "自由人"


def split_of(r: Record) -> str:
    s = r.slug
    for k in ("kickoff", "stage-1", "stage-2", "stage-3"):
        if k in s:
            return f"{r.year}-{k}"
    if r.tier in ("masters", "champions"):
        return f"{r.year}-{s}"
    return f"{r.year}-{r.tier}"


class EventEnv:
    def __init__(self, recs: list[Record], min_rnd: float = 60.0, by_role: bool = True):
        self.t: dict[tuple, dict[str, tuple[float, float]]] = {}
        self.by_role = by_role
        pool = [(r, _metrics(r)) for r in recs if r.rnd >= min_rnd]
        # Normal levels are per season as well as per (role, tier group): a
        # 2022 KAST or APR is not a 2026 one (agents, assist rules, the field
        # itself). Season first, then the pooled seasons, then role, then all.
        keyfs = ((lambda r: (_role(r), r.group, r.year), lambda r: (_role(r), r.group), lambda r: (_role(r),), lambda r: ())
                 if by_role else (lambda r: (r.year,), lambda r: ()))
        for keyf in keyfs:
            b: dict[tuple, list] = {}
            for r, m in pool:
                b.setdefault(keyf(r), []).append(m)
            for k, ms in b.items():
                tab = self.t.setdefault(k, {})
                for met in METRICS:
                    xs = [m[met] for m in ms if m[met] is not None]
                    if len(xs) >= 30 or k == ():
                        tab[met] = mean_sd(xs) if xs else (0.0, 1.0)

    def z(self, r: Record, m: dict, met: str) -> float | None:
        v = m.get(met)
        if v is None:
            return None
        for k in (((_role(r), r.group, r.year), (_role(r), r.group), (_role(r),), ()) if self.by_role else ((r.year,), ())):
            if met in self.t.get(k, {}):
                mu, sd = self.t[k][met]
                return (v - mu) / sd
        return None


def event_lines(recs: list[Record], cutoff: date, env: EventEnv) -> dict[str, list[EventLine]]:
    out: dict[str, list[EventLine]] = {}
    for r in recs:
        if not r.end or r.date_estimated or r.end >= cutoff or r.rnd < 30:
            continue
        m = _metrics(r)
        z = {met: env.z(r, m, met) for met in METRICS}
        ab = {
            "aim": _blend([(z["adr"], .5), (z["kpr"], .3), (z["hs"], .2)]),
            "reaction": _blend([(z["fc_succ"], .6), (z["kd"], .4)]),
            "awareness": _blend([(z["kast"], .4), (None if z["dpr"] is None else -z["dpr"], .35),
                                 (None if z["fd_rate"] is None else -z["fd_rate"], .25)]),
            "utility": z["apr"], "clutch": z["cl_rate"],
            "teamwork": _blend([(z["kast"], .5), (z["apr"], .5)]),
        }
        ab = {k: (0.0 if v is None else clamp(v, -3, 3)) for k, v in ab.items()}
        share = r.role_share or {x: 0.25 for x in ROLES}
        combat = sum(share.get(x, 0.0) * sum(TEMPLATES[x][k] * ab[k] for k in STAT_ABILITIES) for x in ROLES)
        out.setdefault(r.key, []).append(EventLine(
            r.end, split_of(r), r.rnd, (r.fk or 0) + (r.fd or 0), float(r.clt or 0), r.group, _role(r), share, z, ab, combat))
    for v in out.values():
        v.sort(key=lambda e: e.end)
    return out


# ------------------------------------------------------------------ fusion weights

def fusion_weights(lines: list[EventLine], cutoff: date, P: P2) -> list[float]:
    dec = [half_life_weight((cutoff - e.end).days, P.half_life) for e in lines]
    if P.fusion == "decay":
        return [d * e.rnd for d, e in zip(dec, lines)]
    w = [d * min(e.rnd, RND_CAP) for d, e in zip(dec, lines)]
    if P.fusion == "stage":
        return w
    # split: each split's total weight is its mean decay × min(1, rounds/500)
    by: dict[str, list[int]] = {}
    for i, e in enumerate(lines):
        by.setdefault(e.split, []).append(i)
    out = list(w)
    for idxs in by.values():
        tot = sum(w[i] for i in idxs)
        if tot <= 0:
            continue
        rounds = sum(lines[i].rnd for i in idxs)
        target = statistics.fmean(dec[i] for i in idxs) * min(1.0, rounds / SPLIT_ROUNDS)
        for i in idxs:
            out[i] = w[i] / tot * target
    return out


def split_series(lines: list[EventLine]) -> list[tuple[str, float, float]]:
    """(split, combat weighted by reliability, rounds) in time order"""
    by: dict[str, list[EventLine]] = {}
    order = []
    for e in lines:
        if e.split not in by:
            order.append(e.split)
        by.setdefault(e.split, []).append(e)
    out = []
    for s in order:
        es = by[s]
        rel = [min(1.0, e.rnd / RND_CAP) for e in es]
        out.append((s, sum(e.combat * r for e, r in zip(es, rel)) / max(1e-9, sum(rel)), sum(e.rnd for e in es)))
    return out


def regime_factor(lines: list[EventLine], P: P2) -> tuple[list[float], str]:
    """per-event multiplier on the fusion weight, and the verdict"""
    ones = [1.0] * len(lines)
    if P.regime == "off":
        return ones, "none"
    ser = split_series(lines)
    if len(ser) < 4:
        return ones, "none"
    last = ser[-2:]
    prior = ser[:-2]
    if any(r < 300 for _, _, r in last) or len(prior) < 2 or sum(r for _, _, r in prior) < 600:
        return ones, "none"
    pm = statistics.fmean(c for _, c, _ in prior)
    gaps = [c - pm for _, c, _ in last]
    if all(g >= TAU for g in gaps):
        kind = "growth"
    elif all(g <= -TAU for g in gaps):
        kind = "decline"
    else:
        return ones, "none"
    if kind == "decline" and P.regime == "soft-asym":
        return ones, f"{kind}(not applied)@{last[0][0]}"
    cut_splits = {s for s, _, _ in last}
    return [1.0 if e.split in cut_splits else SOFT_WEIGHT for e in lines], f"{kind}@{last[0][0]}"


# ------------------------------------------------------------------ the composition

def _reference_lines(recs: list[Record], cutoff: date, by_role: bool = True):
    env = EventEnv([r for r in recs if r.end and not r.date_estimated and r.end < cutoff], by_role=by_role)
    return event_lines(recs, cutoff, env)


def _fuse(ls: list[EventLine], cutoff: date, P: P2):
    w = fusion_weights(ls, cutoff, P)
    f, regime = regime_factor(ls, P)
    w = [a * b for a, b in zip(w, f)]
    tot = sum(w)
    if tot <= 0:
        return None
    ab = {k: sum(e.abilities[k] * ww for e, ww in zip(ls, w)) / tot for k in STAT_ABILITIES}
    share_acc: dict[str, float] = {}
    for e, ww in zip(ls, w):
        for r, s in e.role_share.items():
            share_acc[r] = share_acc.get(r, 0.0) + s * ww
    share = {r: v / tot for r, v in share_acc.items()}
    dec = [half_life_weight((cutoff - e.end).days, P.half_life) * ff for e, ff in zip(ls, f)]
    n_rounds = sum(d * e.rnd for d, e in zip(dec, ls))
    n_fc = sum(d * e.fc for d, e in zip(dec, ls))
    n_cl = sum(d * e.clt for d, e in zip(dec, ls))
    recent = sum(ww for e, ww in zip(ls, w) if (cutoff - e.end).days <= P.form_days) / tot
    return ab, share, n_rounds, n_fc, n_cl, recent, regime


def reference2(recs: list[Record], ref_cutoff: date, P: P2, callers: dict[str, IglLevel]) -> dict:
    """z→score tables from the reference window's UNSHRUNK abilities (stage fusion), then frozen"""
    lines = _reference_lines(recs, ref_cutoff)
    Pref = P2(fusion="stage", regime="off", half_life=P.half_life)
    combats, abil = [], {k: [] for k in STAT_ABILITIES}
    for ls in lines.values():
        # the scale is anchored on tier-one players (most weighted rounds in
        # vct/intl events); with 2022's national legs in the cache the pool
        # would otherwise be thousands of sub-regional lines and "average"
        # would slide down to them
        top = sum(e.rnd for e in ls if e.group in ("vct", "intl"))
        if top < sum(e.rnd for e in ls) * 0.5:
            continue
        got = _fuse(ls, ref_cutoff, Pref)
        if not got or got[2] < 100:
            continue
        ab, share = got[0], got[1]
        combats.append(sum(share.get(x, 0.0) * sum(TEMPLATES[x][k] * ab[k] for k in STAT_ABILITIES) for x in ROLES))
        for k in STAT_ABILITIES:
            abil[k].append(ab[k])

    def fit(vals):
        pct = percentile_map(vals)
        target = [P.lo + (P.hi - P.lo) * pct[i] for i in range(len(vals))]
        mz, msd = mean_sd(vals)
        mt, tsd = mean_sd(target)
        return (mt - mz * (tsd / msd), tsd / msd)

    m = {"overall": fit(combats)}
    for k in STAT_ABILITIES:
        m[k] = fit(abil[k])
    # the caller level shares the combat scale: z = 0 (an ordinary professional
    # caller) lands where an ordinary tier-one player lands, and one z of level
    # is worth one z of combat. Fitting a separate percentile table over the
    # callers made z = 0 read 47 and three years of tenure read +33 — the
    # prior and the scale were not the same thing.
    m["igl"] = m["overall"]
    return m


def rate2(recs: list[Record], cutoff: date, P: P2, mapping: dict, ledger: dict[str, list[Honour]],
          ids: dict[str, IglIdentity], callers: dict[str, IglLevel]) -> dict[str, Rated2]:
    lines = _reference_lines(recs, cutoff, P.center_by_role)
    a, b = mapping["overall"]
    who: dict[str, tuple[str, str, date]] = {}
    for r in recs:
        if r.end and not r.date_estimated and r.end < cutoff:
            prev = who.get(r.key)
            if prev is None or r.end >= prev[2]:
                who[r.key] = (r.ign, r.club, r.end)
    out = {}
    for key, ls in lines.items():
        got = _fuse(ls, cutoff, P)
        if not got:
            continue
        ab, share, n_rounds, n_fc, n_cl, recent, regime = got
        conf = {k: n_rounds / (n_rounds + P.kappa_rounds) for k in ("aim", "awareness", "utility", "teamwork")}
        conf["reaction"] = n_fc / (n_fc + P.kappa_fc)
        conf["clutch"] = n_cl / (n_cl + P.kappa_cl) if n_cl > 0 else 0.0
        shrunk = {k: clamp(ab[k] * conf[k], -3, 3) for k in STAT_ABILITIES}
        combat_z = sum(share.get(x, 0.0) * sum(TEMPLATES[x][k] * shrunk[k] for k in STAT_ABILITIES) for x in ROLES)
        combat = clamp(a + b * combat_z, 30, 97)
        recent_lines = [e for e in ls if (cutoff - e.end).days <= P.form_days]
        form_z = (statistics.fmean(e.combat for e in recent_lines) - combat_z) if recent_lines else None
        ign, club_now = who[key][0], who[key][1]
        ign_l = ign.lower()
        idn = ids.get(ign_l)
        igl_score, note, w, grade = None, "not-a-caller", 0.0, "-"
        if idn is not None:
            grade = idn.grade(cutoff)
            L = callers.get(ign_l)
            if P.igl_weight > 0 and grade in P.igl_grades:
                ia, ib = mapping["igl"]
                lvl = L.z if (L is not None) else 0.0        # no evidence: the callers' prior
                igl_score = clamp(ia + ib * lvl, 30, 97)
                w = P.igl_weight
                note = f"grade {grade}, events {L.recorded if L else 0}+{L.assumed if L else 0}, resid {None if not L or L.over_perf is None else round(L.over_perf, 2)}, z {round(L.z, 2) if L else 0}±{L.range if L else 0.6}"
            else:
                note = f"grade {grade}, weight not applied"
        pts, hnote = 0.0, "no ledger"
        if P.honour_cap > 0:
            hs = ledger.get(ign_l)
            if hs is None:
                hnote = "unknown"
            else:
                pts, used, aside = honour_points(hs, cutoff, P.honour_cap, strict=P.honour_strict)
                hnote = (",".join(f"{h.tier}{(h.when or date(1, 1, 1)).year}" for h in used) or "none") + (f" (+{len(aside)} set aside)" if aside else "")
        overall = clamp(round((1 - w) * combat + w * (igl_score if igl_score is not None else combat) + pts), 30, 99)
        role = max(share, key=share.get) if share else ls[-1].role
        out[key] = Rated2(key=key, ign=ign, club=club_now, role=role, combat_z=combat_z, combat=combat,
                          igl_score=igl_score, igl_weight=w, igl_grade=grade, igl_note=note, honours=pts, honours_note=hnote,
                          overall=overall, form_z=form_z, recent_share=recent, regime=regime,
                          n_events=len(ls), rnd_w=n_rounds, confidence=conf, abilities=shrunk)
    return out
