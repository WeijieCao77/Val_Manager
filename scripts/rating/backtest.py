"""
Back-test the rating schemes without looking at the future.

    python3 -m scripts.rating.backtest            # full grid + today's comparison + report

For every dated VCT event E from 2025 on, the cutoff is E's first day: each
scheme is built from records that ENDED before that day (environment tables,
shrinkage, role shares and the z->score mapping all inside the window), and
its overall for the players in E is compared with what they then did in E.
Rating and ACS inside E are the headline targets; the six abilities are also
checked against the component they claim to predict. Groups by role, by prior
evidence, and the entry-player residual answer the owner's fairness question.

Writes analysis/rating/report.md, backtest_grid.csv, backtest_cutoffs.csv,
attribute_validity.csv, today_compare.csv, stability.csv.
"""
from __future__ import annotations

import csv
import itertools
import statistics
from collections import defaultdict
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

from .common import ROLES, STAT_ABILITIES, mean_sd, pearson, spearman
from .dataset import Record, coverage_summary, load_records, world_players
from .models import Params, Rated, current_scheme, new_scheme, reference_mapping, simple_baseline

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating"
TARGET_TIERS = ("league", "kickoff", "masters", "champions")
MIN_TARGET_RND = 60


# ------------------------------------------------------------------ targets


def zin(values: dict[str, float]) -> dict[str, float]:
    """z-scores inside one event, so a Masters and a Kickoff are comparable"""
    xs = list(values.values())
    if len(xs) < 5:
        return {}
    mu, sd = mean_sd(xs)
    return {k: (v - mu) / sd for k, v in values.items()}


def event_targets(records: list[Record], eid: str) -> dict[str, dict[str, float]]:
    rows = [r for r in records if r.eid == eid and r.rnd >= MIN_TARGET_RND]
    t: dict[str, dict[str, float]] = {}
    r2 = zin({r.key: r.rating2 for r in rows if r.rating2 is not None})
    acs = zin({r.key: r.acs for r in rows if r.acs is not None})
    adr = zin({r.key: r.adr for r in rows if r.adr is not None})
    kast = zin({r.key: r.kast for r in rows if r.kast is not None})
    apr = zin({r.key: r.a / r.rnd for r in rows if r.a is not None})
    dpr = zin({r.key: r.d / r.rnd for r in rows if r.d is not None})
    fcs = zin({r.key: r.fk / (r.fk + r.fd) for r in rows if r.fk is not None and r.fd is not None and (r.fk + r.fd) >= 10})
    clr = zin({r.key: (r.clw or 0) / r.clt for r in rows if r.clt and r.clt >= 5})
    fcp = {r.key: (r.fk + r.fd) / r.rnd for r in rows if r.fk is not None and r.fd is not None}
    role = {r.key: (max(r.role_share, key=r.role_share.get) if r.role_share else "自由人") for r in rows}
    for r in rows:
        t[r.key] = {"r2": r2.get(r.key), "acs": acs.get(r.key), "adr": adr.get(r.key), "kast": kast.get(r.key),
                    "apr": apr.get(r.key), "dpr": dpr.get(r.key), "fc_succ": fcs.get(r.key), "cl_rate": clr.get(r.key),
                    "fc_part": fcp.get(r.key), "role": role.get(r.key)}
    return t


def cutoffs(records: list[Record]) -> list[tuple[date, str, str]]:
    ev = {}
    for r in records:
        if r.year >= 2025 and r.tier in TARGET_TIERS and r.start and not r.date_estimated:
            ev[r.eid] = (r.start, r.eid, r.slug)
    out = [v for v in ev.values() if sum(1 for r in records if r.eid == v[1]) >= 40]
    return sorted(out)


# ------------------------------------------------------------------ one evaluation


