#!/usr/bin/env python3
"""
Who coached whom at the opening event of a past season, from Liquipedia's
participant cards.

    python3 scripts/fetch_liquipedia_event_staff.py

The event pages (VCT/2024/Americas League/Kickoff and friends) carry one
{{TeamCard}} per club with the five, the subs and a Staff column
(|t3c1=Ego|t3c1pos=head coach). One batched action=query per page, gzip,
identified, 2.6 s apart — their terms ask for 2 s. Cache merges.

Writes scripts/cache/liquipedia_event_staff.json:
  { "<page title>": { "year": 2024, "teams": [ { "team", "players": [...],
                      "staff": [ { "name", "pos", "flag" } ] } ] } }
"""
import gzip, json, os, re, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "scripts", "cache", "liquipedia_event_staff.json")
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact yankejing711@gmail.com)"
API = "https://liquipedia.net/valorant/api.php"
PAGES = {
    2023: ["VCT/2023/LOCK IN São Paulo", "VCT/2023/Americas League", "VCT/2023/EMEA League", "VCT/2023/Pacific League",
           "VCT/2023/Champions/China Qualifier", "VCT/2023/China Qualifier"],
    2024: [f"VCT/2024/{r} League/Kickoff" for r in ("Americas", "EMEA", "Pacific", "China")],
    2025: [f"VCT/2025/{r} League/Kickoff" for r in ("Americas", "EMEA", "Pacific", "China")],
}
_last = [0.0]


def api(params):
    wait = 2.6 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    _last[0] = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        body = gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
    return json.loads(body)


def parse_cards(txt):
    teams = []
    for card in re.findall(r"\{\{TeamCard\n(.*?)\n\}\}", txt, re.S):
        kv = {}
        for line in card.split("\n"):
            line = line.strip()
            if not line.startswith("|"):
                continue
            for part in re.split(r"\|(?=[a-z0-9]+=)", line[1:]):
                if "=" in part:
                    k, v = part.split("=", 1)
                    kv[k.strip()] = v.strip()
        team = kv.get("team")
        if not team:
            continue
        players = [kv[k] for k in sorted(kv) if re.fullmatch(r"p\d", k) and kv[k]]
        subs = [kv[k] for k in sorted(kv) if re.fullmatch(r"s\d", k) and kv[k]]
        staff = []
        for k, v in kv.items():
            m = re.fullmatch(r"(t\dc\d|c\d?)", k)
            if not m or not v:
                continue
            pos = kv.get(k + "pos", "coach" if k.startswith("c") else "")
            flag = kv.get(k + "flag")
            staff.append({"name": v, "pos": pos.lower(), "flag": flag})
        teams.append({"team": team, "players": players, "subs": subs, "staff": staff, "qualifier": kv.get("qualifier")})
    return teams


def main():
    store = {}
    if os.path.exists(OUT):
        store = json.load(open(OUT, encoding="utf-8"))
    for year, titles in PAGES.items():
        for title in titles:
            if title in store and store[title].get("teams"):
                continue
            j = api({"action": "query", "format": "json", "titles": title, "prop": "revisions",
                     "rvprop": "content", "rvslots": "main", "redirects": 1})
            p = next(iter(j["query"]["pages"].values()))
            txt = ((p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}) or {}).get("*", "") or ""
            teams = parse_cards(txt)
            store[title] = {"year": year, "resolved": p.get("title"), "teams": teams}
            heads = sum(1 for t in teams for s in t["staff"] if "head" in s["pos"])
            print(f"{title}: {len(teams)} cards, {heads} head coaches")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(store, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
