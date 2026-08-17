"""Collect Challengers (tier-2) rosters from vlr.gg, slowly.

vlr.gg's robots.txt disallows only /search/auto and /rr/, and publishes no
crawl-delay — but "no published limit" is not "no limit": this project already
had its IP rate-limited once by running ~1000 requests in a short window.

So the pace is enforced here in code rather than by intention:

  * every request goes through _get(), which sleeps to keep >= MIN_INTERVAL
  * a 429 or 403 aborts the whole run and saves what was already collected
  * results are cached to disk and merged, never overwritten, so a re-run
    costs only the pages that are still missing

Usage:
    python3 scripts/fetch_vlr_challengers.py            # resume / top up
    python3 scripts/fetch_vlr_challengers.py --limit 5  # only 5 new teams
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_challengers.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")

# vlr.gg publishes no crawl-delay. Three seconds is deliberately slower than we
# need; do not lower it. Getting the IP blocked costs days, not minutes.
MIN_INTERVAL = 3.0
_last_call = 0.0


class RateLimited(RuntimeError):
    """Raised when vlr.gg pushes back. We stop rather than hammer."""


def _throttle() -> None:
    global _last_call
    wait = MIN_INTERVAL - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def _get(url: str) -> str:
    _throttle()
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(
                f"vlr.gg answered {e.code} on {url}. Stopping and saving progress. "
                f"Wait before retrying — do NOT lower MIN_INTERVAL."
            ) from e
        raise


def _text(s: str) -> str:
    return unescape(re.sub(r"<[^>]+>", " ", s)).strip()


# The Challengers league pages, one per region. Each is a vlr.gg event whose
# participants are exactly the tier-2 clubs we are missing.
# Challengers is not one league but a stack of national ones, so each of the
# game's four regions is filled from the leagues that actually feed it.
LEAGUES = [
    ("Americas", "https://www.vlr.gg/event/2858/challengers-2026-north-america-ace-stage-3"),
    ("Americas", "https://www.vlr.gg/event/2962/challengers-2026-brazil-gamers-club-stage-2"),
    ("EMEA", "https://www.vlr.gg/event/3018/challengers-2026-emea-last-chance-qualifier"),
    ("Pacific", "https://www.vlr.gg/event/2974/challengers-2026-japan-split-2"),
    ("Pacific", "https://www.vlr.gg/event/2973/challengers-2026-korea-wdg-split-2"),
    ("China", "https://www.vlr.gg/event/3059/china-national-tournament-2026-pro-qualifier"),
]


def find_teams(region: str, event_url: str) -> list[dict]:
    """Pull the participating clubs off an event page."""
    html = _get(event_url.rstrip("/") + "/")
    out, seen = [], set()
    for m in re.finditer(
        r'href="(/team/(\d+)/[^"]*)"[^>]*>(.*?)</a>', html, re.S,
    ):
        href, tid, label = m.group(1), m.group(2), _text(m.group(3))
        # the anchor holds the club name then its country on a second line
        name = re.split(r"\s{2,}|\n", label)[0].strip()
        if not name or tid in seen:
            continue
        seen.add(tid)
        out.append({"vlrId": tid, "name": name, "url": f"https://www.vlr.gg{href}", "region": region})
    return out


def fetch_roster(team: dict) -> dict:
    """Read a club's current roster off its team page."""
    html = _get(team["url"])
    players = []
    # the roster block lists each player as a /player/<id>/<alias> card
    for m in re.finditer(
        r'href="/player/(\d+)/([^"]+)"[^>]*>(.*?)(?=href="/player/|</div>\s*</div>\s*</div>)',
        html, re.S,
    ):
        pid, slug, blob = m.group(1), m.group(2), m.group(3)
        alias = _text(re.search(r'class="text-of"[^>]*>(.*?)<', blob, re.S).group(1)) \
            if re.search(r'class="text-of"', blob) else slug
        real = ""
        rm = re.search(r'class="ge-text-light"[^>]*>(.*?)<', blob, re.S)
        if rm:
            real = _text(rm.group(1))
        role = "staff" if re.search(r"(coach|manager|analyst)", blob, re.I) else "player"
        if not alias:
            continue
        players.append({"vlrId": pid, "ign": alias, "name": real, "role": role})

    # de-duplicate, keep order
    seen, uniq = set(), []
    for p in players:
        if p["vlrId"] in seen:
            continue
        seen.add(p["vlrId"])
        uniq.append(p)
    return {**team, "roster": uniq}


