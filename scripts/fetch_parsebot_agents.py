#!/usr/bin/env python3
"""
Fetch real agent pools from the parse.bot VLR API.

Neither vlr's role filter nor Liquipedia says which roles a player actually
covers — vlr reports only their most-played role, which is why f0rsakeN reads
as a pure controller when he in fact plays duelist, smokes, sentinel and
initiator. This endpoint returns the agents each player really used, so role
breadth can be derived from evidence instead of guessed at.

Calls are metered (1 credit each) and the endpoint ignores region/page filters,
returning a fixed top-100 snapshot. So this makes exactly ONE request and
caches it; re-runs are free unless you pass --refresh.

  PARSEBOT_KEY=pmx_... python3 scripts/fetch_parsebot_agents.py [--refresh]
"""
import json, os, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data-raw", "parsebot_agents.json")

SCRAPER = "17a280c5-4958-46ad-b697-83a15883a046"
URL = f"https://api.parse.bot/scraper/{SCRAPER}/get_player_stats?timespan=all"


def main():
    refresh = "--refresh" in sys.argv
    if os.path.exists(OUT) and not refresh:
        cached = json.load(open(OUT, encoding="utf-8"))
        print(f"cached: {len(cached)} players (pass --refresh to spend a credit)")
        return 0

    key = os.environ.get("PARSEBOT_KEY")
    if not key:
        print("set PARSEBOT_KEY in the environment (never commit it)", file=sys.stderr)
        return 1

    req = urllib.request.Request(URL, headers={"X-API-Key": key})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            payload = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read()[:200]!r}", file=sys.stderr)
        return 1

    players = payload.get("data", {}).get("players", [])
    if not players:
        print(f"no players in response: {str(payload)[:200]}", file=sys.stderr)
        return 1

    out = {
        p["player"]: {
            "team": p.get("team"),
            "agents": p.get("agents") or [],
            "rounds": p.get("rounds"),
            "rating": p.get("rating"),
        }
        for p in players
        if p.get("player")
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    multi = sum(1 for v in out.values() if len(v["agents"]) > 1)
    print(f"{len(out)} players ({multi} with more than one agent) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
