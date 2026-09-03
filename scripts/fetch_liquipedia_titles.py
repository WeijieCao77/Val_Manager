"""Who has actually won something: Champions and Masters titles off Liquipedia.

  python3 scripts/fetch_liquipedia_titles.py            # everyone in the world file
  python3 scripts/fetch_liquipedia_titles.py --refresh  # re-read the ones already cached

vlr's event placements only list the players who appeared in matches, so a
registered sixth man who lifted the trophy — Haodong at Champions 2024 — is
absent there, while Liquipedia's infobox `achievements` field names every
member the org and Riot recognised. That is the list a champion's credit in
the rating comes from (build_world.py, 冠军底蕴).

Batched `action=query&prop=revisions` at 50 titles a request, 2s apart —
the same terms fetch_liquipedia_faces.py follows — and the page's `country`
field is kept so build_world can refuse a page about somebody else with the
same handle. Titles that live at a suffixed page are mapped in PAGE_OF.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_liquipedia_faces import PAGE_OF, RateLimited, api, chunks, load  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "src" / "data" / "world.json"
OUT = ROOT / "scripts" / "cache" / "lp_titles.json"

# [[VCT/2024/Champions|VALORANT Champions 2024]]  /  [[VCT/2025/Stage 1/Masters|VALORANT Masters Toronto 2025]]
LINK = re.compile(r"\[\[(?:VCT|VALORANT[ _]Champions[ _]Tour)/(\d{4})/([^|\]]+)\|([^\]]+)\]\]")


def titles_of(wikitext: str) -> list[dict]:
    m = re.search(r"\|\s*achievements\s*=(.*?)(?:\n\s*\||\n\}\})", wikitext, re.S)
    if not m:
        return []
    out = []
    for year, path, label in LINK.findall(m.group(1)):
        last = path.split("/")[-1].lower()
        kind = "champions" if "champions" in last else "masters" if "masters" in last else None
        if kind:
            out.append({"year": int(year), "kind": kind, "event": label.strip()})
    return out


def field(wikitext: str, name: str) -> str | None:
    m = re.search(r"\|\s*" + name + r"\s*=\s*([^\n|]+)", wikitext)
    return m.group(1).strip() if m else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    world = load(WORLD, {"players": []})
    cache = load(OUT, {})
    want = [p["ign"] for p in world["players"] if args.refresh or p["ign"] not in cache]
    print(f"查 {len(want)} 人的头衔")
    try:
        for batch in chunks(want, 50):
            asked_of = {PAGE_OF.get(n, n): n for n in batch}
            r = api({"prop": "revisions", "rvprop": "content", "rvslots": "main",
                     "redirects": "1", "titles": "|".join(asked_of)})
            q = r.get("query", {})
            back = {}
            for k in ("normalized", "redirects"):
                for m in q.get(k, []) or []:
                    back[m["to"]] = m["from"]
            for p in (q.get("pages", {}) or {}).values():
                title = p.get("title", "")
                asked = back.get(title, title)
                name = next((n for t, n in asked_of.items() if t.lower() == asked.lower()), None)
                if not name:
                    continue
                if "missing" in p:
                    cache[name] = {"page": None, "titles": []}
                    continue
                text = ((p.get("revisions") or [{}])[0].get("slots") or {}).get("main", {}).get("*", "")
                cache[name] = {"page": title, "country": field(text, "country"),
                               "titles": titles_of(text)}
    except RateLimited as e:
        print(f"RATE LIMITED: {e} — saving what we have", file=sys.stderr)
    finally:
        OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    won = {k: v for k, v in cache.items() if v.get("titles")}
    print(f"有国际赛冠军的：{len(won)} 人")
    for k, v in sorted(won.items(), key=lambda kv: -max(t['year'] for t in kv[1]['titles']))[:40]:
        print(f"  {k:12} {', '.join(t['event'] for t in v['titles'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
