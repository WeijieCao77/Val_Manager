#!/usr/bin/env python3
"""
v16 records: one line per player per event, 2020-2026, from vlr.gg event stats.

    python3 -m scripts.rating.history_v16_data

Inputs
  scripts/cache/vlr_event_stats.json        2022-2026 events the live study used
  analysis/rating/history_v16/raw/          pages fetched by fetch_history_v16
      stats_<id>.html       every stage of the event
      stats_<id>_main.html  the same page with the open/closed qualifiers excluded
      event_<id>.html       dates, region, final standings
Outputs (analysis/rating/history_v16/)
  events.json    id -> name, slug, dates, tier, level, region, standings
  records.json   [player x event x level] counts and rates, agent shares

Rules carried over from the live study (analysis/rating/region_calibration_v15):
- one record per player per event and level; ratios are recomputed from summed
  counts (k, a, fk, fd over rounds) and never averaged;
- tier-one ("top") is each region's competition that fed the internationals,
  everything below it is "t2" and later carries the cross-tier bridge;
- a qualifier stage inside a top event is t2: pros meeting open-qualifier
  amateurs is not a tier-one round. It is the event total minus the main stage.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "analysis" / "rating" / "history_v16"
RAW = BASE / "raw"
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

# ---- tiers -------------------------------------------------------------------
# International events by slug; a 2021 "Stage N: Masters" without a city is a
# regional final, not an international.
INTL = [
    (r"stage-2-masters-reykjav", "masters"), (r"stage-3-masters-berlin", "masters"),
    (r"^valorant-champions-20\d\d$", "champions"), (r"lock-in", "masters"),
    (r"masters-(reykjav|copenhagen|tokyo|madrid|shanghai|bangkok|toronto|santiago|london)", "masters"),
]
# 2020-21: the top tier of each region that fed an international (First Strike,
# the regional Challengers and Masters, EMEA/APAC playoffs, last-chance
# qualifiers). National legs below a regional final are t2.
TOP_2020_21 = re.compile(
    r"first-strike-(north-america|europe|brazil|korea|japan|cis|turkey|latin-america|latam|oceania|mena|sea|southeast-asia)"
    r"|champions-tour-(north-america|europe|brazil|korea|japan|cis|turkey|latam|latin-america|sea|southeast-asia|emea|apac|asia-pacific)-"
    r"|last-chance-qualifier|lcq", re.I)
T2_2020_21 = re.compile(
    r"indonesia|philippines|thailand|vietnam|malaysia|singapore|hong-kong|taiwan|oceania|mena|south-asia|"
    r"latam-(north|south)|latin-america-(north|south)|game-changers|academy", re.I)
# 2022-23: the live study's own table (scripts/rating/dataset.py)
from scripts.rating.dataset import TIER_2022_23  # noqa: E402


def tier_level(slug: str, year: int, cached_tier: str | None = None) -> tuple[str, str]:
    """(tier, level). tier: champions/masters/league/kickoff/challengers; level: top/t2"""
    for pat, t in INTL:
        if re.search(pat, slug):
            return t, "top"
    if year <= 2021:
        if T2_2020_21.search(slug) or not TOP_2020_21.search(slug):
            return "challengers", "t2"
        return "league", "top"
    if year <= 2023:
        for pat, t in TIER_2022_23:
            if re.search(pat, slug):
                return t, ("top" if t in ("masters", "champions") else "t2")
    t = cached_tier or ("kickoff" if "kickoff" in slug else "challengers" if "challengers" in slug else "league")
    return t, ("t2" if t == "challengers" else "top")


# ---- parsing -----------------------------------------------------------------
def _text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def _num(s: str | None):
    if s is None:
        return None
    s = s.strip().replace("%", "").replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_stats(html: str) -> list[dict]:
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        if '<td class="mod-player' not in tr:
            continue
        pm = re.search(r'href="/player/(\d+)/', tr)
        if not pm:
            continue
        cell = {c: _text(v) for c, v in re.findall(r'data-col="([a-z0-9]+)"[^>]*>(.*?)</td>', tr, re.S)}
        rnd = _num(cell.get("rnd"))
        if not rnd:
            continue
        name = re.search(r'st-pl-name[^>]*>(.*?)</div>', tr, re.S)
        club = re.search(r'st-pl-country[^>]*>(.*?)</div>', tr, re.S)
        row = {
            "vlrId": pm.group(1), "ign": _text(name.group(1)) if name else "",
            "club": _text(club.group(1)) if club else "",
            "agents": [[a, _num(p)] for a, p in re.findall(
                r'/img/vlr/game/agents/([a-z0-9_-]+)\.png">\s*<span class="st-agent-n">([^<]*)<', tr)],
            "maps": _num(cell.get("maps")), "rnd": rnd,
        }
        for c in ("rating2", "acs", "kast", "adr", "k", "d", "a", "fk", "fd"):
            row[c] = _num(cell.get(c))
        # headshot rate and clutches won/faced: the world builder's aim and clutch inputs
        row["hs"] = _num(cell.get("hsp"))
        cl = re.match(r"(\d+)\s*/\s*(\d+)", cell.get("cl") or "")
        row["clw"], row["clt"] = (int(cl.group(1)), int(cl.group(2))) if cl else (None, None)
        rows.append(row)
    return rows


def parse_event(html: str) -> dict:
    title = re.search(r'<h1[^>]*class="(?:wf-title|event-header-main-title)"[^>]*>(.*?)</h1>', html, re.S)
    dates = re.search(r'Dates\s*</div>\s*<div class="value"[^>]*>(.*?)</div>', html, re.S)
    start = end = None
    if dates:
        start, end = parse_range(_text(dates.group(1)))
    standings = []
    i = html.find("wf-ptable--standings")
    if i > 0:
        block = html[i:i + 200000]
        for row in re.split(r'<div class="row[^"]*" role="row">', block)[2:66]:
            place = re.search(r'role="cell"[^>]*>\s*(\d+)(?:<sup>[a-z]+</sup>)?\s*(?:[–-]\s*(\d+)(?:<sup>[a-z]+</sup>)?)?', row)
            team = re.search(r'href="/team/(\d+)/([^"]+)"[^>]*>.*?class="text-of">\s*(.*?)\s*<div', row, re.S)
            if place and team:
                lo = int(place.group(1))
                standings.append({"lo": lo, "hi": int(place.group(2) or lo), "teamId": team.group(1),
                                  "team": _text(team.group(3))})
    return {"name": _text(title.group(1)) if title else None, "start": start, "end": end, "standings": standings,
            "series": parse_bracket(html), "teams": parse_teams(html)}


def parse_teams(html: str) -> list[dict]:
    """the event's Participating Teams block: every team and the players it listed"""
    out = []
    for card in re.split(r'<div class="wf-card event-team">', html)[1:]:
        t = re.search(r'class="wf-module-item event-team-name" href="/team/(\d+)/[^"]*">\s*(.*?)\s*</a>', card, re.S)
        if not t:
            continue
        body = card[:card.find('<div class="wf-card event-team">')] if False else card[:20000]
        players = re.findall(r'href="/player/(\d+)/[^"]*" class="wf-module-item[^"]*event-team-players-item', body)
        out.append({"teamId": t.group(1), "team": _text(t.group(2)), "players": list(dict.fromkeys(players))})
    return out