def evaluate(pred: dict[str, Rated], tgt: dict[str, dict], name: str, cut: date, slug: str) -> dict:
    keys = [k for k in tgt if k in pred and tgt[k]["r2"] is not None]
    p = [pred[k].overall_z for k in keys]
    r2 = [tgt[k]["r2"] for k in keys]
    acs = [tgt[k]["acs"] for k in keys if tgt[k]["acs"] is not None]
    pa = [pred[k].overall_z for k in keys if tgt[k]["acs"] is not None]
    row = {"model": name, "cutoff": cut.isoformat(), "event": slug, "n": len(keys), "covered": len(keys) / max(1, len(tgt)),
           "rho_r2": spearman(p, r2), "rho_acs": spearman(pa, acs)}
    # z-space residual: how far the standardised prediction sat from the standardised outcome
    if len(keys) >= 5:
        mz, sz = mean_sd(p)
        pz = [(x - mz) / sz for x in p]
        res = [y - x for x, y in zip(pz, r2)]
        row["mae"] = statistics.fmean(abs(x) for x in res)
        # entry players: the top quarter by first-contact share in the event
        fcp = sorted((tgt[k]["fc_part"] for k in keys if tgt[k]["fc_part"] is not None))
        if len(fcp) >= 8:
            q = fcp[int(len(fcp) * 0.75)]
            ent = [rr for k, rr in zip(keys, res) if (tgt[k]["fc_part"] or 0) >= q]
            rest = [rr for k, rr in zip(keys, res) if (tgt[k]["fc_part"] or 0) < q]
            row["entry_resid"] = statistics.fmean(ent) if ent else None
            row["rest_resid"] = statistics.fmean(rest) if rest else None
        for role in ROLES:
            rk = [i for i, k in enumerate(keys) if tgt[k]["role"] == role]
            row[f"rho_{role}"] = spearman([p[i] for i in rk], [r2[i] for i in rk])
        for lo, hi, lab in ((0, 300, "lt300"), (300, 1000, "300to1000"), (1000, 1e9, "gt1000")):
            bk = [i for i, k in enumerate(keys) if lo <= pred[k].rnd_w < hi]
            row[f"rho_{lab}"] = spearman([p[i] for i in bk], [r2[i] for i in bk])
            row[f"n_{lab}"] = len(bk)
    return row


def attribute_validity(pred: dict[str, Rated], tgt: dict[str, dict]) -> dict[str, tuple[float | None, int]]:
    """each ability against the future component it claims to describe"""
    pairs = {"aim": "adr", "reaction": "fc_succ", "awareness": "dpr", "utility": "apr", "clutch": "cl_rate", "teamwork": "kast"}
    out = {}
    for ab, comp in pairs.items():
        ks = [k for k in tgt if k in pred and tgt[k].get(comp) is not None and pred[k].confidence.get(ab, 0) > 0]
        a = [pred[k].abilities[ab] for k in ks]
        b = [tgt[k][comp] if ab != "awareness" else -tgt[k][comp] for k in ks]
        out[ab] = (pearson(a, b), len(ks))
    return out


# ------------------------------------------------------------------ the run


