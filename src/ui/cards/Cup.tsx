import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import {
  CUP_ENTRY, CUP_PRIZE, CUP_WIN, PACKS, STAMINA_COST, canPlay, cupOpponent, enterCup,
  levelOf, recordCup, spendPlay,
} from '../../engine/gacha'
import type { CupOutcome } from '../../engine/gacha'
import { playArenaMatch } from '../../engine/arena'
import type { ArenaResult } from '../../engine/arena'
import { squadRating } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/world'
import { track } from '../../engine/telemetry'

const ROUND_CN = ['八强', '四强', '决赛']

export default function Cup() {
  const { g, now, commit, toast, go } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ res: ArenaResult; opp: string; out: CupOutcome } | null>(null)

  const level = (id: string) => levelOf(g, id)
  const filled = g.squad.slots.filter(Boolean).length
  const rating = squadRating(g.squad, level)
  const cup = g.cup
  const live = cup && !cup.done

  const enter = () => {
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    try {
      enterCup(g, rating)
      commit(true)
      toast('抽签完成，八强对手已经出来了。')
    } catch (e) {
      toast(e instanceof Error ? e.message : '报不了名')
    }
  }

  const play = () => {
    const oppId = cupOpponent(g)
    if (!oppId || !cup) return
    if (!spendPlay(g, 'cup', now)) {
      toast('体力不够了。杯赛进度会留着，回头接着打。')
      return
    }
    setBusy(true)
    window.setTimeout(() => {
      const seed = (Date.now() ^ (cup.round * 7919) ^ (cup.legs.length * 31)) >>> 0
      const res = playArenaMatch(g.squad, level, oppId, 3, seed)
      const out = recordCup(g, {
        opponent: oppId, win: res.win, mapsWon: res.mapsWon, mapsLost: res.mapsLost,
      })
      track('card_match', { mode: 'cup', won: res.win, round: cup.round, rating, title: !!out.won })
      commit(true)
      setBusy(false)
      setShown({ res, opp: oppId, out })
    }, 30)
  }

  return (
    <>
      <Panel
        title="杯赛"
        actions={<span className="tiny muted">报名费 {CUP_ENTRY} 金币</span>}
      >
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          三轮单败淘汰，每轮 BO3，输一场就结束。对手按你的阵容分抽签，一轮比一轮硬。
          每轮花 {STAMINA_COST.cup} 点体力——打不完不用急，对阵表会留着。
          八强出局 {CUP_PRIZE[0]}、四强 {CUP_PRIZE[1]}、亚军 {CUP_PRIZE[2]}，
          冠军 <b>{CUP_WIN} 金币 + 一个{PACKS.elite.name}</b>。
        </p>

        {!cup && (
          <button className="primary" onClick={enter} disabled={g.coins < CUP_ENTRY}>
            {g.coins < CUP_ENTRY ? `金币不够（还差 ${CUP_ENTRY - g.coins}）` : `报名（−${CUP_ENTRY} 金币）`}
          </button>
        )}

        {cup && (
          <>
            <div className="grid" style={{ gap: 8, marginTop: 4 }}>
              {cup.path.map((oppId, i) => {
                const t = WORLD_TEAMS.find((x) => x.id === oppId)
                const leg = cup.legs[i]
                const now = live && cup.round === i
                const cls = leg ? (leg.win ? 'won' : 'lost') : now ? 'now' : ''
                return (
                  <div key={i} className={`bracket-leg ${cls}`}>
                    <b style={{ width: 40 }}>{ROUND_CN[i]}</b>
                    <span style={{ flex: 1 }}>
                      {t?.name ?? '?'}
                      <span className="tiny faint"> · 评分 {t?.rating}</span>
                    </span>
                    {leg ? (
                      <span className="mono" style={{ color: leg.win ? 'var(--win)' : 'var(--loss)' }}>
                        {leg.mapsWon}–{leg.mapsLost}
                      </span>
                    ) : now ? (
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
                <button className="primary" onClick={play} disabled={busy || !canPlay(g, 'cup', now)}>
                  {busy ? '比赛中…'
                    : !canPlay(g, 'cup', now) ? '体力不够'
                      : `打${ROUND_CN[cup.round]}（${STAMINA_COST.cup} 体力）`}
                </button>
              ) : (
                <>
                  <div className="small" style={{ marginRight: 'auto' }}>
                    {cup.won
                      ? <b style={{ color: 'var(--warn)' }}>🏆 冠军</b>
                      : <span className="muted">止步{ROUND_CN[Math.max(0, cup.legs.length - 1)]}</span>}
                  </div>
                  <button className="primary" onClick={() => { g.cup = null; commit(true); enter() }}>
                    再来一届（−{CUP_ENTRY}）
                  </button>
                  <button onClick={() => { g.cup = null; commit(true) }}>收工</button>
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
              {!shown.out.done && <span className="chiplet">晋级下一轮</span>}
            </div>
          }
        />
      )}
    </>
  )
}