# vlr.gg publishes a stats table per event. Reading that gives every Challengers
# player's real numbers in ONE request per league instead of one per player —
# ~250 page loads avoided, which is the difference between a polite run and a
# rude one.
STAT_COLS = ("rating2", "acs", "kd", "kast", "adr", "kpr", "apr", "fkpr", "fdpr", "hs", "cl")


def fetch_event_stats(event_url: str) -> list[dict]:
    """Every player's line for one event, plus the agents they actually played."""
    m = re.search(r"/event/(\d+)/([^/?#]+)", event_url)
    if not m:
        return []
    html = _get(f"https://www.vlr.gg/event/stats/{m.group(1)}/{m.group(2)}")
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", html, re.S):
        pm = re.search(r'href="/player/(\d+)/', tr)
        if not pm:
            continue
        name = re.search(r'class="st-pl-name text-of">(.*?)<', tr, re.S)
        club = re.search(r'class="st-pl-country">(.*?)<', tr, re.S)
        row = {
            "vlrId": pm.group(1),
            "ign": _text(name.group(1)) if name else "",
            "club": _text(club.group(1)) if club else "",
            "agents": [
                a for a in re.findall(r"/img/vlr/game/agents/([a-z0-9_-]+)\.png", tr)
            ],
        }
        for col in STAT_COLS:
            cm = re.search(rf'data-col="{col}"[^>]*>(.*?)</td>', tr, re.S)
            row[col] = _text(cm.group(1)) if cm else ""
        mm = re.search(r'data-col="maps"[^>]*>(.*?)</td>', tr, re.S)
        row["maps"] = _text(mm.group(1)) if mm else ""
        if row["ign"]:
            rows.append(row)
    return rows


# Some leagues (the China National Tournament among them) have no stats tab at
# all. For those, fall back to each player's own page — real career numbers,
# at the cost of one request per player instead of one per league.
def fetch_player_stats(vlr_id: str, slug: str) -> dict | None:
    """Aggregate a player's per-agent table into one weighted line."""
    html = _get(f"https://www.vlr.gg/player/{vlr_id}/{slug}/?timespan=all")
    rows = re.findall(r'<td class="mod-agent">(.*?)</tr>', html, re.S)
    tot = {k: 0.0 for k in ("rnd", "k", "d", "a", "fk", "fd")}
    wsum = {k: 0.0 for k in ("R", "acs", "kd", "kast", "adr", "kpr", "apr")}
    seen: dict[str, float] = {}          # rounds actually backing each column
    agents = []
    for blob in rows:
        am = re.search(r"/img/vlr/game/agents/([a-z0-9_-]+)\.png", blob)
        # The capture starts inside the agent cell, so findall already skips it:
        # vals[0] is Use, vals[1] is Rnd. Dropping one more shifted every column
        # by one — ACS was stored as the rating, K:D as ACS — which is what put
        # rating "195" on a Challengers player and sorted him top of his squad.
        #   Use  Rnd  R  ACS  K:D  KAST  ADR  KPR  APR  FK:FD  K  D  A  FK  FD
        vals = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", blob, re.S)]
        if len(vals) < 15:
            continue

        def f(x):
            try:
                return float(str(x).replace("%", ""))
            except ValueError:
                return None

        rnd = f(vals[1])
        if not rnd:
            continue
        if am:
            agents.append(am.group(1))
        tot["rnd"] += rnd
        for i, k in ((10, "k"), (11, "d"), (12, "a"), (13, "fk"), (14, "fd")):
            if i < len(vals) and f(vals[i]) is not None:
                tot[k] += f(vals[i])
        # R and KAST are blank on splits that predate those columns; weight each
        # column by the rounds that actually carried it, not by every round
        for i, k in ((2, "R"), (3, "acs"), (4, "kd"), (5, "kast"), (6, "adr"), (7, "kpr"), (8, "apr")):
            v = f(vals[i]) if i < len(vals) else None
            if v is not None:
                wsum[k] += v * rnd
                seen[k] = seen.get(k, 0) + rnd
    if not tot["rnd"]:
        return None
    out = {k: round(v / seen[k], 3) for k, v in wsum.items() if seen.get(k)}
    if out.get("kast") and out["kast"] > 1:
        out["kast"] = round(out["kast"] / 100, 3)
    out["fkpr"] = round(tot["fk"] / tot["rnd"], 3)
    out["fdpr"] = round(tot["fd"] / tot["rnd"], 3)
    out["rnd"] = int(tot["rnd"])
    out["agents"] = agents
    return out


