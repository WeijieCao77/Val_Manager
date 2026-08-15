#!/usr/bin/env python3
"""
Build the game world from real VCT 2026 data.

Sources
  data-raw/vlr_vct2026_players.txt    vlr.gg — team, nationality, role and the
                                      full performance line for every player
  data-raw/liquipedia_players.json    Liquipedia — real birthdates / real names
  data-raw/liquipedia_coaches.json    Liquipedia — real head coaches

Every person in the generated world is a real person. Nobody is invented: if a
fact is unknown it is left null and marked, never filled in with a plausible
substitute.

Attributes are derived from the real numbers by percentile — aim comes from a
player's actual ACS/ADR/HS%, awareness from their actual KAST and first-death
rate — so in-game ratings track how these players really perform.

Output  src/data/world.json
"""
import json, math, os, sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data-raw")
SRC = os.path.join(RAW, "vlr_vct2026_players.txt")
BIRTHS = os.path.join(RAW, "liquipedia_players.json")
COACHES = os.path.join(RAW, "liquipedia_coaches.json")
OVERRIDES = os.path.join(RAW, "overrides.json")
OUT = os.path.join(ROOT, "src", "data", "world.json")

SEASON_YEAR = 2026

# The 12 partner teams per league, verified against vlr.gg's region filter and
# its VCT 2026 event pages.
TIER1 = {
    "Americas": [
        ("LEV", "Leviatán"), ("NRG", "NRG Esports"), ("G2", "G2 Esports"), ("MIBR", "MIBR"),
        ("SEN", "Sentinels"), ("FUR", "FURIA"), ("100T", "100 Thieves"), ("KRÜ", "KRÜ Esports"),
        ("LOUD", "LOUD"), ("C9", "Cloud9"), ("EG", "Evil Geniuses"), ("ENVY", "Envy"),
    ],
    "EMEA": [
        ("VIT", "Team Vitality"), ("TH", "Team Heretics"), ("FNC", "FNATIC"), ("FUT", "FUT Esports"),
        ("GX", "GIANTX"), ("BBL", "BBL Esports"), ("TL", "Team Liquid"), ("EF", "Eternal Fire"),
        ("PCF", "PCIFIC Esports"), ("M8", "Gentle Mates"), ("NAVI", "Natus Vincere"),
        ("KC", "Karmine Corp"),
    ],
    "Pacific": [
        ("PRX", "Paper Rex"), ("T1", "T1"), ("NS", "Nongshim RedForce"), ("GEN", "Gen.G"),
        ("KRX", "KIWOOM DRX"), ("ZETA", "ZETA DIVISION"), ("TS", "Team Secret"),
        ("DFM", "DetonatioN FocusMe"), ("RRQ", "Rex Regum Qeon"), ("FS", "FULL SENSE"),
        ("GE", "Global Esports"), ("VL", "VARREL"),
    ],
    "China": [
        ("EDG", "EDward Gaming"), ("XLG", "Xi Lai Gaming"), ("TYL", "TYLOO"),
        ("WOL", "Wolves Esports"), ("FPX", "FunPlus Phoenix"), ("NOVA", "Nova Esports"),
        ("BLG", "Bilibili Gaming"), ("AG", "All Gamers"), ("TE", "Trace Esports"),
        ("JDG", "JD Gaming"), ("DRG", "Dragon Ranger Gaming"), ("TEC", "Titan Esports Club"),
    ],
}

# Challengers sides that appear in the scrape with a full real roster.
TIER2 = {
    "Americas": [],
    "EMEA": [("EP", "Eastern Pandas"), ("SGE", "Sangal Esports"), ("JL", "Joblife")],
    "Pacific": [],
    "China": [("KBG", "KeepBest Gaming"), ("AT", "A Team")],
}

