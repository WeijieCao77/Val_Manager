/**
 * 暂停时的两队阵容板。
 *
 * 「暂停的时候也要能看到双方的英雄阵容，不然暂停的时候不好调整」——在这之前
 * 暂停面板只有三个打法按钮和四根滑杆，管理者看不见自己排了什么、更看不见对面
 * 排了什么，于是那几个按钮只能靠猜。
 *
 * 两侧各一行五个英雄，下面一条打法风格读数（快攻 / 消耗 / 控制），最后一句话
 * 说清楚这一局的克制关系往哪边倒。风格用的是 engine/comp.ts 的三角，跟比赛里
 * 真正在算的是同一套数。
 *
 * 颜色只是辅助：每一段都带文字百分比，克制那句话也是文字，不靠颜色单独表意。
 */
import { AgentIcon, OvrBadge } from './common'
import { agentCn } from '../engine/content'
import { STYLE_CN } from '../engine/comp'
import type { StyleMix } from '../engine/comp'
import type { Lineup } from '../engine/match'

/** 三角三个角用位置色板里语义最近的三个，深浅两套主题都已经调好。 */
const AXIS_COLOR = ['var(--duelist)', 'var(--initiator)', 'var(--controller)']

function MixBar({ mix }: { mix: StyleMix }) {
  return (
    <div className="mixbar" role="img"
      aria-label={STYLE_CN.map((n, i) => `${n} ${Math.round(mix[i] * 100)}%`).join('，')}>
      {mix.map((v, i) => (
        <i key={i} style={{ width: `${v * 100}%`, background: AXIS_COLOR[i] }} />
      ))}
    </div>
  )
}

function Side({ lineup, label, mine }: { lineup: Lineup; label: string; mine: boolean }) {
  const top = lineup.mix.indexOf(Math.max(...lineup.mix))
  return (
    <div className={`compside${mine ? ' is-mine' : ''}`}>
      <div className="compside-head">
        <span className="compside-tag">{label}</span>
        <b className="compside-name">{lineup.team.name}</b>
        <span className="compside-style" style={{ color: AXIS_COLOR[top] }}>
          {lineup.mixName}
        </span>
      </div>
      <ul className="compfive">
        {lineup.players.map((p) => {
          const a = lineup.agents[p.id]
          return (
            <li key={p.id}>
              {a ? <AgentIcon name={a} size={30} /> : <span className="compfive-blank" />}
              <span className="compfive-ign">{p.ign}</span>
              <span className="compfive-agent">{a ? agentCn(a) : '—'}</span>
              <OvrBadge value={p.overall} />
            </li>
          )
        })}
      </ul>
      <MixBar mix={lineup.mix} />
      <div className="compside-nums">
        {STYLE_CN.map((n, i) => (
          <span key={n}>
            <i style={{ background: AXIS_COLOR[i] }} />{n} {Math.round(lineup.mix[i] * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * 一句话说清这一局的克制往哪边倒。
 *
 * 读的是引擎算出来的克制项本身，不是重新推一遍——面板上写的和比赛里算的必须
 * 是同一个数，否则管理者照着面板调整会调反。
 */
function Verdict({ mine, theirs }: { mine: Lineup; theirs: Lineup }) {
  const c = mine.edge.counter ?? 0
  const m = mine.edge.mapFit ?? 0
  const v = mine.edge.version ?? 0
  const bits: string[] = []
  if (Math.abs(c) >= 0.15) {
    bits.push(c > 0
      ? `你的${mine.mixName}打他们的${theirs.mixName}占便宜`
      : `你的${mine.mixName}被他们的${theirs.mixName}克制`)
  }
  if (Math.abs(m) >= 0.15) bits.push(m > 0 ? '这张图适合你们的打法' : '这张图不太吃你们这套')
  if (Math.abs(v) >= 0.15) bits.push(v > 0 ? '阵容跟着版本走' : '阵容有点逆版本')
  if (!bits.length) {
    return (
      <p className="compverdict is-flat">
        两边阵容都比较均衡，谁也不克谁——打法就按自己的强项来。
      </p>
    )
  }
  const good = c + m + v >= 0
  return (
    <p className={`compverdict${good ? ' is-good' : ' is-bad'}`}>
      {bits.join('；')}。
      <span className="tiny faint">
        {' '}{good ? '顺着打' : '需要用暂停把节奏拽回来'}
      </span>
    </p>
  )
}

export function CompBoard({ mine, theirs }: { mine: Lineup; theirs: Lineup }) {
  return (
    <div className="compboard">
      <div className="compboard-grid">
        <Side lineup={mine} label="我方" mine />
        <Side lineup={theirs} label="对手" mine={false} />
      </div>
      <Verdict mine={mine} theirs={theirs} />
    </div>
  )
}
