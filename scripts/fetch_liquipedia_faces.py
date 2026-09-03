"""The faces vlr.gg does not have, from Liquipedia.

After the vlr pass, 119 of the 518 players and 15 of the 69 coach cards still
had no photograph — mostly tier-two, Chinese and Pacific rosters. Liquipedia
has a picture for about a quarter of them.

Identity is the whole problem here, and it is solved by the filename. Liquipedia
names a player photo after the player — "M80 Boni at VCT 2026 Americas Stage
2.jpg" — while everything else on the page is a team logo or an event card. So
a file is only accepted when the person's own tag appears in it as a whole
word, which is a claim about who is in the picture that we can actually check.
Anything else is skipped. Putting the wrong face on a real professional is a
worse outcome than showing no face.

Liquipedia's terms: >= 2s between API calls, and only the API (direct page
fetches answer 403). Images are CC-BY-SA — the file page URL is kept per photo
so the credit can point at it.

Writes ONLY to scripts/cache/lp_faces.json.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache"
OUT = CACHE / "lp_faces.json"
PROFILES = CACHE / "vlr_profiles.json"
STAFF = CACHE / "vlr_staff.json"
WORLD = ROOT / "src" / "data" / "world.json"

API = "https://liquipedia.net/valorant/api.php"
UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 2.0
_last = 0.0


class RateLimited(RuntimeError):
    pass


def api(params: dict) -> dict:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    url = API + "?" + urllib.parse.urlencode({**params, "action": "query", "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code}") from e
        raise


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def is_photo_of(fname: str, tag: str) -> bool:
    low = fname.lower()
    if "noimage" in low:
        return False
    if not low.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return False
    # the tag as a whole word — "Boni" matches "M80 Boni at ...", not "Bonito"
    return re.search(r"(?<![a-z0-9])" + re.escape(tag.lower()) + r"(?![a-z0-9])", low) is not None


# Files that carry a person's tag but are not a person: agent art, skin
# splashes, team wordmarks, ability icons, weapon cosmetics.
NOT_A_PERSON = re.compile(
    r"logo|allmode|lightmode|darkmode|splash art|skins?\b|abilityicon|gameasset|wikiasset"
    r"|teamcard|square|_std|icon |wallpaper|emoticon|spray|player card"
    r"|striker|bundle|vandal|phantom|operator|karambit|butterfly knife", re.I)

# Liquipedia's commons wiki holds every game they cover, so a tag that means a
# VALORANT pro here can mean an Apex or a Mobile Legends player there. These
# were all real matches on the first pass: "Alliance Yuki at the ALGS Raleigh
# Championship", "YG Ying at M7 World Championship".
WRONG_GAME = re.compile(
    r"\balgs\b|apex|mlbb|mobile legends|\bm\d World Championship|worlds\d\d"
    r"|league of legends|\blol\b|dota|\bcs ?2\b|csgo|counter-?strike|overwatch"
    r"|rocket league|pubg|honor of kings|wild rift|starcraft|hearthstone|fifa", re.I)

# Only tokens that mean VALORANT specifically. "Champions" and "Masters" on
# their own belong to half a dozen other games; "Esports World Cup" is
# multi-game and matched an Apex player.
EVENTISH = re.compile(
    r"\bvct\b|valorant|champions tour|ascension|game changers|lock ?-?-?in", re.I)

# VALORANT shipped in 2020; a photograph dated earlier is somebody else.
OLD_YEAR = re.compile(r"\b(19\d\d|200\d|201\d)\b")


def is_photo_of_person(fname: str, tag: str, clubs: list[str], surname: str | None) -> bool:
    """
    The commons index is broad, so the gate has to be tight.

    Searching it for "splash" returns champion splash art and for "bao" returns
    three Chinese org wordmarks. The tag alone proves nothing: a file must also
    carry the player's club, his surname, or an unmistakable event, and must
    not look like artwork.
    """
    if not is_photo_of(fname, tag):
        return False
    low = fname.lower()
    if NOT_A_PERSON.search(low) or WRONG_GAME.search(low) or OLD_YEAR.search(low):
        return False
    club_hit = any(
        c and re.search(r"(?<![a-z0-9])" + re.escape(c.lower()) + r"(?![a-z0-9])", low)
        for c in clubs)
    name_hit = bool(surname and len(surname) > 2 and surname.lower() in low)

    # Structure, not just vocabulary. Liquipedia names a person photo
    # "<CLUB> <ign> at <event>" or "<Real Name> at <event>"; a weapon skin is
    # "<skin line> <colour> VALORANT". Requiring " at ", a club or a surname
    # is what finally separated them — "Classic spectrum purple pink VALORANT"
    # passed every keyword test there was, because Pink is a player and the
    # file does say VALORANT.
    if not (club_hit or name_hit or " at " in low):
        return False
    return club_hit or name_hit or bool(EVENTISH.search(low))


def chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


# Handles that are somebody else at the bare title. Liquipedia's 「Ash」 is a
# Canadian caster and 「Klaus」 is KRÜ's Argentine duelist; the Gen.G Ash and
# VARREL's Klaus live at suffixed pages, and the bare pages carried photos
# whose file names passed is_photo_of — so both cards wore the wrong face
# until a reader noticed (2026-09-03). The category check in find_files
# catches the caster; this map says where the right person is.
PAGE_OF = {"Ash": "Ash (Korean player)", "Klaus": "Klaus (Korean player)"}


def find_files(names: list[str], kind: str = "Players") -> dict[str, str]:
    """name -> "File:..." for the ones with a photo we can attribute.

    `kind` is the category the page must belong to — "Players" or "Staffs" —
    so a caster or a coach who happens to share a handle is skipped rather
    than photographed.
    """
    out: dict[str, str] = {}
    for batch in chunks(names, 30):
        asked_of = {PAGE_OF.get(n, n): n for n in batch}
        r = api({"prop": "images|categories", "imlimit": "500", "cllimit": "500",
                 "redirects": "1", "titles": "|".join(asked_of)})
        q = r.get("query", {})
        back: dict[str, str] = {}
        for k in ("normalized", "redirects"):
            for m in q.get(k, []) or []:
                back[m["to"]] = m["from"]
        for p in (q.get("pages", {}) or {}).values():
            title = p.get("title", "")
            asked = back.get(title, title)
            name = next((n for t, n in asked_of.items() if t.lower() == asked.lower()), asked)
            cats = {c["title"].split(":", 1)[-1] for c in (p.get("categories") or [])}
            if not any(c.endswith(kind) for c in cats):
                print(f"  -- {name}: 「{title}」 is not a {kind.lower()[:-1]} page "
                      f"({', '.join(sorted(cats))[:70] or 'no categories'}), skipped")
                continue
            for f in [x["title"] for x in p.get("images", [])]:
                if is_photo_of(f, name):
                    out[name] = f
                    break
    return out


def resolve(files: list[str], width: int = 400) -> dict[str, dict]:
    """"File:..." -> {url, page} at a sane width."""
    out: dict[str, dict] = {}
    for batch in chunks(files, 30):
        r = api({"prop": "imageinfo", "iiprop": "url", "iiurlwidth": str(width),
                 "titles": "|".join(batch)})
        for p in (r.get("query", {}).get("pages", {}) or {}).values():
            info = (p.get("imageinfo") or [{}])[0]
            url = info.get("thumburl") or info.get("url")
            if url:
                out[p["title"]] = {"url": url, "page": info.get("descriptionurl")}
    return out


def commons(params: dict) -> dict:
    """The shared image wiki, which indexes files the player page never uses."""
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    url = ("https://liquipedia.net/commons/api.php?"
           + urllib.parse.urlencode({**params, "action": "query", "format": "json"}))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code}") from e
        raise


def sweep_commons(people: list[dict]) -> dict[str, str]:
    """ign -> "File:..." for players the page-images pass could not place."""
    out: dict[str, str] = {}
    for who in people:
        try:
            r = commons({"list": "search", "srnamespace": "6",
                         "srsearch": who["ign"], "srlimit": "30"})
        except RateLimited:
            raise
        except Exception:
            continue
        for h in r.get("query", {}).get("search", []):
            if is_photo_of_person(h["title"], who["ign"], who["clubs"], who.get("surname")):
                out[who["ign"]] = h["title"]
                break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--sweep", action="store_true",
                    help="second pass over the commons file index for the ones still missing")
    args = ap.parse_args()

    world = load(WORLD, {"players": [], "teams": []})
    profiles = load(PROFILES, {})
    staff = load(STAFF, {"people": {}})
    cache = load(OUT, {})
    cache.setdefault("players", {})
    cache.setdefault("coaches", {})

    # only the ones still without a face after the two vlr passes
    want_players = [
        p["ign"] for p in world["players"]
        if not (profiles.get(p["ign"].lower()) or {}).get("img")
        and (args.refresh or p["ign"] not in cache["players"])
    ]
    names = set()
    for t in world["teams"]:
        c = t.get("coach") or {}
        if c.get("name"):
            names.add(c["name"])
    for a in (world.get("meta", {}).get("analysts") or []):
        names.add(a["name"])
    want_coaches = [
        n for n in sorted(names)
        if not (staff["people"].get(n.lower()) or {}).get("img")
        and (args.refresh or n not in cache["coaches"])
    ]

    print(f"没有照片的：选手 {len(want_players)}，教练 {len(want_coaches)}")

    if args.sweep:
        # everyone STILL without a face after the vlr passes and the page-images
        # pass, looked for in the shared image wiki instead
        teams = {t["id"]: t for t in world.get("teams", [])}
        people = []
        faces_dir = ROOT / "public" / "faces"
        for p in world["players"]:
            # the real condition is "no picture on disk", not "no URL known":
            # a vlr URL that turned out to be a grey cut-out was rejected at
            # download time and leaves the player just as faceless
            if (faces_dir / f"{p['id']}.webp").exists():
                continue
            if cache["players"].get(p["ign"], {}).get("url"):
                continue
            club = teams.get(p.get("teamId") or "")
            real = (p.get("realName") or "").split()
            people.append({
                "ign": p["ign"],
                "clubs": [c for c in [club and club.get("tag"), club and club.get("name")] if c],
                "surname": real[-1] if real else None,
            })
        print(f"  扫 commons 图库：{len(people)} 人")
        try:
            found = sweep_commons(people)
        except RateLimited as e:
            print(f"RATE LIMITED: {e}", file=sys.stderr)
            found = {}
        print(f"  commons 补到 {len(found)} 人")
        for ign, f in found.items():
            cache["players"][ign] = {"file": f, "via": "commons"}
        urls = resolve(sorted({v["file"] for v in cache["players"].values() if "url" not in v}), 400)
        for v in cache["players"].values():
            if v.get("file") in urls:
                v.update(urls[v["file"]])
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Liquipedia 累计：选手 {len(cache['players'])}，教练 {len(cache['coaches'])}")
        return 0

    try:
        pf = find_files(want_players, "Players")
        cf = find_files(want_coaches, "Staffs")
        urls = resolve(sorted({*pf.values(), *cf.values()}))
        for name, f in pf.items():
            if f in urls:
                cache["players"][name] = {"file": f, **urls[f]}
        for name, f in cf.items():
            if f in urls:
                cache["coaches"][name] = {"file": f, **urls[f]}
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saving what we have", file=sys.stderr)
    finally:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Liquipedia 补到：选手 {len(cache['players'])}，教练 {len(cache['coaches'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
