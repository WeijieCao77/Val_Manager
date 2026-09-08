/**
 * How the hidden numbers actually work.
 *
 * Six systems in this game move on their own and are only ever shown as a
 * finished number: relationships, chemistry, trust, loyalty, reputation and
 * the sponsorship terms. A player who does not know what moves them cannot
 * play them, and the usual result is a manager who assumes something is
 * random, or who spends a season on a lever that does nothing.
 *
 * Everything below is read out of the engine rather than remembered: the
 * figures are the ones in bonds.ts, trust.ts, commercial.ts, season.ts and
 * match.ts. Where a rule is a formula, the formula is here — a hint that the
 * player has to reverse-engineer anyway is worse than the number.
 *
 * The one that surprises people most is 忠诚度, which does not move at all.
 */
import { useContext, useEffect, useMemo, useState } from 'react'
import { currentRuleset, drawRules } from '../engine/ruleset'
import { GameCtx } from './ctx'
import Rich from './rich'
import { POINTS_NOTE, qualifyRule } from '../engine/qualify'

interface Line { t: string; d: string }
interface Section { key: string; title: string; lede: string; up?: Line[]; down?: Line[]; use: string[]; useTitle?: string }

const buildSections = (drawn: boolean): Section[] => [
  {
    key: 'format',
    title: '赛制与晋级',
    lede: '一年六段：Kickoff → Masters I → Stage 1 → Masters II → Stage 2 → Champions，中间是休赛期和两个短转会窗。'
      + '赛区赛段先打循环赛，再打季后赛；国际赛的名额看季后赛名次和全年积分。'
      + '积分榜顶上的「晋级形势」会告诉你还差什么。',
    use: [
      `<b>Kickoff</b>：${qualifyRule('kickoff', drawn)}`,
      `<b>Stage 1</b>：${qualifyRule('stage1', drawn)}`,
      `<b>Stage 2</b>：${qualifyRule('stage2', drawn)}`,
      '<b>Masters</b>（12 队）：4 支赛区冠军直接进季后赛；8 支第 2、3 名先打<b>瑞士轮</b>：三轮 BO3，两胜晋级、两负出局，出 4 队。'
        + (drawn ? '瑞士轮每轮抽签：首轮二号种子对别的赛区的三号种子，之后按战绩分池，第三轮不重赛。瑞士轮打完，四个赛区冠军抽顺序、依次挑八强对手，轮到你的队就你来选。' : '')
        + '八强<b>双败淘汰</b>：胜者组输一场掉进败者组，败者组再输才出局；败者组决赛和总决赛 BO5，其余 BO3。',
      '<b>Champions</b>（16 队）：每赛区 4 队，分 4 个小组（GSL：开局赛、胜者赛、败者赛、决胜赛，每组前 2 出线），八强同样双败淘汰。'
        + (drawn ? '分组按四档抽签，每组四个赛区各一队；小组赛后再抽八强，小组第一对不同组的小组第二，同组的两队分在不同半区。' : ''),
      POINTS_NOTE,
    ],
    useTitle: '每一段怎么打',
  },
  {
    key: 'bond',
    title: '队友关系（好感度）',
    lede: '每两名选手之间一个数，−100 到 +100，双向相同，说的是这两个人处得怎么样。'
      + '新签的人起手 30~74，看这些：'
      + '一起待了多久（最多 +10，头一年最值钱）、同国籍 +4 不同 −2、年龄差 ≤2 岁 +3 ≥7 岁 −2、'
      + '位置互补（决斗者↔先锋、控场↔哨卫）+3、团队配合和沟通越高越好相处。',
    up: [
      { t: '赢一场比赛', d: '上场的每一对 +0.6~1.8。' },
      { t: '每周自然回暖', d: '朝 +10 回归，速度 =（10 − 现值）×（1.2% +（教练激励 − 55）÷ 100 × 3%）× 你的更衣室技能。'
        + '一场输球能扣十几点，回暖一周只有零点几。' },
      { t: '双人训练', d: '唯一能定向修一对关系的手段。' },
      { t: '团建（俱乐部活动）', d: '集训营在场的每一对 +5~9，球迷开放日和观赛派对 +1~3，拍摄 0。' },
    ],
    down: [
      { t: '输球，而且一个人扛了另一个没跟上', d: '扣「评分差 × 20~34 × (1.35 − 扛的人的耐心) × 记仇系数」。'
        + '耐心 =（团队配合 + (100 − 野心)）÷ 200；'
        + '记仇系数 = 1 + 已有恶感 ÷ 55，本来就不对付的两个人扣得更狠。' },
      { t: '输球，但两个人都打得差', d: '只扣 0.3~2。' },
      { t: '卖掉一个大家喜欢的人', d: '和他关系 >15 的每个队友掉「(关系 − 15) × 0.16」的信任（最多 9），士气也跟着掉。' },
      { t: '积怨不管', d: '一对低于 −40 之后，每周有 18% 概率两人各掉 3 士气、+4 不满。' },
    ],
    use: [
      '全队默契就是所有两两关系的平均值，直接进比赛。',
      '关系还决定谁走了会伤到谁，转会页那一栏读的就是它。',
    ],
  },
  {
    key: 'chem',
    title: '全队默契',
    lede: '队内所有两两关系的平均数，就是更衣室面板顶上那个数。',
    use: [
      '比赛里算的是：（全队平均团队配合 + 平均沟通）÷ 2 +（默契 − 10）× 0.18。',
      '默契每高 10 点，约等于全队团队配合和沟通各高 1.8 点。它补不了能力差距。',
      '赛后点开地图的「为什么是这个结果」，「团队默契」那一行就是它在那张图上值了多少。',
    ],
  },
  {
    key: 'style',
    title: '阵容风格与滑杆',
    lede: '一套五个英雄有它的形状：<b>双决斗</b>（两个决斗者）、<b>双哨卫</b>、<b>双控场</b>，'
      + '其余算<b>标准</b>（一决斗双先锋一控场一哨卫）。形状本身先算一笔：双决斗攻 +1.3 守 −0.9，'
      + '双哨卫攻 −0.8 守 +1.4，双控场攻守各 +0.5、中局应变 +0.9。'
      + '<b>四条滑杆的效果再按形状放大或缩小</b>。',
    up: [
      { t: '节奏 / 侵略性', d: '每点节奏攻 +0.035 守 −0.022，每点侵略性攻 +0.028 守 −0.015（50 为零点）。'
        + '<b>双决斗进攻端乘 1.35、防守端乘 0.8</b>，往右拉划算；'
        + '<b>双哨卫进攻端乘 0.5、防守端乘 2.2</b>，往左拉才厚。标准阵容不乘。' },
      { t: '道具', d: '每点 ±0.02，攻守同加，再乘（0.5 + 全队道具属性 ÷ 130）；<b>双控场再乘 1.2</b>。' },
      { t: '针对对手', d: '对手是双哨卫：节奏每点 −0.03 攻（慢打是加分）、道具每点 +0.015；'
        + '对手是双决斗：侵略性每点 −0.03 守、中局应变每点 +0.02；'
        + '对手是双控场：道具每点攻 +0.02 守 +0.01、节奏每点 +0.015。对标准阵容没有针对项。' },
      { t: '暂停', d: '双决斗喊「强攻」效果 ×1.4，双哨卫喊「稳守」×1.4；反过来喊各 ×0.7。' },
    ],
    use: [
      '同一支队、同一套阵容，滑杆顺着形状打和逆着打，单图胜率差 10~13 个百分点，和地图熟练度一个量级。',
      '「全部拉满」不是万能答案：双哨卫阵容全满 66%，慢打 79%。',
      '赛前预案会写出对手这张图大概率的形状和该怎么调。',
    ],
  },
  {
    key: 'fam',
    title: '阵容熟练度',
    lede: '地图熟练度是多熟这张图；阵容熟练度是多熟<b>这张图上这五个英雄</b>。每张图一个数，'
      + '0~100，<b>50 是中立</b>，别的俱乐部永远在 50。',
    up: [
      { t: '正式比赛打一张图', d: '+8。' },
      { t: '训练赛打一张图', d: '+6。' },
      { t: '跑图一周', d: '每张图 +12，练的是这张图预案里那套阵容。' },
    ],
    down: [
      { t: '换一个英雄', d: '保留五分之四；换两个保留五分之三。' },
      { t: '五个全换', d: '从 0 开始。' },
    ],
    use: [
      '进比赛：（熟练度 − 50）× 0.06，攻守同加。练满是 +3，全新阵容是 −3。',
      '赛前临时拼一套没打过的五个人，起手比对面矮 3 分；在战术页定好一套不动，几周后反过来。',
    ],
  },
  {
    key: 'trust',
    title: '对你的信任',
    lede: '球员对你本人的长期评价，从 62 起步。士气是这周的情绪，'
      + '信任是几个月攒出来的判断，动得慢、恢复得更慢。'
      + '82 以上「完全信任」，66「信任」，48「中立」，30「有保留」，以下「已失去信任」。',
    up: [
      { t: '赢球', d: '上场的每人 +0.35。' },
      { t: '兑现承诺', d: '签约时承诺了核心或首发，并且真的在首发里：每周 +0.4。' },
      { t: '让人休息', d: '疲劳 ≤35 每周 +0.3。' },
      { t: '更衣室技能', d: '正向的部分乘以它，负向的部分除以它。' },
    ],
    down: [
      { t: '往死里用', d: '疲劳 ≥85 每周 −2.2，≥70 −1.0。' },
      { t: '商务活动排太满', d: '一周 3 场以上 −2.6，2 场 −1.2。直播一周 4 晚以上只 −0.6。' },
      { t: '承诺了核心却坐板凳', d: '每周 −2.4，单项里最重。' },
      { t: '伤着还不让休息', d: '每周 −0.8。' },
      { t: '输球', d: '上场的每人 −0.5。' },
      { t: '状态正好的时候把人换下', d: '一次 −4.5（状态 ≥68 或能力 ≥78）；本来就该轮换的只 −1.2。' },
    ],
    use: [
      '续约时加分：(信任 − 62) × 0.55，信任 85 比信任 40 少要一大截钱。',
      '跌破 40 会有提示；跌破 25 时额外 +12 不满，续约基本谈不成。',
      '涨幅随信任变高而缩小，且一直朝 62 回归 2%：不犯错大约停在「信任」，「完全信任」得一直做对。',
    ],
  },
  {
    key: 'loyal',
    title: '忠诚度（归属感）',
    lede: '他对<b>这家俱乐部</b>的归属感。'
      + '<b>换一个经理，忠诚还在，信任清零</b>：忠诚记俱乐部的账（待了多久、'
      + '一起拿过什么、有没有被挂牌），信任记你的账。'
      + '出场时间不算在这里，那已经在信任和不满里算过了。',
    up: [
      { t: '在这里多待一个赛季', d: '涨 (78 − 现值) × 0.16，最少 0.4 最多 7，越高涨得越慢。'
        + '新签的人从 38 起步，四个赛季大约到 58。' },
      { t: '在这儿拿冠军', d: '赛区冠军 +2.5，国际冠军 +5，当时在队里的每个人都算。' },
      { t: '续约', d: '+5。' },
      { t: '帮他挡掉别队的报价', d: '+4。前提是他自己没想走；他想走你硬留，扣的是不满。' },
    ],
    down: [
      { t: '被挂牌', d: '−14，<b>一个赛季只扣一次</b>，取消挂牌也收不回来。' },
      { t: '换队', d: '到新东家<b>重置成 38</b>；回老东家能保住一部分。' },
    ],
    use: [
      '续约时 (忠诚 − 50) × 0.35 是加分，别的队来挖他时同样的数是阻力。'
      + '<b>「对这支球队没有太深的归属感」说的就是这一条。</b>',
      '你问价别队球员时，他的态度再扣一次 (忠诚 − 50) × 0.5，比合同分量更重。'
      + '忠诚 75 以上的人光靠加钱很难谈。',
      '留人的办法只有三个：让他待着、带他拿冠军、别轻易挂牌。',
    ],
  },
  {
    key: 'grief',
    title: '不满',
    lede: '和信任分开：信任是对你的评价，不满是眼下的怨气。'
      + '超过 40 他就开始想走，别队报价时接受度直接加「不满 × 0.25」。',
    up: [
      { t: '承诺了核心/首发却不上', d: '每周 +7（首发承诺 +4.5），更衣室技能能减缓。' },
      { t: '合同配不上身价', d: '身价超过现薪 1.3 倍时，每周 28% 概率来找你谈，一次 +8 不满、−3 信任，谈过之后 120 天内不再提。' },
      { t: '被别队盯上而且他有野心', d: '野心 >70 的人听到传闻 +4。' },
      { t: '信任跌破 25', d: '一次性 +12。' },
      { t: '长期不和', d: '和某人关系低于 −40，每周有概率 +4。' },
    ],
    down: [
      { t: '兑现承诺', d: '承诺了首发并且真的首发，每周 −3。' },
      { t: '续约', d: '签下新合同直接清零。' },
    ],
    use: [
      '别的俱乐部挂牌不满 >40 的人的概率 +30%，想挖人先看不满值。',
      '你问价别队球员时也算这个：不满 >35、士气 <45 或合同只剩一年，接受度 +25。',
      '队内有人不满 >45，首页待办会点名提醒。',
    ],
  },
  {
    key: 'rep',
    title: '经理声望',
    lede: '你自己的名气，5~96。它决定更好的球员愿不愿意来、更好的俱乐部愿不愿意找你。',
    up: [
      { t: '夺冠', d: '赛区冠军 +2.5，国际冠军 +6。' },
      { t: '赛段超额完成', d: '(1 + (要求名次 − 实际名次) × 0.5) × 你的成长系数。要求前 8 你拿了第 2，就是 4 倍。' },
    ],
    down: [
      { t: '赛段没达标', d: '−1.5，不打折。' },
    ],
    use: [
      '所有增长乘「(96 − 现在的声望) ÷ 42」（最低 12%），越高涨得越慢；扣分不打折。'
      + '80 以上，一个赛区冠军只值零点几。',
      '挖人：(你的声望 − 对方俱乐部声望) × 0.55 直接加到球员的接受分。',
      '求职：比目标俱乐部低 14 以上不考虑；成功率 ≈ 0.1 + 差值 × 0.011 + 冠军数 × 0.03，'
      + '对方战绩差再 +0.16。',
      '你的薪水、能招到什么水平的教练，看的也是它。',
    ],
  },
  {
    key: 'club',
    title: '俱乐部声望',
    lede: '俱乐部自己的名气，和经理声望是两个数。'
      + '只有<b>商务活动和俱乐部活动带来的粉丝</b>能涨它，每个粉丝 +0.05；成绩不直接涨。',
    up: [
      { t: '粉丝见面会', d: '涨粉 3~6，选手也喜欢，钱少。' },
      { t: '校园行', d: '涨粉 4~8，钱最少。' },
      { t: '品牌活动', d: '钱最多，涨粉 1~3，最耗选手。' },
      { t: '俱乐部活动', d: '涨粉再乘出席率：0.35 +（声望 − 55）× 0.018，名气小时办活动收效差。' },
    ],
    use: [
      '赞助保底的锚：一级联赛 32 万 / 次级 7.2 万，再乘 (1 + 声望 ÷ 160)。',
      '赞助栏位：5 个起，声望到 65、70、80 各多一个，最多 8 个。',
      '商务邀约的频率：0.07 +（声望 − 50）× 0.004，最低 4% 最高 20%。出场费也乘 (0.6 + 声望 ÷ 100)。',
      '找赞助时对方答应的概率：0.32 +（声望 − 55）× 0.012 + 冠军数 × 0.03。',
    ],
  },
  {
    key: 'sponsor',
    title: '赞助合同好坏怎么看',
    lede: '一份赞助分三部分：保底、名次奖金、附加条件。'
      + '<b>条件越多，保底越高</b>：两个条件 ×1.25，一个 ×1.0，没有 ×0.8。',
    up: [
      { t: '保底', d: '俱乐部声望的基准 × 0.55~1.0 × 你的商务技能 × 条件系数，同一声望两次谈的数字可以差近一倍。' },
      { t: '名次奖金', d: '基准 × 0.2~0.5，要求赛段进前 2~6 名，一个赛季只发一次。' },
    ],
    down: [
      { t: '条件是真的会查的', d: '赛季末结算，任何一条没做到，<b>合同当场终止</b>。' },
      { t: '每赛季至少 3 次商务活动', d: '整个赛季的商务场次少于 3 就算违约。' },
      { t: '至少一名选手签直播', d: '赛季末队里没有人有直播合同就算违约。' },
      { t: '赛段排名进前 N', d: '看的是本赛季最好的一次赛区赛段名次。' },
      { t: '同行业独家', d: '同时持有两家同行业的赞助，两边都可能违约。签之前先看行业栏。' },
    ],
    use: [
      '能稳定做到的条件就接，做不到的宁可要低保底；被终止的合同收益是零，还占一个赛季的栏位。',
      '方案摆三周不答复会自动作废。',
    ],
  },
]

