#!/usr/bin/env python3
"""
v16 coach rating: what a team did with the players it had, while he was there.

    python3 -m scripts.rating.history_v16_data
    python3 -m scripts.rating.coach_tenure_v16
    python3 -m scripts.rating.coach_v16

Three measured parts, each "actual minus expected", so a coach of a weak five is
not punished for being weak and a coach of a super-team is not paid for it:

  战术 tactics      every event: the team's final standing (percentile in the
                    field) minus the standing its roster strength predicted
                    (the five players' live-algorithm scores on the eve of the
                    event, ranked in that field).
  培养 development  every player he had for at least one event: the change in
                    the player's own score over the coach's time with him,
                    minus the change players of that age make anyway.
  激励 motivation   every playoff series: won (1) or lost (0), minus the
                    chance the two rosters' strengths gave it.

Each is a weighted mean shrunk towards 0 by a fixed number of pseudo-
observations (no evidence = exactly average, labelled 证据不足 — never a cohort
mean and never a guess). Role weights: head coach 1, assistant 0.5, analyst 0.25.
The three are put on the player score scale (BASE 71.64) by one published
factor, and the career record — international qualification, results, titles,
experience, season results with the players' own units and caps, times the role
weight — is added to all three, as it is for a player.

Card rating = 0.45 战术 + 0.30 培养 + 0.25 激励 (the game's coachRating).
"""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from scripts.rating import history_v16 as H

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "analysis" / "rating" / "history_v16"
ASOF = "2026-10-09"
ROLE_W = {"head": 1.0, "assistant": 0.5, "analyst": 0.25, "other": 0.0}
TIER_W = {"champions": 1.5, "masters": 1.5, "league": 1.0, "kickoff": 1.0, "challengers": 0.5}
# pseudo-observations at 0, measured by coach_v16_prior (split-half covariance);
# the fallback is only for a first run before that file exists
_PF = ROOT / "analysis" / "rating" / "history_v16" / "coach_prior.json"
PRIOR = {k: v["prior"] for k, v in json.loads(_PF.read_text()).items()} if _PF.exists() else \
    {"tactics": 7.0, "development": 27.0, "motivation": 23.0}
HALF = 730  # the players' team-result half-life (D, T)
SLACK = 14  # days an event may stick out of a stint and still be his


def d(s: str) -> date:
    return date.fromisoformat(s[:10])


