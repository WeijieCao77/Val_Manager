#!/usr/bin/env python3
"""
A world as it stood at the start of a past season, for the 历史生涯档.

    python3 scripts/build_world_year.py 2024 [--fetch-births]

The 2026 world (build_world.py) is built from this season's tables. A save
that starts in January 2024 needs the world as it was THEN: who was on
which roster, rated on what they had done up to that point, at the age they
were. Everything here is read off caches that already exist:

  scripts/cache/vlr_event_stats.json   every VCT event 2022–2026 with each
                                       participant's line and agents — the
                                       rosters come from the year's opening
                                       events (the four Kickoffs), ability
                                       from the events before the year
  data-raw/liquipedia_players.json     birthdates for the 2026 population
  scripts/cache/liquipedia_births_hist.json
                                       birthdates fetched for everyone else
                                       (--fetch-births, batched, 2.5 s apart,
                                       merged never overwritten)
  src/data/world.json                  ids — a man keeps his P-id, a club its
                                       T-id, so cards and the dossier still
                                       point at the same people; someone the
                                       2026 world never had gets H<n>

Nothing is invented: every player is a line in a real event's stats table,
every roster is the one that played the opening event, an unknown birthdate
is estimated and flagged exactly as build_world does. The second tier is the
2026 Challengers population carried over as a placeholder (meta.tier2), with
the men who were in that year's top tier removed — real Challengers tables
for these years are a later scrape.

Ability is percentile-mapped with build_world's own formulas (imported, not
copied), from the stat lines of the seasons BEFORE the start year, weighted
by recency; a rookie with no earlier line is rated on the opening event
itself, shrunk hard toward the unproven anchor.
"""
import argparse, gzip, json, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_world as bw  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "cache", "vlr_event_stats.json")
BIRTHS_2026 = os.path.join(ROOT, "data-raw", "liquipedia_players.json")
BIRTHS_HIST = os.path.join(ROOT, "scripts", "cache", "liquipedia_births_hist.json")
STAFF = os.path.join(ROOT, "scripts", "cache", "liquipedia_event_staff.json")
COACH_CAREERS = os.path.join(ROOT, "scripts", "cache", "vlr_coach_careers.json")
CHALLENGERS = os.path.join(ROOT, "scripts", "cache", "vlr_challengers_hist.json")
WORLD_2026 = os.path.join(ROOT, "src", "data", "world.json")
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact yankejing711@gmail.com)"
API = "https://liquipedia.net/valorant/api.php"

# how the opening event of each year names its region
REGION_OF = {"americas": "Americas", "emea": "EMEA", "pacific": "Pacific", "china": "China"}
# vlr tags → the club's display name, where the 2026 world does not know the tag
NAMES = {
    "LOUD": "LOUD", "LEV": "LEVIATÁN", "SEN": "Sentinels", "NRG": "NRG", "C9": "Cloud9", "EG": "Evil Geniuses",
    "100T": "100 Thieves", "FUR": "FURIA", "KRÜ": "KRÜ Esports", "MIBR": "MIBR", "G2": "G2 Esports", "2G": "2Game Esports",
    "FNC": "FNATIC", "TL": "Team Liquid", "MKOI": "KOI", "NAVI": "Natus Vincere", "GIA": "Giants Gaming", "GX": "GIANTX",
    "BBL": "BBL Esports", "FUT": "FUT Esports", "VIT": "Team Vitality", "KC": "Karmine Corp", "TH": "Team Heretics",
    "M8": "Gentle Mates", "APK": "Apeks", "PRX": "Paper Rex", "KRX": "DRX", "GE": "Global Esports", "T1": "T1",
    "ZETA": "ZETA DIVISION", "GEN": "Gen.G", "TS": "Team Secret", "DFM": "DetonatioN FocusMe", "TLN": "TALON",
    "RRQ": "Rex Regum Qeon", "BLD": "BLEED", "NS": "Nongshim RedForce", "BME": "BOOM Esports", "SPB": "Team Secret",
    "EDG": "EDward Gaming", "FPX": "FunPlus Phoenix", "BLG": "Bilibili Gaming", "TE": "Trace Esports", "TYL": "TYLOO",
    "TEC": "Titan Esports Club", "NOVA": "Nova Esports", "JDG": "JD Gaming", "DRG": "Dragon Ranger Gaming",
    "AG": "All Gamers", "WOL": "Wolves Esports", "XLG": "Xi Lai Gaming",
}


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def opening_events(cache, year):
    """The events whose rosters define the season's start: the Kickoffs —
    or, in 2023, the three leagues and China's Champions qualifier (the
    domestic circuit's field, the closest thing to a Chinese league that
    year; the ten with the most rounds are its tier one)."""
    out = []
    for eid, ev in cache["events"].items():
        if ev.get("year") != year:
            continue
        slug = ev.get("slug", "")
        if year == 2023:
            if slug.endswith("-league"):
                region = next((v for k, v in REGION_OF.items() if k in slug), None)
                if region:
                    out.append((eid, ev, region))
            elif "champions-china-qualifier" in slug:
                out.append((eid, ev, "China"))
            continue
        if ev.get("tier") == "kickoff":
            region = next((v for k, v in REGION_OF.items() if k in slug), None)
            if region:
                out.append((eid, ev, region))
    return out


