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
import json, math, os, re, sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data-raw")
SRC = os.path.join(RAW, "vlr_vct2026_players.txt")
BIRTHS = os.path.join(RAW, "liquipedia_players.json")
COACHES = os.path.join(RAW, "liquipedia_coaches.json")
VLRAPI = os.path.join(RAW, "vlrapi_teams.json")
AGENTS_F = os.path.join(RAW, "parsebot_agents.json")
OVERRIDES = os.path.join(RAW, "overrides.json")

# which role each agent belongs to, so a real agent pool yields a real role set
AGENT_ROLE = {}
for _role, _names in {
    "决斗者": ["Jett", "Raze", "Phoenix", "Reyna", "Yoru", "Neon", "Iso", "Waylay"],
    "先锋": ["Sova", "Breach", "Skye", "KAY/O", "Kayo", "Fade", "Gekko", "Tejo"],
    "控场": ["Brimstone", "Viper", "Omen", "Astra", "Harbor", "Clove"],
    "哨卫": ["Sage", "Cypher", "Killjoy", "Chamber", "Deadlock", "Vyse"],
}.items():
    for _n in _names:
        AGENT_ROLE[_n.lower()] = _role


# ---------------------------------------------------------------- traits
# Character, read straight off the real numbers. Each entry is
#   (key, label, positive?, predicate over a player's percentile dict)
# Percentiles are within the whole scraped population, so a trait always means
# "top/bottom of the professional field", never an invented flourish.
TRAITS = [
    ("entry", "突破手", True, lambda g: g("fkpr") >= 0.86),
    ("carry", "核心火力", True, lambda g: g("acs") >= 0.88),
    ("headshot", "爆头机器", True, lambda g: g("hs") >= 0.88),
    ("anchor", "定海神针", True, lambda g: g("kast") >= 0.88),
    ("survivor", "生存大师", True, lambda g: g("fdpr") >= 0.88),
    ("enabler", "串联核心", True, lambda g: g("apr") >= 0.86),
    ("clutch", "残局王", True, lambda g: g("clutch_pct") >= 0.88),
    ("consistent", "稳定输出", True,
     lambda g: g("kast") >= 0.7 and g("fdpr") >= 0.7 and g("acs") >= 0.6),
    # negatives — shown in amber, and just as honest
    ("baiter", "苟", False,
     lambda g: g("fkpr") <= 0.2 and g("fdpr") >= 0.75 and g("acs") <= 0.45),
    ("glass", "玻璃大炮", False,
     lambda g: g("acs") >= 0.72 and g("fdpr") <= 0.15),
]


def traits_for(get_pct):
    out = []
    for key, label, good, pred in TRAITS:
        try:
            if pred(get_pct):
                out.append({"key": key, "label": label, "good": good})
        except (TypeError, ValueError):
            continue
    return out


def roles_from_agents(agents):
    """Ordered role set implied by the agents a player actually used."""
    out = []
    for a in agents or []:
        r = AGENT_ROLE.get(str(a).strip().lower())
        if r and r not in out:
            out.append(r)
    return out
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

# Challengers sides, scraped from the 2026 national Challengers leagues on
# vlr.gg (see scripts/fetch_vlr_challengers.py). Every one is a real club with
# a real roster; regions with fewer clubs simply have a smaller league.
TIER2 = {
    'Americas': [('M80', 'M80'), ('SRB', 'Shopify Rebellion Black'), ('SE', 'SaD Esports'), ('NA', 'NRG Academy'), ('QOR', 'QoR'), ('NG', 'Nightblood Gaming'), ('YFT', 'YFT'), ('LM', 'LA MASIA')],
    'EMEA': [('EIN', 'Eintracht Frankfurt'), ('ILEK', 'Çilekler'), ('CE', 'CGN Esports'), ('MAND', 'Mandatory'), ('PL', 'Pixel Lumina'), ('FFE', 'Fire Flux Esports'), ('BE', 'Barça eSports'), ('EP', 'Eastern Pandas'), ('SGE', 'Sangal Esports'), ('JL', 'Joblife')],
    'Pacific': [('REJE', 'REJECT'), ('QD', 'QT DIG∞'), ('RO', 'RIDDLE ORDER'), ('FENN', 'FENNEL'), ('IGZI', 'IGZIST'), ('AGEL', 'AGELITE'), ('INSO', 'Insomnia'), ('OG', 'ONSIDE GAMING')],
    'China': [('KBG', 'KeepBest Gaming'), ('AT', 'A Team'), ('AQG', 'Any Questions Gaming'), ('RA', 'Rare Atom'), ('VNLG', 'Victory No Limits Gaming'), ('WSIG', 'World Sports Invictus Gaming'), ('ODG', 'Octagonal Disposition Gaming')],
}

