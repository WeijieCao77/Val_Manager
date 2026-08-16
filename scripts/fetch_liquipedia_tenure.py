"""Collect full club histories from Liquipedia, in bulk.

vlr.gg only prints the current stint ("joined in March 2026"), one page per
player. Liquipedia has the whole history with day precision — and the
{{TeamHistoryAuto}} template takes a |player= parameter, so many players can be
expanded in a single request:

    {{TeamHistoryAuto|player=Smoggy}}
    -> 2021-01-11 — 2022-07-16  Weibo Gaming
       2022-07-16 — Present     EDward Gaming

That turns ~500 individual page loads into ~20 batched calls, which is both far
faster and far politer. Liquipedia's terms cap action=parse at one per 30s;
this uses action=expandtemplates, which their terms place under the ordinary
>= 2s bucket, and we run slower than that.
"""
from __future__ import annotations

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
RAW = ROOT / "data-raw"
SRC = RAW / "vlr_vct2026_players.txt"
VCL = ROOT / "scripts" / "cache" / "vlr_challengers.json"
OUT = ROOT / "scripts" / "cache" / "liquipedia_tenure.json"

API = "https://liquipedia.net/valorant/api.php"
UA = ("ValManagerGameBuild/0.1 (hobby esports-manager project; "
      "contact: yankejing711@gmail.com)")

MIN_INTERVAL = 3.0     # their terms ask >= 2s for non-parse actions
BATCH = 25
MARK = "@@@"
_last = 0.0


class RateLimited(RuntimeError):
    pass


def _post(params: dict) -> dict:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(
        API, data=urllib.parse.urlencode(params).encode("utf-8"),
        headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimited("Liquipedia returned 429 — stopping, progress saved.") from e
        raise


ROW = re.compile(
    r'th-mono[^>]*>(\d{4}-\d{2}-\d{2})\s*(?:&#8212;|—|-)\s*'
    r'(\d{4}-\d{2}-\d{2}|<span[^>]*>Present</span>|Present).*?'
    r'\[\[([^\]|]+)(?:\|[^\]]*)?\]\](?!\s*\|16px)',
    re.S,
)


def parse_history(chunk: str) -> list[dict]:
    """Turn one player's expanded table into [{from, to, team}]."""
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", chunk, re.S):
        when = re.search(
            r'th-mono[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*(?:&#8212;|—)\s*(.*?)</td>', row, re.S)
        if not when:
            continue
        end_raw = re.sub(r"<[^>]+>", "", when.group(2)).strip()
        # the club link is the last wiki link in the row; the first is the icon
        links = re.findall(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]", row)
        team = None
        for target, label in links:
            if target.startswith("File:"):
                continue
            team = (label or target).strip()
        if not team:
            continue
        out.append({
            "from": when.group(1),
            "to": None if end_raw.lower().startswith("present") else end_raw,
            "team": team,
        })
    return out


def wanted_players() -> list[str]:
    igns = []
    if SRC.exists():
        for line in SRC.read_text("utf-8").splitlines():
            p = line.split("|")
            if p and p[0].strip():
                igns.append(p[0].strip())
    if VCL.exists():
        v = json.loads(VCL.read_text("utf-8"))
        for t in v.get("teams", {}).values():
            for pl in t.get("roster", []):
                if pl.get("role") == "player":
                    igns.append(pl["ign"])
    return list(dict.fromkeys(igns))


def main() -> int:
    cache = json.loads(OUT.read_text("utf-8")) if OUT.exists() else {}
    igns = wanted_players()
    todo = [i for i in igns if i not in cache]
    print(f"{len(igns)} players, {len(todo)} to fetch "
          f"in {-(-len(todo) // BATCH)} batches", flush=True)

    try:
        for i in range(0, len(todo), BATCH):
            chunk = todo[i:i + BATCH]
            # MediaWiki capitalises the first letter of every page title, and
            # the lookup is case-sensitive: player=basic returns nothing while
            # player=Basic returns five stints. Ask for the capitalised form.
            text = f"{MARK}".join(
                f"{n}{MARK}{{{{TeamHistoryAuto|player={n[:1].upper() + n[1:]}}}}}"
                for n in chunk)
            d = _post({
                "action": "expandtemplates", "text": text, "title": chunk[0],
                "prop": "wikitext", "format": "json", "formatversion": "2",
            })
            body = d.get("expandtemplates", {}).get("wikitext", "")
            parts = body.split(MARK)
            # parts alternate: name, table, name, table, ...
            for j in range(0, len(parts) - 1, 2):
                name = parts[j].strip()
                if name not in chunk:
                    continue
                cache[name] = parse_history(parts[j + 1])
            OUT.parent.mkdir(parents=True, exist_ok=True)
            OUT.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
            hit = sum(1 for v in cache.values() if v)
            print(f"  batch {i // BATCH + 1}/{-(-len(todo) // BATCH)}: "
                  f"{hit} players with a history", flush=True)
    except RateLimited as e:
        print(f"\n!! {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\ninterrupted — progress saved", file=sys.stderr)

    OUT.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
    hit = sum(1 for v in cache.values() if v)
    print(f"\ndone. histories for {hit}/{len(cache)} -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
