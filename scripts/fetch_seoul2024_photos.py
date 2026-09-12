"""
Photographs from Champions Seoul 2024 for the 首尔 2024 cards, off Liquipedia's
commons wiki (CC BY-SA), where filenames say who and where:
"EDG ZmjjKK at VALORANT Champions 2024.jpg".

    python3 scripts/fetch_seoul2024_photos.py [--targeted]

Riot's own Flickr archive has the event too, but it is All Rights Reserved,
its robots.txt disallows everything, and its "Media Day" album is trophy shots,
not player portraits; it fills in only the players this finds nothing for.

List every commons file whose title names Champions 2024 or Champions Seoul,
and keep a file for a player only when his tag is a whole word in it AND his
team's tag or name is too (the tag alone matches words like "life", "heat",
"knight"). Image URL, size, licence and author come from imageinfo.
`--targeted` adds one search per player still without a file; it is off by
default because it is most of the requests.

The first run drew a 429 on its first request and the owner lifted the block by
hand, so this runs at one request every 5 s — well above Liquipedia's 2 s floor —
and stops and saves on any 403/429. Writes ONLY scripts/cache/seoul2024_photos.json,
merging with what is there.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_legend_faces as lp  # noqa: E402

lp.MIN_INTERVAL = 5.0
OUT = lp.ROOT / "scripts" / "cache" / "seoul2024_photos.json"
RAW = json.loads((lp.ROOT / "src" / "data" / "seoul2024.json").read_text("utf-8"))
EVENT = re.compile(r"champions[ _-]*(2024|seoul)")
PAGES = 8


def fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def word(needle: str, hay: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(fold(needle)) + r"(?![a-z0-9])", hay) is not None


def search(query: str, pages: int) -> list[str]:
    out, offset = [], 0
    for page in range(pages):
        r = lp.api({"list": "search", "srnamespace": "6", "srsearch": query, "srlimit": "50", "sroffset": str(offset)})
        hits = r.get("query", {}).get("search", [])
        out += [h["title"] for h in hits]
        if page == 0:
            print(f"  {query!r}: {r.get('query', {}).get('searchinfo', {}).get('totalhits')} hits", flush=True)
        offset = r.get("continue", {}).get("sroffset")
        if offset is None or not any(EVENT.search(fold(h["title"])) for h in hits):
            break
    return out


def main() -> int:
    targeted = "--targeted" in sys.argv
    cache = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {"titles": [], "files": {}, "players": {}}
    teams = {t["tag"]: t for t in RAW["teams"]}
    try:
        if not cache["titles"]:
            seen = set()
            for q in ("VALORANT Champions 2024", "Champions Seoul 2024"):
                seen.update(t for t in search(q, PAGES) if EVENT.search(fold(t)))
            cache["titles"] = sorted(seen)
            OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), "utf-8")
            print(f"{len(cache['titles'])} commons files name Champions 2024 / Seoul", flush=True)

        def matches(p: dict, titles: list[str]) -> list[str]:
            team = teams[p["team"]]
            return [t for t in titles if word(p["ign"], fold(t)) and (word(team["tag"], fold(t)) or fold(team["name"]) in fold(t))]

        for p in RAW["players"]:
            vid = p["profile"].split("/")[4]
            if cache["players"].get(vid, {}).get("files"):
                continue
            found = matches(p, cache["titles"])
            if not found and targeted:
                found = [t for t in matches(p, search(f'{p["ign"]} Champions 2024', 1)) if EVENT.search(fold(t))]
            cache["players"][vid] = {"ign": p["ign"], "team": p["team"], "files": found}
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), "utf-8")

        want = sorted({t for v in cache["players"].values() for t in v["files"]} - set(cache["files"]))
        for i in range(0, len(want), 50):
            r = lp.api({"prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": "800", "titles": "|".join(want[i:i + 50])})
            for page in r.get("query", {}).get("pages", {}).values():
                info = (page.get("imageinfo") or [{}])[0]
                meta = info.get("extmetadata", {})
                cache["files"][page["title"]] = {
                    "url": info.get("url"), "thumb": info.get("thumburl"), "width": info.get("width"), "height": info.get("height"),
                    "license": meta.get("LicenseShortName", {}).get("value"),
                    "artist": re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip() or None,
                    "page": info.get("descriptionurl"),
                }
            OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), "utf-8")
    except lp.RateLimited as e:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), "utf-8")
        print(f"!! Liquipedia answered {e}; saved, stopping.", file=sys.stderr)
        return 2

    have = [v for v in cache["players"].values() if v["files"]]
    print(f"{len(have)}/80 players have a Champions 2024 photo; {len(cache['files'])} files with image info", flush=True)
    print("missing:", ", ".join(f'{v["ign"]}({v["team"]})' for v in cache["players"].values() if not v["files"]), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