class World:
    def __init__(self):
        self.events, recs = H.load()
        bases = H.fit_baselines(recs)
        self.recs = []
        for r in recs:
            if r["eid"] == "2766":
                continue
            s = H.score_record(r, bases)
            if s:
                self.recs.append({**r, **s})
        self.by_pid = defaultdict(list)
        self.by_event = defaultdict(list)
        for r in self.recs:
            self.by_pid[r["pid"]].append(r)
            self.by_event[r["eid"]].append(r)
        for v in self.by_pid.values():
            v.sort(key=lambda r: r["date"])
        self.ledger = defaultdict(list)
        for t in H.LEDGER:
            self.ledger[t["event_id"]].append(t)
        self.seasons = defaultdict(list)
        for t in H.read("analysis/rating/season_career_v9/season_results.json"):
            self.seasons[t["event_id"]].append(t)
        self._strength = {}
        self.teams = {}  # eid -> {team key: {...}}
        self.tag_of = defaultdict(lambda: defaultdict(int))
        self._resolve()

    # -- who played for which team at an event -----------------------------------
    def listed(self, eid: str) -> dict[str, set]:
        out = {}
        for t in self.events.get(eid, {}).get("teams") or []:
            out[t["teamId"]] = set(t["players"])
        for t in self.ledger.get(eid, []):
            out.setdefault(t["team_id"], set()).update(str(p["pid"]) for p in t["participants"])
        for t in self.seasons.get(eid, []):
            out.setdefault(t["team_id"], set()).update(str(p["pid"]) for p in t.get("participants", []))
        return out

    def _resolve(self):
        pending = []
        for eid, rr in self.by_event.items():
            ev = self.events.get(eid) or {}
            lvl = ev.get("level")
            groups = defaultdict(list)
            for r in rr:
                if r["level"] == lvl or lvl is None:
                    groups[r["club"]].append(r)
            listed = self.listed(eid)
            out = {}
            for tag, g in groups.items():
                five = sorted(g, key=lambda r: -r["n"])[:5]
                pids = {r["pid"] for r in g}
                best = max(listed.items(), key=lambda kv: len(kv[1] & pids), default=(None, set()))
                tid = best[0] if best[0] and len(best[1] & pids) >= 2 else None
                if tid:
                    self.tag_of[(ev.get("year"), tid)][tag] += 1
                out[tid or f"tag:{tag}"] = {"tag": tag, "five": [r["pid"] for r in five], "rounds": sum(r["n"] for r in five)}
            self.teams[eid] = out
            pending.append(eid)
        # a team missing from every list of an event (a group-stage exit) is
        # still known by its tag from the same year's other events
        by_tag = defaultdict(set)
        for (year, tid), tags in self.tag_of.items():
            for tag in tags:
                by_tag[(year, tag)].add(tid)
        for eid in pending:
            year = (self.events.get(eid) or {}).get("year")
            for key in list(self.teams[eid]):
                if key.startswith("tag:"):
                    ids = by_tag.get((year, key[4:]))
                    if ids and len(ids) == 1:
                        tid = next(iter(ids))
                        if tid not in self.teams[eid]:
                            self.teams[eid][tid] = self.teams[eid].pop(key)

    def place(self, eid: str, tid: str) -> float | None:
        ev = self.events.get(eid) or {}
        for t in self.ledger.get(eid, []):
            if t["team_id"] == tid and t.get("place_high") is not None:
                return (t["place_low"] + t["place_high"]) / 2
        for t in self.seasons.get(eid, []):
            if t["team_id"] == tid and t.get("place_high") is not None:
                return (t["place_low"] + t["place_high"]) / 2
        st = ev.get("standings") or []
        hit = [s for s in st if s["teamId"] == tid]
        if hit:
            return (hit[0]["lo"] + hit[0]["hi"]) / 2
        field = self.field(eid)
        if st and field > len(st):
            # not on the prize table: tied for the places below it
            return (max(s["hi"] for s in st) + 1 + field) / 2
        return None

    def field(self, eid: str) -> int:
        return len(self.teams.get(eid, {}))

    def strength(self, pid: str, day: str) -> float:
        key = (pid, day)
        if key not in self._strength:
            lo = date.fromordinal(d(day).toordinal() - 730).isoformat()
            rr = [r for r in self.by_pid.get(pid, []) if lo <= r["date"] < day]
            self._strength[key] = H.personal(rr, decay_to=day)["L"] if rr else 0.0
        return self._strength[key]

    def team_strength(self, eid: str, tid: str) -> float:
        ev = self.events[eid]
        five = self.teams[eid][tid]["five"]
        return float(np.mean([self.strength(p, ev["start"] or ev["end"]) for p in five])) if five else 0.0


def percentile(place: float, field: int) -> float:
    return (field - place) / (field - 1)


def expected_rank(world: World, eid: str, tid: str) -> float:
    """where the roster strength would have finished this field: 1 = strongest"""
    s = {k: world.team_strength(eid, k) for k in world.teams[eid]}
    order = sorted(s, key=lambda k: -s[k])
    i = order.index(tid)
    ties = [k for k in order if s[k] == s[tid]]
    return order.index(ties[0]) + (len(ties) + 1) / 2


def stint_events(world: World, st: dict) -> list[str]:
    a = d(st["from"]).toordinal() - SLACK if st.get("from") else None
    b = d(st["to"]).toordinal() + SLACK if st.get("to") else d(ASOF).toordinal()
    if a is None:
        return []
    out = []
    for eid, ev in world.events.items():
        if not ev.get("start") or not ev.get("end") or eid == "2766" or ev["end"] >= ASOF:
            continue
        if a <= d(ev["start"]).toordinal() and d(ev["end"]).toordinal() <= b and st.get("teamId") in world.teams.get(eid, {}):
            out.append(eid)
    return out


def series_scale(world: World) -> float:
    """one logistic scale for 'stronger roster wins the series', fitted on every playoff series"""
    pairs = []
    for eid, ev in world.events.items():
        for m in ev.get("series") or []:
            if m["a"] in world.teams.get(eid, {}) and m["b"] in world.teams.get(eid, {}):
                da = world.team_strength(eid, m["a"]) - world.team_strength(eid, m["b"])
                pairs.append((da, 1.0 if m["winner"] == m["a"] else 0.0))
    best, bestll = 1.0, -1e18
    for k in np.linspace(1, 60, 240):
        ll = sum(y * math.log(1 / (1 + math.exp(-k * x))) + (1 - y) * math.log(1 - 1 / (1 + math.exp(-k * x))) for x, y in pairs)
        if ll > bestll:
            best, bestll = k, ll
    return float(best), len(pairs)