def load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text("utf-8"))
    return {"teams": {}}


def save_cache(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), "utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N new team pages")
    args = ap.parse_args()

    cache = load_cache()
    done: dict = cache.setdefault("teams", {})
    stats: dict = cache.setdefault("stats", {})
    print(f"cache holds {len(done)} teams; interval {MIN_INTERVAL}s")

    try:
        wanted: list[dict] = []
        for region, url in LEAGUES:
            found = find_teams(region, url)
            print(f"  {region}: {len(found)} clubs on the event page")
            wanted.extend(found)

        todo = [t for t in wanted if t["vlrId"] not in done]
        if args.limit:
            todo = todo[: args.limit]
        print(f"{len(todo)} team pages to fetch "
              f"(~{len(todo) * MIN_INTERVAL / 60:.1f} min at this pace)")

        for region, url in LEAGUES:
            if url in stats:
                continue
            rows = fetch_event_stats(url)
            stats[url] = rows
            print(f"  stats {region}: {len(rows)} player lines")
            save_cache(cache)

        for i, team in enumerate(todo, 1):
            full = fetch_roster(team)
            # merge, never overwrite: a previous run's data is not thrown away
            done[team["vlrId"]] = {**done.get(team["vlrId"], {}), **full}
            print(f"  [{i}/{len(todo)}] {team['name']:<28} "
                  f"{len([p for p in full['roster'] if p['role'] == 'player'])} players")
            save_cache(cache)

        # top up the leagues whose event page carries no stats at all
        covered = {r["ign"].lower() for lines in stats.values() for r in lines}
        players: dict = cache.setdefault("players", {})
        gaps = []
        for t in done.values():
            if any(p["ign"].lower() in covered for p in t["roster"]):
                continue
            for pl in t["roster"]:
                if pl["role"] != "player" or pl["vlrId"] in players:
                    continue
                gaps.append((t["name"], pl))
        if gaps:
            print(f"{len(gaps)} players have no event stats; reading their own pages "
                  f"(~{len(gaps) * MIN_INTERVAL / 60:.1f} min)")
        for i, (club, pl) in enumerate(gaps, 1):
            slug = re.sub(r"[^a-z0-9]+", "-", pl["ign"].lower()).strip("-") or "p"
            line = fetch_player_stats(pl["vlrId"], slug)
            if line:
                players[pl["vlrId"]] = {**line, "ign": pl["ign"], "club": club}
            print(f"  [{i}/{len(gaps)}] {club} · {pl['ign']}: "
                  f"{'ok' if line else 'no data'}")
            save_cache(cache)

    except RateLimited as e:
        save_cache(cache)
        print(f"\n!! {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        save_cache(cache)
        print("\ninterrupted — progress saved", file=sys.stderr)
        return 1

    save_cache(cache)
    lines = sum(len(v) for v in stats.values())
    print(f"\ndone. {len(done)} teams, {lines} stat lines → {CACHE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
