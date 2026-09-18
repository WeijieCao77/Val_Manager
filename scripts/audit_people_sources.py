#!/usr/bin/env python3
"""Where the sources disagree about a 2026 player's flag or name. Caches only."""
import json, os, re, sys, unicodedata
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p)))
src = open(os.path.join(ROOT, "scripts", "build_world.py")).read()
COUNTRY_OF = eval(re.search(r"COUNTRY_OF = (\{[\s\S]*?\n\})", src).group(1))

w = J("src", "data", "world.json"); d = J("src", "data", "dossier.json")["players"]
pr = J("scripts", "cache", "vlr_profiles.json")
lp = {k.lower(): v for k, v in J("data-raw", "liquipedia_players.json").items()}
teams = {t["id"]: t["tag"] for t in w["teams"]}

def tok(s):
    s = unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode()
    return set(re.findall(r"[a-z]{3,}", s))

nat, names = [], []
for p in w["players"]:
    k = p["ign"].lower(); v = pr.get(k) or {}; l = lp.get(k) or {}
    g = p.get("nat") or d.get(p["id"], {}).get("nat")
    lc = (l.get("country") or "").lower(); want = COUNTRY_OF.get(g or "")
    if lc and want and lc != want:
        nat.append((p["id"], p["ign"], teams.get(p["teamId"]), f"game={g}", f"vlr={v.get('nat')}", f"lp={lc}"))
    if v.get("nat") and g and v["nat"] != g:
        nat.append((p["id"], p["ign"], "GAME!=VLR", g, v["nat"]))
    gr = p.get("realName") or d.get(p["id"], {}).get("real")
    ts = [tok(x) for x in (gr, v.get("real"), l.get("real")) if x and tok(x)]
    if len(ts) >= 2 and not set.intersection(*ts):
        names.append((p["id"], p["ign"], gr, v.get("real"), l.get("real")))
print("FLAG DISAGREEMENTS", len(nat))
for x in nat: print("  ", x)
print("NAME DISAGREEMENTS", len(names))
for x in names: print("  ", x)
