/**
 * What changed, in the words of someone playing it.
 *
 * Not a commit log. Every line here is something a player can see happen in
 * front of them, written from their side of the screen — a fix says what was
 * going wrong, not which function was wrong. Anything that only mattered to
 * the code does not belong in this file at all.
 *
 * Newest first. `kind` colours the line: 新增 is a thing that was not there
 * before, 调整 changes how something already works, 修复 is a bug the group
 * ran into — and most of these were reported there, which is worth showing.
 */
export type ChangeKind = '新增' | '调整' | '修复'

export interface ChangeEntry {
  /** YYYY-MM-DD, as it will be shown */
  date: string
  title: string
  changes: { kind: ChangeKind; text: string }[]
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-08-28',
    title: '主页、账号、结局与成就',
    changes: [
      { kind: '新增', text: '有主页了：VCT电竞经理和开瓦包放在一起，经理搬到 /manager，老链接照样能进。' },
      { kind: '新增', text: '两个游戏共用一个账号 ID。成就、结局和卡牌收藏都记在它上面，换手机把 ID 填进去就能带走。ID 相当于密码，页面上默认打码，不要发给别人。' },
      { kind: '新增', text: '生涯打到 2036 年正式结束，按这十年做了什么给两个结局：王朝线看你拿了什么，故事线看这十年怎么过的，一共 22 种。' },
      { kind: '新增', text: '43 项成就，分「局内」和「生涯累计」两类。首冠、全冠之年、13:0、把新人练到 90、轮换 15 人、走遍四大赛区等等。' },
      { kind: '新增', text: '又找了 121 名真实选手补进自由市场，玩到后期不会再没人可签。' },
      { kind: '修复', text: '「登顶」以前拿个大师赛就算，现在严格区分大师赛和冠军赛。' },
    ],
  },
  {
    date: '2026-08-28',
    title: '地图 BP、英雄选择与数据',
    changes: [
      { kind: '新增', text: '赛前可以自己和 AI 做地图 BP，也可以给每名选手选英雄。不想管就跳过，默认用这张图最常见的组合，而且只会交给打得来这个位置的人。' },
      { kind: '新增', text: '数据统计里像 vlr 一样显示英雄，可以看 all maps 和单张地图。' },
      { kind: '新增', text: '每支战队都有了队标。' },
      { kind: '调整', text: '所有地图改成中文名。' },
      { kind: '调整', text: '训练赛现在会提升打的那张图的熟练度，收益也在界面上标出来了。' },
      { kind: '修复', text: '一场比赛里两名选手可能选到同一个英雄。' },
      { kind: '修复', text: '在自己擅长的位置里换英雄不再有那个消不掉的减益——只要位置对就行。' },
      { kind: '修复', text: 'VLG 的队标和缩写（之前写成 VNLG）。' },
    ],
  },
  {
    date: '2026-08-28',
    title: '转会与商务',
    changes: [
      { kind: '新增', text: '问价的地方可以按位置找人。' },
      { kind: '修复', text: '商务邀约会出现负天数。' },
    ],
  },
  {
    date: '2026-08-27',
    title: '开瓦包（抽卡模式）',
    changes: [
      { kind: '调整', text: '体力按小时恢复，关掉页面的时候也在恢复。' },
      { kind: '调整', text: '每日任务和签到连续天数改由服务器的日期结算，跨零点不会再算错。' },
      { kind: '修复', text: '体力扣到 0 之后再也回不来。' },
      { kind: '修复', text: '手机上打完比赛就切后台，偶尔会丢掉刚开出来的卡。' },
    ],
  },
  {
    date: '2026-08-26',
    title: '手机端与一轮机制排查',
    changes: [
      { kind: '调整', text: '把每个界面都在手机上过了一遍，修了一批排版和滑动的问题。' },
      { kind: '修复', text: '一轮全面的机制排查，修掉了包括赛季滚动、合同到期、伤病恢复在内的一批问题。' },
    ],
  },
]

/** The newest entry's date, used to badge the button when it is new to you. */
export const LATEST = CHANGELOG[0]?.date ?? ''
