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
OUT = ROOT / "src" / "data" / "coached.json"

STAFF = re.compile(r"\b(head coach|assistant coach|coach|analyst)\b", re.I)
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


def overlap(a_from: str, a_to: str | None, b_from: str, b_to: str | None) -> bool:
    return max(a_from, b_from) <= min(a_to or NOW, b_to or NOW)


def main() -> None:
    records = json.loads(RECORDS.read_text("utf-8"))
    world = json.loads(WORLD.read_text("utf-8"))
    careers = json.loads(CAREERS.read_text("utf-8"))
    ign = {p["id"]: p["ign"] for p in world["players"]}

    # club key -> [(playerId, from, to, club name)]
    tenure: dict[str, list[tuple[str, str, str | None, str]]] = defaultdict(list)
    for pid, rows in records["players"].items():
        for row in rows.get("th") or []:
            frm, to, club = row[0], row[1], (row[2] or "").strip()
            if not frm or not club or NOT_THE_CLUB.search(club):
                continue
            tenure[key(club)].append((pid, frm[:7], to[:7] if to else None, club))

    out: dict[str, list[list[str]]] = {}
    unmatched: Counter[str] = Counter()
    for coach, entry in sorted(careers.items()):
        seen: dict[str, str] = {}
        for s in entry.get("stints") or []:
            if not s.get("role") or not STAFF.search(s["role"]) or not s.get("from"):
                continue
            if not s.get("to") and not s.get("current"):
                continue
            if NOT_THE_CLUB.search(s.get("team") or ""):
                continue
            rows = tenure.get(key(s["team"]))
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
    for c in ("bail", "Autumn"):
        print(f"  {c}: " + ", ".join(f"{ign.get(p, p)}@{club}" for p, club in out.get(c, [])))
    print("  coaching clubs with no player tenure to match (top):", unmatched.most_common(15))


if __name__ == "__main__":
    main()
