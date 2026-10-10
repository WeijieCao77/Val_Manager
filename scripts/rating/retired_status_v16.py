#!/usr/bin/env python3
"""
Settle the "unclear" retired candidates from their own vlr pages.

    python3 -m scripts.rating.retired_status_v16

The owner's rule (2026-10-09): the unclear ones count as retired once checked
to have no matches. Retired = no club match in the 12 months before 2026-10-09
and no current club as a player. A national side or a show match is not a club.
Reads analysis/rating/history_v16/raw/player_<id>.html (fetched with
?timespan=all), writes status_verified.json with the evidence for each.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import fetch_vlr_people as vp  # noqa: E402

OUT = ROOT / "analysis" / "rating" / "history_v16"
CUTOFF = "2025-10-09"
NOT_A_CLUB = re.compile(r"national|nations|team (?:usa|brazil|korea|japan|china)|showmatch|show match|all-?star|twitch rivals|"
                        r"^(?:argentina|brazil|chile|china|japan|korea|south korea|turkey|united states|usa|canada|france|spain|"
                        r"germany|united kingdom|russia|philippines|indonesia|thailand|vietnam|singapore|malaysia|mexico|peru)$", re.I)


# matches that are not a club competing: show matches, streamer events, Riot's
# fan events, and national sides (a team named after a country)
# DCC Hi is a community cup: the owner ruled Laz/crow/takej retired on it (2026-10-10)
NOT_COMPETING = re.compile(r"showmatch|show match|twitch rivals|all-?star|throwback|dream team|riot one|\bdcc\b|"
                           r"\benc\b|nations cup|esports nations", re.I)
COUNTRY_TEAM = re.compile(r"^(argentina|brazil|chile|china|japan|korea|south korea|turkey|türkiye|united states|usa|canada|"
                          r"france|spain|germany|united kingdom|russia|philippines|indonesia|thailand|vietnam|singapore|"
                          r"malaysia|mexico|peru|hong kong|taiwan|australia|india|saudi arabia)$", re.I)


def recent(html: str) -> list[dict]:
    """the player page's Recent Results inside the 12-month window"""
    T = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).replace("&sdot;", "·").strip()  # noqa: E731
    out = []
    blk = html[html.find("Recent Results"):]
    for body, dt in re.findall(r'<a href="/\d+/[^"]*" class="wf-card fc-flex m-item">(.*?)<div class="m-item-date">\s*<div>\s*([\d/]+)', blk, re.S):
        dt = dt.replace("/", "-")
        if dt < CUTOFF:
            continue
        ev = re.search(r'm-item-event[^>]*>\s*<div[^>]*>(.*?)</div>(.*?)</div>', body, re.S)
        team = re.search(r'm-item-team-name">(.*?)</span>', body, re.S)
        event, stage = (T(ev.group(1)), T(ev.group(2))) if ev else ("", "")
        team = T(team.group(1)) if team else ""
        competing = not (NOT_COMPETING.search(event) or NOT_COMPETING.search(stage) or COUNTRY_TEAM.search(team))
        out.append({"date": dt, "event": event, "stage": stage, "team": team, "competing": competing})
    return out


# owner's calls on people the rule leaves open (2026-10-10: community cups and
# Riot's fan events only, so retired)
OWNER = {"Laz": "retired", "crow": "retired", "takej": "retired"}


def main() -> int:
    plan = json.loads((OUT / "retired_fetch_list.json").read_text())
    out = {}
    # the unclear ones of the 2023-25 list, and the early retirees the owner added
    # 2026-10-10 (2020-22 tier-one, played an international, never in a save)
    todo = [c for c in plan["classification"] if c["class"] == "unclear"]
    early = OUT / "early_retired_candidates.json"
    if early.exists():
        todo += [{"vlrId": e["vlrId"], "ign": e["ign"], "class": "unclear", "early": True}
                 for e in json.loads(early.read_text())["players"]]
    for c in todo:
        f = OUT / "raw" / f"player_{c['vlrId']}.html"
        if not f.exists():
            out[c["vlrId"]] = {"ign": c["ign"], "class": "unclear", "why": "player page not fetched"}
            continue
        p = vp.parse(f.read_text("utf-8", "ignore"))
        clubs = [t for t in p["current"] if not NOT_A_CLUB.search(t["name"] or "") and not (t.get("role") or "").lower().startswith(("coach", "head", "assistant", "analyst"))]
        games = recent(f.read_text("utf-8", "ignore"))
        real = [g for g in games if g["competing"]]
        cls = OWNER.get(c["ign"]) or ("still-playing" if clubs or real else "retired")
        why = []
        if clubs:
            why.append("current club: " + ", ".join(t["name"] for t in clubs))
        if real:
            g = real[0]
            why.append(f"competed {g['date']}: {g['event']} ({g['stage']}) for {g['team']}")
        elif games:
            why.append("only " + "; ".join(sorted({g["event"] for g in games})) + " in the last 12 months")
        else:
            why.append(f"no match since {p.get('lastMatch')}")
        out[c["vlrId"]] = {"ign": c["ign"], "class": cls, "early": bool(c.get("early")), "lastMatch": p.get("lastMatch"),
                           "img": p.get("img"), "real": p.get("real"), "nat": p.get("nat"),
                           "current": [t["name"] for t in p["current"]], "why": "; ".join(why), "recent": games,
                           "source": f"https://www.vlr.gg/player/{c['vlrId']}/?timespan=all"}
    # a man coaching now is not a retired-player card (owner, 2026-10-09)
    tenures = OUT / "coach_tenures.json"
    if tenures.exists():
        people = json.loads(tenures.read_text())["people"]
        coaching = {p["vlrId"] for p in people if p["status"] == "active" and p.get("vlrId")} | \
            {(p.get("handle") or p["name"]).lower() for p in people if p["status"] == "active"}
        for k, v in out.items():
            if v["class"] == "retired" and (k in coaching or v["ign"].lower() in coaching):
                v["class"] = "coach-now"
                v["why"] += " — coaching now (coach_tenures.json)"
    (OUT / "status_verified.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    from collections import Counter
    print(Counter(v["class"] for v in out.values()))
    for k, v in out.items():
        print(f'{v["ign"]:14} {v["class"]:13} {v["why"]}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
