# balance v4 — 2026-09-21

The owner, after the cups: 「杯赛还是有很多以下犯上的情况，再微调一下分差情况下
胜率，特别是卡升过级、教练升过级，战力值是否计算准确，还有一个 BO5 里面每一小局
赛果是否随机、是否按照定制胜率执行。不要让玩家觉得好不容易抽的、攒的卡、升级了，
结果经常在杯赛里一点用也没有。」

Three things were checked before anything was changed. All three were already
correct — the complaint is a design one, not a defect.

## 1. 战力 / 阵容分 do count the levels

`scripts/measure_upgrade_worth.ts`, same five, only levels changed (v3 scale):

| 改动 | 阵容分 | 战力 | 比 +0 |
|---|---|---|---|
| 一张卡 +5 | 77.81 | 38903 | +1.00 |
| 五张卡 +3 | 79.81 | 39903 | +3.00 |
| 五张卡 +5 | 81.81 | 40903 | +5.00 |
| 教练 +5 | 77.81 | 38903 | +1.00 |
| 五张 +5、教练 +5 | 82.81 | 41403 | +6.00 |

Card levels, coach levels and 默契 all reach the match: `honourGap` reads that
same unrounded paper score, and both cups freeze it at sign-up
(`fiveOf` in opencup-api.js / teamcup-api.js reads `state.cards[id].level` for
all five and the coach). Nothing is lost between the upgrade button and the
match.

## 2. Every map of a BO5 is played out

Measured per-map win rate, then the series rate that would follow if maps were
independent, against the series rate actually measured (gaps built from
different fives, not levels):

| 分差 | 单图 | BO3 实测 | BO3 若独立 | BO5 实测 | BO5 若独立 |
|---|---|---|---|---|---|
| 0.9 | 53.2% | 55.7% | 54.8% | 55.2% | 56.0% |
| 2.0 | 54.6% | 56.9% | 56.9% | 55.9% | 58.6% |
| 3.2 | 57.8% | 62.1% | 61.6% | 64.3% | 64.4% |
| 5.2 | 64.8% | 71.1% | 71.6% | 76.5% | 76.2% |
| 7.9 | 77.6% | 87.4% | 87.1% | 91.0% | 92.2% |
| 12.8 | 92.4% | 98.8% | 98.4% | 98.8% | 99.6% |

No hidden correlation between the maps of a series. A BO5 really is safer than
a BO1, which is what makes a gap worth paying for.

## 3. v3 was doing exactly what it said

Eight live 全服杯 pulled from the public schedule route (cups 67–74, all on
v3), `live_open_cups_v3.json`, 4,761 series, 4,428 of them with a gap:

| 分差 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|
| 高分胜率 (BO3) | 54.8% | 61.5% | 57.3% | 63.6% | 69.2% | 78.3% | 86.4% | 89.9% |

**28.8% of every series with a gap went to the lower score.** Not a bug: a cup
pairs like with like, so 1,848 of 4,428 series were one to three points apart,
exactly where v3 sits near a coin flip by design.

Feeding the live gap distribution through the probe table predicts 28.8% for
v3 — to the tenth. The same method predicts **24.8% for v4 on the same gaps**,
and ~21–22% once the wider level scale spreads the gaps out.

## What changed

**The curve** (`src/engine/balance.ts`, `BALANCE_VERSION = 4`). Same knee
family, same probe table (the match engine is untouched, so P(win|E) still
holds). Owner's BO3 targets: +1 56.5, +2 61, +3 66.5, +5 76, +8 90, +10 95.
Fitted `{ s0 1.34, s1 2.12, k 6.4, w 1.5 }` — of the widths that land every
target within half a point, the widest, because a wide turn is what "no step at
an integer" means. Measured on the real engine (check_balance_v2, 1,500 series
a cell): BO3 55.2 / 62.7 / 67.0 / 76.7 / 95.9, BO5 70.3 at +3 and 81.7 at +5.

**What a level is worth** (`cards.ts LEVEL_GAIN`, 1 → 1.5 ability points;
`COACH_LEVEL_LIFT` 0.2 → 0.3 = LEVEL_GAIN / 5). It is a scale, not a new
channel: paper, 战力 and the arena's post-squeeze add all read it, so they
cannot disagree. A card taken to +5 — twelve spare copies and 16,500 coins —
moves the five by 1.5 阵容分 instead of 1; a maxed five by 7.5 instead of 5.

Together, on the real engine (400 series a cell, v3 → v4):

| 改动 | 分差 | BO3 v3 | BO3 v4 |
|---|---|---|---|
| 一张卡 +5 | +1 → +1.5 | 52.7% | **58.6%** |
| 五张卡 +3 | +3 → +4.5 | 62.8% | **74.8%** |
| 五张卡 +5 | +5 → +7.5 | 70.8% | **87.5%** |
| 教练 +5 | +1 → +1.5 | 52.8% | **58.3%** |

Tournaments already under way finish on the version they started (`cup.balance`,
`open_cups.balance_version`, `team_cups.balance_version`).

## Fences moved with the targets

check_balance_v2 §1 (version, slope bound) and §5 (target bands),
check_gap_curve (bands, and the two pure-level checks — a level on all five is
no longer meant to be a coin flip), check_card_score_odds, check_power_growth
(战力 per level, the post-squeeze add, the coach's paper lift),
ui/cards/GapOdds.tsx (the printed table and what a level buys).

## What it does to the club cup (PVE), measured

`measure_cup_growth.ts 250`, the same cells on v3 and v4 (`cup_growth_v3.json`,
`cup_growth_v4.json`). 金币/体力, full flow, by bracket depth:

| 五人 | 等级 | v3 (3/4/5 轮) | v4 (3/4/5 轮) |
|---|---|---|---|
| 最好的金卡 | +0 | 138 / 158 / 163 | 140 / 180 / 155 |
| 最好的金卡 | +5 | 162 / 170 / 167 | 164 / 181 / **231** |
| 彩卡 | +0 | 251 / 296 / 324 | 269 / 303 / 335 |
| 彩卡 | +5 | 300 / 355 / 420 | 300 / 360 / 414 |

A maxed 彩卡 five was already winning every bracket, so it does not move. A
maxed gold five earns about a third more at the deepest bracket (champion
17.4% → 36.2%), and everyone else moves by a few per cent — the steeper curve
pays whoever is ahead of the club they drew, which includes unlevelled fives
against weak draws. 54–106 cups a cell, so read the small moves as noise.

Deliberately not counter-adjusted: a levelled five winning more in the cup is
the same coin as a levelled five winning more in PvP, which is what was asked
for. If the payout needs pulling back later the levers are `cupEaseFor`'s
negative cap / `CUP_CLIMB_TO` or the prize table, not the curve.
