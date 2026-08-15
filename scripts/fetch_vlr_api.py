#!/usr/bin/env python3
"""
Fill gaps from the community VLR API at https://vlr.orlandomm.net.

vlr.gg itself has no public API and rate-limits direct scraping hard. This
service mirrors it and answers freely, so it is used as a second source for
club staff and rosters — Liquipedia's team infoboxes leave the coach blank for
a few clubs (Wolves Esports being one) even though the information exists.

It does NOT expose per-player statistics or IGLs, so it cannot replace the
vlr.gg stats scrape or Liquipedia's `igl=` field.

  python3 scripts/fetch_vlr_api.py
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(RAW, "vlrapi_teams.json")

API = "https://vlr.orlandomm.net/api/v1"
UA = "ValManagerGameBuild/0.1 (hobby esports-manager project)"
DELAY = 1.0

# tag -> (region on the API, name fragment to match)
TEAMS = {
    "LEV": ("na", "Leviat"), "NRG": ("na", "NRG"), "G2": ("na", "G2"),
    "MIBR": ("na", "MIBR"), "SEN": ("na", "Sentinels"), "FUR": ("na", "FURIA"),
    "100T": ("na", "100 Thieves"), "KRÜ": ("na", "KR"), "LOUD": ("na", "LOUD"),
    "C9": ("na", "Cloud9"), "EG": ("na", "Evil Geniuses"), "ENVY": ("na", "Envy"),
    "VIT": ("eu", "Vitality"), "TH": ("eu", "Heretics"), "FNC": ("eu", "FNATIC"),
    "FUT": ("eu", "FUT"), "GX": ("eu", "GIANTX"), "BBL": ("eu", "BBL"),
    "TL": ("eu", "Liquid"), "EF": ("eu", "Eternal Fire"), "PCF": ("eu", "PCIFIC"),
    "M8": ("eu", "Gentle Mates"), "NAVI": ("eu", "Natus"), "KC": ("eu", "Karmine"),
    "PRX": ("ap", "Paper Rex"), "T1": ("ap", "T1"), "NS": ("ap", "Nongshim"),
    "GEN": ("ap", "Gen.G"), "KRX": ("ap", "DRX"), "ZETA": ("ap", "ZETA"),
    "TS": ("ap", "Team Secret"), "DFM": ("ap", "DetonatioN"),
    "RRQ": ("ap", "Rex Regum"), "FS": ("ap", "FULL SENSE"),
    "GE": ("ap", "Global Esports"), "VL": ("ap", "VARREL"),
    "EDG": ("china", "EDward"), "XLG": ("china", "Xi Lai"), "TYL": ("china", "TYLOO"),
    "WOL": ("china", "Wolves"), "FPX": ("china", "FunPlus"), "NOVA": ("china", "Nova"),
    "BLG": ("china", "Bilibili"), "AG": ("china", "All Gamers"),
    "TE": ("china", "Trace"), "JDG": ("china", "JD"), "DRG": ("china", "Dragon Ranger"),
    "TEC": ("china", "Titan"),
}


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def main():
    cache = {}
    if os.path.exists(OUT):
        try:
            cache = json.load(open(OUT, encoding="utf-8"))
        except ValueError:
            cache = {}

    # one listing per region, then one detail call per club
    listings = {}
    for region in sorted({r for r, _ in TEAMS.values()}):
        try:
            listings[region] = get(f"/teams?region={region}&limit=all").get("data", [])
        except urllib.error.URLError as e:
            print(f"  {region}: {e}", flush=True)
            listings[region] = []
        print(f"  {region}: {len(listings[region])} teams", flush=True)
        time.sleep(DELAY)

    for tag, (region, frag) in TEAMS.items():
        if cache.get(tag, {}).get("coach"):
            continue
        match = next((t for t in listings.get(region, [])
                      if frag.lower() in t["name"].lower()), None)
        if not match:
            print(f"  {tag}: no match for '{frag}' in {region}", flush=True)
            continue
        try:
            d = get(f"/teams/{match['id']}").get("data", {})
        except urllib.error.URLError as e:
            print(f"  {tag}: {e}", flush=True)
            continue
        staff = d.get("staff") or []
        head = next((s["user"] for s in staff
                     if "head coach" in (s.get("tag") or "").lower()), None)
        if not head:
            head = next((s["user"] for s in staff
                         if (s.get("tag") or "").lower() == "coach"), None)
        assistants = [s["user"] for s in staff
                      if "assistant" in (s.get("tag") or "").lower()]
        cache[tag] = {
            "vlrId": match["id"],
            "name": match["name"],
            "coach": head,
            "assistants": assistants,
            "roster": [p["user"] for p in (d.get("players") or [])],
        }
        print(f"  {tag}: coach={head} roster={len(cache[tag]['roster'])}", flush=True)
        time.sleep(DELAY)

    json.dump(cache, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    got = sum(1 for v in cache.values() if v.get("coach"))
    print(f"\n{got}/{len(TEAMS)} head coaches -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
