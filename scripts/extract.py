#!/usr/bin/env python3
"""
Extract a VCT world model from the 无畏人生模拟器 save file.

The save is a player-life simulator world at day 223. Its *team* ratings and
*roster composition* (names / roles / ages / regions) are accurate to real
VCT 2026 -- verified: the top 12 teams by rating in each region reproduce the
real partner-team list for Americas, EMEA, Pacific and China.

Its per-player attributes are NOT usable: every one of the 397 players sits at
overall 90-95 because the save is deep into an "empowered season". So we keep
the identities and re-derive attributes from the team rating.

Output: src/data/world.json
"""
import json, math, os, sys, unicodedata

SAVE = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/fruit/Downloads/无畏人生模拟器_L1merence4u_Day223.vewsave"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "world.json")

REGIONS = ["Americas", "EMEA", "Pacific", "China"]
LEAGUE_NAME = {
    "Americas": "VCT Americas", "EMEA": "VCT EMEA",
    "Pacific": "VCT Pacific", "China": "VCT China",
}
CHALLENGERS_NAME = {
    "Americas": "Challengers Americas", "EMEA": "Challengers EMEA",
    "Pacific": "Challengers Pacific", "China": "Challengers China",
}
ROLES = ["决斗者", "先锋", "控场", "哨卫", "自由人"]


