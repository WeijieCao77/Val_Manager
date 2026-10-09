#!/usr/bin/env python3
"""Dated, sourced coach tenure table for the v16 coach rating (cache only, no network).

Who: every coach in src/data/coach_career_ratings.json, every head coach / assistant /
analyst in src/data/world.json, and data-raw/overrides.json `nowCoach`. One entry per real
person, keyed by vlr id when known, else by the normalised handle.

Sources, walked vlr -> Liquipedia -> 号角 (the owner's rule: never drop a person because one
site lacks the record; every stint records the site it came from):
  vlr         newest cached snapshot of the person's vlr page: raw HTML kept by
              scripts/fetch_coach_rebuild.py (analysis/coach_rebuild/http, 2026-10-06) >
              scripts/cache/vlr_people.json (2026-09-18) > scripts/cache/vlr_coach_careers.json
              (2026-09-10). Its `_unconfirmed` candidates are never used.
  liquipedia  scripts/cache/liquipedia_coach_tenure.json (TeamHistoryAuto, day precision) and
              scripts/cache/liquipedia_event_staff.json (who sat on a team's staff at one VCT
              event: event-scoped, never stretched into a tenure).
  haojiao     data-raw/haojiao_coaches.json (号角, months).
  Codex       analysis/coach_career_v3/user_confirmed_stints.json is authoritative;
              tenure_corrections.json and analysis/coach_rebuild/*profiles.json are candidate
              evidence, used only where they agree with a site (the profiles are vlr pages,
              re-parsed here from the cached raw HTML).
  current     scripts/cache/vlr_staff.json (vlr team pages, 2026-08-28), world.json rosters,
              overrides.json `coaches` / `nowCoach` / dated `_coach_note` facts.

Rules: day precision when a source has it; a month-only start is the 1st, a month-only end
the LAST day of that month. The same club on two sites is one spell, the union of the
windows (a day-precise date beats a month-only one in the same month). An open past stint
ends where the person's next stint begins; a current stint ends at AS_OF. Roles normalise to
head / assistant / analyst / other; player stints are kept apart in `playerStints`.

Writes ONLY analysis/rating/history_v16/coach_tenures.json and coach_tenures.md.
Usage: python3 scripts/rating/coach_tenure_v16.py
"""
from __future__ import annotations

import calendar
import collections
import hashlib
import html as htmllib
import json
import re
import unicodedata
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "analysis/rating/history_v16"
OUT_JSON = OUT_DIR / "coach_tenures.json"
OUT_MD = OUT_DIR / "coach_tenures.md"
AS_OF = date(2026, 10, 9)
TOL = timedelta(days=15)        # handover slack when two windows of one club touch
EVENT_TOL = timedelta(days=31)  # an event appearance this close to a tenure belongs to it
CONFLICT_DAYS = 92              # "> 3 months"

# Snapshot dates of the caches (hard-coded so a checkout's mtimes don't move them).
SNAP = {
    "vlr_staff": "2026-08-28",
    "vlr_people": "2026-09-18",
    "liquipedia_coach_tenure": "2026-09-10",
    "liquipedia_event_staff": "2026-09-14",
    "haojiao": "2026-09-10",
    "world": "2026-10-03",
    "overrides": "2026-10-09",
}
SITE_FAMILIES = ("vlr", "liquipedia", "haojiao")

# ---------------------------------------------------------------- helpers

def read(rel):
    return json.loads((ROOT / rel).read_text("utf-8"))


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def strip_tags(s):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", "", str(s or "")))).strip()


CYRILLIC = str.maketrans("АВСЕНКМОРТХасеорху", "ABCEHKMOPTXaceopxy")  # vlr's 'CrowСrowd'
SUFFIX = re.compile(r"\b(esports?|e-sports?|gaming|club|team|gg|esport club|electronic sport club)\b")


def club_key(name):
    """Normalised club name: no html, no '(Chinese team)', no Esports/Gaming/Team words."""
    s = strip_tags(name).translate(CYRILLIC)
    s = re.sub(r"\((?:[^)]*\bteam|ex-[^)]*)\)", "", s, flags=re.I)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s2 = SUFFIX.sub(" ", s)
    k = re.sub(r"[^a-z0-9]", "", s2)
    return k or re.sub(r"[^a-z0-9]", "", s)


def d(s):
    return date.fromisoformat(s) if s else None


def iso(x):
    return x.isoformat() if x else None


def month_start(y, m):
    return date(y, m, 1)


def month_end(y, m):
    return date(y, m, calendar.monthrange(y, m)[1])


def parse_point(raw, end=False):
    """'2024-03-14' -> (date, 'day'); '2024-03' or '2024-03-??' -> 1st / last day, 'month'."""
    if not raw:
        return None, None
    m = re.match(r"^(\d{4})-(\d{2})(?:-(\d{2}|\?\?))?$", str(raw).strip())
    if not m:
        return None, None
    y, mo, dd = int(m.group(1)), int(m.group(2)), m.group(3)
    if dd and dd != "??":
        return date(y, mo, int(dd)), "day"
    return (month_end(y, mo) if end else month_start(y, mo)), "month"


MONTHS = {n: i for i, n in enumerate(calendar.month_name) if n}


def vlr_month(text):
    m = re.search(r"([A-Za-z]+)\s+(\d{4})", text or "")
    if not m or m.group(1) not in MONTHS:
        return None
    return f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"


def vlr_when(when):
    """vlr 'when' line -> (from_month, to_month)."""
    if not when:
        return None, None
    w = when.strip()
    if w.startswith("joined in"):
        return vlr_month(w), None
    if w.startswith("left in"):
        return None, vlr_month(w)
    if "–" in w or " - " in w:
        a, _, b = re.split(r"\s*(–|-)\s*", w, maxsplit=1)
        return vlr_month(a), (None if "present" in b.lower() else vlr_month(b))
    return None, None


# National sides are concurrent with club work: they never close an open club stint.
NATIONAL = {norm(x) for x in """Argentina Australia Austria Belgium Brazil Bulgaria Cambodia Canada Chile China
Chinese-Taipei Colombia Croatia Czechia Denmark Egypt Estonia Finland France Germany Greece Hong-Kong India
Indonesia Iran Ireland Israel Italy Japan Jordan Kazakhstan Korea South-Korea Kuwait Latvia Lebanon Lithuania
Malaysia Mexico Mongolia Morocco Netherlands New-Zealand Norway Pakistan Peru Philippines Poland Portugal Qatar
Romania Russia Saudi-Arabia Serbia Singapore Slovakia Slovenia Spain Sweden Switzerland Taiwan Thailand Tunisia
Turkey Turkiye Ukraine United-Arab-Emirates United-Kingdom United-States USA Uruguay Vietnam Team-CIS""".split()}


def is_national(team):
    return norm(team) in NATIONAL


# ---------------------------------------------------------------- roles

def role_of(raw, site):
    """-> (role, explicit, kind, flag). kind is 'coach' or 'player'."""
    r = (raw or "").strip()
    low = r.lower()
    if site == "haojiao":
        table = {"主教练": ("head", True), "助理教练": ("assistant", True), "战术教练": ("assistant", True),
                 "教练": ("assistant", False), "分析师": ("analyst", True)}
        if r in table:
            return (*table[r], "coach", None)
        return "other", True, "coach", f"haojiao role {r!r}"
    if not low:
        if site == "liquipedia-event":
            return "assistant", False, "coach", "event staff listed without a position"
        return None, False, "player", "untagged (player row)"
    if low == "head coach":
        return "head", True, "coach", None
    if low in ("coach",):
        return "assistant", False, "coach", None
    if low in ("assistant coach", "associate coach", "strategic coach", "tactics coach", "tactical coach"):
        return "assistant", True, "coach", None
    if low == "strategic coach/analyst":
        return "assistant", True, "coach", "strategic coach/analyst"
    if low == "trial coach":
        return "assistant", False, "coach", "trial coach"
    if low in ("analyst", "data analyst", "performance coach"):
        return "analyst", True, "coach", (None if low == "analyst" else low)
    if low == "inactive coach":
        return None, True, "coach", "inactive coach"
    if low in ("manager", "staff", "team manager", "general manager"):
        return "other", True, "coach", low
    # player rows: Inactive / Substitute / Trial / Streamer / sub / stand-in / loan
    return None, False, "player", low


# ---------------------------------------------------------------- load

