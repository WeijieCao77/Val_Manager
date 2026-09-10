"""
A ledger of honours: what a man actually won, when, at what level, and whether
he was on the server.

Sources, in this order: vlr's placements per player (src/data/records.json
`ev`, from the profile scrape — event id, place, team, stage), cross-checked
against the event stats pages we hold (was he in the rows, with rounds?), and
Liquipedia's title list (scripts/cache/lp_titles.json) for the champions and
masters wins it names. One event is one entry however many sites list it.

Value (the game's current table, kept so the comparison is like for like):
champions 3, masters 2, a regional split or Kickoff 1, Ascension 0.5 — for a
FIRST place only. Fades by seasons since: full for two, two thirds in the
third, a third in the fourth. Capped. Only honours dated before a cutoff count
at that cutoff. A player with no placement list at all is `unknown`, not
`none`.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECORDS = ROOT / "src" / "data" / "records.json"
WORLD = ROOT / "src" / "data" / "world.json"
EVENTS = ROOT / "scripts" / "cache" / "vlr_event_stats.json"
LP_TITLES = ROOT / "scripts" / "cache" / "lp_titles.json"

VALUE = {"champions": 3.0, "masters": 2.0, "league": 1.0, "kickoff": 1.0, "ascension": 0.5}
FADE = {0: 1.0, 1: 1.0, 2: 0.67, 3: 0.33}


@dataclass
class Honour:
    ign: str
    event_id: str
    event: str
    tier: str
    when: date
    date_estimated: bool
    place: int          # 1 = won
    team: str
    played: bool | None  # in the event's stats rows with rounds; None = no rows held for this event
    value: float


def tier_of(name: str, slug: str = "") -> str | None:
    s = f"{name} {slug}".lower()
    if "ascension" in s:
        return "ascension"
    if "champions" in s and "tour" not in s.split("champions")[0][-10:] and "kickoff" not in s and "stage" not in s and "league" not in s:
        return "champions"
    if "masters" in s or "lock//in" in s or "lock-in" in s:
        return "masters"
    if "kickoff" in s:
        return "kickoff"
    if re.search(r"\b(stage \d|league|stage-\d)\b", s) and ("champions tour" in s or "vct" in s):
        return "league"
    return None


def place_of(s: str) -> int | None:
    m = re.match(r"(\d+)", s or "")
    return int(m.group(1)) if m else None


def build_ledger() -> tuple[dict[str, list[Honour]], set[str]]:
    """ign.lower() -> honours (wins only); plus the set of igns with no placement list (unknown)."""
    world = json.loads(WORLD.read_text("utf-8"))
    ign_of = {p["id"]: p["ign"] for p in world["players"]}
    recs = json.loads(RECORDS.read_text("utf-8"))["players"]
    evc = json.loads(EVENTS.read_text("utf-8"))
    events, stats = evc["events"], evc["stats"]
    lp = json.loads(LP_TITLES.read_text("utf-8")) if LP_TITLES.exists() else {}
    out: dict[str, list[Honour]] = {}
    unknown: set[str] = set()
    for pid, rec in recs.items():
        ign = ign_of.get(pid)
        if not ign:
            continue
        evs = rec.get("ev") or []
        if not evs:
            unknown.add(ign.lower())
            continue
        seen: set[str] = set()
        for e in evs:
            eid, place_s, team = e[0], e[1], e[2]
            place = place_of(place_s)
            if place != 1 or eid in seen:
                continue
            seen.add(eid)
            meta = events.get(eid)
            name = meta["slug"] if meta else ""
            tier = tier_of(name, name) if meta else None
            if tier is None:
                continue          # a national cup or a show match is not an honour here
            if meta and meta.get("end"):
                y, m, d = (int(x) for x in meta["end"].split("-"))
                when, est = date(y, m, d), False
            else:
                when, est = date(int(meta["year"]), 9, 1), True
            rows = stats.get(eid)
            played = None
            if rows:
                played = any((r.get("ign") or "").lower() == ign.lower() and (r.get("rnd") or 0) > 0 for r in rows)
            out.setdefault(ign.lower(), []).append(Honour(ign, eid, name, tier, when, est, 1, team, played, VALUE[tier]))
    # Liquipedia titles fill in what vlr's placement list lacks (older champions/masters)
    for ign_l, rec in lp.items():
        for t in rec.get("titles") or []:
            kind = t.get("kind")
            if kind not in VALUE:
                continue
            key = ign_l.lower()
            have = out.setdefault(key, [])
            if any(h.tier == kind and h.when.year == t.get("year") for h in have):
                continue
            have.append(Honour(ign_l, f"lp:{t.get('event')}", t.get("event") or kind, kind,
                               date(int(t["year"]), 9, 1), True, 1, "", None, VALUE[kind]))
            unknown.discard(key)
    return out, unknown


def honour_points(hs: list[Honour], cutoff: date, cap: float, played_only: bool = False) -> tuple[float, list[Honour]]:
    """capped, faded points at a cutoff — only honours already won by then"""
    total = 0.0
    used = []
    for h in sorted(hs, key=lambda h: h.when):
        if h.when >= cutoff:
            continue
        if played_only and h.played is False:
            continue
        seasons = max(0, cutoff.year - h.when.year)
        f = FADE.get(seasons, 0.0)
        if f <= 0:
            continue
        total += h.value * f
        used.append(h)
    return min(cap, total), used


if __name__ == "__main__":
    ledger, unknown = build_ledger()
    print("players with a win:", len(ledger), "unknown (no placement list):", len(unknown))
    for n in ("chronicle", "chichoo", "aspas", "boaster", "less", "ethan"):
        hs = ledger.get(n, [])
        pts, used = honour_points(hs, date.today(), 6.0)
        print(n, round(pts, 2), [(h.tier, h.when.isoformat(), h.played) for h in used])