# ---------------------------------------------------------------- deterministic rng
def seed_of(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


class Rng:
    """xorshift32 -- deterministic so the generated data file is stable."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF or 0x9E3779B9

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

    def pick(self, xs):
        return xs[self.int(0, len(xs) - 1)]

    def norm(self, mean, sd):
        u1 = max(self.next(), 1e-9)
        u2 = self.next()
        return mean + sd * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------- role profiles
# offsets applied to a player's base overall to shape each attribute
ROLE_PROFILE = {
    "决斗者": {"aim": 6, "reaction": 5, "awareness": -1, "utility": -5, "clutch": 3,
               "teamwork": -2, "communication": -1, "igl": -7},
    "先锋":   {"aim": -1, "reaction": 1, "awareness": 3, "utility": 5, "clutch": -2,
               "teamwork": 2, "communication": 4, "igl": 0},
    "控场":   {"aim": -4, "reaction": -3, "awareness": 4, "utility": 6, "clutch": -1,
               "teamwork": 3, "communication": 2, "igl": 2},
    "哨卫":   {"aim": -1, "reaction": -2, "awareness": 5, "utility": 3, "clutch": 4,
               "teamwork": 2, "communication": 0, "igl": 1},
    "自由人": {"aim": 1, "reaction": 1, "awareness": 2, "utility": 1, "clutch": 1,
               "teamwork": 3, "communication": 3, "igl": 1},
}
ATTRS = ["aim", "reaction", "awareness", "utility", "clutch", "teamwork", "communication", "igl"]
# how much each attribute counts toward overall
ATTR_WEIGHT = {"aim": 0.20, "reaction": 0.15, "awareness": 0.17, "utility": 0.14,
               "clutch": 0.12, "teamwork": 0.10, "communication": 0.08, "igl": 0.04}


def potential_for(ovr, age, rng):
    if age <= 20:
        p = ovr + rng.range(7, 17)
    elif age <= 23:
        p = ovr + rng.range(3, 11)
    elif age <= 26:
        p = ovr + rng.range(1, 6)
    else:
        p = ovr + rng.range(0, 2)
    return int(clamp(round(p), ovr, 99))


def salary_for(ovr, tier):
    """Annual USD. Roughly matches public VCT salary reporting."""
    base = 15000 * math.exp((ovr - 55) / 12.0)
    if tier == 2:
        base *= 0.30
    return int(round(base / 1000.0) * 1000)


def market_value_for(ovr, age, potential):
    v = 20000 * math.exp((ovr - 55) / 10.5)
    if age <= 21:
        v *= 1.45
    elif age <= 24:
        v *= 1.15
    elif age >= 28:
        v *= 0.55
    elif age >= 26:
        v *= 0.8
    v *= 1 + (potential - ovr) / 100.0
    return int(round(v / 1000.0) * 1000)


# ---------------------------------------------------------------- generated orgs
FILLER_ORGS = {
    "Americas": ["Rising Phoenix", "Northern Lights GC", "Austin Outlaws", "Meridian Esports",
                 "Cascade Collective", "Bayou Bandits"],
    "EMEA": ["Nordic Vanguard", "Iberia Rising", "Baltic Wolves", "Alpine Syndicate",
             "Levant Legion", "Danube United"],
    "Pacific": ["Sunrise Collective", "Archipelago GC", "Mekong Dynasty", "Kanto Ascend",
                "Southern Cross", "Bengal Tigers"],
    "China": ["Silk Road Gaming", "Northern Wall Esports", "Jade Dragon Club", "Pearl Delta Gaming",
              "Yangtze United", "Redwood Esports"],
}

NAME_SYLL = ["ax", "zen", "kai", "vex", "nyx", "rai", "quo", "syl", "dro", "mek", "tez", "vyn",
             "lux", "orb", "kry", "sab", "trix", "jol", "wex", "pyr", "hex", "nov", "zar", "fyn"]
NAME_TAIL = ["", "", "", "z", "y", "x", "en", "ix", "ko", "ra", "1", "7", "00", "er"]


def gen_ign(rng):
    n = rng.pick(NAME_SYLL) + rng.pick(NAME_SYLL) if rng.next() < 0.45 else rng.pick(NAME_SYLL)
    return (n + rng.pick(NAME_TAIL)).capitalize()


# ---------------------------------------------------------------- build
def build():
    save = json.load(open(SAVE, encoding="utf-8"))
    src_teams = save["game"]["world"]["teams"]

    by_region = {r: [] for r in REGIONS}
    for name, t in src_teams.items():
        if t.get("region") in by_region:
            by_region[t["region"]].append((name, t))
    for r in REGIONS:
        by_region[r].sort(key=lambda kv: -kv[1]["rating"])

    teams, players = [], []
    pid = 0
    tid = 0

    def make_player(ign, team_id, region, role, age, tier, team_rating, rank_in_team,
                    is_igl, seed_extra=""):
        nonlocal pid
        rng = Rng(seed_of(ign + (team_id or "FA") + seed_extra))
        # base overall: team rating shifted by the player's standing inside the roster
        # rank 0 is the team's best player
        spread = [4.0, 1.5, 0.0, -1.8, -3.5, -5.5]
        base = team_rating + spread[min(rank_in_team, len(spread) - 1)] + rng.norm(0, 1.6)
        base = clamp(base, 40, 96)

        prof = ROLE_PROFILE[role]
        attrs = {}
        for a in ATTRS:
            v = base + prof[a] + rng.norm(0, 2.2)
            attrs[a] = int(clamp(round(v), 25, 99))
        if is_igl:
            attrs["igl"] = int(clamp(round(base + rng.range(7, 13)), 40, 99))
            attrs["communication"] = int(clamp(attrs["communication"] + rng.range(2, 6), 25, 99))
        else:
            attrs["igl"] = int(clamp(attrs["igl"] - rng.range(0, 6), 20, 92))

        ovr = int(round(sum(attrs[a] * ATTR_WEIGHT[a] for a in ATTRS)))
        ovr = int(clamp(ovr, 30, 97))
        pot = potential_for(ovr, age, rng)

        p = {
            "id": f"P{pid}",
            "ign": ign,
            "teamId": team_id,
            "region": region,
            "role": role,
            "age": age,
            "isIgl": is_igl,
            "attrs": attrs,
            "overall": ovr,
            "potential": pot,
            "form": int(clamp(round(rng.norm(70, 9)), 40, 95)),
            "morale": int(clamp(round(rng.norm(75, 8)), 45, 98)),
            "fatigue": int(clamp(round(rng.range(0, 22)), 0, 100)),
            "salary": salary_for(ovr, tier),
            "value": market_value_for(ovr, age, pot),
            "contractYears": rng.int(1, 3),
            "loyalty": int(clamp(round(rng.norm(60, 16)), 15, 95)),
            "ambition": int(clamp(round(rng.norm(62, 15)), 15, 98)),
        }
        pid += 1
        players.append(p)
        return p

    def add_team(display, region, tier, rating, budget, real_roster=None):
        nonlocal tid
        team_id = f"T{tid}"
        tid += 1
        rng = Rng(seed_of(display + region))

        roster_src = []
        if real_roster:
            # order by the save's own overall so the "best player" ranking is inherited
            rs = sorted(real_roster, key=lambda p: -p.get("overall", 0))
            for p in rs:
                roster_src.append({"ign": p["name"], "role": p["role"],
                                   "age": int(p.get("age") or rng.int(19, 26)),
                                   "igl": p.get("igl", 0)})
        else:
            for i, role in enumerate(ROLES):
                roster_src.append({"ign": gen_ign(rng), "role": role,
                                   "age": rng.int(18, 26), "igl": rng.int(40, 90)})

        # exactly one IGL: prefer the save's highest igl among non-duelists
        igl_idx = 0
        best = -1
        for i, r in enumerate(roster_src):
            score = r["igl"] + (8 if r["role"] in ("控场", "哨卫", "先锋") else 0)
            if score > best:
                best, igl_idx = score, i

        squad = []
        for i, r in enumerate(roster_src):
            p = make_player(r["ign"], team_id, region, r["role"], r["age"], tier,
                            rating, i, i == igl_idx, seed_extra=display)
            squad.append(p["id"])

        coach_rng = Rng(seed_of("coach:" + display))
        coach = {
            "name": gen_ign(coach_rng) + " (Coach)",
            "tactics": int(clamp(round(coach_rng.norm(rating - 8, 7)), 35, 95)),
            "development": int(clamp(round(coach_rng.norm(rating - 10, 8)), 30, 95)),
            "motivation": int(clamp(round(coach_rng.norm(rating - 9, 8)), 30, 95)),
        }

        teams.append({
            "id": team_id,
            "name": display,
            "region": region,
            "tier": tier,
            "league": (LEAGUE_NAME if tier == 1 else CHALLENGERS_NAME)[region],
            "rating": rating,
            "budget": budget,
            "reputation": int(clamp(round(rating * (1.0 if tier == 1 else 0.72)), 20, 99)),
            "roster": squad,
            "coach": coach,
            "facilities": int(clamp(round(Rng(seed_of("fac:" + display)).norm(
                rating - (5 if tier == 1 else 18), 8)), 20, 95)),
        })

    # tier 1 = top 12 per region (verified == real VCT 2026 partner teams)
    for region in REGIONS:
        lst = by_region[region]
        for name, t in lst[:12]:
            add_team(name, region, 1, t["rating"], t["budget"], t["roster"])

    # tier 2 = the remainder, topped up to at least 8 orgs per region
    for region in REGIONS:
        rest = by_region[region][12:]
        for name, t in rest:
            add_team(name, region, 2, t["rating"], t["budget"], t["roster"])
        need = max(0, 8 - len(rest))
        frng = Rng(seed_of("filler:" + region))
        for i in range(need):
            org = FILLER_ORGS[region][i]
            add_team(org, region, 2, int(clamp(round(frng.norm(58, 4)), 48, 66)),
                     int(frng.range(220000, 620000)), None)

    # free agent pool -- a mix of veterans and academy prospects
    fa_rng = Rng(seed_of("free-agents"))
    for i in range(64):
        region = REGIONS[i % 4]
        youth = i % 3 == 0
        age = fa_rng.int(17, 20) if youth else fa_rng.int(22, 31)
        rating = clamp(fa_rng.norm(56 if youth else 63, 7), 42, 78)
        role = fa_rng.pick(ROLES)
        ign = gen_ign(fa_rng)
        p = make_player(ign, None, region, role, age, 2, rating,
                        fa_rng.int(0, 3), fa_rng.next() < 0.2, seed_extra=f"FA{i}")
        p["contractYears"] = 0

    return {
        "meta": {
            "source": "无畏人生模拟器 v1.10M save (day 223) + VCT 2026 verification",
            "generated": True,
            "regions": REGIONS,
            "note": "Identities from the reference save; attributes re-derived from team rating.",
        },
        "teams": teams,
        "players": players,
    }


if __name__ == "__main__":
    world = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(world, f, ensure_ascii=False, separators=(",", ":"))

    t1 = [t for t in world["teams"] if t["tier"] == 1]
    t2 = [t for t in world["teams"] if t["tier"] == 2]
    fa = [p for p in world["players"] if p["teamId"] is None]
    print(f"teams: {len(world['teams'])} (T1={len(t1)}, T2={len(t2)})")
    print(f"players: {len(world['players'])} (free agents={len(fa)})")
    ov = sorted(p["overall"] for p in world["players"])
    print(f"overall min/med/max: {ov[0]}/{ov[len(ov)//2]}/{ov[-1]}")
    for r in REGIONS:
        a = [t['name'] for t in t1 if t['region'] == r]
        b = [t['name'] for t in t2 if t['region'] == r]
        print(f"  {r:9s} T1({len(a)}): {', '.join(a)}")
        print(f"  {'':9s} T2({len(b)}): {', '.join(b)}")
    print(f"size: {os.path.getsize(OUT)/1024:.0f} KB")