ratings = read("src/data/coach_career_ratings.json")["coaches"]
world = read("src/data/world.json")
overrides = read("data-raw/overrides.json")
vlr_careers = read("scripts/cache/vlr_coach_careers.json")
vlr_people = read("scripts/cache/vlr_people.json")
vlr_staff = read("scripts/cache/vlr_staff.json")
lp_tenure = read("scripts/cache/liquipedia_coach_tenure.json")
lp_events = read("scripts/cache/liquipedia_event_staff.json")
haojiao = read("data-raw/haojiao_coaches.json")["coaches"]
profiles = {**read("analysis/coach_rebuild/profiles.json"), **read("analysis/coach_rebuild/active_profiles.json")}
corrections = read("analysis/coach_career_v3/tenure_corrections.json")
user_confirmed = read("analysis/coach_career_v3/user_confirmed_stints.json")
events = read("analysis/rating/history_v16/events.json")
ledger = read("analysis/rating/career_history_v8/merged_international_ledger.json")
dossier_coaches = read("src/data/dossier.json").get("coaches", {})
HTTP = ROOT / "analysis/coach_rebuild/http"

# Liquipedia event pages -> vlr event ids in events.json (dates come from there)
LP_EVENT_IDS = {
    "VCT/2023/LOCK IN São Paulo": "1188", "VCT/2023/Americas League": "1189",
    "VCT/2023/EMEA League": "1190", "VCT/2023/Pacific League": "1191",
    "VCT/2023/Champions/China Qualifier": "1664", "VCT/2023/China Qualifier": None,
    "VCT/2024/Americas League/Kickoff": "1923", "VCT/2024/Pacific League/Kickoff": "1924",
    "VCT/2024/EMEA League/Kickoff": "1925", "VCT/2024/China League/Kickoff": "1926",
    "VCT/2025/Americas League/Kickoff": "2274", "VCT/2025/China League/Kickoff": "2275",
    "VCT/2025/EMEA League/Kickoff": "2276", "VCT/2025/Pacific League/Kickoff": "2277",
}

# Dated facts the owner verified and wrote into overrides.json `_coach_note` (with their
# vlr transaction / weibo citations). Recorded as site 'owner-note'.
OWNER_NOTES = [
    {"handle": "24K", "team": "Nova Esports", "teamId": "12064", "role": "head coach", "from": "2026-06-10",
     "to": None, "current": True,
     "ref": "overrides.json _coach_note; https://www.vlr.gg/team/transactions/12064/nova-esports/"},
    {"handle": "alexRr", "team": "Nova Esports", "teamId": "12064", "role": None, "from": None,
     "to": "2026-05-19", "current": False, "endOnly": True,
     "ref": "overrides.json _coach_note; https://www.vlr.gg/team/transactions/13790/wolves-esports/"},
]

# Alias table: short names / renamed clubs -> the canonical name the indexes know. Resolved
# through the indexes (never a hand-typed id), so a wrong guess shows up as unmapped.
ALIASES = {
    "XLG": "Xi Lai Gaming", "XLG Esports": "Xi Lai Gaming",
    "NTER": "Shenzhen NTER", "NTER (Chinese team)": "Shenzhen NTER",
    "Bilibili Gaming": "Guangzhou Huadu Bilibili Gaming", "BLG": "Guangzhou Huadu Bilibili Gaming",
    "FPX": "FunPlus Phoenix", "EDG": "EDward Gaming", "TEC": "Titan Esports Club",
    "DRX": "KIWOOM DRX", "VS": "Vision Strikers", "GEN": "Gen.G", "Gen.G Esports": "Gen.G",
    "T1 Korea": "T1", "Leviatán Esports": "LEVIATÁN", "Leviatán": "LEVIATÁN", "LEV": "LEVIATÁN",
    "GIA": "Giants Gaming", "Giants": "Giants Gaming", "Fnatic": "FNATIC", "FNC": "FNATIC",
    "OPTC": "OpTic Gaming", "C9 KR": "Cloud9 Korea", "RRQ": "Rex Regum Qeon",
    "DFM": "DetonatioN FocusMe", "Detonation FocusMe": "DetonatioN FocusMe",
    "TYL": "TYLOO", "WOL": "Wolves Esports", "JDG": "JD Gaming", "TE": "Trace Esports",
    "NOVA": "Nova Esports", "100T": "100 Thieves", "C9": "Cloud9", "EG": "Evil Geniuses",
    "TH": "Team Heretics", "TL": "Team Liquid", "TS": "Team Secret", "VIT": "Team Vitality",
    "KC": "Karmine Corp", "NAVI": "Natus Vincere", "SEN": "Sentinels", "TLN": "TALON",
    "FS": "FULL SENSE", "GE": "Global Esports", "GX": "GIANTX", "M8": "Gentle Mates",
    "ZETA": "ZETA DIVISION", "NS": "Nongshim RedForce", "TUN": "Tundra Esports",
    "GLD": "Guild Esports", "OXG": "Oxygen Esports", "BBL": "BBL Esports", "FUT": "FUT Esports",
    "KRÜ": "KRÜ Esports", "EF": "Eternal Fire", "ULF": "ULF Esports", "FNST": "Finest",
    "Team Finest": "Finest", "BONK": "bonk", "beGenius ESC": "beGenius",
    "BeGenius Electronic Sport Club": "beGenius", "CC": "CrowCrowd", "RNG": "Royal Never Give Up",
    "DRG": "Dragon Ranger Gaming", "WSIG": "World Sports Invictus Gaming", "ALG": "Ambitious Legend Gaming",
    "AQ": "Any Questions Gaming", "UR": "Unsettled Resentment", "ODG": "Octagonal Disposition Gaming",
    "OD Gaming": "Octagonal Disposition Gaming", "KBG": "KeepBest Gaming", "A Team": "A Team",
    "MIBR": "MIBR", "FURIA Esports": "FURIA", "2GAME Esports": "2Game Esports",
    "CASE": "Case Esports", "WBG": "Weibo Gaming", "LEV.AC": "Leviatán Academy", "SAD": "SaD Esports",
}

# ---------------------------------------------------------------- team index

name_ids = collections.defaultdict(collections.Counter)   # club_key -> Counter(vlr id)
id_names = collections.defaultdict(collections.Counter)   # vlr id -> Counter(display name)
id_span = {}                                              # vlr id -> [first seen, last seen]


def index(name, tid, w=1, f=None, t=None):
    if not name or not tid:
        return
    name = strip_tags(name)
    tid = str(tid)
    name_ids[club_key(name)][tid] += w
    id_names[tid][name] += w
    for x in (f, t):
        if x:
            sp = id_span.setdefault(tid, [x, x])
            sp[0], sp[1] = min(sp[0], x), max(sp[1], x)


def _m(raw, end=False):
    return parse_point(raw, end)[0]


for v in vlr_people.values():
    for cur, lst in ((True, v.get("current") or []), (False, v.get("past") or [])):
        for t in lst:
            f, to = vlr_when(t.get("when"))
            index(t.get("name"), t.get("id"), 1, _m(f), AS_OF if cur else _m(to, True))
for k, v in vlr_careers.items():
    if k.startswith("_"):
        continue
    for s in v.get("stints", []):
        index(s.get("team"), s.get("vlrTeamId"), 1, _m(s.get("from")), AS_OF if s.get("current") else _m(s.get("to"), True))
for v in profiles.values():
    for s in v.get("stints") or []:
        index(s.get("team"), s.get("vlrTeamId"), 1, _m(s.get("from")), AS_OF if s.get("current") else _m(s.get("to"), True))
for e in events.values():
    for s in e.get("standings") or []:
        index(s.get("team"), s.get("teamId"), 3, d(e.get("start")), d(e.get("end")))
for row in ledger:
    index(row.get("team_name"), row.get("team_id"), 3, d(row.get("date")), d(row.get("end")))
WORLD_TEAM_VLR = {}
for t in world["teams"]:
    tid = vlr_staff["teams"].get(t["id"])
    WORLD_TEAM_VLR[t["id"]] = tid
    if tid:
        index(t["name"], tid, 5, AS_OF, AS_OF)
        index(t["tag"], tid, 2, AS_OF, AS_OF)
ALIAS_LOG = []
for alias, canon in ALIASES.items():
    c = name_ids.get(club_key(canon))
    if c and club_key(alias) != club_key(canon):
        for tid, w in c.items():
            name_ids[club_key(alias)][tid] += w
    elif not c:
        ALIAS_LOG.append(f"{alias} -> {canon}: canonical name not in any index")

DATE_CHOICES = []   # (name, window, chosen, candidates) when one name carries several vlr ids