def age_curve(world: World, births: dict) -> np.ndarray:
    """the change in a player's own index a year on, by age — what happens anyway"""
    xs, ys = [], []
    for pid, rr in world.by_pid.items():
        b = births.get(pid)
        if not b:
            continue
        for y in range(2022, 2026):
            t0, t1 = f"{y}-06-30", f"{y + 1}-06-30"
            r0 = [r for r in rr if r["date"] < t0 and r["date"] >= f"{y - 2}-06-30"]
            r1 = [r for r in rr if r["date"] < t1 and r["date"] >= f"{y - 1}-06-30"]
            if sum(r["n"] for r in r0) < 300 or sum(r["n"] for r in r1) < 300:
                continue
            age = (d(t0) - d(b)).days / 365.25
            xs.append(age)
            ys.append(world.strength(pid, t1) - world.strength(pid, t0))
    X = np.array([[1, a - 22, (a - 22) ** 2] for a in xs])
    return np.linalg.lstsq(X, np.array(ys), rcond=None)[0] if len(xs) > 10 else np.zeros(3)


def record(world: World, ev_rows: list[dict], cut: str) -> dict:
    """the players' Q/T/H/E/D with his role weight standing in for participation"""
    done = {eid: tt for eid, tt in world.ledger.items() if tt[0].get("end") and tt[0]["end"] < cut and eid != "2766"}
    factor = lambda t: 1.25 if t["tier"] == "champions" else .75 if t["event_id"] == "1188" else 1  # noqa: E731
    qw = {eid: factor(tt[0]) * H.dec(tt[0]["date"], cut, 365) for eid, tt in done.items()}
    tw = {eid: H.dec(tt[0]["end"], cut, 730) for eid, tt in done.items()}
    qd, td = sum(qw.values()) or 1, sum(tw.values()) or 1
    Q = T = Hh = X = 0.0
    best = {}
    for r in ev_rows:  # one entry per event, at his highest role weight there
        k = r["eid"]
        rw = r["w"] / TIER_W.get(r["tier"], 1)
        if k not in best or rw > best[k][0]:
            best[k] = (rw, r)
    yearly = defaultdict(lambda: defaultdict(list))
    titles = defaultdict(float)
    for eid, (rw, r) in best.items():
        if r["end"] >= cut:
            continue
        if eid in done:
            t = done[eid][0]
            place = int(r["place"]) if r["place"] == int(r["place"]) else None
            Q += 3 * qw[eid] / qd * rw
            T += 3 * tw[eid] / td * H.STRENGTH.get(place, 0) * rw
            if r["place"] == 1:
                Hh += (2.5 if t["tier"] == "champions" else 1.25) * H.dec(r["end"], cut, 1460) * rw
            X += rw * H.dec(r["end"], cut, 1460)
        elif r["tier"] in ("league", "kickoff"):
            ev = world.events[eid]
            slot = H.slot_of(ev["slug"], ev["year"])
            if slot and slot != "lcq":
                yearly[ev["year"]][slot].append((r["u"], rw, r["end"]))
                if r["place"] == 1:
                    titles[ev["year"]] += .75 * H.dec(r["end"], cut, 730) * rw
    D = 0.0
    for y, slots in yearly.items():
        parts = [sum(u * a * H.dec(day, cut, 730) for u, a, day in es) / max(1, sum(a for _, a, _ in es)) for es in slots.values()]
        D += max(2 * sum(parts) / 3, titles.get(y, 0))
    E = 3 * (1 - math.exp(-X / 3))
    O = Q + T + E + min(3, D)
    return {"cut": cut, "Q": Q, "T": T, "E": E, "D": min(3, D), "O": O, "H": Hh}


