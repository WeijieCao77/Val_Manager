"""
Round two of the offline rating: a stable ability baseline, early data that
retires, honours on their own ledger, and a main caller's overall.

Three ways to turn dated event lines into an ability, compared, none chosen:
  decay   one time-decayed pool of counts (round one's new_scheme).
  stage   each event is rated on its own first (z inside its tier group), then
          the event ratings are blended by age × reliability, where
          reliability = min(1, rounds / RND_CAP): a split with three times the
          maps is more reliable, not three times as loud.
  regime  stage, plus a change-point test: when the latest block of ≥3 events
          and ≥600 rounds sits ≥ τ above or below everything before it and at
          least 80% of that block is on the same side, the baseline resets
          there and the older events keep only HIST_WEIGHT of their weight.
          Growth and decline use the one rule; only past events are looked at.
Form is the last 30 days' deviation from the baseline and is reported apart
from it; the report also prints how much of the baseline those same 30 days
already carry, which is the double count the owner asked to see.

The overall of a recorded main caller is
  (1 − w) × combat + w × caller level + honours (capped),
with combat and caller level both on the game's 44–98 scale, w a candidate
(0 / .25 / .35 / .45), the caller's identity taken at the cutoff (unknown
before his tenure began), and honours only those already won by the cutoff.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from .common import ROLES, STAT_ABILITIES, TEMPLATES, clamp, half_life_weight, mean_sd, percentile_map
from .dataset import Record
from .honours import Honour, honour_points
from .igl import IglIdentity, IglLevel
from .models import Params, _blend

RND_CAP = 250.0          # rounds at which one event is fully reliable
TAU = 0.35               # z gap that counts as a change of level
HIST_WEIGHT = 0.15       # what events before a change point keep
BLOCK_EVENTS, BLOCK_ROUNDS = 3, 600


@dataclass
class P2(Params):
    time_scheme: str = "stage"      # decay / stage / regime
    igl_weight: float = 0.0         # 0 / .25 / .35 / .45
    honour_cap: float = 0.0         # 0 / 3 / 6
    form_days: int = 30


@dataclass
class EventLine:
    end: date
    rnd: float
    group: str
    role: str
    role_share: dict[str, float]
    z: dict[str, float]                      # metric z inside (role, group) of the training window
    abilities: dict[str, float]              # six, unshrunk
    combat: float                            # template(role) · abilities


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
    igl_note: str
    honours: float
    honours_note: str
    overall: float
    form_z: float | None
    recent_share: float          # weight share of the last form_days in the baseline
    regime: str                  # none / growth@date / decline@date
    n_events: int
    rnd_w: float
    confidence: dict[str, float]
    abilities: dict[str, float]


# ------------------------------------------------------------------ per-event lines

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


class EventEnv:
    """normal levels per metric by (role, tier group) over the training window's event lines"""

    def __init__(self, recs: list[Record], min_rnd: float = 60.0):
        self.t: dict[tuple, dict[str, tuple[float, float]]] = {}
        pool = [(r, _metrics(r)) for r in recs if r.rnd >= min_rnd]
        for keyf in (lambda r: (_role(r), r.group), lambda r: (_role(r),), lambda r: ()):
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
        for k in ((_role(r), r.group), (_role(r),), ()):
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
        role = _role(r)
        share = r.role_share or {x: 0.25 for x in ROLES}
        combat = sum(share.get(x, 0.0) * sum(TEMPLATES[x][k] * ab[k] for k in STAT_ABILITIES) for x in ROLES)
        out.setdefault(r.key, []).append(EventLine(r.end, r.rnd, r.group, role, share, z, ab, combat))
    for v in out.values():
        v.sort(key=lambda e: e.end)
    return out


# ------------------------------------------------------------------ blending

def _weights(lines: list[EventLine], cutoff: date, half_life: float) -> list[float]:
    return [half_life_weight((cutoff - e.end).days, half_life) * min(1.0, e.rnd / RND_CAP) for e in lines]


