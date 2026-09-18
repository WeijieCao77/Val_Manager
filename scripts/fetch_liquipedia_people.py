#!/usr/bin/env python3
"""
Liquipedia player infoboxes for the people the handle lookup missed.

    python3 scripts/fetch_liquipedia_people.py [--dry]

liquipedia_births_hist.json asked for a page titled exactly like the handle.
That misses two kinds of people: a shared handle, whose page is
"Klaus (Argentine player)", and a man vlr lists under an alias (FiNESSE is
"FNS"). This asks for those titles, and keeps the infobox's own `vlr=` id
where it has one — the only field on the page that says WHICH Klaus.

Liquipedia blocked this project's IP on 2026-09-18, so this is deliberately
slow and small: one batched action=query of up to 50 titles, 10 s apart, gzip,
an identifying User-Agent, and the first 429/403 ends the run with what was
fetched saved. Never action=parse, never list=search. Cache merges.
"""
import argparse, gzip, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *p: os.path.join(ROOT, *p)
OUT = P("scripts", "cache", "liquipedia_people.json")
API = "https://liquipedia.net/valorant/api.php"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project; contact yankejing711@gmail.com)"
INTERVAL = 10.0
DEMONYM = {
    "ar": "Argentine", "br": "Brazilian", "us": "American", "ca": "Canadian", "cl": "Chilean", "mx": "Mexican", "co": "Colombian",
    "pe": "Peruvian", "kr": "Korean", "jp": "Japanese", "cn": "Chinese", "tw": "Taiwanese", "hk": "Hong Kong", "sg": "Singaporean",
    "ph": "Filipino", "id": "Indonesian", "th": "Thai", "my": "Malaysian", "vn": "Vietnamese", "in": "Indian", "tr": "Turkish",
    "ru": "Russian", "ua": "Ukrainian", "pl": "Polish", "de": "German", "fr": "French", "es": "Spanish", "pt": "Portuguese",
    "it": "Italian", "gb": "British", "se": "Swedish", "fi": "Finnish", "no": "Norwegian", "dk": "Danish", "nl": "Dutch",
    "be": "Belgian", "cz": "Czech", "au": "Australian", "nz": "New Zealand", "sa": "Saudi", "ma": "Moroccan", "lt": "Lithuanian",
    "lv": "Latvian", "ee": "Estonian", "pk": "Pakistani", "mn": "Mongolian", "eg": "Egyptian", "kz": "Kazakh", "by": "Belarusian",
}


def field(txt, name):
    m = re.search(r"\|\s*" + name + r"\s*=\s*([^\n|]+)", txt)
    return m.group(1).strip() if m else None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry", action="store_true")
    ap.add_argument("--recheck", action="store_true", help="re-read the handle pages build_people.py doubts, for their vlr= field")
    ap.add_argument("--titles", default="", help="comma-separated page titles to (re)read, e.g. a man vlr flags as 'un'")
    a = ap.parse_args()
    people = json.load(open(P("data-raw", "people.json")))
    handles = json.load(open(P("data-raw", "overrides.json"))).get("handles") or {}
    cache = json.load(open(OUT)) if os.path.exists(OUT) else {}
    old = {k.lower() for k in json.load(open(P("scripts", "cache", "liquipedia_births_hist.json")))}
    old |= {k.lower() for k in json.load(open(P("data-raw", "liquipedia_players.json")))}
    titles = []
    for vid, who in people.items():
        if who.get("birth") and who.get("real"):
            continue
        ign = who["ign"]
        guess = []
        if ign.lower() not in old:
            guess.append(ign)
        if vid in handles:
            guess.append(handles[vid]["ign"])
        if DEMONYM.get(who.get("nat") or ""):
            guess.append(f"{ign} ({DEMONYM[who['nat']]} player)")
        titles += [t for t in guess if t not in cache and t not in titles]
    if a.recheck:
        doubt = json.load(open(P("scripts", "cache", "liquipedia_recheck.json")))
        titles = [t for t in doubt if t not in cache]
    if a.titles:
        titles = [t.strip() for t in a.titles.split(",") if t.strip()]
    print(f"{len(titles)} titles to ask for, {-(-len(titles) // 50)} requests, {INTERVAL:.0f} s apart")
    if a.dry:
        print(titles[:40]); return 0
    last = 0.0
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        wait = INTERVAL - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": "|".join(batch), "prop": "revisions",
                                    "rvprop": "content", "rvslots": "main", "redirects": 1})
        req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        last = time.time()
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                body = gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code} — stopping, keeping what was fetched", file=sys.stderr); break
        j = json.loads(body).get("query", {})
        asked = {}
        for rd in (j.get("normalized") or []) + (j.get("redirects") or []):
            asked[rd["to"]] = asked.get(rd["from"], rd["from"])
        got = set()
        for pg in j.get("pages", {}).values():
            title = pg.get("title", "")
            src = asked.get(title, title)
            txt = ((pg.get("revisions") or [{}])[0].get("slots", {}).get("main", {}) or {}).get("*", "") or ""
            player = "Infobox player" in txt or "infobox player" in txt.lower()
            cache[src] = {"page": title if txt else False, "player": player, "birth": field(txt, "birth_date"),
                          "real": field(txt, "name"), "romanized": field(txt, "romanized_name"),
                          "country": field(txt, "country"), "country2": field(txt, "country2"), "vlr": field(txt, "vlr"),
                          "disambig": "{{disambig" in txt.lower() or "may refer to" in txt.lower()}
            got.add(src)
        for t in batch:
            cache.setdefault(t, {"page": False})
        json.dump(cache, open(OUT, "w"), ensure_ascii=False, indent=1)
        print(f"  {min(i + 50, len(titles))}/{len(titles)}  pages found in this batch: {sum(1 for t in batch if cache[t].get('page'))}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
