import { useState } from 'react'
import { ask as askConfirm } from './confirm'
import { useGame } from './ctx'
import { Bar, money, Panel, Stat } from './common'
import { useAction } from './useAction'
import { logActivity } from '../engine/agenda'
import { ORIGINS, SKILL_CN, SKILL_HINT } from '../engine/manager'
import {
  applyForJob, defaultContract, managerSalaryFor, openness, renegotiate, takeAcceptedJob,
} from '../engine/career'
import { acceptJob } from '../engine/season'
import { WORLD_TEAMS } from '../engine/teams'
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
    if (!(await askConfirm(`确定离开 ${me?.name} 出任 ${name} 的经理？\n当前阵容、资金与赛段目标都会换成新俱乐部的。`))) return
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
            <span className="tag">{m.age} 岁</span>
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

        <Panel title="我的合同">
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <span className="tag">年薪 {money(contract.salary)}</span>
            <span className="tag">{contract.years} 年</span>
            <span className="tag">{contract.since} 年签订</span>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            以你的声望，这个位置的合理年薪约 <b>{money(fairHere)}</b>。
            涨薪要看董事会信任、你的冠军数，以及<b>有没有别的球队在挖你</b>——
            手上有邀请时最好谈。刚被警告过就别开口了。
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
          不必干等着别人来找。任何一支愿意接你电话的球队都可以投申请——
          <b>成绩不好的球队最容易点头</b>，一切顺利的球队反而最难进，因为没人要走。
          要价太高也会被拒。答复需要 3~10 天。
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
                    <td className="num mono">{t.reputation}</td>
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
          <div className="empty">目前没有球队会考虑你的申请，先做出成绩。</div>
        )}
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          共 {WORLD_TEAMS.length} 支球队，其中 {candidates.length} 支愿意考虑你。
        </p>
      </Panel>
    </>
  )
}