def evidence_events(cache, year):
    """Every cached event played before the season starts."""
    return [(eid, ev) for eid, ev in cache["events"].items() if (ev.get("year") or 0) < year]


def top_flight(ev):
    """Was this event the top of its year?

    Masters and Champions always. From 2023 the franchised leagues, Kickoffs
    and stages are. In 2022 the regional Challengers of Europe and North
    America were the circuit's main leagues; the smaller regions' Challengers
    (Turkey, CIS, Brazil, LATAM, Japan, Korea, SEA, Oceania...) and every
    2023 Last Chance Qualifier and the China qualifier were not — a 1.32 in
    Turkey Challengers is not a 1.32 in VCT, which is what put Elite at 91
    off 425 rounds. Lines from those events are translated with the same
    factors build_world measured for Challengers → VCT.
    """
    tier, slug, year = ev.get("tier"), str(ev.get("slug") or ""), ev.get("year") or 0
    if tier in ("masters", "champions"):
        return True
    if "last-chance" in slug or "qualifier" in slug:
        return False
    if year >= 2023:
        return tier in ("league", "kickoff")
    return "champions-tour-europe" in slug or "champions-tour-north-america" in slug


def fetch_births(igns, store):
    """Batched Liquipedia page reads, gzip, identified, 2.5 s apart; a 429 aborts."""
    todo = [i for i in igns if i.lower() not in {k.lower() for k in store}]
    print(f"births: {len(todo)} players to look up on Liquipedia")
    last = 0.0
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        wait = 2.5 - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": "|".join(batch),
                                    "prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": 1})
        req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        last = time.time()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                body = gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except urllib.error.HTTPError as e:
            print(f"births: HTTP {e.code} — stopping and keeping what was fetched")
            break
        j = json.loads(body)
        # redirects map the handle we asked for to the page we got
        asked = {}
        for rd in j.get("query", {}).get("redirects", []) or []:
            asked[rd["to"]] = rd["from"]
        for nm in j.get("query", {}).get("normalized", []) or []:
            asked[nm["to"]] = nm["from"]
        for p in j.get("query", {}).get("pages", {}).values():
            title = p.get("title", "")
            ign = asked.get(title, title)
            txt = ((p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}) or {}).get("*", "") or ""
            b = re.search(r"\|\s*birth_date\s*=\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", txt)
            name = re.search(r"\|\s*name\s*=\s*([^\n|]+)", txt)
            country = re.search(r"\|\s*country\s*=\s*([^\n|]+)", txt)
            store[ign] = {"birth": b.group(1) if b else None,
                          "real": name.group(1).strip() if name else None,
                          "country": country.group(1).strip() if country else None,
                          "page": bool(txt)}
        print(f"births: {min(i + 50, len(todo))}/{len(todo)}")
    return store


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("year", type=int)
    ap.add_argument("--fetch-births", action="store_true")
    args = ap.parse_args()
    Y = args.year
    bw.SEASON_YEAR = Y   # age_from and the recency clock read this
    cache = load(CACHE, {"events": {}, "stats": {}})
    world26 = load(WORLD_2026, {"players": [], "teams": []})
    prev_pid = {p["ign"].lower(): p["id"] for p in world26["players"]}

    def key_of(row):
        """Who a stat line is about. The handle, except where two real people
        share it (overrides.json `homonyms`): then the vlr id comes along, so
        the Polish zeek of 2023 neither pools his lines with the Canadian's
        nor takes the Canadian's id from the 2026 world."""
        ign = row["ign"].lower()
        return f"{ign}#{row.get('vlrId') or ''}" if bw.homonym(ign) else ign

    def id_from_2026(key):
        h = bw.homonym(key.split("#")[0])
        if h and key != f"{key.split('#')[0]}#{h['vlr']}":
            return None
        return prev_pid.get(key.split("#")[0])
    prev_tid = {}
    for t in world26["teams"]:
        prev_tid.setdefault(t["tag"], (t["id"], t["name"]))

    # ---- rosters: who played the opening events
    opening = opening_events(cache, Y)
    if not opening:
        sys.exit(f"no opening events cached for {Y}")
    rosters = {}   # tag -> {region, rows}
    for eid, ev, region in opening:
        for row in cache["stats"].get(eid, []):
            tag = row.get("club")
            if not tag:
                continue
            r = rosters.setdefault(tag, {"region": region, "rows": {}})
            cur = r["rows"].get(key_of(row))
            if not cur or (row.get("rnd") or 0) > (cur.get("rnd") or 0):
                r["rows"][key_of(row)] = row
    if Y == 2023:
        # ten a league. China had no league that year, so its tier one is the
        # qualifier's field: first the clubs China sent abroad (EDG and FPX to
        # LOCK//IN, EDG and ASE to Tokyo, EDG and BLG to Los Angeles), then the
        # most rounds. By rounds alone EDG was thirteenth — a club at Masters
        # plays fewer qualifier rounds — and was left out of its own year. A
        # league page that lists a stand-in side or two keeps its ten regulars
        # the same way.
        abroad = {row.get("club") for eid, ev in cache["events"].items()
                  if ev.get("year") == 2023 and (ev.get("tier") in ("masters", "champions") or "lock-in" in str(ev.get("slug") or ""))
                  for row in cache["stats"].get(eid, [])}
        for region in ("Americas", "EMEA", "Pacific", "China"):
            cn = [(tag, r) for tag, r in rosters.items() if r["region"] == region]
            cn.sort(key=lambda x: (region == "China" and x[0] not in abroad, -sum((row.get("rnd") or 0) for row in x[1]["rows"].values())))
            for tag, _ in cn[10:]:
                del rosters[tag]
    print(f"{Y}: {len(opening)} opening events, {len(rosters)} clubs")

    # ---- evidence: every line before the season, per player
    ev_rows = defaultdict(list)     # ign.lower -> [(weight, row, ev)]
    first_seen = {}
    for eid, ev in cache["events"].items():
        for row in cache["stats"].get(eid, []):
            k = key_of(row)
            y = ev.get("year") or 0
            first_seen[k] = min(first_seen.get(k, 9999), y)
            if y < Y:
                age = Y - bw.event_time(ev)
                if not top_flight(ev):
                    row = dict(row)
                    for key, f in bw.SUBTIER_TO_VCT.items():
                        src = "rating2" if key == "R" else key
                        if row.get(src) is not None:
                            row[src] = row[src] * f
                ev_rows[k].append((max(0.0, (row.get("rnd") or 0)) * bw.recency(age), row, ev))

    def aggregate(k, fallback_rows=()):
        rows = ev_rows.get(k) or [(row.get("rnd") or 0, row, None) for row in fallback_rows]
        if not rows:
            return None
        tot = sum(w for w, _, _ in rows) or 1.0
        line = {}
        for key in bw.STAT_KEYS:
            src = "rating2" if key == "R" else key
            num = den = 0.0
            for w, row, _ in rows:
                v = row.get(src)
                if v is None:
                    continue
                if key == "kast" and v > 1:
                    v /= 100
                num += v * w
                den += w
            line[key] = num / den if den else None
        line["rnd"] = sum((row.get("rnd") or 0) for _, row, _ in rows)
        line["wrnd"] = tot
        # clutch: won over faced, pulled toward the field by how few there were
        clw = sum((row.get("clw") or 0) for _, row, _ in rows)
        clt = sum((row.get("clt") or 0) for _, row, _ in rows)
        line["clw"], line["clt"] = clw, clt
        # agents, by weighted share
        use = defaultdict(float)
        for w, row, _ in rows:
            for a, share in row.get("agents") or []:
                use[a] += w * share
        line["agents"] = [a for a, _ in sorted(use.items(), key=lambda x: -x[1])]
        # the big stage against the rest of the record
        big = [(w, row) for w, row, ev in rows if ev and ev.get("tier") in ("masters", "champions")]
        bigw = sum(w for w, _ in big)
        if big and bigw:
            rb = sum((row.get("rating2") or 0) * w for w, row in big) / bigw
            line["stage_lift"] = rb / line["R"] if line.get("R") else None
            line["stage_rounds"] = sum((row.get("rnd") or 0) for _, row in big)
        return line

    # ---- the second tier: that year's Challengers opening splits, where fetched
    #
    # scripts/fetch_vlr_challengers_hist.py reads the opening split of every
    # Challengers league of the year. A club needs five men with thirty rounds
    # in it; the eight strongest per region (top-five mean rating, weighted
    # by rounds) make the tier-two league, which is the 2026 world's shape.
    # China has no Challengers split on vlr: 2023 and 2024 use the clubs of
    # the 2023 Champions China qualifier outside tier one, 2025 the clubs of
    # the 2024 China Ascension. A region with no table has no second tier.
    chal = load(CHALLENGERS, {"events": {}, "stats": {}})
    t2_rosters = {}   # tag -> {region, rows}
    t2_source = {}
    partners = set(rosters)
    for eid, ev in chal["events"].items():
        if ev.get("year") != Y:
            continue
        for row in chal["stats"].get(eid, []):
            tag = row.get("club")
            if not tag or tag in partners or (row.get("rnd") or 0) < 30:
                continue
            r = t2_rosters.setdefault(tag, {"region": ev["region"], "rows": {}, "sub": True})
            cur = r["rows"].get(key_of(row))
            if not cur or (row.get("rnd") or 0) > (cur.get("rnd") or 0):
                r["rows"][key_of(row)] = row
    if Y in (2023, 2024):
        for eid, ev in cache["events"].items():
            if ev.get("year") == 2023 and "champions-china-qualifier" in str(ev.get("slug") or ""):
                for row in cache["stats"].get(eid, []):
                    tag = row.get("club")
                    if not tag or tag in partners or (row.get("rnd") or 0) < 30:
                        continue
                    r = t2_rosters.setdefault(tag, {"region": "China", "rows": {}, "sub": True})
                    r["rows"][key_of(row)] = row
    # keep the eight strongest per region
    def club_strength(r):
        top = sorted(r["rows"].values(), key=lambda x: -(x.get("rating2") or 0))[:5]
        return sum((x.get("rating2") or 0) * (x.get("rnd") or 0) for x in top) / max(1, sum((x.get("rnd") or 0) for x in top))
    # a man on a tier-one opening roster is not also a Challengers man
    t1_men = {k for r in rosters.values() for k in r["rows"]}
    for r in t2_rosters.values():
        for k in [k for k in r["rows"] if k in t1_men]:
            del r["rows"][k]
    # ranked candidates per region; the eight strongest that can still field
    # five are taken when the clubs are built (a man who played two splits
    # belongs to the stronger club and may leave the other short)
    t2_ranked = {}
    for region in ("Americas", "EMEA", "Pacific", "China"):
        cands = [(tag, r) for tag, r in t2_rosters.items() if r["region"] == region and len(r["rows"]) >= 5]
        cands.sort(key=lambda x: -club_strength(x[1]))
        t2_ranked[region] = cands
    t2_rosters = {tag: r for cands in t2_ranked.values() for tag, r in cands}
    print(f"tier two: {sum(len(c) for c in t2_ranked.values())} Challengers candidates from the year's tables ({', '.join(f'{r}:{sum(1 for t in t2_rosters.values() if t['region'] == r)}' for r in ('Americas', 'EMEA', 'Pacific', 'China'))})")

    # ---- the population to rank: everyone on an opening roster, both tiers
    people = {}
    rookies = 0
    for tag, r in list(rosters.items()) + list(t2_rosters.items()):
        for k, row in r["rows"].items():
            if k in people:
                continue
            line = aggregate(k)
            if not line:
                line = aggregate(k, fallback_rows=[row])
                line["rookie"] = True
                rookies += 1
            if r.get("sub") or (Y == 2023 and r["region"] == "China"):
                # a Challengers line is a Challengers line: translated like the
                # sub-tier events above, whichever year it came from; so is a
                # 2023 Chinese club's, whose only evidence is the qualifier
                if line.get("rookie"):
                    for key, f in bw.SUBTIER_TO_VCT.items():
                        if line.get(key) is not None:
                            line[key] = line[key] * f
                line["tier2"] = True
            line["ign"] = row["ign"]
            line["nat"] = row.get("nat") or ""
            line["tag"] = tag
            line["region"] = r["region"]
            people[k] = line
    print(f"players: {len(people)} on opening rosters, {rookies} with no earlier VCT line (rated on the opening event, shrunk)")

    # roles from agents
    for k, line in people.items():
        roles = bw.roles_from_agents(line["agents"][:4])
        line["roles"] = roles or ["自由人"]
        line["role"] = line["roles"][0]

    # shrink toward the unproven anchor (30th percentile) by rounds. Harder
    # than build_world's 400: a start in 2024 has one or two seasons of
    # evidence behind it where 2026 has four, so a short line proves less —
    # keiko rated 87 off 165 rounds and runneR 90 off 174 at 400.
    SHRINK = 900.0
    pool = {}
    for key in bw.STAT_KEYS:
        vals = sorted(l[key] for l in people.values() if l.get(key) is not None)
        pool[key] = vals[int(len(vals) * 0.3)] if vals else None
    stat_rows = []
    for k, line in people.items():
        m = dict(line)
        rnd = m.get("rnd") or 0
        if m.get("rookie"):
            rnd = min(rnd, 100)   # an opening split is not a record
        trust = rnd / (rnd + SHRINK)
        for key in bw.STAT_KEYS:
            if m.get(key) is None or pool.get(key) is None:
                m[key] = pool.get(key)
                continue
            m[key] = m[key] * trust + pool[key] * (1 - trust)
        stat_rows.append(m)
    P = {key: bw.pctiles(stat_rows, key) for key in ("acs", "adr", "hs", "kpr", "fkpr", "kast", "apr", "R", "kd")}
    P["hs"] = bw.pctiles([{"ign": r["ign"], "hs": r.get("hs")} for r in stat_rows] if any(r.get("hs") for r in stat_rows) else stat_rows, "hs")
    P["fdpr"] = bw.pctiles(stat_rows, "fdpr", invert=True)
    P["R"] = {}
    for role in {r["role"] for r in stat_rows}:
        peers = [r for r in stat_rows if r["role"] == role]
        P["R"].update(bw.pctiles(peers if len(peers) >= 12 else stat_rows, "R"))
    # clutch percentile with a prior of twenty situations at the field mean
    tot_w = sum(l["clw"] for l in people.values())
    tot_t = sum(l["clt"] for l in people.values())
    mean_cl = tot_w / tot_t if tot_t else 0.15
    cl_rows = [{"ign": l["ign"], "clutch_pct": (l["clw"] + 20 * mean_cl) / (l["clt"] + 20)} for l in people.values() if l["clt"]]
    P["clutch_pct"] = bw.pctiles(cl_rows, "clutch_pct")
    have_cl = {r["ign"] for r in cl_rows}

    # ---- births
    births = {k.lower(): v for k, v in load(BIRTHS_2026, {}).items()}
    hist = load(BIRTHS_HIST, {})
    for k, v in hist.items():
        births.setdefault(k.lower(), v)
    missing = [l["ign"] for l in people.values() if l["ign"].lower() not in births]
    if args.fetch_births and missing:
        hist = fetch_births(missing, hist)
        os.makedirs(os.path.dirname(BIRTHS_HIST), exist_ok=True)
        json.dump(hist, open(BIRTHS_HIST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        for k, v in hist.items():
            births.setdefault(k.lower(), v)
    else:
        print(f"births: {len(missing)} players have no Liquipedia birthdate on file (pass --fetch-births)")
    DEBUT_AGE = {2020: 19, 2021: 18, 2022: 17, 2023: 17, 2024: 18, 2025: 19, 2026: 20}

    # 冠军底蕴, from the real placements in records.json for the men the 2026
    # world knows (build_world's values and fade, faded from the start year):
    # Champions 3, Masters 2, a regional title 1, two seasons full, then 2/3, 1/3.
    records = load(os.path.join(ROOT, "src", "data", "records.json"), {"events": {}, "players": {}})
    TITLE_VALUE = {"champions": 3.0, "masters": 2.0, "league": 1.0}
    TITLE_FADE = {0: 1.0, 1: 1.0, 2: 0.67, 3: 0.33}

    def title_credit(pid):
        rec = records["players"].get(pid)
        if not rec:
            return 0.0
        seen = set()
        total = 0.0
        for row in rec.get("ev") or []:
            eid, place = row[0], row[1]
            name, y = (records["events"].get(str(eid)) or [None, None])[:2]
            if place != "1st" or not name or not y or y >= Y:
                continue
            kind = ("champions" if re.match(r"^Valorant Champions \d{4}$", name)
                    else "masters" if re.search(r"Masters|LOCK//IN", name)
                    else "league" if re.search(r"^(Champions Tour \d{4}: |VCT \d{4}: )(Americas|EMEA|Pacific|China) (Stage \d|Kickoff|League)$", name) else None)
            if not kind:
                continue
            key = (y, kind) if kind != "league" else (y, kind, name)
            if key in seen:
                continue
            seen.add(key)
            total += TITLE_VALUE[kind] * TITLE_FADE.get(Y - 1 - y, 0.0)
        return min(6.0, total)

    ROLE_UTIL = {"控场": 1.0, "先锋": 0.95, "哨卫": 0.7, "自由人": 0.55, "决斗者": 0.25}
    ROLE_COMM = {"控场": 0.8, "先锋": 0.85, "哨卫": 0.6, "自由人": 0.7, "决斗者": 0.4}

    def scale(p, lo=44, hi=98):
        return int(round(bw.clamp(lo + (hi - lo) * p, 20, 99)))

    def axis(specific, quality):
        return 0.58 * specific + 0.42 * quality

    built = {}
    ages_known = 0
    wrong = 0
    for k, line in people.items():
        ign = line["ign"]
        rng = bw.Rng(bw.seed_of(f"h{Y}:" + ign))
        g = lambda key: P[key].get(ign, 0.5)  # noqa: E731
        q = g("R")
        role = line["role"]
        a = {
            "aim": scale(axis(0.5 * g("acs") + 0.3 * g("adr") + 0.2 * g("hs"), q)),
            "reaction": scale(axis(0.55 * g("fkpr") + 0.3 * g("kpr") + 0.15 * g("acs"), q)),
            "awareness": scale(axis(0.5 * g("kast") + 0.35 * g("fdpr") + 0.15 * q, q)),
            "utility": scale(axis(0.55 * g("apr") + 0.45 * ROLE_UTIL[role], q)),
            "clutch": scale(axis(0.5 * g("clutch_pct") + 0.3 * q + 0.2 * g("kd"), q)) if ign in have_cl
            else scale(axis(0.6 * q + 0.4 * g("kd"), q)),
            "teamwork": scale(axis(0.5 * g("kast") + 0.5 * g("apr"), q)),
            "communication": scale(axis(0.55 * g("kast") + 0.45 * ROLE_COMM[role], q)),
            "igl": scale(axis(0.4 * g("apr") + 0.3 * g("kast") + 0.3 * ROLE_COMM[role], q), 35, 84),
        }
        w = bw.ROLE_WEIGHT.get(role, bw.ATTR_WEIGHT)
        ovr = sum(a[key] * w.get(key, bw.ATTR_WEIGHT[key]) for key in bw.ATTRS)
        lift, big = line.get("stage_lift"), line.get("stage_rounds") or 0
        stage_w = big / (big + SHRINK)
        stage_bonus = round(bw.clamp((lift - 1) * 26 * stage_w, -4, 5), 2) if lift else 0.0
        stage_bonus = round(stage_bonus + title_credit(id_from_2026(k) or ""), 2)
        ovr = int(round(bw.clamp(ovr + stage_bonus, 30, 97)))

        lp = births.get(ign.lower()) or {}
        if lp and lp.get("country") and not bw.same_person(lp, line["nat"]):
            wrong += 1
            lp = {}
        age = bw.age_from(lp.get("birth"))
        estimated = age is None
        if estimated:
            drawn = int(bw.clamp(round(rng.norm(23.2, 2.7)), 17, 33))
            debut = first_seen.get(k)
            age = DEBUT_AGE.get(debut, 18) + (Y - debut) if debut and debut <= Y else drawn
        else:
            ages_known += 1
        age = int(bw.clamp(age, 15, 40))
        head = (rng.range(7, 16) if age <= 20 else rng.range(3, 10) if age <= 23
                else rng.range(1, 5) if age <= 26 else rng.range(0, 2))
        built[k] = {
            "_key": k,
            "ign": ign, "tag": line["tag"], "region": line["region"], "nat": line["nat"],
            "role": role, "roles": line["roles"], "flex": len(line["roles"]) > 1,
            "traits": bw.traits_for(g),
            "realName": (lp.get("real") if str(lp.get("real") or "").lower() != ign.lower() else None) or None,
            "birth": lp.get("birth") if not estimated else None,
            "age": age, "ageEstimated": estimated,
            "attrs": a, "overall": ovr, "stageBonus": stage_bonus,
            "potential": int(bw.clamp(round(ovr + head), ovr, 99)),
            "form": int(bw.clamp(round(rng.norm(70, 8)), 45, 95)),
            "morale": int(bw.clamp(round(rng.norm(75, 8)), 45, 98)),
            "fatigue": int(bw.clamp(round(rng.range(0, 20)), 0, 100)),
            "loyalty": int(bw.clamp(round(rng.norm(60, 16)), 15, 95)),
            "ambition": int(bw.clamp(round(rng.norm(62, 15)), 15, 98)),
            "rounds": int(line.get("rnd") or 0),
            "agentPool": [x.title() if x != "kayo" else "KAY/O" for x in line["agents"][:6]],
            "agentUse": {x: 1 for x in line["agents"][:6]},
            "vlr": {"rating": round(line["R"], 2) if line.get("R") else None, "acs": round(line["acs"]) if line.get("acs") else None, "rounds": int(line.get("rnd") or 0)},
            "rookie": bool(line.get("rookie")),
        }
    print(f"ages: {ages_known}/{len(built)} real birthdates, {wrong} Liquipedia pages refused on nationality")

    # ---- who coached whom: Liquipedia's participant cards for the opening
    # event, matched to a vlr roster by three shared names; the head coach is
    # the one marked head coach, else the plain "coach" (older cards carry
    # no position); vlr's staff careers cover a club the cards leave blank
    staff = load(STAFF, {})
    cards = []
    for title, page in staff.items():
        if page.get("year") == Y:
            cards.extend(page.get("teams") or [])
    careers = load(COACH_CAREERS, {})

    def head_of(card):
        st = card.get("staff") or []
        pick = next((s for s in st if "head" in s["pos"]), None) \
            or next((s for s in st if s["pos"] in ("coach", "") and "assistant" not in s["pos"]), None)
        if not pick:
            return None, []
        rest = [s["name"] for s in st if s is not pick and ("coach" in s["pos"] or s["pos"] == "")]
        return pick["name"], rest

    def coach_for(tag, display, roster_igns):
        low = {i.lower() for i in roster_igns}
        best, shared = None, 0
        for c in cards:
            n = len({p.lower() for p in c["players"] + c.get("subs", [])} & low)
            if n > shared:
                best, shared = c, n
        if best and shared >= 3:
            name, rest = head_of(best)
            if name:
                return name, rest, "liquipedia"
        # vlr's staff pages: a stint at this club that covers the January
        for name, rec in careers.items():
            for s in rec.get("stints") or []:
                team = str(s.get("team") or "").lower()
                if not (display.lower() in team or team in display.lower()):
                    continue
                if (s.get("from") or "9999") <= f"{Y}-01" and (not s.get("to") or s["to"] >= f"{Y}-01") \
                        and (s.get("role") or "coach") in ("head coach", "coach"):
                    return name, [], "vlr"
        return None, [], None

    # ---- clubs
    out_players, out_teams = [], []
    issued_h = 0
    team_ids = set()
    coached = {"liquipedia": 0, "vlr": 0}

    emitted = set()

    def emit(p, team_id, tier, region):
        nonlocal issued_h
        emitted.add(p["_key"])
        pid = id_from_2026(p["_key"])
        if not pid and "#" in p["_key"]:
            # a homonym's other man gets an id of his own that names him, so
            # the numbered ids of everyone after him stay where saves have them
            pid = "H-" + p["_key"].replace("#", "-")
        if not pid:
            pid = f"H{issued_h}"
            issued_h += 1
        rec = {
            "id": pid, "ign": p["ign"], "teamId": team_id, "region": region,
            "nat": p["nat"], "realName": p["realName"], "birth": p["birth"], "joined": None,
            "rounds": p["rounds"], "role": p["role"], "roles": p["roles"], "flex": p["flex"],
            "traits": p["traits"], "agentPool": p["agentPool"], "roleSource": "agents",
            "age": p["age"], "ageEstimated": p["ageEstimated"], "isIgl": False,
            "attrs": dict(p["attrs"]), "overall": p["overall"], "stageBonus": p["stageBonus"],
            "potential": p["potential"], "form": p["form"], "morale": p["morale"], "fatigue": p["fatigue"],
            "salary": bw.salary_for(p["overall"], tier), "value": bw.value_for(p["overall"], p["age"], p["potential"]),
            "contractYears": 0, "loyalty": p["loyalty"], "ambition": p["ambition"], "vlr": p["vlr"],
            "agentUse": p["agentUse"],
        }
        if tier == 2:
            rec["_t2"] = True
        out_players.append(rec)
        return rec

    short = []
    for tag, r in sorted(rosters.items()):
        squad_src = sorted((built[k] for k in r["rows"] if k in built), key=lambda x: -(x["vlr"]["rating"] or 0))
        if len(squad_src) < 5:
            short.append(f"{tag}({len(squad_src)})")
            continue
        tid, name = prev_tid.get(tag, (None, None))
        if not tid or tid in team_ids:
            tid = f"HT{len([t for t in out_teams if t['id'].startswith('HT')])}"
        team_ids.add(tid)
        display = name or NAMES.get(tag, tag)
        squad = [emit(p, tid, 1, r["region"]) for p in squad_src[:7]]
        bw.deal_contract_years(squad)
        # a caller: the most support-shaped man, flagged inferred
        igl = max(squad[:5], key=lambda p: p["attrs"]["igl"] + (7 if p["role"] in ("控场", "哨卫", "先锋") else 0))
        igl["isIgl"] = True
        igl["iglSource"] = "inferred"
        igl["attrs"]["igl"] = int(bw.clamp(igl["attrs"]["igl"] + 12, 40, 99))
        top5 = sorted((p["overall"] for p in squad), reverse=True)[:5]
        level = sum(top5) / len(top5)
        igl["attrs"]["igl"] = int(bw.clamp(max(igl["attrs"]["igl"], round(level)), 40, 96))
        igl["attrs"]["communication"] = int(bw.clamp(igl["attrs"]["communication"] + 4, 25, 99))
        igl["overall"] = int(round(bw.clamp(sum(igl["attrs"][k] * bw.ROLE_WEIGHT.get(igl["role"], bw.ATTR_WEIGHT)[k] for k in bw.ATTRS) + igl["stageBonus"], 30, 97)))
        for p in squad:
            p["potential"] = int(bw.clamp(max(p["potential"], p["overall"]), 30, 99))
        rating = int(round(sum(sorted((p["overall"] for p in squad), reverse=True)[:5]) / 5))
        rng = bw.Rng(bw.seed_of(f"ht{Y}:" + display))
        cname, assistants, via = coach_for(tag, display, [p["ign"] for p in squad])
        coach = None
        if cname:
            coached[via] += 1
            coach = {
                "name": cname, "assistants": assistants,
                "tactics": int(bw.clamp(round(rng.norm(rating - 6, 6)), 35, 95)),
                "development": int(bw.clamp(round(rng.norm(rating - 8, 7)), 30, 95)),
                "motivation": int(bw.clamp(round(rng.norm(rating - 7, 7)), 30, 95)),
            }
        out_teams.append({
            "id": tid, "name": display, "tag": tag, "region": r["region"], "tier": 1,
            "league": f"VCT {r['region']}", "rating": rating,
            "budget": int(rng.range(2_000_000, 8_500_000)),
            "reputation": int(bw.clamp(round(rating), 20, 99)),
            "roster": [p["id"] for p in squad], "coach": coach,
            "facilities": int(bw.clamp(round(rng.norm(rating - 5, 8)), 20, 94)),
        })
    if short:
        print(f"clubs short of five on the opening event: {', '.join(short)}")

    # ---- the second tier: the year's real Challengers clubs where the tables
    # were fetched, the 2026 placeholder for a region they were not
    placed = emitted
    t2_players = 0
    real_t2_regions = set()
    t2_built = 0
    for region, cands in t2_ranked.items():
        filled = 0
        for tag, r in cands:
            if filled >= 8:
                break
            squad_src = sorted((built[k] for k in r["rows"] if k in built and k not in placed), key=lambda x: -(x["vlr"]["rating"] or 0))
            if len(squad_src) < 5:
                continue
            filled += 1
            t2_built += 1
            real_t2_regions.add(region)
            tid, name = prev_tid.get(tag, (None, None))
            if not tid or tid in team_ids:
                tid = f"HT{len([t for t in out_teams if t['id'].startswith('HT')])}"
            team_ids.add(tid)
            display = name or NAMES.get(tag, tag)
            squad = [emit(p, tid, 2, r["region"]) for p in squad_src[:7]]
            bw.deal_contract_years(squad)
            igl = max(squad[:5], key=lambda p: p["attrs"]["igl"] + (7 if p["role"] in ("控场", "哨卫", "先锋") else 0))
            igl["isIgl"] = True
            igl["iglSource"] = "inferred"
            rating = int(round(sum(sorted((p["overall"] for p in squad), reverse=True)[:5]) / 5))
            rng = bw.Rng(bw.seed_of(f"ht{Y}:" + display))
            out_teams.append({
                "id": tid, "name": display, "tag": tag, "region": r["region"], "tier": 2,
                "league": f"Challengers {r['region']}", "rating": rating,
                "budget": int(rng.range(240_000, 900_000)),
                "reputation": int(bw.clamp(round(rating * 0.72), 20, 99)),
                "roster": [p["id"] for p in squad], "coach": None,
                "facilities": int(bw.clamp(round(rng.norm(rating - 18, 8)), 20, 94)),
            })
            t2_players += len(squad)
    # A region without a table of its own gets no second tier. It used to
    # borrow 2026's Challengers clubs with the ages wound back, which put
    # clubs that did not exist yet (ODG in 2023) into a year they never
    # played; fewer clubs beats invented ones (2026-09-14).
    # ---- one scale with 2026. The percentiles above rank the year's 220-odd
    # tier-one men among themselves and stretch them over 44–98, while the
    # 2026 world ranks its tier-one men inside a pool of ~800 that includes
    # every Challengers line, so its median tier-one player sits at 80 and
    # this one at 73 — and the carried-over 2026 Challengers clubs would
    # have out-rated half of this year's VCT. So the year's tier-one
    # overalls are matched quantile for quantile onto 2026's tier-one
    # distribution (the ORDER is the year's own; only the ruler is 2026's),
    # attributes scaled with the overall, potential shifted by the same amount.
    t1_ids = {t["id"] for t in out_teams if t["tier"] == 1}
    ref26 = sorted(p["overall"] for p in world26["players"]
                   if p.get("teamId") in {t["id"] for t in world26["teams"] if t["tier"] == 1})
    mine = sorted((p for p in out_players if p["teamId"] in t1_ids), key=lambda p: (p["overall"], p["vlr"]["rating"] or 0))
    if ref26 and mine:
        n = len(mine)
        med26 = ref26[len(ref26) // 2]
        for i, p in enumerate(mine):
            target = ref26[min(len(ref26) - 1, int(round(i / max(1, n - 1) * (len(ref26) - 1))))]
            # the upper half is pulled in by a fifth: two seasons of evidence
            # do not separate a 95 from a 90 the way four do, and the owner
            # read the first cut — 27 men at 90+ in January 2024 — as too many
            if target > med26:
                target = med26 + (target - med26) * 0.8
            raw = p["overall"] - p["stageBonus"]
            if raw <= 0:
                continue
            p["_raw"] = p["overall"]
            factor = (target - p["stageBonus"]) / raw
            for k in bw.ATTRS:
                p["attrs"][k] = int(bw.clamp(round(p["attrs"][k] * factor), 20, 99))
            w = bw.ROLE_WEIGHT.get(p["role"], bw.ATTR_WEIGHT)
            new = int(round(bw.clamp(sum(p["attrs"][k] * w.get(k, bw.ATTR_WEIGHT[k]) for k in bw.ATTRS) + p["stageBonus"], 30, 97)))
            p["potential"] = int(bw.clamp(p["potential"] + (new - p["overall"]), new, 99))
            p["overall"] = new
            p["salary"] = bw.salary_for(new, 1)
            p["value"] = bw.value_for(new, p["age"], p["potential"])
        # The year's tier-two men are ranked among themselves and placed on
        # 2026's own tier-two ruler (median 67, top 88). Rated through the
        # tier-one ruler they came out too high: the South Asia and Oceania
        # splits are enormous events whose leaders keep a thousand rounds,
        # and the flat Challengers → VCT factor (measured on the men who got
        # called up) leaves them at 88 — RNTX rated 78, a tier-one median club.
        ref26_t2 = sorted(p["overall"] for p in world26["players"]
                          if p.get("teamId") in {t["id"] for t in world26["teams"] if t["tier"] == 2})
        t2_men = sorted((p for p in out_players if p.get("_t2")), key=lambda p: (p["overall"], p["vlr"]["rating"] or 0))
        m2 = len(t2_men)
        for i, p in enumerate(t2_men):
            new = ref26_t2[min(len(ref26_t2) - 1, int(round(i / max(1, m2 - 1) * (len(ref26_t2) - 1))))] if ref26_t2 else p["overall"]
            factor = new / max(1, p["overall"])
            for k in bw.ATTRS:
                p["attrs"][k] = int(bw.clamp(round(p["attrs"][k] * factor), 20, 99))
            p["potential"] = int(bw.clamp(p["potential"] + (new - p["overall"]), new, 99))
            p["overall"] = new
            p["salary"] = bw.salary_for(new, 2)
            p["value"] = bw.value_for(new, p["age"], p["potential"])
        for t in out_teams:
            ovrs = sorted((p["overall"] for p in out_players if p["teamId"] == t["id"]), reverse=True)[:5]
            if not ovrs:
                continue
            t["rating"] = int(round(sum(ovrs) / len(ovrs)))
            t["reputation"] = int(bw.clamp(round(t["rating"] * (1.0 if t["tier"] == 1 else 0.72)), 20, 99))
        for p in out_players:
            p.pop("_raw", None)
            p.pop("_t2", None)
        med = mine[len(mine) // 2]["overall"]
        print(f"scale: tier-one overalls matched to 2026's distribution (median now {med}, 2026's {ref26[len(ref26) // 2]})")

    print(f"coaches: {coached['liquipedia']} from Liquipedia cards, {coached['vlr']} from vlr staff pages, "
          f"{sum(1 for t in out_teams if t['tier'] == 1 and not t['coach'])} tier-one clubs without one")
    t1 = [t for t in out_teams if t["tier"] == 1]
    by_region = defaultdict(int)
    for t in t1:
        by_region[t["region"]] += 1
    world = {
        "meta": {
            "season": Y, "historical": True,
            "openingEvents": [ev.get("slug") for _, ev, _ in opening],
            "tier2": "the year's own Challengers clubs where a table exists (vlr opening splits; China from the 2023 qualifier or the 2024 Ascension); none where it does not",
            "sources": {"vlr.gg": "rosters from the opening events, all performance stats", "liquipedia": "birthdates, real names"},
            "derived": "attributes percentile-mapped from real per-round statistics of the seasons before the start",
            "everyoneReal": True,
            "regions": sorted(by_region),
        },
        "teams": out_teams,
        "players": out_players,
    }
    out = os.path.join(ROOT, "src", "data", f"world_{Y}.json")
    json.dump(world, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    t2_by_region = defaultdict(int)
    for t in out_teams:
        if t["tier"] == 2:
            t2_by_region[t["region"]] += 1
    print(f"teams {len(out_teams)} (T1 {len(t1)}: {dict(by_region)}, T2 {t2_built}: {dict(t2_by_region)})")
    print(f"players {len(out_players)} ({len(out_players) - t2_players} tier one, {issued_h} new H-ids, {t2_players} tier two)")
    top = sorted((p for p in out_players if p["teamId"] and any(t["id"] == p["teamId"] and t["tier"] == 1 for t in out_teams)), key=lambda p: -p["overall"])[:12]
    print("top: " + ", ".join(f"{p['ign']}({p['overall']})" for p in top))
    print(f"→ {out} {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
