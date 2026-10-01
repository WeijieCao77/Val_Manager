"""
/cards/stats for players: the rating study's page (scripts/rating/render_coverage_v12.py, v15), worded for
the people whose cards it explains rather than for the one who built it.

    python3 scripts/publish_card_stats.py [source.html] [out=public/cards/stats/index.html]

The numbers, the per-player detail and the full algorithm are kept as they are. What changes is the voice:
no 「候选」 or 「本页是研究」 now that the scores are the cards' (2026-10-01), no version-to-version bookkeeping
(「上版候选」, 「上版原始回合」), and no notes the developer wrote to himself. Every replacement must find its text,
so a regenerated page that has drifted fails here instead of shipping half-reworded.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'analysis/rating/region_calibration_v15/全员评分对照与完整算法.html'
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'public/cards/stats/index.html'

# (old, new, how many times it must appear; 0 = at least once)
TEXT: list[tuple[str, str, int]] = [
    ('<title>全员评分对照 v15 · 数据覆盖与完整算法</title>', '<title>选手评分说明 · 开瓦包</title>', 1),
    ('<p class="eyebrow">VCT GAMES / 评分研究</p>', '<p class="eyebrow"><a href="/cards">开瓦包</a> / 选手评分</p>', 1),
    ('<h1>全员评分对照 v15</h1>', '<h1>选手评分是怎么算的</h1>', 1),
    ('把收录数据、模型估值与历史履历分开看。538 名选手都有候选评级，并明确区分评级依据。',
     '开瓦包 538 张选手卡的评分都由比赛数据按同一套规则算出（算法写在页尾，包括其中的校准项 K）。下面能查到每位选手用了哪些比赛、多少回合，近期表现和履历各加了多少。', 1),
    ('比赛数据截止上海冠军赛开赛前。本页是评分对照研究，未修改游戏卡片数值。全部数据内嵌，可保存到手机离线查看；外部来源链接需要联网。',
     '比赛数据截至上海冠军赛开赛前（2026-09-23 为止的比赛）。评分是卡的基础分，升级和进修另算。整页可以存到手机离线看，来源链接需要联网。觉得哪位选手的数据不对，欢迎在群里反馈。', 1),
    ('赛区环境修正统一提高50%，新增逐赛事拆解；保留85以上减半、最高92的分尺。Boaster与Haodong按本次目标分做独立评分校准，统计贡献保持可复核。',
     '85 分以下按原分；超过 85 的部分只算一半，最高 92 分。升级和进修另算。', 1),
    ('<strong>本批金银铜</strong>', '<strong>金银铜分档</strong>', 1),
    ('按本批候选分的分位数划分，分档不等于数据可信度。', '按全员评分排名分档：约前 20% 为金卡，再往下约 35% 为银卡，其余为铜卡。分档只看评分，和数据多少无关。', 1),
    ('历史评级和暂估不能解释为当前同等可信的实力结论。', '「历史评级」和「生涯暂估」的选手近期比赛收录得少，评分参考价值低一些。', 1),
    ('“Rating 贡献 +2 分”是标准化后的模型贡献', '「Rating 贡献 +2 分」是换算后的加分', 1),
    ('<option value="desc">当前分从高到低</option><option value="asc">当前分从低到高</option><option value="delta">较旧分涨幅</option><option value="old">游戏旧分从高到低</option>',
     '<option value="desc">评分从高到低</option><option value="asc">评分从低到高</option><option value="delta">这次涨得最多</option><option value="old">更新前评分从高到低</option>', 1),
    ("['old','游戏旧分'],['previous','上版候选'],['new','本版候选']", "['old','更新前'],['new','现在']", 1),
    ("a.download='全员评分对照-v15.csv'", "a.download='开瓦包选手评分.csv'", 1),
    # the algorithm, top: what the page is, not what the study was
    ('赛区修正与评分校准 v15：完整算法', '完整算法', 1),
    ('本页仅更新评分研究对照，不改变正式游戏卡片、玩家资产或公告。', '', 1),
    ('最终基础分：上限放宽至92', '最终评分：最高 92', 1),
    ('个人表现、近期权重、实际职责、对手／级别校准、冠军和其他履历沿用v13；本轮直接从未压缩综合原分S重新换算，不能在v14已经压缩到87的整数上再算一遍。',
     '个人表现（含近期权重、实际职责、对手和级别校准）加上冠军和其他履历，先合成综合原分 S，再按下式换算成评分。', 1),
    ('基础候选分 = floor(clamp(C(S) + K, 40, 92) + 0.5)', '评分 = floor(clamp(C(S) + K, 40, 92) + 0.5)', 1),
    ('K为独立评分校准，放在压缩后、最终取整前。此轮仅Boaster目标65、Haodong目标70：K=指定目标−未校准的小数基础分；其他538人中的536人K=0。它是本次指定的产品评分选择，不是比赛统计、Rating、ACS或指挥表现的测量结果，不拆散伪装进八项统计贡献，也不用于训练后续表现模型。',
     'K 是手动校准，放在换算之后、取整之前。目前只有 Boaster（定为 65）和 Haodong（定为 70）有 K，K = 定下的分数 − 按规则算出的小数分；其余 536 人 K = 0。K 不是比赛数据算出来的，所以单独列出，不混进上面的统计分项。', 1),
    ('85以下保持综合原分；85以上每增加2分原分，基础分增加1分，最后封顶92。全员统一换算，未取整结果单调不减，封顶和整数取整会产生并列。原有个人模型B&gt;90的压缩继续保留；它与最后基础分尺分别展示。',
     '85 以下就是综合原分；85 以上每多 2 分原分，评分多 1 分，最高 92。全员同一个换算，原分高的评分不会更低，封顶和取整会出现同分。', 1),
    ('工作区普通升级最高+7.5等效能力，进修保护预算另有4.5，规则保持不变。按用户要求，本版不再为满足“基础＋所有成长≤99”而把基础分压到87。基础92与成长另算，保护预算合计可到104等效能力；现有ratingAt本身允许超过99，这不是把卡面基础分改到104。实际进修收益还取决于位置权重、材料和单项属性余量。',
     '评分是卡的基础分。升级到 +5 最多再加 7.5 点，+5 之后进修最多再加 4.5 点，都不算在这里的评分里。进修实际能加多少，还看位置、喂的卡和那一项能力还剩多少空间。', 1),
    ('<th>基础候选</th>', '<th>评分</th>', 0),
    ('本版补入2025、2026 EWC冠军的10条选手荣誉；', '收录了 2025、2026 EWC 冠军的 10 条选手荣誉；', 1),
    ('本轮没有宣称新增个人比赛覆盖。', '', 1),
    ('正式游戏稀有度未改。', '', 1),
    ('按本版压缩后的整数候选分建立快照', '按全员评分建立快照', 1),
    ('逐人核对538个ID、时间截点、上海排除、单选手单赛事去重、跨平台新增来源无重叠、各分项重建、分位数及正式world.json未变。手机搜索、赛区／队伍／依据筛选、CSV及完整离线HTML另外验证。', '', 1),
    ('本版没有新独立留出集检验。之前v10的194场胜负／下一赛事指标不能冒充本版验证成绩。本次完成的是覆盖扩展与候选重算；赛事汇总代理、未测量道具／空间／指挥效果、跨级外推及低样本基准仍是明确局限。',
     '局限：部分比赛只有赛事汇总，没有逐图数据；道具、站位和指挥的效果没法直接测量；次级联赛选手要跨级换算；样本少的选手更依赖平均值。', 1),
    ('这是一份可复核的候选评级。缺失比赛、级别校准和时间覆盖仍有局限；本页不声称已穷尽选手经历，也不声称预测效果已经得到独立验证。',
     '评分按同一套公开规则算出，每一项都能在上面复核。收录的比赛仍有缺漏，觉得哪位选手的数据不对，欢迎反馈。', 1),
    # the algorithm, further down
    ('沿用的近期表现与冠军规则', '近期表现与冠军规则', 1),
    ('个人数值来源沿用v12的', '个人数值来源：', 1),
    ('沿用v7在2026-07-01之前', '用2026-07-01之前', 1),
    ('本版通过补数和显著低可信度标签降低误读，', '页面用「低可信度」标签提示这类选手，', 1),
    ('沿用v11：', '', 1),
    ('按本版近期权重重算；历史／生涯暂估将上一版G乘1.5，未重新伪造近期比赛。', '按近期权重计算；历史评级和生涯暂估的选手用此前算好的 G 乘 1.5。', 1),
    ('本轮另补2届EWC冠军', '另补 2 届 EWC 冠军', 1),
    ('F和N沿用上一版已核实的跨位和首季突破证据，不因这次补数据追授。', 'F 和 N 用已核实的跨位和首季突破证据。', 1),
]

# whole rows that only made sense between two versions of the study
ROWS = [
    re.compile(r'<div><dt>上版候选</dt><dd>[^<]*</dd></div>'),
    re.compile(r'<div><dt>上版[^<]*</dt><dd>[^<]*</dd></div>'),
    re.compile(r'<div><dt>近90天原权重</dt><dd>[^<]*</dd></div>'),
    # the v14 → v14.1 table of representative players
    re.compile(r'<h3>本轮代表选手对照</h3>\s*<div class="table-scroll"[^>]*>.*?</table></div>', re.S),
    # v15's note on its own checks, and its version-to-version table of the changed players
    re.compile(r'<p>本轮保留个人分和全部原始比赛／荣誉证据.*?</p>\s*<div class="table-scroll"[^>]*>.*?</table></div>', re.S),
]
# labels on every card
LABELS = [('<dt>游戏旧分</dt>', '<dt>更新前</dt>'), ('<dt>本版候选</dt>', '<dt>现在</dt>'), ('<dt>较游戏旧分</dt>', '<dt>变化</dt>'),
          ('>最终基础候选<', '>评分<'), ('本版模型加权实测值', '模型加权实测值'), ('本版计分权重', '计分权重'),
          ('近90天本版权重', '近90天权重'), ('英雄与本版模型权重', '英雄与模型权重'), ('本版合计附加', '合计附加'),
          ('该赛事本版贡献', '该赛事贡献'), ('本版赛区修正（×1.5）', '赛区修正（×1.5）'), ('校准后候选分', '校准后评分'),
          ('本轮赛区修正与独立校准', '赛区修正与手动校准'), ('本版Primmie', 'Primmie')]


def main() -> int:
    page = SOURCE.read_text('utf-8')
    for old, new, times in TEXT:
        n = page.count(old)
        if (times and n != times) or n == 0:
            print(f'!! expected {times or "≥1"} of: {old[:60]} — found {n}', file=sys.stderr)
            return 1
        page = page.replace(old, new)
    for rx in ROWS:
        page = rx.sub('', page)
    for old, new in LABELS:
        page = page.replace(old, new)
    # the cards are rendered once in the HTML and again by the script from the same labels
    left = [w for w in ('上版候选', '本版候选', '游戏旧分', '评分研究', '候选评级', '按用户要求', '工作区', '本轮代表', '上一版v14', '<th>上版</th>', '校准后候选分') if w in page]
    if left:
        print(f'!! still in the page: {left}', file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, 'utf-8')
    print(f'{OUT}: {len(page) / 1e6:.1f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
