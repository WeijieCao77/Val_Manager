#!/usr/bin/env python3
"""
Fetch real birthdates, real names and head coaches from Liquipedia.

Uses MediaWiki's batch query API (up to 50 titles per request), which turns
~340 page lookups into ~7 requests. Liquipedia's API terms are respected:
gzip encoding, an identifying User-Agent, a conservative delay between calls,
and backoff when they answer 429.

  python3 scripts/fetch_liquipedia.py
"""
import gzip, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data-raw")
SRC = os.path.join(RAW, "vlr_vct2026_players.txt")
OUT_P = os.path.join(RAW, "liquipedia_players.json")
OUT_C = os.path.join(RAW, "liquipedia_coaches.json")

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact yankejing711@gmail.com)")
API = "https://liquipedia.net/valorant/api.php"
BATCH = 50
# Liquipedia rate-limits per action: action=parse is roughly one request every
# 30s, while action=query is far more permissive. This script therefore only
# ever uses action=query, batched 50 titles at a time, so all ~340 players cost
# about seven requests. Do not lower this delay, and do not add a parse loop —
# that is what got the IP temporarily blocked the first time around.
DELAY = 4.0

TEAM_PAGES = {
    "LEV": "Leviatán", "NRG": "NRG Esports", "G2": "G2 Esports", "MIBR": "MIBR",
    "SEN": "Sentinels", "FUR": "FURIA", "100T": "100 Thieves", "KRÜ": "KRÜ Esports",
    "LOUD": "LOUD", "C9": "Cloud9", "EG": "Evil Geniuses", "ENVY": "Envy",
    "VIT": "Team Vitality", "TH": "Team Heretics", "FNC": "Fnatic", "FUT": "FUT Esports",
    "GX": "GIANTX", "BBL": "BBL Esports", "TL": "Team Liquid", "EF": "Eternal Fire",
    "PCF": "PCIFIC Esports", "M8": "Gentle Mates", "NAVI": "Natus Vincere",
    "KC": "Karmine Corp",
    "PRX": "Paper Rex", "T1": "T1", "NS": "Nongshim RedForce", "GEN": "Gen.G",
    "KRX": "DRX", "ZETA": "ZETA DIVISION", "TS": "Team Secret",
    "DFM": "DetonatioN FocusMe", "RRQ": "Rex Regum Qeon", "FS": "FULL SENSE",
    "GE": "Global Esports", "VL": "VARREL",
    "EDG": "EDward Gaming", "XLG": "Xi Lai Gaming", "TYL": "TYLOO",
    "WOL": "Wolves Esports", "FPX": "FunPlus Phoenix", "NOVA": "Nova Esports",
    "BLG": "Bilibili Gaming", "AG": "All Gamers", "TE": "Trace Esports",
    "JDG": "JD Gaming", "DRG": "Dragon Ranger Gaming", "TEC": "Titan Esports Club",
    "KBG": "KeepBest Gaming", "AT": "A Team", "EP": "Eastern Pandas",
    "SGE": "Sangal Esports", "JL": "Joblife",
}


def api(params, tries=4):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{API}?{q}", headers={
        "User-Agent": UA, "Accept-Encoding": "gzip", "Accept": "application/json",
    })
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 20 * (attempt + 1)
                print(f"    429 — backing off {wait}s", flush=True)
                time.sleep(wait)
                continue
            raise
    return {}


