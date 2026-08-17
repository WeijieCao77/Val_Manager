import { useGame } from './ctx'
import { Panel } from './common'
import { actionsLeft, actionsForTurn, cycleDays } from '../engine/actions'

/**
 * The first turn, played rather than described.
 *
 * The page tour explains what each screen is; it does not teach anyone how to
 * play. This is a checklist that reads real game state — it ticks when you have
 * actually done the thing, not when you have clicked "next" — and each step
 * says why it matters, which is the part a tour cannot carry.
 *
 * It disappears on its own once the first turn is complete.
 */

const KEY = 'valmgr.firstturn'

export function firstTurnDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

function finish(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch { /* private mode */ }
}

export default function FirstTurn({ onDone }: { onDone: () => void }) {
  const { game, go } = useGame()
  const me = game.teams[game.myTeam]
  if (!me) return null

  const focused = Object.entries(game.training)
    .filter(([id, v]) => me.roster.includes(id) && v !== 'rest').length
  const drillSet = !!game.drill && game.drill.kind !== 'none'
  const spent = actionsForTurn(game) - actionsLeft(game)
  const advanced = game.day > 0

  const steps = [
    {
      done: me.starters.length === 5,
      title: '排出首发五人',
      why: '首发阵容决定谁上场，也决定位置搭配——缺控场或哨卫会在每一回合被扣分。'
        + '「自动首发」能一键排出当前最优解，但你多半能排得更好。',
      go: 'squad',
    },
    {
      done: focused > 0,
      title: '给选手设定训练重点',
      why: `已设 ${focused} 人。不设就是休息（只恢复体能）。年轻选手成长最快，`
        + '而能力接近潜力上限的人练不动了——先练有成长空间的那几个。',
      go: 'training',
    },
    {
      done: drillSet,
      title: '安排一项团队训练',
      why: '跑图 / 教练复盘 / 练新英雄三选一，双排练可以并行。团队训练和个人专项'
        + '同时生效，按周结算。地图熟练度直接影响 BP 和胜负。',
      go: 'training',
    },
    {
      done: spent > 0,
      title: '花掉至少 1 点行动力',
      why: `本回合 ${actionsForTurn(game)} 点，已用 ${spent}。去转会页问价、去商务页接活动、`
        + '或在总览约一场训练赛——对外的事才花点数，调阵容和战术不花。',
      go: 'transfers',
    },
    {
      done: advanced,
      title: `推进${cycleDays(game) > 1 ? ` ${cycleDays(game)} 天` : '一天'}`,
      why: '总览上那条红色的大按钮。推进完会弹出这段时间发生了什么——'
        + '比赛、转会答复、伤病、更衣室变化都在里面。',
      go: 'dashboard',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const all = doneCount === steps.length

  return (
    <Panel
      title={all ? '新手任务完成 ✅' : `新手任务 · ${doneCount}/${steps.length}`}
      className={all ? 'own' : 'alert'}
      actions={
        <button className="sm ghost" onClick={() => { finish(); onDone() }}>
          {all ? '收起' : '不用了，我自己摸索'}
        </button>
      }
    >
      {all ? (
        <p className="small" style={{ margin: 0, lineHeight: 1.8 }}>
          一个回合就是这样：<b>看待办 → 安排训练 → 花掉行动力 → 推进</b>。
          之后每回合重复这套，同时盯住三件事——<b>董事会目标</b>（达不到会下课）、
          <b>选手体能与信任</b>（压榨会反噬）、<b>转会窗口</b>（只在窗口期能买卖）。
          比赛输了记得看「为什么是这个结果」，它会告诉你该练地图还是该补人。
        </p>
      ) : (
        <div className="agenda">
          {steps.map((s) => (
            <button
              key={s.title}
              className={`agenda-item ${s.done ? 'info' : 'todo'}`}
              onClick={() => go(s.go)}
            >
              <span className="dot" style={s.done ? { background: 'var(--win)' } : undefined} />
              <span>
                <b style={s.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                  {s.done ? '✓ ' : ''}{s.title}
                </b>
                <div className="tiny faint" style={{ marginTop: 3, lineHeight: 1.7 }}>{s.why}</div>
              </span>
              {!s.done && <span className="tiny faint right">前往 ›</span>}
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}