def pick(cands, f, t, label):
    """cands: Counter(id -> weight). Several vlr ids behind one name (G2 2020 vs G2 2023, FPX EU vs CN):
    take the id seen in the window of the stint; else the nearest; else the most cited."""
    if len(cands) == 1:
        return next(iter(cands))
    f = f or t
    t = t or f
    def score(tid):
        sp = id_span.get(tid)
        if not sp or not f:
            return (0, -10 ** 6, cands[tid])
        ov = overlap_days(f, t, sp[0], sp[1])
        gap = 0 if ov else min(abs((f - sp[1]).days), abs((sp[0] - t).days))
        return (ov, -gap, cands[tid])
    best = max(cands, key=score)
    if best != cands.most_common(1)[0][0] or not f:
        DATE_CHOICES.append((label, f"{iso(f)}..{iso(t)}", best, dict(cands)))
    return best


def global_team_id(names, f=None, t=None):
    for n in names:
        if not n:
            continue
        c = name_ids.get(club_key(n))
        if c:
            return pick(c, f, t, strip_tags(n)), "index"
    return None, None


# ---------------------------------------------------------------- people

homonyms = overrides.get("homonyms", {})
# vlr ids that are NOT the coach behind a handle (the other man of a homonym pair)
NOT_HIM = collections.defaultdict(set)
for h, v in homonyms.items():
    NOT_HIM[norm(h)].add(str(v.get("vlr")))
    if v.get("other"):
        NOT_HIM[norm(h)].add(str(v["other"].get("vlr")))
# overrides _nowCoach_note: the GE player Autumn is Kale Dunne (vlr 872), not EDG's coach;
# RA's Thai player Potter (vlr 23930) is not EG's Christine Chi (vlr 3104).
NOT_HIM["autumn"].add("872")
NOT_HIM["potter"].add("23930")
LP_IS_OTHER = {norm(h) for h, v in homonyms.items() if v.get("lpIs")}

people = {}  # handle key -> record


def person(name):
    k = norm(name)
    if k not in people:
        people[k] = {"handle": k, "name": name, "vlrId": None, "real": None, "nat": None,
                     "worldStints": [], "world2026": [], "inRatings": False, "idSource": None}
    return people[k]


for x in ratings:
    p = person(x["name"])
    p.update(name=x["name"], vlrId=x.get("vlrId"), real=x.get("real"), nat=x.get("nat"),
             worldStints=x.get("worldStints") or [], inRatings=True,
             idSource="coach_career_ratings.json" if x.get("vlrId") else None)
for t in world["teams"]:
    c = t.get("coach") or {}
    if c.get("name"):
        person(c["name"])["world2026"].append({"team": t["name"], "tag": t["tag"], "worldTeam": t["id"],
                                               "role": "head coach", "tier": t.get("tier")})
    for a in c.get("assistants") or []:
        person(a)["world2026"].append({"team": t["name"], "tag": t["tag"], "worldTeam": t["id"],
                                       "role": "assistant coach", "tier": t.get("tier")})
TEAM_BY_NAME = {t["name"]: t for t in world["teams"]}
for a in world.get("meta", {}).get("analysts") or []:
    t = TEAM_BY_NAME.get(a.get("from")) or {}
    person(a["name"])["world2026"].append({"team": a.get("from"), "tag": t.get("tag"), "worldTeam": t.get("id"),
                                           "role": "analyst", "tier": t.get("tier")})
TEAM_BY_TAG = {t["tag"]: t for t in world["teams"]}
for h, tag in (overrides.get("nowCoach") or {}).items():
    t = TEAM_BY_TAG.get(tag) or {}
    person(h).setdefault("nowCoach", {"tag": tag, "team": t.get("name"), "worldTeam": t.get("id")})

identity_log = []
for k, p in people.items():
    if p["vlrId"]:
        continue
    cands = []
    pr = profiles.get(k) or {}
    if pr.get("vlrId") and not pr.get("unconfirmed"):
        cands.append((str(pr["vlrId"]), "analysis/coach_rebuild profiles (vlr page, handle+club checked)"))
    vc = next((v for n, v in vlr_careers.items() if not n.startswith("_") and norm(n) == k), None)
    if vc and vc.get("vlrId"):
        cands.append((str(vc["vlrId"]), "scripts/cache/vlr_coach_careers.json"))
    dc = next((v for n, v in dossier_coaches.items() if norm(n) == k), None)
    if dc and dc.get("vlr"):
        cands.append((str(dc["vlr"]), "src/data/dossier.json coaches"))
    for vid, src in cands:
        if vid in NOT_HIM[k]:
            identity_log.append(f"{p['name']}: rejected vlr {vid} from {src} (homonym)")
            continue
        p["vlrId"], p["idSource"] = vid, src
        if not p.get("real") and pr.get("profile", {}).get("real"):
            p["real"] = pr["profile"]["real"]
        if not p.get("nat") and pr.get("profile", {}).get("nat"):
            p["nat"] = pr["profile"]["nat"]
        break

# ---------------------------------------------------------------- per-source rows


def row(p, site, ref, snapshot, team, team_id, raw_role, frm, to, current, scope="tenure", **extra):
    role, explicit, kind, flag = role_of(raw_role, site)
    f, fp = parse_point(frm)
    t, tp = parse_point(to, end=True)
    r = {"site": site, "ref": ref, "snapshot": snapshot, "team": strip_tags(team), "teamIdRaw": team_id,
         "roleRaw": raw_role, "role": role, "explicit": explicit, "kind": kind, "flags": [flag] if flag else [],
         "fromRaw": frm, "toRaw": to, "from": f, "fromPrec": fp, "to": t, "toPrec": tp,
         "current": bool(current), "openEnd": (not current and t is None and f is not None and scope == "tenure"),
         "scope": scope, "inactive": raw_role is not None and str(raw_role).lower() == "inactive coach"}
    r.update(extra)
    return r


def parse_vlr_html(html):
    out = {"handle": None, "rows": []}
    m = re.search(r'<h1 class="wf-title"[^>]*>(.*?)</h1>', html, re.S)
    out["handle"] = strip_tags(m.group(1)) if m else None
    for section, current in (("Current Teams", True), ("Past Teams", False)):
        i = html.find(section)
        if i < 0:
            continue
        j = html.find("<h2", i + len(section))
        block = html[i: j if j > 0 else len(html)]
        for a in re.finditer(r'<a class="wf-module-item[^"]*"\s+href="/team/(\d+)/[^"]*"[^>]*>(.*?)</a>', block, re.S):
            inner = a.group(2)
            nm = re.search(r'font-weight:\s*500;?"[^>]*>(.*?)</div>', inner, re.S)
            tag = re.search(r'class="wf-tag[^"]*"[^>]*>(.*?)</span>', inner, re.S)
            when = None
            for line in re.findall(r'class="ge-text-light"[^>]*>(.*?)</div>', inner, re.S):
                txt = strip_tags(line)
                if txt.startswith("Inactive"):
                    continue
                if txt.startswith(("joined in", "left in")) or "–" in txt or " - " in txt:
                    when = txt
            out["rows"].append({"id": a.group(1), "name": strip_tags(nm.group(1)) if nm else None,
                                "role": strip_tags(tag.group(1)) if tag else None, "when": when, "current": current})
    return out


vlr_snapshot_use = collections.Counter()
vlr_html_check = []


def vlr_rows(p):
    """Rows from the newest cached snapshot of the person's vlr page."""
    vid = p["vlrId"]
    k = p["handle"]
    snaps = []
    if vid:
        url = f"https://www.vlr.gg/player/{vid}/x"
        f = HTTP / (hashlib.sha256(url.encode()).hexdigest() + ".bin")
        pr = profiles.get(k) or {}
        fetched = (pr.get("fetched") or "2026-10-06")[:10]
        if f.exists():
            parsed = parse_vlr_html(f.read_text("utf-8", "replace"))
            if norm(parsed["handle"]) == k or not parsed["handle"]:
                snaps.append(("raw-html", fetched, url, parsed["rows"]))
                if pr.get("stints") is not None:
                    a = sorted((s["vlrTeamId"], s.get("role") or "", s.get("from") or "") for s in pr["stints"])
                    b = sorted((r["id"], r["role"] or "", vlr_when(r["when"])[0] or "") for r in parsed["rows"])
                    vlr_html_check.append((p["name"], a == b))
            else:
                identity_log.append(f"{p['name']}: cached vlr page {vid} is handle {parsed['handle']!r}; not used")
        elif pr.get("profile") and str(pr.get("vlrId")) == str(vid):
            prof = pr["profile"]
            rows = [{"id": t["id"], "name": t["name"], "role": t.get("role"), "when": t.get("when"), "current": cur}
                    for cur, lst in ((True, prof.get("current") or []), (False, prof.get("past") or [])) for t in lst]
            snaps.append(("codex-profile", fetched, pr.get("source") or url, rows))
        if vid in vlr_people:
            v = vlr_people[vid]
            rows = [{"id": t["id"], "name": t["name"], "role": t.get("role"), "when": t.get("when"), "current": cur}
                    for cur, lst in ((True, v.get("current") or []), (False, v.get("past") or [])) for t in lst]
            snaps.append(("vlr_people", SNAP["vlr_people"], f"https://www.vlr.gg/player/{vid}/x", rows))
    vc = next((v for n, v in vlr_careers.items() if not n.startswith("_") and norm(n) == k), None)
    if vc:
        cid = str(vc.get("vlrId"))
        if cid in NOT_HIM[k] or (vid and cid != str(vid)):
            identity_log.append(f"{p['name']}: vlr_coach_careers entry is vlr {cid}, not this person "
                                f"(vlr {vid}); not used")
        else:
            rows = [{"id": s["vlrTeamId"], "name": s["team"], "role": s.get("role"), "from": s.get("from"),
                     "to": s.get("to"), "current": s.get("current")} for s in vc.get("stints", [])]
            snaps.append(("vlr_coach_careers", vc.get("fetched") or "2026-09-10",
                          f"https://www.vlr.gg/player/{cid}/x", rows))
    if not snaps:
        return [], []
    snaps.sort(key=lambda s: s[1], reverse=True)
    kind, snap, ref, rws = snaps[0]
    vlr_snapshot_use[kind] += 1
    out = []
    for r in rws:
        if "when" in r:
            frm, to = vlr_when(r["when"])
        else:
            frm, to = r.get("from"), r.get("to")
        out.append(row(p, "vlr", ref, snap, r["name"], r["id"], r["role"], frm,
                       None if r["current"] else to, r["current"], vlrSnapshot=kind))
    return out, [s[0] + "@" + s[1] for s in snaps[1:]]


