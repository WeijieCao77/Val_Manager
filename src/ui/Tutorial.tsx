import { useEffect, useState } from 'react'
import { useGame } from './ctx'
import type { GameState } from '../engine/types'
import { TUTORIAL_SNAPSHOT } from '../engine/save'

/**
 * A guided trial day, played in a sandbox.
 *
 * Describing eight screens teaches nobody to play. This walks the manager
 * through one turn for real — spotlighting the control to use, greying out
 * everything else, and waiting until they have actually done it — then rolls
 * the whole thing back, so the trial day costs nothing.
 *
 * Steps that only need explaining (standings, finances) say their piece and
 * move on. Steps that need doing (training, transfers) wait for the doing.
 */

const KEY = 'valmgr.tutorial'

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

function markSeen(): void {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}

interface Step {
  screen?: string
  /** true when the manager must click their own way here */
  navigate?: boolean
  /** CSS selector for the one thing that stays clickable */
  spot?: string
  title: string
  body: string
  /** when set, the step waits for this to become true instead of showing 下一步 */
  done?: (g: GameState) => boolean
  hint?: string
}

const STEPS: Step[] = [
  {
    title: '你是一支 VALORANT 战队的经理',
    body: '你不打比赛。你决定谁上场、练什么、买谁、接哪些商务——然后推进时间，看结果。\n\n'
      + '⚡ 每回合有几点行动力，对外的事（报价、商务、约战）花点数，队内设置不花。\n'
      + '📅 赛季中一天一回合，空档期一周一回合。\n'
      + '🏛 董事会给你赛段目标，达不到会先警告、再下课。',
  },
  {
    title: '下面用一天试一遍',
    body: '接下来这一天是**模拟的**（12 月 31 日），你做的任何事结束后都会撤销，'
      + '不会影响正式存档。跟着高亮走就行。',
  },
  {
    screen: 'dashboard', spot: '.advance-bar',
    title: '总览：每天从这里开始',
    body: '最上面是待办，这条红色的大按钮是推动时间往前的地方。先别按，我们先去干活。',
  },
  {
    screen: 'squad', navigate: true, spot: '.nav-item[data-key="squad"]',
    title: '阵容：先看看你的人',
    body: '点开阵容页。这里排首发五人、看能力与合同，下面还有「更衣室」——每两名选手之间的关系。',
  },
  {
    screen: 'training', navigate: true, spot: '.nav-item[data-key="training"]',
    title: '训练：现在真的排一次',
    body: '点开训练页。',
  },
  {
    screen: 'training', spot: '.drill-group',
    title: '选一项团队训练',
    body: '跑图 / 教练复盘 / 练新英雄三选一（双排练可以并行）。'
      + '随便选一个——比如「跑图」挑一张熟练度低的图。',
    done: (g) => !!g.drill && g.drill.kind !== 'none',
    hint: '选好了会自动继续',
  },
  {
    screen: 'training', spot: '[data-tut="focus"]',
    title: '再给一名选手定个训练重点',
    body: '下面的「训练计划」表里，任意一名选手的「训练重点」下拉框选一个能力项。'
      + '不设就是休息，只恢复体能。',
    done: (g) => Object.entries(g.training).some(
      ([id, v]) => v !== 'rest' && g.teams[g.myTeam]?.roster.includes(id),
    ),
    hint: '设好任意一人即可继续',
  },
  {
    screen: 'transfers', navigate: true, spot: '.nav-item[data-key="transfers"]',
    title: '转会：想要的人多半不在市场上',
    body: '点开转会页。「自由人」和「挂牌」是已经在市场上的；'
      + '真正想要的人要用下面的「问价」按俱乐部去打听。',
  },
  {
    screen: 'transfers', spot: '[data-tut="enquire"]',
    title: '试着问一个人的价',
    body: '在「问价」面板里选一支俱乐部，再对他们的某名选手点「问价」。'
      + '花 1 点行动力、不花钱，几天后告诉你对方俱乐部的真实要价，和选手本人愿不愿意来。',
    done: (g) => (g.enquiries ?? []).length > 0,
    hint: '问完任意一人即可继续',
  },
  {
    screen: 'standings', navigate: true, spot: '.nav-item[data-key="standings"]',
    title: '积分榜：董事会看的就是这个',
    body: '你的赛段目标是按这里的排名算的。达不到会先警告，连续达不到就下课。',
  },
  {
    screen: 'finance', navigate: true, spot: '.nav-item[data-key="finance"]',
    title: '财务：钱从哪来到哪去',
    body: '赞助与奖金是收入，薪资是支出。缺钱时去「商务」页接活动或谈赞助——'
      + '代价是选手的时间。',
  },
  {
    screen: 'dashboard', spot: '.advance-bar',
    title: '最后：推进，结束这一天',
    body: '按下红色的「推进 一天」。推进完会弹出这一天发生了什么——'
      + '正式开局后，这就是你每个回合的收尾动作。',
    done: (g) => g.day >= 0,
    hint: '按下推进即可完成',
  },
]

