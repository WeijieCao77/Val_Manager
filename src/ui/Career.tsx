import { useState } from 'react'
import { LIFE, LIFE_ACTS, doLifeAct, lifeBlock, lifeMod, managerAge, monthlyPay, setAutoMeal } from '../engine/managerLife'
import type { LifeAct } from '../engine/managerLife'
import { fromCareerDay } from '../engine/clock'
import { ask as askConfirm } from './confirm'
import { useGame } from './ctx'
import { Bar, money, Panel, Stat } from './common'
import { useAction } from './useAction'
import { logActivity } from '../engine/agenda'
import { ORIGINS, SKILL_CN, SKILL_HINT } from '../engine/manager'
import {
  applyForJob, defaultContract, managerSalaryFor, openness, renegotiate, takeAcceptedJob,
} from '../engine/career'
import { acceptJob, declineJob } from '../engine/season'
import type { Team } from '../engine/types'

/**
 * The manager's own career.
 *
 * Everything about you rather than about the squad: your standing, your deal,
 * who wants you, and — the part that was missing entirely — the clubs you can
 * go after yourself instead of waiting to be asked.
 */
export default function Career() {
  const { game, commit, toast } = useGame()
  const act = useAction()
  const m = game.manager
  const me = game.teams[game.myTeam]
  const [applyTo, setApplyTo] = useState<string | null>(null)
  const [ask, setAsk] = useState(0)
  const [years, setYears] = useState(2)
  const [renewAsk, setRenewAsk] = useState(0)

  if (!m) return <div className="empty">这个存档没有经理档案。</div>
  const origin = ORIGINS.find((o) => o.key === m.originKey)
  const contract = game.managerContract ?? defaultContract(game)
  const fairHere = managerSalaryFor(me, m.reputation)

  const offers = (game.jobOffers ?? []).filter((o) => o.expiresOn > game.day)
  const apps = game.jobApplications ?? []
  const won = apps.filter((a) => a.answer === 'accept')

  // every club, rated by whether they would even take the call
  const candidates = Object.values(game.teams)
    .filter((t) => t.id !== game.myTeam)
    .map((t) => ({ t, ...openness(game, t) }))
    .filter((x) => x.odds > 0)
    .sort((a, b) => b.t.reputation - a.t.reputation)

  const move = async (teamId: string, fn: () => string) => {
    const name = game.teams[teamId]?.name
    if (!(await askConfirm(`确定离开 ${me?.name}，出任 ${name} 的经理？\n阵容、资金和赛段目标都会换成新俱乐部的。`))) return
    toast(fn())
    commit()
  }

  return (
    <>
      <div className="grid c4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Panel><Stat k="经理声望" v={`${Math.round(m.reputation)}`} /></Panel>
        <Panel><Stat k="现执教" v={me?.name ?? '—'} /></Panel>
        <Panel><Stat k="年薪" v={money(contract.salary)} /></Panel>
        <Panel><Stat k="冠军" v={`${game.honours.length}`} /></Panel>
      </div>

      <div className="grid c2">
        <Panel title="个人档案">
          <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
            <b style={{ fontSize: 16 }}>{m.name}</b>
            <span className="tag" title={`开档时 ${m.age} 岁，每个赛季长一岁`}>{managerAge(game)} 岁</span>
            <span className="tag">{origin?.label}</span>
          </div>
          {(Object.keys(SKILL_CN) as (keyof typeof SKILL_CN)[]).map((k) => (
            <div key={k} className="row" style={{ gap: 8, marginBottom: 5 }}>
              <span className="small" style={{ width: 42 }}>{SKILL_CN[k]}</span>
              <Bar value={m.skills[k]} />
              <span className="mono tiny" style={{ width: 20 }}>{m.skills[k]}</span>
              <span className="tiny faint" style={{ flex: 1 }}>{SKILL_HINT[k]}</span>
            </div>
          ))}
          {game.honours.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny faint" style={{ marginBottom: 4 }}>荣誉</div>
              {game.honours.map((h, i) => (
                <div key={i} className="small">🏆 {h.year} · {h.title}</div>
              ))}
            </div>
          )}
        </Panel>

        <LifePanel />

        <Panel title="我的合同">
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <span className="tag">年薪 {money(contract.salary)}</span>
            <span className="tag">{contract.years} 年</span>
            <span className="tag">{contract.since} 年签订</span>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            以你的声望，这个位置的合理年薪约 <b>{money(fairHere)}</b>。
            手上有别队邀请时最好谈；刚被警告过就别开口。
          </p>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="number" className="sm" style={{ width: 110 }} step={10000}
              value={renewAsk || contract.salary}
              onChange={(e) => setRenewAsk(Number(e.target.value))}
            />
            <select className="sm" style={{ width: 70 }} value={years}
              onChange={(e) => setYears(Number(e.target.value))}>
              <option value={1}>1年</option><option value={2}>2年</option><option value={3}>3年</option>
            </select>
            <button className="primary sm" onClick={() => act('staff', () => {
              toast(renegotiate(game, renewAsk || contract.salary, years))
              logActivity(game, 'squad', '与董事会谈合同')
            })}>提出续约</button>
          </div>
        </Panel>
      </div>

      {(offers.length > 0 || won.length > 0) && (
        <Panel title="可以立刻上任的职位" className="alert">
          {offers.map((o) => {
            const t = game.teams[o.teamId]
            if (!t) return null
            return (
              <div key={o.id} className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <span className="tag t1">俱乐部主动邀请</span>
                <b>{t.name}</b>
                <span className="tiny faint" style={{ flex: 1 }}>
                  {o.pitch} · {o.expiresOn - game.day} 天内答复
                </span>
                <button className="sm ghost" onClick={() => { toast(declineJob(game, o.id)); commit() }}>
                  拒绝
                </button>
                <button className="primary sm" onClick={() => move(t.id, () => acceptJob(game, o.id))}>
                  接受
                </button>
              </div>
            )
          })}
          {won.map((a) => {
            const t = game.teams[a.teamId]
            if (!t) return null
            return (
              <div key={a.id} className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <span className="tag">你的申请已通过</span>
                <b>{t.name}</b>
                <span className="tiny faint" style={{ flex: 1 }}>
                  年薪 {money(a.salary)} · {a.years} 年
                </span>
                <button className="primary sm" onClick={() => move(t.id, () => takeAcceptedJob(game, a.id))}>
                  上任
                </button>
              </div>
            )
          })}
        </Panel>
      )}

      <Panel title="主动求职">
        <p className="small muted" style={{ marginTop: 0 }}>
          成绩差的球队最容易点头，要价太高会被拒。3~10 天内答复。
        </p>
        {applyTo && (() => {
          const t = game.teams[applyTo]
          if (!t) return null
          const fair = managerSalaryFor(t, m.reputation)
          return (
            <div className="panel own" style={{ marginBottom: 12 }}>
              <div className="panel-body">
                <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <b>{t.name}</b>
                  <span className="tiny faint">这个位置的合理年薪约 {money(fair)}</span>
                </div>
                <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <input type="number" className="sm" style={{ width: 110 }} step={10000}
                    value={ask || fair} onChange={(e) => setAsk(Number(e.target.value))} />
                  <select className="sm" style={{ width: 70 }} value={years}
                    onChange={(e) => setYears(Number(e.target.value))}>
                    <option value={1}>1年</option><option value={2}>2年</option><option value={3}>3年</option>
                  </select>
                  <button className="primary sm" onClick={() => act('staff', () => {
                    toast(applyForJob(game, t.id, ask || fair, years))
                    logActivity(game, 'squad', `向 ${t.name} 投递执教申请`)
                    setApplyTo(null); setAsk(0)
                  })}>提交申请</button>
                  <button className="sm ghost" onClick={() => { setApplyTo(null); setAsk(0) }}>取消</button>
                </div>
              </div>
            </div>
          )
        })()}

        <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>球队</th><th>赛区</th><th className="num">声望</th>
                <th className="num">合理年薪</th><th>机会</th><th />
              </tr>
            </thead>
            <tbody>
              {candidates.map(({ t, odds, note }) => {
                const pending = apps.find((a) => a.teamId === t.id && !a.answer)
                const rejected = apps.find((a) => a.teamId === t.id && a.answer === 'reject')
                return (
                  <tr key={t.id}>
                    <td>
                      <b>{t.name}</b>
                      {t.tier === 2 && <span className="tag" style={{ marginLeft: 5 }}>次级</span>}
                    </td>
                    <td className="small muted">{t.region}</td>
                    <td className="num mono">{Math.round(t.reputation)}</td>
                    <td className="num mono">{money(managerSalaryFor(t as Team, m.reputation))}</td>
                    <td className="small">
                      <span style={{
                        color: odds >= 0.35 ? 'var(--win)' : odds >= 0.18 ? 'var(--warn)' : 'var(--muted)',
                      }}>
                        {Math.round(odds * 100)}%
                      </span>
                      <span className="tiny faint"> · {note}</span>
                    </td>
                    <td>
                      {pending ? <span className="tiny faint">等待答复（{Math.max(0, pending.replyOn - game.day)} 天）</span>
                        : rejected ? <span className="tiny faint">已婉拒</span>
                        : <button className="sm" onClick={() => { setApplyTo(t.id); setAsk(0) }}>申请</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {candidates.length === 0 && (
          <div className="empty">目前没有球队会考虑你，先做出成绩。</div>
        )}
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          共 {Object.keys(game.teams).length} 支球队，其中 {candidates.length} 支愿意考虑你。
        </p>
      </Panel>
    </>
  )
}


/**
 * 经理生活: the wallet, the two numbers, and what to do about them.
 *
 * Salary lands here monthly (engine/managerLife.ts). 饱腹 and 心情 move
 * once per game day, never by the wall clock, and only nudge the
 * manager's own work within ±8% — the point is a person, not a chore. The
 * auto supply keeps 饱腹 up without a click a day, inside a monthly budget
 * the manager sets; a refusal costs nothing.
 */
function LifePanel() {
  const { game, commit, toast } = useGame()
  const l = game.life
  const [budget, setBudget] = useState(l?.auto.budget ?? 600)
  if (!l) return null
  const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
  const mod = lifeMod(game)
  const bar = (v: number) => (v >= 60 ? 'var(--win)' : v >= 30 ? 'var(--warn)' : 'var(--loss)')
  const run = (act: LifeAct) => {
    const r = doLifeAct(game, act)
    toast(r.text)
    if (r.ok) commit()
  }
  return (
    <Panel title="经理生活" actions={<span className="tiny faint">个人钱包和俱乐部资金分开记</span>}>
      <div className="grid c4" style={{ gap: 10, marginBottom: 10 }}>
        <div className="stat"><span className="k">个人余额</span><span className="v sm">{fmt(l.wallet)}</span></div>
        <div className="stat"><span className="k">月薪</span><span className="v sm">{fmt(monthlyPay(game))}</span></div>
        <div className="stat"><span className="k">生涯累计收入</span><span className="v sm">{fmt(game.tally?.earned ?? 0)}</span></div>
        <div className="stat"><span className="k">状态修正</span><span className="v sm">{mod >= 1 ? '+' : ''}{((mod - 1) * 100).toFixed(1)}%</span></div>
      </div>
      <div className="grid c2" style={{ gap: 10, marginBottom: 8 }}>
        <div>
          <div className="small muted">饱腹 <span className="tiny faint">100 是吃饱，每天 −{LIFE.HUNGER_PER_DAY}</span></div>
          <div className="row" style={{ gap: 8 }}><Bar value={l.hunger} color={bar(l.hunger)} /><span className="mono small">{Math.round(l.hunger)}</span></div>
        </div>
        <div>
          <div className="small muted">心情 <span className="tiny faint">每天 −{LIFE.MOOD_PER_DAY} 到 {LIFE.MOOD_FLOOR} 为止，饿着再 −{LIFE.HUNGRY_MOOD}</span></div>
          <div className="row" style={{ gap: 8 }}><Bar value={l.mood} color={bar(l.mood)} /><span className="mono small">{Math.round(l.mood)}</span></div>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        两个数只影响你自己的工作：本队训练收益和更衣室谈话的成功率，最多 ±{LIFE.MOD_MAX * 100}%。不影响选手能力，也不限制比赛。
      </p>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        {(Object.keys(LIFE_ACTS) as LifeAct[]).map((k) => {
          const a = LIFE_ACTS[k]
          const why = lifeBlock(game, k)
          return (
            <button key={k} className="sm" disabled={!!why} title={why ?? a.blurb} onClick={() => run(k)}>
              {a.label}{a.price ? ` $${a.price}` : ' 免费'}
              <span className="tiny faint"> {a.hunger ? `饱腹 +${a.hunger} ` : ''}{a.mood ? `心情 +${a.mood}` : ''}</span>
            </button>
          )
        })}
      </div>
      <div className="row wrap small" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span className="muted">自动补给（饱腹低于 {LIFE.AUTO_AT} 时自动买）：</span>
        <div className="seg">
          {([['null', '关'], ['cheap', '便饭'], ['good', '好好吃']] as const).map(([v, label]) => (
            <button key={v} className={(l.auto.meal ?? 'null') === v ? 'on' : ''}
              onClick={() => { setAutoMeal(game, v === 'null' ? null : v, budget); commit() }}>{label}</button>
          ))}
        </div>
        <span className="muted">每月预算 $</span>
        <input type="number" value={budget} min={0} step={50} style={{ width: 80 }}
          onChange={(e) => setBudget(Number(e.target.value))}
          onBlur={() => { setAutoMeal(game, l.auto.meal, budget); commit() }} />
        <span className="tiny faint">本月已用 ${l.auto.spent}；余额不够或预算用完会停，并在推进摘要里提醒。</span>
      </div>
      {l.ledger.length > 0 && (
        <details className="small">
          <summary className="muted">个人收支（最近 {Math.min(12, l.ledger.length)} 条）</summary>
          {l.ledger.slice(-12).reverse().map((x, i) => {
            const at = fromCareerDay(x.cd)
            return (
              <div key={i} className="row" style={{ gap: 8 }}>
                <span className="tiny faint mono" style={{ width: 70 }}>{at.year}/{at.day + 1}日</span>
                <span style={{ flex: 1 }}>{x.label}</span>
                <span className={`mono ${x.amount >= 0 ? 'pos' : 'neg'}`}>{x.amount >= 0 ? '+' : ''}{fmt(x.amount)}</span>
              </div>
            )
          })}
        </details>
      )}
    </Panel>
  )
}