lp_choice_log = []


def lp_rows(p, known_clubs):
    k = p["handle"]
    entry = next((v for n, v in lp_tenure.items() if norm(n) == k), None)
    if not entry:
        return []
    if k in LP_IS_OTHER:
        lp_choice_log.append(f"{p['name']}: Liquipedia page is the other man of a homonym pair; not used")
        return []
    scored = []
    for e in entry:
        hist = e.get("history") or []
        clubs = {club_key(h.get("page") or h["team"]) for h in hist} | {club_key(h["team"]) for h in hist}
        overlap = len(clubs & known_clubs)
        coaching = any(role_of(h.get("role"), "liquipedia")[2] == "coach" for h in hist)
        scored.append((overlap, coaching, e))
    if len(scored) > 1:
        scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
        best = scored[0]
        if best[0] == 0 and not best[1]:
            lp_choice_log.append(f"{p['name']}: {len(scored)} Liquipedia titles, none matches; none used")
            return []
        lp_choice_log.append(f"{p['name']}: Liquipedia title {best[2]['title']!r} chosen over "
                             + ", ".join(repr(s[2]["title"]) for s in scored[1:])
                             + f" (club overlap {best[0]} vs {[s[0] for s in scored[1:]]})")
        chosen = [best]
    else:
        chosen = scored
        if chosen and chosen[0][0] == 0 and known_clubs:
            lp_choice_log.append(f"{p['name']}: Liquipedia {chosen[0][2]['title']!r} shares no club with other "
                                 "sources; kept, flagged")
    out = []
    for overlap, _, e in chosen:
        hist = sorted(e.get("history") or [], key=lambda h: h.get("from") or "")
        ref = "https://liquipedia.net/valorant/" + e["title"].replace(" ", "_")
        for i, h in enumerate(hist):
            later = any((g.get("from") or "") > (h.get("from") or "") for g in hist[i + 1:])
            current = h.get("to") is None and not later
            r = row(p, "liquipedia", ref, SNAP["liquipedia_coach_tenure"], h.get("page") or h["team"], None,
                    h.get("role"), h.get("from"), h.get("to"), current, lpTeam=h["team"])
            if overlap == 0 and len(chosen) == 1:
                r["flags"].append("liquipedia identity unconfirmed by club overlap")
            out.append(r)
        # 'Inactive Coach' takes the role of the club spell it interrupts
        for i, r in enumerate(out):
            if r["inactive"]:
                near = [o for o in out if o is not r and club_key(o["team"]) == club_key(r["team"])
                        and o["kind"] == "coach" and o["role"]]
                near.sort(key=lambda o: abs(((o["from"] or AS_OF) - (r["from"] or AS_OF)).days))
                r["role"] = near[0]["role"] if near else "assistant"
                r["explicit"] = bool(near and near[0]["explicit"])
    return out


def haojiao_rows(p):
    hj = next((v for n, v in haojiao.items() if norm(n) == p["handle"]), None)
    if not hj:
        return []
    return [row(p, "haojiao", f"https://web.haojiao.cc/wiki/player/t2Ud5pOQlscKLbRC/{s.get('person_id')}",
                SNAP["haojiao"], s["team"], None, s["role"], s.get("from"), s.get("to"), s.get("to") is None)
            for s in hj]


def event_rows(p, homonym_guard, known_clubs):
    out = []
    for ev, v in lp_events.items():
        eid = LP_EVENT_IDS.get(ev)
        e = events.get(eid) if eid else None
        if not e or not e.get("start"):
            continue
        for t in v.get("teams") or []:
            for s in t.get("staff") or []:
                if norm(s["name"]) != p["handle"]:
                    continue
                team = strip_tags(t["team"])
                if homonym_guard and club_key(team) not in known_clubs:
                    identity_log.append(f"{p['name']}: Liquipedia {ev} staff entry at {team} skipped (homonym, "
                                        "club not in his record)")
                    continue
                out.append(row(p, "liquipedia-event", "https://liquipedia.net/valorant/" + ev.replace(" ", "_"),
                               SNAP["liquipedia_event_staff"], team, None, s.get("pos") or "",
                               e["start"], e["end"], False, scope="event", event=ev, eventId=eid))
    return out


def snapshot_rows(p):
    """Current-claim observations without start dates: vlr team pages, game roster, owner roster."""
    out = []
    k = p["handle"]
    st = vlr_staff["people"].get(k)
    if st and st.get("role"):
        same = (p["vlrId"] and str(st.get("vlrId")) == str(p["vlrId"]))
        if not p["vlrId"]:
            same = st.get("team") in {w.get("tag") for w in p["world2026"]} and str(st.get("vlrId")) not in NOT_HIM[k]
        role, _, kind, _ = role_of(st["role"], "vlr")
        t = TEAM_BY_TAG.get(st.get("team")) or {}
        if same and kind == "coach":
            out.append(row(p, "vlr-team-page", f"https://www.vlr.gg/team/{WORLD_TEAM_VLR.get(t.get('id'))}",
                           SNAP["vlr_staff"], t.get("name") or st.get("team"), WORLD_TEAM_VLR.get(t.get("id")),
                           st["role"], None, None, True, scope="snapshot", observed=SNAP["vlr_staff"]))
    for w in p["world2026"]:
        out.append(row(p, "game-roster", "src/data/world.json", SNAP["world"], w["team"],
                       WORLD_TEAM_VLR.get(w.get("worldTeam")), w["role"], None, None, True, scope="snapshot",
                       observed=SNAP["world"], tier=w.get("tier")))
    oc = overrides.get("coaches") or {}
    for tag, c in oc.items():
        t = TEAM_BY_TAG.get(tag) or {}
        if norm(c.get("name")) == k:
            out.append(row(p, "owner-roster", "data-raw/overrides.json coaches", SNAP["overrides"], t.get("name") or tag,
                           WORLD_TEAM_VLR.get(t.get("id")), "head coach", None, None, True, scope="snapshot",
                           observed=SNAP["overrides"]))
        for a in c.get("assistants") or []:
            if norm(a) == k:
                out.append(row(p, "owner-roster", "data-raw/overrides.json coaches", SNAP["overrides"],
                               t.get("name") or tag, WORLD_TEAM_VLR.get(t.get("id")), "coach", None, None, True,
                               scope="snapshot", observed=SNAP["overrides"]))
    nc = p.get("nowCoach")
    if nc:
        out.append(row(p, "owner-roster", "data-raw/overrides.json nowCoach", SNAP["overrides"], nc["team"] or nc["tag"],
                       WORLD_TEAM_VLR.get(nc.get("worldTeam")), "coach", None, None, True, scope="snapshot",
                       observed=SNAP["overrides"]))
    return out


def authoritative_rows(p):
    out = []
    for s in user_confirmed.get(p["handle"], []):
        out.append(row(p, "user-confirmed", s.get("source"), s.get("source", "")[-10:], s["team"], s.get("vlrTeamId"),
                       s["role"], s["from"], s["to"], False, scope="event", evidence=s.get("evidence")))
    for n in OWNER_NOTES:
        if norm(n["handle"]) == p["handle"] and not n.get("endOnly"):
            out.append(row(p, "owner-note", n["ref"], SNAP["overrides"], n["team"], n["teamId"], n["role"],
                           n["from"], n["to"], n["current"]))
    return out