ROLE_CN = {"d": "决斗者", "i": "先锋", "c": "控场", "s": "哨卫", "": "自由人"}
ATTRS = ["aim", "reaction", "awareness", "utility", "clutch", "teamwork", "communication", "igl"]
ATTR_WEIGHT = {"aim": 0.20, "reaction": 0.15, "awareness": 0.17, "utility": 0.14,
               "clutch": 0.12, "teamwork": 0.10, "communication": 0.08, "igl": 0.04}

# What each role is actually judged on.
#
# One weighting for everyone marked a duelist down for the things duelists do
# not do: 41% of it sat on awareness, utility and teamwork, which are derived
# from KAST and assists. ZmjjKK enters sites for a living — 85 aim, 91 reaction,
# 247 ACS across three years — and was rated below players he outguns, because
# he does not hand out assists. Entry is not a support role and should not be
# scored like one.
ROLE_WEIGHT = {
    "决斗者": {"aim": 0.28, "reaction": 0.22, "clutch": 0.16, "awareness": 0.12,
             "utility": 0.08, "teamwork": 0.07, "communication": 0.05, "igl": 0.02},
    "先锋":  {"aim": 0.17, "reaction": 0.15, "awareness": 0.20, "utility": 0.20,
             "clutch": 0.09, "teamwork": 0.10, "communication": 0.07, "igl": 0.02},
    "控场":  {"aim": 0.15, "reaction": 0.11, "awareness": 0.20, "utility": 0.22,
             "clutch": 0.09, "teamwork": 0.13, "communication": 0.08, "igl": 0.02},
    "哨卫":  {"aim": 0.19, "reaction": 0.12, "awareness": 0.22, "utility": 0.15,
             "clutch": 0.15, "teamwork": 0.10, "communication": 0.05, "igl": 0.02},
    "自由人": dict(ATTR_WEIGHT),
}


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


CHALLENGERS_CACHE = os.path.join(ROOT, "scripts", "cache", "vlr_challengers.json")
TENURE_CACHE = os.path.join(ROOT, "scripts", "cache", "liquipedia_tenure.json")
CAREER_CACHE = os.path.join(ROOT, "scripts", "cache", "vlr_career.json")
SEASONS_CACHE = os.path.join(ROOT, "scripts", "cache", "vlr_seasons.json")

# Recent form says more about a player than three-year-old form, but not so much
# more that one split erases a career. 2026 counts three times what 2024 does.
YEAR_WEIGHT = {2026: 3.0, 2025: 2.0, 2024: 1.0}
# What a player does when the stage is biggest, relative to their own baseline.
TIER_WEIGHT = {"champions": 1.0, "masters": 0.75, "league": 0.0, "kickoff": 0.0}

# Columns that describe how a player performs, as opposed to who they are.
STAT_KEYS = ("R", "acs", "kd", "kast", "adr", "kpr", "apr", "fkpr", "fdpr")

