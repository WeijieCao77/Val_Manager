"""Fold 号角's rosters into the face sources, one club at a time.

号角 (web.haojiao.cc) is the one place that photographs the Chinese rosters —
the official VCT CN portraits, one consistent set, and it keeps them current
when a club refreshes its media day. vlr.gg and Liquipedia do not.

The site's API signs its requests, so nothing here fetches from it. The
rosters are read off the team pages in a browser — the page's own loaded
data, copied out as one line per player — into scripts/cache/haojiao_rosters.txt:

  club|ign|real name|icon path|is_sub|is_inactive|haojiao id

This script matches those lines against the players the game models and
writes the matches into scripts/cache/haojiao_faces.json, which
fetch_faces.py already reads. Identity is the same rule as every other face
source: the tag matches exactly (case-insensitively — the site capitalises
SLOWLY where vlr has slowly) AND the club agrees. A line whose club is not
the player's club in the game is reported, not used. The site's own
default_player.png is a placeholder, not a person, and is dropped.

  python3 scripts/build_haojiao_faces.py
  python3 scripts/build_haojiao_faces.py --print-cn    # igns to refresh
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROSTERS = ROOT / "scripts" / "cache" / "haojiao_rosters.txt"
FACES = ROOT / "scripts" / "cache" / "haojiao_faces.json"
NOTE = ROOT / "scripts" / "cache" / "hj_faces.json"
WORLD = ROOT / "src" / "data" / "world.json"
CDN = "https://files.haojiao.cc"

# 号角's short tag where it differs from the game's
TAG_ALIAS = {"NV": "ENVY", "VNLG": "VLG"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print-cn", action="store_true",
                    help="print the CN-region igns that now have a 号角 photo")
    args = ap.parse_args()

    world = json.loads(WORLD.read_text("utf-8"))
    teams = {t["id"]: t for t in world["teams"]}
    by_ign: dict[str, list[dict]] = {}
    for p in world["players"]:
        by_ign.setdefault(p["ign"].lower(), []).append(p)

    faces = json.loads(FACES.read_text("utf-8")) if FACES.exists() else {"players": {}}
    players: dict = faces.setdefault("players", {})

    matched = replaced = clubs_differ = placeholder = unknown = 0
    cn_igns: list[str] = []
    for line in ROSTERS.read_text("utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        club, ign, real, icon = parts[0], parts[1], parts[2], parts[3]
        club = TAG_ALIAS.get(club, club)
        if not icon or "default_player" in icon:
            placeholder += 1
            continue
        cands = by_ign.get(ign.lower()) or []
        if not cands:
            unknown += 1
            continue
        hit = None
        for p in cands:
            t = teams.get(p.get("teamId") or "")
            if t and t["tag"] == club:
                hit = p
                break
        if not hit:
            clubs_differ += 1
            where = ", ".join(teams[p["teamId"]]["tag"] if p.get("teamId") else "自由人" for p in cands)
            print(f"  club differs  {ign:<14} 号角 {club:<5} game {where}")
            continue
        url = icon if icon.startswith("http") else CDN + icon
        prev = players.get(hit["ign"])
        if prev and prev.get("url") != url:
            replaced += 1
        players[hit["ign"]] = {"url": url, "real": real or None, "team": club, "via": "haojiao"}
        matched += 1
        if teams[hit["teamId"]]["region"] == "China":
            cn_igns.append(hit["ign"])

    FACES.write_text(json.dumps(faces, ensure_ascii=False, indent=1), "utf-8")

    # The credit list build_dossier.py reads: which players' pictures are
    # 号角's. Every match above is fetched with --prefer-haojiao, so a match
    # is a 号角 picture on disk; the rejected list is kept as written.
    note = json.loads(NOTE.read_text("utf-8")) if NOTE.exists() else {}
    ids, igns = [], []
    for ign, rec in players.items():
        for p in by_ign.get(ign.lower()) or []:
            t = teams.get(p.get("teamId") or "")
            if t and t["tag"] == rec.get("team") and (ROOT / "public" / "faces" / f"{p['id']}.webp").exists():
                ids.append(p["id"]); igns.append(p["ign"])
    note.update({
        "note": "photos sourced from 号角 haojiao.cc (files.haojiao.cc); rosters read off "
                "web.haojiao.cc team pages, matched on exact tag and agreeing club",
        "fetched": time.strftime("%Y-%m-%d"),
        "players": sorted(set(ids), key=lambda x: int(x[1:])), "igns": igns,
    })
    NOTE.write_text(json.dumps(note, ensure_ascii=False, indent=1), "utf-8")
    print(f"{len(set(ids))} pictures credited to 号角 -> {NOTE.relative_to(ROOT)}")
    print(f"{matched} matched ({replaced} with a newer picture), {clubs_differ} club differs, "
          f"{placeholder} placeholders dropped, {unknown} not modelled -> {FACES.relative_to(ROOT)}")
    if args.print_cn:
        print(",".join(cn_igns))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