# ---------------------------------------------------------------- merge


def team_identity(p, r, local):
    if r.get("teamIdRaw"):
        return str(r["teamIdRaw"]), "source"
    f, t = r["from"] or r.get("to"), (AS_OF if r["current"] else r.get("to")) or r["from"]
    if r["scope"] == "snapshot":
        f = t = d(r["observed"])
    for n in (r["team"], r.get("lpTeam")):
        if n and club_key(n) in local:
            return pick(local[club_key(n)], f, t, strip_tags(n)), "same person's vlr record"
    return global_team_id((r["team"], r.get("lpTeam")), f, t)


def overlap_days(a0, a1, b0, b1):
    if not (a0 and a1 and b0 and b1):
        return 0
    return max(0, (min(a1, b1) - max(a0, b0)).days + 1)


def resolve_bound(cands, end):
    """Union bound with precision: the outermost month; a day-precise date in it wins."""
    cands = [c for c in cands if c[0]]
    if not cands:
        return None, None
    if end:
        far = max(c[0] for c in cands)
        mon = (far.year, far.month)
        days = [c[0] for c in cands if c[1] == "day" and (c[0].year, c[0].month) == mon]
        if any(c[1] == "asof" for c in cands if c[0] == far):
            return far, "current"
        return (max(days), "day") if days else (far, max((c[1] for c in cands if c[0] == far), key=str))
    far = min(c[0] for c in cands)
    mon = (far.year, far.month)
    days = [c[0] for c in cands if c[1] == "day" and (c[0].year, c[0].month) == mon]
    return (min(days), "day") if days else (far, "month")


def src_desc(r):
    s = {"site": r["site"], "ref": r["ref"], "snapshot": r["snapshot"], "role": r["roleRaw"],
         "from": r["fromRaw"], "to": r["toRaw"]}
    if r.get("current"):
        s["current"] = True
    if r.get("event"):
        s["event"] = r["event"]
    if r.get("observed"):
        s["observed"] = r["observed"]
    if r.get("resolvedTo"):
        s["openEndResolvedTo"] = r["resolvedTo"]
    return s


def family(site):
    return {"vlr": "vlr", "liquipedia": "liquipedia", "liquipedia-event": "liquipedia",
            "haojiao": "haojiao"}.get(site, site)


ROLE_RANK = {"head": 3, "assistant": 2, "analyst": 1, "other": 0}

stats = collections.Counter()
source_rows = collections.Counter()
all_unmapped = collections.Counter()
conflicts_all = []
corrections_log = []
superseded_log = collections.Counter()
output = []

