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
    date: '2026-08-29',
    title: '存档与记录的三个修复',
    changes: [
      { kind: '修复', text: '在这次更新之前就开好的存档，读取时会误判成「队里没有一个是你接手时的人」——所以「大换血」第一天就解锁了，而「一起走到最后」反而永远拿不到。现在读档时会把接手时的阵容补回来。已经误解锁的那条不会被撤销。' },
      { kind: '修复', text: '没有创建账号的玩家，成就和结局虽然记下来了却一直显示 0——写进去和读出来用的不是同一个地方。现在能正常显示了，之前打出来的结局也会一并出现，不用重打。' },
      { kind: '修复', text: '同时开着两个游戏标签页时，停在早期进度的那一页会把新进度覆盖掉（有人因此从 2036 退回 2032）。现在落后的那一页会拒绝写入，并在页面顶部提示你关掉多余的标签页。' },
      { kind: '修复', text: '自动存档失败时原来只弹一次提示、很容易错过。现在改成一直挂在顶部的横幅，直到能正常保存为止。' },
      { kind: '修复', text: '新建生涯的页面没有返回首页的入口。' },
    ],
  },
  {
    date: '2026-08-29',
    title: '开瓦包：概率公示与调整',
    changes: [
      { kind: '新增', text: '「概率」页：每种卡包各稀有度的概率都公示了，而且是实测值——页面现开三万包统计出来的，不是抄的配置表，所以它永远等于你真正抽到的东西。' },
      { kind: '调整', text: '金卡概率略微下调（试训包 5.5%→4.9%，选拔包 11.3%→9.7%，教练包 15.0%→12.1%，按每张卡计）。' },
      { kind: '调整', text: '彩卡变得更稀有：试训包从约 458 包一张调整为约 1130 包一张。主要靠把彩卡保底从 500 抽提高到 1200 抽——这一条才是决定彩卡稀有度的关键，只改基础值几乎没有效果。' },
      { kind: '修复', text: '手机上收藏页的筛选条（全部/彩卡/金卡…）超出屏幕后划不动，最右边的「有重复」根本点不到。所有同类的分段控件都一起修了。' },
    ],
  },
  {
    date: '2026-08-28',
    title: '主页、账号、结局与成就',
    changes: [
      { kind: '新增', text: '有主页了：VCT电竞经理和开瓦包放在一起，经理搬到 /manager，老链接照样能进。' },
      { kind: '新增', text: '两个游戏共用一个账号 ID。成就、结局和卡牌收藏都记在它上面，换手机把 ID 填进去就能带走。ID 相当于密码，页面上默认打码，不要发给别人。' },
      { kind: '新增', text: '生涯打到 2036 年正式结束，按这十年做了什么给两个结局：王朝线看你拿了什么，故事线看这十年怎么过的，一共 22 种。' },
      { kind: '新增', text: '43 项成就，分「局内」和「生涯累计」两类。首冠、全冠之年、13:0、把新人练出来、轮换 15 人、走遍四大赛区等等。解锁的时候左下角会弹一张卡；同一回合解锁多个会排队，不会互相盖掉。' },
      { kind: '新增', text: '首页右上角可以创建或找回账号 ID，经理的「成就」页里也能改。以前只有开瓦包能发号，只玩经理的人根本拿不到。' },
      { kind: '新增', text: '又找了 121 名真实选手补进自由市场，玩到后期不会再没人可签。' },
      { kind: '修复', text: '「登顶」以前拿个大师赛就算，现在严格区分大师赛和冠军赛——冠军赛相关的结局之前其实一个都触发不了。' },
      { kind: '修复', text: '有六项成就在你还没做任何事的时候就已经算达成了（比如换个俱乐部就送「大换血」、开局阵容没外援就送「全本土」），现在都得真的做到。' },
      { kind: '修复', text: '「草根」结局按它自己的说法反而拿不到——升上 VCT 之后系统就忘了你是从次级联赛起步的。' },
      { kind: '修复', text: '跨存档累计的成就（五十冠、走遍四大赛区等）以前要等下一个成就解锁时才会被想起来。' },
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
