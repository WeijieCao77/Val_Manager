"""The VCT 2026 season table, as vlr.gg publishes it today.

Why: data-raw/vlr_vct2026_players.txt is the roster and this-season stat line
for every tier-one player — who is on which club, and how the year is going.
It was pasted from vlr.gg in mid-August, when Stage 2 was half played. Form is
derived from it, and so is the club a player belongs to. A table from August
says a player is having the year he was having in August.

vlr.gg's stats page (tier=VCT, all regions, span=2026) is the same table,
current. This fetches every page of it — five or six requests — into
scripts/cache/vlr_stats2026.json, then rewrites the raw file in the format
build_world.py already parses:

  ign|club|nat|role|rounds|R|ACS|K:D|KAST|ADR|KPR|APR|FKPR|FDPR|HS%

The role letter (d/i/c/s) is not on the page. A player already in the file
keeps his; a new one gets the role of his most-played agent, which is how
build_world.py assigns roles anyway when the agent pool is known. Players in
the old file who are no longer in the table are kept — they are still real
people with a real 2026 line — but a player who IS in the table gets the
table's club, so a transfer shows up as a transfer.

Rules, per scripts/fetch_vlr_career.py and the terms this project follows:
>= 3s between requests, abort and save on 429/403, and the cache merges.

  python3 scripts/fetch_vlr_stats2026.py            # fetch, then rewrite
  python3 scripts/fetch_vlr_stats2026.py --no-fetch # rewrite from the cache
"""
from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_stats2026.json"
RAW = ROOT / "data-raw" / "vlr_vct2026_players.txt"
UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0

# the stats page answers a bare request with a redirect that sets a cookie
# and expects it back; a jar makes that one round trip instead of a loop
_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))

# No trailing slash: /stats/?... is answered with a redirect to /stats that
# drops the query. And the first request of a session is answered with a
# redirect that sets a cookie and also drops the query — so fetch() warms
# the jar with a bare /stats before asking for anything. min_rounds=1 so a
# substitute who played one map is on the list; the page defaults to 100.
BARE = "https://www.vlr.gg/stats"
PAGE = ("https://www.vlr.gg/stats?tier=vct&region=all&span={span}&side=all"
        "&role=all&agent=all&map_id=all&min_rating=0&min_rounds=1"
        "&sort=rating2&dir=desc&page={page}")
MAX_PAGES = 40
# --span all: the same table over every VCT-tier event vlr has, into its own
# cache. It is not a roster (a retired player's last club is still on it) and
# never touches the raw file; it is where a career clutch rate comes from,
# which the per-event pages do not carry for CN events at all.
CACHE_ALL = ROOT / "scripts" / "cache" / "vlr_stats_all.json"

# agent -> role letter, the same grouping build_world.py uses
AGENT_ROLE = {}
for _letter, _names in {
    "d": ["jett", "raze", "phoenix", "reyna", "yoru", "neon", "iso", "waylay"],
    "i": ["sova", "breach", "skye", "kayo", "fade", "gekko", "tejo"],
    "c": ["brimstone", "omen", "viper", "astra", "harbor", "clove"],
    "s": ["sage", "cypher", "killjoy", "chamber", "deadlock", "vyse"],
}.items():
    for _n in _names:
        AGENT_ROLE[_n] = _letter


class RateLimited(RuntimeError):
    pass


def _get(url: str) -> str:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with _opener.open(req, timeout=40) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(
                f"vlr.gg answered {e.code}. Stopping and saving. Do not lower MIN_INTERVAL."
            ) from e
        raise


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def parse_rows(html: str) -> list[dict]:
    """Every player line on one page of the table."""
    def f(x):
        try:
            return float(str(x).replace("%", ""))
        except (TypeError, ValueError):
            return None

    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", html, re.S):
        pm = re.search(r'href="/player/(\d+)/', tr)
        if not pm:
            continue
        name = re.search(r'class="st-pl-name text-of">(.*?)<', tr, re.S)
        club = re.search(r'class="st-pl-country">(.*?)<', tr, re.S)
        flag = re.search(r'class="flag mod-([a-z]+)"', tr)
        if not name:
            continue
        agents = re.findall(r"/img/vlr/game/agents/([a-z0-9_-]+)\.png", tr)
        row = {
            "ign": _text(name.group(1)),
            "club": _text(club.group(1)) if club else "",
            "nat": (flag.group(1) if flag else "").lower(),
            "vlrId": pm.group(1),
            "agents": agents,
        }
        for col, key in (("rnd", "rnd"), ("rating2", "R"), ("acs", "acs"), ("kd", "kd"),
                         ("kast", "kast"), ("adr", "adr"), ("kpr", "kpr"), ("apr", "apr"),
                         ("fbpr", "fkpr"), ("fdpr", "fdpr"), ("hsp", "hs"), ("clp", "clp")):
            m = re.search(rf'data-col="{col}"[^>]*>(.*?)</td>', tr, re.S)
            row[key] = f(_text(m.group(1))) if m else None
        # clutches, as won/played — the one number on the page that says
        # what a player does when it is him against several
        m = re.search(r'data-col="cl"[^>]*>(.*?)</td>', tr, re.S)
        cm = re.match(r"(\d+)/(\d+)", _text(m.group(1))) if m else None
        row["clw"], row["clt"] = (int(cm.group(1)), int(cm.group(2))) if cm else (None, None)
        if row["rnd"]:
            rows.append(row)
    return rows


