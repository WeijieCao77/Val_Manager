"""
Who calls, since when, and what the evidence says about how well.

Identity and level are kept apart. Identity: the world's `isIgl` with its
source (`verified` = the club's Liquipedia infobox or the owner's override,
`inferred` = build_world's guess from the roster). No site records WHEN a man
became a caller, so the identity is extrapolated backwards only over his
tenure at the club it was recorded for (records.json `th`), and flagged as
such; before that he is `unknown`, not `not an IGL`.

Level: not APR, not KAST, not the team-mates' average. Two things with a
source and a date — (a) how long he has been the recorded caller, and (b) how
the club placed at each event while he called, against what its roster's own
individual Ratings in that event would predict. (b) is a residual the whole
five, the coach and the roster changes all sit inside, so it is shrunk hard
and only a share of it is credited. Reliability is reported with the number.
"""
from __future__ import annotations

import json
import re
import statistics
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .common import clamp, mean_sd, percentile_map

ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "src" / "data" / "world.json"
RECORDS = ROOT / "src" / "data" / "records.json"
EVENTS = ROOT / "scripts" / "cache" / "vlr_event_stats.json"


@dataclass
class IglIdentity:
    ign: str
    club: str
    source: str            # verified / inferred
    since: date | None     # start of the tenure at that club; None = unknown
    extrapolated: bool = True

    def grade(self, cutoff: date) -> str:
        """How much the identity can be trusted AT a cutoff.
        A: recorded from a source (club infobox / owner) and at this club for a
           year or more before the cutoff — still extrapolated in time, but the
           man has been the caller of this club through at least one full season;
        B: recorded, tenure shorter than a year at the cutoff;
        C: inferred by build_world from the roster;
        none: tenure began after the cutoff, or unknown."""
        if self.since is None or self.since > cutoff:
            return "none"
        if self.source != "verified":
            return "C"
        return "A" if (cutoff - self.since).days >= 365 else "B"


@dataclass
class IglLevel:
    ign: str
    events: int
    tenure_years: float
    over_perf: float | None     # mean placement-vs-roster residual (z), + = club placed better than its men
    z: float                    # the level estimate in z, 0 = an ordinary professional caller
    reliability: float          # 0..1
    notes: list[str] = field(default_factory=list)
    range: float = 0.6          # ± z around the estimate
    recorded: int = 0           # events at the club that recorded him as caller
    assumed: int = 0            # events at other clubs, assumed caller


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def identities() -> dict[str, IglIdentity]:
    world = json.loads(WORLD.read_text("utf-8"))
    recs = json.loads(RECORDS.read_text("utf-8"))["players"]
    teams = {t["id"]: t for t in world["teams"]}
    out = {}
    for p in world["players"]:
        if not p.get("isIgl"):
            continue
        club = teams.get(p.get("teamId") or "", {})
        th = (recs.get(p["id"]) or {}).get("th") or []
        since = None
        ck = _key(club.get("name")), _key(club.get("tag"))
        for frm, to, name in th:
            if to is None and (_key(name) in ck or ck[1] and ck[1] in _key(name)):
                y, m, d = (int(x) for x in frm.split("-"))
                since = date(y, m, d)
                break
        out[p["ign"].lower()] = IglIdentity(p["ign"], club.get("tag", ""), p.get("iglSource", "inferred"), since)
    return out


def _placement_rank(place: str) -> int | None:
    m = re.match(r"(\d+)", place or "")
    return int(m.group(1)) if m else None


MANUAL = ROOT / "data-raw" / "igl_manual.json"