def change_point(lines: list[EventLine], w: list[float]) -> tuple[int | None, str]:
    """index where the latest consistent shift begins, and its direction.

    Both sides must stand on enough evidence (≥ BLOCK_EVENTS events and
    ≥ BLOCK_ROUNDS rounds each) and are compared by reliability alone — the
    time decay in `w` would make any old block look light and any recent
    block look like a change. Chronicle's two-event 2024 opening (88 rounds at
    +2.0) read as a baseline he had "declined" from before this rule."""
    best, best_gap, kind = None, 0.0, "none"
    rel = [min(1.0, e.rnd / RND_CAP) for e in lines]
    for j in range(BLOCK_EVENTS, len(lines) - BLOCK_EVENTS + 1):
        post, pre = lines[j:], lines[:j]
        if sum(e.rnd for e in post) < BLOCK_ROUNDS or sum(e.rnd for e in pre) < BLOCK_ROUNDS:
            continue
        pre_mean = sum(e.combat * r for e, r in zip(pre, rel[:j])) / max(1e-9, sum(rel[:j]))
        post_mean = sum(e.combat * r for e, r in zip(post, rel[j:])) / max(1e-9, sum(rel[j:]))
        gap = post_mean - pre_mean
        same = sum(1 for e in post if (e.combat - pre_mean) * gap > 0) / len(post)
        tail = statistics.fmean(e.combat for e in post[-BLOCK_EVENTS:]) - pre_mean
        if abs(gap) >= TAU and same >= 0.8 and tail * gap > 0 and abs(tail) >= TAU / 2 and abs(gap) > best_gap:
            best, best_gap, kind = j, abs(gap), ("growth" if gap > 0 else "decline")
    return best, kind


def baseline(lines: list[EventLine], cutoff: date, P: P2) -> tuple[dict[str, float], float, float, str, float]:
    """abilities (six, unshrunk), combat, weighted rounds, regime note, recent-share"""
    w = _weights(lines, cutoff, P.half_life)
    regime = "none"
    if P.time_scheme == "regime":
        j, kind = change_point(lines, w)
        if j is not None:
            w = [ww * (HIST_WEIGHT if i < j else 1.0) for i, ww in enumerate(w)]
            regime = f"{kind}@{lines[j].end.isoformat()}"
    tot = sum(w)
    if tot <= 0:
        return {k: 0.0 for k in STAT_ABILITIES}, 0.0, 0.0, regime, 0.0
    ab = {k: sum(e.abilities[k] * ww for e, ww in zip(lines, w)) / tot for k in STAT_ABILITIES}
    combat = sum(e.combat * ww for e, ww in zip(lines, w)) / tot
    rnd_w = sum(e.rnd * ww / max(1e-9, min(1.0, e.rnd / RND_CAP)) for e, ww in zip(lines, w))
    recent = sum(ww for e, ww in zip(lines, w) if (cutoff - e.end).days <= P.form_days) / tot
    return ab, combat, rnd_w, regime, recent


# ------------------------------------------------------------------ the composition

def reference2(recs: list[Record], ref_cutoff: date, P: P2, callers: dict[str, IglLevel]) -> dict:
    """z→score tables fitted once on the reference window (unshrunk), then frozen"""
    env = EventEnv([r for r in recs if r.end and not r.date_estimated and r.end < ref_cutoff])
    lines = event_lines(recs, ref_cutoff, env)
    combats, abil = [], {k: [] for k in STAT_ABILITIES}
    for ls in lines.values():
        ab, c, rnd_w, _, _ = baseline(ls, ref_cutoff, replace(P, time_scheme="stage"))
        if rnd_w < 100:
            continue
        combats.append(c)
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
    # the caller level on the same 44–98 scale, over the callers with evidence
    zs = [L.z for L in callers.values() if L.events > 0]
    m["igl"] = fit(zs) if len(zs) >= 8 else (71.0, 13.0)
    return m


