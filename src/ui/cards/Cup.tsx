import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import {
  CUP_MAX_ROUNDS, CUP_MIN_ROUNDS, PACKS, STAMINA_COST, canPlay, cupBo, cupExitPrize, cupOpponent,
  cupRoundName, cupTitlePrize, levelOf, staminaNow,
} from '../../engine/gacha'
import type { CupOutcome } from '../../engine/gacha'
import type { ArenaResult } from '../../engine/arena'
import { squadRating } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/teams'
import { track } from '../../engine/telemetry'

/**
 * The cup: one ticket, then play until you lose or lift it.
 *
 * Drawn and played on the server — the bracket depth, the clubs in it, the
 * seed of every map. What this screen does is show the draw and hand the
 * scoreboards back.
 */
export default function Cup() {
  const { g, now, act, toast, go } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ res: ArenaResult; opp: string; out: CupOutcome } | null>(null)

  const level = (id: string) => levelOf(g, id)
  const filled = g.squad.slots.filter(Boolean).length
  const rating = squadRating(g.squad, level)
  const cup = g.cup
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
    toast(`抽签完成：${drawn} 轮的签表，${cupRoundName(drawn, 0)}对手已经出来了。`)
  }

  // the bracket is played on the server, against the club it drew, with the
  // five it knows this account holds; what comes back is the scoreboard
  const play = async () => {
    if (!cupOpponent(g) || !cup) return
    const round = cup.round
    setBusy(true)
    const r = await act('cup_play')
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const { res, opp, out } = r.result as { res: ArenaResult; opp: string; out: CupOutcome }
    track('card_match', { mode: 'cup', won: res.win, round, rating, title: !!out.won })
    setShown({ res, opp, out })
  }

  const clear = async () => {
    const r = await act('cup_clear')
    if (!r.ok) toast(r.why)
    return r.ok
  }

  return (
    <>
      <Panel
        title="杯赛"
        actions={<span className="tiny muted">入场 {STAMINA_COST.cup} 点体力 · 之后每轮免费</span>}
      >
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          <b>{STAMINA_COST.cup} 点体力买一张门票</b>，签表 {CUP_MIN_ROUNDS}～{CUP_MAX_ROUNDS} 轮单败淘汰，
          <b>之后每一轮都不再收钱也不再扣体力</b>——能打到哪看阵容硬不硬。
          对手按你的阵容分抽签，<b>一轮比一轮强</b>，决赛 <b>BO5</b>。
          出局按赢过的轮数给钱（{cupExitPrize(0)} 起，每赢一轮多 150）；
          冠军 <b>{cupTitlePrize(CUP_MIN_ROUNDS)}～{cupTitlePrize(CUP_MAX_ROUNDS)} 金币 + 一个{PACKS.elite.name}</b>，签表越长给得越多。
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
            <div className="grid" style={{ gap: 8, marginTop: 4 }}>
              {cup.path.map((oppId, i) => {
                const t = WORLD_TEAMS.find((x) => x.id === oppId)
                const leg = cup.legs[i]
                const isNow = live && cup.round === i
                const cls = leg ? (leg.win ? 'won' : 'lost') : isNow ? 'now' : ''
                const final = i === rounds - 1
                return (
                  <div key={i} className={`bracket-leg ${cls}`}>
                    <b style={{ width: 48 }}>{cupRoundName(rounds, i)}</b>
                    <span style={{ flex: 1 }}>
                      {t?.name ?? '?'}
                      <span className="tiny faint"> · 评分 {t?.rating}</span>
                      {final && <span className="tag t1" style={{ marginLeft: 6 }}>BO5</span>}
                    </span>
                    {leg ? (
                      <span className="mono" style={{ color: leg.win ? 'var(--win)' : 'var(--loss)' }}>
                        {leg.mapsWon}–{leg.mapsLost}
                      </span>
                    ) : isNow ? (
                      <span className="tiny" style={{ color: 'var(--accent)' }}>下一场</span>
                    ) : (
                      <span className="tiny faint">未开始</span>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              {live ? (
                <button className="primary" onClick={() => void play()} disabled={busy}>
                  {busy ? '比赛中…' : `打${cupRoundName(rounds, cup.round)}（BO${cupBo(cup)} · 不扣体力）`}
                </button>
              ) : (
                <>
                  <div className="small" style={{ marginRight: 'auto' }}>
                    {cup.won
                      ? <b style={{ color: 'var(--warn)' }}>🏆 冠军（{rounds} 轮）</b>
                      : <span className="muted">止步{cupRoundName(rounds, Math.max(0, cup.legs.length - 1))}</span>}
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
          level={level}
          onClose={() => setShown(null)}
          extra={
            <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
              {shown.out.won && <span className="chiplet" style={{ color: 'var(--warn)' }}>🏆 杯赛冠军</span>}
              {shown.out.coins > 0 && <span className="chiplet">+{shown.out.coins} 金币</span>}
              {shown.out.pack && <span className="chiplet" style={{ color: 'var(--warn)' }}>{PACKS[shown.out.pack].name} ×1</span>}
              {!shown.out.done && <span className="chiplet">晋级下一轮 · 不扣体力</span>}
            </div>
          }
        />
      )}
    </>
  )
}
