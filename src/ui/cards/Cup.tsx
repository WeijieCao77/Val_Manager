import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import {
  CUP_MAX_ROUNDS, CUP_MIN_ROUNDS, PACKS, STAMINA_COST, canPlay, cupBo, cupExitPrize, cupOpponent,
  cupRoundName, cupTitlePrize, levelOf, staminaNow,
} from '../../engine/gacha'
import type { CupOutcome, CupRegistration, PackKind } from '../../engine/gacha'
import type { ArenaResult } from '../../engine/arena'
import { cardById, cardName, squadRating } from '../../engine/cards'
import { CUP_TEAMS } from '../../engine/cupTeams'
import { track } from '../../engine/telemetry'
import OpenCup from './OpenCup'
import TeamCup from './TeamCup'

/**
 * The cup: one ticket, then play until you lose or lift it.
 *
 * Drawn and played on the server — the bracket depth, the clubs in it, the
 * seed of every map. What this screen does is show the draw and hand the
 * scoreboards back.
 */
export default function Cup() {
  const [mode, setMode] = useState<'club' | 'open' | 'team'>(() => {
    try { const m = localStorage.getItem('vm-cup-mode'); return m === 'open' || m === 'team' ? m : 'club' } catch { return 'club' }
  })
  const pick = (m: 'club' | 'open' | 'team') => {
    setMode(m)
    try { localStorage.setItem('vm-cup-mode', m) } catch { /* private window */ }
  }
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === 'club' ? 'on' : ''} onClick={() => pick('club')}>俱乐部杯</button>
        <button className={mode === 'open' ? 'on' : ''} onClick={() => pick('open')}>全服杯</button>
        <button className={mode === 'team' ? 'on' : ''} onClick={() => pick('team')}>组队杯</button>
      </div>
      {mode === 'club' ? <ClubCup /> : mode === 'open' ? <OpenCup /> : <TeamCup />}
    </>
  )
}

/**
 * The club cup: one ticket, a road of real clubs, two lives.
 */