def parse_bracket(html: str) -> list[dict]:
    """playoff series from the bracket: who met whom in which round, and the score"""
    out = []
    for col in re.split(r'<div class="bracket-col-label">', html)[1:]:
        label = _text(col[:col.find("</div>")])
        for item in re.findall(r'<a class="bracket-item[^"]*"[^>]*href="/(\d+)/[^"]*"[^>]*>(.*?)</a>', col, re.S):
            mid, body = item
            teams = re.findall(r'bracket-item-team [^"]*mod-(winner|loser)?[^"]*"[^>]*data-team-id="(\d*)"[^>]*>.*?'
                               r'bracket-item-team-score">\s*([^<]*?)\s*</div>', body, re.S)
            if len(teams) != 2 or not all(t[1] for t in teams):
                continue
            (w1, a, sa), (w2, b, sb) = teams
            sa, sb = _num(sa), _num(sb)
            if sa is None or sb is None or sa == sb:
                continue
            out.append({"match": mid, "round": label, "a": a, "b": b, "sa": int(sa), "sb": int(sb),
                        "winner": a if sa > sb else b})
    return out


def parse_range(txt: str) -> tuple[str | None, str | None]:
    """'Nov 9 – Dec 5, 2020' / 'Jan 12 – Feb 2, 2021' / 'Dec 28, 2020 – Jan 10, 2021'"""
    m = re.match(r"(\w{3})\s+(\d+)(?:,\s*(\d{4}))?\s*[–—-]\s*(?:(\w{3})\s+)?(\d+),\s*(\d{4})", txt)
    if not m or m.group(1) not in MONTHS:
        return None, None
    m1, d1, y1, m2, d2, y2 = m.groups()
    m2 = m2 or m1
    y2 = int(y2)
    y1 = int(y1) if y1 else (y2 - 1 if MONTHS[m1] > MONTHS[m2] else y2)
    return f"{y1}-{MONTHS[m1]:02d}-{int(d1):02d}", f"{y2}-{MONTHS[m2]:02d}-{int(d2):02d}"


