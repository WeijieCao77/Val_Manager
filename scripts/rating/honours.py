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

FINAL_STAGES = {"Playoffs", "Main Event", "Tournament", "Finals", "Playoffs Phase", "Knockouts", "Main Stage",
                "Bracket Stage", "Top 8", "Phase 2", "Grand Final", "Playoff"}
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


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def place_of(s: str) -> int | None:
    m = re.match(r"(\d+)", s or "")
    return int(m.group(1)) if m else None


def build_ledger() -> tuple[dict[str, list[Honour]], set[str]]:
    """ign.lower() -> honours (first places only); plus the igns with no placement list at all.

    Classification comes from the event cache's own `tier` (the same field the
    time weighting uses), never from a regex over the name — that regex read
    'champions-tour-2024-masters-shanghai' as a Champions win. An event the
    cache does not hold has no trusted tier and no date: it is kept with
    tier 'unknown' and when=None so the report can count it, and the strict
    back-test never scores it. Played is True only when the man is in the
    event's own stats rows with rounds; None (rows not held) is not True."""
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
            eid, place_s, team, stage = e[0], e[1], e[2], (e[3] if len(e) > 3 else "")
            # vlr lists one row per event, the last stage reached; a 1st in a
            # group or a qualifier is not a title
            if place_of(place_s) != 1 or eid in seen or stage not in FINAL_STAGES:
                continue
            seen.add(eid)               # one event is one entry, whichever stage row listed it
            meta = events.get(eid)
            if meta:
                tier = meta["tier"]
                if tier not in VALUE:
                    continue            # Challengers and the like are not honours here
                if meta.get("end"):
                    y, m, d = (int(x) for x in meta["end"].split("-"))
                    when, est = date(y, m, d), False
                else:
                    when, est = None, True
                rows = stats.get(eid)
                played = None if not rows else any(
                    (r.get("ign") or "").lower() == ign.lower() and (r.get("rnd") or 0) > 0 for r in rows)
                out.setdefault(ign.lower(), []).append(Honour(ign, eid, meta["slug"], tier, when, est, 1, team, played, VALUE[tier]))
            else:
                out.setdefault(ign.lower(), []).append(Honour(ign, eid, "", "unknown", None, True, 1, team, None, 0.0))
    # Liquipedia's title list: only for what vlr's placements do not already
    # hold, matched by the event's NAME, never by (year, kind) — two Masters in
    # one year are two titles. Year-only, so undated, so never in the strict test.
    cache_names = {norm(e["slug"]): eid for eid, e in events.items()}
    for ign_l, rec in lp.items():
        for t in rec.get("titles") or []:
            kind, name = t.get("kind"), t.get("event") or ""
            if kind not in VALUE:
                continue
            key = ign_l.lower()
            have = out.setdefault(key, [])
            n = norm(name)
            eid = next((cache_names[c] for c in cache_names if c and (c in n or n in c)), None)
            if eid and any(h.event_id == eid for h in have):
                continue
            if any(h.event_id == f"lp:{name}" for h in have):
                continue
            have.append(Honour(ign_l, eid or f"lp:{name}", name, kind, None, True, 1, "", None, VALUE[kind]))
            unknown.discard(key)
    return out, unknown


def honour_points(hs: list[Honour], cutoff: date, cap: float, strict: bool = True) -> tuple[float, list[Honour], list[Honour]]:
    """Capped, faded points at a cutoff.

    strict: only honours with a date before the cutoff AND the man in the
    rows with rounds — the back-test's rule. Loose (strict=False, for today's
    ledger view only): undated ones count at their year, played=None counts.
    Returns (points, the honours counted, the honours set aside)."""
    total, used, aside = 0.0, [], []
    for h in sorted(hs, key=lambda h: (h.when or date(1, 1, 1))):
        if h.tier not in VALUE:
            aside.append(h)
            continue
        if h.when is None:
            if strict:
                aside.append(h)
                continue
            year = None
            m = re.search(r"(20\d\d)", h.event)
            year = int(m.group(1)) if m else None
            if year is None or year >= cutoff.year:
                aside.append(h)
                continue
            seasons = cutoff.year - year
        else:
            if h.when >= cutoff:
                continue
            seasons = max(0, cutoff.year - h.when.year)
        if strict and h.played is not True:
            aside.append(h)
            continue
        f = FADE.get(seasons, 0.0)
        if f <= 0:
            continue
        total += h.value * f
        used.append(h)
    return min(cap, total), used, aside


if __name__ == "__main__":
    ledger, unknown = build_ledger()
    print("players with a win:", len(ledger), "unknown (no placement list):", len(unknown))
    n_unk = sum(1 for hs in ledger.values() for h in hs if h.tier == "unknown")
    n_und = sum(1 for hs in ledger.values() for h in hs if h.when is None and h.tier != "unknown")
    n_np = sum(1 for hs in ledger.values() for h in hs if h.when is not None and h.played is not True)
    print("entries: unknown tier (outside the cache)", n_unk, "| undated Liquipedia", n_und, "| dated but not seen playing", n_np)
    for n in ("chronicle", "chichoo", "boaster", "less", "ethan", "nobody"):
        hs = ledger.get(n, [])
        pts, used, aside = honour_points(hs, date.today(), 6.0)
        print(n, round(pts, 2), [(h.tier, h.when.isoformat()) for h in used], "| aside", len(aside))