def last_page(html: str) -> int:
    pages = [int(p) for p in re.findall(r"[?&]page=(\d+)", html)]
    return max(pages) if pages else 1


def fetch(span: str = "2026", cache_path: Path = CACHE, start: int = 1) -> dict:
    cache = json.loads(cache_path.read_text("utf-8")) if cache_path.exists() else {}
    players: dict = {}
    try:
        _get(BARE)                       # sets the cookie; see BARE above
        # the table renders no page links, but page=N answers all the same:
        # walk until a page comes back short
        for p in range(start, start + MAX_PAGES):
            html = _get(PAGE.format(span=span, page=p))
            sel = re.findall(r'<option value="([^"]*)" selected', html)
            if span not in sel:
                raise RuntimeError(f"the page ignored span={span} (selected {sel}); refusing to "
                                   "write a 60-day window as the season")
            rows = parse_rows(html)
            print(f"page {p}: {len(rows)} lines", flush=True)
            for r in rows:
                players[r["ign"]] = r
            if len(rows) < 100:
                break
    except RateLimited as e:
        print(f"!! {e}", file=sys.stderr)
        if not players:
            return cache
    # merge: a player seen today replaces his old line; one not seen keeps it
    merged = dict(cache.get("players") or {})
    merged.update(players)
    cache = {"fetched": time.strftime("%Y-%m-%d"), "span": span, "players": merged}
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
    print(f"{len(players)} lines today, {len(merged)} in cache -> {cache_path.relative_to(ROOT)}")
    return cache


def fmt(v, nd: int) -> str:
    if v is None:
        return ""
    return f"{v:.{nd}f}" if nd else str(int(round(v)))


def rewrite(cache: dict) -> None:
    """Rebuild the raw file: today's table, with the old file's roles."""
    old: dict[str, list[str]] = {}
    order: list[str] = []
    if RAW.exists():
        for line in RAW.read_text("utf-8").splitlines():
            p = line.split("|")
            if len(p) >= 15 and p[0]:
                old[p[0]] = p
                order.append(p[0])
    fresh = cache.get("players") or {}
    # A player new to the file joins it only if his club is one the game
    # models. The VCT tier on vlr.gg also carries Ascension, so a September
    # table has whole rosters from clubs that do not exist in this world;
    # they would arrive as "free agents", which is not what they are.
    world_p = ROOT / "src" / "data" / "world.json"
    modelled = set()
    if world_p.exists():
        modelled = {t["tag"] for t in json.loads(world_p.read_text("utf-8"))["teams"]}
    out: list[str] = []
    changed = moved = added = kept = outside = 0
    for ign in order + [i for i in fresh if i not in old]:
        r = fresh.get(ign)
        if not r:
            out.append("|".join(old[ign]))
            kept += 1
            continue
        if ign not in old and modelled and r["club"] not in modelled:
            outside += 1
            continue
        o = old.get(ign)
        role = o[3] if o else ""
        if not role and r.get("agents"):
            role = AGENT_ROLE.get(r["agents"][0], "")
        if o and o[1] != r["club"]:
            moved += 1
            print(f"  moved  {ign:<14} {o[1] or '(none)':<6} -> {r['club'] or '(none)'}")
        elif not o:
            added += 1
        else:
            changed += 1
        out.append("|".join([
            ign, r["club"], r["nat"] or (o[2] if o else ""), role,
            fmt(r["rnd"], 0), fmt(r["R"], 2), fmt(r["acs"], 0), fmt(r["kd"], 2),
            fmt(r["kast"], 0), fmt(r["adr"], 1), fmt(r["kpr"], 2), fmt(r["apr"], 2),
            fmt(r["fkpr"], 2), fmt(r["fdpr"], 2), fmt(r["hs"], 0),
        ]))
    RAW.write_text("\n".join(out) + "\n", "utf-8")
    print(f"{RAW.relative_to(ROOT)}: {len(out)} lines — {changed} updated, "
          f"{moved} changed club, {added} new, {kept} kept from the old file, "
          f"{outside} new names skipped (club not modelled)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-fetch", action="store_true", help="rewrite from the cache only")
    ap.add_argument("--span", default="2026", help="2026 (default) or all — see CACHE_ALL")
    ap.add_argument("--from", dest="start", type=int, default=1,
                    help="first page to fetch — resume a long table where it stopped")
    args = ap.parse_args()
    if args.span == "all":
        c = fetch("all", CACHE_ALL, args.start)
        return 0 if c.get("players") else 2
    cache = (json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}) if args.no_fetch else fetch()
    if not cache.get("players"):
        print("nothing fetched and nothing cached; the raw file is untouched", file=sys.stderr)
        return 2
    rewrite(cache)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