def main() -> int:
    world = World()
    tenures = json.loads((OUT / "coach_tenures.json").read_text())["people"]
    people = H.read("data-raw/people.json")
    people = people.get("people", people)
    births = {k: v.get("birth") for k, v in people.items() if v.get("birth")}
    K, nseries = series_scale(world)
    curve = age_curve(world, births)
    print(f"series scale {K:.1f} from {nseries} playoff series; age curve {curve.round(4).tolist()}")

    rows = []
    for person in tenures:
        ev_rows, ser_rows, dev_rows = [], [], []
        last_day = None
        for st in person["stints"]:
            rw = ROLE_W.get(st.get("role"), 0)
            if rw <= 0 or not st.get("teamId"):
                continue
            for eid in stint_events(world, st):
                ev = world.events[eid]
                tid = st["teamId"]
                place = world.place(eid, tid)
                field = world.field(eid)
                if place is None or field < 4:
                    continue
                exp = expected_rank(world, eid, tid)
                u, ue = percentile(place, field), percentile(exp, field)
                end = ev["end"]
                last_day = max(last_day or end, end)
                ev_rows.append({"eid": eid, "event": ev.get("name") or ev["slug"], "end": end, "tier": ev["tier"],
                                "team": st["team"], "role": st["role"], "w": rw * TIER_W.get(ev["tier"], 1),
                                "field": field, "place": place, "expected": exp, "u": u, "ue": ue, "r": u - ue,
                                "five": world.teams[eid][tid]["five"]})
                for m in ev.get("series") or []:
                    if tid not in (m["a"], m["b"]):
                        continue
                    opp = m["b"] if m["a"] == tid else m["a"]
                    if opp not in world.teams[eid]:
                        continue
                    diff = world.team_strength(eid, tid) - world.team_strength(eid, opp)
                    pwin = 1 / (1 + math.exp(-K * diff))
                    won = 1.0 if m["winner"] == tid else 0.0
                    ser_rows.append({"eid": eid, "round": m["round"], "end": end, "w": rw, "won": won, "p": pwin,
                                     "r": won - pwin, "score": f'{m["sa"]}-{m["sb"]}' if m["a"] == tid else f'{m["sb"]}-{m["sa"]}'})
            # development: each player who played an event under him in this stint
            seen = defaultdict(list)
            for r in ev_rows:
                if r["team"] == st["team"]:
                    for pid in r["five"]:
                        seen[pid].append(r["end"])
            for pid, ends in seen.items():
                a = st.get("from")
                if not a:
                    continue  # a current-roster listing without a start date
                b = min(st.get("to") or ASOF, max(ends))
                if d(b).toordinal() - d(a).toordinal() < 120:
                    continue
                L0, L1 = world.strength(pid, a), world.strength(pid, b)
                n0 = sum(x["n"] for x in world.by_pid.get(pid, []) if x["date"] < a)
                if n0 < 300:
                    continue  # no honest starting point
                yrs = (d(b) - d(a)).days / 365.25
                bd = births.get(pid)
                age = (d(a) - d(bd)).days / 365.25 if bd else 22
                drift = float(curve @ np.array([1, age - 22, (age - 22) ** 2])) * yrs
                dev_rows.append({"pid": pid, "from": a, "to": b, "w": rw * min(1.0, yrs), "L0": L0, "L1": L1,
                                 "expected": drift, "r": (L1 - L0) - drift})
        # an active coach is read as of today with the team-result half-life,
        # an inactive one over his whole career — the same split as players
        cut = ASOF if person["status"] == "active" else None
        fade = (lambda day: H.dec(day, cut, HALF)) if cut else (lambda day: 1.0)

        def shrunk(rr, key, when="end"):
            w = sum(x["w"] * fade(x[when]) for x in rr)
            return (sum(x["w"] * fade(x[when]) * x["r"] for x in rr) / (w + PRIOR[key]) if rr else 0.0), w
        tac, wt = shrunk(ev_rows, "tactics")
        dev, wd = shrunk(dev_rows, "development", "to")
        mot, wm = shrunk(ser_rows, "motivation")
        rec = record(world, ev_rows, cut or (date.fromordinal(d(last_day).toordinal() + 1).isoformat() if last_day else ASOF))
        rows.append({"key": person["key"], "name": person["name"], "vlrId": person.get("vlrId"), "real": person.get("real"),
                     "record": rec,
                     "nat": person.get("nat"), "status": person["status"], "lastEvent": last_day,
                     "tactics_raw": tac, "development_raw": dev, "motivation_raw": mot,
                     "evidence": {"events": len(ev_rows), "eventWeight": wt, "players": len(dev_rows), "playerWeight": wd,
                                  "series": len(ser_rows), "seriesWeight": wm},
                     "events": ev_rows, "series": ser_rows, "development": dev_rows})
    (OUT / "coach_raw.json").write_text(json.dumps({"seriesScale": K, "ageCurve": curve.tolist(), "coaches": rows},
                                                   ensure_ascii=False, indent=1))
    ok = [r for r in rows if r["evidence"]["events"]]
    print(len(rows), "coaches,", len(ok), "with scored events")
    for r in sorted(ok, key=lambda r: -r["tactics_raw"])[:12]:
        print(f'{r["name"]:12} tac {r["tactics_raw"]:+.3f} ({r["evidence"]["events"]} ev) dev {r["development_raw"]:+.4f} ({r["evidence"]["players"]}) mot {r["motivation_raw"]:+.3f} ({r["evidence"]["series"]})')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