export default function Rules({ raised = false }: { raised?: boolean }) {
  // the rulebook of the career on screen — a save from before the draws
  // keeps the classic flow, so its rules page must say so; with no career
  // loaded yet, the one new careers get
  const ctx = useContext(GameCtx)
  const drawn = ctx ? drawRules(ctx.game) : currentRuleset() === 'vct-2026'
  const SECTIONS = useMemo(() => buildSections(drawn), [drawn])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(SECTIONS[0].key)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const s = SECTIONS.find((x) => x.key === tab) ?? SECTIONS[0]

  return (
    <>
      <button
        className={`support-fab rules-fab${open ? ' on' : ''}${raised ? ' raised' : ''}`}
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        title="忠诚、默契、信任、声望、赞助是怎么算的"
      >
        <span className="ico" aria-hidden="true">📖</span>
        <span className="lbl">机制说明</span>
      </button>

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card rules-card" role="dialog" aria-label="机制说明">
            <div className="support-head">
              <h3>这些数字是怎么来的</h3>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="tiny faint" style={{ margin: 0, lineHeight: 1.7 }}>
              这里写的是引擎里实际使用的规则和系数。
            </p>

            <div className="seg wrap">
              {SECTIONS.map((x) => (
                <button key={x.key} className={tab === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
                  {x.title}
                </button>
              ))}
            </div>

            <div className="rules-body">
              <p className="small muted"><Rich text={s.lede} /></p>
              {s.up && (
                <>
                  <h4 className="rules-h up">往上走</h4>
                  <ul className="rules-list">
                    {s.up.map((l, i) => <li key={i}><b>{l.t}</b><Rich text={l.d} /></li>)}
                  </ul>
                </>
              )}
              {s.down && (
                <>
                  <h4 className="rules-h down">往下走</h4>
                  <ul className="rules-list">
                    {s.down.map((l, i) => <li key={i}><b>{l.t}</b><Rich text={l.d} /></li>)}
                  </ul>
                </>
              )}
              <h4 className="rules-h">{s.useTitle ?? '它影响什么'}</h4>
              <ul className="rules-list plain">
                {s.use.map((l, i) => <li key={i}><Rich text={l} /></li>)}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  )
}
