import { useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import {
  DIVISIONS, MASTER_DIV, MASTER_TITLES, PACKS, STAMINA_COST, STAMINA_MAX, canPlay,
  ladderOpponent, levelOf, masterTitle, oppBumpFor, pendingOpponent,
  rankName, staminaFillHours, staminaNow, staminaRate, starsOnTier, tierStars,
} from '../../engine/gacha'
import type { LadderOutcome } from '../../engine/gacha'
import type { ArenaResult, RivalSquad } from '../../engine/arena'
import { squadRating } from '../../engine/cards'
import { WORLD_TEAMS } from '../../engine/teams'
import { REGION_CN } from '../../engine/types'
import { track } from '../../engine/telemetry'
import { fetchTop } from '../../engine/account'
import type { TopRow } from '../../engine/account'

/**
 * The ladder, played on the server.
 *
 * The opponent is drawn there and pinned to the match, the five that walks
 * out is the five the server knows this account owns, the seed is one the
 * client never held, and the record moves only when the server says it did.
 * What this screen does is ask, and show the scoreboard it is handed.
 */
export default function Ladder() {
  const { g, now, cloud, act, toast, go } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<
    { res: ArenaResult; opp: string; who?: string; out: LadderOutcome } | null
  >(null)

  const level = (id: string) => levelOf(g, id)
  const filled = g.squad.slots.filter(Boolean).length
  const rating = squadRating(g.squad, level)
  const opp0 = ladderOpponent(g)
  const L = g.ladder
  const master = L.div >= MASTER_DIV
  const [top, setTop] = useState<TopRow[] | null | 'loading'>('loading')
  /**
   * The board, refetched whenever this account's record moves.
   *
   * The match is settled on the server before its reply arrives, so by the
   * time `saved` bumps the row is already on the table.
   */
  const [saved, setSaved] = useState(0)
  const [topAt, setTopAt] = useState(0)
  useEffect(() => {
    let alive = true
    const pull = () => {
      void fetchTop().then((r) => { if (alive) { setTop(r); setTopAt(Date.now()) } })
    }
    pull()
    // A board that only moves when YOU move is not a leaderboard. Everybody
    // else is playing asynchronously, so it refreshes on a slow clock and
    // whenever the tab comes back — never while it is hidden.
    const wake = () => { if (document.visibilityState === 'visible') pull() }
    const t = setInterval(wake, 60_000)
    document.addEventListener('visibilitychange', wake)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [saved])
  // past 大师 the world's clubs are not strong enough on their own
  const bump = master ? oppBumpFor(L.points ?? 0) : 0

  /**
   * Who you are playing, drawn once and then pinned — on the server.
   *
   * The draw is stamped with the match number and kept in the account, so
   * coming back to this screen shows the same opponent and the only way to a
   * new one is to play the one you have. From 钻石 up the server puts a real
   * player's five in front of you when it has one.
   */
  const pinned = pendingOpponent(g)
  const [drawing, setDrawing] = useState(false)
  useEffect(() => {
    if (pinned || drawing || !cloud) return
    let alive = true
    setDrawing(true)
    void act('ladder_draw').finally(() => { if (alive) setDrawing(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, cloud, L.wins, L.losses])

  const rival = (pinned?.rival ?? null) as RivalSquad | null
  const oppId = pinned?.club ?? opp0
  const opp = WORLD_TEAMS.find((t) => t.id === oppId)

  const play = async () => {
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    if (!canPlay(g, 'ladder', now)) { toast(`体力不够了——${staminaRate()}。`); return }
    setBusy(true)
    const r = await act('ladder')
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const got = r.result as { res: ArenaResult; opp: string; who?: string; out: LadderOutcome }
    track('card_match', {
      mode: 'ladder', won: got.res.win, div: g.ladder.div, rating,
      points: g.ladder.points ?? 0, rival: got.who ? 1 : 0,
    })
    setSaved((n) => n + 1)
    setShown(got)
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
                到了大师就不再掉段，改成计分：赢一场 +20 起，对手评分每高出 84 一分多给 3 分
                （下一个对手评分 {(opp?.rating ?? 80) + bump}，赢了 +{20 + Math.max(0, (opp?.rating ?? 80) + bump - 84) * 3}），
                三连胜起再 +8；对上别人的阵容时，对手评分按他的大师分折算。输一场 −15，分数最低到 0 为止。
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
                  <div style={{ fontSize: 19, fontWeight: 700 }}>
                    {rival ? rival.name : opp.name}
                    {rival && <span className="tiny faint mono"> {rival.tag}</span>}
                  </div>
                  <div className="tiny muted">
                    {rival ? (
                      <>
                        <span className="tag t1">真人卡组</span>{' '}
                        {rankName(rival.div, 0, rival.points)} · 别的玩家存下来的五人
                      </>
                    ) : (
                      <>
                        {REGION_CN[opp.region as keyof typeof REGION_CN]} · {opp.league} · 评分{' '}
                        {opp.rating + bump}
                        {bump > 0 && (
                          <span className="tag warn" style={{ marginLeft: 5 }}>
                            大师加强 +{bump}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="right">
                  <div className="tiny faint">我的阵容分</div>
                  <div className="display" style={{ fontSize: 28, lineHeight: 1 }}>{rating}</div>
                </div>
              </div>
              <p className="tiny faint" style={{ lineHeight: 1.7 }}>
                三局两胜，走完整的 BAN/PICK 和回合经济——和生涯模式是同一套比赛引擎，<b>在服务器上打</b>。
                {rival
                  ? '　对面是别的玩家存下来的阵容快照，不需要他在线，你的任何信息也不会给到他。'
                  : L.div >= 4 ? '　（这会儿没找到合适的真人卡组，先打真实俱乐部。）' : ''}
              </p>
              <button className="primary" onClick={() => void play()} disabled={busy || !cloud || !canPlay(g, 'ladder', now)}>
                {busy ? '比赛中…'
                  : !cloud ? '需要联网'
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

      <Panel
        title="排行榜"
        actions={
          <span className="tiny muted">
            按段位和大师分排
            {topAt > 0 && <FreshAt at={topAt} />}
          </span>
        }
      >
        {top === 'loading' ? <p className="empty">读取中…</p>
          : !top ? <p className="empty">暂时读不到排行榜（离线或服务器忙）。</p>
            : top.length === 0 ? <p className="empty">还没有人上榜。</p>
              : (
                <>
                  <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th className="num">#</th><th>玩家</th><th>段位</th>
                          <th className="num">战绩</th>
                        </tr>
                      </thead>
                      <tbody>
                        {top.map((r) => (
                          <tr key={`${r.rank}-${r.tag}`} className={r.me ? 'me' : ''}>
                            <td className="num mono">{r.rank}</td>
                            <td>
                              <b style={{ color: r.hidden ? 'var(--faint)' : undefined }}>{r.name}</b>
                              <span className="tiny faint mono"> #{r.tag}</span>
                              {r.me && <span className="tag t1" style={{ marginLeft: 5 }}>我</span>}
                            </td>
                            <td className="small">{rankName(r.div, r.stars, r.points)}</td>
                            <td className="num mono tiny">{r.wins}–{r.losses}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* the one person this matters to most is the one whose own
                      row is hidden, and they are the only one who can fix it */}
                  {top.some((r) => r.me && r.hidden) && (
                    <div style={{
                      marginTop: 10, padding: '10px 12px', borderRadius: 3,
                      background: 'var(--warn-wash)', border: '1px solid var(--warn)',
                      borderLeftWidth: 3,
                    }}>
                      <b style={{ color: 'var(--warn)' }}>你的名字没有显示在榜上</b>
                      <div className="small muted" style={{ marginTop: 3, lineHeight: 1.7 }}>
                        {top.find((r) => r.me)?.why === 'id'
                          ? <>你把<b>账号 ID 当成昵称</b>了——那串东西是你的密码，
                            公开出去别人就能登录你的号。请<b>马上去「账号」页改个昵称</b>，
                            排名和战绩都不会丢。</>
                          : <>名字里有不适合公开显示的词。去「账号」页改一个就会恢复显示，
                            排名和战绩不受影响。</>}
                      </div>
                    </div>
                  )}
                  <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
                    前 100 名，加上你自己那一行——排在外面也看得到自己第几。
                    名字后面的 <b>#四位</b> 是账号的识别码，用来区分同名的人，
                    它来自 ID 的哈希，<b>不是 ID 本身</b>，看到也没法登录你的号。
                    显示成「已隐藏」的，要么名字里有不该上榜的词，要么<b>把账号 ID 填成了昵称</b>
                    （那是你的密码，绝不能公开）——去「账号」页改个名字就会恢复。
                  </p>
                </>
              )}
      </Panel>

      {shown && (
        <MatchReport
          result={shown.res}
          opponentId={shown.opp}
          opponentName={shown.who}
          mySquad={g.squad}
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

/**
 * How long ago the board was read.
 *
 * Small, but it is the difference between 「排行榜不会实时更新」 and knowing
 * that it does — a number that refreshes on its own with nothing next to it
 * looks exactly like a number that never refreshes at all.
 */
function FreshAt({ at }: { at: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return (
    <span className="faint">
      {' · '}
      {s < 15 ? '刚刚更新' : s < 60 ? `${s} 秒前更新` : `${Math.round(s / 60)} 分钟前更新`}
    </span>
  )
}
