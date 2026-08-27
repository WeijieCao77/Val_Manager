"""Fold the scraped profiles and team histories into one file the game imports.

Inputs (all already on disk, nothing is fetched here):
  scripts/cache/vlr_profiles.json       photo, flag, real name, winnings, placements
  scripts/cache/vlr_staff.json          the coaching staff, off each club's page
  scripts/cache/lp_faces.json           Liquipedia photos, for what vlr lacks
  scripts/cache/liquipedia_tenure.json  every club a player has been on, with dates
  src/data/world.json                   the players the game actually models

Outputs, deliberately two files:
  src/data/dossier.json   photo, flag, real name, winnings — every card needs
                          these, so they are imported into the main bundle
  src/data/records.json   club history and every event placement — 800KB that
                          only the dossier screen reads, so it is loaded on
                          demand instead of being paid for on first visit

Event names are deduplicated into their own table — 518 players share about
1600 tournaments between them, and spelling each one out per player tripled the
file for nothing.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILES = ROOT / "scripts" / "cache" / "vlr_profiles.json"
STAFF = ROOT / "scripts" / "cache" / "vlr_staff.json"
LP_FACES = ROOT / "scripts" / "cache" / "lp_faces.json"
TENURE = ROOT / "scripts" / "cache" / "liquipedia_tenure.json"
WORLD = ROOT / "src" / "data" / "world.json"
OUT = ROOT / "src" / "data" / "dossier.json"
RECORDS = ROOT / "src" / "data" / "records.json"
FACES = ROOT / "public" / "faces"


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def main() -> int:
    world = load(WORLD, {"players": [], "teams": []})
    profiles = load(PROFILES, {})
    staff = load(STAFF, {"people": {}})
    lp = load(LP_FACES, {"players": {}, "coaches": {}})
    tenure = load(TENURE, {})

    # liquipedia keys are page titles; match case-insensitively on the ign
    ten_lc = {k.lower(): v for k, v in tenure.items()}

    events: dict[str, list] = {}
    players: dict[str, dict] = {}
    records: dict[str, dict] = {}
    photos = nats = withev = withth = 0

    for p in world["players"]:
        pid, ign = p["id"], p["ign"]
        prof = profiles.get(ign.lower()) or {}
        rec: dict = {}

        # the file on disk is the truth: it may have come from vlr or, for the
        # ones vlr has no picture of, from Liquipedia
        face = FACES / f"{pid}.webp"
        if face.exists():
            rec["img"] = f"{pid}.webp"
            photos += 1
            if ign in lp["players"]:
                rec["src"] = "lp"
        nat = prof.get("nat") or p.get("nat")
        if nat:
            rec["nat"] = nat
            nats += 1
        real = prof.get("real") or p.get("realName")
        if real:
            rec["real"] = real
        if prof.get("winnings"):
            rec["win"] = prof["winnings"]
        if prof.get("vlrId"):
            rec["vlr"] = prof["vlrId"]

        deep: dict = {}
        ev = []
        for e in prof.get("events") or []:
            eid = str(e.get("id"))
            if eid not in events:
                events[eid] = [e.get("event") or e.get("slug"), e.get("year")]
            # vlr prints the prize money in front of the club on rows that paid
            # out, and the scraper takes the whole line: without this the
            # dossier reads "$18,000 Team Vitality" where a club name belongs
            club = re.sub(r"^\$[\d,]+\s*", "", (e.get("team") or "")).strip() or None
            ev.append([eid, e.get("place"), club, e.get("stage")])
        if ev:
            deep["ev"] = ev
            withev += 1
            # the trophy count is wanted on the list screen, which must not
            # pull the whole records file in to work it out
            rec["t"] = sum(1 for e in ev if e[1] == "1st")

        th = []
        for t in ten_lc.get(ign.lower()) or []:
            if not isinstance(t, dict) or not t.get("team"):
                continue
            th.append([t.get("from"), t.get("to"), t["team"]])
        if th:
            # newest first, the way a CV reads
            th.sort(key=lambda r: r[0] or "", reverse=True)
            deep["th"] = th
            withth += 1

        if rec:
            players[pid] = rec
        if deep:
            records[pid] = deep

    # ---- the coaching staff, who are cards too -------------------------
    names: set[str] = set()
    for t in world.get("teams", []):
        c = t.get("coach") or {}
        if c.get("name"):
            names.add(c["name"])
    for a in (world.get("meta", {}).get("analysts") or []):
        names.add(a["name"])

    coaches: dict[str, dict] = {}
    coach_photos = 0
    for name in sorted(names):
        rec: dict = {}
        slug = re.sub(r"[^a-z0-9]", "", name.lower()) or hashlib.sha1(
            name.encode("utf-8")).hexdigest()[:10]
        face = FACES / f"c-{slug}.webp"
        if face.exists():
            rec["img"] = f"c-{slug}.webp"
            coach_photos += 1
            if name in lp["coaches"]:
                rec["src"] = "lp"
        v = staff["people"].get(name.lower()) or {}
        if v.get("nat"):
            rec["nat"] = v["nat"]
        if v.get("real"):
            rec["real"] = v["real"]
        if v.get("vlrId"):
            rec["vlr"] = v["vlrId"]
        if rec:
            coaches[name] = rec

    OUT.write_text(json.dumps({
        "meta": {
            "sources": {
                "vlr.gg": "photographs, nationality, event placements, winnings",
                "liquipedia": "club history with dates, and the photographs vlr.gg has none of",
            },
            # Liquipedia's images are CC-BY-SA; the credits panel says so
            "lpPhotos": sum(1 for r in players.values() if r.get("src") == "lp")
            + sum(1 for r in coaches.values() if r.get("src") == "lp"),
            "players": len(players),
            "photos": photos,
            "coaches": len(coaches),
            "coachPhotos": coach_photos,
            "events": len(events),
        },
        "players": players,
        "coaches": coaches,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    RECORDS.write_text(json.dumps({
        "events": events,
        "players": records,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"dossier.json  {OUT.stat().st_size/1024:>5.0f}KB   （随主包加载：照片、国籍、真名、奖金、冠军数）")
    print(f"records.json  {RECORDS.stat().st_size/1024:>5.0f}KB   （按需加载：队伍履历与赛事记录）")
    print(f"  教练 {len(coaches)} 人，其中 {coach_photos} 有照片")
    print(f"  players {len(players)}/{len(world['players'])}"
          f" | photos {photos} | nationality {nats}"
          f" | placements {withev} | club history {withth}"
          f" | distinct events {len(events)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