# ---- assembly ----------------------------------------------------------------
def counts(r: dict) -> dict:
    """per-event line -> the counts and round-weighted means the model reads"""
    n = r["rnd"]
    out = {"n": n, "maps": r.get("maps")}
    for c in ("k", "a", "fk", "fd", "d"):
        out[c] = r.get(c)
    for c in ("rating2", "acs", "kast", "adr"):
        out[c] = r.get(c)
    out["agents"] = [[a, p] for a, p in (r.get("agents") or []) if p]
    for c in ("hs", "clw", "clt"):
        out[c] = r.get(c)
    return out


def subtract(all_: dict, main: dict) -> dict | None:
    """event total minus its main stage = the qualifier rounds"""
    n = all_["n"] - main["n"]
    if n < 1:
        return None
    out = {"n": n, "maps": (all_.get("maps") or 0) - (main.get("maps") or 0)}
    for c in ("k", "a", "fk", "fd", "d"):
        out[c] = None if all_.get(c) is None or main.get(c) is None else max(0.0, all_[c] - main[c])
    for c in ("rating2", "acs", "kast", "adr"):
        a, b = all_.get(c), main.get(c)
        out[c] = None if a is None or b is None else (a * all_["n"] - b * main["n"]) / n
    out["agents"] = all_.get("agents") or []
    return out


