"""
Which league clubs each player has played for BEFORE the one he is at now.

    python3 scripts/build_past_clubs.py

Writes src/data/pastClubs.json: { playerId: [teamId, ...] }.

For the card mode's 默契: a coach's club's former players have played under
that club's staff, so they are worth something — less than the men there now
(「过去带过的选手应该也有默契值，但是没有现在队伍里的多」). The chemistry
function is synchronous and runs identically on the client and the server,
so it cannot wait on records.json (lazily fetched, 800 KB); this is the few
kilobytes of it that it needs, derived once.

Read off the tenure rows in records.json (`th`: [from, to, club]). A club's
academy, second team or youth side is a different club and is skipped.
Corporate suffixes (Esports, Gaming, …) are dropped before matching, and the
three orgs that are in the game under a new name are aliased by hand.

What this cannot say: a COACH's own former clubs. No source in the repo
records coaching careers — vlr_staff.json and liquipedia_coaches.json are
current staff only — so "bail once coached BLG" is not derivable here.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
WORLD = ROOT / "src" / "data" / "world.json"
OUT = ROOT / "src" / "data" / "pastClubs.json"

SUFFIX = re.compile(r"\s+(esports|e-sports|gaming|club|team)$", re.I)
# a second roster under the same banner is not the club
NOT_THE_CLUB = re.compile(r"academy|\bb$|spark|youth|ascend|rising", re.I)
# in the game under a newer name — checked against world.json, 2026-09-10
ALIASES = {"drx": "KRX", "riddle": "RO", "invictus": "WSIG"}


def norm(name: str | None) -> str:
    s = (name or "").strip().lower().replace(".", "").replace("$", "s")
    prev = None
    while prev != s:
        prev, s = s, SUFFIX.sub("", s).strip()
    return s


def main() -> None:
    records = json.loads(RECORDS.read_text("utf-8"))
    world = json.loads(WORLD.read_text("utf-8"))
    by_name: dict[str, str] = {}
    by_tag = {t["tag"]: t["id"] for t in world["teams"]}
    for t in world["teams"]:
        for n in (t["name"], t["tag"]):
            by_name.setdefault(norm(n), t["id"])
    for alias, tag in ALIASES.items():
        by_name[alias] = by_tag[tag]
    current = {p["id"]: p.get("teamId") for p in world["players"]}

    past: dict[str, set[str]] = defaultdict(set)
    for pid, rows in records["players"].items():
        for row in rows.get("th") or []:
            club = (row[2] or "").strip()
            if not club or NOT_THE_CLUB.search(club):
                continue
            tid = by_name.get(norm(club))
            if tid and tid != current.get(pid):
                past[pid].add(tid)

    out = {pid: sorted(clubs) for pid, clubs in sorted(past.items())}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    pairs = sum(len(v) for v in out.values())
    print(f"{len(out)} players with a former league club, {pairs} pairs → {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
