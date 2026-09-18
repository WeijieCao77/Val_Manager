#!/usr/bin/env python3
"""
Does each 2023–2025 tier-one roster match what Liquipedia's participant card
for the opening event lists? Caches only.

    python3 scripts/audit_year_rosters.py

The worlds take a roster from vlr's stat table for the opening event (whoever
played a map). Liquipedia's card lists who was REGISTERED: five starters, the
substitutes, the staff. The two should agree on the five; this prints where
they do not, so a stand-in who played one map or a starter who sat the
opening event out can be looked at by a person.
"""
import json, os, re, unicodedata
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p)))
cards = J("scripts", "cache", "liquipedia_event_staff.json")
k = lambda s: re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode())
# spellings of one handle (overrides.json `aliases` and `handles`): HeiB is heybay
_ov = J("data-raw", "overrides.json")
SAME = {}
for main, others in (_ov.get("aliases") or {}).items():
    for o in others:
        SAME[k(o)] = k(main)
for h in (_ov.get("handles") or {}).values():
    if isinstance(h, dict):
        SAME[k(h["vlr"])] = k(h["ign"])
_k = k
k = lambda s: SAME.get(_k(s), _k(s))  # noqa: E731
out = []
for year in (2023, 2024, 2025):
    w = J("src", "data", f"world_{year}.json")
    # 2023's worlds open at the leagues, not LOCK//IN: on a tie the league card wins
    lp = [t for title, page in sorted(cards.items(), key=lambda kv: "LOCK" in kv[0]) if page.get("year") == year for t in page.get("teams") or []]
    seen = ok = 0
    for t in (t for t in w["teams"] if t["tier"] == 1):
        mine = {k(p["ign"]): p["ign"] for p in w["players"] if p["teamId"] == t["id"]}
        best = max(lp, key=lambda c: len(set(mine) & {k(n) for n in c["players"] + c.get("subs", [])}), default=None)
        if not best or len(set(mine) & {k(n) for n in best["players"] + best.get("subs", [])}) < 3:
            out.append(f"{year} {t['tag']}: no Liquipedia card matched ({', '.join(mine.values())})"); continue
        seen += 1
        starters = {k(n): n for n in best["players"]}; subs = {k(n): n for n in best.get("subs", [])}
        missing = [n for kk, n in starters.items() if kk not in mine]
        extra = [n for kk, n in mine.items() if kk not in starters and kk not in subs]
        if missing or extra:
            out.append(f"{year} {t['tag']} ({best['team']}): " + "; ".join(x for x in (
                f"Liquipedia starter not in the game: {', '.join(missing)}" if missing else "",
                f"in the game but not on the card: {', '.join(extra)}" if extra else "") if x))
        else:
            ok += 1
    out.append(f"== {year}: {ok}/{seen} tier-one rosters agree with Liquipedia exactly")
open(os.path.join(ROOT, "analysis", "people", "rosters.md"), "w").write("# Roster cross-check\n\n" + "\n".join(f"- {x}" for x in out) + "\n")
print("\n".join(out))
