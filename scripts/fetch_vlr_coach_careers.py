"""
Every club coach's own coaching career, from vlr.gg.

    python3 scripts/fetch_vlr_coach_careers.py                 # fetch whoever is missing
    python3 scripts/fetch_vlr_coach_careers.py --parse-file x  # check the parser, no network

Writes ONLY scripts/cache/vlr_coach_careers.json:

    { "bail": { "vlrId": "980", "fetched": "2026-09-10",
                "stints": [ { "team": "Bilibili Gaming", "vlrTeamId": "12010",
                              "role": "head coach", "from": "2024-03", "to": "2025-10" }, ... ] } }

Why: 默契 was asked to know the men a coach has coached before — 「bail 和 JDG、
BLG 的人都不显示带过」 — and nothing in the repo records a coach's own clubs:
vlr_staff.json, liquipedia_coaches.json and the Liquipedia tenure cache are all
current staff or players. vlr prints it on the staff member's own page, under
Current Teams and Past Teams, with the role and the months.

The rules are the scraping-rate-limits memory's, tightened: vlr has limited this
IP before, so one request at a time and at least 8 s apart (3 s has run clean),
stop and save on 429/403, the cache merges and is written after every coach, and
a coach already fetched is never fetched again. No contact address in the
User-Agent.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "src" / "data" / "world.json"
DOSSIER = ROOT / "src" / "data" / "dossier.json"
CACHE = ROOT / "scripts" / "cache" / "vlr_coach_careers.json"

UA = "ValManagerGameBuild/0.1 (hobby esports-manager project)"
MIN_INTERVAL = 8.0
_last = 0.0

MONTHS = {m: i + 1 for i, m in enumerate([
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
])}


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
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (429, 403):
            raise RateLimited(f"vlr.gg answered {e.code}. Stopping; progress is saved.") from e
        raise


def _month(text: str) -> str | None:
    m = re.search(r"([A-Za-z]+)\s+(\d{4})", text)
    if not m or m.group(1) not in MONTHS:
        return None
    return f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", fragment)).strip()


def stints(html: str) -> list[dict]:
    """Current and past teams off a vlr player/staff page, with role and months."""
    out: list[dict] = []
    for section, current in (("Current Teams", True), ("Past Teams", False)):
        i = html.find(section)
        if i < 0:
            continue
        j = html.find("<h2", i + len(section))
        block = html[i: j if j > 0 else len(html)]
        for m in re.finditer(r'<a class="wf-module-item[^"]*"\s+href="/team/(\d+)/[^"]*"[^>]*>(.*?)</a>', block, re.S):
            inner = m.group(2)
            name = re.search(r'font-weight:\s*500;?"[^>]*>(.*?)</div>', inner, re.S)
            role = re.search(r'class="wf-tag[^"]*"[^>]*>(.*?)</span>', inner, re.S)
            lines = [_text(x) for x in re.findall(r'class="ge-text-light"[^>]*>(.*?)</div>', inner, re.S)]
            frm = to = None
            for line in lines:
                if line.startswith("Inactive"):
                    continue
                if line.startswith("joined in"):
                    frm = _month(line)
                elif "–" in line or " - " in line:
                    a, _, b = re.split(r"\s*(–|-)\s*", line, maxsplit=1)
                    frm, to = _month(a), (None if "present" in b.lower() else _month(b))
            out.append({
                "team": _text(name.group(1)) if name else None,
                "vlrTeamId": m.group(1),
                "role": _text(role.group(1)) if role else None,
                "from": frm,
                "to": None if current else to,
                "current": current,
            })
    return out


def coaches() -> list[tuple[str, str | None]]:
    """Every club head coach and hired analyst, with the vlr id the dossier holds for them."""
    world = json.loads(WORLD.read_text("utf-8"))
    dossier = (json.loads(DOSSIER.read_text("utf-8")).get("coaches") or {})
    names = {(t.get("coach") or {}).get("name") for t in world["teams"]} - {None}
    names |= {a.get("name") for a in (world.get("meta") or {}).get("analysts") or [] if a.get("name")}
    return [(n, (dossier.get(n) or {}).get("vlr")) for n in sorted(names)]


def load_cache() -> dict:
    return json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {}


def save_cache(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    tmp.replace(CACHE)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parse-file", help="parse a saved vlr page and print it; no network")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many fetches")
    args = ap.parse_args()

    if args.parse_file:
        print(json.dumps(stints(Path(args.parse_file).read_text("utf-8", "replace")), ensure_ascii=False, indent=1))
        return 0

    cache = load_cache()
    todo = [(n, v) for n, v in coaches() if v and n not in cache]
    no_id = [n for n, v in coaches() if not v]
    print(f"{len(todo)} coaches to fetch, {len(cache)} already cached, {len(no_id)} without a vlr id: {no_id}", flush=True)
    done = 0
    try:
        for name, vid in todo:
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "x"
            try:
                html = _get(f"https://www.vlr.gg/player/{vid}/{slug}")
            except urllib.error.HTTPError as e:
                cache[name] = {"vlrId": vid, "error": e.code, "fetched": dt.date.today().isoformat()}
                save_cache(cache)
                print(f"  {name}: HTTP {e.code}, recorded", flush=True)
                continue
            got = stints(html)
            cache[name] = {"vlrId": vid, "stints": got, "fetched": dt.date.today().isoformat()}
            save_cache(cache)
            coaching = [s for s in got if s["role"] and "coach" in s["role"].lower()]
            print(f"  {name}: {len(got)} stints, {len(coaching)} coaching — "
                  + ", ".join(f"{s['team']} {s['from'] or '?'}~{s['to'] or ('now' if s['current'] else '?')}" for s in coaching), flush=True)
            done += 1
            if args.limit and done >= args.limit:
                break
    except RateLimited as e:
        save_cache(cache)
        print(str(e), flush=True)
        return 2
    print(f"done: fetched {done}, cache holds {len(cache)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
