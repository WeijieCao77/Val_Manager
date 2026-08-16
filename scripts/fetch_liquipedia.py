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

# ---------------------------------------------------------------- rate limits
# Straight from https://liquipedia.net/api-terms-of-use:
#
#   "Rate limit all HTTP requests to no more than 1 request per 2 seconds.
#    API action=parse requests should not exceed 1 request per 30 seconds as
#    these are more resource intensive."
#
# These are enforced below rather than merely documented: every call goes
# through _throttle(), action=parse is refused outright, and a 429 aborts the
# run instead of retrying into the block. Violating this once already earned a
# temporary IP ban, and their page warns that repeat offences become permanent.
MIN_INTERVAL = {"parse": 31.0, "_default": 2.5}
_last_request = [0.0]


class RateLimited(Exception):
    """Liquipedia asked us to stop. Stop."""


def _throttle(action):
    gap = MIN_INTERVAL.get(action, MIN_INTERVAL["_default"])
    wait = gap - (time.monotonic() - _last_request[0])
    if wait > 0:
        time.sleep(wait)
    _last_request[0] = time.monotonic()

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


def api(params):
    action = params.get("action", "")
    if action == "parse":
        # one page per 30s makes bulk parse useless anyway; action=query with
        # 50 titles per call does the same job in a fraction of the requests
        raise RuntimeError("action=parse is not used by this script by design")

    _throttle(action)
    # POST the query rather than putting it in the URL: a batch of 50 titles
    # overflows the URI limit once club names get long (HTTP 414), and MediaWiki
    # accepts action=query over POST. Still one request per batch either way.
    body = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(API, data=body, headers={
        "User-Agent": UA, "Accept-Encoding": "gzip", "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code == 414:
            raise RuntimeError(
                "Liquipedia refused the batch as too large — lower BATCH."
            ) from e
        if e.code == 429:
            retry = e.headers.get("Retry-After") if e.headers else None
            raise RateLimited(
                f"Liquipedia returned 429{f' (Retry-After: {retry})' if retry else ''}. "
                "Stopping so we do not make it worse — whatever is cached has been "
                "saved. Unblock at https://liquipedia.net and re-run later."
            ) from e
        raise


def fetch_pages(titles):
    """
    Return {title: wikitext} for a batch of page titles.

    Stops cleanly and returns whatever it has if Liquipedia rate-limits us, so
    a partial run is still cached rather than thrown away.
    """
    out = {}
    for i in range(0, len(titles), BATCH):
        chunk = titles[i:i + BATCH]
        try:
            d = api({
                "action": "query", "prop": "revisions", "rvprop": "content",
                "rvslots": "main", "titles": "|".join(chunk),
                "format": "json", "redirects": "1", "formatversion": "2",
            })
        except RateLimited as e:
            print(f"  {e}", flush=True)
            break

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
        print(f"  batch {i // BATCH + 1}/{-(-len(titles) // BATCH)}: "
              f"{len(out)} pages so far", flush=True)
    return out


def field(text, key):
    m = re.search(r"\|\s*" + key + r"\s*=\s*([^\n|]+)", text)
    if not m:
        return None
    v = m.group(1).strip()
    v = re.sub(r"<!--.*?-->", "", v).strip()          # strip source comments
    v = re.sub(r"\[\[([^\]|]+\|)?([^\]]+)\]\]", r"\2", v)  # unwrap wiki links
    return v or None


def infobox_names(text, key):
    """
    Pull the player names out of an infobox field.

    Team infoboxes write staff as a mix of templates and links, several deep:
        |coaches={{Flag|fr}} [[alecks]]<br>{{player|Wendler|flag=us}}
        |igl={{Flag|my}} [[d4v41]]
    so a naive regex picks up '{{Flag' or 'false' instead of a person.
    """
    m = re.search(r"\|\s*" + key + r"\s*=([^\n]*)", text)
    if not m:
        return []
    raw = re.sub(r"<!--.*?-->", "", m.group(1))
    out = []
    for part in re.split(r"<br\s*/?>|,", raw):
        part = re.sub(r"\{\{\s*Flag[^}]*\}\}", " ", part, flags=re.I)
        name = None
        t = re.search(r"\{\{\s*player\s*\|\s*([^|}]+)", part, re.I)
        if t:
            name = t.group(1)
        else:
            w = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", part)
            if w:
                name = w.group(2) or w.group(1)
            else:
                stripped = re.sub(r"\{\{[^}]*\}\}", " ", part)
                stripped = stripped.replace("'''", "").strip()
                if stripped and not re.fullmatch(r"(true|false|)", stripped, re.I):
                    name = stripped
        if name:
            name = name.strip().strip("'\"")
            # a page title like 'alecks (player)' still displays as 'alecks'
            name = re.sub(r"\s*\(.*?\)$", "", name).strip()
            if name and len(name) < 30:
                out.append(name)
    return out


VCL_CACHE = os.path.join(ROOT, "scripts", "cache", "vlr_challengers.json")


def challengers():
    """Clubs and players pulled from the Challengers scrape, if it has run.

    Those players arrive from vlr.gg with no birthdate and their clubs with no
    coach, which is exactly what Liquipedia is good for — so the same throttled
    client covers them instead of a second, sloppier scraper.
    """
    if not os.path.exists(VCL_CACHE):
        return [], {}
    try:
        cache = json.load(open(VCL_CACHE, encoding="utf-8"))
    except ValueError:
        return [], {}
    igns, teams = [], {}
    for t in cache.get("teams", {}).values():
        players = [p for p in t.get("roster", []) if p.get("role") == "player"]
        if len(players) < 5:
            continue
        teams[t["name"]] = t["name"]
        igns.extend(p["ign"] for p in players)
    return igns, teams


def main():
    igns = []
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            p = line.split("|")
            if p and p[0].strip():
                igns.append(p[0].strip())
    vcl_igns, vcl_teams = challengers()
    igns.extend(vcl_igns)
    igns = list(dict.fromkeys(igns))
    team_pages = dict(TEAM_PAGES)
    team_pages.update(vcl_teams)
    print(f"including {len(vcl_igns)} Challengers players and "
          f"{len(vcl_teams)} Challengers clubs", flush=True)

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
    tpages = fetch_pages(sorted(set(team_pages.values())))
    for tag, title in team_pages.items():
        w = tpages.get(title) or ""
        if not w:
            continue
        staff = infobox_names(w, "coaches") or infobox_names(w, "coach")
        igls = infobox_names(w, "igl")
        if not staff and not igls and not infobox_names(w, "analyst"):
            continue
        # analysts are a separate infobox field and a separate job — they were
        # being ignored entirely, so the game had no real analysts to hire
        analysts = infobox_names(w, "analyst") or infobox_names(w, "analysts")
        coaches[tag] = {
            "team": title,
            "name": staff[0] if staff else None,          # head coach
            "assistants": staff[1:],
            "analysts": analysts,
            "igl": igls[0] if igls else None,
        }
    json.dump(coaches, open(OUT_C, "w", encoding="utf-8"), ensure_ascii=False)
    named = sum(1 for v in coaches.values() if v.get("name"))
    with_igl = sum(1 for v in coaches.values() if v.get("igl"))
    print(f"teams: {named}/{len(team_pages)} head coaches, "
          f"{with_igl}/{len(team_pages)} IGLs -> {OUT_C}")


if __name__ == "__main__":
    sys.exit(main())
