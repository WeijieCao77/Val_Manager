#!/usr/bin/env python3
"""
vlr.gg player pages for everybody the historical worlds hold, keyed by vlr id.

    python3 scripts/fetch_vlr_people.py [--limit N] [--all]

vlr_profiles.json is keyed by handle and only covers the 2026 world. The
2023–2025 worlds added ~550 people who have no photograph, and a handle is not
an identity (two zeeks). This reads scripts/cache/people_registry.json (run
build_people_registry.py first) and fetches each person's page by ID.

On top of what fetch_vlr_profiles.py reads (photo, flag, real name, winnings,
placements) it keeps the handle vlr shows today, Current Teams / Past Teams
with their role tag and month range, and the date of the last match — which
is what says whether a man is still playing.

Same manners as every vlr script here: one request at a time, >= 4 s apart,
stop and save on 403/429, the cache merges and never overwrites.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vlr_profiles as fp  # noqa: E402

fp.MIN_INTERVAL = 4.0
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "cache" / "vlr_people.json"
REG = ROOT / "scripts" / "cache" / "people_registry.json"

HANDLE_RE = re.compile(r'<h1 class="wf-title"[^>]*>\s*([\s\S]*?)\s*</h1>')
DATE_RE = re.compile(r'class="m-item-date">\s*<div>\s*(\d{4})/(\d{2})/(\d{2})')
TEAM_RE = re.compile(
    r'<a class="wf-module-item[^"]*" href="/team/(\d+)/([^"]*)"[\s\S]*?'
    r'<div style="font-weight: 500;">\s*([\s\S]*?)\s*</div>\s*'
    r'<div class="ge-text-light"[^>]*>\s*([\s\S]*?)\s*</div>\s*'
    r'<div class="ge-text-light"[^>]*>\s*([\s\S]*?)\s*</div>')


def teams(block: str) -> list[dict]:
    return [{"id": i, "slug": s, "name": fp.text(n), "role": fp.text(r) or None, "when": fp.text(w) or None}
            for i, s, n, r, w in TEAM_RE.findall(block)]


def parse(h: str) -> dict:
    out = fp.parse_profile(h)
    m = HANDLE_RE.search(h)
    out["handle"] = fp.text(m.group(1)) if m else None
    d = DATE_RE.search(h)
    out["lastMatch"] = "-".join(d.groups()) if d else None
    cur = h.find("Current Teams")
    past = h.find("Past Teams")
    end = h.find("Event Placements")
    end = end if end >= 0 else len(h)
    out["current"] = teams(h[cur:past if past >= 0 else end]) if cur >= 0 else []
    out["past"] = teams(h[past:end]) if past >= 0 else []
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--all", action="store_true", help="also the 2026 players (for cross-checks and last match)")
    ap.add_argument("--only", default="", help="comma-separated vlr ids")
    a = ap.parse_args()
    reg = json.loads(REG.read_text())["people"]
    cache = json.loads(OUT.read_text()) if OUT.exists() else {}
    # a 2026 player added after the last profile pass (Marved, Desmo, H1ber,
    # skye) has no row in vlr_profiles.json and so no face or flag at all
    prof_ids = {str(v.get("vlrId")) for k, v in json.loads((ROOT / "scripts" / "cache" / "vlr_profiles.json").read_text()).items()
                if isinstance(v, dict) and v.get("vlrId")}
    want = [v for v, q in reg.items() if a.all or "2026" not in q["years"] or v not in prof_ids]
    if a.only:
        want = [s.strip() for s in a.only.split(",")]
    todo = [v for v in want if v not in cache]
    print(f"{len(want)} wanted, {len(todo)} to fetch", flush=True)
    n = 0
    try:
        for vid in todo:
            try:
                h = fp._get(f"https://www.vlr.gg/player/{vid}/x")
            except fp.RateLimited:
                raise
            except Exception as e:  # one dead page must not cost the run
                print(f"  !! {vid}: {e}", flush=True); continue
            rec = parse(h); rec["vlrId"] = vid
            cache[vid] = rec; n += 1
            cur = ",".join(t["name"] for t in rec["current"]) or "-"
            print(f"  ok {vid:<7} {str(rec['handle']):<16} img={'y' if rec['img'] else '-'} nat={rec['nat'] or '--'} "
                  f"last={rec['lastMatch']} cur={cur}", flush=True)
            if n % 20 == 0:
                OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
            if a.limit and n >= a.limit:
                break
    except fp.RateLimited as e:
        print(f"RATE LIMITED: {e} — saved, stopping", file=sys.stderr, flush=True)
    finally:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    print(f"cached {len(cache)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
