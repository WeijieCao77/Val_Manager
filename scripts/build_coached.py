"""
Which players each coach has actually coached.

    python3 scripts/build_coached.py

Writes src/data/coached.json:  { coachName: [[playerId, club], ...] }

「只有真的和那位教练同时期呆过的人才有默契值，而不是在同一个俱乐部过就有。」
So a pair counts only when the coach held a staff role at a club during months
the player was on that same club. Both sides are dated:

  - the coach's stints are off his vlr.gg page (fetch_vlr_coach_careers.py):
    role, club, "March 2024 – October 2025" / "joined in November 2025"
  - the player's are the tenure rows already in records.json (`th`:
    [from, to, club], from Liquipedia)

Counted roles are head coach, coach, assistant coach and analyst — the people
in the room. A manager is not, and a stint with no dates is not counted at all:
if the months cannot be shown to overlap, the pair is not claimed. Academies,
second rosters and youth sides are other clubs. The chemistry function is
synchronous and shared by client and server, so this is its own small table.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
WORLD = ROOT / "src" / "data" / "world.json"
CAREERS = ROOT / "scripts" / "cache" / "vlr_coach_careers.json"
# Liquipedia's team history for the same coaches, with the role in brackets and
# day-precise dates (scripts/fetch_liquipedia_tenure.py --coaches). Every
# spelling that had a page is kept as a candidate; the one whose history holds
# the club the game has him at is the man.
LP_COACHES = ROOT / "scripts" / "cache" / "liquipedia_coach_tenure.json"
# and, for the coaches neither site knows, what 号角 shows — entered by hand
HAND_COACHES = ROOT / "data-raw" / "haojiao_coaches.json"
OUT = ROOT / "src" / "data" / "coached.json"

STAFF = re.compile(r"\b(head coach|assistant coach|coach|analyst)\b|教练|分析师", re.I)
NOT_THE_CLUB = re.compile(r"academy|\bb$|spark|youth|ascend|rising|\bgc\b|female|women|\bred\b|\bblue\b", re.I)
SUFFIX = re.compile(r"\s+(esports|e-sports|gaming|club|team|esport)$", re.I)
# the same club under two names, one on each source — checked by hand
ALIASES = {
    "kiwoom drx": "drx",
    "riddle order": "riddle",
    "world sports invictus gaming": "invictus",
    "xi lai": "xlg",
}
NOW = dt.date.today().strftime("%Y-%m")


def key(name: str | None) -> str:
    s = (name or "").strip().lower().replace(".", "").replace("$", "s")
    prev = None
    while prev != s:
        prev, s = s, SUFFIX.sub("", s).strip()
    return ALIASES.get(s, s)


def month(d: str, unknown: str) -> str:
    """YYYY-MM from a Liquipedia date; a '??' month is the edge of the year it names."""
    m = d[:7]
    return m[:5] + unknown if "?" in m else m


def overlap(a_from: str, a_to: str | None, b_from: str, b_to: str | None) -> bool:
    return max(a_from, b_from) <= min(a_to or NOW, b_to or NOW)


def main() -> None:
    records = json.loads(RECORDS.read_text("utf-8"))
    world = json.loads(WORLD.read_text("utf-8"))
    careers = json.loads(CAREERS.read_text("utf-8"))
    ign = {p["id"]: p["ign"] for p in world["players"]}

    # a club by its tag, so "JDG" on one site meets "JD Gaming" on the other
    _by_tag = {key(t.get("tag")): key(t.get("name")) for t in world["teams"] if t.get("tag") and t.get("name")}

    def club_key(name: str | None) -> str:
        k = key(name)
        return _by_tag.get(k, k)

    # club key -> [(playerId, from, to, club name)]
    tenure: dict[str, list[tuple[str, str, str | None, str]]] = defaultdict(list)
    for pid, rows in records["players"].items():
        for row in rows.get("th") or []:
            frm, to, club = row[0], row[1], (row[2] or "").strip()
            if not frm or not club or NOT_THE_CLUB.search(club):
                continue
            tenure[club_key(club)].append((pid, frm[:7], to[:7] if to else None, club))

    # the club each coach is at now, for telling a Liquipedia page of the same
    # handle from a different person's
    club_of: dict[str, str] = {}
    for t in world["teams"]:
        n = ((t.get("coach") or {}).get("name") or "").strip()
        if n:
            club_of[n] = key(t.get("name")) if t.get("name") else ""
            club_of[n + "\x00tag"] = key(t.get("tag"))
    lp_all = json.loads(LP_COACHES.read_text("utf-8")) if LP_COACHES.exists() else {}
    hand = json.loads(HAND_COACHES.read_text("utf-8")) if HAND_COACHES.exists() else {}
    hand = hand.get("coaches") or {}

    weak: set[str] = set()

    def lp_stints(coach: str) -> list[dict]:
        """Liquipedia's staff stints for this coach, as [{from, to, team, role}] in months."""
        cands = lp_all.get(coach) or []
        mine = {club_of.get(coach, ""), club_of.get(coach + "\x00tag", "")} - {""}
        pick = None
        for c in cands:
            teams = {club_key(h.get("page") or h["team"]) for h in c["history"]}
            if teams & {club_key(m) for m in mine}:
                pick = c
                break
        # Liquipedia can be a move behind the game (heav1n is at VLG now and
        # his page still ends at EDG): the one page there is under his exact
        # handle, and it is a staff history, is him. Two pages, or a page of
        # playing stints only, stay unclaimed — that is where 'After' lives.
        if pick is None and len(cands) == 1 and cands[0]["title"].lower() == coach.lower() \
                and any(h.get("role") and STAFF.search(h["role"]) for h in cands[0]["history"]):
            pick = cands[0]
            weak.add(coach)
        if pick is None:
            return []
        return [{"from": month(h["from"], "01"), "to": month(h["to"], "12") if h.get("to") else None,
                 "current": not h.get("to"), "team": h.get("page") or h["team"], "role": h.get("role"), "via": "liquipedia"}
                for h in pick["history"] if h.get("role") and STAFF.search(h["role"]) and h.get("from")]

    def merged_stints(coach: str, entry: dict) -> list[dict]:
        """vlr's stints, with Liquipedia's dates and roles laid over them, and 号角's added."""
        lp = lp_stints(coach)
        out = list(lp)
        for s in entry.get("stints") or []:
            s = dict(s)
            # the same club on both sites, months overlapping: one record of one
            # spell. Neither site is complete — vlr has NaThanD at FPX from
            # 2022-06, Liquipedia from 2023-01 — so the spell is the union.
            same = [x for x in lp if club_key(x["team"]) == club_key(s.get("team")) and s.get("from")
                    and overlap(x["from"], x.get("to"), s["from"], s.get("to"))]
            if same:
                x = same[0]
                x["from"] = min(x["from"], s["from"])
                if x.get("current") or s.get("current") or not (x.get("to") and s.get("to")):
                    x["to"] = None
                    x["current"] = bool(x.get("current") or s.get("current"))
                else:
                    x["to"] = max(x["to"], s["to"])
                continue
            out.append(s)
        for h in hand.get(coach) or []:
            out.append({"from": h.get("from"), "to": h.get("to"), "current": not h.get("to") and bool(h.get("from")),
                        "team": h.get("team"), "role": h.get("role") or "coach", "via": "haojiao"})
        return out

    out: dict[str, list[list[str]]] = {}
    unmatched: Counter[str] = Counter()
    everyone = sorted(set(careers) | set(lp_all) | set(hand))
    for coach in everyone:
        if coach.startswith("_"):
            continue
        entry = careers.get(coach) or {}
        seen: dict[str, str] = {}
        stints = [dict(s) for s in merged_stints(coach, entry)]
        # vlr often knows when a coach joined a past club but not when he left
        # ("joined in June 2020" and nothing more): AfteR's four EDG years read
        # that way, and skipping the stint said he never coached ZmjjKK. A man
        # cannot be head coach of two clubs at once, so an open past stint ends
        # where his next club stint begins. National teams and the like run
        # alongside a club job and close nothing; a past stint with no later
        # club at all stays unknown and still does not count.
        clubs_from = sorted(x["from"] for x in stints
                            if x.get("from") and not NOT_THE_CLUB.search(x.get("team") or ""))
        for s in stints:
            if s.get("to") or s.get("current") or not s.get("from"):
                continue
            if NOT_THE_CLUB.search(s.get("team") or ""):
                continue
            later = [f for f in clubs_from if f > s["from"]]
            if later:
                s["to"] = later[0]
                s["inferred"] = True
        for s in stints:
            if not s.get("role") or not STAFF.search(s["role"]) or not s.get("from"):
                continue
            if not s.get("to") and not s.get("current"):
                continue
            if NOT_THE_CLUB.search(s.get("team") or ""):
                continue
            rows = tenure.get(club_key(s["team"]))
            if not rows:
                unmatched[s["team"]] += 1
                continue
            for pid, pf, pt, club in rows:
                # a coach who also has a player entry is not his own player
                if ign.get(pid, "").lower() == coach.lower():
                    continue
                if overlap(s["from"], s.get("to"), pf, pt):
                    seen.setdefault(pid, club)
        if seen:
            out[coach] = sorted([[pid, club] for pid, club in seen.items()])

    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    pairs = sum(len(v) for v in out.values())
    print(f"{len(out)} coaches with players they coached, {pairs} pairs → {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
    for c in ("bail", "Autumn", "AfteR", "potter"):
        print(f"  {c}: " + ", ".join(f"{ign.get(p, p)}@{club}" for p, club in out.get(c, [])))
    print("  Liquipedia page taken on the handle alone (no current club on it):", sorted(weak))
    heads = [((t.get("coach") or {}).get("name") or "").strip() for t in world["teams"]]
    print("  head coaches with nobody they coached:", [h for h in heads if h and h not in out])
    print("  coaching clubs with no player tenure to match (top):", unmatched.most_common(15))


if __name__ == "__main__":
    main()
