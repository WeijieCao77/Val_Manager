"""Young players from below the leagues we simulate, for the youth pool.

The world is 518 real professionals and it only ages. Players retire, nobody
arrives, and by the sixth or seventh season squads are down to five, the market
is empty, and every mechanic built on youth — the winter re-rating, 带新人, the
rivalry drill — is training nobody. The fix cannot be to invent people: this
project's whole premise is that every name in it is a real professional. So the
fix is to go and find more real ones.

They come from where prospects actually come from: the tiers below the leagues
in world.json — regional Challengers splits, academy sides, Game Changers —
players who are 20 or under and not already in the world. They are collected
here into a pool, and the game lets a handful into free agency each year from
2030, so a career that runs long has somebody to sign and somebody to develop.

Same rules as every other scraper in this folder, for the same reason:

  * every request goes through _get(), which sleeps to keep >= MIN_INTERVAL
  * a 429 or 403 aborts the run and saves what was already collected
  * everything is cached and merged, never overwritten, so a re-run costs only
    the pages still missing

Usage:
    python3 scripts/fetch_prospects.py                # resume / top up
    python3 scripts/fetch_prospects.py --limit 20     # only 20 new pages
    python3 scripts/fetch_prospects.py --events       # rediscover event list
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
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "src" / "data" / "world.json"
CACHE = ROOT / "scripts" / "cache" / "vlr_prospects.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")

MIN_INTERVAL = 3.0
_last_call = 0.0

# 20 and under: old enough to have a vlr page with a real name and a position,
# young enough that arriving in 2030 still leaves a career to simulate.
MAX_AGE = 20


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


def load(p: Path, fallback):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return fallback


# ---------------------------------------------------------------- discovery

# Where prospects are: the tiers under the partnered leagues. Listed by vlr's
# own event-series pages so a re-run picks up whatever ran most recently rather
# than a list of ids frozen the day this was written.
SERIES = [
    "https://www.vlr.gg/events/china",
    "https://www.vlr.gg/events/europe",
    "https://www.vlr.gg/events/north-america",
    "https://www.vlr.gg/events/asia-pacific",
    "https://www.vlr.gg/events/latin-america",
    "https://www.vlr.gg/events/brazil",
    "https://www.vlr.gg/events/korea",
    "https://www.vlr.gg/events/japan",
]

EVENT_RE = re.compile(r'href="(/event/(\d+)/[^"]+)"[^>]*>(.*?)</a>', re.S)
# Challengers, academies and Game Changers — everything below the franchised
# league, which is exactly the population world.json does not already hold.
WANTED = re.compile(
    r"challengers|academy|ascension|game\s*changers|collegiate|rising", re.I)
SKIP = re.compile(r"masters|champions\b|vct.*(kickoff|stage)", re.I)


def discover_events(cache: dict, limit: int) -> list[str]:
    """Event ids worth walking, newest first."""
    found: dict[str, str] = dict(cache.get("events") or {})
    for url in SERIES:
        if limit and len(found) >= limit:
            break
        try:
            html = _get(url)
        except urllib.error.URLError as e:
            print(f"  ?? {url}: {e}", file=sys.stderr)
            continue
        for href, eid, label in EVENT_RE.findall(html):
            name = _text(label)
            if not name or eid in found:
                continue
            if SKIP.search(name) or not WANTED.search(name):
                continue
            # 2025 and 2026 only: an academy roster from 2022 has long since
            # graduated or quit, and would arrive in 2030 aged thirty
            if not re.search(r"202[56]", name):
                continue
            found[eid] = name
    cache["events"] = found
    return list(found)


TEAM_RE = re.compile(r'href="(/team/(\d+)/[^"]+)"', re.S)


def teams_in_event(eid: str) -> list[str]:
    html = _get(f"https://www.vlr.gg/event/{eid}/x")
    return sorted({tid for _, tid in TEAM_RE.findall(html)})


PLAYER_RE = re.compile(r'href="/player/(\d+)/([^"?/]+)"', re.S)


def players_in_team(tid: str) -> list[tuple[str, str]]:
    html = _get(f"https://www.vlr.gg/team/{tid}/x")
    seen: dict[str, str] = {}
    for pid, slug in PLAYER_RE.findall(html):
        seen.setdefault(pid, slug)
    return list(seen.items())


# vlr.gg does not publish an age — the world's ages come from Liquipedia
# birthdates, and so do these. vlr supplies the identity, Liquipedia the date,
# and a prospect without a real recorded birthdate is dropped rather than
# guessed at: the whole point is that these are real people.
REAL_RE = re.compile(r'class="player-real-name[^"]*">\s*([^<]*?)\s*</h2>')
# the h1 carries an inline style, so the class attribute is not the last one —
# an earlier version anchored on `wf-title">` and silently matched nothing,
# which rejected all 691 players it looked at
IGN_RE = re.compile(r'<h1 class="wf-title"[^>]*>\s*([^<]*?)\s*</h1>')
FLAG_RE = re.compile(r'class="flag mod-([a-z]{2})"')
AGENT_RE = re.compile(r'/img/vlr/game/agents/([a-z0-9]+)\.png')


def player_page(pid: str, slug: str) -> dict | None:
    html = _get(f"https://www.vlr.gg/player/{pid}/{slug}")
    im = IGN_RE.search(html)
    ign = _text(im.group(1)) if im else None
    if not ign:
        return None
    rm = REAL_RE.search(html)
    real = _text(rm.group(1)) if rm else None
    nat = FLAG_RE.search(html)
    agents = []
    for a in AGENT_RE.findall(html):
        if a not in agents:
            agents.append(a)
    return {
        "vlr": pid, "ign": ign,
        "real": real or None,
        "nat": nat.group(1) if nat else None,
        "agents": agents[:6],
    }


# ---------------------------------------------------------------- ages

LP_API = "https://liquipedia.net/valorant/api.php"
LP_INTERVAL = 2.5
_lp_last = 0.0
BIRTH_RE = re.compile(r"\|\s*birth_date\s*=\s*(\d{4})-(\d{2})-(\d{2})")
LP_COUNTRY_RE = re.compile(r"\|\s*country\s*=\s*([^\n|]+)")


def _lp(params: dict) -> dict:
    """Liquipedia's own limit for a plain query is far kinder than parse's 31s."""
    global _lp_last
    wait = LP_INTERVAL - (time.monotonic() - _lp_last)
    if wait > 0:
        time.sleep(wait)
    _lp_last = time.monotonic()
    q = urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(
        f"{LP_API}?{q}", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(f"liquipedia answered {e.code}. Stopping.") from e
        raise


def birthdates(igns: list[str], season_year: int = 2026) -> dict[str, dict]:
    """Ages for up to 50 handles a request, straight from the infobox wikitext."""
    out: dict[str, dict] = {}
    for i in range(0, len(igns), 50):
        chunk = igns[i:i + 50]
        data = _lp({
            "action": "query", "prop": "revisions",
            "rvslots": "main", "rvprop": "content",
            "titles": "|".join(chunk),
        })
        pages = (data.get("query") or {}).get("pages") or {}
        for pg in pages.values():
            title = pg.get("title")
            revs = pg.get("revisions")
            if not title or not revs:
                continue
            txt = revs[0]["slots"]["main"]["*"]
            b = BIRTH_RE.search(txt)
            if not b:
                continue
            year = int(b.group(1))
            c = LP_COUNTRY_RE.search(txt)
            out[title.lower()] = {
                "born": f"{b.group(1)}-{b.group(2)}-{b.group(3)}",
                "age": season_year - year,
                "lpCountry": c.group(1).strip().lower() if c else None,
            }
        print(f"  生日 {len(out)}/{min(i + 50, len(igns))}", flush=True)
    return out


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after this many new player pages")
    ap.add_argument("--events", action="store_true",
                    help="re-walk the event series lists")
    ap.add_argument("--ages-only", action="store_true",
                    help="skip vlr, just date the candidates already collected")
    args = ap.parse_args()

    cache = load(CACHE, {})
    for k in ("events", "teams", "players", "rejected", "walked"):
        cache.setdefault(k, {})

    world = load(WORLD, {"players": []})
    known = {p["ign"].lower() for p in world["players"]}
    # Clubs already in the world are not where prospects come from, and their
    # rosters are already known — walking them costs a request per player to
    # discover we have him. Skip the club, not just the man.
    staff = (load(ROOT / "scripts" / "cache" / "vlr_staff.json", {}) or {})
    in_world_teams = {str(v) for v in (staff.get("teams") or {}).values()}

    fresh = 0
    try:
        if not args.ages_only:
            if args.events or not cache["events"]:
                evs = discover_events(cache, 0)
                print(f"事件 {len(evs)} 个")

            for eid in list(cache["events"]):
                if eid in cache["teams"]:
                    continue
                cache["teams"][eid] = teams_in_event(eid)
                print(f"  事件 {eid} {cache['events'][eid][:38]}: "
                      f"{len(cache['teams'][eid])} 队", flush=True)

            tids = sorted({t for lst in cache["teams"].values() for t in lst})
            print(f"待走的战队 {len([t for t in tids if t not in cache['walked']])}"
                  f"/{len(tids)}")
            for tid in tids:
                if args.limit and fresh >= args.limit:
                    break
                if tid in cache["walked"] or tid in in_world_teams:
                    continue
                roster = players_in_team(tid)
                cache["walked"][tid] = len(roster)
                for pid, slug in roster:
                    if args.limit and fresh >= args.limit:
                        break
                    if pid in cache["players"] or pid in cache["rejected"]:
                        continue
                    info = player_page(pid, slug)
                    fresh += 1
                    if not info or info["ign"].lower() in known:
                        cache["rejected"][pid] = 1
                        continue
                    cache["players"][pid] = info
                    print(f"    + {info['ign']:<16} {info['nat'] or '??'}", flush=True)

        # Ages last, in batches of fifty: vlr has no age, Liquipedia has the
        # birthdate, and one request covers fifty handles instead of one.
        undated = [v["ign"] for v in cache["players"].values() if "age" not in v]
        if undated:
            print(f"\n查生日 {len(undated)} 人（每次 50 个）")
            got = birthdates(sorted(set(undated)))
            for v in cache["players"].values():
                hit = got.get(v["ign"].lower())
                if hit:
                    v.update(hit)
                elif "age" not in v:
                    v["age"] = None      # looked up, no recorded birthdate
    except RateLimited as e:
        print(f"\n{e}", file=sys.stderr)
    except KeyboardInterrupt:
        print("\n中断，已保存进度", file=sys.stderr)
    finally:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

    aged = [v for v in cache["players"].values()
            if isinstance(v.get("age"), int) and v["age"] <= MAX_AGE]
    print(f"\n候选 {len(cache['players'])} 人｜其中 {MAX_AGE} 岁及以下且有真实生日的："
          f"{len(aged)} 人")
    if aged:
        for v in sorted(aged, key=lambda x: x["age"])[:8]:
            print(f"  {v['ign']:<16} {v['age']} 岁  {v.get('real') or ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
