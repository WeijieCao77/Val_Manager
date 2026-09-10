"""
One record per player per event, with counts, dates and what he played there.

Rules (the owner's, 2026-09-10):
- an event is one record per player, whichever site it came from (only vlr here);
- ratios come from summed counts with their own denominators, never from
  averaging ratios;
- a record without a date cannot be used for any back-test cutoff.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .common import AGENT_ROLE, ROLES, TIER_GROUP, parse_date
import re as _re

# vlr's 2022 and 2023 season pages list everything under the VCT banner —
# national legs, sub-regional qualifiers, promotions — and the cache's
# tier_of reads all of it as 'league'. The 2022 format: each region's
# Challengers main event (NA, EMEA, BR, KR, JP playoffs, APAC playoffs, LATAM
# playoffs) was the top regional tier that fed Masters; the national and
# sub-regional legs below it were not. 2023 LOCK//IN was an international.
TIER_2022_23 = [
    (r"skyesports|conquerors|oceania|road-to-vct|promotion", "challengers"),
    (r"(philippines|vietnam|thailand|indonesia|malaysia-singapore|hong-kong-taiwan|cis|turkey|europe)-stage-\d-challengers", "challengers"),
    (r"latin-america-(north|south)-stage-\d-challengers", "challengers"),
    (r"japan-stage-\d-challengers-week", "challengers"),
    (r"lock-in", "masters"),
]


def tier_override(slug: str, year: int, tier: str) -> str:
    if year > 2023:
        return tier
    for pat, t in TIER_2022_23:
        if _re.search(pat, slug):
            return t
    return tier

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts" / "cache" / "vlr_event_stats.json"
WORLD = ROOT / "src" / "data" / "world.json"

# 2026 Challengers events carry no dates on vlr's season page; the stage in the
# slug says roughly when. Flagged as estimated and kept out of cutoff targets.
STAGE_GUESS = {"stage-1": ("03-01", "04-30"), "stage-2": ("05-01", "06-30"), "stage-3": ("07-01", "08-31"),
               "split-1": ("03-01", "04-30"), "split-2": ("05-01", "06-30"), "split-3": ("07-01", "08-31")}


@dataclass
class Record:
    eid: str
    slug: str
    year: int
    tier: str            # champions / masters / league / kickoff / challengers
    group: str           # intl / vct / t2
    start: date | None
    end: date | None
    date_estimated: bool
    vlr_id: str | None
    ign: str
    club: str
    nat: str
    maps: float
    rnd: float
    rating2: float | None
    acs: float | None
    kast: float | None
    adr: float | None
    hs: float | None
    k: float | None
    d: float | None
    a: float | None
    fk: float | None
    fd: float | None
    clw: int | None
    clt: int | None
    agents: list[tuple[str, float]] = field(default_factory=list)   # (slug, share 0-1)
    role_share: dict[str, float] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return self.vlr_id or self.ign.lower()


def _role_share(agents: list[tuple[str, float]]) -> dict[str, float]:
    out = {r: 0.0 for r in ROLES}
    tot = 0.0
    for slug, share in agents:
        role = AGENT_ROLE.get(slug)
        if role and share:
            out[role] += share
            tot += share
    return {r: v / tot for r, v in out.items() if v > 0} if tot > 0 else {}


def load_records() -> list[Record]:
    cache = json.loads(CACHE.read_text("utf-8"))
    events = cache["events"]
    out: list[Record] = []
    seen: set[tuple[str, str]] = set()
    for eid, rows in cache["stats"].items():
        ev = events.get(eid)
        if not ev:
            continue
        start, end = parse_date(ev.get("start")), parse_date(ev.get("end"))
        estimated = False
        if not start:
            for k, (a, b) in STAGE_GUESS.items():
                if k in ev["slug"]:
                    start, end = parse_date(f"{ev['year']}-{a}"), parse_date(f"{ev['year']}-{b}")
                    estimated = True
                    break
        tier = tier_override(ev["slug"], int(ev["year"]), ev["tier"])
        for r in rows:
            key = (eid, r.get("vlrId") or r.get("ign", "").lower())
            if key in seen or not r.get("rnd"):
                continue          # the same man twice on one event page is one record
            seen.add(key)
            agents = [(a, (p or 0) / 100.0) for a, p in (r.get("agents") or [])]
            out.append(Record(
                eid=eid, slug=ev["slug"], year=int(ev["year"]), tier=tier,
                group=TIER_GROUP.get(tier, "vct"), start=start, end=end, date_estimated=estimated,
                vlr_id=r.get("vlrId"), ign=r.get("ign", ""), club=r.get("club", ""), nat=r.get("nat", ""),
                maps=r.get("maps") or 0.0, rnd=float(r["rnd"]),
                rating2=r.get("rating2"), acs=r.get("acs"), kast=r.get("kast"), adr=r.get("adr"), hs=r.get("hs"),
                k=r.get("k"), d=r.get("d"), a=r.get("a"), fk=r.get("fk"), fd=r.get("fd"),
                clw=r.get("clw"), clt=r.get("clt"),
                agents=agents, role_share=_role_share(agents),
            ))
    return out


def world_players() -> dict[str, dict]:
    """ign.lower() -> {id, ign, role, roles, overall, attrs, tier} for today's comparison."""
    w = json.loads(WORLD.read_text("utf-8"))
    tier = {t["id"]: t.get("tier") for t in w["teams"]}
    return {p["ign"].lower(): {"id": p["id"], "ign": p["ign"], "role": p["role"], "roles": p.get("roles") or [p["role"]],
                               "overall": p["overall"], "attrs": p["attrs"], "tier": tier.get(p.get("teamId")),
                               "vlr": p.get("vlr")} for p in w["players"]}


def coverage_summary(records: list[Record]) -> dict:
    ev = {r.eid for r in records}
    dated = {r.eid for r in records if r.start and not r.date_estimated}
    players = {r.key for r in records}
    counts = sum(1 for r in records if r.fk is not None and r.fd is not None)
    cl = sum(1 for r in records if r.clt)
    years = sorted({r.year for r in records})
    return {"events": len(ev), "dated_events": len(dated), "records": len(records), "players": len(players),
            "records_with_fk_fd": counts, "records_with_clutch_attempts": cl, "years": years}


if __name__ == "__main__":
    rs = load_records()
    print(coverage_summary(rs))
    r = next(x for x in rs if x.role_share)
    print(r.ign, r.slug, r.start, r.rnd, r.agents, r.role_share)
