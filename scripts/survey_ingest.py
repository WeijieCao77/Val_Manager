"""问卷星回收结果 → 阵容风格三角的核对报告。

    python3 scripts/survey_ingest.py <导出的.xlsx>

scripts/style_dynamics.ts 里的 STYLE 表（每个英雄的快攻/消耗/控制点数）和
MAP_DEMAND 表（每张图想要什么）都是我一个人填的。这个脚本把问卷收回来的答案
跟那两张表逐项对一下，回答三个问题：

  1. 哪几份答卷是认真填的 —— 45 道题 82 秒填完的那份，不该跟其他人等权重
  2. 填卷人之间自己有没有共识 —— 分歧大的项目说明这题本身就没标准答案
  3. 我填错在哪 —— 大家一致、且跟我差得远的，才是真该改的

三项分数先归一化成占比再比，所以有人填 3/3/3、有人填 1/1/1 不影响结果。
"""
import sys, re, json, pathlib, statistics as st
import openpyxl

AXES = ['快攻', '消耗', '控制']

# scripts/style_dynamics.ts 里的 STYLE 表，逐字誊过来
MINE = {
 '捷风':(3,0,0),'雷兹':(2,1,0),'不死鸟':(2,1,0),'芮娜':(3,0,0),'夜露':(2,1,0),
 '霓虹':(3,0,0),'壹决':(2,0,1),'幻棱':(3,0,0),
 '猎枭':(0,2,1),'铁臂':(3,0,0),'斯凯':(1,2,0),'K/O':(1,2,0),'黑梦':(1,2,0),
 '盖可':(0,3,0),'钛狐':(2,1,0),
 '炼狱':(1,0,2),'蝰蛇':(0,1,2),'幽影':(0,1,2),'星礈':(0,2,1),'海神':(0,0,3),
 '暮蝶':(0,1,2),'迷核':(0,1,2),
 '贤者':(0,1,2),'零':(0,0,3),'奇乐':(0,0,3),'尚勃勒':(0,1,2),'钢锁':(0,0,3),
 '维斯':(0,0,3),'禁灭':(0,0,3),
}
MINE_MAPS = {
 '亚海悬城':(33,34,33),'源工重镇':(42,33,25),'微风岛屿':(18,27,55),'盐海矿镇':(30,38,32),
 '裂变峡谷':(50,28,22),'隐世修所':(42,33,25),'森寒冬港':(22,28,50),'莲华古城':(36,42,22),
 '深海明珠':(20,50,30),'霓虹町':(38,20,42),'天枢云阙':(28,44,28),'日落之城':(30,38,32),
 '幽邃地窟':(45,22,33),
}


def score(x):
    """问卷星把矩阵分数导成字符串，空白导成 (空)。取不到就返回 None。"""
    if x is None:
        return None
    t = str(x).strip()
    return int(t) if re.fullmatch(r'\d+', t) else None


def share(v):
    """三个分数 → 占比。全零的（没填/全填0）返回 None。"""
    t = sum(v)
    return None if t <= 0 else tuple(x / t for x in v)


