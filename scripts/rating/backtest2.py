"""
Round two: the stable baseline, retiring history, honours, the caller's
overall — compared on the same target sample, with the named players taken
apart step by step.

    python3 -m scripts.rating.backtest2

Writes analysis/rating/report2.md and the CSVs beside it.
"""
from __future__ import annotations

import csv
import itertools
import json
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from .backtest import cutoffs, event_targets, fmt, wavg
from .common import ROLES, STAT_ABILITIES, mean_sd, spearman
from .dataset import Record, coverage_summary, load_records, world_players
from .honours import build_ledger
from .igl import identities, levels
from .models import Params, current_scheme, simple_baseline
from .scheme2 import P2, rate2, reference2

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating"
REF = date(2025, 1, 1)
NAMED = ["Chronicle", "CHICHOO", "Less", "Boaster", "Boo", "Ethan", "nobody"]
ROOT = Path(__file__).resolve().parents[2]


def window_targets(records: list[Record], cutoff: date, days: int = 180) -> dict[str, float]:
    """weighted mean of in-event Rating z over events STARTING within `days` after the cutoff; ≥2 events"""
    acc: dict[str, list[tuple[float, float]]] = defaultdict(list)
    by_event: dict[str, list[Record]] = defaultdict(list)
    for r in records:
        if r.start and not r.date_estimated and cutoff <= r.start < cutoff + timedelta(days=days) and r.tier != "challengers":
            by_event[r.eid].append(r)
    for eid, rows in by_event.items():
        vals = {r.key: r.rating2 for r in rows if r.rating2 is not None and r.rnd >= 60}
        if len(vals) < 5:
            continue
        mu, sd = mean_sd(list(vals.values()))
        for r in rows:
            if r.key in vals:
                acc[r.key].append(((vals[r.key] - mu) / sd, r.rnd))
    return {k: sum(z * n for z, n in v) / sum(n for _, n in v) for k, v in acc.items() if len(v) >= 2}


