"""
Deliverable two: the agent correction, as an experiment with everything else held.

    python3 -m scripts.rating.agents

From scripts/cache/vlr_matches.json (player × map × agent lines) two versions
of a player's per-event abilities are built for the events the match cache
covers:
  A  the pipeline's own: metrics standardised by (role, tier, season) — what
     report2 uses;
  B  agent-corrected: each map line standardised against the normal level
     ON THAT AGENT (agent × tier group × season, falling back to agent, then
     to the agent's role, then to all), then rounds-weighted into the event.
The abilities are then blended exactly as in scheme2. Compared, on the same
people and events:
  1. the coupling of aim and utility inside controllers (a good gun with few
     assists should not be a double penalty);
  2. the mean utility / teamwork by role before and after (a correction that
     only moves controllers up and initiators down has done its job; one
     that reorders everyone has not);
  3. prediction at the 2026 Stage 2 cutoff from the 2026 Stage 1 + Masters
     lines only: combat vs in-event Rating, utility vs in-event APR (raw and
     agent-corrected);
  4. the named men and the largest movers, ability by ability.
Clutch has no map-level source and stays as A in both.
"""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from datetime import date
from pathlib import Path

from .common import AGENT_ROLE, ROLES, STAT_ABILITIES, TEMPLATES, clamp, mean_sd, pearson, spearman
from .dataset import load_records, world_players
from .models import _blend
from .scheme2 import EventEnv, event_lines

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "analysis" / "rating"
MATCHES = ROOT / "scripts" / "cache" / "vlr_matches.json"
EVENTS = ROOT / "scripts" / "cache" / "vlr_event_stats.json"
NAMED = ["Chronicle", "CHICHOO", "Less", "Boaster", "Boo", "Ethan", "nobody", "Nicc", "Jieni7", "Lakia", "skuba", "leaf"]
MIN_LINES = 25
METRICS = ("adr", "kpr", "hs", "fc_succ", "kd", "kast", "dpr", "fd_rate", "apr")


def load_lines():
    mc = json.loads(MATCHES.read_text("utf-8"))
    ev = json.loads(EVENTS.read_text("utf-8"))["events"]
    lines = []
    for mid, m in mc["matches"].items():
        meta = ev.get(m["eid"], {})
        tier = meta.get("tier", "league")
        group = "intl" if tier in ("masters", "champions") else ("t2" if tier == "challengers" else "vct")
        for mp in m["maps"]:
            rnd = sum(mp["score"]) if mp.get("score") else 0
            if rnd < 13:
                continue
            for r in mp["rows"]:
                if not r.get("vlrId") or not r.get("agent") or r.get("k") is None:
                    continue
                fc = (r["fk"] or 0) + (r["fd"] or 0)
                lines.append({
                    "key": r["vlrId"], "ign": r["ign"], "eid": m["eid"], "year": int(meta.get("year", 2026)), "group": group,
                    "agent": r["agent"], "role": AGENT_ROLE.get(r["agent"], "自由人"), "rnd": rnd,
                    "adr": r["adr"], "kpr": r["k"] / rnd, "hs": r["hs"], "fc_succ": (r["fk"] / fc) if fc >= 3 else None,
                    "kd": (r["k"] / r["d"]) if r["d"] else None, "kast": r["kast"], "dpr": r["d"] / rnd,
                    "fd_rate": (r["fd"] or 0) / rnd, "apr": (r["a"] or 0) / rnd, "rating2": r["rating2"], "fc": fc,
                })
    return lines