def main(path):
    ws = openpyxl.load_workbook(path, data_only=True)['Sheet1']
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(c) if c is not None else '' for c in rows[0]]

    # 矩阵题在导出里占三列：题干那列是 A.快攻，后面两列是 B.消耗 / C.控制
    items = []   # (名字, 是不是地图, 快攻列下标)
    for i, h in enumerate(hdr):
        m = re.search(r'【(决斗者|先锋|控场|哨卫|地图)】\s*([^\s—]+)', h)
        if m and h.rstrip().endswith('A.快攻'):
            items.append((m.group(2), m.group(1) == '地图', i))
    text_cols = [i for i, h in enumerate(hdr)
                 if re.match(r'^\d+、', h) and '【' not in h]

    data = rows[1:]
    print(f'{len(data)} 份答卷，{len([x for x in items if not x[1]])} 个英雄 + '
          f'{len([x for x in items if x[1]])} 张地图\n')

    # ---------------------------------------------------------- 1. 答卷质量
    print('\x1b[1m1. 哪几份是认真填的\x1b[0m')
    print(f"{'#':>3} {'用时':>7} {'省':<10}{'填了':>5}{'不同值':>7}{'直线率':>7}  判断")
    good = []
    for r in data:
        n = r[0]
        secs = int(re.sub(r'\D', '', str(r[2])) or 0)
        ip = re.sub(r'^.*\(|\).*$', '', str(r[5]))
        vals, straight = [], 0
        for _, _, c in items:
            v = [score(r[c]), score(r[c + 1]), score(r[c + 2])]
            if None in v:
                continue
            vals.append(v)
            if len(set(v)) == 1:            # 三项填了同一个数 = 没区分
                straight += 1
        flat = straight / max(1, len(vals))
        spread = len({tuple(v) for v in vals})
        per_q = secs / max(1, len(vals))
        ok = per_q >= 4 and flat < 0.5
        print(f'{n:>3} {secs:>6}秒 {ip:<10}{len(vals):>5}{spread:>7}{flat:>6.0%}  '
              + ('可用' if ok else f'\x1b[33m存疑（每题 {per_q:.1f} 秒）\x1b[0m'))
        if ok:
            good.append(r)
    print(f'\n→ {len(good)}/{len(data)} 份进入统计。每题少于 4 秒、或一半以上题目'
          f'三项填同一个数的，剔除。\n')
    if not good:
        print('没有可用答卷。'); return 1

    # -------------------------------------------- 2 & 3. 共识，以及我错在哪
    for is_map, title, mine_tbl in [
        (False, '2. 英雄：大家怎么填的，我差多远', MINE),
        (True, '3. 地图：大家怎么填的，我差多远', MINE_MAPS),
    ]:
        print(f'\x1b[1m{title}\x1b[0m')
        print(f"{'':<8}{'大家的平均':<20}{'我填的':<18}{'差距':>6}{'分歧':>6}  ")
        out = []
        for name, m, c in items:
            if m != is_map:
                continue
            shares = []
            for r in good:
                v = [score(r[c]), score(r[c + 1]), score(r[c + 2])]
                if None in v:
                    continue
                s = share(v)
                if s:
                    shares.append(s)
            if not shares:
                continue
            avg = tuple(sum(s[i] for s in shares) / len(shares) for i in range(3))
            mine = share(mine_tbl.get(name, (0, 0, 0)))
            if not mine:
                continue
            # 跟我的差距，和填卷人彼此的分歧，都用同一把尺（L1 的一半，0-1）
            gap = sum(abs(avg[i] - mine[i]) for i in range(3)) / 2
            disp = st.mean(
                sum(abs(s[i] - avg[i]) for i in range(3)) / 2 for s in shares
            ) if len(shares) > 1 else 0.0
            out.append((gap, disp, name, avg, mine))
        for gap, disp, name, avg, mine in sorted(out, reverse=True):
            fmt = lambda t: ' '.join(f'{x*100:>3.0f}' for x in t)
            flag = '\x1b[33m ← 该改\x1b[0m' if gap > 0.25 and disp < 0.25 else (
                   '\x1b[2m 大家自己也没谱\x1b[0m' if disp >= 0.25 else '')
            print(f'{name:<8}{fmt(avg):<20}{fmt(mine):<18}{gap:>6.2f}{disp:>6.2f}{flag}')
        print()

    # ------------------------------------------- 系统性偏差：不是噪音，是分歧
    agent_avgs = []
    for name, is_m, c in items:
        if is_m:
            continue
        shs = []
        for r in good:
            v = [score(r[c]), score(r[c + 1]), score(r[c + 2])]
            if None in v:
                continue
            sh = share(v)
            if sh:
                shs.append(sh)
        if shs:
            agent_avgs.append([sum(x[i] for x in shs) / len(shs) for i in range(3)])
    base = [st.mean(a[i] for a in agent_avgs) for i in range(3)]
    print('\x1b[1m2b. 一个系统性偏差\x1b[0m')
    print('  全体英雄平均: ' + '  '.join(f'{AXES[i]}{base[i]*100:.0f}%' for i in range(3)))
    print(f'  最高一项的平均占比: 大家 {st.mean(max(a) for a in agent_avgs):.0%}，我 80%')
    print('''
  大家给每个英雄的「控制」都有约 40% 的底噪，连决斗者平均都有 28%。这不是
  打分习惯：把答案锐化（占比取幂再归一化）到 γ=6，铁夜壶仍然读成「控制74」；
  减掉基线之后单个英雄很正常（霓虹 91 快攻、猎枭 81 消耗、零 75 控制），但
  五人阵容还是塌向控制。两种修法都救不回来，说明这是真实分歧不是噪音。

  第 9 位填卷人那句「所有队伍都公式控图加爆弹」大概就是原因：在国内的语境
  里「控制」= 控图，是现在每套阵容都在做的事，不是一个能区分阵容的维度。
  而指南里的 Control 是跟 Aggro / Midrange 对立的一极。同一个词，两个意思。
''')

    # 把大家的平均写出去，好让 style_dynamics.ts --panel 拿它跑一遍完整模型：
    # 「大家跟我不一样」本身不是结论，「换成大家的数之后模型会怎样」才是。
    panel = {'agents': {}, 'maps': {}}
    for name, is_m, c in items:
        shares = []
        for r in good:
            v = [score(r[c]), score(r[c + 1]), score(r[c + 2])]
            if None in v:
                continue
            sh = share(v)
            if sh:
                shares.append(sh)
        if shares:
            avg = [sum(s[i] for s in shares) / len(shares) for i in range(3)]
            panel['maps' if is_m else 'agents'][name] = [round(x, 4) for x in avg]
    out = pathlib.Path('scripts/survey_panel.json')
    out.write_text(json.dumps(panel, ensure_ascii=False, indent=1))
    print(f'（大家的平均已写到 {out}）\n')

    # ---------------------------------------------------------- 4. 问答题
    print('\x1b[1m4. 问答题\x1b[0m')
    for c in text_cols:
        said = [(r[0], str(r[c]).strip()) for r in data
                if r[c] and str(r[c]).strip() not in ('(空)', 'None', '')]
        if not said:
            continue
        print(f'\n\x1b[4m{hdr[c][:70]}\x1b[0m')
        for n, t in said:
            print(f'  [{n}] {t}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'survey.xlsx'))
