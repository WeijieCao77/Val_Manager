import { useEffect, useState } from 'react'

/**
 * The first-run walkthrough.
 *
 * Points at one nav item at a time and says what that screen is for, because
 * the sidebar is eight words with no explanation and a new manager has no way
 * to know that 商务 is where the money is or that 战术 no longer holds the
 * sliders. Runs once, skippable at any point, and re-openable from 存档.
 */

export interface TourStep {
  /** nav key to highlight, or null for a centred message */
  target: string | null
  title: string
  body: string
}

export const TOUR: TourStep[] = [
  {
    target: null,
    title: '欢迎接手球队',
    body: '花一分钟认识一下界面。我会一页一页点亮左边的标签，你点进去，我再告诉你这一页是干什么的。随时可以跳过。',
  },
  {
    target: 'dashboard',
    title: '总览 · 每天从这里开始',
    body: '最上面是今天的待办，下面是下一场比赛、今天已经做了什么、以及五名首发谁出了问题。看完这一页就知道今天该干什么。',
  },
  {
    target: 'squad',
    title: '阵容 · 你的人',
    body: '设置首发五人、查看能力与合同。下面的「更衣室」是每两名选手之间的关系——老搭档天然更默契，卖人会伤到跟他要好的队友。',
  },
  {
    target: 'tactics',
    title: '战术 · 地图与阵容评估',
    body: '这里看地图熟练度和当前阵容的攻防评估。注意：四条战术滑杆不在这里调，而是在每场比赛开始前，观战时叫暂停也能改。',
  },
  {
    target: 'training',
    title: '训练 · 变强的地方',
    body: '每人一个训练重点（随时可改），外加每周一项团队训练（确定后锁定一周）。设施升级和聘请教练组也在这一页。',
  },
  {
    target: 'transfers',
    title: '转会 · 只在窗口期开放',
    body: '买人、卖人、答复别人的报价。窗口关闭时这一页会锁上——赛季中途不能随意交易，和真实赛事一样。',
  },
  {
    target: 'commercial',
    title: '商务 · 不靠成绩的钱',
    body: '接邀约、自己去谈赞助、办俱乐部活动、给选手签直播合同。代价永远是选手的时间：出席一天，这一周的训练收益就少四分之一。',
  },
  {
    target: 'finance',
    title: '财务 · 钱去哪了',
    body: '赞助、奖金、薪资、违约金的流水都在这里。薪资总额超过收入时董事会会不高兴。',
  },
  {
    target: 'schedule',
    title: '赛程 · 什么时候打谁',
    body: '完整赛程在这里，打完的比赛点开就能看逐回合数据和记分板，训练赛也一样。',
  },
  {
    target: 'standings',
    title: '积分榜 · 你排第几',
    body: '当前分区的排名。董事会的赛段目标就是按这个排名算的，达不到会先警告、再下课。',
  },
  {
    target: 'career',
    title: '经理 · 你自己',
    body: '你的声望、天赋、荣誉和合同都在这一页。还可以主动向别的球队投执教申请——不必干等着别人来挖你，也可以跟现在的董事会谈涨薪。',
  },
  {
    target: null,
    title: '最后一件事：行动力',
    body: '右上角的 ⚡ 是每天 3 点行动力。报价、商务、约战、聘教练这些对外事务各花 1 点；调首发、改战术、安排训练不花点数。八件事里挑三件做——这就是这个游戏每天真正的取舍。',
  },
]

const KEY = 'valmgr.tour.done'

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* private mode — the tour simply runs again next time */
  }
}

/**
 * The walkthrough drives the real navigation rather than describing it.
 *
 * Reading about eight screens from the dashboard teaches nothing — you have to
 * have been there once. Each step therefore waits for the player to actually
 * click the tab it is pointing at, and only then explains what they are
 * looking at.
 */
export default function Tour({
  screen, onDone,
}: { screen: string; onDone: () => void }) {
  const [i, setI] = useState(0)
  const step = TOUR[i]
  // a step is 'arrived' once the player is standing on the screen it describes
  const arrived = !step.target || screen === step.target

  // move the spotlight onto whichever nav item this step is about
  useEffect(() => {
    for (const el of document.querySelectorAll('.nav-item')) {
      el.classList.toggle('tour-lit', el.getAttribute('data-key') === step.target)
    }
    return () => {
      for (const el of document.querySelectorAll('.nav-item')) el.classList.remove('tour-lit')
    }
  }, [step.target])

  const finish = () => { markTourSeen(); onDone() }

  // the description is for the screen you are on, so wait until you are on it
  const label = step.title.split(' · ')[0]

  return (
    <div className={`tour-bg${step.target ? ' pass-nav' : ''}`}>
      <div className={`tour-card${step.target ? ' anchored' : ''}`}>
        <div className="tiny faint">{i + 1} / {TOUR.length}</div>
        <h3 style={{ margin: '6px 0 8px' }}>{step.title}</h3>
        {arrived ? (
          <p className="small" style={{ lineHeight: 1.75, margin: '0 0 14px' }}>{step.body}</p>
        ) : (
          <p className="small" style={{ lineHeight: 1.75, margin: '0 0 14px' }}>
            点击左侧高亮的 <b style={{ color: 'var(--accent)' }}>{label}</b>，看看这一页长什么样。
          </p>
        )}
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {i > 0 && <button className="sm ghost" onClick={() => setI(i - 1)}>上一步</button>}
          {!arrived ? (
            <span className="tiny faint">等你点开这一页…</span>
          ) : i < TOUR.length - 1 ? (
            <button className="primary sm" onClick={() => setI(i + 1)}>下一步</button>
          ) : (
            <button className="primary sm" onClick={finish}>开始吧</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="sm ghost" onClick={finish}>跳过</button>
        </div>
      </div>
    </div>
  )
}