function ClubCup() {
  const { g, now, act, toast, go } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ res: ArenaResult; opp: string; out: CupOutcome; levels: Record<string, number> } | null>(null)

  const filled = g.squad.slots.filter(Boolean).length
  const cup = g.cup
  const registration = cup?.registration
  const live = cup && !cup.done
  const rounds = cup?.path.length ?? 0
  const can = canPlay(g, 'cup', now)

  const enter = async () => {
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    setBusy(true)
    const r = await act('cup_enter')
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const drawn = (r.result as { cup?: { path: string[] } } | undefined)?.cup?.path.length ?? 0
    toast(`抽签完成：共 ${drawn} 轮双败，先打${cupRoundName(drawn, 0)}。`)
  }

  // The server fields this cup's registered five, even after inventory changes.
  const play = async () => {
    if (!cupOpponent(g) || !cup) return
    const round = cup.round
    setBusy(true)
    const r = await act('cup_play')
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const { res, opp, out, registration: played } = r.result as { res: ArenaResult; opp: string; out: CupOutcome; registration?: CupRegistration }
    const levels = played?.levels ?? Object.fromEntries([...g.squad.slots, g.squad.coach].filter((id): id is string => !!id).map(id => [id, levelOf(g, id)]))
    const rating = squadRating(played?.squad ?? g.squad, id => levels[id] ?? 0)
    track('card_match', { mode: 'cup', won: res.win, round, rating, title: !!out.won })
    setShown({ res, opp, out, levels })
  }

  const clear = async () => {
    const r = await act('cup_clear')
    if (!r.ok) toast(r.why)
    return r.ok
  }

  return (
    <>
      <Panel
        title="俱乐部杯"
        actions={<span className="tiny muted">入场 {STAMINA_COST.cup} 点体力 · 之后每轮免费</span>}
      >
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          <b>{STAMINA_COST.cup} 点体力入场</b>，{CUP_MIN_ROUNDS}～{CUP_MAX_ROUNDS} 轮，<b>之后每轮免费</b>。
          <b>双败</b>：第一次输进败者组，赢一场 BO3 回到下一轮，第二次输才出局。决赛输了先打败者组决赛，再重打决赛。
          对手按你的综合分抽签，<b>一轮比一轮强</b>，决赛 <b>BO5</b>。
          <b>本届固定使用报名时的五人、教练和等级</b>。
          出局按晋级轮数给金币（{cupExitPrize(0)} 起，每轮多 150），晋级两轮送{PACKS.scout.name}；
          冠军 <b>{cupTitlePrize(CUP_MIN_ROUNDS)}～{cupTitlePrize(CUP_MAX_ROUNDS)} 金币 + {PACKS.elite.name}</b>，
          4 轮加{PACKS.scout.name}，5 轮换成<b>{PACKS.ten.name}</b>。
        </p>

        {!cup && (
          <button className="primary" onClick={() => void enter()} disabled={busy || !can}>
            {!can
              ? `体力不够（${staminaNow(g, now)}/${STAMINA_COST.cup}）`
              : filled < 5 ? '先去组队' : `报名（−${STAMINA_COST.cup} 体力）`}
          </button>
        )}

        {cup && (
          <>
            {registration ? (
              <p className="small muted" style={{ lineHeight: 1.75 }}>
                本届报名阵容（{squadRating(registration.squad, id => registration.levels[id] ?? 0)} 分）：
                {[...registration.squad.slots, registration.squad.coach].filter((id): id is string => !!id).map(id => {
                  const card = cardById(id)
                  return `${card ? cardName(card) : id} +${registration.levels[id] ?? 0}`
                }).join(' · ')}
              </p>
            ) : live ? (
              <p className="small muted">这届旧杯赛会在下一场开始时记录当前五人、教练和等级；不重新收费或抽签。</p>
            ) : null}
            {!!cup.ease && (
              <p className="small muted" style={{ lineHeight: 1.75 }}>
                {cup.ease > 0
                  ? `本届对手派轮换阵容，综合分各 −${cup.ease}。`
                  : `本届对手满状态出战，综合分各 +${-cup.ease}。`}
              </p>
            )}
            {cup.double && live && (
              <p className="small" style={{ margin: '6px 0' }}>
                {cup.dropped
                  ? <span style={{ color: 'var(--loss)' }}>已输一场 · 再输出局</span>
                  : <span style={{ color: 'var(--win)' }}>胜者组 · 还能输一场</span>}
              </p>
            )}
            <div className="grid" style={{ gap: 8, marginTop: 4 }}>
              {cup.path.map((oppId, i) => {
                const isNow = live && cup.round === i
                const final = i === rounds - 1
                // a bracket drawn before 双败 has one leg a round, in order
                const legs = cup.legs
                  .map((l, k) => ({ ...l, round: l.round ?? k }))
                  .filter((l) => l.round === i)
                const lowerNow = isNow && cup.lower ? cup.lower : null
                const rows: { key: string; id: string; lower: boolean; leg?: typeof legs[number]; now: boolean }[] = []
                const upper = legs.filter((l) => !l.lower)
                const lower = legs.filter((l) => l.lower)
                // the round itself; after a lost final and a won 败者组决赛, the final again
                rows.push({ key: `u${i}`, id: oppId, lower: false, leg: upper[0], now: !!isNow && !lowerNow && !upper.length })
                if (lower.length) rows.push({ key: `l${i}`, id: lower[0].opponent, lower: true, leg: lower[0], now: false })
                else if (lowerNow) rows.push({ key: `l${i}`, id: lowerNow, lower: true, now: true })
                if (upper.length > 1 || (final && isNow && !lowerNow && upper.length === 1)) {
                  rows.push({ key: `r${i}`, id: oppId, lower: false, leg: upper[1], now: !!isNow && !upper[1] })
                }
                return rows.map((row) => {
                  const t = CUP_TEAMS.find((x) => x.id === row.id)
                  const cls = row.leg ? (row.leg.win ? 'won' : 'lost') : row.now ? 'now' : ''
                  const label = row.lower
                    ? (final ? '败者组决赛' : '败者组')
                    : cupRoundName(rounds, i)
                  return (
                    <div key={row.key} className={`bracket-leg ${cls}`}>
                      <b style={{ width: row.lower ? 84 : 48, whiteSpace: 'nowrap' }}>{label}</b>
                      <span style={{ flex: 1 }}>
                        {t?.name ?? '?'}
                        <span className="tiny faint"> · 综合分 {t ? t.rating - (cup.ease ?? 0) : '?'}</span>
                        {final && !row.lower && <span className="tag t1" style={{ marginLeft: 6 }}>BO5</span>}
                      </span>
                      {row.leg ? (
                        <span className="mono" style={{ color: row.leg.win ? 'var(--win)' : 'var(--loss)' }}>
                          {row.leg.mapsWon}–{row.leg.mapsLost}
                        </span>
                      ) : row.now ? (
                        <span className="tiny" style={{ color: 'var(--accent)' }}>下一场</span>
                      ) : (
                        <span className="tiny faint">未开始</span>
                      )}
                    </div>
                  )
                })
              })}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              {live ? (
                <button className="primary" onClick={() => void play()} disabled={busy}>
                  {busy ? '比赛中…' : `打${cup.lower ? (cup.round === rounds - 1 ? '败者组决赛' : '败者组') : cupRoundName(rounds, cup.round)}（BO${cupBo(cup)} · 不扣体力）`}
                </button>
              ) : (
                <>
                  <div className="small" style={{ marginRight: 'auto' }}>
                    {cup.won
                      ? <b style={{ color: 'var(--warn)' }}>🏆 冠军（{rounds} 轮）</b>
                      : <span className="muted">止步{cupRoundName(rounds, Math.min(rounds - 1, cup.double ? cup.round : Math.max(0, cup.legs.length - 1)))}</span>}
                  </div>
                  <button className="primary" disabled={busy || !can} onClick={async () => { if (await clear()) void enter() }}>
                    再来一届（−{STAMINA_COST.cup} 体力）
                  </button>
                  <button disabled={busy} onClick={() => void clear()}>收工</button>
                </>
              )}
            </div>
          </>
        )}
      </Panel>

      {shown && (
        <MatchReport
          result={shown.res}
          opponentId={shown.opp}
          level={id => shown.levels[id] ?? 0}
          onClose={() => setShown(null)}
          extra={
            <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
              {shown.out.won && <span className="chiplet" style={{ color: 'var(--warn)' }}>🏆 杯赛冠军</span>}
              {shown.out.coins > 0 && <span className="chiplet">+{shown.out.coins} 金币</span>}
              {(Object.entries(shown.out.packs ?? {}) as [PackKind, number][]).map(([k, n]) => (
                <span key={k} className="chiplet" style={{ color: 'var(--warn)' }}>{PACKS[k].name} ×{n}</span>
              ))}
              {shown.out.dropped && <span className="chiplet" style={{ color: 'var(--warn)' }}>掉入败者组 · 还有一次机会</span>}
              {!shown.out.done && !shown.out.dropped && <span className="chiplet">晋级 · 不扣体力</span>}
            </div>
          }
        />
      )}
    </>
  )
}
