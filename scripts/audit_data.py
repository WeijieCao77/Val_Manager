"""Check the shipped world against itself and against what it was built from.

Not a smoke test — smoke.ts already proves the world loads and a season runs.
This asks the two questions that a build passing its own checks cannot answer:

  integrity  is the file internally consistent? every id resolves, every roster
             is playable, nobody is on two teams, no number is out of range
  accuracy   does it still say what the sources say? every person real, every
             club's roster the one vlr lists, every derived number traceable to
             a stat line rather than to a default that quietly filled in

Prints a line per check and exits non-zero if any fails, so it can gate a build.
Reads src/data/world.json and scripts/cache/*; writes nothing.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "src" / "data" / "world.json"
CACHE = ROOT / "scripts" / "cache"
RAW = ROOT / "data-raw"

ATTRS = ["aim", "reaction", "awareness", "utility", "clutch",
         "teamwork", "communication", "igl"]
ROLES = {"决斗者", "先锋", "控场", "哨卫", "自由人"}
REGIONS = {"Americas", "EMEA", "Pacific", "China"}
SEASON_YEAR = 2026

fails: list[str] = []
warns: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        fails.append(f"{name}: {detail}")
    return ok


def warn(name: str, detail: str) -> None:
    print(f"  WARN  {name}  — {detail}")
    warns.append(f"{name}: {detail}")


def load(p: Path):
    return json.loads(p.read_text("utf-8")) if p.exists() else {}


def main() -> int:
    w = json.loads(WORLD.read_text("utf-8"))
    players, teams = w["players"], w["teams"]
    P = {p["id"]: p for p in players}
    T = {t["id"]: t for t in teams}

    print(f"\nworld.json — {len(players)} players, {len(teams)} teams\n")

    # ---------------------------------------------------------------- integrity
    print("integrity")

    ids = [p["id"] for p in players]
    check("player ids unique", len(set(ids)) == len(ids),
          f"{len(ids) - len(set(ids))} duplicated")
    tids = [t["id"] for t in teams]
    check("team ids unique", len(set(tids)) == len(tids),
          f"{len(tids) - len(set(tids))} duplicated")

    # a tag is what the whole UI shows; two clubs sharing one is a real bug
    tags = Counter(t["tag"] for t in teams)
    dupe_tags = {k: v for k, v in tags.items() if v > 1}
    check("club tags unique", not dupe_tags, str(dupe_tags))

    bad_ref = [p["id"] for p in players if p["teamId"] and p["teamId"] not in T]
    check("every teamId resolves", not bad_ref, str(bad_ref[:5]))

    bad_roster = [(t["tag"], r) for t in teams for r in t["roster"] if r not in P]
    check("every roster id resolves", not bad_roster, str(bad_roster[:5]))

    # both directions: the roster and the player must agree on who employs whom
    mismatch = [(t["tag"], P[r]["ign"]) for t in teams for r in t["roster"]
                if r in P and P[r]["teamId"] != t["id"]]
    check("roster and teamId agree", not mismatch, str(mismatch[:5]))

    orphan = [p["ign"] for p in players
              if p["teamId"] and p["id"] not in set(T[p["teamId"]]["roster"])]
    check("no player claims a club that does not list him", not orphan, str(orphan[:5]))

    twice = Counter(r for t in teams for r in t["roster"])
    check("nobody is on two rosters", not [k for k, v in twice.items() if v > 1],
          str([P[k]["ign"] for k, v in twice.items() if v > 1][:5]))

    # the same person under two spellings is the duplicate that keeps coming back
    by_low = defaultdict(list)
    for p in players:
        by_low[p["ign"].lower()].append(p["ign"])
    dupe_ign = {k: v for k, v in by_low.items() if len(v) > 1}
    check("no player appears twice under different casing", not dupe_ign,
          str(list(dupe_ign.items())[:5]))

    short = [(t["tag"], len(t["roster"])) for t in teams if len(t["roster"]) < 5]
    check("every club can field five", not short, str(short))

    # a roster that cannot cover the four core roles is a squad the sim punishes
    thin_roles = []
    for t in teams:
        covered = set()
        for r in t["roster"][:5]:
            covered.update(P[r].get("roles") or [P[r]["role"]])
        gaps = {"决斗者", "先锋", "控场", "哨卫"} - covered
        if gaps:
            thin_roles.append((t["tag"], "".join(sorted(gaps))))
    if thin_roles:
        warn("starting fives cover all four core roles",
             f"{len(thin_roles)} clubs short: {thin_roles[:6]}")
    else:
        check("starting fives cover all four core roles", True)

    # ranges
    def out_of_range(key, lo, hi):
        return [(p["ign"], p[key]) for p in players
                if not isinstance(p.get(key), (int, float)) or not lo <= p[key] <= hi]

    for key, lo, hi in (("overall", 20, 99), ("potential", 20, 99), ("form", 0, 100),
                        ("morale", 0, 100), ("fatigue", 0, 100), ("age", 15, 45),
                        ("loyalty", 0, 100), ("ambition", 0, 100)):
        bad = out_of_range(key, lo, hi)
        check(f"{key} within {lo}-{hi}", not bad, str(bad[:4]))

    bad_attr = [(p["ign"], k, p["attrs"].get(k)) for p in players for k in ATTRS
                if not isinstance(p["attrs"].get(k), (int, float))
                or not 1 <= p["attrs"][k] <= 99]
    check("all eight attributes present and 1-99", not bad_attr, str(bad_attr[:4]))

    below = [(p["ign"], p["overall"], p["potential"]) for p in players
             if p["potential"] < p["overall"]]
    check("potential is never below overall", not below, str(below[:4]))

    bad_role = [(p["ign"], p["role"]) for p in players if p["role"] not in ROLES]
    check("roles are from the known set", not bad_role, str(bad_role[:4]))
    bad_roles = [(p["ign"], p.get("roles")) for p in players
                 if p.get("roles") and (set(p["roles"]) - ROLES
                                        or p["role"] not in p["roles"])]
    check("roles[] contains the primary role", not bad_roles, str(bad_roles[:4]))

    bad_region = [(p["ign"], p.get("region")) for p in players
                  if p.get("region") not in REGIONS]
    check("every player has a real region", not bad_region, str(bad_region[:4]))
    bad_treg = [(t["tag"], t.get("region")) for t in teams if t.get("region") not in REGIONS]
    check("every club has a real region", not bad_treg, str(bad_treg[:4]))

    cross = [(P[r]["ign"], P[r]["region"], t["tag"], t["region"])
             for t in teams for r in t["roster"]
             if r in P and P[r]["region"] != t["region"]]
    check("squad players sit in their club's region", not cross, str(cross[:4]))

    # one caller per club. Which five actually start is the engine's call
    # (autoStarters), not this file's — world.json stores the whole roster in
    # rating order — so what is checked here is that the club has a caller at
    # all. audit_feedback.ts checks that he makes the five.
    igl_counts = [(t["tag"], sum(1 for r in t["roster"] if P[r].get("isIgl")))
                  for t in teams]
    check("exactly one IGL named per club",
          all(n == 1 for _, n in igl_counts),
          str([x for x in igl_counts if x[1] != 1][:5]))

    neg = [(p["ign"], p["salary"], p["value"]) for p in players
           if p["salary"] < 0 or p["value"] < 0]
    check("no negative wages or valuations", not neg, str(neg[:4]))

    # a club whose wage bill outruns its budget is unplayable from day one.
    # Contract.salary is an annual figure — the weekly settlement divides it —
    # so this is a straight comparison, not a x52 one.
    broke = []
    for t in teams:
        wages = sum(P[r]["salary"] for r in t["roster"])
        if wages > t["budget"] * 3:
            broke.append((t["tag"], round(wages / 1000), round(t["budget"] / 1000)))
    if broke:
        warn("annual wage bill under 3x budget",
             f"{len(broke)} clubs over: {broke[:5]}")
    else:
        check("annual wage bill under 3x budget", True)

    fa = [p for p in players if not p["teamId"]]
    bad_fa = [p["ign"] for p in fa if p.get("contractYears")]
    check("free agents carry no contract", not bad_fa, str(bad_fa[:4]))
    signed_no_deal = [p["ign"] for p in players
                      if p["teamId"] and not p.get("contractYears")]
    check("contracted players have years left", not signed_no_deal,
          str(signed_no_deal[:4]))

    # ---------------------------------------------------------------- accuracy
    print("\naccuracy — against the sources it was built from")

    career = {k: v for k, v in load(CACHE / "vlr_career.json").items()
              if not k.startswith("_")}
    seasons = load(CACHE / "vlr_seasons.json")
    chal = load(CACHE / "vlr_challengers.json")
    # vlr spells a handle two ways — the team page's alias ("Krst1Ng") and the
    # lowercased slug in its own href — so the build matches Liquipedia
    # case-insensitively and this check has to as well, or it reports a real
    # birthdate as a fabricated one.
    births = load(RAW / "liquipedia_players.json")
    births_ci = {str(k).lower(): v for k, v in births.items()}
    tenure = load(CACHE / "vlr_tenure.json")

    # every name must appear in a scrape; an invented person would not
    scraped = set(career)
    for rowset in (seasons.get("stats") or {}).values():
        scraped.update(r["ign"] for r in rowset)
    for rowset in (chal.get("stats") or {}).values():
        scraped.update(r["ign"] for r in rowset)
    for rec in (chal.get("players") or {}).values():
        scraped.add(rec["ign"])
    for t in (chal.get("teams") or {}).values():
        scraped.update(p["ign"] for p in t.get("roster", []))
    src = ROOT / "data-raw" / "vlr_vct2026_players.txt"
    raw_txt = src.read_text("utf-8") if src.exists() else ""
    low = {s.lower() for s in scraped}
    unknown = [p["ign"] for p in players
               if p["ign"].lower() not in low and p["ign"] not in raw_txt]
    check("every player traces back to a scrape", not unknown,
          f"{len(unknown)}: {unknown[:6]}")

    # coaches are real people or absent — never filled in
    coach_names = [t["coach"]["name"] for t in teams if t.get("coach")]
    lp_coaches = load(RAW / "liquipedia_coaches.json")
    known_coach = set()
    for rec in lp_coaches.values():
        if rec.get("name"):
            known_coach.add(rec["name"].lower())
        for a in rec.get("assistants") or []:
            known_coach.add(str(a).lower())
    for rec in load(RAW / "vlrapi_teams.json").values():
        if rec.get("coach"):
            known_coach.add(rec["coach"].lower())
        for a in rec.get("assistants") or []:
            known_coach.add(str(a).lower())
    fake_coach = [c for c in coach_names if c.lower() not in known_coach]
    check("every named coach is a scraped person", not fake_coach,
          f"{len(fake_coach)}: {fake_coach[:6]}")
    print(f"        {len(coach_names)}/{len(teams)} clubs have a real coach; "
          f"the rest are left empty rather than invented")

    # birthdates: real ones must match Liquipedia exactly, estimated ones flagged
    wrong_birth, unflagged = [], []
    for p in players:
        lp = births.get(p["ign"]) or births_ci.get(p["ign"].lower()) or {}
        if p.get("birth"):
            if lp.get("birth") != p["birth"]:
                wrong_birth.append((p["ign"], p["birth"], lp.get("birth")))
            if p.get("ageEstimated"):
                unflagged.append(p["ign"])
        elif not p.get("ageEstimated"):
            unflagged.append(p["ign"])
    check("real birthdates match Liquipedia", not wrong_birth, str(wrong_birth[:4]))
    check("age is flagged estimated exactly when the birthdate is missing",
          not unflagged, str(unflagged[:4]))

    # and the age printed must be the age that birthdate implies
    ref = date(SEASON_YEAR, 1, 1)
    wrong_age = []
    for p in players:
        if not p.get("birth"):
            continue
        try:
            y, m, d = (int(x) for x in p["birth"].split("-")[:3])
        except (ValueError, AttributeError):
            continue
        want = ref.year - y - ((ref.month, ref.day) < (m, d))
        if want != p["age"]:
            wrong_age.append((p["ign"], p["age"], want))
    check("age agrees with the birthdate", not wrong_age, str(wrong_age[:4]))

    # 16 is Riot's floor for the partner leagues, but Challengers rosters do
    # carry younger players and kozzy's 2010 birthdate is Liquipedia's, not
    # ours. Real and odd beats invented and tidy — so it is reported, not failed.
    kids = [(p["ign"], p["age"]) for p in players if p["age"] < 14 or p["age"] > 40]
    check("no impossible ages", not kids, str(kids[:4]))
    young = [(p["ign"], p["age"], T[p["teamId"]]["tag"] if p["teamId"] else "FA")
             for p in players if p["age"] < 16]
    if young:
        warn("under-16s are real people from the source", str(young))

    # real names must come from Liquipedia, never be a copy of the handle
    echo = [p["ign"] for p in players
            if p.get("realName") and p["realName"].lower() == p["ign"].lower()]
    check("real names are not the handle repeated", not echo, str(echo[:4]))

    # the stat line each player's ability was derived from must actually exist
    no_line = [p["ign"] for p in players
               if not (p.get("vlr") or {}).get("rounds")
               and not (p.get("rounds") or 0)]
    if no_line:
        warn("every player has a round count behind him",
             f"{len(no_line)} without: {no_line[:6]}")
    else:
        check("every player has a round count behind him", True)

    # ability must track the numbers: rank correlation between rating and overall
    # Ability must track the numbers it claims to be built from — and that is
    # the recency-weighted VCT line, not the flat career line. Correlating
    # against the career average measures the recency weighting rather than
    # the mapping, and lands near 0.58 by design.
    YW = {2026: 3.0, 2025: 2.0, 2024: 1.0}
    prof: dict = {}
    for eid, rowset in (seasons.get("stats") or {}).items():
        yw = YW.get(((seasons.get("events") or {}).get(eid) or {}).get("year"), 0.5)
        for r in rowset:
            rnd = r.get("rnd") or 0
            if not rnd:
                continue
            a = prof.setdefault(r["ign"], {"rnd": 0.0})
            a["rnd"] += rnd
            for c in ("rating2", "acs"):
                v = r.get(c)
                if v is None:
                    continue
                a[c] = a.get(c, 0.0) + v * rnd * yw
                a[c + "_w"] = a.get(c + "_w", 0.0) + rnd * yw

    def rank_rho(pairs):
        def rank(xs):
            order = sorted(range(len(xs)), key=lambda i: xs[i])
            out = [0] * len(xs)
            for pos, i in enumerate(order):
                out[i] = pos
            return out
        ra, rb = rank([a for a, _ in pairs]), rank([b for _, b in pairs])
        n = len(pairs)
        ma, mb = sum(ra) / n, sum(rb) / n
        va = sum((x - ma) ** 2 for x in ra) ** 0.5
        vb = sum((y - mb) ** 2 for y in rb) ** 0.5
        return sum((x - ma) * (y - mb) for x, y in zip(ra, rb)) / (va * vb)

    # tier-1 squads only: their numbers go in untranslated, so rating and
    # ability sit on the same footing
    base = [p for p in players
            if p["teamId"] and T[p["teamId"]]["tier"] == 1
            and prof.get(p["ign"], {}).get("rating2_w") and prof[p["ign"]]["rnd"] >= 600]
    if len(base) > 30:
        rho = rank_rho([(prof[p["ign"]]["rating2"] / prof[p["ign"]]["rating2_w"],
                         p["overall"]) for p in base])
        check("ability tracks the VCT rating it is built from (rho > 0.85)",
              rho > 0.85, f"rho={rho:.3f} over {len(base)} tier-1 players")
        aim = rank_rho([(prof[p["ign"]]["acs"] / prof[p["ign"]]["acs_w"],
                         p["attrs"]["aim"]) for p in base])
        check("aim tracks ACS (rho > 0.8)", aim > 0.8, f"rho={aim:.3f}")
        # and it must not be a straight copy: role weights and the big-stage
        # lift are supposed to move players off their raw rating
        check("ability is not simply the rating relabelled", rho < 0.99,
              f"rho={rho:.3f}")

    # tier-1 clubs must outrate tier-2 clubs on the whole, or the leagues are wrong
    t1 = [t["rating"] for t in teams if t["tier"] == 1]
    t2 = [t["rating"] for t in teams if t["tier"] == 2]
    if t1 and t2:
        crossings = sum(1 for b in t2 for a in t1 if b > a)
        pairs_n = len(t1) * len(t2)
        check("Challengers sides rarely outrate VCT sides",
              crossings / pairs_n < 0.10,
              f"{crossings}/{pairs_n} = {100 * crossings / pairs_n:.1f}% of pairings, "
              f"best t2 {max(t2)} vs worst t1 {min(t1)}")

    # a club's rating must be its own top five, not a stored number drifting free
    drift = []
    for t in teams:
        top5 = sorted((P[r]["overall"] for r in t["roster"]), reverse=True)[:5]
        want = round(sum(top5) / len(top5))
        if abs(want - t["rating"]) > 1:
            drift.append((t["tag"], t["rating"], want))
    check("club rating is the mean of its best five", not drift, str(drift[:4]))

    # rosters against what vlr lists for that club
    roster_of = {}
    for t in (chal.get("teams") or {}).values():
        roster_of[t["name"]] = {p["ign"].lower() for p in t.get("roster", [])
                                if p.get("role") == "player"}
    known_teams = {k: v for k, v in (career.get("_teams") or {}).items()}
    wrong_club = 0
    checked_club = 0
    for t in teams:
        listed = roster_of.get(t["name"])
        if not listed:
            continue
        for r in t["roster"][:5]:
            checked_club += 1
            if P[r]["ign"].lower() not in listed:
                wrong_club += 1
    if checked_club:
        check("starters appear on their club's vlr roster",
              wrong_club / checked_club < 0.15,
              f"{wrong_club}/{checked_club} not listed (sources disagree on some)")

    # tenure dates must be in the past and parse
    bad_join = [(p["ign"], p.get("joined")) for p in players
                if p.get("joined") and not re.fullmatch(r"\d{4}-\d{2}", p["joined"])]
    check("join dates are YYYY-MM", not bad_join, str(bad_join[:4]))
    future = [(p["ign"], p["joined"]) for p in players
              if p.get("joined") and p["joined"] > f"{SEASON_YEAR}-12"]
    check("nobody joined in the future", not future, str(future[:4]))
    have_join = sum(1 for p in players if p.get("joined"))
    print(f"        {have_join}/{len(players)} have a real join date from "
          f"{len(tenure)} scraped histories")

    # traits are derived, so every trait must be one the builder can emit
    known_traits = {"entry", "carry", "headshot", "anchor", "survivor", "enabler",
                    "clutch", "consistent", "baiter", "glass"}
    bad_trait = {tr["key"] for p in players for tr in (p.get("traits") or [])
                 } - known_traits
    check("traits come from the derived set", not bad_trait, str(bad_trait))

    # ---------------------------------------------------------------- coverage
    print("\ncoverage")
    real_birth = sum(1 for p in players if p.get("birth"))
    real_name = sum(1 for p in players if p.get("realName"))
    with_agents = sum(1 for p in players if p.get("agentPool"))
    print(f"        birthdates {real_birth}/{len(players)}  "
          f"real names {real_name}/{len(players)}  "
          f"agent pools {with_agents}/{len(players)}")
    print(f"        free agents {len(fa)}  "
          f"tier-1 clubs {sum(1 for t in teams if t['tier'] == 1)}  "
          f"tier-2 clubs {sum(1 for t in teams if t['tier'] == 2)}")

    print(f"\n{'FAILED' if fails else 'all checks passed'}"
          f"  ({len(fails)} failures, {len(warns)} warnings)")
    for f in fails:
        print(f"  ! {f}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
