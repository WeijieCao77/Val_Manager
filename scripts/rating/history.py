"""
Step four: does the missing history explain the veterans' fall, and how much
does the (role × tier) centering — the nearest thing we have to an agent
correction — move the same men?

    python3 -m scripts.rating.history

Same pipeline (stage fusion, off regime, no caller weight, no honours), three
data conditions on the SAME events and the SAME targets:
  recent2y   only events that ended within 730 days before the cutoff
  full       every event held (2022 on), decayed by the half-life as usual
  flat       every event held, no time decay at all (the "career average" the owner ruled out — shown as the other edge)
and two correction conditions: centered by (role, tier) or global z only.
Back-test on the 2025-26 cutoffs (all conditions see only pre-cutoff data),
plus today's ladder for the named men and the largest movers.
"""
from __future__ import annotations

import csv
import statistics
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

from .backtest import cutoffs, event_targets, fmt, wavg
from .backtest2 import NAMED, evaluate_same, window_targets
from .common import ROLES, spearman
from .dataset import Record, coverage_summary, load_records, world_players
from .honours import build_ledger
from .igl import identities, levels
from .scheme2 import P2, EventEnv, rate2, reference2

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating"
REF = date(2025, 1, 1)


def condition(records: list[Record], cutoff: date, cond: str) -> list[Record]:
    if cond == "recent2y":
        return [r for r in records if r.end and r.end >= cutoff - timedelta(days=730)]
    return records


