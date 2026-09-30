"""
Every map of Masters Bangkok 2025 with the round it was played in, for
weighting the later rounds of the 曼谷 2025 cards, and the final placements.

    python3 scripts/fetch_bangkok2025_maps.py

Uses fetch_vlr_matches.py's page parser and its 6 s interval (one request at a
time, resume-safe, aborts and saves on a rate limit). Kept in its own cache so
the rating study's 2025-26 match library is untouched.

Cache: scripts/cache/vlr_matches_bangkok2025.json
  matches: { mid: { stage: "Playoffs: Grand Final", label: <list-page text>, maps: [ ...as fetch_vlr_matches ] } }
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vlr_matches as fvm  # noqa: E402  (sets the 6 s interval)

CACHE = fvm.ROOT / "scripts" / "cache" / "vlr_matches_bangkok2025.json"
LIST = "https://www.vlr.gg/event/matches/2281/valorant-masters-bangkok-2025/?series_id=all"
EVENT = "https://www.vlr.gg/event/2281/valorant-masters-bangkok-2025"


def text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def main() -> int:
    cache = json.loads(CACHE.read_text("utf-8")) if CACHE.exists() else {"list": {}, "matches": {}}
    try:
        if not cache["list"]:
            html = fvm.vlr._get(LIST)
            for attrs, body in re.findall(r"<a([^>]*)>(.*?)</a>", html, re.S):
                mid = re.search(r'href="/(\d+)/', attrs)
                if mid and "match-item" in attrs:
                    cache["list"][mid.group(1)] = text(body)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
            print(f"{len(cache['list'])} matches listed", flush=True)
        # the placements, off the event page's prize table (one request)
        if not cache.get("places"):
            html = fvm.vlr._get(EVENT)
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html.split("wf-table", 1)[-1], re.S)
            cache["places"] = [text(r) for r in rows if re.search(r'\b\d+(st|nd|rd|th)\b', text(r))][:12]
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
            print("places:", cache["places"], flush=True)
        todo = [mid for mid in cache["list"] if mid not in cache["matches"]]
        print(f"{len(todo)} matches to fetch (~{len(todo) * fvm.vlr.MIN_INTERVAL / 60:.0f} min)", flush=True)
        for i, mid in enumerate(todo, 1):
            html = fvm.vlr._get(f"https://www.vlr.gg/{mid}/")
            series = re.search(r'match-header-event-series[^>]*>(.*?)</div>', html, re.S)
            cache["matches"][mid] = {"stage": text(series.group(1)) if series else None,
                                     "label": cache["list"][mid], "maps": fvm.parse_match(html)}
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
            print(f"  [{i}/{len(todo)}] {mid}: {cache['matches'][mid]['stage']} · {len(cache['matches'][mid]['maps'])} maps", flush=True)
    except fvm.vlr.RateLimited as e:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        print(f"!! {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
