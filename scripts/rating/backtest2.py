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

    # A. the time fusion, isolated: same attributes, shrinkage and mapping, only the weights differ
    configs = [(f"{f} regime={r}", P2(fusion=f, regime=r)) for f in ("decay", "stage", "split") for r in ("off", "soft-sym", "soft-asym")]
    # B. the caller weight, fixed for a confirmed identity: strict = grade A only, sensitivity = A+B+C
    configs += [(f"stage igl={w} grades={g}", P2(fusion="stage", igl_weight=w, igl_grades=g))
                for w in (0.25, 0.35, 0.45) for g in ("A", "ABC")]
    # C. honours, strict ledger (dated and seen playing)
    configs += [(f"stage hon={c}", P2(fusion="stage", honour_cap=c)) for c in (3.0, 6.0)]
    maps = {"all": reference2(records, REF, P2(), callers_ref)}
    per_cut: list[dict] = []
    recent_share = defaultdict(list)
    regime_counts = defaultdict(lambda: defaultdict(int))
    for cut, eid, slug in cuts:
        preds: dict[str, dict[str, float]] = {}
        preds["current(rebuilt)"] = {k: r.overall_z for k, r in current_scheme(records, cut).items()}
        preds["baseline-R2 hl=270"] = {k: r.overall_z for k, r in simple_baseline(records, cut, 270).items()}
        for name, P in configs:
            rated = rate2(records, cut, P, maps["all"], ledger, ids, callers_by_cut[cut])
            preds[name] = {k: r.overall for k, r in rated.items()}
            if P.igl_weight == 0 and P.honour_cap == 0:
                recent_share[name].extend(r.recent_share for r in rated.values() if r.n_events >= 3)
                for r in rated.values():
                    regime_counts[name][r.regime.split("@")[0].replace("(not applied)", "")] += 1
        callers_now = {n for n, idn in ids.items() if idn.grade(cut) == "A"}
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
        ("decay", P2(fusion="decay")),
        ("stage", P2(fusion="stage")),
        ("split", P2(fusion="split")),
        ("stage + igl A .35", P2(fusion="stage", igl_weight=0.35, igl_grades="A")),
        ("stage + igl A .35 + hon 6", P2(fusion="stage", igl_weight=0.35, igl_grades="A", honour_cap=6.0)),
    ]
    today_rated = {}
    cur_today = current_scheme(records, today)
    for name, P in steps:
        today_rated[name] = cur_today if P is None else rate2(records, today, P, maps["all"], ledger, ids, callers_today)
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
                        "igl_weight": round(r.igl_weight, 2), "igl_grade": r.igl_grade, "igl_note": r.igl_note, "honours": r.honours, "honours_note": r.honours_note,
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
    soft_today = rate2(records, today, P2(fusion="stage", regime="soft-sym"), maps["all"], ledger, ids, callers_today)
    cases = list(NAMED)
    for kind in ("growth", "decline"):
        cases += [r.ign for r in soft_today.values() if r.regime.startswith(kind) and r.n_events >= 8][:2]
    variants = [("decay", P2(fusion="decay")), ("stage", P2(fusion="stage")), ("split", P2(fusion="split")),
                ("stage soft-sym", P2(fusion="stage", regime="soft-sym"))]
    traj = []
    traj_rated = {(name, tag): rate2(records, cut, P, maps["all"], ledger, ids, callers_by_cut.get(cut) or callers_today)
                  for name, P in variants for tag, cut in stage_cuts}
    for ign in dict.fromkeys(cases):
        key = next((k for k, v in ign_of.items() if v == ign), None)
        if not key:
            continue
        for name, _ in variants:
            row = {"ign": ign, "scheme": name}
            for tag, _ in stage_cuts:
                r = traj_rated[(name, tag)].get(key)
                row[tag] = r.overall if r else None
            traj.append(row)
    # the callers' evidence, per man
    caller_rows = []
    for ign in ("Boaster", "Boo", "Ethan", "nobody", "johnqt", "valyn", "saadhak", "Rossy"):
        idn = ids.get(ign.lower())
        L = callers_today.get(ign.lower())
        if idn:
            caller_rows.append({"ign": ign, "club": idn.club, "source": idn.source, "since": idn.since and idn.since.isoformat(),
                                "grade_today": idn.grade(today), "events_as_caller": L.events if L else 0,
                                "tenure_years": L.tenure_years if L else None,
                                "placement_residual": None if not L or L.over_perf is None else round(L.over_perf, 2),
                                "level_z": L and round(L.z, 2), "score": L and round(maps["all"]["igl"][0] + maps["all"]["igl"][1] * L.z)})

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
    dump("callers.csv", caller_rows)
    ledger_stats = {"unknown_tier": sum(1 for hs in ledger.values() for h in hs if h.tier == "unknown"),
                    "undated": sum(1 for hs in ledger.values() for h in hs if h.when is None and h.tier != "unknown"),
                    "dated_played": sum(1 for hs in ledger.values() for h in hs if h.when is not None and h.played is True),
                    "dated_unseen": sum(1 for hs in ledger.values() for h in hs if h.when is not None and h.played is not True)}
    write_report(cov, cuts, grid, ladders, traj, stage_cuts, recent_share, regime_counts, unknown, ids, maps, caller_rows, ledger_stats)