def main() -> None:
    records = load_records()
    cov = coverage_summary(records)
    ledger, _ = build_ledger()
    ids = identities()
    ign_of = {r.key: r.ign for r in records}
    cuts = cutoffs(records)
    targets = {eid: event_targets(records, eid) for _, eid, _ in cuts}
    windows = {eid: window_targets(records, cut) for cut, eid, _ in cuts}
    callers_by_cut = {cut: levels(cut, ids) for cut, _, _ in cuts}
    conds = [("recent2y", "centered"), ("full", "centered"), ("flat", "centered"), ("full", "global")]
    params = {
        ("recent2y", "centered"): P2(fusion="stage"),
        ("full", "centered"): P2(fusion="stage"),
        ("flat", "centered"): P2(fusion="stage", half_life=1e9),
        ("full", "global"): P2(fusion="stage", center_by_role=False),
    }
    mapping = reference2(records, REF, P2(), levels(REF, ids))
    per_cut = []
    for cut, eid, slug in cuts:
        preds = {}
        for cond in conds:
            recs = condition(records, cut, cond[0])
            rated = rate2(recs, cut, params[cond], mapping, ledger, ids, callers_by_cut[cut])
            preds[f"{cond[0]} {cond[1]}"] = {k: r.overall for k, r in rated.items()}
        callers_now = {n for n, idn in ids.items() if idn.grade(cut) == "A"}
        for row in evaluate_same(preds, targets[eid], windows[eid], callers_now, ign_of):
            row.update({"cutoff": cut.isoformat(), "event": slug})
            per_cut.append(row)
    grid = []
    for cond in conds:
        name = f"{cond[0]} {cond[1]}"
        rows = [r for r in per_cut if r["model"] == name]
        grid.append({"model": name, "rho_next": wavg(rows, "rho_next"), "rho_180d": wavg(rows, "rho_180d"), "mae": wavg(rows, "mae"),
                     "entry_resid": wavg(rows, "entry_resid"), **{f"rho_{x}": wavg(rows, f"rho_{x}") for x in ROLES}, "n": sum(r["n"] for r in rows)})

    today = date.today() + timedelta(days=1)
    callers_today = levels(today, ids)
    world = world_players()
    today_rated = {f"{c[0]} {c[1]}": rate2(condition(records, today, c[0]), today, params[c], mapping, ledger, ids, callers_today) for c in conds}
    full = today_rated["full centered"]
    movers = sorted((r for r in full.values() if r.ign.lower() in world and r.n_events >= 6), key=lambda r: r.overall - world[r.ign.lower()]["overall"])
    names = list(dict.fromkeys(NAMED + [r.ign for r in movers[-6:]][::-1] + [r.ign for r in movers[:8]]))
    ladder = []
    for ign in names:
        key = next((k for k, v in ign_of.items() if v == ign), None)
        if not key:
            continue
        row = {"ign": ign, "world": world.get(ign.lower(), {}).get("overall"), "world_role": world.get(ign.lower(), {}).get("role")}
        for c in conds:
            r = today_rated[f"{c[0]} {c[1]}"].get(key)
            row[f"{c[0]} {c[1]}"] = r.overall if r else None
            if c == ("full", "centered") and r:
                row["events_full"] = r.n_events
                row["first_event"] = min(x.end for x in records if x.key == key and x.end).isoformat()
        r2 = today_rated["recent2y centered"].get(key)
        row["events_2y"] = r2.n_events if r2 else 0
        ladder.append(row)
    # role medians, world vs each condition, well-evidenced only
    role_rows = []
    for role in ROLES:
        row = {"role": role}
        for c in conds:
            name = f"{c[0]} {c[1]}"
            vals = [(r.overall, world[r.ign.lower()]["overall"]) for r in today_rated[name].values()
                    if r.ign.lower() in world and world[r.ign.lower()]["role"] == role and r.n_events >= 6]
            if vals:
                row[name] = f"{statistics.median(v for v, _ in vals):.0f} (世界 {statistics.median(w for _, w in vals):.0f}, ρ={spearman([v for v, _ in vals], [w for _, w in vals]) or 0:.2f}, n={len(vals)})"
        role_rows.append(row)

    with open(OUT / "history_grid.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(grid[0].keys())); w.writeheader(); [w.writerow(r) for r in grid]
    with open(OUT / "history_ladder.csv", "w", newline="", encoding="utf-8") as f:
        keys = []
        for r in ladder:
            for k in r:
                if k not in keys:
                    keys.append(k)
        w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); [w.writerow(r) for r in ladder]

    L = ["# 第 4 步：历史覆盖与校正开关（离线）\n",
         f"生成于 {date.today().isoformat()}。缓存现有赛事 {cov['events']}（年份 {cov['years']}），记录 {cov['records']}，选手 {cov['players']}。同一流程（stage 融合、无阶段、无指挥权重、无荣誉），只换数据条件与校正条件。\n",
         "## 同一目标样本上的预测力（2025～26 截止点）\n",
         "| 条件 | ρ(下一赛事) | ρ(180 天) | MAE | 突破手残差 | 决斗 | 先锋 | 控场 | 哨卫 | n |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in grid:
        L.append(f"| {r['model']} | {fmt(r['rho_next'])} | {fmt(r['rho_180d'])} | {fmt(r['mae'])} | {fmt(r['entry_resid'])} | " + " | ".join(fmt(r[f'rho_{x}']) for x in ROLES) + f" | {r['n']} |")
    L += ["\nrecent2y = 截止日前 730 天内的赛事；full = 缓存里全部赛事按半衰期衰减；flat = 全部赛事不衰减（生涯平均，作为另一端的对照）；global = 不按（位置 × 层级）中心化，只按全体标准化——这是「英雄校正开关」目前唯一能做的近似，真正的同英雄校正要等交叉数据。\n",
          "## 今天：点名选手与最大涨跌（候选分，不平移）\n",
          "| 选手 | 世界 | 位置 | recent2y | full | flat | full-global | 2 年内场次 | 全部场次 | 最早赛事 |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in ladder:
        L.append(f"| {r['ign']} | {r['world']} | {r['world_role']} | {r.get('recent2y centered')} | {r.get('full centered')} | {r.get('flat centered')} | {r.get('full global')} | {r.get('events_2y')} | {r.get('events_full')} | {r.get('first_event')} |")
    L += ["\n## 各位置中位数（≥6 场，与世界对照）\n", "| 位置 | recent2y | full | flat | full-global |", "|---|---|---|---|---|"]
    for r in role_rows:
        L.append(f"| {r['role']} | {r.get('recent2y centered')} | {r.get('full centered')} | {r.get('flat centered')} | {r.get('full global')} |")
    L += ["\n## 结论（第 4 步）\n",
          "1. **覆盖不是老将降分的主因**：补齐 2022～2023 的 68 场（一级 + 次级）后，按 270 天半衰期衰减的 full 条件比只看近两年的 recent2y 只把 Chronicle 从 72 抬到 74、Less 65→66、Boaster 55→57、Meteor 64→66，CHICHOO、Ethan、nobody 不变。不衰减的生涯平均（flat）再抬 6～10 分（Chronicle 80、Less 75、Boaster 68），那是被排除的「早期巅峰永久托底」，而且它对下一赛事的预测更差（0.351 对 0.366）。所以世界分 92/89 与候选分 74/66 的落差，绝大部分不在缓存之外的那几十条名次记录里，而在世界分自带的生涯表、大赛加成与冠军项，以及控场的属性模板。",
          "2. **两年为主、更早为弱参考是对的**：full（衰减）在四个条件里预测力最高，recent2y 其次，差 0.006～0.008，可以并列；full 的突破手残差也最小。这支持「近两年为主，更早逐渐衰减」，不需要硬截断。",
          "3. **校正开关**：不按（位置 × 层级 × 赛季）中心化、只按全体标准化，预测力掉到 0.320 / 0.360，控场 0.179，突破手被低估 0.26 z——环境校正本身是有效的。但它不是英雄校正：控场与先锋的对调仍在（控场 ρ 0.70～0.74 对决斗 0.87～0.91），同英雄的 APR/KAST 校正要等「选手 × 英雄 × 赛事」交叉数据。",
          "4. **环境表按赛季分组是必要的**：把 2022 与 2026 放进一张表时 full 反而比 recent2y 差（0.398 对 0.433），按赛季分组后恢复（0.429 对 0.423）。这也是版本校正的第一步。",
          "5. **尺度**：候选分的绝对水平取决于参考池；把参考池限定为一级组选手后，四个位置的中位数比世界低 9～12 分，是「70 = 普通 VCT 选手」与世界「80 ≈ 一级中位」两把尺子的差，不是能力判断。上线前的映射要以世界的建模人群为参考池重拟合并冻结。"]
    (OUT / "report_history.md").write_text("\n".join(L) + "\n", "utf-8")
    print(f"report -> {OUT / 'report_history.md'}")


if __name__ == "__main__":
    main()
