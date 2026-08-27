"""Event photographs for the彩卡, from Liquipedia's shared image wiki.

A彩卡 is a night, so the face on it should be from that night. The ordinary
card's vlr.gg headshot is a studio portrait taken years later, which is exactly
what these cards are not about.

Riot's own archive (flickr.com/photos/valorantesports) is the obvious source
and is not usable: every photo there is "All rights reserved © Riot Games",
and Flickr's robots.txt is `User-agent: * / Disallow: /`. So Liquipedia's
commons wiki, whose images are CC BY-SA and whose filenames say what they are.

Picking the right photo is the whole problem, and the filename is the evidence:

  trophy    "Acend zeek with the VALORANT Champions 2021 trophy.jpg"   best
  event     "EDG ZmjjKK at VALORANT Champions 2024.jpg"                the night itself
  era       "Gambit Esports nAts.jpg"                                  right club, right period
  reject    "Neon Overdrive.png"                                       an agent ability, not a person

The ign alone is not enough — "Neon" matches a VALORANT agent, two other
esports orgs and a CS skin. A file is only considered when the player's tag
appears as a whole word AND something that ties it to him: his club, his real
name, or the event. Everything else is thrown away, because a wrong face on a
real professional is worse than an old one.

Writes ONLY to scripts/cache/legend_faces.json.
Liquipedia terms: API only (direct page fetches answer 403), >= 2s apart.
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
OUT = ROOT / "scripts" / "cache" / "legend_faces.json"
API = "https://liquipedia.net/commons/api.php"
UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 2.0
_last = 0.0

# id -> what counts as this man, and what counts as that night.
# `club` also carries the spellings Liquipedia actually uses in filenames.
LEGENDS: dict[str, dict] = {
    "L:zeek-champions-2021":      {"ign": "zeek", "real": "Zygmunt", "club": ["acend"], "event": [r"champions 2021"], "year": ["2021"]},
    "L:aspas-champions-2022":     {"ign": "aspas", "real": "Santos", "club": ["loud"], "event": [r"champions 2022"], "year": ["2022"]},
    "L:demon1-champions-2023":    {"ign": "Demon1", "real": "Mazanov", "club": ["eg", "evil geniuses"], "event": [r"champions 2023"], "year": ["2023"]},
    "L:zmjjkk-champions-2024":    {"ign": "ZmjjKK", "real": "Zheng", "club": ["edg", "edward"], "event": [r"champions 2024"], "year": ["2024"]},
    "L:brawk-champions-2025":     {"ign": "brawk", "real": "Somerhalder", "club": ["nrg"], "event": [r"champions 2025"], "year": ["2025"]},
    "L:zekken-madrid-2024":       {"ign": "zekken", "real": "Patrone", "club": ["sentinels", "sen"], "event": [r"madrid"], "year": ["2024"]},
    "L:t3xture-shanghai-2024":    {"ign": "t3xture", "real": "Kim", "club": ["geng", "gen.g", "gen g"], "event": [r"shanghai"], "year": ["2024"]},
    "L:meteor-bangkok-2025":      {"ign": "Meteor", "real": "Kim", "club": ["t1", "geng", "gen.g"], "event": [r"bangkok"], "year": ["2025"]},
    "L:forsaken-toronto-2025":    {"ign": "f0rsakeN", "real": "Susanto", "club": ["paper rex", "prx"], "event": [r"toronto"], "year": ["2025"]},
    "L:dambi-santiago-2026":      {"ign": "Dambi", "real": "Lee", "club": ["nongshim", "ns"], "event": [r"santiago"], "year": ["2026"]},
    "L:neon-london-2026":         {"ign": "Neon", "real": "Rodr", "club": ["leviat"], "event": [r"london"], "year": ["2026", "2025"]},
    "L:nats-berlin-2021":         {"ign": "nAts", "real": "Susekov", "club": ["gambit"], "event": [r"masters berlin"], "year": ["2021"]},
    "L:shao-copenhagen-2022":     {"ign": "Shao", "real": "Kiprsky", "club": ["fpx", "funplus"], "event": [r"copenhagen"], "year": ["2022"]},
    "L:alfajer-tokyo-2023":       {"ign": "Alfajer", "real": "Beder", "club": ["fnc", "fnatic"], "event": [r"masters tokyo"], "year": ["2023"]},
    "L:ethan-two-rings":          {"ign": "Ethan", "real": "Arnold", "club": ["nrg", "eg", "evil geniuses"], "event": [r"champions 2025", r"champions 2023"], "year": ["2025", "2023"]},
    "L:derke-2023-double":        {"ign": "Derke", "real": "Sirmitev", "club": ["fnc", "fnatic"], "event": [r"lockin", r"lock in", r"lock--in", r"masters tokyo"], "year": ["2023"]},
    "L:chronicle-2023-double":    {"ign": "Chronicle", "real": "Khromov", "club": ["fnc", "fnatic"], "event": [r"lockin", r"lock in", r"lock--in", r"masters tokyo"], "year": ["2023"]},
    "L:boaster-2023-double":      {"ign": "Boaster", "real": "Howlett", "club": ["fnc", "fnatic"], "event": [r"lockin", r"lock in", r"lock--in", r"masters tokyo"], "year": ["2023"]},
    "L:jinggg-toronto-2025":      {"ign": "Jinggg", "real": "Wang", "club": ["paper rex", "prx"], "event": [r"toronto"], "year": ["2025"]},
    "L:chichoo-champions-2024":   {"ign": "CHICHOO", "real": "Wan", "club": ["edg", "edward"], "event": [r"champions 2024"], "year": ["2024"]},
}


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


IMAGE = re.compile(r"\.(jpe?g|png|webp)$", re.I)


def score(fname: str, spec: dict) -> tuple[int, str]:
    """How well this file fits, and what tier it landed in. 0 means reject."""
    low = fname.lower()
    if not IMAGE.search(low) or "noimage" in low:
        return 0, ""
    if not re.search(r"(?<![a-z0-9])" + re.escape(spec["ign"].lower()) + r"(?![a-z0-9])", low):
        return 0, ""

    club = any(c in low for c in spec["club"])
    real = spec.get("real", "").lower() in low if spec.get("real") else False
    event = any(re.search(e, low) for e in spec["event"])
    year = any(y in low for y in spec["year"])

    # the identity gate: the tag alone matches agents, orgs and gun skins
    if not (club or real or event):
        return 0, ""

    if "trophy" in low or "lifting" in low:
        return 400 + (50 if event else 0), "trophy"
    if event:
        return 300 + (20 if club else 0), "event"
    if club and year:
        return 200, "era"
    if club:
        return 100, "club"
    return 50, "person"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    cache = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    picks: dict[str, dict] = cache.get("picks", {})

    try:
        for lid, spec in LEGENDS.items():
            if lid in picks and not args.refresh:
                continue
            r = api({"list": "search", "srnamespace": "6", "srsearch": spec["ign"], "srlimit": "50"})
            best: tuple[int, str, str] = (0, "", "")
            for h in r.get("query", {}).get("search", []):
                s, tier = score(h["title"], spec)
                if s > best[0]:
                    best = (s, h["title"], tier)
            if not best[0]:
                print(f"  ✗ {spec['ign']:<10} 没有可用照片", flush=True)
                continue
            picks[lid] = {"file": best[1], "tier": best[2], "score": best[0]}
            print(f"  {'🏆' if best[2] == 'trophy' else '·'} {spec['ign']:<10} [{best[2]:<6}] {best[1]}", flush=True)
    except RateLimited as e:
        print(f"RATE LIMITED: {e}", file=sys.stderr)

    # resolve the picks to URLs, and to the credit CC BY-SA asks for
    files = sorted({p["file"] for p in picks.values() if "url" not in p})
    for i in range(0, len(files), 25):
        batch = files[i:i + 25]
        try:
            r = api({"prop": "imageinfo", "iiprop": "url|extmetadata",
                     "iiurlwidth": "500", "titles": "|".join(batch)})
        except RateLimited:
            break
        info = {}
        for p in (r.get("query", {}).get("pages", {}) or {}).values():
            ii = (p.get("imageinfo") or [{}])[0]
            meta = ii.get("extmetadata") or {}
            info[p["title"]] = {
                "url": ii.get("thumburl") or ii.get("url"),
                "page": ii.get("descriptionurl"),
                "license": (meta.get("LicenseShortName") or {}).get("value"),
                "author": re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip() or None,
            }
        for pick in picks.values():
            if pick["file"] in info:
                pick.update(info[pick["file"]])

    OUT.write_text(json.dumps({"picks": picks}, ensure_ascii=False, indent=1), encoding="utf-8")
    tiers: dict[str, int] = {}
    for p in picks.values():
        tiers[p["tier"]] = tiers.get(p["tier"], 0) + 1
    print(f"\n{len(picks)}/{len(LEGENDS)} 张彩卡有照片")
    for t in ("trophy", "event", "era", "club", "person"):
        if tiers.get(t):
            label = {"trophy": "捧杯照", "event": "夺冠赛事", "era": "同队同赛季",
                     "club": "同队", "person": "本人"}[t]
            print(f"  {label}: {tiers[t]}")
    lic = {p.get("license") for p in picks.values()}
    print(f"授权: {sorted(x for x in lic if x)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