export default function Tutorial({
  screen, go, onDone,
}: { screen: string; go: (s: string) => void; onDone: () => void }) {
  const { game, commit } = useGame()
  const [i, setI] = useState(0)
  // the sandbox: everything done during the trial day is rolled back
  const [snapshot] = useState(() => JSON.stringify(game))
  // Rewind to 31 December for real. Labelling 1 January as the trial day while
  // the clock and the advance button both said otherwise was simply untrue.
  useEffect(() => {
    // The rollback used to live only in this component's memory, while the
    // sandbox itself was committed to the autosave immediately. Close the tab
    // mid-tutorial — a phone reclaiming the page is enough — and the save was
    // stranded at day -1 for good. Park the pre-tutorial state on disk first;
    // loadGame puts it back if we never reach finish().
    try { localStorage.setItem(TUTORIAL_SNAPSHOT, snapshot) } catch { /* best effort */ }
    game.tutorialDay = true
    game.day = -1
    // Rewinding the clock made everyone look injured: injuredUntil defaults to
    // 0, and 0 > -1 reads as "out until day 0". That emptied the healthy-player
    // lists, so the pair-drill and agent-learning controls disappeared.
    for (const p of Object.values(game.players)) {
      if (p.injuredUntil > game.day) p.injuredUntil = game.day
    }
    // and a plan confirmed in an earlier session left the panel greyed out
    game.drillLock = undefined
    commit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const step = STEPS[i]

  // Steps that teach navigation wait for the manager to click the tab
  // themselves; the rest are put on the right screen for them.
  const arrived = !step.navigate || screen === step.screen
  useEffect(() => {
    if (!step.navigate && step.screen && screen !== step.screen) go(step.screen)
  }, [i, step.navigate, step.screen, screen, go])

  useEffect(() => {
    if (step.navigate && arrived) {
      const t = window.setTimeout(() => setI((x) => Math.min(x + 1, STEPS.length - 1)), 500)
      return () => window.clearTimeout(t)
    }
  }, [arrived, step.navigate, i])

  // spotlight the one control that stays live
  useEffect(() => {
    const lit: Element[] = []
    if (step.spot) {
      for (const el of document.querySelectorAll(step.spot)) {
        el.classList.add('tut-lit')
        lit.push(el)
      }
      // the target is often below the fold — bring it into view, or the
      // manager is told to click something they cannot see
      lit[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    return () => { for (const el of lit) el.classList.remove('tut-lit') }
  }, [i, step.spot, screen])

  // steps that wait for a real action advance themselves
  const satisfied = step.done ? step.done(game) : false
  useEffect(() => {
    if (step.done && satisfied) {
      const t = window.setTimeout(() => setI((x) => Math.min(x + 1, STEPS.length - 1)), 450)
      return () => window.clearTimeout(t)
    }
  }, [satisfied, step.done, i])

  const finish = () => {
    // restore the save exactly as it was before the trial day
    const before = JSON.parse(snapshot) as GameState
    delete (before as { tutorialDay?: boolean }).tutorialDay
    const live = game as unknown as Record<string, unknown>
    for (const k of Object.keys(live)) delete live[k]
    Object.assign(game, before)
    try { localStorage.removeItem(TUTORIAL_SNAPSHOT) } catch { /* best effort */ }
    markSeen()
    commit()
    go('dashboard')
    onDone()
  }

  const last = i === STEPS.length - 1
  const canNext = (!step.done || satisfied) && arrived

  return (
    <div className={`tut-bg${step.spot ? ' gated' : ''}`}>
      <div className={`tut-card${step.spot ? ' side' : ''}`}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="tiny faint">{i + 1} / {STEPS.length}</span>
          {i >= 2 && <span className="tag">模拟中 · 12月31日</span>}
        </div>
        <h3 style={{ margin: '8px 0 10px' }}>{step.title}</h3>
        <p className="small" style={{ lineHeight: 1.85, margin: '0 0 14px', whiteSpace: 'pre-line' }}>
          {/* the copy uses **bold**; render it rather than printing the stars */}
          {step.body.split(/\*\*(.+?)\*\*/g).map((part, k) =>
            k % 2 ? <b key={k}>{part}</b> : part)}
        </p>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {step.navigate && !arrived ? (
            <span className="tiny" style={{ color: 'var(--warn)' }}>⤷ 点击左侧高亮的标签</span>
          ) : step.done && !satisfied ? (
            <span className="tiny" style={{ color: 'var(--warn)' }}>
              ⤷ {step.hint ?? '按提示操作后自动继续'}
            </span>
          ) : last ? (
            <button className="primary sm" onClick={finish}>完成，开始正式的第一天</button>
          ) : (
            <button className="primary sm" disabled={!canNext}
              onClick={() => setI(i + 1)}>下一步</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="sm ghost" onClick={finish}>跳过引导</button>
        </div>
      </div>
    </div>
  )
}