class AgentEnv:
    """normal level per metric on an agent, rounds-weighted, with fallbacks"""

    def __init__(self, lines):
        self.t = {}
        for keyf in (lambda l: (l["agent"], l["group"], l["year"]), lambda l: (l["agent"],), lambda l: (l["role"],), lambda l: ()):
            b = defaultdict(list)
            for l in lines:
                b[keyf(l)].append(l)
            for k, ls in b.items():
                tab = self.t.setdefault(k, {})
                for m in METRICS:
                    xs = [(l[m], l["rnd"]) for l in ls if l[m] is not None]
                    if len(xs) >= MIN_LINES or k == ():
                        w = sum(n for _, n in xs) or 1
                        mu = sum(v * n for v, n in xs) / w
                        sd = (sum(n * (v - mu) ** 2 for v, n in xs) / w) ** 0.5 or 1e-6
                        tab[m] = (mu, sd)

    def z(self, l, m):
        v = l.get(m)
        if v is None:
            return None
        for k in ((l["agent"], l["group"], l["year"]), (l["agent"],), (l["role"],), ()):
            if m in self.t.get(k, {}):
                mu, sd = self.t[k][m]
                return (v - mu) / sd
        return None


def abilities_from(z):
    ab = {
        "aim": _blend([(z["adr"], .5), (z["kpr"], .3), (z["hs"], .2)]),
        "reaction": _blend([(z["fc_succ"], .6), (z["kd"], .4)]),
        "awareness": _blend([(z["kast"], .4), (None if z["dpr"] is None else -z["dpr"], .35), (None if z["fd_rate"] is None else -z["fd_rate"], .25)]),
        "utility": z["apr"], "teamwork": _blend([(z["kast"], .5), (z["apr"], .5)]),
    }
    return {k: (0.0 if v is None else clamp(v, -3, 3)) for k, v in ab.items()}


def agent_event_abilities(lines, env):
    """(key, eid) -> abilities B, rounds-weighted over the man's maps in the event; plus his role share there"""
    by = defaultdict(list)
    for l in lines:
        by[(l["key"], l["eid"])].append(l)
    out = {}
    for k, ls in by.items():
        tot = sum(l["rnd"] for l in ls)
        acc = {m: 0.0 for m in METRICS}
        wsum = {m: 0.0 for m in METRICS}
        for l in ls:
            for m in METRICS:
                z = env.z(l, m)
                if z is not None:
                    acc[m] += z * l["rnd"]
                    wsum[m] += l["rnd"]
        z = {m: (acc[m] / wsum[m] if wsum[m] > 0 else None) for m in METRICS}
        share = defaultdict(float)
        for l in ls:
            share[l["role"]] += l["rnd"] / tot
        out[k] = (abilities_from(z), dict(share), tot, ls[0]["ign"])
    return out


def combat_of(ab, share, clutch=0.0):
    full = {**ab, "clutch": clutch}
    return sum(share.get(x, 0.0) * sum(TEMPLATES[x][k] * full[k] for k in STAT_ABILITIES) for x in ROLES)


