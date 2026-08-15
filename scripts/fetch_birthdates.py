#!/usr/bin/env python3
"""
Fetch real birthdates (and real names) from Liquipedia for the players scraped
from vlr.gg.

Liquipedia's API terms require gzip, an identifying User-Agent, and no more than
one action=parse request every two seconds. All three are honoured here, and
results are cached so re-runs only fetch what is missing.

  python3 scripts/fetch_birthdates.py
"""
import gzip, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "data-raw", "vlr_vct2026_players.txt")
OUT = os.path.join(ROOT, "data-raw", "liquipedia_players.json")

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact yankejing711@gmail.com)")
API = "https://liquipedia.net/valorant/api.php"
DELAY = 2.2  # their documented parse limit is one request per 2s


def get(page):
    url = (f"{API}?action=parse&page={urllib.parse.quote(page)}"
           f"&prop=wikitext&format=json&redirects=1")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Encoding": "gzip",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8", "replace"))


def field(text, key):
    m = re.search(r"\|\s*" + key + r"\s*=\s*([^\n|]+)", text)
    return m.group(1).strip() if m else None


def main():
    names = []
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            p = line.split("|")
            if p and p[0].strip():
                names.append(p[0].strip())
    names = list(dict.fromkeys(names))

    cache = {}
    if os.path.exists(OUT):
        cache = json.load(open(OUT, encoding="utf-8"))

    todo = [n for n in names if n not in cache]
    print(f"{len(names)} players, {len(cache)} cached, {len(todo)} to fetch "
          f"(~{len(todo) * DELAY / 60:.0f} min)", flush=True)

    for i, name in enumerate(todo):
        try:
            d = get(name)
            w = d.get("parse", {}).get("wikitext", {}).get("*", "")
            if not w:
                cache[name] = {"miss": True}
            else:
                cache[name] = {
                    "birth": field(w, "birth_date"),
                    "real": field(w, "name"),
                    "country": field(w, "country"),
                }
        except urllib.error.HTTPError as e:
            cache[name] = {"miss": True, "code": e.code}
        except Exception as e:  # noqa: BLE001
            cache[name] = {"miss": True, "err": str(e)[:60]}

        if (i + 1) % 20 == 0 or i + 1 == len(todo):
            json.dump(cache, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
            hit = sum(1 for v in cache.values() if v.get("birth"))
            print(f"  {i + 1}/{len(todo)} — {hit} birthdates so far", flush=True)
        time.sleep(DELAY)

    json.dump(cache, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    hit = sum(1 for v in cache.values() if v.get("birth"))
    print(f"done: {hit}/{len(names)} birthdates -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