def levels(cutoff: date, ids: dict[str, IglIdentity] | None = None) -> dict[str, IglLevel]:
    """The level evidence at a cutoff, from events that ended before it.

    The evidence follows the man, not the club: every tier-one event he
    played counts, those at the club that recorded him as its caller at full
    weight, those at other clubs at half (he is assumed to have called there
    too — flagged). A transfer therefore keeps his history. No tenure term:
    time at a club is familiarity, which belongs in chemistry, not level.
    Level = shrunk placement residual around the prior 0 (an ordinary
    professional caller); its range narrows with evidence. A hand estimate in
    data-raw/igl_manual.json ({ign: {z, range, source}}) overrides the model."""
    ids = ids or identities()
    world = json.loads(WORLD.read_text("utf-8"))
    recs = json.loads(RECORDS.read_text("utf-8"))["players"]
    evc = json.loads(EVENTS.read_text("utf-8"))
    events, stats = evc["events"], evc["stats"]
    manual = json.loads(MANUAL.read_text("utf-8")) if MANUAL.exists() else {}
    tag_of = {}
    for t in world["teams"]:
        tag_of[_key(t.get("name"))] = _key(t.get("tag"))
        tag_of[_key(t.get("tag"))] = _key(t.get("tag"))
    placed: dict[tuple[str, str], int] = {}
    for pid, rec in recs.items():
        for e in rec.get("ev") or []:
            r = _placement_rank(e[1])
            if r:
                k = _key(e[2])
                placed[(e[0], tag_of.get(k, k))] = r
    out = {}
    for ign_l, idn in ids.items():
        rec_ev, other_ev = [], []
        for eid, rows in stats.items():
            meta = events.get(eid)
            if not meta or not meta.get("end") or meta.get("tier") in ("challengers",):
                continue
            y, m, d = (int(x) for x in meta["end"].split("-"))
            if date(y, m, d) >= cutoff:
                continue
            mine = next((r for r in rows if (r.get("ign") or "").lower() == ign_l and (r.get("rnd") or 0) > 0), None)
            if not mine:
                continue
            club = mine.get("club") or ""
            vals = {r["ign"]: r["rating2"] for r in rows if r.get("rating2") is not None and (r.get("rnd") or 0) >= 60}
            if len(vals) < 10:
                continue
            mu, sd = mean_sd(list(vals.values()))
            team = [(r["rating2"] - mu) / sd for r in rows if r.get("club") == club and r.get("rating2") is not None and (r.get("rnd") or 0) >= 60]
            if len(team) < 3:
                continue
            clubs = {r.get("club") for r in rows if r.get("club")}
            rank = placed.get((eid, tag_of.get(_key(club), _key(club))))
            if rank is None or len(clubs) < 4:
                continue
            place_z = -(rank - (len(clubs) + 1) / 2) / (len(clubs) / 4)
            resid = place_z - statistics.fmean(team)
            (rec_ev if _key(club) == _key(idn.club) else other_ev).append(resid)
        n_eff = len(rec_ev) + 0.5 * len(other_ev)
        over = ((sum(rec_ev) + 0.5 * sum(other_ev)) / n_eff) if n_eff > 0 else None
        lam = n_eff / (n_eff + 6.0)
        z = clamp((over or 0.0) / 3.0 * lam, -1.5, 1.5)
        rng = round(0.6 * (1 - lam), 2)          # ± z: wide with little evidence, narrow with much
        notes = [f"recorded-club events {len(rec_ev)}", f"other-club events {len(other_ev)} (assumed caller, half weight)"]
        if idn.source != "verified":
            notes.append("identity:inferred")
        if idn.since is None:
            notes.append("since:unknown")
        rel = clamp(lam, 0.0, 1.0) * (1.0 if idn.source == "verified" else 0.6)
        man = manual.get(idn.ign) or manual.get(ign_l)
        if man and isinstance(man.get("z"), (int, float)):
            z, rng = float(man["z"]), float(man.get("range", 0.3))
            notes.append(f"manual:{man.get('source', '?')}")
            rel = 1.0
        L = IglLevel(idn.ign, len(rec_ev) + len(other_ev), 0.0, over, z, rel, notes)
        L.range = rng
        L.recorded = len(rec_ev)
        L.assumed = len(other_ev)
        out[ign_l] = L
    return out


if __name__ == "__main__":
    ids = identities()
    print("callers:", len(ids), "verified:", sum(1 for i in ids.values() if i.source == "verified"),
          "with tenure start:", sum(1 for i in ids.values() if i.since))
    lv = levels(date.today(), ids)
    for n in ("boaster", "boo", "ethan", "nobody", "saadhak", "rossy", "johnqt"):
        L = lv.get(n)
        print(n, L and (L.recorded, L.assumed, None if L.over_perf is None else round(L.over_perf, 2), round(L.z, 2), "±", L.range, L.notes[:2]))