for k, p in sorted(people.items(), key=lambda kv: kv[1]["name"].lower()):
    vrows, superseded = vlr_rows(p)
    for s in superseded:
        superseded_log[s.split("@")[0]] += 1
    local = collections.defaultdict(collections.Counter)
    for r in vrows:
        if r["teamIdRaw"] and r["team"]:
            local[club_key(r["team"])][str(r["teamIdRaw"])] += 1
    known = set(local) | {club_key(w["team"]) for w in p["worldStints"]} | \
        {club_key(w["team"]) for w in p["world2026"]} | {club_key(w.get("tag")) for w in p["world2026"]}
    hrows = haojiao_rows(p)
    known |= {club_key(r["team"]) for r in hrows}
    lrows = lp_rows(p, known)
    guard = bool(NOT_HIM.get(k)) or k in LP_IS_OTHER
    erows = event_rows(p, guard, known | {club_key(r["team"]) for r in lrows})
    rows = vrows + lrows + hrows + erows + authoritative_rows(p) + snapshot_rows(p)
    for r in rows:
        r["teamId"], r["teamIdHow"] = team_identity(p, r, local)
        r["teamKey"] = r["teamId"] or ("name:" + club_key(r["team"]))
        source_rows[(r["site"], r["kind"])] += 1

    # owner-note end dates for an existing club (alexRr left NOVA 2026-05-19)
    for n in OWNER_NOTES:
        if n.get("endOnly") and norm(n["handle"]) == k:
            for r in rows:
                if r["teamKey"] == n["teamId"] and r["kind"] == "coach" and (r["current"] or not r["to"]):
                    r["to"], r["toPrec"], r["current"], r["openEnd"] = d(n["to"]), "day", False, False
                    r["flags"].append(f"end {n['to']} from {n['ref']}")

    # open past stints end where the next stint begins
    tenure = [r for r in rows if r["scope"] == "tenure" and r["from"]]
    for r in rows:
        if r["openEnd"]:
            nxt = [(o["from"], o["fromPrec"]) for o in tenure if o["from"] > r["from"]
                   and o["teamKey"] != r["teamKey"] and not is_national(o["team"])]
            if nxt:
                first, _ = resolve_bound(nxt, end=False)
                r["to"], r["toPrec"], r["resolvedTo"] = first, "next-stint", iso(first)
            else:
                r["flags"].append("open past stint: no later stint to close it")
        if r["current"] and r["scope"] == "tenure":
            r["to"], r["toPrec"] = AS_OF, "asof"

    # Codex tenure corrections: applied only where they agree with a site
    for c in corrections.get(k, []):
        tid, _ = global_team_id((c["team"],), d(c.get("to") or c.get("activeThrough")))
        match = [r for r in rows if r["site"] in SITE_FAMILIES and r["kind"] == "coach" and r["teamKey"] == tid
                 and r["fromRaw"] and str(r["fromRaw"])[:7] == c.get("fromMonth")]
        target = d(c.get("to") or c.get("activeThrough"))
        ok = [r for r in match if r["to"] and r["from"] <= target <= r["to"] + timedelta(days=31)]
        if ok:
            for r in ok:
                if c.get("to") and r["toPrec"] == "month" and (r["to"].year, r["to"].month) == (target.year, target.month):
                    r["to"], r["toPrec"] = target, "day"
                r["flags"].append("codex correction agrees: " + c["source"])
                r.setdefault("extraSources", []).append({"site": "codex-correction", "ref": c["source"],
                                                         "to": c.get("to"), "activeThrough": c.get("activeThrough"),
                                                         "announcement": c.get("announcement")})
            corrections_log.append(f"{p['name']} {c['team']}: agrees with {ok[0]['site']} → applied")
        else:
            corrections_log.append(f"{p['name']} {c['team']}: no agreeing site row → NOT applied")

    coach = [r for r in rows if r["kind"] == "coach"]
    players = [r for r in rows if r["kind"] == "player"]
    conflicts = []
    stints = []

    all_built, all_snaps = [], []
    by_team = collections.defaultdict(list)
    for r in coach:
        by_team[r["teamKey"]].append(r)

    for tkey, trs in by_team.items():
        ten = sorted([r for r in trs if r["scope"] == "tenure" and r["from"]], key=lambda r: r["from"])
        undated = [r for r in trs if r["scope"] == "tenure" and not r["from"]]
        evs = [r for r in trs if r["scope"] == "event"]
        snaps = [r for r in trs if r["scope"] == "snapshot"]
        comps = []
        for r in ten:
            end = r["to"] or r["from"]
            if comps and r["from"] <= comps[-1]["end"] + TOL:
                comps[-1]["rows"].append(r)
                comps[-1]["end"] = max(comps[-1]["end"], end)
            else:
                comps.append({"rows": [r], "end": end})
        built = []
        for c in comps:
            crs = c["rows"]
            fams = collections.defaultdict(list)
            for r in crs:
                fams[family(r["site"])].append(r)

            def bscore(item):
                f, rs = item
                return (sum(1 for r in rs if r["explicit"]), any(r["fromPrec"] == "day" for r in rs),
                        {"vlr": 3, "liquipedia": 2, "haojiao": 1}.get(f, 0))
            bfam, brs = max(fams.items(), key=bscore)
            segs = []
            for r in sorted(brs, key=lambda r: r["from"]):
                if segs and segs[-1]["role"] == r["role"] and segs[-1]["inactive"] == r["inactive"] \
                        and r["from"] <= (segs[-1]["to"] or segs[-1]["from"]) + TOL:
                    segs[-1]["to"] = max(filter(None, [segs[-1]["to"], r["to"]]), default=None)
                    segs[-1]["rows"].append(r)
                else:
                    segs.append({"role": r["role"], "explicit": r["explicit"], "inactive": r["inactive"],
                                 "from": r["from"], "to": r["to"], "rows": [r]})
            f0, fprec = resolve_bound([(r["from"], r["fromPrec"]) for r in crs], end=False)
            t1, tprec = resolve_bound([(r["to"], r["toPrec"]) for r in crs if r["to"]], end=True)
            segs[0]["from"], segs[0]["fromPrec"] = f0, fprec
            for s in segs[1:]:
                s["fromPrec"] = next((r["fromPrec"] for r in s["rows"] if r["from"] == s["from"]), "month")
            segs[-1]["to"], segs[-1]["toPrec"] = t1, tprec
            for s in segs[:-1]:
                s["toPrec"] = next((r["toPrec"] for r in s["rows"] if r["to"] == s["to"]), "month")
            # roles and sources from the other families
            for s in segs:
                s["sources"] = []
                span = ((s["to"] or s["from"]) - s["from"]).days + 1
                votes = collections.Counter()
                for r in crs:
                    ov = overlap_days(s["from"], s["to"] or s["from"], r["from"], r["to"] or r["from"])
                    if r in s["rows"] or ov > 0:
                        if r not in s["sources"]:
                            s["sources"].append(r)
                        if r not in s["rows"] and r["explicit"] and r["role"] and ov * 2 >= span:
                            votes[r["role"]] += ov
                if votes:
                    top = votes.most_common(1)[0][0]
                    if not s["explicit"]:
                        s["roleNote"] = f"{s['role']} (generic 'coach') → {top} from " + ", ".join(
                            sorted({r['site'] for r in crs if r['role'] == top and r not in s['rows']}))
                        s["role"], s["explicit"] = top, True
                    elif top != s["role"]:
                        conflicts.append({"type": "role", "team": s["rows"][0]["team"], "teamId": tkey if not tkey.startswith("name:") else None,
                                          "window": [iso(s["from"]), iso(s["to"])],
                                          "detail": {fam: sorted({f"{r['roleRaw']}" for r in rs}) for fam, rs in fams.items()}})
            merged_segs = []
            for sg in segs:
                pv = merged_segs[-1] if merged_segs else None
                if pv and pv["role"] == sg["role"] and pv["inactive"] == sg["inactive"] and pv["to"] \
                        and sg["from"] <= pv["to"] + TOL:
                    pv["to"], pv["toPrec"] = sg["to"], sg.get("toPrec")
                    pv["rows"] += [r for r in sg["rows"] if r not in pv["rows"]]
                    pv["sources"] += [r for r in sg["sources"] if r not in pv["sources"]]
                    for note in (sg.get("roleNote"),):
                        if note:
                            pv["roleNote"] = "; ".join(filter(None, [pv.get("roleNote"), note]))
                else:
                    merged_segs.append(sg)
            segs = merged_segs
            c["closed"] = segs[-1]["to"] is not None
            # stale current claim: a newer snapshot shows an end
            cur = [r for r in crs if r["current"]]
            ended = [r for r in crs if not r["current"] and r["to"] and r["toPrec"] in ("day", "month")]
            is_cur = bool(cur)
            if cur:
                newest_cur = max(r["snapshot"] for r in cur)
                cur_from = max(x["from"] for x in cur)
                newer_end = []
                for fam_rows in fams.values():
                    lastr = max(fam_rows, key=lambda r: (r["from"], r["to"] or AS_OF))
                    if not lastr["current"] and lastr in ended and lastr["snapshot"] >= newest_cur \
                            and lastr["to"] >= cur_from - TOL:
                        newer_end.append(lastr)
                if newer_end:
                    e = max(newer_end, key=lambda r: r["to"])
                    is_cur = False
                    segs[-1]["to"], segs[-1]["toPrec"] = e["to"], e["toPrec"]
                    conflicts.append({"type": "stale-current", "team": e["team"],
                                      "detail": f"{', '.join(sorted({r['site']+'@'+r['snapshot'] for r in cur}))} says current; "
                                                f"{e['site']}@{e['snapshot']} ends it {iso(e['to'])}"})
            # window disagreement between site families (> 3 months)
            fw = {}
            for fam, rs in fams.items():
                if fam not in SITE_FAMILIES:
                    continue
                fs = [r["from"] for r in rs if r["from"]]
                ts = [r["to"] for r in rs if r["to"]]
                fw[fam] = (min(fs) if fs else None, max(ts) if ts else None, rs)
            famlist = sorted(fw)
            for i in range(len(famlist)):
                for j in range(i + 1, len(famlist)):
                    a, b = fw[famlist[i]], fw[famlist[j]]
                    for idx, label in ((0, "start"), (1, "end")):
                        if a[idx] and b[idx] and abs((a[idx] - b[idx]).days) > CONFLICT_DAYS:
                            conflicts.append({"type": "window", "field": label, "team": crs[0]["team"],
                                              "teamId": tkey if not tkey.startswith("name:") else None,
                                              famlist[i]: [iso(a[0]), iso(a[1])], famlist[j]: [iso(b[0]), iso(b[1])],
                                              "diffDays": abs((a[idx] - b[idx]).days)})
            for s in segs:
                built.append({"seg": s, "comp": c, "current": is_cur and s is segs[-1]})
        # undated tenure rows: attach to the club's current / latest dated spell, else stand alone
        for r in undated:
            target = None
            if r["current"]:
                target = next((b for b in built if b["current"]), None)
            elif built:
                target = max(built, key=lambda b: b["seg"]["to"] or b["seg"]["from"])
                if r["to"] and target["seg"]["from"] and r["to"] < target["seg"]["from"] - TOL:
                    target = None
            if target:
                target["seg"]["sources"].append(r)
            else:
                built.append({"seg": {"role": r["role"] or "assistant", "explicit": r["explicit"], "inactive": False,
                                      "from": None, "fromPrec": None, "to": r["to"] if not r["current"] else AS_OF,
                                      "toPrec": r["toPrec"] if not r["current"] else "asof", "rows": [r], "sources": [r],
                                      "flags": ["undated"]}, "comp": None, "current": r["current"]})
        # event-scoped rows: attach to the tenure segment they overlap most
        for r in evs:
            hit, best = None, -1
            for b in built:
                sg = b["seg"]
                if not sg["from"] or sg.get("eventScoped") or b["comp"] is None:
                    continue
                s_end = sg["to"] or (AS_OF if not b["comp"].get("closed") else sg["from"])
                if r["from"] <= s_end + EVENT_TOL and r["to"] >= sg["from"] - EVENT_TOL:
                    ov = overlap_days(sg["from"], s_end, r["from"], r["to"])
                    if ov > best:
                        hit, best = b, ov
            if hit and r["site"] != "user-confirmed":
                sg = hit["seg"]
                sg["sources"].append(r)
                comp_segs = [b["seg"] for b in built if b["comp"] is hit["comp"]]
                if r["from"] < sg["from"] and sg is comp_segs[0]:
                    sg["from"], sg["fromPrec"] = r["from"], "event"
                    sg.setdefault("flags", []).append(f"start moved to {r['event']}")
                if sg is comp_segs[-1] and not hit["current"] and (sg["to"] is None or r["to"] > sg["to"]):
                    sg.setdefault("flags", []).append(
                        f"end {'set' if sg['to'] is None else 'moved'} to {r['event']} (open stint, last seen there)"
                        if sg["to"] is None else f"end moved to {r['event']}")
                    sg["to"], sg["toPrec"] = r["to"], "event"
                if r["explicit"] and r["role"] != sg["role"]:
                    if not sg["explicit"]:
                        sg["roleNote"] = f"{sg['role']} (generic) → {r['role']} from Liquipedia {r['event']}"
                        sg["role"], sg["explicit"] = r["role"], True
                    else:
                        conflicts.append({"type": "role-at-event", "team": r["team"], "event": r["event"],
                                          "tenureRole": sg["role"], "eventRole": r["role"]})
            else:
                merged = next((b for b in built if b["comp"] is None and b["seg"].get("eventScoped")
                               and b["seg"]["role"] == (r["role"] or "assistant")
                               and r["from"] <= b["seg"]["to"] + EVENT_TOL), None)
                if merged and r["site"] != "user-confirmed":
                    merged["seg"]["to"] = max(merged["seg"]["to"], r["to"])
                    merged["seg"]["sources"].append(r)
                else:
                    built.append({"seg": {"role": r["role"] or "assistant", "explicit": r["explicit"],
                                          "inactive": False, "from": r["from"], "fromPrec": "event", "to": r["to"],
                                          "toPrec": "event", "rows": [r], "sources": [r], "eventScoped": True,
                                          "flags": ["event-scoped: on the staff at this event; no tenure claimed"]},
                                  "comp": None, "current": False})
        for b in built:
            b["tkey"] = tkey
        all_built.extend(built)
        all_snaps.extend(snaps)

    # snapshot (current-claim) rows, across clubs: vlr keeps two ids for some clubs (NAVI 4915/21715)
    def club_keys(b):
        return {club_key(x["team"]) for x in b["seg"]["sources"]} | {b["tkey"]}

    for r in sorted(all_snaps, key=lambda r: {"vlr-team-page": 0, "owner-roster": 1, "game-roster": 2}[r["site"]]):
        obs = d(r["observed"])
        same = [b for b in all_built if not b["seg"].get("eventScoped")
                and ({r["teamKey"], club_key(r["team"])} & club_keys(b))]
        hit = next((b for b in same if b["current"]), None)
        if not hit:
            dated = [b for b in same if b["seg"]["to"] and not b["seg"].get("snapshotOnly")]
            last = max(dated, key=lambda b: b["seg"]["to"]) if dated else None
            if last and last["seg"]["to"] >= obs - TOL:
                hit = last
            elif last:
                end_snap = max((x["snapshot"] for x in last["seg"]["sources"]
                                if x["site"] in SITE_FAMILIES and not x["current"]), default="")
                conflicts.append({"type": "roster-after-end", "team": r["team"],
                                  "detail": f"{r['site']}@{r['observed']} lists him; dated tenure ended "
                                            f"{iso(last['seg']['to'])} (per sources up to {end_snap})"})
                if not (r["site"] == "owner-roster" or (r["site"] == "vlr-team-page" and r["observed"] > end_snap)):
                    continue
            else:
                hit = next((b for b in same if b["seg"].get("snapshotOnly")), None)
        if hit:
            sg = hit["seg"]
            sg["sources"].append(r)
            if r["site"] != "game-roster":
                sg["rosterOnly"] = False
            if hit["current"] and r["explicit"] and r["role"] and r["role"] != sg["role"]:
                if not sg["explicit"]:
                    sg["roleNote"] = "; ".join(filter(None, [sg.get("roleNote"),
                                               f"{sg['role']} (generic) → {r['role']} from {r['site']}@{r['observed']}"]))
                    sg["role"], sg["explicit"] = r["role"], True
                elif r["site"] != "game-roster":
                    conflicts.append({"type": "role-now", "team": r["team"],
                                      "detail": f"tenure says {sg['role']}; {r['site']}@{r['observed']} says {r['roleRaw']}"})
            continue
        all_built.append({"tkey": r["teamKey"], "comp": None, "current": True,
                          "seg": {"role": r["role"] or "assistant", "explicit": r["explicit"], "inactive": False,
                                  "from": None, "fromPrec": None, "to": AS_OF, "toPrec": "asof", "rows": [r],
                                  "sources": [r], "snapshotOnly": True, "rosterOnly": r["site"] == "game-roster",
                                  "flags": ["undated: current-roster observation only"]}})

    for b in all_built:
        tkey = b["tkey"]
        s = b["seg"]
        srcs = s["sources"]
        names = collections.Counter(r["team"] for r in srcs if r["site"] == "vlr") or \
            collections.Counter(r["team"] for r in srcs)
        team_name = (id_names[tkey].most_common(1)[0][0] if not names and tkey in id_names
                     else names.most_common(1)[0][0])
        flags = list(dict.fromkeys(s.get("flags", []) + [f for r in s["rows"] for f in r["flags"] if f
                                                         and not f.startswith("untagged")]))
        if s.get("rosterOnly"):
            flags.append("roster-only: no site confirms this current job")
        if is_national(team_name):
            flags.append("national team")
        if s["role"] == "other":
            flags.append("non-coaching staff role (" + ", ".join(sorted({str(r['roleRaw']) for r in s['rows']})) + ")")
        item = {"teamId": None if tkey.startswith("name:") else tkey, "team": team_name, "role": s["role"],
                "from": iso(s["from"]), "to": iso(s["to"]), "current": b["current"],
                "datePrecision": {"from": s.get("fromPrec"), "to": s.get("toPrec")},
                "scope": "event" if s.get("eventScoped") else ("roster" if s.get("snapshotOnly") else "tenure"),
                "sources": [src_desc(r) for r in srcs] + [x for r in srcs for x in r.get("extraSources", [])]}
        if s.get("inactive"):
            item["inactive"] = True
        if s.get("roleNote"):
            item["roleNote"] = s["roleNote"]
        if flags:
            item["flags"] = flags
        stints.append(item)

    # player stints: merged per club and window across sites
    pl = []
    for r in sorted(players, key=lambda r: (r["teamKey"], r["from"] or date.min)):
        if r["current"] and r["scope"] == "tenure":
            r["to"] = AS_OF
        prev = next((x for x in pl if x["_key"] == r["teamKey"] and x["_from"] and r["from"]
                     and r["from"] <= (x["_to"] or x["_from"]) + TOL), None)
        if prev:
            prev["_to"] = max(filter(None, [prev["_to"], r["to"]]), default=None)
            prev["sources"].append(src_desc(r))
            prev["current"] = prev["current"] or r["current"]
            continue
        pl.append({"_key": r["teamKey"], "_from": r["from"], "_to": r["to"],
                   "teamId": r["teamId"], "team": r["team"], "role": r["roleRaw"], "current": r["current"],
                   "sources": [src_desc(r)]})
    player_stints = []
    for x in sorted(pl, key=lambda x: x["_from"] or date.max):
        player_stints.append({"teamId": x["teamId"], "team": x["team"], "from": iso(x["_from"]), "to": iso(x["_to"]),
                              "current": x["current"], "roleRaw": x["role"], "sources": x["sources"]})

    stints.sort(key=lambda s: (s["from"] or "9999", s["to"] or "9999"))
    unmapped = sorted({s["team"] for s in stints if not s["teamId"]} | {s["team"] for s in player_stints if not s["teamId"]})
    for u in unmapped:
        all_unmapped[u] += 1

    cur = [s for s in stints if s["current"]]
    if cur:
        status = "active"
        ev = [{"team": s["team"], "role": s["role"], "since": s["from"],
               "basis": sorted({f"{x['site']}@{x['snapshot']}" for x in s["sources"]}),
               **({"rosterOnly": True} if any("roster-only" in f for f in s.get("flags", [])) else {})} for s in cur]
        status_ev = {"asOf": iso(AS_OF), "current": ev}
    else:
        status = "inactive"
        dated = [s for s in stints if s["to"]]
        last = max(dated, key=lambda s: s["to"]) if dated else None
        status_ev = {"asOf": iso(AS_OF), "current": [],
                     "lastCoachingStint": ({"team": last["team"], "role": last["role"], "to": last["to"],
                                            "basis": sorted({f"{x['site']}@{x['snapshot']}" for x in last["sources"]})}
                                           if last else None),
                     "note": ("no source lists a current coaching job" if stints else
                              "no coaching record in any cached source")}
    key = f"vlr:{p['vlrId']}" if p["vlrId"] else f"handle:{k}"
    out = {"key": key, "handle": k, "name": p["name"], "vlrId": p["vlrId"], "idSource": p["idSource"],
           "real": p["real"], "nat": p["nat"], "status": status, "statusEvidence": status_ev,
           "stints": stints, "playerStints": player_stints, "unmappedTeams": unmapped, "conflicts": conflicts}
    if superseded:
        out["vlrSnapshotsSuperseded"] = superseded
    output.append(out)
    for c in conflicts:
        conflicts_all.append((p["name"], c))