def write_report(cov, cuts, grid, ladders, traj, stage_cuts, recent_share, regime_counts, unknown, ids, maps, caller_rows, ledger_stats):
    L = []
    L.append("# 选手评分离线回测（第二轮，修订版）\n")
    L.append(f"生成于 {date.today().isoformat()}。只读离线缓存，不改任何线上数据。这一版按核对意见修正：荣誉分类改用缓存的赛事类型与赛事 ID、只算决赛阶段第一、严格口径只计有日期且本人出场的；指挥身份分级、权重固定、能力向先验收缩；三种时间融合共用同一套属性、各项收缩与映射；阶段硬重置停用。\n")
    L.append("## 数据与规则\n")
    L.append(f"- 记录 {cov['records']} 条，选手 {cov['players']}，赛事 {cov['events']}（2024～2026 VCT + 2026 Challengers）；回测截止点 {len(cuts)} 个。所有模型先各自算完整覆盖，再取交集作目标样本；样本数见表。")
    L.append("- 每场赛事先各自评级：指标在（位置 × 层级）里标准化，六项能力按模板合成一个作战值。三种融合只换权重：decay = 衰减 × 回合；stage = 衰减 × min(回合, 250)；split = stage 再在赛段内归一，使一个赛段的总权重 = 衰减 × min(1, 赛段回合/500)。各项收缩用各自的证据（回合、首次交战次数、残局次数，按时间衰减、不封顶），映射在 2024 参考窗按未收缩值拟合一次后冻结，三种融合共用。")
    L.append("- 阶段变化默认关闭。两个软变体按赛段确认：最近两个赛段（各 ≥300 回合）都比之前赛段（≥2 个、≥600 回合）的均值高或低 ≥0.35 z，soft-sym 把更早赛段权重减半，soft-asym 只在成长时减半、衰退交给平滑基线。")
    L.append("- 状态 = 截止日前 30 天赛事相对基线的偏离，单独给出；基线里这 30 天占的权重份额印在下表（中位数与 90 分位，不是最大值，也不等于状态的重复加成量——那要等状态公式定了才能算）。")
    L.append(f"- 荣誉账本：vlr 名次记录只取决赛阶段的第一名，类型取缓存的赛事 tier，日期取赛事结束日，出场以本人在该赛事统计行里有回合为准；Liquipedia 冠军表按赛事名称去重补入、无日期。本次账本：有日期且见出场 {ledger_stats['dated_played']} 条，有日期但未见出场 {ledger_stats['dated_unseen']} 条，无日期（Liquipedia）{ledger_stats['undated']} 条，缓存外（无类型无日期，2024 年前或非 VCT）{ledger_stats['unknown_tier']} 条，无名次记录的选手 {len(unknown)} 人。严格口径只计第一类；其余在拆解表里以「set aside」计数。")
    L.append(f"- 主指挥：身份 A = 有来源（俱乐部页或人工）且截止日时已在该俱乐部满一年；B = 有来源、不满一年；C = 系统推测；none = 效力开始晚于截止日或未知。今天：A {sum(1 for i in ids.values() if i.grade(date.today()) == 'A')} / B {sum(1 for i in ids.values() if i.grade(date.today()) == 'B')} / C {sum(1 for i in ids.values() if i.grade(date.today()) == 'C')}。**没有任何站点记录指挥从何时开始**，A 级仍是按效力窗口外推的，所以指挥结果全部属于敏感性分析，不是严格历史回测；表里分 A 与 A+B+C 两档给出。指挥能力 = 带队名次相对阵容个人 Rating 残差的三分之一（按赛事数收缩到先验 0）+ 资历（每年 0.15 z，封顶三年），是模型估计；逐人依据见下表。权重 w 对确认身份固定，不乘可靠度。\n")
    L.append("## A. 时间融合（其余全部固定；同一目标样本）\n")
    L.append("| 模型 | ρ(下一赛事) | ρ(180 天) | MAE | 突破手残差 | 决斗 | 先锋 | 控场 | 哨卫 | n | n(180 天) |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in grid:
        if r["model"].startswith(("current", "baseline")) or "regime=" in r["model"]:
            L.append(f"| {r['model']} | {fmt(r['rho_next'])} | {fmt(r['rho_180d'])} | {fmt(r['mae'])} | {fmt(r['entry_resid'])} | " + " | ".join(fmt(r[f'rho_{x}']) for x in ROLES) + f" | {r['n']} | {r['n_180d']} |")
    L.append("\n| 融合 / 阶段 | 30 天权重份额 中位数 / 90 分位（≥3 场） | 阶段判定 none / growth / decline（人×截止点） |")
    L.append("|---|---|---|")
    for name in [n for n in recent_share if "regime=" in n]:
        rs = sorted(recent_share[name])
        med = rs[len(rs) // 2] if rs else 0
        p90 = rs[int(len(rs) * .9)] if rs else 0
        rc = regime_counts.get(name, {})
        L.append(f"| {name} | {med:.2f} / {p90:.2f} | {rc.get('none', 0)} / {rc.get('growth', 0)} / {rc.get('decline', 0)} |")
    L.append("\n## B. 主指挥权重（stage 融合；指挥列只在该档身份的人里算）\n")
    L.append("| 模型 | ρ(下一赛事) | ρ(180 天) | 指挥ρ(下一赛事) | 指挥ρ(180 天) | 指挥残差 | 其他残差 | n | n(指挥, A 级) |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for r in grid:
        if r["model"] in ("current(rebuilt)", "baseline-R2 hl=270", "stage regime=off") or "igl=" in r["model"]:
            L.append(f"| {r['model']} | {fmt(r['rho_next'])} | {fmt(r['rho_180d'])} | {fmt(r['rho_callers'])} | {fmt(r['rho_180d_callers'])} | {fmt(r['resid_callers'])} | {fmt(r['resid_others'])} | {r['n']} | {r['n_callers']} |")
    L.append("\n指挥列的分组是截止日时 A 级身份的人；grades=ABC 的模型把权重也给了 B、C 级，但分组不变，所以两档可比。")
    L.append("\n## C. 荣誉（stage 融合，严格账本）\n")
    L.append("| 模型 | ρ(下一赛事) | ρ(180 天) | MAE | n |")
    L.append("|---|---|---|---|---|")
    for r in grid:
        if r["model"] in ("stage regime=off",) or "hon=" in r["model"]:
            L.append(f"| {r['model']} | {fmt(r['rho_next'])} | {fmt(r['rho_180d'])} | {fmt(r['mae'])} | {r['n']} |")
    L.append("\n## 指挥逐人依据（今天）\n")
    L.append("| 选手 | 俱乐部 | 身份来源 | 效力起 | 今日等级 | 任内赛事 | 资历(年) | 名次残差 | 能力z | 指挥分 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in caller_rows:
        L.append(f"| {r['ign']} | {r['club']} | {r['source']} | {r['since']} | {r['grade_today']} | {r['events_as_caller']} | {r['tenure_years']} | {r['placement_residual']} | {r['level_z']} | {r['score']} |")
    L.append("\n名次残差 = 该赛事俱乐部名次（换算 ±2）− 阵容个人 Rating 的均值 z，任内赛事平均；它含教练、赛程、对手与运气，只记三分之一并收缩。")
    L.append("\n## 关键选手逐项拆解（今天；固定条件的候选分，不平移）\n")
    L.append("| 选手 | 世界 | 现方案重建 | decay | stage | split | +指挥A .35 | +荣誉6 | 位置 | 场次 | 作战 | 指挥分×权重(等级) | 荣誉 | 状态z | 30天份额 | 覆盖 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in ladders:
        L.append(f"| {r['ign']} | {r.get('world')} | {r.get('current(rebuilt)')} | {r.get('decay')} | {r.get('stage')} | {r.get('split')} | {r.get('stage + igl A .35')} | {r.get('stage + igl A .35 + hon 6')} | {r.get('role')} | {r.get('events')} | {r.get('combat')} | {r.get('igl_score')}×{r.get('igl_weight')}({r.get('igl_grade')}) | {r.get('honours')} ({r.get('honours_note')}) | {r.get('form_z')} | {r.get('recent_share')} | {r.get('coverage')} |")
    L.append("\n列间是逐项切换，不是可加分解。「现方案重建」到「decay」换了属性算法、模板、收缩与映射；decay/stage/split 只换融合权重；后两列只加指挥、荣誉。「覆盖」说明每人有多少名次记录落在 2024～26 缓存之外——那是「更早或非 VCT」，不等于更早的高水平表现；2022～2023 赛事页正在补抓，补齐后再判断覆盖对降分的贡献。")
    L.append("\n## 轨迹（每个赛段开始时的候选分）\n")
    tags = [t for t, _ in stage_cuts]
    L.append("| 选手 | 方案 | " + " | ".join(tags) + " |")
    L.append("|---|---|" + "---|" * len(tags))
    for r in traj:
        L.append(f"| {r['ign']} | {r['scheme']} | " + " | ".join(fmt(r.get(t)) for t in tags) + " |")
    L.append("\n前七人是点名的；之后是 stage soft-sym 在今天判为成长 / 衰退的例子（≥8 场），若无则说明该规则今天没有触发。")
    L.append("\n## 引擎侧\n")
    L.append("- 现状（match.ts）：队伍强度 = 五人 overall 加权均值 + 主指挥加成 (指挥−60)×0.09（中局另 ×0.06）+ 默契 + 教练 + 阵容 + …；一队只有一人喊指挥。")
    L.append("- 已做的单点实测（scripts/rating/sim_igl.ts，经理模式，LEV 对 NRG，300 场 bo3）：主指挥指挥 +15 → +6.3 个百分点，总评 +5 → +5.7，两者同时 +8.7，非指挥队员指挥 +15 → 0，五人全标指挥不叠加。它只说明现引擎里指挥属性单独计价且不叠加；两项合计不等于相加是 logistic 的非线性，不能作为重复计算的证据——重复与否要看代码路径：卡面总评若含指挥权重，而引擎又把 overall 读进五人均值、再按指挥属性加成，那就是同一价值走了两条路。")
    L.append("- 待做（第 5 步）：分别在经理模式与开瓦包 arena 路径上，多组对阵、不同强弱差、不同等级，测「作战分进均值、指挥分进指挥加成」的拆分；系数由那组实验定，不由本单点定。荣誉是否进引擎未定，不在此定稿。")
    L.append("\n## 结论（修订版，第 1～3 步）\n")
    L.append("1. **荣誉账本修正后**：2024 两站 Masters 不再算 Champions，八个赛段赛事归入 league，小组第一不再算冠军，只计有日期且本人出场的。CHICHOO、nobody 各 6.0（封顶，含 2024 冠军赛与四个赛区冠军），Chronicle、Boaster 2.34，Ethan 3.0（2023 冠军无日期、2026 美洲 Stage 2 只是小组第一，都不计）。荣誉对预测力 +0.007，对个人 1～6 分；「不改变排序」上一版说过头了，它在同档间会改。")
    L.append("2. **时间融合隔离后三者持平**：属性、各项收缩、映射固定，只换权重，decay / stage / split 的 ρ 在 0.364～0.370（下一赛事）、0.429～0.447（180 天），差在噪声内。上一版「stage 不如 decay」是收缩没统一造成的，撤回。split 的赛段内归一没有改变结果，说明当前数据里没有哪个赛段因为场次多而压过别的赛段。")
    L.append("3. **阶段变化**：按赛段确认的软规则在 15404 人次里触发 105 次（成长 26、衰退 79），对预测无影响；对称与非对称也无差别。它现在是保守的，没有一个点名选手被判定；轨迹表里 Chronicle 从 2025 Kickoff 的 87～89 平滑落到 2026 的 69～75，CHICHOO 从 85 到 75～80 再回 78～80，都是平滑基线自己完成的，不需要硬重置。")
    L.append("4. **指挥**：A 级 120 人次。新方案在不加权重时已把 A 级指挥高估 0.23 z（他们的作战画像高于其后 Rating），加权重后更高（w=.35 时 −0.36），因为指挥分与个人 Rating 无关且普遍高于作战分；这不是它错了的证据，也不是它对了的证据——指挥分是模型估计（逐人依据表：Boaster 15 场任内赛事、资历 5.6 年、名次残差 +0.64 → 95；valyn 96；saadhak、Rossy 资历不足一年、残差有但收缩后只有 57/51）。它是否合理只能在引擎里看（第 5 步）。")
    L.append("5. **点名选手**：荣誉修正后 Chronicle 92→75（+荣誉 78）、Less 89→67、CHICHOO 94→78～80（+荣誉 84）、nobody 77→60（+指挥 71、+荣誉 77）、Boaster 65→59（+指挥 72）。三种融合下作战分差不超过 2，说明这些落差不来自时间方案。来自哪里还不能定：世界分含 2021～2023 生涯表与大赛加成（缓存外名次记录 Chronicle 29、Boaster 24、Spring 31、Rossy 32 条，Less 只有 8 条），控场 APR 模板权重（第一轮已指出）。2022～2023 赛事页正在补抓，补齐后按「近两年」「近两年+弱历史」「同一数据开/关英雄校正」三组重跑，再谈原因。")
    L.append("\n**下一步（第 4～5 步）**：(4) 补齐 2022～2023 后重跑覆盖对照；同英雄校正需要「选手 × 英雄 × 赛事」交叉数据，现在只能开/关「按位置中心化」作为近似，会明确标注。(5) 引擎测试改为经理模式与开瓦包 arena 两条路径、多组对阵与强弱差，测「作战进均值、指挥分进指挥加成」的拆分；荣誉是否进引擎留待产品规则。")
    L.append("\n## 读法与限制\n")
    L.append("- 指挥身份没有历史证据，A 级也是外推，所有指挥结果是敏感性分析。")
    L.append("- 阶段软规则要两个完整赛段同向，2026 年内才开始的变化不会被判定；这是有意的保守。")
    L.append("- 缓存外的名次记录没有类型和日期，严格账本不计；补抓 2022～2023 后会进入缓存并得到类型与日期。")
    L.append("- 下一赛事/180 天 Rating 不能单独评判含荣誉和指挥的总评；作战分预测力若变差也不能用综合价值回避，两类结果分开列。")
    (OUT / "report2.md").write_text("\n".join(L) + "\n", "utf-8")
    print(f"report -> {OUT / 'report2.md'}")


if __name__ == "__main__":
    main()
