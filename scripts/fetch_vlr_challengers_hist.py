#!/usr/bin/env python3
"""
The Challengers tables of 2024 and 2025, for the historical saves' second tier.

    python3 scripts/fetch_vlr_challengers_hist.py

One vlr.gg stats page per event — the opening split of every Challengers
league that year, ids from vlr's own event search — read with the same
parser as scripts/fetch_vlr_event_stats.py, 6 s apart, resume-safe, a 429
aborts and keeps what was fetched. Cache merges, never overwrites.

Cache: scripts/cache/vlr_challengers_hist.json
  events: { id: { name, year, region } }
  stats:  { id: [ rows as in vlr_event_stats.json ] }
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vlr_career as vlr  # noqa: E402
from fetch_vlr_event_stats import event_rows  # noqa: E402

vlr.MIN_INTERVAL = 6.0
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache" / "vlr_challengers_hist.json"

# the opening split of each Challengers league, by the engine's four regions
EVENTS = {
    # 2023's opening splits are not in vlr's search; their ids come from the
    # vlr match links on each league's Liquipedia page (North America, Vietnam
    # and South Asia carry the event id in the infobox)
    2023: {
        # North America is not here: vlr's 1458 is the whole year's league,
        # both splits in one table with no filter, so its clubs would carry
        # June's rosters into January
        "Americas": [("1273", "Brazil: Split 1"), ("1395", "LATAM South: Split 1")],
        "EMEA": [("1424", "Spain: Split 1"), ("1425", "France: Split 1"), ("1430", "DACH: Split 1"), ("1392", "Italy: Split 1"),
                 ("1421", "Portugal: Split 1"), ("1415", "Türkiye: Split 1"), ("1423", "Northern Europe: Split 1"), ("1422", "East: Split 1")],
        "Pacific": [("1432", "Japan: Split 1"), ("1447", "Korea: Split 1"), ("1474", "Vietnam: Split 1"), ("1500", "South Asia: Split 1")],
    },
    2024: {
        "Americas": [("1971", "North America: Stage 1"), ("1949", "Brazil: Split 1"), ("1898", "LATAM North: Split 1"), ("1950", "LATAM South: Split 1")],
        "EMEA": [("1939", "Spain: Split 1"), ("1942", "France: Split 1"), ("1948", "DACH: Split 1"), ("1947", "Italy: Split 1"),
                 ("1945", "Portugal: Split 1"), ("1893", "Türkiye: Split 1"), ("1943", "Northern Europe: Split 1"), ("1932", "East: Split 1"), ("1944", "MENA: Split 1")],
        "Pacific": [("1962", "Japan: Split 1"), ("1958", "Korea: Split 1"), ("1960", "Thailand: Split 1"), ("1952", "Indonesia: Split 1"),
                    ("1964", "Philippines: Split 1"), ("1956", "Malaysia/Singapore: Split 1"), ("1974", "Vietnam: Split 1"), ("1955", "Taiwan/Hong Kong: Split 1"), ("1966", "South Asia: Split 1")],
    },
    2025: {
        "Americas": [("2301", "North America: Stage 1"), ("2304", "Brazil: Stage 1"), ("2324", "LATAM North: Stage 1"), ("2325", "LATAM South: Stage 1")],
        "EMEA": [("2317", "Spain: Stage 1"), ("2315", "France: Stage 1"), ("2319", "DACH: Stage 1"), ("2322", "Türkiye: Kickoff"),
                 ("2306", "NORTH//EAST: Stage 1"), ("2387", "MENA GCC: Stage 1"), ("2386", "MENA NAL: Stage 1"), ("2316", "EMEA: Stage 1")],
        "Pacific": [("2309", "Japan: Stage 1"), ("2331", "Korea: Stage 1"), ("2305", "Southeast Asia: Stage 1"), ("2366", "South Asia: Stage 1"), ("2401", "Oceania: Stage 1")],
        # China has no Challengers split on vlr; the clubs that played the 2024
        # China Ascension in September are the field below 2025's partners
        "China": [("2149", "China Ascension 2024")],
    },
}


def main():
    store = json.loads(CACHE.read_text()) if CACHE.exists() else {"events": {}, "stats": {}}
    todo = [(y, r, eid, name) for y, regs in EVENTS.items() for r, lst in regs.items() for eid, name in lst if eid not in store["stats"]]
    print(f"{len(todo)} event pages to read (~{len(todo) * 6 / 60:.0f} min)")
    for y, r, eid, name in todo:
        try:
            rows = event_rows(eid, "x")
        except SystemExit:
            break
        store["events"][eid] = {"name": f"Challengers {y} {name}", "year": y, "region": r, "tier": "challengers"}
        store["stats"][eid] = rows
        CACHE.write_text(json.dumps(store, ensure_ascii=False))
        clubs = len({x.get("club") for x in rows})
        print(f"{y} {r} {name}: {len(rows)} rows, {clubs} clubs")
    print(f"→ {CACHE}")


if __name__ == "__main__":
    main()
