import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import { levelOf, rankName, recordFriend } from '../../engine/gacha'
import type { FriendRec } from '../../engine/gacha'
import { playRivalMatch } from '../../engine/arena'
import type { ArenaResult, RivalSquad } from '../../engine/arena'
import { squadRating } from '../../engine/cards'
import { fetchFriend, myCode } from '../../engine/account'
import type { FriendMiss } from '../../engine/account'
import { track } from '../../engine/telemetry'

type Found = RivalSquad & { code: string }

const MISS: Record<FriendMiss, string> = {
  bad: '对战码是 8 位，只有数字和 A–F 这几个字母。再看一眼是不是抄漏了。',
  missing: '没有这个对战码。让他在「好友」页面里复制一下自己的码，别手打。',
  empty: '这个人的卡组还没凑齐五个人，打不了。让他先去组队。',
  clash: '这个码对上了不止一个账号（概率极低，但确实撞上了）。跟他说一声，换个方式找他。',
  offline: '连不上服务器，等会儿再试。',
}

/**
 * 好友对战房。
 *
 * Asynchronous, like the ladder's real-squad opponents and for the same
 * reason: nobody has to be online, and what travels is a snapshot of five
 * cards rather than a live connection. Type a friend's 对战码 and you play the
 * five they last saved.
 *
 * It pays nothing — no coins, no stamina, no ladder movement. That is on
 * purpose. The moment a friendly is worth something, two accounts trading
 * wins is the fastest way to get it, and defending against that would mean
 * server-side match validation for a game about collecting cards. What you get
 * is the head-to-head, which is the thing people actually argue about.
 */