# What a career line earned outside VCT is worth in VCT.
#
# Ranking everyone in one pool assumed 250 ACS is 250 ACS wherever it was
# earned, and it is not — a Challengers roster earns its numbers against
# Challengers opposition. Unchecked, that put NRG Academy at 90, above every
# club in VCT Americas.
#
# These are not chosen numbers. scripts/calibrate_tier.py measures them twice
# over, each time comparing players to themselves: 72 players appear in both
# the VCT and the Challengers event tables (Challengers -> VCT), and 336 who
# have never played VCT have both a Challengers-only line and a whole-career
# line (career -> Challengers, because a career also holds open qualifiers and
# tier-3 brackets). The product is below. Re-run it and paste the block if
# either scrape grows.
#
# They err low: the players who get called up are the ones who translate best,
# so the gap for an average Challengers player is wider than this.
SUBTIER_TO_VCT = {
    "R": 0.831, "acs": 0.850, "kd": 0.773, "kast": 0.938,
    "adr": 0.867, "kpr": 0.844, "apr": 0.981, "fdpr": 1.119,
}
# Rounds of tier-1 play after which a player is being measured against tier-1
# opposition and the correction no longer applies. One VCT split plus playoffs
# is around 600; the median tier-1 starter has 1991 and the median Challengers
# player has none, so almost everyone sits at one end or the other.
TIER1_SAMPLE = 600.0


# Where a player belongs when their club is not one of the modelled leagues.
# Free agents were all being stamped "Americas" because the region lookup only
# consulted TIER1, and a free agent's club is by definition not in it.
NAT_REGION = {
    "us": "Americas", "ca": "Americas", "br": "Americas", "ar": "Americas",
    "cl": "Americas", "mx": "Americas", "pe": "Americas", "co": "Americas",
    "uy": "Americas", "do": "Americas", "ec": "Americas", "bo": "Americas",
    "cn": "China", "hk": "China", "mo": "China", "tw": "China",
    "kr": "Pacific", "jp": "Pacific", "id": "Pacific", "th": "Pacific",
    "ph": "Pacific", "sg": "Pacific", "my": "Pacific", "vn": "Pacific",
    "in": "Pacific", "au": "Pacific", "nz": "Pacific",
    "gb": "EMEA", "fr": "EMEA", "de": "EMEA", "es": "EMEA", "tr": "EMEA",
    "ru": "EMEA", "pl": "EMEA", "se": "EMEA", "dk": "EMEA", "ua": "EMEA",
    "it": "EMEA", "nl": "EMEA", "be": "EMEA", "fi": "EMEA", "no": "EMEA",
    "pt": "EMEA", "cz": "EMEA", "ro": "EMEA", "gr": "EMEA", "il": "EMEA",
    "ch": "EMEA", "at": "EMEA", "hu": "EMEA", "rs": "EMEA", "bg": "EMEA",
    "kg": "EMEA", "kz": "EMEA", "az": "EMEA", "ma": "EMEA", "sa": "EMEA",
}


# tags already spoken for by a VCT club; a Challengers side must not collide
# with one — "Eintracht Frankfurt" and "Eternal Fire" both reduce to EF, which
# put one club's roster on the other and left the second with nobody.
TIER1_TAGS = {t for lst in TIER1.values() for t, _ in lst}


def vcl_tag(name):
    """A short, stable tag for a Challengers club, derived from its real name."""
    cleaned = re.sub(r"[^A-Za-z0-9 ]", "", name).split()
    if not cleaned:
        base = name[:4].upper()
    elif len(cleaned) == 1:
        base = cleaned[0][:4].upper()
    else:
        base = "".join(w[0] for w in cleaned)[:4].upper()
    if base not in TIER1_TAGS:
        return base
    # lengthen until it is its own tag
    letters = re.sub(r"[^A-Za-z0-9]", "", name).upper()
    for n in range(len(base) + 1, len(letters) + 1):
        if letters[:n] not in TIER1_TAGS:
            return letters[:n]
    return base + "2"