def evaluate_same(preds: dict[str, dict[str, float]], tgt: dict[str, dict], win: dict[str, float],
                  callers_now: set[str], ign_of: dict[str, str]) -> list[dict]:
    """every model on the keys ALL models cover"""
    common = [k for k in tgt if tgt[k]["r2"] is not None and all(k in p for p in preds.values())]
    rows = []
    for name, p in preds.items():
        a = [p[k] for k in common]
        r2 = [tgt[k]["r2"] for k in common]
        row = {"model": name, "n": len(common), "rho_next": spearman(a, r2)}
        wk = [k for k in common if k in win]
        row["rho_180d"] = spearman([p[k] for k in wk], [win[k] for k in wk])
        row["n_180d"] = len(wk)
        if len(common) >= 5:
            mz, sz = mean_sd(a)
            res = {k: tgt[k]["r2"] - (p[k] - mz) / sz for k in common}
            row["mae"] = statistics.fmean(abs(v) for v in res.values())
            fcp = sorted(tgt[k]["fc_part"] for k in common if tgt[k]["fc_part"] is not None)
            if len(fcp) >= 8:
                q = fcp[int(len(fcp) * 0.75)]
                ent = [res[k] for k in common if (tgt[k]["fc_part"] or 0) >= q]
                row["entry_resid"] = statistics.fmean(ent) if ent else None
            for role in ROLES:
                ks = [k for k in common if tgt[k]["role"] == role]
                row[f"rho_{role}"] = spearman([p[k] for k in ks], [tgt[k]["r2"] for k in ks])
            ck = [k for k in common if ign_of.get(k, "").lower() in callers_now]
            nk = [k for k in common if ign_of.get(k, "").lower() not in callers_now]
            row["rho_callers"] = spearman([p[k] for k in ck], [tgt[k]["r2"] for k in ck])
            row["n_callers"] = len(ck)
            row["resid_callers"] = statistics.fmean(res[k] for k in ck) if ck else None
            row["resid_others"] = statistics.fmean(res[k] for k in nk) if nk else None
            wck = [k for k in ck if k in win]
            row["rho_180d_callers"] = spearman([p[k] for k in wck], [win[k] for k in wck])
        rows.append(row)
    return rows


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    records = load_records()
    cov = coverage_summary(records)
    ledger, unknown = build_ledger()
    ids = identities()
    ign_of = {r.key: r.ign for r in records}
    cuts = cutoffs(records)
    targets = {eid: event_targets(records, eid) for _, eid, _ in cuts}
    windows = {eid: window_targets(records, cut) for cut, eid, _ in cuts}
    callers_by_cut = {cut: levels(cut, ids) for cut, _, _ in cuts}
    callers_ref = levels(REF, ids)

    configs = [(f"{sch} igl={w} hon={c}", P2(time_scheme=sch, igl_weight=w, honour_cap=c))
               for sch, w, c in itertools.product(("decay", "stage", "regime"), (0.0, 0.25, 0.35, 0.45), (0.0, 3.0, 6.0))]
    maps = {sch: reference2(records, REF, P2(time_scheme=sch), callers_ref) for sch in ("decay", "stage", "regime")}
    # the decay scheme's own reference mapping (round one) for its combat scale
    from .models import reference_mapping
    maps["decay"] = {**maps["decay"], **reference_mapping(records, REF, Params())}

    per_cut: list[dict] = []
    recent_share = defaultdict(list)
    regime_counts = defaultdict(lambda: defaultdict(int))
    for cut, eid, slug in cuts:
        preds: dict[str, dict[str, float]] = {}
        preds["current(rebuilt)"] = {k: r.overall_z for k, r in current_scheme(records, cut).items()}
        preds["baseline-R2 hl=270"] = {k: r.overall_z for k, r in simple_baseline(records, cut, 270).items()}
        for name, P in configs:
            rated = rate2(records, cut, P, maps[P.time_scheme], ledger, ids, callers_by_cut[cut])
            preds[name] = {k: r.overall for k, r in rated.items()}
            if P.igl_weight == 0 and P.honour_cap == 0:
                recent_share[P.time_scheme].extend(r.recent_share for r in rated.values() if r.n_events >= 3)
                for r in rated.values():
                    regime_counts[P.time_scheme][r.regime.split("@")[0]] += 1
        callers_now = {n for n, L in callers_by_cut[cut].items() if L.events > 0 or ids[n].since is None or ids[n].since <= cut}
        for row in evaluate_same(preds, targets[eid], windows[eid], callers_now, ign_of):
            row.update({"cutoff": cut.isoformat(), "event": slug})
            per_cut.append(row)

    def summary(name: str) -> dict:
        rows = [r for r in per_cut if r["model"] == name]
        cols = ("rho_next", "rho_180d", "mae", "entry_resid", "rho_callers", "resid_callers", "resid_others", "rho_180d_callers",
                *[f"rho_{r}" for r in ROLES])
        return {"model": name, **{c: wavg(rows, c) for c in cols}, "n": sum(r["n"] for r in rows),
                "n_180d": sum(r["n_180d"] for r in rows), "n_callers": sum(r.get("n_callers", 0) for r in rows)}
    grid = [summary(n) for n in ["current(rebuilt)", "baseline-R2 hl=270"] + [n for n, _ in configs]]

    # ---- today: the ladders for the named players and the big movers
    today = date.today() + timedelta(days=1)
    callers_today = levels(today, ids)
    world = world_players()
    steps = [
        ("current(rebuilt)", None),
        ("decay(round one)", P2(time_scheme="decay")),
        ("stage", P2(time_scheme="stage")),
        ("regime", P2(time_scheme="regime")),
        ("regime + igl .35", P2(time_scheme="regime", igl_weight=0.35)),
        ("regime + igl .35 + hon 6", P2(time_scheme="regime", igl_weight=0.35, honour_cap=6.0)),
    ]
    today_rated = {}
    cur_today = current_scheme(records, today)
    for name, P in steps:
        today_rated[name] = cur_today if P is None else rate2(records, today, P, maps[P.time_scheme], ledger, ids, callers_today)
    final = today_rated[steps[-1][0]]
    recs_json = json.loads((ROOT / "src" / "data" / "records.json").read_text("utf-8"))["players"]
    evc = json.loads((ROOT / "scripts" / "cache" / "vlr_event_stats.json").read_text("utf-8"))["events"]

    def coverage_of(ign: str) -> str:
        wp = world.get(ign.lower())
        if not wp:
            return "not in world"
        evs = (recs_json.get(wp["id"]) or {}).get("ev") or []
        held = sum(1 for e in evs if e[0] in evc)
        vct_like = [e for e in evs if e[0] not in evc]
        return f"{held} placements inside the 2024-26 cache, {len(vct_like)} outside it (older or non-VCT)"

    ladders = []
    movers = sorted((r for r in final.values() if r.ign.lower() in world and r.n_events >= 6),
                    key=lambda r: r.overall - world[r.ign.lower()]["overall"])
    names = NAMED + [r.ign for r in movers[-6:]][::-1] + [r.ign for r in movers[:6]]
    seen = set()
    for ign in names:
        if ign in seen:
            continue
        seen.add(ign)
        key = next((k for k, v in ign_of.items() if v == ign), None)
        if key is None:
            continue
        row = {"ign": ign, "world": world.get(ign.lower(), {}).get("overall"), "coverage": coverage_of(ign)}
        for name, _ in steps:
            r = today_rated[name].get(key)
            row[name] = r.overall if r else None
        r = final.get(key)
        if r:
            row.update({"role": r.role, "events": r.n_events, "regime_note": r.regime, "combat": round(r.combat), "igl_score": r.igl_score and round(r.igl_score),
                        "igl_weight": round(r.igl_weight, 2), "igl_note": r.igl_note, "honours": r.honours, "honours_note": r.honours_note,
                        "form_z": r.form_z and round(r.form_z, 2), "recent_share": round(r.recent_share, 2),
                        **{f"conf_{a}": round(r.confidence.get(a, 0), 2) for a in STAT_ABILITIES}})
        ladders.append(row)

    # ---- trajectories: one cutoff per stage, three schemes, named + auto-picked cases
    stage_cuts = []
    seen_stage = set()
    for cut, eid, slug in cuts:
        tag = f"{cut.year}-" + ("kickoff" if "kickoff" in slug else "stage-1" if "stage-1" in slug else "stage-2" if "stage-2" in slug else slug)
        if tag not in seen_stage and ("kickoff" in slug or "stage" in slug):
            seen_stage.add(tag)
            stage_cuts.append((tag, cut))
    stage_cuts.append(("today", today))
    cases = list(NAMED)
    for kind in ("growth", "decline"):
        cases += [r.ign for r in final.values() if r.regime.startswith(kind) and r.n_events >= 8][:2]
    traj = []
    traj_rated = {(sch, tag): rate2(records, cut, P2(time_scheme=sch), maps[sch], ledger, ids, callers_by_cut.get(cut) or callers_today)
                  for sch in ("decay", "stage", "regime") for tag, cut in stage_cuts}
    for ign in dict.fromkeys(cases):
        key = next((k for k, v in ign_of.items() if v == ign), None)
        if not key:
            continue
        for sch in ("decay", "stage", "regime"):
            row = {"ign": ign, "scheme": sch}
            for tag, _ in stage_cuts:
                r = traj_rated[(sch, tag)].get(key)
                row[tag] = r.overall if r else None
            traj.append(row)

    # ---- write
    def dump(name, rows):
        if not rows:
            return
        keys = []
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        with open(OUT / name, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            for r in rows:
                w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
    dump("backtest2_grid.csv", grid)
    dump("backtest2_cutoffs.csv", per_cut)
    dump("ladders.csv", ladders)
    dump("trajectories.csv", traj)
    write_report(cov, cuts, grid, ladders, traj, stage_cuts, recent_share, regime_counts, unknown, ids, maps)


def write_report(cov, cuts, grid, ladders, traj, stage_cuts, recent_share, regime_counts, unknown, ids, maps):
    L = []
    L.append("# 选手评分离线回测（第二轮）\n")
    L.append(f"生成于 {date.today().isoformat()}。只读离线缓存，不改任何线上数据。承接 report.md：这一轮比较稳定能力基线（decay / stage / regime）、早期数据退出、荣誉（上限 0 / 3 / 6）和主指挥权重（0 / .25 / .35 / .45），三者组合共 36 个候选，与现方案重建、Rating 基线放在**同一目标样本**上比较。\n")
    L.append("## 数据与规则\n")
    L.append(f"- 记录 {cov['records']} 条，选手 {cov['players']}，赛事 {cov['events']}；回测截止点 {len(cuts)} 个（同第一轮）。每个模型都算完整覆盖后，再取所有模型都覆盖的交集作目标样本，样本数在表里。")
    L.append("- 三种基线：decay = 第一轮的合并计数按时间衰减；stage = 每场赛事先各自评 z（在它所属层级里），再按「时间衰减 × 可靠度」融合，可靠度 = min(1, 回合/250)，赛事多不等于声音大；regime = stage 之上加阶段变化：最近 ≥3 场且 ≥600 回合的一段，与之前 ≥3 场 ≥600 回合的一段按可靠度比较，差 ≥0.35 z、后段至少八成同向、且最后三场也同向时判为变化，之前的赛事权重降到 0.15。成长和衰退同一条规则，只看截止日以前。")
    L.append("- 状态：截止日前 30 天的赛事相对基线的偏离，单独给出，不回灌基线。基线里这 30 天占的权重份额也印出来（见下），这就是重复加权的大小。")
    L.append("- 荣誉：vlr 名次记录 + Liquipedia 冠军表建账，只算第一名，去重到赛事；冠军赛 3、Masters 2、赛区赛段/Kickoff 1、Ascension 0.5，两个赛季内全额、第三年三分之二、第四年三分之一；只计截止日以前已获得且本人在赛事统计里出过场的；封顶后直接加在总评上，不进任何属性。没有名次记录的选手标为 unknown。")
    L.append(f"- 主指挥：身份取世界的 isIgl（verified {sum(1 for i in ids.values() if i.source == 'verified')} / inferred {sum(1 for i in ids.values() if i.source != 'verified')}），没有任何站点记录他从何时开始指挥，所以只在他现役俱乐部的效力窗口内外推，之前算 unknown。指挥能力 = 三分之一的「带队名次相对阵容个人 Rating 的残差」（按赛事数收缩，κ=6）+ 每年指挥资历 0.15 z（封顶 3 年），映射到 44～98 的指挥分；不用 APR/KAST，不用队友均分。总评 = (1−w·可靠度)×作战 + w·可靠度×指挥分 + 荣誉。")
    L.append("- 分数映射在 2024 参考窗按未收缩值拟合一次后冻结（作战、各属性、指挥分各一条）；本报告里的候选分**没有**做任何整体平移。\n")
    L.append("## 预测力（同一目标样本；下一赛事 Rating 与之后 180 天 Rating）\n")
    L.append("| 模型 | ρ(下一赛事) | ρ(180 天) | MAE | 突破手残差 | 指挥ρ(下一赛事) | 指挥ρ(180 天) | 指挥残差 | 其他残差 | n | n(180 天) | n(指挥) |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in grid:
        L.append(f"| {r['model']} | {fmt(r['rho_next'])} | {fmt(r['rho_180d'])} | {fmt(r['mae'])} | {fmt(r['entry_resid'])} | {fmt(r['rho_callers'])} | {fmt(r['rho_180d_callers'])} | {fmt(r['resid_callers'])} | {fmt(r['resid_others'])} | {r['n']} | {r['n_180d']} | {r['n_callers']} |")
    L.append("\n残差 = 标准化实际 − 标准化预测，正值为低估。指挥ρ 只在被判定为主指挥的人里算，样本小，读作方向。\n")
    L.append("## 基线三方案的性质\n")
    L.append("| 方案 | 30 天在基线里的权重份额（中位数 / 90 分位） | 阶段判定 none / growth / decline |")
    L.append("|---|---|---|")
    for sch in ("decay", "stage", "regime"):
        rs = sorted(recent_share.get(sch, []))
        med = rs[len(rs) // 2] if rs else 0
        p90 = rs[int(len(rs) * .9)] if rs else 0
        rc = regime_counts.get(sch, {})
        L.append(f"| {sch} | {med:.2f} / {p90:.2f} | {rc.get('none', 0)} / {rc.get('growth', 0)} / {rc.get('decline', 0)} |")
    L.append("\ndecay 的份额在 Line 层不可分，记 0；stage/regime 的份额就是同一段数据既进基线又进状态的比例，状态若再全额叠加，这一份就是重复。\n")
    L.append("## 关键选手逐项拆解（今天的截止日；各列是固定条件下的候选分，不平移）\n")
    L.append("| 选手 | 世界 | 现方案重建 | decay | stage | regime | +指挥.35 | +荣誉6 | 位置 | 场次 | 阶段 | 作战 | 指挥分×权重 | 荣誉 | 状态z | 30天份额 | 覆盖 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in ladders:
        L.append(f"| {r['ign']} | {r.get('world')} | {r.get('current(rebuilt)')} | {r.get('decay(round one)')} | {r.get('stage')} | {r.get('regime')} | {r.get('regime + igl .35')} | {r.get('regime + igl .35 + hon 6')} | {r.get('role')} | {r.get('events')} | {r.get('regime_note')} | {r.get('combat')} | {r.get('igl_score')}×{r.get('igl_weight')} | {r.get('honours')} ({r.get('honours_note')}) | {r.get('form_z')} | {r.get('recent_share')} | {r.get('coverage')} |")
    L.append("\n列与列之间是逐项切换，不是可加的分解：从「现方案重建」到「decay」换了属性算法、模板、收缩和映射四件事；decay→stage→regime 只换时间方案；后两列只加指挥、荣誉。世界分含大赛加成、冠军底蕴和生涯表，本研究只有 2024 年以来的 VCT 赛事，「覆盖」一列说明每人有多少名次记录落在缓存之外。\n")
    L.append("## 轨迹（每个赛段开始时的候选分，三种基线）\n")
    tags = [t for t, _ in stage_cuts]
    L.append("| 选手 | 方案 | " + " | ".join(tags) + " |")
    L.append("|---|---|" + "---|" * len(tags))
    for r in traj:
        L.append(f"| {r['ign']} | {r['scheme']} | " + " | ".join(fmt(r.get(t)) for t in tags) + " |")
    L.append("\n前七人是点名的；之后是今天被 regime 判为成长 / 衰退的例子各两人（≥8 场）。三类情形该看的：早弱后强的人 regime 是否比 stage 更早抬起来；长期强、近两场低迷的人三条线是否都稳；连续下滑的人 regime 是否逐步回落而不是靠旧峰托底。\n")
    L.append("## 引擎侧：主指挥的贡献现在怎么算，拆分方案\n")
    L.append("- 现状（match.ts）：队伍强度 = 五人 overall 的加权均值 + 主指挥加成 (指挥−60)×0.09（中局再 ×0.06）+ 默契 + 教练 + 阵容 + …；一队只有一个人喊指挥（俱乐部指定的主指挥，否则指挥最高的 isIgl），其余人的指挥属性不计。")
    L.append("- 实测（scripts/rating/sim_igl.ts，LEV 对 NRG，300 场 bo3）：主指挥指挥 +15 → 胜率 +6.3 个百分点；主指挥总评 +5 → +5.7；两者同时 → +8.7；非指挥队员指挥 +15 → 0；五人全标指挥、指挥 90 → −2.0（噪声内），不叠加。")
    L.append("- 拆分方案：卡面总评含指挥权重后，引擎的「五人加权均值」应读**作战分**（combat），不读卡面总评；指挥贡献只由实际喊指挥的那个人按其**指挥分**提供，系数按上面的实测重标，使「作战 +5」和「指挥 +15」对胜率的价值与卡面上的权重一致（w=.35 时指挥分 15 分 ≈ 总评 5 分，与实测 6.3 vs 5.7 已接近）；默契、阵容、教练维持现状。这样一张指挥卡的总评高，进比赛不会先当成枪强再拿指挥加成。荣誉不进引擎。以上为方案，未改引擎。\n")
    L.append("## 结论（第二轮）\n")
    L.append("1. **稳定基线**：同一目标样本上，180 天窗口的预测力 Rating 基线 0.56 > 现方案重建 0.53 > decay 0.43 > stage 0.42 > regime 0.38；下一赛事也是同样的次序。stage 没有比 decay 更好，regime 更差——阶段判定在今天的样本上把 8% 的人判成变化（其中衰退是成长的三倍），而轨迹表显示它对一两个赛段的低迷反应过大（CHICHOO 2026 Stage 1 从 76 掉到 69 再回到 79，keznit 今天 68 对 stage 的 73）。它做到了「不永久靠旧峰托底」，但代价是把短期低迷当成了阶段变化；成长一侧（trent、BuZz）三条线差别不大，因为可靠度上限已经让新赛段不会被旧数据淹没。")
    L.append("2. **早期数据退出**：stage 的可靠度封顶（250 回合）已经使赛事多的赛段不再压过之前的稳定水平；要不要再加阶段变化，取决于接受多少误判。建议下一轮把 regime 的门槛改成需要连续两个赛段（而不是最近三场）同向，并且只在成长方向重置基线、衰退方向按 stage 缓慢回落，然后重跑同一张表。这不是现在能下的结论。")
    L.append("3. **状态与基线的重复**：截止日前 30 天在 stage/regime 基线里的权重份额中位数为 0（多数截止点前 30 天没有比赛），90 分位 0.25～0.28；也就是说赛段刚结束时，状态若再全额叠加，最多有四分之一的近期表现被数了两次。落地时状态应只叠加「超出基线已吸收部分」的偏离，或者基线在赛段结束统一更新、状态在赛段内使用。")
    L.append("4. **荣誉**：上限 3 与 6 对预测力的影响都在 +0.005 以内，对个人来说是 1～5 分（CHICHOO +4.7、Ethan +5、nobody +4.7）。它不改变谁比谁强的排序，只在同档之间拉开有冠军的人——这正是它该做的事，预测力表既不支持也不反对它。2024 年以前的冠军因四年衰减已归零，所以 Liquipedia 冠军表目前只影响 2023 年的 Ethan。")
    L.append("5. **主指挥**：指挥分来自带队残差和资历，Boaster 94、Boo 93、nobody 92、Ethan 83；w=.35 时 Boaster 的总评从 59（作战）到 69，nobody 从 64 到 72。加指挥权重后，指挥组的下一赛事 ρ 略降（0.27→0.22，样本 236），指挥组残差变化不到 0.01——指挥分不是从个人数据推的，本来就不该提高对个人 Rating 的预测。它是否合理只能从游戏效果看：引擎实测一个主指挥指挥 +15 值胜率 +6.3 个百分点，总评 +5 值 +5.7，w=.35 下指挥分 15 分折成总评 5 分，与实测的价值比接近；但引擎必须改为读作战分而不是卡面总评，否则同一份价值付两次（实测同时给两者只多 +8.7，不是 +12）。")
    L.append("6. **点名选手**：Chronicle（92→74～77）和 Less（89→69～71）的落差主要来自三处：世界分里有本研究没有的 2021～2023 生涯表和大赛加成（他们各有 36 / 17 条名次记录在缓存之外）；控场的 APR 在模板里权重大而两人 APR 低于同位置均值（第一轮已指出，同英雄校正未做）；Chronicle 被 regime 判为 2024-08 后衰退，是他 2024 年 +0.8 z 的高峰对比 2025～26 的 0 附近。CHICHOO（94→79～83）同理，荣誉补回 4.7。Boaster 世界 65、本研究作战 59，指挥权重把他抬到 69～70；nobody 77 → 作战 64、含指挥 72、含荣誉 76。大幅上涨的 Jieni7、Lakia、NaturE 是先锋（APR 高），marteen、kamo 是 regime 判成长的决斗者；下跌的 SUYGETSU、Spring、Rossy、kaajak、heat 多数只有 7～10 场且缓存外名次记录 20～37 条，是覆盖差异先于算法差异。")
    L.append("\n**建议的下一步**：(a) 先补 2022～2023 的赛事页（vlr 有），让覆盖差异从拆解里消失，再谈算法差异；(b) 同英雄 APR/KAST 校正仍是控场/先锋对调的根因，优先于调模板；(c) regime 改成按赛段判定并区分成长/衰退的处理；(d) 状态只叠加基线未吸收的偏离；(e) 引擎按「作战分进均值、指挥分进指挥加成」拆分后，用 sim_igl 的方法重标系数。荣誉与指挥权重的取值等 (a)(b) 之后再定。")
    L.append("\n## 读法与限制\n")
    L.append(f"- 荣誉账本 unknown（无名次记录）的选手 {len(unknown)} 人；2024 年以前的冠军只有 Liquipedia 冠军表的 21 条，按第四年及以前已经衰减为零，所以今天的荣誉分几乎全部来自 2024～2026。")
    L.append("- 指挥身份的起始时间是按现役俱乐部效力窗口外推的，换过俱乐部的指挥在旧俱乐部期间被当成 unknown，不计指挥分也不计带队残差。")
    L.append("- 带队残差把整个五人、教练和换人都算在指挥头上，所以只记三分之一并按赛事数收缩；它仍然是「相关」不是「归因」。")
    L.append("- 阶段判定要 ≥3+3 场、≥600+600 回合，新人和只有一年数据的人不会被判阶段变化，按现有证据和先验（收缩到均值）处理。")
    L.append("- 下一赛事 ρ 不能单独评判含荣誉和指挥的总评是否合理；反过来，作战分的预测力若明显变差，也不能用「综合价值不同」回避。两类结果都在上表里分开给。")
    (OUT / "report2.md").write_text("\n".join(L) + "\n", "utf-8")
    print(f"report -> {OUT / 'report2.md'}")


if __name__ == "__main__":
    main()