export default function Friends() {
  const { g, today, commit, toast, go } = useCards()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [shown, setShown] = useState<{ res: ArenaResult; who: Found; rec: FriendRec } | null>(null)

  const level = (id: string) => levelOf(g, id)
  const mine = myCode()
  const filled = g.squad.slots.filter(Boolean).length
  const rating = squadRating(g.squad, level)
  const friends = g.friends ?? []

  const look = async (raw?: string) => {
    const want = (raw ?? code).trim()
    if (mine && want.toUpperCase() === mine.toUpperCase()) {
      setFound(null)
      setWhy('这是你自己的码。把它发给别人，让他们来打你。')
      return
    }
    setBusy(true); setWhy(null); setFound(null)
    const r = await fetchFriend(want)
    setBusy(false)
    if (r.ok) { setFound(r.friend); setCode(r.friend.code.toUpperCase()) } else setWhy(MISS[r.why])
  }

  const play = () => {
    if (!found) return
    if (filled < 5) { toast('先凑齐五个人。'); go('squad'); return }
    setBusy(true)
    window.setTimeout(() => {
      // no stamina and no reward, so the seed is the only thing that has to be
      // fresh — a rematch that replayed the same match would be a screenshot
      const seed = (Date.now() ^ (friends.length * 7919)) >>> 0
      const res = playRivalMatch(g.squad, level, found, 3, seed)
      const rec = recordFriend(g, found, res.win, today)
      track('card_match', { mode: 'friend', won: res.win, div: g.ladder.div, rating })
      commit(true)
      setBusy(false)
      setShown({ res, who: found, rec })
    }, 30)
  }

  const copy = () => {
    if (!mine) return
    void navigator.clipboard?.writeText(mine).then(
      () => toast('对战码已复制，发给朋友就行。'),
      () => toast('复制不了，手动选中吧。'),
    )
  }

  return (
    <>
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="我的对战码" actions={<span className="tiny muted">发给谁都可以</span>}>
          {mine ? (
            <>
              <div
                className="display"
                style={{ fontSize: 34, letterSpacing: 3, margin: '6px 0 10px', userSelect: 'all' }}
              >
                {mine}
              </div>
              <button className="primary sm" onClick={copy}>复制对战码</button>
              <p className="small muted" style={{ lineHeight: 1.8, marginBottom: 0 }}>
                <b>这不是你的账号 ID，发出去是安全的。</b>
                它是账号 ID 的哈希前八位——和排行榜上你名字后面那个 #四位是同一串东西，
                只是长一点。别人拿到它只能来打你的卡组，<b>没法登录你的号，也倒推不回你的 ID</b>。
              </p>
              <p className="tiny faint" style={{ marginBottom: 0 }}>
                你的账号 ID（VM- 开头那串）是这个游戏全部的认证方式，
                <b>那串永远不要发给任何人</b>，包括自称管理员的人。
              </p>
            </>
          ) : (
            <p className="empty">
              还没连上服务器，暂时拿不到你的对战码。等联网之后再来。
            </p>
          )}
        </Panel>

        <Panel title="找人对战" actions={<span className="tiny muted">对面不用在线</span>}>
          <div className="row" style={{ gap: 6 }}>
            <input
              style={{ flex: 1, fontFamily: 'var(--mono)', letterSpacing: 2, textTransform: 'uppercase' }}
              placeholder="输入对方的 8 位对战码"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void look() }}
            />
            <button className="sm" onClick={() => void look()} disabled={busy}>
              {busy ? '找…' : '查找'}
            </button>
          </div>
          {why && <p className="small" style={{ color: 'var(--warn)', lineHeight: 1.7 }}>{why}</p>}

          {found && (
            <>
              <div
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}
              >
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700 }}>
                    {found.name}
                    <span className="tiny faint mono"> {found.tag}</span>
                  </div>
                  <div className="tiny muted">
                    {rankName(found.div, 0, found.points)} · 阵容分{' '}
                    {squadRating(
                      { slots: found.slots, coach: found.coach },
                      (id) => found.levels[id] ?? 0,
                    )}
                  </div>
                </div>
                <div className="right">
                  <div className="tiny faint">我的阵容分</div>
                  <div className="display" style={{ fontSize: 28, lineHeight: 1 }}>{rating}</div>
                </div>
              </div>
              <p className="tiny faint" style={{ lineHeight: 1.7 }}>
                三局两胜，和天梯同一套比赛引擎。<b>不花体力，也不给金币、不算段位</b>——
                只记你俩之间的胜负。打的是他上次存下来的阵容，他不需要在线，
                你的任何信息也不会给到他。
              </p>
              <button className="primary" onClick={play} disabled={busy}>
                {busy ? '比赛中…' : filled < 5 ? '先去组队' : '开打（BO3 · 不花体力）'}
              </button>
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="对战记录"
        actions={<span className="tiny muted">最近 {friends.length} 个人</span>}
      >
        {friends.length === 0 ? (
          <p className="empty">还没和谁打过。把上面的对战码发给朋友，或者问他要一个。</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>玩家</th><th className="num">战绩</th><th>最近</th><th />
                  </tr>
                </thead>
                <tbody>
                  {friends.map((f) => (
                    <tr key={f.code}>
                      <td>
                        {f.name}
                        <span className="tiny faint mono"> {f.tag}</span>
                        <div className="tiny faint mono">{f.code.toUpperCase()}</div>
                      </td>
                      <td className="num mono">
                        <span className={f.wins > f.losses ? 'pos' : f.wins < f.losses ? 'neg' : ''}>
                          {f.wins}–{f.losses}
                        </span>
                      </td>
                      <td className="tiny muted">{f.at}</td>
                      <td className="right">
                        <button className="sm" onClick={() => { setCode(f.code.toUpperCase()); void look(f.code) }}>
                          再来
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny faint" style={{ marginBottom: 0 }}>
              这份记录存在你自己的存档里，对面那边有他自己的一份。
              你打他一场、他打你一场，两边的账才对得上——不是一本共用的账。
            </p>
          </>
        )}
      </Panel>

      {shown && (
        <MatchReport
          result={shown.res}
          opponentId=""
          opponentName={`${shown.who.name} ${shown.who.tag}`}
          mySquad={g.squad}
          level={level}
          onClose={() => setShown(null)}
          extra={
            <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
              <span className="chiplet">
                和 {shown.who.name} 的战绩 {shown.rec.wins}–{shown.rec.losses}
              </span>
              <span className="chiplet faint">友谊赛 · 不计段位不给金币</span>
            </div>
          }
        />
      )}
    </>
  )
}
