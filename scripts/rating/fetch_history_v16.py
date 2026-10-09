#!/usr/bin/env python3
"""
Raw vlr.gg pages for rating retired players with the live card algorithm.

    python3 -m scripts.rating.fetch_history_v16 [--with-challengers] [--limit N]

Reads analysis/rating/history_v16/retired_fetch_list.json (event stats pages,
event pages for dates/placements, player pages for status) and stores each page
untouched under analysis/rating/history_v16/raw/. Parsing happens offline.

`--main-stages` is a second pass: a 2020-21 stats page pools the open
qualifiers (pros against amateurs) with the main event. For every stats page
on disk whose stage board has a qualifier group, the same page is fetched once
more with vlr's own `exclude=<sub-stage ids>` filter and kept as
stats_<id>_main.html, so qualifier rounds can be scored as the lower tier
they are.

One request at a time, at least 10 s apart; the first 403/429 stops the run.
Pages already on disk are never fetched again; every request is logged.
"""
from __future__ import annotations
import argparse, gzip, json, re, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "analysis" / "rating" / "history_v16"
RAW = BASE / "raw"
LOG = BASE / "requests.jsonl"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project)"
INTERVAL = 10.0


def name_for(url: str) -> str:
    m = re.match(r"https://www\.vlr\.gg/(event/stats|event|player)/(\d+)", url)
    kind = {"event/stats": "stats", "event": "event", "player": "player"}[m.group(1)]
    return f"{kind}_{m.group(2)}.html"


# "A Playoffs" / "A/B Playoffs" are the open qualifiers' own brackets (First Strike)
QUALIFIER = re.compile(r"qualif|open|closed|play-?in|last chance|lcq|^[A-Z](?:/[A-Z])? Playoffs$", re.I)


def stage_groups(html: str) -> list[tuple[str, list[str]]]:
    """[(group label, [sub-stage ids])] from a stats page's stage board"""
    out = []
    for block in re.findall(r'<div class="st-ss-group">(.*?)</div>\s*</div>', html, re.S):
        lbl = re.search(r'<span>(.*?)</span>', block, re.S)
        ids = re.findall(r'class="st-ss"[^>]*value="(\d+)"', block)
        if lbl and ids:
            out.append((lbl.group(1).strip(), ids))
    return out


def main_stage_urls() -> dict[str, str]:
    """stats page -> its main-event-only url, for pages that pool qualifiers"""
    out = {}
    for f in sorted(RAW.glob("stats_*.html")):
        if f.stem.endswith("_main"):
            continue
        html = f.read_text("utf-8", "ignore")
        groups = stage_groups(html)
        drop = [i for lbl, ids in groups if QUALIFIER.search(lbl.strip()) for i in ids]
        keep = [i for lbl, ids in groups if not QUALIFIER.search(lbl.strip()) for i in ids]
        canon = re.search(r'<a class="wf-nav-item mod-active" href="(/event/stats/\d+/[^"]+)"', html)
        slug = canon.group(1).rsplit("/", 1)[-1] if canon else ""
        year = re.search(r"Dates\s*</div>\s*<div class=\"value\"[^>]*>[^<]*?(\d{4})", html)
        from scripts.rating.history_v16_data import tier_level
        if tier_level(slug, int(year.group(1)) if year else 2022)[1] != "top":
            continue  # a t2 event is t2 whole; splitting it changes nothing
        if drop and keep and canon:
            out[f"stats_{f.stem.split('_')[1]}_main.html"] = f"https://www.vlr.gg{canon.group(1)}?exclude={'.'.join(drop)}"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-challengers", action="store_true")
    ap.add_argument("--standings", action="store_true", help="also the P3 event pages (final standings)")
    ap.add_argument("--main-stages", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if a.main_stages:
        names = main_stage_urls()
        todo = [u for n, u in names.items() if not (RAW / n).exists()]
        global name_for
        by_url = {u: n for n, u in names.items()}
        name_for = lambda u: by_url[u]  # noqa: E731
    else:
        plan = json.loads((BASE / "retired_fetch_list.json").read_text())
        tiers = ({"P1", "P2"} if a.with_challengers else {"P1"}) | ({"P3"} if a.standings else set())
        urls = [p["statsUrl"] for p in plan["statsPages"] if p["priority"] in tiers]
        urls += [p["eventUrl"] for p in plan["eventPages"] if p["priority"] in tiers]
        urls += [p["url"] for p in plan["profilePages"]]
        todo = [u for u in dict.fromkeys(urls) if not (RAW / name_for(u)).exists()]
    print(f"{len(todo)} pages to fetch, {INTERVAL:.0f} s apart", flush=True)
    last = 0.0
    for i, url in enumerate(todo):
        if a.limit and i >= a.limit:
            break
        wait = INTERVAL - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        status = None
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                status = r.status
                body = gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
            (RAW / name_for(url)).write_bytes(body)
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:  # network hiccup: log and move on, never hammer
            status = f"error:{e}"
        with LOG.open("a") as f:
            f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "url": url, "status": status}) + "\n")
        print(f"{i + 1}/{len(todo)} {status} {url}", flush=True)
        if status in (403, 429):
            print("rate limited: stopping, nothing retried", flush=True)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