def main() -> int:
    cache = json.loads((ROOT / "scripts" / "cache" / "vlr_event_stats.json").read_text())
    plan = json.loads((BASE / "retired_fetch_list.json").read_text())
    names = {p["id"]: p for p in plan["statsPages"]}
    events: dict[str, dict] = {}
    records: list[dict] = []

    # live-study events first (2022-2026), exactly as the study read them
    for eid, ev in cache["events"].items():
        year = int((ev.get("start") or str(ev.get("year")))[:4])
        tier, level = tier_level(ev["slug"], year, ev.get("tier"))
        events[eid] = {"slug": ev["slug"], "name": ev.get("slug"), "start": ev.get("start"), "end": ev.get("end"),
                       "year": year, "tier": tier, "level": level, "source": "scripts/cache/vlr_event_stats.json"}
        for r in cache["stats"].get(eid, []):
            if r.get("vlrId") and r.get("rnd"):
                records.append({"pid": r["vlrId"], "ign": r["ign"], "club": r["club"], "eid": eid, "level": level,
                                "stage": "all", **counts(r)})

    # the fetched history pages, then pages fetched earlier by the study
    # (analysis/rating/early_honours holds the three 2021 internationals)
    pages = sorted(RAW.glob("stats_*.html"))
    have = {f.stem.split("_")[1] for f in pages}
    for f in sorted((ROOT / "analysis").glob("**/stats_*.html")):
        if re.fullmatch(r"stats_\d+(_main-event)?", f.stem) and f.stem.split("_")[1] not in have and "history_v16" not in str(f):
            pages.append(f)
            have.add(f.stem.split("_")[1])
    for f in pages:
        if f.stem.endswith("_main"):
            continue
        eid = f.stem.split("_")[1]
        if eid in events and events[eid]["source"].startswith("scripts/cache"):
            continue
        evhtml = RAW / f"event_{eid}.html"
        if not evhtml.exists() and (f.parent / f"event_{eid}.html").exists():
            evhtml = f.parent / f"event_{eid}.html"
        # the stats page carries the event header too: name and dates when no event page is held
        meta = parse_event(evhtml.read_text("utf-8", "ignore")) if evhtml.exists() else parse_event(f.read_text("utf-8", "ignore"))
        slug = re.search(r'href="/event/stats/\d+/([^"?]+)"', f.read_text("utf-8", "ignore"))
        slug = slug.group(1) if slug else (names.get(eid) or {}).get("statsUrl", "").rsplit("/", 1)[-1]
        year = int((meta.get("start") or str((names.get(eid) or {}).get("year") or 0))[:4] or 0)
        tier, level = tier_level(slug, year)
        events[eid] = {"slug": slug, "name": meta.get("name") or (names.get(eid) or {}).get("name"),
                       "start": meta.get("start"), "end": meta.get("end"), "year": year, "tier": tier, "level": level,
                       "standings": meta.get("standings", []), "series": meta.get("series", []), "teams": meta.get("teams", []), "source": f"https://www.vlr.gg/event/stats/{eid}/{slug}"}
        whole = {r["vlrId"]: r for r in parse_stats(f.read_text("utf-8", "ignore"))}
        mainf = f.parent / f"stats_{eid}_main.html"
        if mainf.exists() and level == "top":
            main_rows = {r["vlrId"]: r for r in parse_stats(mainf.read_text("utf-8", "ignore"))}
            events[eid]["mainStageOnly"] = True
            for pid, r in whole.items():
                m = main_rows.get(pid)
                if m:
                    records.append({"pid": pid, "ign": r["ign"], "club": r["club"], "eid": eid, "level": "top",
                                    "stage": "main", **counts(m)})
                rest = subtract(counts(r), counts(m)) if m else counts(r)
                if rest:
                    records.append({"pid": pid, "ign": r["ign"], "club": r["club"], "eid": eid, "level": "t2",
                                    "stage": "qualifier", **rest})
        else:
            for pid, r in whole.items():
                records.append({"pid": pid, "ign": r["ign"], "club": r["club"], "eid": eid, "level": level,
                                "stage": "all", **counts(r)})

    # standings for every event whose page we hold anywhere (dates/placements)
    pages = {}
    for f in sorted((ROOT / "analysis").glob("**/event_*.html")):
        if re.fullmatch(r"event_\d+", f.stem):
            pages.setdefault(f.stem.split("_")[1], f)
    for f in sorted(RAW.glob("event_*.html")):
        pages[f.stem.split("_")[1]] = f
    for f in pages.values():
        eid = f.stem.split("_")[1]
        if eid in events and not (events[eid].get("standings") and events[eid].get("teams")):
            meta = parse_event(f.read_text("utf-8", "ignore"))
            events[eid]["standings"] = meta["standings"]
            events[eid]["series"] = meta["series"]
            events[eid]["teams"] = meta["teams"]
            events[eid]["start"] = events[eid]["start"] or meta["start"]
            events[eid]["end"] = events[eid]["end"] or meta["end"]

    BASE.mkdir(parents=True, exist_ok=True)
    (BASE / "events.json").write_text(json.dumps(events, ensure_ascii=False, indent=1))
    (BASE / "records.json").write_text(json.dumps(records, ensure_ascii=False))
    from collections import Counter
    print(f"{len(events)} events, {len(records)} records")
    print(Counter((e["year"], e["tier"], e["level"]) for e in events.values()))
    print("undated:", sum(1 for e in events.values() if not e.get("end")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