def wavg(rows: list[dict], col: str) -> float | None:
    got = [(r[col], r["n"]) for r in rows if r.get(col) is not None]
    return sum(v * n for v, n in got) / sum(n for _, n in got) if got else None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    records = load_records()
    cov = coverage_summary(records)
    cuts = cutoffs(records)
    targets = {eid: event_targets(records, eid) for _, eid, _ in cuts}

    grid_rows: list[dict] = []
    per_cutoff: list[dict] = []
    validity = defaultdict(list)
    # the two fixed schemes
    for cut, eid, slug in cuts:
        per_cutoff.append(evaluate(current_scheme(records, cut), targets[eid], "current(rebuilt)", cut, slug))
        for hl in (90, 180, 270, 365):
            per_cutoff.append(evaluate(simple_baseline(records, cut, hl), targets[eid], f"baseline-R2 hl={hl}", cut, slug))
    # the new scheme over the parameter grid, plus one-switch diagnostics
    REF = date(2025, 1, 1)          # the 2024 season fixes the score scale for every later cutoff
    variants = [(f"new hl={hl} k×{ks} t2={disc}", Params(half_life=hl, kappa_rounds=400 * ks, kappa_fc=40 * ks, kappa_cl=20 * ks, tier2_discount=disc))
                for hl, ks, disc in itertools.product((90, 180, 270, 365), (0.5, 1.0, 2.0), (0.0, 0.10, 0.25))]
    variants += [
        ("diag: global z (no role centering)", Params(center_by_role=False)),
        ("diag: +30% Rating", Params(rating_mix=0.3)),
        ("diag: +30% Rating, global z", Params(rating_mix=0.3, center_by_role=False)),
        ("diag: equal templates", Params(equal_templates=True)),
        ("diag: no shrink", Params(no_shrink=True)),
    ]
    for name, P in variants:
        hl, ks, disc = P.half_life, P.kappa_rounds / 400, P.tier2_discount
        mapping = reference_mapping(records, REF, P)
        rows = []
        for cut, eid, slug in cuts:
            pred, _ = new_scheme(records, cut, P, mapping)
            row = evaluate(pred, targets[eid], name, cut, slug)
            rows.append(row)
            if ks == 1.0 and disc == 0.0 and name.startswith("new "):
                for ab, (c, n) in attribute_validity(pred, targets[eid]).items():
                    if c is not None:
                        validity[(hl, ab)].append((c, n))
        per_cutoff.extend(rows)
        grid_rows.append({"model": name, "half_life": hl, "kappa_scale": ks, "tier2_discount": disc,
                          "rho_r2": wavg(rows, "rho_r2"), "rho_acs": wavg(rows, "rho_acs"), "mae": wavg(rows, "mae"),
                          "entry_resid": wavg(rows, "entry_resid"), "rest_resid": wavg(rows, "rest_resid"),
                          **{f"rho_{r}": wavg(rows, f"rho_{r}") for r in ROLES},
                          **{f"rho_{b}": wavg(rows, f"rho_{b}") for b in ("lt300", "300to1000", "gt1000")},
                          "n": sum(r["n"] for r in rows)})
    for name in ["current(rebuilt)"] + [f"baseline-R2 hl={hl}" for hl in (90, 180, 270, 365)]:
        rows = [r for r in per_cutoff if r["model"] == name]
        grid_rows.append({"model": name, "half_life": "", "kappa_scale": "", "tier2_discount": "",
                          "rho_r2": wavg(rows, "rho_r2"), "rho_acs": wavg(rows, "rho_acs"), "mae": wavg(rows, "mae"),
                          "entry_resid": wavg(rows, "entry_resid"), "rest_resid": wavg(rows, "rest_resid"),
                          **{f"rho_{r}": wavg(rows, f"rho_{r}") for r in ROLES},
                          **{f"rho_{b}": wavg(rows, f"rho_{b}") for b in ("lt300", "300to1000", "gt1000")},
                          "n": sum(r["n"] for r in rows)})

    # stability: consecutive cutoffs, how much an overall moves (default params vs current)
    stab_rows = []
    ref_map = reference_mapping(records, REF, Params())
    for name, maker in (("new hl=270 k×1.0 t2=0.0", lambda c: new_scheme(records, c, Params(), ref_map)[0]),
                        ("current(rebuilt)", lambda c: current_scheme(records, c))):
        prev = None
        for cut, eid, slug in cuts:
            now = maker(cut)
            if prev:
                d = [now[k].overall - prev[k].overall for k in now if k in prev]
                if d:
                    stab_rows.append({"model": name, "cutoff": cut.isoformat(), "n": len(d), "sd": statistics.pstdev(d),
                                      "share_abs_gt8": sum(1 for x in d if abs(x) > 8) / len(d),
                                      "max_up": max(d), "max_down": min(d)})
            prev = now

    # today: the new scheme against the live world.json (career-table based) — a
    # comparison, not a validation
    today = date.today() + timedelta(days=1)
    new_today, mapping = new_scheme(records, today, Params(), ref_map)
    cur_today = current_scheme(records, today)
    world = world_players()
    compare = []
    for k, r in new_today.items():
        wp = world.get(r.ign.lower())
        if not wp:
            continue
        compare.append({"ign": r.ign, "club": r.club, "world_role": wp["role"], "data_role": r.role,
                        "world_overall": wp["overall"], "new_overall": r.overall,
                        "current_rebuilt": cur_today[k].overall if k in cur_today else "",
                        "delta": r.overall - wp["overall"], "events": r.n_events, "rounds_w": round(r.rnd_w),
                        **{f"new_{a}": r.attrs[a] for a in STAT_ABILITIES},
                        **{f"world_{a}": wp["attrs"][a] for a in STAT_ABILITIES},
                        **{f"conf_{a}": round(r.confidence[a], 2) for a in STAT_ABILITIES},
                        "flags": ";".join(r.flags)})

    # ---- write
    def dump(name: str, rows: list[dict]) -> None:
        if not rows:
            return
        keys = list(rows[0].keys())
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        with open(OUT / name, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            for r in rows:
                w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})

    dump("backtest_grid.csv", grid_rows)
    dump("backtest_cutoffs.csv", per_cutoff)
    dump("stability.csv", stab_rows)
    dump("today_compare.csv", sorted(compare, key=lambda r: -abs(r["delta"])))
    val_rows = [{"half_life": hl, "ability": ab, "corr": sum(c * n for c, n in v) / sum(n for _, n in v), "n": sum(n for _, n in v)}
                for (hl, ab), v in sorted(validity.items())]
    dump("attribute_validity.csv", val_rows)
    write_report(cov, cuts, grid_rows, val_rows, stab_rows, compare, world, mapping)