def season_profiles():
    """Recency-weighted stat lines, plus how each player does on the big stage.

    A flat career average cannot tell three steady years from a decline. ZmjjKK
    has held 238+ ACS every year and peaks at Champions; Lysoar has climbed from
    0.82 to 0.99 and is not the player his average says he is. Weighting recent
    seasons higher separates them.
    """
    cache = load_json(SEASONS_CACHE)
    events, stats = cache.get("events") or {}, cache.get("stats") or {}
    if not stats:
        return {}, {}, {}

    COLS = {"rating2": "R", "acs": "acs", "kd": "kd", "kast": "kast",
            "adr": "adr", "kpr": "kpr", "apr": "apr", "fkpr": "fkpr",
            "fdpr": "fdpr", "hs": "hs"}
    weighted, big, base = {}, {}, {}
    # rounds actually played at tier 1, unweighted — how much VCT evidence there
    # is, which is a different question from how recent it is
    t1_rounds: dict[str, float] = {}
    for eid, rows in stats.items():
        ev = events.get(eid)
        if not ev:
            continue
        yw = YEAR_WEIGHT.get(ev.get("year"), 0.5)
        tw = TIER_WEIGHT.get(ev.get("tier"), 0.0)
        for r in rows:
            rnd = r.get("rnd") or 0
            if not rnd:
                continue
            ign = r["ign"]
            t1_rounds[ign] = t1_rounds.get(ign, 0.0) + rnd
            acc = weighted.setdefault(ign, {"w": 0.0})
            acc["w"] += rnd * yw
            for src, dst in COLS.items():
                v = r.get(src)
                if v is None:
                    continue
                if dst == "kast" and v > 1:
                    v /= 100
                acc[dst] = acc.get(dst, 0.0) + v * rnd * yw
                acc[f"{dst}_w"] = acc.get(f"{dst}_w", 0.0) + rnd * yw
            # a separate tally for the international stage, and for everything,
            # so the two can be compared on the same footing
            rating = r.get("rating2")
            if rating is not None:
                base[ign] = base.get(ign, [0.0, 0.0])
                base[ign][0] += rating * rnd
                base[ign][1] += rnd
                if tw > 0:
                    big[ign] = big.get(ign, [0.0, 0.0])
                    big[ign][0] += rating * rnd * tw
                    big[ign][1] += rnd * tw

    out = {}
    for ign, acc in weighted.items():
        if acc["w"] <= 0:
            continue
        line = {"rnd": round(acc["w"])}
        for dst in COLS.values():
            w = acc.get(f"{dst}_w") or 0
            if w > 0:
                line[dst] = acc[dst] / w
        out[ign] = line

    # how much better (or worse) they are when it matters, as a ratio
    stage = {}
    for ign, (bs, bw) in big.items():
        tot, tw = base.get(ign, [0, 0])
        if bw > 0 and tw > 0 and tot > 0:
            stage[ign] = (bs / bw) / (tot / tw)
    return out, stage, t1_rounds