# ---------------------------------------------------------------- write JSON

keys = collections.Counter(o["key"] for o in output)
assert all(v == 1 for v in keys.values()), [k for k, v in keys.items() if v > 1]
OUT_DIR.mkdir(parents=True, exist_ok=True)
payload = {"asOf": iso(AS_OF), "generatedBy": "scripts/rating/coach_tenure_v16.py",
           "rules": {"monthStart": "1st of month", "monthEnd": "last day of month",
                     "openPastStint": "ends where the next (non-national, other-club) stint begins",
                     "current": f"ends {iso(AS_OF)}", "sameClubTwoSites": "one spell, union of windows",
                     "roles": "head / assistant / analyst / other; players kept in playerStints",
                     "conflictThresholdDays": CONFLICT_DAYS},
           "snapshots": SNAP, "people": output}
OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", "utf-8")

# ---------------------------------------------------------------- write MD

def dated(s):
    return s["from"] is not None


n_people = len(output)
n_active = sum(o["status"] == "active" for o in output)
roster_only_active = [o["name"] for o in output if o["status"] == "active"
                      and all(c.get("rosterOnly") for c in o["statusEvidence"]["current"])]
all_st = [s for o in output for s in o["stints"]]
per_site = collections.Counter()
for s in all_st:
    for site in {x["site"] for x in s["sources"]}:
        per_site[site] += 1
zero_tenure = [o for o in output if not any(dated(s) and s["scope"] == "tenure" for s in o["stints"])]
zero_any = [o for o in output if not any(dated(s) for s in o["stints"])]

