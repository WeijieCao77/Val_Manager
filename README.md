# VAL MANAGER · 无畏契约电竞经理

一款浏览器端的《无畏契约》（VALORANT）电竞经理模拟游戏。你执掌一支战队，管理阵容、
战术、训练、转会与财务，带队征战 VCT 四大赛区、国际赛与次级联赛。

灵感来自 Football Manager 与 Steam 上的 CS2 电竞经理，玩法形式参考了 B 站的
《无畏人生模拟器》，但**数据完全独立**，全部来自专业电竞数据网站。

---

## 真实数据，没有虚构人物

游戏里的每一位选手都是真实存在的职业选手。没有任何"生成"的假名字。

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 战队、阵容、国籍、位置 | [vlr.gg](https://www.vlr.gg) | VCT 2026 赛季 |
| Rating / ACS / K/D / KAST / ADR / KPR / APR / 首杀率 / 爆头率 | vlr.gg | 真实赛季统计 |
| 选手真名、生日 | [Liquipedia](https://liquipedia.net/valorant) | 通过官方 API 获取 |
| 一级联赛参赛名单 | vlr.gg 赛区筛选 + 赛事页 | 四大赛区各 12 队，逐队核对 |

### 能力值是怎么来的

八项能力值不是拍脑袋定的，而是由上面那些**真实的每回合数据**按分位映射得出：

| 能力 | 来源 |
| --- | --- |
| 枪法 | ACS、ADR、爆头率 |
| 反应 | 首杀率（FKPR）、每回合击杀（KPR） |
| 意识 | KAST、首死率（越低越好） |
| 道具 | 每回合助攻（APR）+ 位置特性 |
| 残局 | Rating、K/D |
| 协同 | KAST、APR |
| 沟通 | KAST + 位置特性 |
| 指挥 | APR、KAST + 位置特性（每队一名 IGL） |

因为单项分位取平均会把所有人压向中游，每一项还会与选手的整体 Rating 分位加权混合
（真实能力本来就是相关的：顶级选手多数项都强），这样才能还原出真实的能力梯度。

**估算的部分**（并已在界面中标注）：合同年限、薪资、俱乐部预算与训练设施等级——
这些是游戏平衡所需，公开数据里没有。Liquipedia 未收录生日的选手，年龄按真实
VCT 年龄分布推算，选手详情页会显示"（推算）"。缺失的主教练**留空**，不会用虚构人名补齐。

---

## 玩法

- **四大赛区一级联赛**：VCT Americas / EMEA / Pacific / China，各 12 支合作战队
- **次级联赛**：Challengers 赛段，冠军可通过 Ascension 升入 VCT（同时有降级）
- **完整赛季日历**：季前 → Kickoff → Masters I → Stage 1 → Masters II → Stage 2 →
  Champions → 休赛期，共 336 天
- **阵容管理**：首发五人、位置搭配（缺控场/哨卫会有实打实的惩罚）、体能与伤病
- **战术**：节奏、道具、侵略性、中局应变四条滑杆，配合地图熟练度影响 BP 与胜负
- **训练**：每周为每位选手指定训练重点，受年龄、疲劳、士气、教练与设施影响
- **转会**：转会窗口、报价谈判（俱乐部要价 + 选手意愿两道关）、挂牌、解约
- **财务**：赞助、奖金、薪资、运营开支，董事会信任度
- **比赛模拟**：BP → 逐图 → 逐回合，含经济系统（eco / force / full buy）、
  攻防转换、加时，并生成完整数据面板

### 比赛模拟的标定

回合模型按真实 VCT 统计区间标定，跑完整赛季后的联赛平均值：

| 指标 | 本作 | 真实 VCT |
| --- | --- | --- |
| ACS 平均 | ~200 | ~200 |
| K/D 平均 | ~0.99 | ~1.00 |
| ADR 平均 | ~137 | ~135 |
| Rating 平均 | ~0.99 | ~1.00 |
| 顶尖选手 K/D | ~1.6 | ~1.4–1.5 |

回合胜率对实力差的敏感度被刻意压低——真实 VCT 里最强的队面对全联盟也只能拿下约六成
回合，而不是压倒性碾压。

---

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:5173 即可。构建生产版本：

```bash
npm run build
```

纯前端，无后端；存档保存在浏览器 `localStorage`，也可导出/导入 JSON 文件。

---

## 项目结构

```
src/
  engine/          纯 TypeScript 模拟内核，不依赖 React
    types.ts       领域模型
    rng.ts         带种子的 xorshift32（同一存档可复现）
    match.ts       BP、回合、经济、数据统计
    league.ts      循环赛、积分榜、淘汰赛对阵
    season.ts      赛季日历、阶段推进、升降级
    training.ts    训练、成长、伤病、年龄曲线
    transfer.ts    转会谈判与 AI 引援
    finance.ts     奖金、赞助、薪资
    save.ts        存档 / 读档 / 导入导出
  ui/              React 界面
  data/world.json  由脚本生成的世界数据

scripts/
  build_world.py       由真实数据构建 world.json
  fetch_liquipedia.py  从 Liquipedia 批量获取生日与教练
  smoke.ts             无头跑完整赛季并校验数据合理性
```

重新生成世界数据：

```bash
python3 scripts/fetch_liquipedia.py
python3 scripts/build_world.py
```

跑一遍模拟自检（跑 3 个赛季并检查所有不变量）：

```bash
npx tsx scripts/smoke.ts 3
```

---

## 数据抓取说明

抓取脚本遵守各站点规则：Liquipedia 使用官方 API，携带标识性 User-Agent、启用 gzip、
批量查询（一次 50 个页面而不是逐页请求）并在收到 429 时退避。请不要把间隔调短。

---

## 致谢

- 数据：[vlr.gg](https://www.vlr.gg)、[Liquipedia](https://liquipedia.net/valorant)
- 玩法形式参考：B 站《无畏人生模拟器》

本项目为非商业同人作品，与 Riot Games 无关。VALORANT 及相关标识为 Riot Games, Inc. 的商标。
