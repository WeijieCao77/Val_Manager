"""
Three ways to rate a player from the same dated records, all as pure functions
of (records before a cutoff, parameters), so a back-test cannot leak the future.

  current_scheme  what build_world does today, rebuilt on the event records
                  (recency by build_world's curve, ratios averaged, percentiles
                  over the pool at the cutoff, 42% Rating in every attribute,
                  role weights, the 25% tier-two pull). No stage bonus, no
                  titles — the event table has neither, so this is an
                  approximation and is labelled as one in the report.
  simple_baseline time-weighted Rating alone. The bar a richer model must clear.
  new_scheme      the owner's four steps: counts with their own denominators,
                  environment z-scores by (role, tier group) with fallbacks, six
                  abilities each shrunk by its own evidence, dated role share,
                  function templates, one linear mapping fitted on the training
                  window and then held.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace
from datetime import date

from .common import (ATTR_WEIGHT, ROLE_COMM, ROLE_UTIL, ROLE_WEIGHT, ROLES, STAT_ABILITIES, TEMPLATES,
                     clamp, half_life_weight, mean_sd, percentile_map)
from .dataset import Record

# ------------------------------------------------------------------ aggregation


@dataclass
class Line:
    key: str
    ign: str
    club: str
    nat: str
    n_events: int = 0
    rnd_w: float = 0.0                  # recency-weighted rounds: the evidence behind rate stats
    rnd_raw: float = 0.0
    k: float = 0.0
    d: float = 0.0
    a: float = 0.0
    fk: float = 0.0
    fd: float = 0.0
    clw: float = 0.0
    clt: float = 0.0
    means: dict[str, tuple[float, float]] = field(default_factory=dict)   # metric -> (sum v*w, sum w)
    role_w: dict[str, float] = field(default_factory=dict)
    group_w: dict[str, float] = field(default_factory=dict)
    last: date | None = None

    def mean(self, m: str) -> float | None:
        s, w = self.means.get(m, (0.0, 0.0))
        return s / w if w > 0 else None

    # ratios from summed counts, each with its own denominator
    @property
    def kpr(self): return self.k / self.rnd_w if self.rnd_w else None
    @property
    def dpr(self): return self.d / self.rnd_w if self.rnd_w else None
    @property
    def apr(self): return self.a / self.rnd_w if self.rnd_w else None
    @property
    def kd(self): return self.k / self.d if self.d else None
    @property
    def fc_part(self): return (self.fk + self.fd) / self.rnd_w if self.rnd_w else None
    @property
    def fc_succ(self): return self.fk / (self.fk + self.fd) if (self.fk + self.fd) > 0 else None
    @property
    def fd_rate(self): return self.fd / self.rnd_w if self.rnd_w else None
    @property
    def cl_rate(self): return self.clw / self.clt if self.clt > 0 else None

    @property
    def role(self) -> str:
        return max(self.role_w, key=self.role_w.get) if self.role_w else "自由人"

    def role_share(self) -> dict[str, float]:
        t = sum(self.role_w.values())
        return {r: v / t for r, v in self.role_w.items()} if t > 0 else {}

    @property
    def group(self) -> str:
        return max(self.group_w, key=self.group_w.get) if self.group_w else "vct"

    def top_rounds(self) -> float:
        """rounds against tier-one opposition (vct + intl), recency-weighted"""
        return self.group_w.get("vct", 0.0) + self.group_w.get("intl", 0.0)


def build_world_recency(age_years: float) -> float:
    if age_years <= 1.0:
        return 1.0
    if age_years <= 1.5:
        return 1.0 - (age_years - 1.0) * 0.8
    if age_years <= 2.5:
        return 0.6 - (age_years - 1.5) * 0.4
    return 0.15


def aggregate(records: list[Record], cutoff: date, weight) -> dict[str, Line]:
    """Sum every record that ENDED before the cutoff, weighted by `weight(age_days)`."""
    lines: dict[str, Line] = {}
    for r in records:
        if not r.end or r.date_estimated or r.end >= cutoff:
            continue
        w = weight((cutoff - r.end).days)
        if w <= 0:
            continue
        L = lines.get(r.key)
        if L is None:
            L = lines[r.key] = Line(key=r.key, ign=r.ign, club=r.club, nat=r.nat)
        if L.last is None or r.end > L.last:
            L.last, L.club, L.ign = r.end, r.club, r.ign
        L.n_events += 1
        rw = r.rnd * w
        L.rnd_w += rw
        L.rnd_raw += r.rnd
        for f in ("k", "d", "a", "fk", "fd"):
            v = getattr(r, f)
            if v is not None:
                setattr(L, f, getattr(L, f) + v * w)
        if r.clt:
            L.clw += (r.clw or 0) * w
            L.clt += r.clt * w
        for m in ("rating2", "acs", "kast", "adr", "hs"):
            v = getattr(r, m)
            if v is not None:
                s, ww = L.means.get(m, (0.0, 0.0))
                L.means[m] = (s + v * rw, ww + rw)
        for role, share in r.role_share.items():
            L.role_w[role] = L.role_w.get(role, 0.0) + share * rw
        L.group_w[r.group] = L.group_w.get(r.group, 0.0) + rw
    return lines


# ------------------------------------------------------------------ environment z-scores

METRICS = ("adr", "kpr", "hs", "fc_succ", "kd", "kast", "dpr", "fd_rate", "apr", "cl_rate", "acs", "rating2")
MIN_GROUP = 12


def metric_value(L: Line, m: str):
    if m in ("adr", "kast", "hs", "acs", "rating2"):
        return L.mean(m)
    return getattr(L, m)


class Env:
    """mean/sd per metric by (role, group) with fallbacks to role, then everyone.
    Built on the training window only."""

    def __init__(self, lines: list[Line], min_rounds: float = 100.0, by_role: bool = True):
        self.tables: dict[tuple, dict[str, tuple[float, float]]] = {}
        pool = [L for L in lines if L.rnd_raw >= min_rounds]
        keyfs = (lambda L: (L.role, L.group), lambda L: (L.role,), lambda L: ()) if by_role else (lambda L: (),)
        for keyf in keyfs:
            buckets: dict[tuple, list[Line]] = {}
            for L in pool:
                buckets.setdefault(keyf(L), []).append(L)
            for k, Ls in buckets.items():
                t = self.tables.setdefault(k, {})
                for m in METRICS:
                    xs = [v for v in (metric_value(L, m) for L in Ls) if v is not None]
                    if len(xs) >= MIN_GROUP or k == ():
                        t[m] = mean_sd(xs) if xs else (0.0, 1.0)

    def z(self, L: Line, m: str) -> float | None:
        v = metric_value(L, m)
        if v is None:
            return None
        for k in ((L.role, L.group), (L.role,), ()):
            t = self.tables.get(k, {})
            if m in t:
                mu, sd = t[m]
                return (v - mu) / sd
        return None


# ------------------------------------------------------------------ the new scheme


@dataclass
class Params:
    half_life: float = 270.0        # days; the owner asked for 180/270/365 against 90
    kappa_rounds: float = 400.0     # evidence for rate stats: recency-weighted rounds
    kappa_fc: float = 40.0          # first contacts (FK+FD) behind reaction
    kappa_cl: float = 20.0          # clutch situations behind clutch
    tier2_discount: float = 0.0     # 0 / 0.10 / 0.25 on players without tier-one evidence
    tier1_sample: float = 600.0     # tier-one rounds after which no discount applies
    lo: float = 44.0                # game scale for an attribute
    hi: float = 98.0
    # diagnostic switches — each isolates one design choice for the report
    center_by_role: bool = True     # False: z against everyone, no (role, tier) tables
    rating_mix: float = 0.0         # blend this much of z(Rating) into the overall (0 = none)
    equal_templates: bool = False   # True: the six abilities weigh the same in every role
    no_shrink: bool = False         # True: no evidence-based shrinkage at all


@dataclass
class Rated:
    key: str
    ign: str
    club: str
    role: str
    role_share: dict[str, float]
    abilities: dict[str, float]         # z-space, after shrink
    confidence: dict[str, float]        # lambda per ability, 0..1
    position: dict[str, float]          # z-space per role template
    overall_z: float
    overall: float                      # game scale
    attrs: dict[str, float]             # game scale per ability (six)
    n_events: int
    rnd_w: float
    flags: list[str]


def _blend(parts: list[tuple[float | None, float]]) -> float | None:
    """weighted sum over the parts that exist, renormalised — a missing HS% does not zero the aim"""
    got = [(z, w) for z, w in parts if z is not None]
    if not got:
        return None
    tot = sum(w for _, w in got)
    return sum(z * w for z, w in got) / tot


def reference_mapping(records: list[Record], ref_cutoff: date, P: Params) -> dict:
    """The z -> score table, fitted once on the UNSHRUNK abilities of everyone
    rated in the reference window (the 2024 season for the back-test), then
    held for every later cutoff. Fitting it on shrunk values would stretch the
    shrinkage back out — that is what made the first run swing by 8 points a
    split — and refitting at every cutoff would let the scale drift."""
    ref = replace(P, no_shrink=True)
    _, m = new_scheme(records, ref_cutoff, ref, mapping=None)
    return m


def new_scheme(records: list[Record], cutoff: date, P: Params, mapping: dict | None = None
               ) -> tuple[dict[str, Rated], dict]:
    lines = aggregate(records, cutoff, lambda age: half_life_weight(age, P.half_life))
    env = Env(list(lines.values()), by_role=P.center_by_role)
    out: dict[str, Rated] = {}
    raw: list[tuple[Line, dict[str, float], dict[str, float], list[str]]] = []
    for L in lines.values():
        z = {m: env.z(L, m) for m in METRICS}
        lam_r = L.rnd_w / (L.rnd_w + P.kappa_rounds)
        lam_fc = (L.fk + L.fd) / ((L.fk + L.fd) + P.kappa_fc)
        lam_cl = L.clt / (L.clt + P.kappa_cl) if L.clt > 0 else 0.0
        ab = {
            "aim": _blend([(z["adr"], .5), (z["kpr"], .3), (z["hs"], .2)]),
            "reaction": _blend([(z["fc_succ"], .6), (z["kd"], .4)]),
            "awareness": _blend([(z["kast"], .4), (None if z["dpr"] is None else -z["dpr"], .35),
                                 (None if z["fd_rate"] is None else -z["fd_rate"], .25)]),
            "utility": z["apr"],
            "clutch": z["cl_rate"],
            "teamwork": _blend([(z["kast"], .5), (z["apr"], .5)]),
        }
        conf = {"aim": lam_r, "awareness": lam_r, "utility": lam_r, "teamwork": lam_r,
                "reaction": lam_fc, "clutch": lam_cl}
        flags = []
        for k in STAT_ABILITIES:
            if ab[k] is None:
                ab[k] = 0.0
                conf[k] = 0.0
                flags.append(f"{k}:no-data")
        if P.no_shrink:
            conf = {k: (1.0 if conf[k] > 0 else 0.0) for k in conf}
        shrunk = {k: clamp(ab[k] * conf[k], -3.0, 3.0) for k in STAT_ABILITIES}
        if P.rating_mix > 0:
            zr = z.get("rating2")
            shrunk["_rating"] = clamp((zr if zr is not None else 0.0) * lam_r, -3.0, 3.0)
        raw.append((L, shrunk, conf, flags))

    # position abilities and the overall in z-space
    zs: list[float] = []
    prelim = []
    for L, shrunk, conf, flags in raw:
        tpl = {r: ({k: 1 / 6 for k in STAT_ABILITIES} if P.equal_templates else TEMPLATES[r]) for r in ROLES}
        pos = {r: sum(tpl[r][k] * shrunk[k] for k in STAT_ABILITIES) for r in ROLES}
        share = L.role_share()
        if not share:
            share = {r: 0.25 for r in ROLES}
            flags.append("role:no-agent-evidence")
        oz = sum(share.get(r, 0.0) * pos[r] for r in ROLES)
        if P.rating_mix > 0:
            oz = (1 - P.rating_mix) * oz + P.rating_mix * shrunk["_rating"]
        # tier-two: a candidate discount, applied only without tier-one evidence
        if P.tier2_discount > 0 and L.top_rounds() < P.tier1_sample and L.group == "t2":
            oz = oz * (1 - P.tier2_discount) + P.tier2_discount * (-0.4)
            flags.append(f"tier2-discount:{P.tier2_discount}")
        prelim.append((L, shrunk, conf, pos, share, oz, flags))
        zs.append(oz)

    # one linear mapping z -> game scale per quantity (the overall and each
    # ability), fitted on THIS training window's pool — the percentile scale
    # the game uses today, regressed on z — and then held. Fitting on the
    # window is what makes a back-test honest; in production the reference
    # date is fixed and the table frozen in the repo.
    def fit(values: list[float]) -> tuple[float, float]:
        pct = percentile_map(values)
        target = [P.lo + (P.hi - P.lo) * pct[i] for i in range(len(values))]
        mz, msd = mean_sd(values)
        mt, tsd = mean_sd(target)
        return (mt - mz * (tsd / msd), tsd / msd)

    if mapping is None:
        # no reference given: fit here (only sensible for a reference window run)
        mapping = {"overall": fit(zs)}
        for k in STAT_ABILITIES:
            mapping[k] = fit([shrunk[k] for _, shrunk, *_ in prelim])
    a, b = mapping["overall"]
    for L, shrunk, conf, pos, share, oz, flags in prelim:
        attrs = {k: clamp(round(mapping[k][0] + mapping[k][1] * shrunk[k]), 20, 99) for k in STAT_ABILITIES}
        out[L.key] = Rated(key=L.key, ign=L.ign, club=L.club, role=L.role, role_share=share,
                           abilities=shrunk, confidence=conf, position=pos, overall_z=oz,
                           overall=clamp(round(a + b * oz), 30, 97), attrs=attrs,
                           n_events=L.n_events, rnd_w=L.rnd_w, flags=flags)
    return out, mapping


# ------------------------------------------------------------------ the current scheme, rebuilt


def current_scheme(records: list[Record], cutoff: date) -> dict[str, Rated]:
    lines = aggregate(records, cutoff, lambda age: build_world_recency(age / 365.25))
    Ls = [L for L in lines.values() if L.rnd_raw > 0]
    if not Ls:
        return {}

    # build_world averages ratios (KPR, APR, FKPR, FDPR …) rather than summing counts
    def val(L: Line, m: str):
        if m in ("acs", "adr", "kast", "hs", "rating2"):
            return L.mean(m)
        return {"kpr": L.kpr, "apr": L.apr, "fkpr": L.fk / L.rnd_w if L.rnd_w else None,
                "fdpr": L.fd_rate, "kd": L.kd, "clp": L.cl_rate}[m]

    P: dict[str, dict[str, float]] = {}
    for m in ("rating2", "acs", "adr", "hs", "fkpr", "kpr", "kast", "fdpr", "apr", "kd", "clp"):
        idx = [i for i, L in enumerate(Ls) if val(L, m) is not None]
        xs = [val(Ls[i], m) for i in idx]
        if m == "fdpr":
            xs = [-x for x in xs]
        pm = percentile_map(xs) if xs else {}
        P[m] = {Ls[i].key: pm[j] for j, i in enumerate(idx)}

    def scale(p: float, lo=44, hi=98) -> float:
        return clamp(round(lo + (hi - lo) * p), 20, 99)

    def axis(specific: float, q: float) -> float:
        return 0.58 * specific + 0.42 * q

    out: dict[str, Rated] = {}
    for L in Ls:
        g = lambda k: P[k].get(L.key, 0.5)  # noqa: E731
        q = g("rating2")
        role = L.role
        has_cl = L.key in P["clp"]
        a = {
            "aim": scale(axis(0.5 * g("acs") + 0.3 * g("adr") + 0.2 * g("hs"), q)),
            "reaction": scale(axis(0.55 * g("fkpr") + 0.3 * g("kpr") + 0.15 * g("acs"), q)),
            "awareness": scale(axis(0.5 * g("kast") + 0.35 * g("fdpr") + 0.15 * q, q)),
            "utility": scale(axis(0.55 * g("apr") + 0.45 * ROLE_UTIL.get(role, 0.55), q)),
            "clutch": scale(axis(0.5 * g("clp") + 0.3 * q + 0.2 * g("kd"), q)) if has_cl
            else scale(axis(0.6 * q + 0.4 * g("kd"), q)),
            "teamwork": scale(axis(0.5 * g("kast") + 0.5 * g("apr"), q)),
            "communication": scale(axis(0.55 * g("kast") + 0.45 * ROLE_COMM.get(role, 0.6), q)),
            "igl": scale(axis(0.4 * g("apr") + 0.3 * g("kast") + 0.3 * ROLE_COMM.get(role, 0.6), q), 35, 84),
        }
        flags = []
        if L.group == "t2" and L.top_rounds() < 600:
            a = {k: clamp(round(60 + (v - 60) * 0.75), 20, 99) for k, v in a.items()}
            flags.append("tier2-pull:0.25")
        w = ROLE_WEIGHT.get(role, ATTR_WEIGHT)
        ovr = sum(a[k] * w.get(k, ATTR_WEIGHT[k]) for k in ATTR_WEIGHT)
        out[L.key] = Rated(key=L.key, ign=L.ign, club=L.club, role=role, role_share=L.role_share(),
                           abilities={k: (a[k] - 71) / 13 for k in STAT_ABILITIES}, confidence={k: 1.0 for k in STAT_ABILITIES},
                           position={}, overall_z=(ovr - 71) / 13, overall=clamp(round(ovr), 30, 97),
                           attrs={k: a[k] for k in STAT_ABILITIES}, n_events=L.n_events, rnd_w=L.rnd_w, flags=flags)
    return out


# ------------------------------------------------------------------ the simple baseline


def simple_baseline(records: list[Record], cutoff: date, half_life: float) -> dict[str, Rated]:
    lines = aggregate(records, cutoff, lambda age: half_life_weight(age, half_life))
    Ls = [L for L in lines.values() if L.mean("rating2") is not None]
    xs = [L.mean("rating2") for L in Ls]
    mu, sd = mean_sd(xs)
    out = {}
    for L, x in zip(Ls, xs):
        lam = L.rnd_w / (L.rnd_w + 400.0)
        z = (x - mu) / sd * lam
        out[L.key] = Rated(key=L.key, ign=L.ign, club=L.club, role=L.role, role_share=L.role_share(),
                           abilities={}, confidence={}, position={}, overall_z=z,
                           overall=clamp(round(71 + 13 * z), 30, 97), attrs={}, n_events=L.n_events, rnd_w=L.rnd_w, flags=[])
    return out