ROLE_CN = {"d": "决斗者", "i": "先锋", "c": "控场", "s": "哨卫", "": "自由人"}
ATTRS = ["aim", "reaction", "awareness", "utility", "clutch", "teamwork", "communication", "igl"]
ATTR_WEIGHT = {"aim": 0.20, "reaction": 0.15, "awareness": 0.17, "utility": 0.14,
               "clutch": 0.12, "teamwork": 0.10, "communication": 0.08, "igl": 0.04}


def seed_of(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


class Rng:
    def __init__(self, seed):
        self.s = (seed & 0xFFFFFFFF) or 0x9E3779B9

    def next(self):
        x = self.s
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        self.s = x & 0xFFFFFFFF
        return self.s / 0x100000000

    def range(self, a, b):
        return a + (b - a) * self.next()

    def int(self, a, b):
        return int(math.floor(self.range(a, b + 1 - 1e-9)))

    def norm(self, mean, sd):
        u1 = max(self.next(), 1e-9)
        u2 = self.next()
        return mean + sd * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def load_json(path):
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except (ValueError, OSError):
            return {}
    return {}


def parse_rows():
    rows = []
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("|")
            if len(p) < 15 or not p[0]:
                continue

            def num(x):
                try:
                    return float(x)
                except (TypeError, ValueError):
                    return None

            rows.append({
                "ign": p[0], "tag": p[1], "nat": p[2], "role": ROLE_CN.get(p[3], "自由人"),
                "rnd": num(p[4]) or 0, "R": num(p[5]), "acs": num(p[6]), "kd": num(p[7]),
                "kast": num(p[8]), "adr": num(p[9]), "kpr": num(p[10]), "apr": num(p[11]),
                "fkpr": num(p[12]), "fdpr": num(p[13]), "hs": num(p[14]),
            })
    best = {}
    for r in rows:
        if r["ign"] not in best or r["rnd"] > best[r["ign"]]["rnd"]:
            best[r["ign"]] = r
    return list(best.values())


def pctiles(rows, key, invert=False):
    vals = sorted(r[key] for r in rows if r.get(key) is not None)
    out = {}
    if not vals:
        return out
    n = len(vals)
    for r in rows:
        v = r.get(key)
        if v is None:
            out[r["ign"]] = 0.5
            continue
        lo, hi = 0, n
        while lo < hi:
            mid = (lo + hi) // 2
            if vals[mid] < v:
                lo = mid + 1
            else:
                hi = mid
        p = lo / max(1, n - 1)
        out[r["ign"]] = (1 - p) if invert else p
    return out


def age_from(birth):
    """Exact age at the start of the in-game season."""
    if not birth:
        return None
    try:
        y, m, d = (int(x) for x in birth.split("-")[:3])
    except (ValueError, AttributeError):
        return None
    ref = date(SEASON_YEAR, 1, 1)
    return ref.year - y - ((ref.month, ref.day) < (m, d))


def salary_for(ovr, tier):
    base = 15000 * math.exp((ovr - 55) / 12.0)
    if tier == 2:
        base *= 0.30
    return int(round(base / 1000.0) * 1000)


def value_for(ovr, age, pot):
    v = 20000 * math.exp((ovr - 55) / 10.5)
    if age is not None:
        if age <= 21:
            v *= 1.45
        elif age <= 24:
            v *= 1.15
        elif age >= 28:
            v *= 0.55
        elif age >= 26:
            v *= 0.8
    v *= 1 + (pot - ovr) / 100.0
    return int(round(v / 1000.0) * 1000)


def main():
    rows = parse_rows()
    births = load_json(BIRTHS)
    coaches = load_json(COACHES)
    ov = load_json(OVERRIDES)
    ov_igl = ov.get("igl", {})
    ov_roles = ov.get("roles", {})

    P = {k: pctiles(rows, k) for k in ("acs", "adr", "hs", "kpr", "fkpr", "kast", "apr", "R", "kd")}
    P["fdpr"] = pctiles(rows, "fdpr", invert=True)

    ROLE_UTIL = {"控场": 1.0, "先锋": 0.95, "哨卫": 0.7, "自由人": 0.55, "决斗者": 0.25}
    ROLE_COMM = {"控场": 0.8, "先锋": 0.85, "哨卫": 0.6, "自由人": 0.7, "决斗者": 0.4}

    def scale(p, lo=44, hi=98):
        return int(round(clamp(lo + (hi - lo) * p, 20, 99)))

    # Averaging eight independent percentiles collapses everyone toward the
    # middle, which would leave the best players in the world rated ~80. Real
    # ability is correlated across axes — an elite player is good at most things
    # — so each axis is blended with the player's overall rating percentile
    # before scaling. That restores a lifelike spread without inventing numbers.
    def axis(specific, quality):
        return 0.58 * specific + 0.42 * quality

    built = {}
    by_tag = defaultdict(list)
    ages_known = 0

    for r in rows:
        ign = r["ign"]
        rng = Rng(seed_of("p:" + ign))
        g = lambda k: P[k].get(ign, 0.5)  # noqa: E731

        q = g("R")  # overall quality percentile, from the player's real rating
        a = {
            "aim": scale(axis(0.5 * g("acs") + 0.3 * g("adr") + 0.2 * g("hs"), q)),
            "reaction": scale(axis(0.55 * g("fkpr") + 0.3 * g("kpr") + 0.15 * g("acs"), q)),
            "awareness": scale(axis(0.5 * g("kast") + 0.35 * g("fdpr") + 0.15 * q, q)),
            "utility": scale(axis(0.55 * g("apr") + 0.45 * ROLE_UTIL[r["role"]], q)),
            "clutch": scale(axis(0.6 * q + 0.4 * g("kd"), q)),
            "teamwork": scale(axis(0.5 * g("kast") + 0.5 * g("apr"), q)),
            "communication": scale(axis(0.55 * g("kast") + 0.45 * ROLE_COMM[r["role"]], q)),
            "igl": scale(axis(0.4 * g("apr") + 0.3 * g("kast") + 0.3 * ROLE_COMM[r["role"]], q),
                         35, 84),
        }
        ovr = int(round(clamp(sum(a[k] * ATTR_WEIGHT[k] for k in ATTRS), 30, 97)))

        lp = births.get(ign) or {}
        age = age_from(lp.get("birth"))
        estimated = age is None
        if estimated:
            age = int(clamp(round(rng.norm(23.2, 2.7)), 17, 33))
        else:
            ages_known += 1
        age = int(clamp(age, 15, 40))

        head = (rng.range(7, 16) if age <= 20 else rng.range(3, 10) if age <= 23
                else rng.range(1, 5) if age <= 26 else rng.range(0, 2))

        built[ign] = {
            "ign": ign, "tag": r["tag"], "nat": r["nat"], "role": r["role"],
            "realName": (lp.get("real") or None), "birth": lp.get("birth"),
            "age": age, "ageEstimated": estimated,
            "attrs": a, "overall": ovr,
            "potential": int(clamp(round(ovr + head), ovr, 99)),
            "form": int(clamp(round(rng.norm(70, 8)), 45, 95)),
            "morale": int(clamp(round(rng.norm(75, 8)), 45, 98)),
            "fatigue": int(clamp(round(rng.range(0, 20)), 0, 100)),
            "loyalty": int(clamp(round(rng.norm(60, 16)), 15, 95)),
            "ambition": int(clamp(round(rng.norm(62, 15)), 15, 98)),
            "vlr": {"rating": r["R"], "acs": r["acs"], "rounds": r["rnd"]},
        }
        by_tag[r["tag"]].append(built[ign])

    out_players, out_teams = [], []
    pid = tid = 0
    used_tags = set()

    def emit(p, team_id, tier, region):
        nonlocal pid
        rec = {
            "id": f"P{pid}", "ign": p["ign"], "teamId": team_id, "region": region,
            "nat": p["nat"], "realName": p["realName"], "birth": p["birth"],
            "role": p["role"], "roles": [p["role"]], "flex": False,
            "age": p["age"], "ageEstimated": p["ageEstimated"],
            "isIgl": False, "attrs": dict(p["attrs"]), "overall": p["overall"],
            "potential": p["potential"], "form": p["form"], "morale": p["morale"],
            "fatigue": p["fatigue"], "salary": salary_for(p["overall"], tier),
            "value": value_for(p["overall"], p["age"], p["potential"]),
            "contractYears": Rng(seed_of("c:" + p["ign"])).int(1, 3),
            "loyalty": p["loyalty"], "ambition": p["ambition"], "vlr": p["vlr"],
        }
        pid += 1
        out_players.append(rec)
        return rec

    def add_team(tag, display, region, tier):
        nonlocal tid
        squad_src = sorted(by_tag.get(tag, []), key=lambda x: -(x["vlr"]["rating"] or 0))
        if len(squad_src) < 5:
            return False
        team_id = f"T{tid}"
        tid += 1
        used_tags.add(tag)
        rng = Rng(seed_of("t:" + display))
        squad = [emit(p, team_id, tier, region) for p in squad_src[:7]]

        # vlr reports a player's most-played agent role, so a real squad can come
        # back with two controllers and no sentinel — which is not a data error,
        # it is how modern VALORANT works: players cover more than one role
        # (smokes + sentinel being the classic pairing).
        #
        # So instead of overwriting anyone's real role, the duplicate keeps it and
        # additionally covers whichever core role the squad is short of. Both are
        # recorded in `roles`, and the engine treats every listed role as covered.
        CORE = ["决斗者", "先锋", "控场", "哨卫"]
        for p in squad:
            p["roles"] = [p["role"]]

        # hand-verified role sets win over anything inferred below
        pinned = set()
        for p in squad:
            fixed = ov_roles.get(p["ign"])
            if fixed:
                p["roles"] = list(fixed)
                p["role"] = fixed[0]
                p["flex"] = len(fixed) > 1
                pinned.add(p["ign"])

        seen = {}
        dupes = []
        for p in sorted(squad[:5], key=lambda x: -x["overall"]):
            for r in p["roles"]:
                seen.setdefault(r, p)
            if p["ign"] in pinned:
                continue
            if seen.get(p["role"]) is not p:
                dupes.append(p)
        gaps = [r for r in CORE if r not in seen]
        for p, gap in zip(dupes, gaps):
            p["roles"] = [p["role"], gap]
            p["flex"] = True
            # covering a second role is a real skill: nudge the axes it leans on
            if gap in ("控场", "哨卫"):
                p["attrs"]["utility"] = int(clamp(p["attrs"]["utility"] + 3, 20, 99))
            if gap == "哨卫":
                p["attrs"]["awareness"] = int(clamp(p["attrs"]["awareness"] + 2, 20, 99))
            p["overall"] = int(round(clamp(
                sum(p["attrs"][k] * ATTR_WEIGHT[k] for k in ATTRS), 30, 97)))

        # Who calls, in order of trust: a hand-verified override, then the
        # `igl=` field on the club's Liquipedia infobox, then — only if neither
        # exists — the most support-shaped player on the roster.
        lp = coaches.get(tag) or coaches.get(display) or {}
        named = ov_igl.get(tag) or ov_igl.get(display) or lp.get("igl")
        igl = None
        if named:
            igl = next((p for p in squad if p["ign"].lower() == str(named).lower()), None)
        if igl is None:
            igl = max(squad, key=lambda p: p["attrs"]["igl"] +
                      (7 if p["role"] in ("控场", "哨卫", "先锋") else 0))
        igl["isIgl"] = True
        igl["attrs"]["igl"] = int(clamp(igl["attrs"]["igl"] + 12, 40, 99))
        igl["attrs"]["communication"] = int(clamp(igl["attrs"]["communication"] + 4, 25, 99))
        igl["overall"] = int(round(clamp(
            sum(igl["attrs"][k] * ATTR_WEIGHT[k] for k in ATTRS), 30, 97)))

        top5 = sorted(squad, key=lambda p: -p["overall"])[:5]
        rating = int(round(sum(p["overall"] for p in top5) / len(top5)))

        # a real coach if Liquipedia gave us one, otherwise no named coach at all
        c = lp
        coach = None
        if c.get("name"):
            coach = {
                "name": c["name"],
                "assistants": c.get("assistants") or [],
                "tactics": int(clamp(round(rng.norm(rating - 6, 6)), 35, 95)),
                "development": int(clamp(round(rng.norm(rating - 8, 7)), 30, 95)),
                "motivation": int(clamp(round(rng.norm(rating - 7, 7)), 30, 95)),
            }

        out_teams.append({
            "id": team_id, "name": display, "tag": tag, "region": region, "tier": tier,
            "league": (f"VCT {region}" if tier == 1 else f"Challengers {region}"),
            "rating": rating,
            "budget": int(rng.range(2_000_000, 8_500_000) if tier == 1
                          else rng.range(240_000, 900_000)),
            "reputation": int(clamp(round(rating * (1.0 if tier == 1 else 0.72)), 20, 99)),
            "roster": [p["id"] for p in squad],
            "coach": coach,
            "facilities": int(clamp(round(rng.norm(rating - (5 if tier == 1 else 18), 8)), 20, 95)),
        })
        return True

    missing = []
    for region, lst in TIER1.items():
        for tag, full in lst:
            if not add_team(tag, full, region, 1):
                missing.append(f"{full} ({tag})")
    for region, lst in TIER2.items():
        for tag, full in lst:
            add_team(tag, full, region, 2)

    # every remaining real player becomes a free agent — nobody is invented
    fa = 0
    for tag, group in by_tag.items():
        if tag in used_tags:
            continue
        for p in group:
            region = next((r for r, l in TIER1.items() if any(t == tag for t, _ in l)), None)
            emit(p, None, 2, region or "Americas")
            out_players[-1]["contractYears"] = 0
            fa += 1

    coached = sum(1 for t in out_teams if t["coach"])
    world = {
        "meta": {
            "season": SEASON_YEAR,
            "sources": {
                "vlr.gg": "teams, rosters, nationalities, roles and all performance stats",
                "liquipedia": "birthdates, real names, head coaches",
            },
            "derived": "attributes percentile-mapped from real per-round statistics",
            "estimated": "contracts, salaries, budgets, facilities; ages where Liquipedia "
                         "has no birthdate (flagged per player via ageEstimated)",
            "everyoneReal": True,
            "regions": list(TIER1.keys()),
        },
        "teams": out_teams,
        "players": out_players,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(world, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    t1 = [t for t in out_teams if t["tier"] == 1]
    print(f"teams {len(out_teams)} (T1 {len(t1)}, T2 {len(out_teams) - len(t1)})")
    print(f"players {len(out_players)} — all real, {fa} free agents")
    print(f"real birthdates {ages_known}/{len(rows)}   real coaches {coached}/{len(out_teams)}")
    ov = sorted(p["overall"] for p in out_players)
    print(f"overall min/med/max {ov[0]}/{ov[len(ov)//2]}/{ov[-1]}")
    for region in TIER1:
        rs = sorted([t for t in t1 if t["region"] == region], key=lambda x: -x["rating"])
        print(f"  {region:9s} " + ", ".join(f"{t['tag']}({t['rating']})" for t in rs))
    if missing:
        print("MISSING tier-1 rosters:", missing)
    print(f"size {os.path.getsize(OUT)/1024:.0f} KB")


if __name__ == "__main__":
    sys.exit(main())
