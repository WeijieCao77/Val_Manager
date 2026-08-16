"""Collect career-long stats for every modelled player, into its own cache.

Why: attributes are currently derived from a single season (VCT 2026), so a
player having a bad year is modelled as a worse player. ZmjjKK won in 2024 and
has been good throughout; one poor split should move his *form*, not his
ceiling. The fix is to derive ability from a career window and let form carry
the slump — but that means re-deriving every attribute in the game, so the data
is gathered first and nothing is switched over until it is all here.

This writes ONLY to scripts/cache/vlr_career.json. It does not touch
src/data/world.json, and build_world.py does not read it yet.

vlr.gg publishes no crawl-delay; this project has been rate-limited once before
by volume, so >= 3s between requests, abort and save on 429/403, and the cache
merges rather than overwrites.
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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_career.json"
VCL = ROOT / "scripts" / "cache" / "vlr_challengers.json"
TENURE = ROOT / "scripts" / "cache" / "vlr_tenure.json"

UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")
MIN_INTERVAL = 3.0
_last = 0.0

# every club in each league, not just the ones that qualified for a given stage
SOURCES = [
    "https://www.vlr.gg/rankings/americas",
    "https://www.vlr.gg/rankings/europe",
    "https://www.vlr.gg/rankings/asia-pacific",
    "https://www.vlr.gg/rankings/china",
]


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
            raise RateLimited(
                f"vlr.gg answered {e.code}. Stopping and saving. Do not lower MIN_INTERVAL."
            ) from e
        raise


def career_line(html: str) -> dict | None:
    """Aggregate a player's per-agent career table into one weighted line."""
    rows = re.findall(r'<td class="mod-agent">(.*?)</tr>', html, re.S)
    tot = {k: 0.0 for k in ("rnd", "k", "d", "a", "fk", "fd")}
    wsum = {k: 0.0 for k in ("R", "acs", "kd", "kast", "adr", "kpr", "apr")}
    seen: dict[str, float] = {}          # rounds backing each column
    agents: list[str] = []

    def f(x):
        try:
            return float(str(x).replace("%", ""))
        except ValueError:
            return None

    for blob in rows:
        am = re.search(r"/img/vlr/game/agents/([a-z0-9_-]+)\.png", blob)
        # The capture starts inside the agent cell, so findall already skips it:
        # cells[0] is Use, cells[1] is Rnd. An earlier version dropped one more,
        # which shifted every column — ACS was read as rating and K:D as ACS.
        #   Use  Rnd  R  ACS  K:D  KAST  ADR  KPR  APR  FK:FD  K  D  A  FK  FD
        cells = [re.sub(r"<[^>]+>", "", c).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", blob, re.S)]
        if len(cells) < 15:
            continue
        rnd = f(cells[1])
        if not rnd:
            continue
        if am:
            agents.append(am.group(1))
        tot["rnd"] += rnd
        for i, k in ((10, "k"), (11, "d"), (12, "a"), (13, "fk"), (14, "fd")):
            if f(cells[i]) is not None:
                tot[k] += f(cells[i])
        # R and KAST are blank on older splits; weight only what is present
        for i, k in ((2, "R"), (3, "acs"), (4, "kd"), (5, "kast"),
                     (6, "adr"), (7, "kpr"), (8, "apr")):
            v = f(cells[i])
            if v is not None:
                wsum[k] += v * rnd
                seen[k] = seen.get(k, 0) + rnd

    if not tot["rnd"]:
        return None
    # divide by the rounds that actually carried that column, not every round
    out = {k: round(v / seen[k], 3) for k, v in wsum.items() if seen.get(k)}
    out["kast"] = round(out["kast"] / 100, 3) if out["kast"] > 1 else out["kast"]
    out["fkpr"] = round(tot["fk"] / tot["rnd"], 3)
    out["fdpr"] = round(tot["fd"] / tot["rnd"], 3)
    out["rnd"] = int(tot["rnd"])
    out["agents"] = agents
    return out


def player_ids(cache: dict) -> dict[str, str]:
    """{ign: vlrId} for every club in every modelled league."""
    known: dict = cache.setdefault("_teams", {})
    out: dict[str, str] = {}

    # challengers players already carry their ids from the earlier scrape
    if VCL.exists():
        v = json.loads(VCL.read_text("utf-8"))
        for t in v.get("teams", {}).values():
            for p in t.get("roster", []):
                if p.get("role") == "player":
                    out[p["ign"]] = p["vlrId"]
        for lines in v.get("stats", {}).values():
            for r in lines:
                out.setdefault(r["ign"], r["vlrId"])

    # Only clubs the game actually models. The ranking pages list every team in
    # the region — walking all of them was ~200 wasted page loads and most of a
    # scrape budget spent on clubs that do not exist in this world.
    world = json.loads((ROOT / "src" / "data" / "world.json").read_text("utf-8"))
    wanted_slugs = {
        re.sub(r"[^a-z0-9]+", "-", t["name"].lower()).strip("-")
        for t in world["teams"]
    }
    teams: dict[str, str] = {}
    for url in SOURCES:
        for m in re.finditer(r'href="/team/(\d+)/([^"?]+)"', _get(url)):
            if m.group(2) in wanted_slugs:
                teams[m.group(1)] = m.group(2)
    print(f"  {len(teams)} of the game's clubs found on the rankings", flush=True)

    for i, (tid, slug) in enumerate(sorted(teams.items()), 1):
        if tid in known:
            out.update(known[tid])
            continue
        html = _get(f"https://www.vlr.gg/team/{tid}/{slug}")
        roster: dict[str, str] = {}
        for m in re.finditer(r'<div class="team-roster-item">(.*?)</div>\s*</a>', html, re.S):
            item = m.group(1)
            pid = re.search(r'href="/player/(\d+)/', item)
            alias = re.search(r'class="team-roster-item-name-alias"[^>]*>(.*?)</div>', item, re.S)
            if not pid or not alias:
                continue
            name = re.sub(r"<[^>]+>", "", alias.group(1)).strip()
            if name and not re.search(r"(coach|manager|analyst)", item, re.I):
                roster[name] = pid.group(1)
        known[tid] = roster
        out.update(roster)
        # save as we go: a killed run used to throw away the whole walk
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        if i % 10 == 0:
            print(f"  [{i}/{len(teams)}] rosters read, {len(out)} players known", flush=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}
    try:
        ids = player_ids(cache)
    except RateLimited as e:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print(f"!! {e}", file=sys.stderr)
        return 2

    todo = [(n, i) for n, i in ids.items()
            if i and n not in cache and not n.startswith("_")]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(ids)} players known, {len(todo)} to fetch "
          f"(~{len(todo) * MIN_INTERVAL / 60:.0f} min)", flush=True)

    try:
        for i, (ign, vid) in enumerate(todo, 1):
            slug = re.sub(r"[^a-z0-9]+", "-", ign.lower()).strip("-") or "p"
            line = career_line(_get(f"https://www.vlr.gg/player/{vid}/{slug}/?timespan=all"))
            cache[ign] = line or {"miss": True}
            if i % 10 == 0 or i == len(todo):
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
                got = sum(1 for k, v in cache.items()
                          if not k.startswith("_") and not v.get("miss"))
                print(f"  [{i}/{len(todo)}] {ign}: {got} with career data", flush=True)
    except RateLimited as e:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print(f"\n!! {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print("\ninterrupted — progress saved", file=sys.stderr)

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
    got = sum(1 for k, v in cache.items() if not k.startswith("_") and not v.get("miss"))
    tot = sum(1 for k in cache if not k.startswith("_"))
    print(f"\ndone. career stats for {got}/{tot} -> {CACHE.relative_to(ROOT)}")
    print("nothing else was touched; build_world.py still uses the 2026 file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
