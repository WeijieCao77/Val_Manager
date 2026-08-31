import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import {
  DIVISIONS, MASTER_DIV, MASTER_TITLES, PACKS, STAMINA_COST, STAMINA_MAX, canPlay,
  ladderOpponent, levelOf, masterTitle, oppBumpFor, rankName, recordLadder,
  spendPlay, staminaFillHours, staminaNow, staminaRate, starsOnTier, tierStars,
} from '../../engine/gacha'
import type { LadderOutcome } from '../../engine/gacha'
import { playArenaMatch } from '../../engine/arena'
import type { ArenaResult } from '../../engine/arena'
import { squadRating } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/world'
import { REGION_CN } from '../../engine/types'
import { track } from '../../engine/telemetry'

export default function Ladder() {
  const { g, now, commit, toast, go } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ res: ArenaResult; opp: string; out: LadderOutcome } | null>(null)

  const level = (id: string) => levelOf(g, id)
  const filled = g.squad.slots.filter(Boolean).length
  const rating = squadRating(g.squad, level)
  const oppId = ladderOpponent(g)
  const opp = WORLD_TEAMS.find((t) => t.id === oppId)
  const L = g.ladder
  const master = L.div >= MASTER_DIV
  // past 大师 the world's clubs are not strong enough on their own
  const bump = master ? oppBumpFor(L.points ?? 0) : 0

  const play = () => {
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    if (!spendPlay(g, 'ladder', now)) {
      toast(`体力不够了——${staminaRate()}。`)
      return
    }
    setBusy(true)
    // one frame so the button can show it is working before the sim blocks
    window.setTimeout(() => {
      const seed = (Date.now() ^ (L.wins * 7919) ^ (L.losses * 104729)) >>> 0
      const res = playArenaMatch(g.squad, level, oppId, 3, seed, bump)
      const out = recordLadder(g, res.win, (opp?.rating ?? 80) + bump)
      track('card_match', {
        mode: 'ladder', won: res.win, div: g.ladder.div, rating,
        points: g.ladder.points ?? 0,
      })
      commit(true)
      setBusy(false)
      setShown({ res, opp: oppId, out })
    }, 30)
  }

  return (
    <>
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="段位">
          <div className="div-badge">
            {rankName(L.div, L.stars, L.points ?? 0)}
            {!master && (
              <span className="stars">
                {Array.from({ length: tierStars(L.div) }, (_, i) => (
                  <i key={i} className={i < starsOnTier(L.div, L.stars) ? 'on' : ''} />
                ))}
              </span>
            )}
          </div>
          <div className="small muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
            战绩 <b className="mono">{L.wins}–{L.losses}</b>
            {L.streak >= 2 && <span className="pos"> · {L.streak} 连胜</span>}
            {L.streak <= -2 && <span className="neg"> · {-L.streak} 连败</span>}
            <br />
            {master
              ? <>最高 <b className="mono">{L.bestPoints ?? 0}</b> 分（{masterTitle(L.bestPoints ?? 0)}）</>
              : <>最高 {DIVISIONS[L.best]}</>}
            <br />
            {master ? (
              <span className="tiny faint">
                到了大师就不再掉段，改成计分：赢一场 +{20 + Math.max(0, (opp?.rating ?? 80) + bump - 84) * 3}
                （对手越强给得越多，三连胜再 +8），输一场 −15，分数最低到 0 为止。
                {MASTER_TITLES.slice().reverse().filter((t) => t.at > 0)
                  .map((t) => `${t.at} 分升「${t.name}」`).join('，')}——上不封顶。
              </span>
            ) : (
              <span className="tiny faint">
                赢一场 +1★（三连胜起 +2★，钻石以下），输一场 −1★。铂金开始会掉段。
                每个大段分成几个小段，升一个小段就是一次进步；打到大师之后改成计分，不再封顶。
              </span>
            )}
          </div>
        </Panel>

        <Panel title="下一个对手">
          {opp ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700 }}>{opp.name}</div>
                  <div className="tiny muted">
                    {REGION_CN[opp.region as keyof typeof REGION_CN]} · {opp.league} · 评分{' '}
                    {opp.rating + bump}
                    {bump > 0 && (
                      <span className="tag warn" style={{ marginLeft: 5 }}>
                        大师加强 +{bump}
                      </span>
                    )}
                  </div>
                </div>
                <div className="right">
                  <div className="tiny faint">我的阵容分</div>
                  <div className="display" style={{ fontSize: 28, lineHeight: 1 }}>{rating}</div>
                </div>
              </div>
              <p className="tiny faint" style={{ lineHeight: 1.7 }}>
                三局两胜，走完整的 BAN/PICK 和回合经济——和生涯模式是同一套比赛引擎。
              </p>
              <button className="primary" onClick={play} disabled={busy || !canPlay(g, 'ladder', now)}>
                {busy ? '比赛中…'
                  : filled < 5 ? '先去组队'
                    : !canPlay(g, 'ladder', now) ? '体力不够'
                      : `开打（BO3 · ${STAMINA_COST.ladder} 体力）`}
              </button>
              <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
                体力 {staminaNow(g, now)}/{STAMINA_MAX}，够打 {Math.floor(staminaNow(g, now) / STAMINA_COST.ladder)} 场。
                {staminaRate()}，攒满 {STAMINA_MAX} 点要 {staminaFillHours()} 小时。
                隔一会儿回来打两场，比攒着一次打完划算——攒满了就不再回体力了。
              </p>
            </>
          ) : (
            <p className="empty">找不到对手。</p>
          )}
        </Panel>
      </div>

      {shown && (
        <MatchReport
          result={shown.res}
          opponentId={shown.opp}
          level={level}
          onClose={() => setShown(null)}
          extra={
            <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
              <span className="chiplet">{shown.out.coins > 0 ? `+${shown.out.coins}` : shown.out.coins} 金币</span>
              {shown.out.pointsDelta != null && (
                <span className="chiplet" style={{ color: shown.out.pointsDelta >= 0 ? 'var(--win)' : 'var(--loss)' }}>
                  {shown.out.pointsDelta >= 0 ? '+' : ''}{shown.out.pointsDelta} 分 · {shown.out.title} {shown.out.points}
                </span>
              )}
              {shown.out.promoted && <span className="chiplet" style={{ color: 'var(--win)' }}>升段 → {rankName(g.ladder.div, g.ladder.stars, g.ladder.points ?? 0)}</span>}
              {shown.out.demoted && <span className="chiplet" style={{ color: 'var(--loss)' }}>掉段 → {rankName(g.ladder.div, g.ladder.stars, 0)}</span>}
              {shown.out.pack && <span className="chiplet" style={{ color: 'var(--warn)' }}>升段奖励：{PACKS[shown.out.pack].name}</span>}
            </div>
          }
        />
      )}
    </>
  )
}