def fetch_pages(titles):
    """Return {title: wikitext} for a batch of page titles."""
    out = {}
    empty_streak = 0
    for i in range(0, len(titles), BATCH):
        chunk = titles[i:i + BATCH]
        before = len(out)
        d = api({
            "action": "query", "prop": "revisions", "rvprop": "content",
            "rvslots": "main", "titles": "|".join(chunk),
            "format": "json", "redirects": "1", "formatversion": "2",
        })
        for page in d.get("query", {}).get("pages", []):
            if page.get("missing"):
                continue
            revs = page.get("revisions") or []
            if not revs:
                continue
            content = revs[0].get("slots", {}).get("main", {}).get("content", "")
            out[page.get("title", "")] = content
        # normalisation/redirects map the requested title to the real one
        for norm in d.get("query", {}).get("normalized", []):
            if norm["to"] in out:
                out[norm["from"]] = out[norm["to"]]
        for red in d.get("query", {}).get("redirects", []):
            if red["to"] in out:
                out[red["from"]] = out[red["to"]]
        print(f"  batch {i // BATCH + 1}: {len(out)} pages so far", flush=True)
        # a rate-limit cooldown makes every batch empty; stop rather than spend
        # half an hour backing off into a wall
        empty_streak = empty_streak + 1 if len(out) == before else 0
        if empty_streak >= 2:
            print("  two empty batches — Liquipedia is cooling us down, "
                  "stopping. Re-run later to fill in the rest.", flush=True)
            break
        time.sleep(DELAY)
    return out


def field(text, key):
    m = re.search(r"\|\s*" + key + r"\s*=\s*([^\n|]+)", text)
    if not m:
        return None
    v = m.group(1).strip()
    v = re.sub(r"<!--.*?-->", "", v).strip()          # strip source comments
    v = re.sub(r"\[\[([^\]|]+\|)?([^\]]+)\]\]", r"\2", v)  # unwrap wiki links
    return v or None


def main():
    igns = []
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            p = line.split("|")
            if p and p[0].strip():
                igns.append(p[0].strip())
    igns = list(dict.fromkeys(igns))

    # Never discard what we already have: a rate-limited run must not wipe the
    # cache from a successful one. Only players we have no real data for are
    # re-requested.
    players = {}
    if os.path.exists(OUT_P):
        try:
            players = json.load(open(OUT_P, encoding="utf-8"))
        except ValueError:
            players = {}
    todo = [i for i in igns if not (players.get(i) or {}).get("birth")]
    print(f"players: {len(igns)} total, {len(igns) - len(todo)} already known, "
          f"{len(todo)} to fetch across {-(-len(todo) // BATCH)} batches", flush=True)

    pages = fetch_pages(todo) if todo else {}
    for ign in todo:
        w = pages.get(ign) or pages.get(ign.capitalize()) or ""
        if not w:
            players.setdefault(ign, {"miss": True})
            continue
        players[ign] = {
            "birth": field(w, "birth_date"),
            "real": field(w, "name"),
            "country": field(w, "country"),
        }
    json.dump(players, open(OUT_P, "w", encoding="utf-8"), ensure_ascii=False)
    hit = sum(1 for v in players.values() if v.get("birth"))
    print(f"birthdates: {hit}/{len(igns)}", flush=True)

    print("teams…", flush=True)
    coaches = {}
    if os.path.exists(OUT_C):
        try:
            coaches = json.load(open(OUT_C, encoding="utf-8"))
        except ValueError:
            coaches = {}
    tpages = fetch_pages(sorted(set(TEAM_PAGES.values())))
    for tag, title in TEAM_PAGES.items():
        w = tpages.get(title) or ""
        if not w:
            continue
        # squad rows carry a role; head coaches are tagged Coach / Head Coach
        m = re.search(
            r"\{\{SquadPlayer\s*\|([^|}]+)[^}]*?\|\s*(?:role|position)\s*=\s*"
            r"(?:Head\s*)?Coach\b", w, re.I)
        if not m:
            m = re.search(r"\|\s*coach\s*=\s*([^\n|}]+)", w, re.I)
        if m:
            name = re.sub(r"\[\[([^\]|]+\|)?([^\]]+)\]\]", r"\2", m.group(1)).strip()
            name = re.sub(r"<!--.*?-->", "", name).strip()
            if name and len(name) < 40:
                coaches[tag] = {"name": name, "team": title}
    json.dump(coaches, open(OUT_C, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"coaches: {len(coaches)}/{len(TEAM_PAGES)} -> {OUT_C}")


if __name__ == "__main__":
    sys.exit(main())
