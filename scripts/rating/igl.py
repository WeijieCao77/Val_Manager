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


@dataclass
class IglLevel:
    ign: str
    events: int
    tenure_years: float
    over_perf: float | None     # mean placement-vs-roster residual (z), + = club placed better than its men
    z: float                    # the level estimate in z
    reliability: float          # 0..1
    notes: list[str] = field(default_factory=list)


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


def levels(cutoff: date, ids: dict[str, IglIdentity] | None = None) -> dict[str, IglLevel]:
    """the level evidence at a cutoff, from events that ended before it"""
    ids = ids or identities()
    world = json.loads(WORLD.read_text("utf-8"))
    ign_of = {p["id"]: p["ign"] for p in world["players"]}
    recs = json.loads(RECORDS.read_text("utf-8"))["players"]
    evc = json.loads(EVENTS.read_text("utf-8"))
    events, stats = evc["events"], evc["stats"]
    # club placement per event, from any player's record of it. vlr names the
    # club in full on a placement ("LEVIATÁN") and by tag on a stats row
    # ("LEV"); the world's teams say which is which.
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
        per_event = []
        for eid, rows in stats.items():
            meta = events.get(eid)
            if not meta or not meta.get("end"):
                continue
            y, m, d = (int(x) for x in meta["end"].split("-"))
            end = date(y, m, d)
            if end >= cutoff or (idn.since and end < idn.since):
                continue
            mine = next((r for r in rows if (r.get("ign") or "").lower() == ign_l and (r.get("rnd") or 0) > 0), None)
            if not mine:
                continue
            club = mine.get("club") or ""
            if _key(club) != _key(idn.club):
                continue            # not the club he is the recorded caller of
            # roster strength: mean Rating z of the club's five inside the event
            vals = {r["ign"]: r["rating2"] for r in rows if r.get("rating2") is not None and (r.get("rnd") or 0) >= 60}
            if len(vals) < 10:
                continue
            mu, sd = mean_sd(list(vals.values()))
            team_z = statistics.fmean((r["rating2"] - mu) / sd for r in rows if r.get("club") == club and r.get("rating2") is not None and (r.get("rnd") or 0) >= 60)
            clubs = {r.get("club") for r in rows if r.get("club")}
            rank = placed.get((eid, tag_of.get(_key(club), _key(club))))
            if rank is None or len(clubs) < 4:
                continue
            place_z = -(rank - (len(clubs) + 1) / 2) / (len(clubs) / 4)    # 1st ≈ +2, last ≈ −2
            per_event.append(place_z - team_z)
        tenure = ((cutoff - idn.since).days / 365.25) if idn.since and idn.since < cutoff else 0.0
        n = len(per_event)
        over = statistics.fmean(per_event) if per_event else None
        # (b) credited at a third, shrunk by events (κ = 6); (a) a year of calling is worth +0.15 z, capped at 3 years
        lam = n / (n + 6.0)
        z = clamp((over or 0.0) / 3.0 * lam + min(tenure, 3.0) * 0.15, -1.5, 1.5)
        notes = []
        if idn.source != "verified":
            notes.append("identity:inferred")
        if idn.since is None:
            notes.append("since:unknown")
        else:
            notes.append("since:extrapolated-from-tenure")
        if n == 0:
            notes.append("no-events-as-caller")
        rel = clamp(0.5 * lam + 0.5 * min(tenure, 3.0) / 3.0, 0.0, 1.0) * (1.0 if idn.source == "verified" else 0.6)
        out[ign_l] = IglLevel(idn.ign, n, round(tenure, 2), over, z, rel, notes)
    return out


if __name__ == "__main__":
    ids = identities()
    print("callers:", len(ids), "verified:", sum(1 for i in ids.values() if i.source == "verified"),
          "with tenure start:", sum(1 for i in ids.values() if i.since))
    lv = levels(date.today(), ids)
    for n in ("boaster", "boo", "ethan", "nobody", "chronicle", "johnqt"):
        L = lv.get(n)
        print(n, L and (L.events, L.tenure_years, None if L.over_perf is None else round(L.over_perf, 2), round(L.z, 2), round(L.reliability, 2), L.notes))