def rate2(recs: list[Record], cutoff: date, P: P2, mapping: dict, ledger: dict[str, list[Honour]],
          ids: dict[str, IglIdentity], callers: dict[str, IglLevel]) -> dict[str, Rated2]:
    env = EventEnv([r for r in recs if r.end and not r.date_estimated and r.end < cutoff])
    if P.time_scheme == "decay":
        # round one's pooled counts, through the same composition
        from .models import new_scheme
        base_rated, _ = new_scheme(recs, cutoff, Params(half_life=P.half_life, kappa_rounds=P.kappa_rounds,
                                                        kappa_fc=P.kappa_fc, kappa_cl=P.kappa_cl), mapping)
    lines = event_lines(recs, cutoff, env)
    a, b = mapping["overall"]
    who: dict[str, tuple[str, str]] = {}
    for r in recs:
        if r.end and not r.date_estimated and r.end < cutoff:
            prev = who.get(r.key)
            if prev is None or r.end >= prev[2]:
                who[r.key] = (r.ign, r.club, r.end)
    out = {}
    for key, ls in lines.items():
        if P.time_scheme == "decay":
            if key not in base_rated:
                continue
            R = base_rated[key]
            ab, combat_z, rnd_w, regime, recent = R.abilities, R.overall_z, R.rnd_w, "none", 0.0
            conf = R.confidence
        else:
            ab_raw, combat_raw, rnd_w, regime, recent = baseline(ls, cutoff, P)
            lam = rnd_w / (rnd_w + P.kappa_rounds)
            fc = sum((e.z.get("fc_succ") is not None) * e.rnd for e in ls)
            lam_fc = fc / (fc + P.kappa_fc * 5)
            cl = sum((e.z.get("cl_rate") is not None) * e.rnd for e in ls)
            lam_cl = cl / (cl + P.kappa_cl * 10)
            conf = {"aim": lam, "awareness": lam, "utility": lam, "teamwork": lam, "reaction": lam_fc, "clutch": lam_cl}
            ab = {k: clamp(ab_raw[k] * conf[k], -3, 3) for k in STAT_ABILITIES}
            combat_z = combat_raw * lam
        combat = clamp(a + b * combat_z, 30, 97)
        # form: the last form_days against the baseline, apart
        recent_lines = [e for e in ls if (cutoff - e.end).days <= P.form_days]
        form_z = (statistics.fmean(e.combat for e in recent_lines) - (combat_z if P.time_scheme != "decay" else combat_z)) if recent_lines else None
        # the caller
        ign, club_now = who[key][0], who[key][1]
        ign_l = ign.lower()
        idn = ids.get(ign_l)
        igl_score, note, w = None, "not-a-caller", 0.0
        if idn is not None and P.igl_weight > 0:
            if idn.since is None or idn.since <= cutoff:
                L = callers.get(ign_l)
                if L is not None and L.events > 0:
                    ia, ib = mapping["igl"]
                    igl_score = clamp(ia + ib * L.z, 30, 97)
                    w = P.igl_weight * L.reliability
                    note = f"caller({idn.source}) rel={L.reliability:.2f} events={L.events}"
                else:
                    note = "caller but no evidence at this cutoff"
            else:
                note = "caller today; tenure began after the cutoff"
        pts, used = 0.0, []
        hnote = "no ledger"
        if P.honour_cap > 0:
            hs = ledger.get(ign_l)
            if hs is None:
                hnote = "unknown"
            else:
                pts, used = honour_points(hs, cutoff, P.honour_cap, played_only=True)
                hnote = ",".join(f"{h.tier}{h.when.year}" for h in used) or "none"
        overall = clamp(round((1 - w) * combat + w * (igl_score if igl_score is not None else combat) + pts), 30, 99)
        out[key] = Rated2(key=key, ign=ign, club=club_now,
                          role=ls[-1].role, combat_z=combat_z, combat=combat, igl_score=igl_score, igl_weight=w, igl_note=note,
                          honours=pts, honours_note=hnote, overall=overall, form_z=form_z, recent_share=recent, regime=regime,
                          n_events=len(ls), rnd_w=rnd_w, confidence=conf, abilities=ab)
    return out
