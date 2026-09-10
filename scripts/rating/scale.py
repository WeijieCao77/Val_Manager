"""
Deliverable three: a candidate score scale, anchored and frozen offline.

    python3 -m scripts.rating.scale

Anchor: the reference population is the game's own modelled players (world.json)
who have a candidate rating today — not every line vlr ever listed. The
candidate's z-scores are mapped so that this population's percentiles land on
the game's 44–98 scale, and the population's MEDIAN lands on the world's
median for the same people (one number, not a fit to anyone's old score).
The table is written to analysis/rating/scale_v1.json with the reference
date and population size; it is what a later engine calibration would read.

Then, for the same people: rank agreement overall and within role, the
within-role percentile each man holds on both scales, and the shape of the
attributes (does the candidate's aim rank like the world's aim, etc.).
"""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from pathlib import Path

from .common import ROLES, STAT_ABILITIES, mean_sd, percentile_map, spearman
from .dataset import load_records, world_players
from .honours import build_ledger
from .igl import identities, levels
from .scheme2 import P2, rate2, reference2

OUT = Path(__file__).resolve().parents[2] / "analysis" / "rating"
REF = date(2025, 1, 1)
MIN_ROUNDS = 300.0


def main() -> None:
    records = load_records()
    ledger, _ = build_ledger()
    ids = identities()
    today = date.today() + timedelta(days=1)
    callers = levels(today, ids)
    mapping = reference2(records, REF, P2(), levels(REF, ids))
    rated = rate2(records, today, P2(fusion="stage"), mapping, ledger, ids, callers)
    world = world_players()
    pop = [(r, world[r.ign.lower()]) for r in rated.values() if r.ign.lower() in world and r.rnd_w >= MIN_ROUNDS]
    # z-space values for the population (undo the reference mapping)
    a0, b0 = mapping["overall"]
    z_over = [(r.combat - a0) / b0 for r, _ in pop]
    world_over = [w["overall"] for _, w in pop]

    def fit(zs: list[float], anchor_median: float) -> tuple[float, float]:
        pct = percentile_map(zs)
        target = [44 + 54 * pct[i] for i in range(len(zs))]
        mz, msd = mean_sd(zs)
        mt, tsd = mean_sd(target)
        b = tsd / msd
        # slope from the percentile spread, intercept from the anchor: the
        # population's median candidate lands on the population's median world score
        med_z = statistics.median(zs)
        return (anchor_median - b * med_z, b)

    scale = {"reference_date": today.isoformat(), "population": len(pop), "min_weighted_rounds": MIN_ROUNDS,
             "anchor": "population median = world median of the same players",
             "overall": fit(z_over, statistics.median(world_over))}
    for k in STAT_ABILITIES:
        zs = [(r.attrs.get(k, 70) - mapping[k][0]) / mapping[k][1] if hasattr(r, "attrs") else r.abilities[k] for r, _ in pop]
        zs = [r.abilities[k] for r, _ in pop]
        scale[k] = fit(zs, statistics.median(w["attrs"][k] for _, w in pop))
    (OUT / "scale_v1.json").write_text(json.dumps(scale, ensure_ascii=False, indent=1), "utf-8")

    a, b = scale["overall"]
    cand = [round(a + b * z) for z in z_over]
    rows = [{"ign": r.ign, "role": w["role"], "world": w["overall"], "cand": c, "world_role": w["role"]} for (r, w), c in zip(pop, cand)]
    L = ["# 第 3 步：候选评分尺度（离线冻结版 v1）\n",
         f"生成于 {today.isoformat()}。参考人群 = 世界里建模且加权回合 ≥ {MIN_ROUNDS:.0f} 的选手，{len(pop)} 人。锚点：人群中位数对齐到同一批人的世界中位数（{statistics.median(world_over):.0f}），斜率由候选分位在 44～98 上的展开决定。表在 analysis/rating/scale_v1.json：总评 = {a:.1f} + {b:.1f}·z，各属性各一条。没有对任何人的旧分做拟合。\n",
         "## 同一批人：排名一致性\n",
         f"- 总评 Spearman ρ = {spearman(world_over, cand):.3f}（n={len(pop)}）。"]
    for role in ROLES:
        rs = [x for x in rows if x["role"] == role]
        if len(rs) >= 8:
            L.append(f"- {role}：ρ = {spearman([x['world'] for x in rs], [x['cand'] for x in rs]):.3f}（n={len(rs)}），候选中位 {statistics.median(x['cand'] for x in rs):.0f} 对世界中位 {statistics.median(x['world'] for x in rs):.0f}。")
    # within-role percentile shifts
    L.append("\n## 位置内分位的变化（候选 − 世界，分位点 0～100）\n")
    L.append("| 位置 | 中位偏移 | 上升 ≥20 分位 | 下降 ≥20 分位 | 例子（最大上升 / 最大下降） |")
    L.append("|---|---|---|---|---|")
    shifts_all = []
    for role in ROLES:
        rs = [x for x in rows if x["role"] == role]
        if len(rs) < 8:
            continue
        pw = percentile_map([x["world"] for x in rs]); pc = percentile_map([x["cand"] for x in rs])
        sh = [(rs[i]["ign"], (pc[i] - pw[i]) * 100) for i in range(len(rs))]
        shifts_all += sh
        up = max(sh, key=lambda t: t[1]); dn = min(sh, key=lambda t: t[1])
        L.append(f"| {role} | {statistics.median(v for _, v in sh):+.0f} | {sum(1 for _, v in sh if v >= 20)} | {sum(1 for _, v in sh if v <= -20)} | {up[0]} {up[1]:+.0f} / {dn[0]} {dn[1]:+.0f} |")
    # attribute shape
    L.append("\n## 属性形状：候选各项与世界各项在同一批人上的秩相关\n")
    L.append("| 属性 | ρ(候选, 世界) | 候选中位 | 世界中位 |")
    L.append("|---|---|---|---|")
    for k in STAT_ABILITIES:
        ak, bk = scale[k]
        cv = [round(ak + bk * r.abilities[k]) for r, _ in pop]
        wv = [w["attrs"][k] for _, w in pop]
        L.append(f"| {k} | {spearman(cv, wv):.3f} | {statistics.median(cv):.0f} | {statistics.median(wv):.0f} |")
    prof = []
    for (r, w), _ in zip(pop, cand):
        cv = [r.abilities[k] for k in STAT_ABILITIES]; wv = [w["attrs"][k] for k in STAT_ABILITIES]
        s = spearman(cv, wv) if len(set(cv)) > 1 and len(set(wv)) > 1 else None
        if s is not None:
            prof.append(s)
    L.append(f"\n每人六项形状的秩相关（候选 vs 世界）：中位数 {statistics.median(prof):.2f}，四分位 {sorted(prof)[len(prof)//4]:.2f}～{sorted(prof)[3*len(prof)//4]:.2f}（n={len(prof)}）。世界的六项都混了 42% Rating，形状本来就比候选平。")
    L.append("\n## 读法\n- 这是尺度，不是能力判断：92→74 这类差值里，约一个档位是两把尺子的差，本表对齐中位数后再看排名与分位变化。\n- 引擎标定应读这张表的候选分，之后换尺度就要重标；所以先冻结它。\n- 同英雄校正落地后，映射表要在同一参考人群上重拟一次并作为 v2。")
    (OUT / "report_scale.md").write_text("\n".join(L) + "\n", "utf-8")
    print(f"report -> {OUT / 'report_scale.md'}")


if __name__ == "__main__":
    main()