def parse_challengers_rows():
    """Challengers players, in the same shape parse_rows() produces.

    They are appended to the tier-1 pool *before* percentiles are computed, on
    purpose: ability is then ranked across the whole scraped population, so a
    Challengers player lands in the lower percentiles by measurement rather than
    by a hand-applied penalty. Nothing here is invented — every line is a real
    vlr.gg event stat line.
    """
    cache = load_json(CHALLENGERS_CACHE)
    if not cache:
        return [], {}, {}

    # club abbreviation as it appears in the stats table -> our team tag
    roster_of, tag_of_region = {}, {}
    for t in cache.get("teams", {}).values():
        roster_of[t["name"]] = {p["ign"].lower() for p in t["roster"] if p["role"] == "player"}
        tag_of_region[t["name"]] = t.get("region", "")

    def num(x):
        try:
            return float(str(x).replace("%", ""))
        except (TypeError, ValueError):
            return None

    rows, agents, tag_region = [], {}, {}
    for lines in cache.get("stats", {}).values():
        for r in lines:
            club = r.get("club") or ""
            # the stats table abbreviates; match it back to a scraped club
            tag = next(
                (name for name in roster_of
                 if name == club or r["ign"].lower() in roster_of[name]),
                None,
            )
            if not tag:
                continue
            kast = num(r.get("kast"))
            rows.append({
                "ign": r["ign"], "tag": vcl_tag(tag), "nat": "", 
                "role": (roles_from_agents(r.get("agents")) or ["自由人"])[0],
                "rnd": num(r.get("maps")) or 0, "R": num(r.get("rating2")),
                "acs": num(r.get("acs")), "kd": num(r.get("kd")),
                "kast": kast / 100 if kast and kast > 1 else kast,
                "adr": num(r.get("adr")), "kpr": num(r.get("kpr")), "apr": num(r.get("apr")),
                "fkpr": num(r.get("fkpr")), "fdpr": num(r.get("fdpr")),
                "hs": num(r.get("hs")),
            })
            agents[r["ign"]] = r.get("agents") or []
            tag_region[vcl_tag(tag)] = tag_of_region.get(tag, "")

    # leagues with no stats tab were filled in from each player's own page
    for r in cache.get("players", {}).values():
        club = r.get("club")
        if not club or club not in roster_of:
            continue
        rows.append({
            "ign": r["ign"], "tag": vcl_tag(club), "nat": "",
            "role": (roles_from_agents(r.get("agents")) or ["自由人"])[0],
            "rnd": r.get("rnd") or 0, "R": r.get("R"), "acs": r.get("acs"),
            "kd": r.get("kd"), "kast": r.get("kast"), "adr": r.get("adr"),
            "kpr": r.get("kpr"), "apr": r.get("apr"),
            "fkpr": r.get("fkpr"), "fdpr": r.get("fdpr"), "hs": None,
        })
        agents[r["ign"]] = r.get("agents") or []
        tag_region[vcl_tag(club)] = tag_of_region.get(club, "")

    best = {}
    for r in rows:
        if r["ign"] not in best or (r["rnd"] or 0) > (best[r["ign"]]["rnd"] or 0):
            best[r["ign"]] = r
    return list(best.values()), agents, tag_region


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
    tenure = load_json(TENURE_CACHE)
    if tenure:
        dated = sum(1 for v in tenure.values() if any(not x.get("to") for x in v))
        print(f"tenure: club histories for {len(tenure)} players, {dated} currently signed")
    known = {r["ign"] for r in rows}
    vcl_rows, vcl_agents, vcl_regions = parse_challengers_rows()
    # a Challengers player who has since moved up is already in the tier-1 pull
    vcl_rows = [r for r in vcl_rows if r["ign"] not in known]
    rows += vcl_rows
    print(f"challengers: +{len(vcl_rows)} real players from vlr.gg event stats")
    births = load_json(BIRTHS)
    coaches = load_json(COACHES)
    # the community VLR API fills clubs whose Liquipedia infobox omits a coach
    for tag, rec in load_json(VLRAPI).items():
        if not rec.get("coach"):
            continue
        cur = coaches.setdefault(tag, {})
        if not cur.get("name"):
            cur["name"] = rec["coach"]
            cur["assistants"] = rec.get("assistants") or []
    agent_pools = load_json(AGENTS_F)
    ov = load_json(OVERRIDES)
    ov_igl = ov.get("igl", {})
    ov_roles = ov.get("roles", {})

    # ---- ability from a career, form from this season ------------------
    #
    # Deriving attributes from one season modelled a player having a bad year
    # as a worse player: ZmjjKK won in 2024 and has been good throughout, but
    # 2026 alone put his ceiling below his level. Ability now ranks on career
    # numbers; the current season becomes his starting form instead, so a
    # veteran in a slump reads as high ability and low form rather than as
    # someone who simply got worse.
    career = {k: v for k, v in load_json(CAREER_CACHE).items()
              if not k.startswith("_") and not v.get("miss")}
    # three seasons broken out by year and stage beats one flattened average
    profiles, stage, t1_rounds = season_profiles()
    if profiles:
        print(f"seasons: recency-weighted profiles for {len(profiles)} players, "
              f"{len(stage)} with an international record")
    # what a player's own numbers look like across everything we have, which is
    # what this season's numbers get compared against to produce form
    baseline = {ign: {**career.get(ign, {}), **line} for ign, line in profiles.items()}
    for ign, c in career.items():
        baseline.setdefault(ign, c)
    season = {r["ign"]: dict(r) for r in rows}

    # Small samples must not rank like large ones. Sharks played 119 rounds as a
    # stand-in and came out above a team-mate with 8031, purely because one good
    # night is easy and a career is not. Every stat is pulled toward the league
    # mean by how little we have seen: at 400 rounds it counts half, at 4000 it
    # counts ninety percent. This is why he was starting ahead of Lysoar.
    SHRINK_ROUNDS = 400

    def vct_weight(ign):
        """How far to trust the VCT-only line over the whole career, 0 to 1.

        Two things are known about most players: a recency-weighted line from
        VCT events, measured against tier-1 opposition, and a career line that
        is everything vlr has ever recorded — Challengers, open qualifiers, the
        lot. Letting the VCT line simply win produced hezacoil: 190 VCT rounds
        treated as settled fact and trusted like the 2754 behind him. Letting
        the career line win loses the trend the profile exists to show. So they
        are blended by how much VCT there is to go on.
        """
        return clamp(t1_rounds.get(ign, 0.0) / TIER1_SAMPLE, 0.0, 1.0)

    # First translate, then rank. Doing it the other way round would leave the
    # 30th-percentile anchor below drawn from a pool that is itself inflated.
    lines = {}
    for r in rows:
        c, prof = career.get(r["ign"]), profiles.get(r["ign"])
        kp = vct_weight(r["ign"])
        merged = dict(r)
        for k in STAT_KEYS:
            # the career half is what needs translating; the VCT half was
            # already measured against the opposition it is being ranked with
            sub = c.get(k) if c else None
            if sub is not None:
                f = SUBTIER_TO_VCT.get(k)
                if f is not None:
                    sub *= f
            top = prof.get(k) if prof else None
            if top is not None and sub is not None:
                merged[k] = top * kp + sub * (1 - kp)
            elif top is not None:
                merged[k] = top
            elif sub is not None:
                merged[k] = sub
        merged["rnd"] = max(c.get("rnd") or 0 if c else 0, r.get("rnd") or 0)
        lines[r["ign"]] = merged
    adj = sum(1 for r in rows if vct_weight(r["ign"]) < 0.5)
    print(f"tier: {adj} players are measured mostly below VCT; the sub-tier half "
          f"of every line is translated (R x{SUBTIER_TO_VCT['R']}, "
          f"ACS x{SUBTIER_TO_VCT['acs']}, K/D x{SUBTIER_TO_VCT['kd']})")

    # Shrink toward a below-average anchor, not the mean. A player we have
    # barely seen is not an average professional — he is unproven, and the
    # league mean is drawn from people who have held a starting place. Sharks
    # played 119 rounds as a stand-in and landed at the median, which read as
    # "solid" and kept him in the five.
    pool = {}
    for k in STAT_KEYS:
        vals = sorted(c[k] for c in lines.values() if c.get(k) is not None)
        pool[k] = vals[int(len(vals) * 0.3)] if vals else None

    stat_rows = []
    for r in rows:
        # a copy per row: two sources can spell the same player twice, and
        # shrinking one shared dict twice would halve him
        merged = dict(lines[r["ign"]])
        rnd = merged["rnd"]
        trust = rnd / (rnd + SHRINK_ROUNDS)
        for k in STAT_KEYS:
            mean = pool.get(k)
            if merged.get(k) is None or mean is None:
                continue
            merged[k] = merged[k] * trust + mean * (1 - trust)
        stat_rows.append(merged)
    thin = sum(1 for r in stat_rows if (r.get("rnd") or 0) < SHRINK_ROUNDS)
    print(f"shrinkage: {thin} players have under {SHRINK_ROUNDS} rounds and are pulled toward the 30th percentile")
    have = sum(1 for r in rows if r["ign"] in career or r["ign"] in profiles)
    print(f"career: ability derived from career stats for {have}/{len(rows)} players")

    stat_by_ign = {r["ign"]: r for r in stat_rows}
    P = {k: pctiles(stat_rows, k) for k in ("acs", "adr", "hs", "kpr", "fkpr", "kast", "apr", "R", "kd")}
    P["fdpr"] = pctiles(stat_rows, "fdpr", invert=True)

    # Rating is scored within role, not against the whole league. It carries
    # 0.42 of every attribute, and the roles do not rate alike — duelists sit at
    # 0.975 and sentinels at 1.017, because dying is part of entering. Judged
    # league-wide, a duelist putting up 247 ACS reads as ordinary.
    P["R"] = {}
    for role in set(r["role"] for r in stat_rows):
        peers = [r for r in stat_rows if r["role"] == role]
        if len(peers) >= 12:
            P["R"].update(pctiles(peers, "R"))
        else:
            P["R"].update(pctiles(stat_rows, "R"))

    def form_for(ign, rng):
        """This season against the player's own career, as 30-99 form."""
        c, sea = baseline.get(ign), season.get(ign)
        if not c or not sea or not c.get("R") or not sea.get("R"):
            return int(clamp(round(rng.norm(70, 8)), 45, 95))
        # a season 15% above a career average is a genuine purple patch
        ratio = sea["R"] / c["R"]
        return int(clamp(round(70 + (ratio - 1) * 130 + rng.range(-4, 4)), 30, 99))

    # clutch rate only exists in the parse.bot snapshot, so rank within it
    cl_rows = []
    for ign, rec in agent_pools.items():
        v = str(rec.get("clutch_pct") or "").replace("%", "").strip()
        try:
            cl_rows.append({"ign": ign, "clutch_pct": float(v)})
        except ValueError:
            continue
    P["clutch_pct"] = pctiles(cl_rows, "clutch_pct") if cl_rows else {}

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

        traits = traits_for(g)
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
        w = ROLE_WEIGHT.get(r["role"], ATTR_WEIGHT)
        ovr = sum(a[k] * w.get(k, ATTR_WEIGHT[k]) for k in ATTRS)
        # Turning up at Champions is the hardest thing to fake, and a career
        # average buries it: ZmjjKK's best ACS comes at the biggest events.
        lift = stage.get(ign)
        if lift is not None:
            ovr += clamp((lift - 1) * 26, -4, 5)
        ovr = int(round(clamp(ovr, 30, 97)))

        lp = births.get(ign) or {}
        raw_birth = lp.get("birth")
        age = age_from(raw_birth)
        estimated = age is None
        if estimated:
            # Some infoboxes give a year and nothing else ("1999-??-??"). That
            # is real knowledge and beats a draw from the age distribution — but
            # it is not a date, so it must not be published as one.
            m = re.match(r"^(\d{4})", str(raw_birth or ""))
            age = (SEASON_YEAR - int(m.group(1)) if m
                   else int(clamp(round(rng.norm(23.2, 2.7)), 17, 33)))
        else:
            ages_known += 1
        age = int(clamp(age, 15, 40))
        # only a full date is a birthdate; a partial one is dropped rather than
        # shown to the player as "1999-??-??"
        birth = raw_birth if not estimated else None

        head = (rng.range(7, 16) if age <= 20 else rng.range(3, 10) if age <= 23
                else rng.range(1, 5) if age <= 26 else rng.range(0, 2))

        # how long they have been at their club, for team-mate chemistry.
        # Liquipedia gives the whole history; the open-ended stint is current.
        stints = tenure.get(ign) or []
        current = [x for x in stints if not x.get("to")]
        joined = current[0]["from"][:7] if current else None

        built[ign] = {
            "ign": ign, "tag": r["tag"], "nat": r["nat"], "role": r["role"],
            "joined": joined,
            "traits": traits,
            # Liquipedia sometimes fills the name field with the handle when no
            # real name is public (Neon). Repeating it back reads as "Neon
            # (Neon)"; not knowing is the honest answer.
            "realName": (lp.get("real") or None)
            if str(lp.get("real") or "").lower() != ign.lower() else None,
            "birth": birth,
            "age": age, "ageEstimated": estimated,
            "attrs": a, "overall": ovr,
            "potential": int(clamp(round(ovr + head), ovr, 99)),
            "form": form_for(ign, rng),
            "morale": int(clamp(round(rng.norm(75, 8)), 45, 98)),
            "fatigue": int(clamp(round(rng.range(0, 20)), 0, 100)),
            "loyalty": int(clamp(round(rng.norm(60, 16)), 15, 95)),
            "ambition": int(clamp(round(rng.norm(62, 15)), 15, 98)),
            "rounds": int(stat_by_ign.get(ign, {}).get("rnd") or 0),
            "vlr": {"rating": r["R"], "acs": r["acs"], "rounds": r["rnd"]},
        }
        by_tag[r["tag"]].append(built[ign])

    out_players, out_teams = [], []
    # every alias already given a club, lowercased: the same person must not
    # appear twice because two sources spelled them Juicy and juicy
    placed = set()
    pid = tid = 0
    used_tags = set()

    def emit(p, team_id, tier, region):
        nonlocal pid
        rec = {
            "id": f"P{pid}", "ign": p["ign"], "teamId": team_id, "region": region,
            "nat": p["nat"], "realName": p["realName"], "birth": p["birth"],
            "joined": p.get("joined"),
            "rounds": p.get("rounds") or 0,
            "role": p["role"], "roles": [p["role"]], "flex": False,
            "traits": p.get("traits") or [],
            "agentPool": [], "roleSource": "vlr-primary",
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
        # A tag is not unique across tiers — Eternal Fire and Eintracht Frankfurt
        # are both "EF" — so indexing squads by tag alone put one roster on two
        # clubs. Anyone already placed is skipped.
        squad_src, seen_here = [], set()
        for p in by_tag.get(tag, []):
            low = p["ign"].lower()
            if low in placed or low in seen_here:
                continue
            seen_here.add(low)
            squad_src.append(p)
        squad_src.sort(key=lambda x: -(x["vlr"]["rating"] or 0))
        if len(squad_src) < 5:
            return False
        team_id = f"T{tid}"
        tid += 1
        used_tags.add(tag)
        for p in squad_src[:7]:
            placed.add(p["ign"].lower())
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

        # Evidence first: a player's real agent pool tells us exactly which
        # roles they cover, which neither vlr's single "most-played role" nor
        # Liquipedia can express.
        pinned = set()
        for p in squad:
            pool = (agent_pools.get(p["ign"]) or {}).get("agents") or []
            derived = roles_from_agents(pool)
            if derived:
                p["agentPool"] = pool
                p["roles"] = derived
                p["role"] = derived[0]
                p["flex"] = len(derived) > 1
                p["roleSource"] = "agents"
                pinned.add(p["ign"])

        # hand-verified sets still win, for players the snapshot does not cover
        for p in squad:
            fixed = ov_roles.get(p["ign"])
            if fixed:
                p["roles"] = list(fixed)
                p["role"] = fixed[0]
                p["flex"] = len(fixed) > 1
                p["roleSource"] = "verified"
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

        # Potential was fixed before these bumps, so covering a second role or
        # taking the armband could push a player above his own ceiling — four
        # ended up there, which reads as "cannot improve" and draws a backwards
        # bar. A ceiling is a floor of at least where you already are.
        for p in squad:
            p["potential"] = int(clamp(max(p["potential"], p["overall"]), 30, 99))

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
            if p["ign"].lower() in placed:
                continue
            placed.add(p["ign"].lower())
            # a free agent belongs to the region their club or passport says,
            # not to whichever region happens to be first in the table
            region = (
                next((r for r, l in TIER1.items() if any(t == tag for t, _ in l)), None)
                or next((r for r, l in TIER2.items() if any(t == tag for t, _ in l)), None)
                or vcl_regions.get(tag)
                or NAT_REGION.get((p.get("nat") or "").lower())
            )
            emit(p, None, 2, region or "Americas")
            out_players[-1]["contractYears"] = 0
            fa += 1

    # analysts are a separate, genuinely scarce profession: Liquipedia records
    # only a handful league-wide, and we do not invent the rest
    # There are only a handful in the whole world, so rather than five rows that
    # differ by a couple of points, each gets a distinct specialty and is worth
    # hiring for a different reason.
    SPECS = ["maps", "opponent", "potential", "economy", "review"]
    analysts = []
    for tag, rec in coaches.items():
        for name in rec.get("analysts") or []:
            rng = Rng(seed_of("an:" + name))
            analysts.append({
                "name": name,
                "from": rec.get("team") or tag,
                "tactics": int(clamp(round(rng.norm(72, 7)), 45, 90)),
                "development": int(clamp(round(rng.norm(58, 8)), 35, 82)),
                "motivation": int(clamp(round(rng.norm(56, 8)), 35, 80)),
            })
    # deterministic, and distinct: no two share a specialty while any are left
    analysts.sort(key=lambda a: a["name"])
    for i, a in enumerate(analysts):
        a["spec"] = SPECS[i % len(SPECS)]

    coached = sum(1 for t in out_teams if t["coach"])
    world = {
        "meta": {
            "season": SEASON_YEAR,
            "analysts": analysts,
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
