"""Faces for the coaching staff, off the team pages.

The player scrape covered the 518 people who frag. It did not cover the 74
head coaches, assistants and analysts the card mode also deals out, which is
why every coach card was a headphone emoji.

A vlr.gg team page lists players AND staff in one roster block, each with a
photograph, a flag and a real name — so one pass over the 78 clubs answers it,
and picks up team-shoot photos for players whose own page has none.

Matching a coach by name search would be a mistake: "Autumn" resolves to two
different people on vlr, and attaching the wrong face to a real person is worse
than attaching none. The team page is unambiguous — whoever is listed under
that club IS that club's staff.

Writes ONLY to scripts/cache/vlr_staff.json.
Same rules as the other scrapers: >= 3s between requests, abort and save on
429/403, cache merges rather than overwrites.
"""
from __future__ import annotations

import argparse
import gzip
import html
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
OUT = CACHE / "vlr_staff.json"
CAREER = CACHE / "vlr_career.json"
CHALLENGERS = CACHE / "vlr_challengers.json"
VLRAPI = ROOT / "data-raw" / "vlrapi_teams.json"
WORLD = ROOT / "src" / "data" / "world.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0
SILHOUETTE = "/img/base/ph/sil.png"


class RateLimited(RuntimeError):
    pass


def _get(url: str) -> str:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RateLimited(f"HTTP {e.code} on {url}") from e
        raise


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


norm = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())


# ------------------------------------------------------------------ teams

TEAM_SEARCH = re.compile(
    r'href="/search/r/team/(\d+)/[^"]*"[\s\S]{0,400}?'
    r'class="search-item-title">\s*([^<]+?)\s*</div>')


def team_ids(world: dict, cache: dict) -> dict[str, str]:
    """world team id -> vlr team id, from every source we already have."""
    known: dict[str, str] = dict(cache.get("teams") or {})
    lookup: dict[str, str] = {}

    for tag, t in (load(VLRAPI, {}) or {}).items():
        if t.get("vlrId"):
            lookup[f"tag:{norm(tag)}"] = str(t["vlrId"])
            lookup[f"name:{norm(t.get('name'))}"] = str(t["vlrId"])
    for vid, t in ((load(CHALLENGERS, {}) or {}).get("teams") or {}).items():
        lookup[f"name:{norm(t.get('name'))}"] = str(vid)
        if t.get("tag"):
            lookup[f"tag:{norm(t['tag'])}"] = str(vid)

    # rosters, for the clubs whose name never matched: whichever vlr team
    # shares two or more players with ours is ours
    by_id = {p["id"]: p for p in world["players"]}
    rosters = {
        vid: {k.lower() for k in r}
        for vid, r in ((load(CAREER, {}) or {}).get("_teams") or {}).items()
    }

    for t in world["teams"]:
        if t["id"] in known:
            continue
        vid = lookup.get(f"name:{norm(t['name'])}") or lookup.get(f"tag:{norm(t['tag'])}")
        if not vid:
            mine = {by_id[p]["ign"].lower() for p in t["roster"] if p in by_id}
            best, score = None, 0
            for cand, names in rosters.items():
                n = len(mine & names)
                if n > score:
                    best, score = cand, n
            if score >= 2:
                vid = best
        if not vid:
            # Last resort: /search is allowed, /search/auto is not. vlr's team
            # search is picky about long queries — "NRG Esports" returns
            # nothing while "NRG" finds it — so the tag and the first word are
            # tried before the full name.
            for q in (t["tag"], t["name"].split()[0], t["name"]):
                hits = TEAM_SEARCH.findall(
                    _get("https://www.vlr.gg/search/?q="
                         + urllib.parse.quote(q) + "&type=teams"))
                if not hits:
                    continue
                exact = [c for c, title in hits
                         if norm(html.unescape(title)) in (norm(t["name"]), norm(t["tag"]))]
                vid = exact[0] if exact else hits[0][0]
                break
        if vid:
            known[t["id"]] = str(vid)
        else:
            print(f"  ?  no vlr team page for {t['name']}", file=sys.stderr)
    return known


# ------------------------------------------------------------------ parse

ITEM = re.compile(
    r'<a href="/player/(\d+)/([^"]*)"[^>]*>\s*'
    r'<div class="team-roster-item-img">\s*<img src="([^"]+)">\s*</div>'
    r'([\s\S]{0,700}?)</a>')
ALIAS = re.compile(r'team-roster-item-name-alias">([\s\S]*?)</div>')
REAL = re.compile(r'team-roster-item-name-real">\s*([^<]*?)\s*</div>')
ROLE = re.compile(r'team-roster-item-name-role">\s*([^<]*?)\s*</div>')
FLAG = re.compile(r'flag mod-([a-z]{2})')


def text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(s))).strip()


def parse_team(h: str) -> list[dict]:
    start = h.find("team-roster")
    if start < 0:
        return []
    out = []
    for pid, slug, img, body in ITEM.findall(h[start:]):
        alias = ALIAS.search(body)
        real = REAL.search(body)
        role = ROLE.search(body)
        flag = FLAG.search(alias.group(1) if alias else body)
        if img.startswith("//"):
            img = "https:" + img
        out.append({
            "vlrId": pid,
            "ign": text(alias.group(1)) if alias else slug,
            "img": None if SILHOUETTE in img else img,
            "nat": flag.group(1) if flag else None,
            "real": text(real.group(1)) if real and real.group(1).strip() else None,
            "role": text(role.group(1)) if role else None,
        })
    return out


# ------------------------------------------------------------------ run

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    world = load(WORLD, {"teams": [], "players": []})
    cache = load(OUT, {})
    cache.setdefault("people", {})
    cache["teams"] = team_ids(world, cache)

    done = 0
    try:
        for t in world["teams"]:
            vid = cache["teams"].get(t["id"])
            if not vid:
                continue
            if t["id"] in (cache.get("scraped") or []) and not args.refresh:
                continue
            h = _get(f"https://www.vlr.gg/team/{vid}/x")
            people = parse_team(h)
            for p in people:
                key = p["ign"].lower()
                old = cache["people"].get(key) or {}
                # never let a blank overwrite something we already have
                cache["people"][key] = {
                    **old, **{k: v for k, v in p.items() if v is not None},
                    "team": t["tag"],
                }
            cache.setdefault("scraped", []).append(t["id"])
            done += 1
            print(f"  ok {t['tag']:<6} vlr/{vid:<6} {len(people)} 人"
                  f"（有照片 {sum(1 for p in people if p['img'])}）", flush=True)
            if done % 10 == 0:
                OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            if args.limit and done >= args.limit:
                break
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saving {done} and stopping", file=sys.stderr)
    except KeyboardInterrupt:
        print("interrupted — saving", file=sys.stderr)
    finally:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    have = cache["people"]
    print(f"\nteams scraped {len(cache.get('scraped') or [])}/{len(world['teams'])}"
          f" | people {len(have)} | with a photo {sum(1 for p in have.values() if p.get('img'))}")

    # how much of the coaching staff this actually answers
    coaches = set()
    for t in world["teams"]:
        c = t.get("coach") or {}
        if c.get("name"):
            coaches.add(c["name"])
        for a in c.get("assistants") or []:
            coaches.add(a)
    for a in (world.get("meta", {}).get("analysts") or []):
        coaches.add(a["name"])
    found = sum(1 for c in coaches if (have.get(c.lower()) or {}).get("img"))
    print(f"教练/分析师 {found}/{len(coaches)} 拿到照片")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