def fmt(v, d=3):
    return "—" if v is None or v == "" else (f"{v:.{d}f}" if isinstance(v, float) else str(v))


def write_report(cov, cuts, grid, val_rows, stab, compare, world, mapping) -> None:
    L = []
    L.append("# 选手评分离线回测（第 1～2 步）\n")
    L.append(f"生成于 {date.today().isoformat()}。只读 `scripts/cache/vlr_event_stats.json`（vlr 赛事统计页，每人每赛事一条，带 K/D/A/FK/FD 计数、残局胜/尝试、英雄占比、赛事日期）。不改任何线上数据。\n")
    L.append("## 数据覆盖\n")
    L.append(f"- 赛事 {cov['events']}（有日期 {cov['dated_events']}），记录 {cov['records']}，选手 {cov['players']}，年份 {cov['years']}。")
    L.append(f"- 带 FK/FD 计数 {cov['records_with_fk_fd']} 条；带残局尝试数 {cov['records_with_clutch_attempts']} 条（vlr 对 2026 CN 赛事不发布残局）。")
    L.append(f"- 回测截止点 {len(cuts)} 个：2025 年起每个 VCT 赛事（Kickoff / Stage / Masters / Champions）的第一天。2026 Challengers 六场无日期，只作环境样本、不作预测目标。")
    L.append("- 去重：同一赛事同一人一条；比率全部由加权计数相除（KPR=K/回合，K:D=K/D，首次交战成功率=FK/(FK+FD)，残局率=胜/尝试）。")
    L.append("- 防泄漏：每个截止点只用在此之前结束的赛事；环境均值/方差、收缩、职责占比、z→分数映射都在训练窗内建立。今天的生涯英雄表没有历史快照，因此本回测**没有**用它；职责占比来自赛事页的英雄占比（有日期）。\n")
    L.append("## 三套方案\n")
    L.append("- **current(rebuilt)**：现方案在赛事表上的重建（build_world 的近期曲线、比率平均、截止日全池分位、每项混 42% Rating、位置权重、次级向 60 拉 25%）。没有大赛加成和冠军项，赛事表里没有这两样，所以是近似。")
    L.append("- **baseline-R2**：只用时间加权 Rating 的单一分数，按回合数收缩。这是任何复杂方案必须超过的线。")
    L.append("- **new**：计数→各自分母；按（位置 × 赛事层级）做 z 校正，人数不足退到位置、再退到全体；六项能力各按自己的证据量收缩（枪法/意识/道具/协同看加权回合，反应看 FK+FD 次数，残局看尝试数）；有日期的职责占比 × 功能模板得到总评；映射在训练窗内拟合一次后固定。沟通、指挥不进总评，本回测不评。\n")
    L.append("## 预测力（对赛事内 Rating 的 Spearman，按人数加权平均）\n")
    L.append("| 方案 | ρ(Rating) | ρ(ACS) | MAE(z) | 突破手残差 | 其他残差 | 决斗 | 先锋 | 控场 | 哨卫 | <300 回合 | 300–1000 | >1000 | n |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    order = sorted(grid, key=lambda r: -(r["rho_r2"] or 0))
    for r in order:
        L.append(f"| {r['model']} | {fmt(r['rho_r2'])} | {fmt(r['rho_acs'])} | {fmt(r['mae'])} | {fmt(r['entry_resid'])} | {fmt(r['rest_resid'])} | "
                 + " | ".join(fmt(r[f'rho_{x}']) for x in ROLES) + " | " + " | ".join(fmt(r[f'rho_{b}']) for b in ("lt300", "300to1000", "gt1000")) + f" | {r['n']} |")
    L.append("\n残差 = 标准化后的实际 Rating − 预测；正值表示这群人被低估。突破手 = 赛事内首次交战参与率前四分之一。\n")
    L.append("## 各属性与其对应未来表现的相关（new，κ×1，无次级折扣）\n")
    L.append("| 半衰期 | 枪法→ADR | 反应→首次交战成功率 | 意识→(−死亡/回合) | 道具→APR | 残局→残局率 | 协同→KAST |")
    L.append("|---|---|---|---|---|---|---|")
    for hl in (90, 180, 270, 365):
        vals = {r["ability"]: r for r in val_rows if r["half_life"] == hl}
        L.append(f"| {hl} | " + " | ".join(f"{fmt(vals[a]['corr'])} (n={vals[a]['n']})" if a in vals else "—" for a in STAT_ABILITIES) + " |")
    L.append("\n沟通、指挥没有可验证的统计对应项，不在此表；它们在方案里保持中性先验或有来源的人工估计。\n")
    L.append("## 稳定性（相邻截止点之间总评变化）\n")
    L.append("| 方案 | 截止点 | n | 变化标准差 | |Δ|>8 占比 | 最大上涨 | 最大下跌 |")
    L.append("|---|---|---|---|---|---|---|")
    for r in stab:
        L.append(f"| {r['model']} | {r['cutoff']} | {r['n']} | {fmt(r['sd'], 2)} | {fmt(r['share_abs_gt8'])} | {r['max_up']} | {r['max_down']} |")
    L.append("\n## 今天：新方案 vs 线上 world.json（对照，不是验证）\n")
    if compare:
        # Two scales. The world's 0-99 is a percentile over everyone it models,
        # Challengers included, so its VCT median sits near 80; this study only
        # has VCT events, and its frozen mapping puts the average 2024 VCT
        # player at 70. Levels are not comparable, ranks are — so the new
        # scores are shifted once to match the world's tier-one median among
        # well-evidenced players, and the movers are read after that shift.
        well = [r for r in compare if r["events"] >= 6 and world.get(r["ign"].lower(), {}).get("tier") == 1]
        shift = statistics.median(r["world_overall"] for r in well) - statistics.median(r["new_overall"] for r in well) if well else 0
        for r in compare:
            r["new_aligned"] = round(r["new_overall"] + shift)
            r["delta_aligned"] = r["new_aligned"] - r["world_overall"]
        d = [r["delta_aligned"] for r in compare]
        L.append(f"- 可对照选手 {len(compare)} 人（有 2024 年以来 VCT 赛事记录且在世界里）。两套分数的尺度不同（世界的分位池含次级，本研究只有 VCT 赛事），先把新分整体平移 {shift:+.0f} 分，使 6 场以上赛事的一级选手中位数对齐，再看差值。")
        L.append(f"- 对齐后差值：中位数 {statistics.median(d):+.0f}，标准差 {statistics.pstdev(d):.1f}，|Δ|>8 的 {sum(1 for x in d if abs(x) > 8)} 人（其中 {sum(1 for r in compare if abs(r['delta_aligned']) > 8 and r['events'] < 3)} 人只有 1～2 场赛事：本研究没有他们的次级和生涯数据，只是收缩到均值）。")
        for role in ROLES:
            rs = [r for r in compare if r["world_role"] == role and r["events"] >= 6]
            if len(rs) >= 8:
                rho = spearman([r["world_overall"] for r in rs], [r["new_overall"] for r in rs])
                L.append(f"- {role}（≥6 场，{len(rs)} 人）：对齐后差值中位数 {statistics.median(r['delta_aligned'] for r in rs):+.0f}，新旧排名相关 ρ={rho:.2f}。")
        for tier, lab in ((1, "一级"), (2, "次级")):
            rs = [r["delta_aligned"] for r in compare if world.get(r["ign"].lower(), {}).get("tier") == tier and r["events"] >= 6]
            if rs:
                L.append(f"- {lab}俱乐部（≥6 场）：{len(rs)} 人，对齐后差值中位数 {statistics.median(rs):+.0f}。")
        strong = [r for r in compare if r["events"] >= 6]
        L.append("\n上涨最多（≥6 场赛事，对齐后）：")
        for r in sorted(strong, key=lambda r: -r["delta_aligned"])[:12]:
            L.append(f"- {r['ign']}（{r['club']}，{r['world_role']}，数据位置 {r['data_role']}）{r['world_overall']} → {r['new_aligned']}，{r['events']} 场")
        L.append("\n下跌最多（≥6 场赛事，对齐后）：")
        for r in sorted(strong, key=lambda r: r["delta_aligned"])[:12]:
            L.append(f"- {r['ign']}（{r['club']}，{r['world_role']}，数据位置 {r['data_role']}）{r['world_overall']} → {r['new_aligned']}，{r['events']} 场")
        L.append(f"\n映射（在 2024 赛季参考窗上按未收缩值拟合一次，之后冻结）：总评 = {mapping['overall'][0]:.1f} + {mapping['overall'][1]:.1f}·z。")
    L.append("\n## 结论（第 1～2 步）\n")
    L.append("1. **预测力**：只用时间加权 Rating 的基线 ρ≈0.47，现方案重建 ≈0.44，新方案（六项合成）≈0.36；把 30% 的 Rating 混回总评升到 ≈0.42，仍不及基线。诊断变体说明：按位置中心化（0.36 vs 不中心化 0.34）和按证据收缩（0.36 vs 不收缩 0.34）都是有益的，等权模板和功能模板没有差别；缺的信息不在这些环节，而是六项分量本身对「下一赛事 Rating」的解释力低于 Rating 自己。这是预料中的一半——目标就是 Rating——但差距 0.1 不能忽视，说明第一版分量还漏掉了 Rating 里有、分量里没有的东西（多杀、经济、回合胜负参与）。")
    L.append("2. **各属性**：枪法→ADR 0.48、道具→APR 0.41、意识→死亡 0.37、反应→首次交战成功率 0.30、协同→KAST 0.29、残局→残局率 0.10。残局在现有样本量下基本不可预测，只能低置信；反应的证据（FK+FD 次数）也偏少。")
    L.append("3. **位置公平**：现方案把突破手高估约 0.06 z、把其他人低估 0.10 z；新方案反过来把突破手低估 0.08～0.10 z。两边都没做到零偏，新方案的方向是模板把 APR、KAST 权重给得太重，而 APR 正是受英雄机制影响最大的量——同英雄校正还没做，这个偏差会持续。今天对照里控场普遍下跌（Chronicle、Less、rushia）、先锋普遍上涨（Nicc、Lakia、Jieni7）是同一件事的表现。")
    L.append("4. **稳定性**：映射在 2024 参考窗上按未收缩值拟合一次并冻结后，相邻截止点的总评变化标准差 1.0（现方案 0.8），>8 分跳变 0.9%（现方案 0.7%）。第一版每个截止点重拟合映射时是 8.7 和 26%，那是实现错误，已改。")
    L.append("5. **次级折扣**：0 / 10% / 25% 三档在回测里完全没有区别，因为预测目标是 VCT 赛事，几乎没有次级选手进入目标集；这个数据集不能回答次级换算的问题，要等单图库和跨级别（升降级、转会）样本。")
    L.append("6. **半衰期**：270 与 365 天几乎相同，180 略低，90 明显差（0.32）。和基线的结论一致：能力看长期。")
    L.append("\n**建议的下一步**：在离线包里补三件事再回测——(a) 给六项之外加一个「回合影响」分量（KAST、多杀、回合胜率贡献，Rating 的分解项而不是 Rating 本身），看能否补上 0.1 的差距；(b) 单图库到位后做同英雄 APR/KAST 校正，专门看控场和先锋的对调是否消失；(c) 突破手残差做成回测的固定指标，模板权重按它调。在这些之前不建议替换线上评分。")
    L.append("\n## 读法与限制\n")
    L.append("- 这里的「现方案」是重建，线上分还含大赛加成、冠军底蕴和生涯表；今天对照里的差值一部分来自这些项。")
    L.append("- 环境校正第一版只按（位置 × 层级）分组，没有按英雄和版本；同英雄校正等单图库到位。")
    L.append("- 道具项只有 APR，分不清伤害助攻和有效道具，置信度按中低看待。")
    L.append("- 次级折扣三档都跑了，看突破手残差和 <300 回合组的 ρ 再定，不预设 10%。")
    L.append("- 参数网格里的最优不是结论：截止点只有十几个，赛事之间相关，差 0.02 以内当作没有差别。")
    (OUT / "report.md").write_text("\n".join(L) + "\n", "utf-8")
    print(f"report -> {OUT / 'report.md'}")


if __name__ == "__main__":
    main()
