import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import { DIVISIONS, ladderOpponent, levelOf, recordLadder, starsFor, PACKS } from '../../engine/gacha'
import type { LadderOutcome } from '../../engine/gacha'
import { playArenaMatch } from '../../engine/arena'
import type { ArenaResult } from '../../engine/arena'
import { squadRating } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/world'
import { REGION_CN } from '../../engine/types'
import { track } from '../../engine/telemetry'

export default function Ladder() {
  const { g, commit, toast, go } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ res: ArenaResult; opp: string; out: LadderOutcome } | null>(null)

  const level = (id: string) => levelOf(g, id)
  const filled = g.squad.slots.filter(Boolean).length
  const rating = squadRating(g.squad, level)
  const oppId = ladderOpponent(g)
  const opp = WORLD_TEAMS.find((t) => t.id === oppId)
  const L = g.ladder

  const play = () => {
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    setBusy(true)
    // one frame so the button can show it is working before the sim blocks
    window.setTimeout(() => {
      const seed = (Date.now() ^ (L.wins * 7919) ^ (L.losses * 104729)) >>> 0
      const res = playArenaMatch(g.squad, level, oppId, 3, seed)
      const out = recordLadder(g, res.win)
      track('card_match', { mode: 'ladder', won: res.win, div: g.ladder.div, rating })
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
            {DIVISIONS[L.div]}
            <span className="stars">
              {Array.from({ length: starsFor(L.div) }, (_, i) => (
                <i key={i} className={i < L.stars ? 'on' : ''} />
              ))}
            </span>
          </div>
          <div className="small muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
            战绩 <b className="mono">{L.wins}–{L.losses}</b>
            {L.streak >= 2 && <span className="pos"> · {L.streak} 连胜</span>}
            {L.streak <= -2 && <span className="neg"> · {-L.streak} 连败</span>}
            <br />
            最高 {DIVISIONS[L.best]}
            <br />
            <span className="tiny faint">
              赢一场 +1★（三连胜起 +2★，钻石以下），输一场 −1★。铂金开始会掉段。
            </span>
          </div>
        </Panel>

        <Panel title="下一个对手">
          {opp ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700 }}>{opp.name}</div>
                  <div className="tiny muted">
                    {REGION_CN[opp.region as keyof typeof REGION_CN]} · {opp.league} · 评分 {opp.rating}
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
              <button className="primary" onClick={play} disabled={busy}>
                {busy ? '比赛中…' : filled < 5 ? '先去组队' : '开打（BO3）'}
              </button>
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
              {shown.out.promoted && <span className="chiplet" style={{ color: 'var(--win)' }}>升段 → {DIVISIONS[g.ladder.div]}</span>}
              {shown.out.demoted && <span className="chiplet" style={{ color: 'var(--loss)' }}>掉段 → {DIVISIONS[g.ladder.div]}</span>}
              {shown.out.pack && <span className="chiplet" style={{ color: 'var(--warn)' }}>升段奖励：{PACKS[shown.out.pack].name}</span>}
            </div>
          }
        />
      )}
    </>
  )
}