def main():
    lines = load_lines()
    records = load_records()
    world = world_players()
    covered = {l["eid"] for l in lines}
    env_b = AgentEnv(lines)
    B = agent_event_abilities(lines, env_b)
    # A: the pipeline's per-event lines on the same events (env over the same cache window)
    recs_cov = [r for r in records if r.eid in covered]
    envA = EventEnv(recs_cov)
    A_lines = event_lines(records, date(2100, 1, 1), envA)
    A = {}
    for key, ls in A_lines.items():
        for e in ls:
            eid = next((r.eid for r in recs_cov if r.key == key and r.end == e.end), None)
            if eid:
                A[(key, eid)] = (e.abilities, e.role_share, e.rnd, e.z)
    both = [k for k in B if k in A]
    L = ["# 第 2 步：同英雄校正实验\n",
         f"生成于 {date.today().isoformat()}。比赛缓存：{len(json.loads(MATCHES.read_text('utf-8'))['matches'])} 场、{len(lines)} 条「选手 × 地图 × 英雄」线，覆盖赛事 {len(covered)} 个；与赛事表都有的「选手 × 赛事」{len(both)} 条。其余条件固定，只把 utility / teamwork / awareness / aim / reaction 的标准化从（位置 × 层级 × 赛季）换成（英雄 × 层级 × 赛季）。残局无单图来源，两边相同。\n"]

    # 1. aim–utility coupling inside controllers
    L.append("## 1. 控场里「枪法 × 道具」的耦合\n")
    L.append("| 版本 | 控场 corr(aim, utility) | 先锋 | 决斗 | 哨卫 |")
    L.append("|---|---|---|---|---|")
    for name, src in (("A 位置中心化", A), ("B 同英雄", B)):
        cells = []
        for role in ROLES:
            ks = [k for k in both if max(src[k][1], key=src[k][1].get) == role]
            cells.append(f"{pearson([src[k][0]['aim'] for k in ks], [src[k][0]['utility'] for k in ks]) or 0:+.2f} (n={len(ks)})")
        L.append(f"| {name} | " + " | ".join(cells) + " |")
    L.append("\n负相关越强，枪强助攻少的人在两项上被同向扣得越重。校正后这个耦合若明显减弱，说明 APR 的差异被英雄解释掉了一部分。\n")

    # 2. role means
    L.append("## 2. 各位置的均值（同一批选手 × 赛事）\n")
    L.append("| 版本 | 位置 | utility | teamwork | awareness | aim | 作战 |")
    L.append("|---|---|---|---|---|---|---|")
    for name, src in (("A", A), ("B", B)):
        for role in ROLES:
            ks = [k for k in both if max(src[k][1], key=src[k][1].get) == role]
            if len(ks) < 10:
                continue
            m = lambda ab: statistics.fmean(src[k][0][ab] for k in ks)  # noqa: E731
            L.append(f"| {name} | {role} | {m('utility'):+.2f} | {m('teamwork'):+.2f} | {m('awareness'):+.2f} | {m('aim'):+.2f} | {statistics.fmean(combat_of(src[k][0], src[k][1]) for k in ks):+.2f} |")
    L.append("\nA 按位置中心化，各位置均值必然接近 0；B 按英雄中心化后位置均值可以偏离 0，偏离的方向和大小就是「同位置里常用英雄的机制差」被吸收了多少。\n")

    # 3. prediction at the 2026 Stage 2 cutoff, from Stage 1 + Masters London
    ev = json.loads(EVENTS.read_text("utf-8"))["events"]
    s2 = {eid for eid in covered if "2026" in ev[eid]["slug"] and "stage-2" in ev[eid]["slug"]}
    s1 = {eid for eid in covered if "2026" in ev[eid]["slug"] and ("stage-1" in ev[eid]["slug"] or "london" in ev[eid]["slug"])}
    train = {k: v for k, v in B.items() if k[1] in s1}
    L.append("## 3. 预测：用 2026 Stage 1 + 伦敦 Masters 的线预测 2026 Stage 2\n")
    tgt_r2, tgt_apr_raw, tgt_apr_b = {}, {}, {}
    for eid in s2:
        rows = [r for r in records if r.eid == eid and r.rnd >= 60]
        vals = {r.key: r.rating2 for r in rows if r.rating2 is not None}
        aprs = {r.key: r.a / r.rnd for r in rows if r.a is not None}
        if len(vals) < 5:
            continue
        mu, sd = mean_sd(list(vals.values()))
        for k, v in vals.items():
            tgt_r2[k] = (v - mu) / sd
        mu2, sd2 = mean_sd(list(aprs.values()))
        for k, v in aprs.items():
            tgt_apr_raw[k] = (v - mu2) / sd2
        for (key, e), (ab, share, rnd, ign) in B.items():
            if e == eid:
                tgt_apr_b[key] = ab["utility"]
    def agg(src, keys_set):
        acc = defaultdict(lambda: defaultdict(float)); w = defaultdict(float); sh = defaultdict(lambda: defaultdict(float))
        for (key, e), v in src.items():
            if e not in keys_set:
                continue
            ab, share, rnd = v[0], v[1], v[2]
            for k2, x in ab.items():
                acc[key][k2] += x * rnd
            for r, s in share.items():
                sh[key][r] += s * rnd
            w[key] += rnd
        return {key: ({k2: x / w[key] for k2, x in acc[key].items()}, {r: s / w[key] for r, s in sh[key].items()}) for key in w if w[key] >= 200}
    predA, predB = agg(A, s1), agg(B, s1)
    common = [k for k in predA if k in predB and k in tgt_r2]
    L.append(f"同一批人 n={len(common)}（Stage 1 + 伦敦 ≥200 回合且打了 Stage 2）。\n")
    L.append("| 版本 | ρ(作战, Stage 2 Rating) | ρ(utility, Stage 2 原始 APR) | ρ(utility, Stage 2 同英雄 APR) | ρ(aim, Stage 2 Rating) |")
    L.append("|---|---|---|---|---|")
    for name, pred in (("A", predA), ("B", predB)):
        c = [combat_of(pred[k][0], pred[k][1]) for k in common]
        L.append(f"| {name} | {spearman(c, [tgt_r2[k] for k in common]) or 0:.3f} | {spearman([pred[k][0]['utility'] for k in common], [tgt_apr_raw.get(k, 0) for k in common]) or 0:.3f} | {spearman([pred[k][0]['utility'] for k in common], [tgt_apr_b.get(k, 0) for k in common]) or 0:.3f} | {spearman([pred[k][0]['aim'] for k in common], [tgt_r2[k] for k in common]) or 0:.3f} |")
    for role in ROLES:
        ks = [k for k in common if max(predA[k][1], key=predA[k][1].get) == role]
        if len(ks) >= 8:
            L.append(f"| {role} n={len(ks)}: A / B | {spearman([combat_of(predA[k][0], predA[k][1]) for k in ks], [tgt_r2[k] for k in ks]) or 0:.3f} / {spearman([combat_of(predB[k][0], predB[k][1]) for k in ks], [tgt_r2[k] for k in ks]) or 0:.3f} | | | |")

    # 4. named men and movers, over all covered events
    L.append("\n## 4. 关键选手（覆盖赛事内全部线，回合加权）\n")
    L.append("| 选手 | 位置 | 场次 | aim A/B | utility A/B | teamwork A/B | awareness A/B | 作战 A/B |")
    L.append("|---|---|---|---|---|---|---|---|")
    allA, allB = agg(A, covered), agg(B, covered)
    ign_of = {k: v[3] for k, v in B.items()}
    keys = {ign_of[k]: k[0] for k in B}
    deltas = sorted(((combat_of(allB[k][0], allB[k][1]) - combat_of(allA[k][0], allA[k][1]), k) for k in allA if k in allB), key=lambda t: t[0])
    show = [keys[n] for n in NAMED if n in keys] + [k for _, k in deltas[-5:]][::-1] + [k for _, k in deltas[:5]]
    seen = set()
    for k in show:
        if k in seen or k not in allA or k not in allB:
            continue
        seen.add(k)
        a, b = allA[k], allB[k]
        ign = next(v for (kk, e), v in B.items() if kk == k)[3]
        n = sum(1 for (kk, e) in B if kk == k)
        L.append(f"| {ign} | {max(a[1], key=a[1].get)} | {n} | {a[0]['aim']:+.2f}/{b[0]['aim']:+.2f} | {a[0]['utility']:+.2f}/{b[0]['utility']:+.2f} | {a[0]['teamwork']:+.2f}/{b[0]['teamwork']:+.2f} | {a[0]['awareness']:+.2f}/{b[0]['awareness']:+.2f} | {combat_of(a[0], a[1]):+.2f}/{combat_of(b[0], b[1]):+.2f} |")
    L.append("\n前面是点名的；之后是作战值上升最多和下降最多的各五人。")
    (OUT / "report_agents.md").write_text("\n".join(L) + "\n", "utf-8")
    print(f"report -> {OUT / 'report_agents.md'}")


if __name__ == "__main__":
    main()
