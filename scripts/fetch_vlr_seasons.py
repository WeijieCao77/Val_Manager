"""Per-event stat lines for three VCT seasons, so ability can see a trajectory.

The career scrape gives one flattened line per player, which cannot tell the
difference between three consistent years and a decline. ZmjjKK has been strong
throughout and especially at international events; Lysoar was poor in 2024,
reached worlds in 2025 and has been steady since. Averaged together, the first
looks worse than he is and the second looks like his 2025 self.

An event's stats page carries every participant's line for that event, so 45
requests cover 2024-2026 completely — by year, and by how big the stage was.
Writes only to scripts/cache/vlr_seasons.json.

Same rules as the other vlr scrapers: >= 3s between requests, abort and save on
429/403, cache merges rather than overwrites.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_seasons.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0

SEASON_PAGES = [
    ("2024", "https://www.vlr.gg/vct-2024"),
    ("2025", "https://www.vlr.gg/vct-2025"),
    ("2026", "https://www.vlr.gg/vct-2026"),
]

STAT_COLS = ("rating2", "acs", "kd", "kast", "adr", "kpr", "apr", "fkpr", "fdpr", "hs")


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
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(f"vlr.gg answered {e.code}. Stopping, progress saved.") from e
        raise


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def tier_of(slug: str) -> str:
    """How big a stage this was — the thing a flat average cannot see."""
    if "champions" in slug and "champions-tour" not in slug and "tour" not in slug:
        return "champions"
    if "masters" in slug:
        return "masters"
    if "kickoff" in slug:
        return "kickoff"
    return "league"


def discover() -> dict[str, dict]:
    events: dict[str, dict] = {}
    for year, url in SEASON_PAGES:
        html = _get(url)
        for eid, slug in re.findall(r'href="/event/(\d+)/([^"?]+)"', html):
            events.setdefault(eid, {"slug": slug, "year": int(year), "tier": tier_of(slug)})
    return events


def event_stats(eid: str, slug: str) -> list[dict]:
    """Every player's line for one event."""
    html = _get(f"https://www.vlr.gg/event/stats/{eid}/{slug}")
    rows = []

    def f(x):
        try:
            return float(str(x).replace("%", ""))
        except (TypeError, ValueError):
            return None

    for tr in re.findall(r"<tr>(.*?)</tr>", html, re.S):
        if not re.search(r'href="/player/\d+/', tr):
            continue
        name = re.search(r'class="st-pl-name text-of">(.*?)<', tr, re.S)
        club = re.search(r'class="st-pl-country">(.*?)<', tr, re.S)
        if not name:
            continue
        row: dict = {"ign": _text(name.group(1)), "club": _text(club.group(1)) if club else ""}
        for col in STAT_COLS:
            m = re.search(rf'data-col="{col}"[^>]*>(.*?)</td>', tr, re.S)
            row[col] = f(_text(m.group(1))) if m else None
        m = re.search(r'data-col="rnd"[^>]*>(.*?)</td>', tr, re.S)
        row["rnd"] = f(_text(m.group(1))) if m else None
        m = re.search(r'data-col="cl"[^>]*>(.*?)</td>', tr, re.S)
        cm = re.match(r"(\d+)/(\d+)", _text(m.group(1))) if m else None
        row["clw"], row["clt"] = (int(cm.group(1)), int(cm.group(2))) if cm else (None, None)
        if row["rnd"]:
            rows.append(row)
    return rows


def main() -> int:
    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}
    events: dict = cache.setdefault("events", {})
    stats: dict = cache.setdefault("stats", {})

    try:
        found = discover()
        print(f"{len(found)} events across 2024-2026", flush=True)
        events.update(found)

        todo = [(k, v) for k, v in events.items() if k not in stats]
        print(f"{len(todo)} to fetch (~{len(todo) * MIN_INTERVAL / 60:.0f} min)", flush=True)
        for i, (eid, meta) in enumerate(todo, 1):
            rows = event_stats(eid, meta["slug"])
            stats[eid] = rows
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
            print(f"  [{i}/{len(todo)}] {meta['year']} {meta['tier']:9} "
                  f"{meta['slug'][:44]:44} {len(rows):3} lines", flush=True)
    except RateLimited as e:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print(f"\n!! {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print("\ninterrupted — progress saved", file=sys.stderr)

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
    total = sum(len(v) for v in stats.values())
    print(f"\ndone. {len(stats)} events, {total} stat lines -> {CACHE.relative_to(ROOT)}")
    print("nothing else touched; build_world.py does not read this yet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