L = []
A = L.append
A("# Coach tenures v16")
A("")
A(f"As of {iso(AS_OF)}. Built by `scripts/rating/coach_tenure_v16.py` from local caches only (no network).")
A("Rules: month-only start = 1st, month-only end = last day; same club on two sites = one spell (union, a "
  "day-precise date wins inside the same month); open past stint ends at the next stint's start; current "
  "ends at the as-of date. Roles: head / assistant / analyst / other.")
A("")
A("## Counts")
A("")
A(f"- People: **{n_people}** (coach_career_ratings {sum(p['inRatings'] for p in people.values())}, "
  f"world.json staff {sum(1 for p in people.values() if p['world2026'])}, nowCoach {sum(1 for p in people.values() if p.get('nowCoach'))}; "
  f"keyed by vlr id: {sum(1 for o in output if o['vlrId'])}, by handle: {sum(1 for o in output if not o['vlrId'])})")
A(f"- vlr ids added beyond coach_career_ratings: {sum(1 for p in people.values() if p['idSource'] and p['idSource'] != 'coach_career_ratings.json')}")
A(f"- Status: **{n_active} active**, {n_people - n_active} inactive; active on game-roster evidence only: {len(roster_only_active)}")
A(f"- Coaching stints: {len(all_st)} (tenure {sum(s['scope']=='tenure' for s in all_st)}, event-scoped "
  f"{sum(s['scope']=='event' for s in all_st)}, undated roster {sum(s['scope']=='roster' for s in all_st)}); "
  f"dated {sum(dated(s) for s in all_st)}; current {sum(s['current'] for s in all_st)}")
A(f"- Player stints kept for reference: {sum(len(o['playerStints']) for o in output)} (vlr rows without a "
  "role tag count as player rows, per the rule; check them when a coach was never a pro)")
openend = [(o["name"], s["team"]) for o in output for s in o["stints"]
           if any("no later stint" in f for f in s.get("flags", []))]
A(f"- Open past stints no later stint closes (left with `to: null`): {len(openend)} — "
  + ", ".join(f"{n} @ {t}" for n, t in openend))
A(f"- Non-coaching staff roles kept and flagged (`other`): {sum(s['role'] == 'other' for s in all_st)}")
A(f"- Active on game-roster evidence only ({len(roster_only_active)}): " + ", ".join(roster_only_active))
A(f"- vlr snapshot used per person: " + ", ".join(f"{k} {v}" for k, v in vlr_snapshot_use.most_common())
  + "; older snapshots superseded: " + ", ".join(f"{k} {v}" for k, v in superseded_log.most_common()))
ok = sum(1 for _, same in vlr_html_check if same)
A(f"- Codex vlr profiles re-parsed from cached raw HTML: {len(vlr_html_check)}, identical stints {ok}"
  + ("" if ok == len(vlr_html_check) else " (differences: " + ", ".join(n for n, s in vlr_html_check if not s)
     + " — raw HTML used; Codex parser ignores 'left in' lines)"))
A("")
A("## Stints per source")
A("")
A("Rows read per source (before merging), and merged coaching stints that cite each source:")
A("")
A("| source | coaching rows | player rows | merged stints citing it |")
A("|---|---:|---:|---:|")
for site in sorted({s for s, _ in source_rows} | set(per_site)):
    A(f"| {site} | {source_rows[(site, 'coach')]} | {source_rows[(site, 'player')]} | {per_site[site]} |")
A("")
A("Codex `tenure_corrections.json`: " + ("; ".join(corrections_log) or "none"))
A("")
A("Codex `user_confirmed_stints.json`: applied as authoritative (24K, EDward Gaming assistant coach, Masters London 2026, event-scoped).")
A("")
A(f"## Coaches with zero dated coaching stints ({len(zero_any)})")
A("")
A("No dated stint from any source (tenure or event). Status comes from roster observations only.")
A("")
for o in zero_any:
    cur = "; ".join(f"{c['team']} ({c['role']}, {'/'.join(c['basis'])})" for c in o["statusEvidence"]["current"])
    A(f"- {o['name']}" + (f" — vlr {o['vlrId']}" if o["vlrId"] else "") + (f" — current: {cur}" if cur else " — no current job either"))
A("")
A(f"Without a dated **tenure** (only Liquipedia event-staff appearances date them): {len(zero_tenure) - len(zero_any)}")
A("")
A(", ".join(o["name"] for o in zero_tenure if o not in zero_any))
A("")
A("Fetch requests (not made here; the no-network rule): vlr player pages for the zero-dated coaches that "
  "have a vlr id, then Liquipedia, then 号角 person pages for the Chinese second tier:")
A("")
for o in zero_any:
    if o["vlrId"]:
        A(f"- https://www.vlr.gg/player/{o['vlrId']}/x ({o['name']})")
nov = [o["name"] for o in zero_any if not o["vlrId"]]
if nov:
    A(f"- vlr search then Liquipedia/号角 by handle: {', '.join(nov)}")
A("")
A(f"## Conflicts between sources ({len(conflicts_all)})")
A("")
A("`window`: same club, start or end differs by more than 92 days between site families. `role`: explicit "
  "roles disagree. `stale-current`: an older snapshot calls it current, a newer one dates its end. "
  "`roster-after-end`: a roster lists him after the dated tenure ended.")
A("")
A("| coach | type | club | detail |")
A("|---|---|---|---|")
for name, c in conflicts_all:
    det = {k2: v for k2, v in c.items() if k2 not in ("type", "team", "teamId")}
    A(f"| {name} | {c['type']} | {c.get('team')} | {json.dumps(det, ensure_ascii=False)} |")
A("")
A("## Identity decisions")
A("")
added = [(p["name"], p["vlrId"], p["idSource"]) for p in people.values()
         if p["idSource"] and p["idSource"] != "coach_career_ratings.json"]
A(f"vlr ids taken from other caches for people coach_career_ratings has none for ({len(added)}): "
  + "; ".join(f"{n} {v} ({src.split(' ')[0].split('/')[-1]})" for n, v, src in sorted(added, key=lambda x: x[0].lower())))
A("")
for x in identity_log + lp_choice_log:
    A(f"- {x}")
A("")
A(f"## Unmapped team names ({len(all_unmapped)})")
A("")
A("No vlr team id from any source, the person's own vlr record, events.json standings, the international "
  "ledger, world.json/vlr_staff or the alias table:")
A("")
A(", ".join(f"{n} ({c})" if c > 1 else n for n, c in sorted(all_unmapped.items(), key=lambda kv: kv[0].lower())))
A("")
dc = collections.Counter((n, ch, json.dumps(c, sort_keys=True)) for n, w, ch, c in DATE_CHOICES)
if dc:
    A("Names behind several vlr team ids, resolved by the stint's dates against the window each id is seen in "
      "(chosen id ← candidates with citation weight, × times):")
    A("")
    for (n, ch, c), times in sorted(dc.items()):
        A(f"- {n}: {ch} ← " + ", ".join(f"{tid} ({id_names[tid].most_common(1)[0][0]} "
                                         f"{iso(id_span[tid][0]) if tid in id_span else '?'}..{iso(id_span[tid][1]) if tid in id_span else '?'})"
                                         for tid in json.loads(c)) + f" × {times}")
    A("")
A("## Spot checks")
A("")
SPOT = ["mini", "Chet", "potter", "Muggle", "alecks", "termi", "bonkar", "24K", "Fields", "Daeda", "DANNYTO",
        "Anderzz", "Fayde", "hvoya", "AfteR", "Sunshine"]
A("| coach | key | status | coaching stints (from → to, role, sources) | conflicts |")
A("|---|---|---|---|---|")
for nm in SPOT:
    o = next((x for x in output if x["handle"] == norm(nm)), None)
    if not o:
        A(f"| {nm} | — | not found | | |")
        continue
    parts = []
    for s in o["stints"]:
        srcs = "+".join(sorted({x["site"] for x in s["sources"]}))
        parts.append(f"{s['team']} {s['from'] or '?'}→{s['to'] or '?'}{' (now)' if s['current'] else ''} "
                     f"{s['role']}{' inactive' if s.get('inactive') else ''} [{srcs}]")
    A(f"| {o['name']} | {o['key']} | {o['status']} | " + "<br>".join(parts) + f" | {len(o['conflicts'])} |")
A("")
OUT_MD.write_text("\n".join(L) + "\n", "utf-8")

print(f"{n_people} people, {n_active} active; {len(all_st)} coaching stints; zero dated {len(zero_any)}; "
      f"conflicts {len(conflicts_all)}")
print("ALIAS LOG:", ALIAS_LOG)
print("UNMAPPED TEAM NAMES:", ", ".join(sorted(all_unmapped)))
