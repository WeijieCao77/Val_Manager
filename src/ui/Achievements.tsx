/**
 * What this account has done, across every career it has ever played.
 *
 * The two collections are deliberately shown side by side and counted apart.
 * They answer different questions: an ending asks what ten years added up to
 * and you get exactly one per career, while an achievement is a single thing
 * you did on a single afternoon. Merging them into one number would hide that
 * twelve of these are mutually exclusive and twenty-five are not.
 *
 * Locked rows show what it takes rather than hiding behind ？？？ — this is a
 * game about planning a decade, and a goal you cannot read is not a goal. The
 * one exception is the endings, where the name IS the spoiler.
 */
import { useEffect, useState } from 'react'
import { useGame } from './ctx'
import { ACHIEVEMENTS, ACHIEVEMENT_COUNT, earnedNow } from '../engine/achievements'
import { ENDINGS, ENDING_COUNT } from '../engine/endings'
import { readProfile, record, siteId, syncProfile, type Profile } from '../engine/profile'
import { Panel } from './common'

const GROUPS = ['赛场', '养成', '阵容', '经营', '生涯'] as const

export default function Achievements() {
  const { game } = useGame()
  const id = siteId()
  // Opening this screen is a fine moment to catch up: the daily check only
  // runs on a turn, and a player can earn something through a transfer or a
  // contract and come straight here to look for it.
  const [profile, setProfile] = useState<Profile>(() => {
    record({ achievements: earnedNow(game) }, id)
    return readProfile(id)
  })
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let alive = true
    void syncProfile(id).then((p) => { if (alive) setProfile(p) })
    return () => { alive = false }
  }, [id])

  const has = new Set(profile.achievements)
  const seenEnding = new Set(profile.endings)
  const masked = id ? `${id.slice(0, 7)}-••••-${id.slice(-4)}` : ''

  const copy = async () => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* no clipboard permission; 显示 puts it on screen instead */ }
  }

  return (
    <div className="grid">
      <Panel title={`成就 · ${has.size}/${ACHIEVEMENT_COUNT}`}>
        <p className="tiny faint" style={{ marginTop: 0 }}>
          记在你的账号上，跨存档累计——换俱乐部、被解雇、开新档都不会清零。
        </p>
        {GROUPS.map((g) => {
          const rows = ACHIEVEMENTS.filter((a) => a.group === g)
          const done = rows.filter((a) => has.has(a.key)).length
          return (
            <div key={g} className="ach-group">
              <h3>{g} <em>{done}/{rows.length}</em></h3>
              <div className="ach-list">
                {rows.map((a) => {
                  const got = has.has(a.key)
                  return (
                    <div key={a.key} className={`ach${got ? ' got' : ''}${a.hard ? ' hard' : ''}`}>
                      <span className="mark">{got ? '★' : '☆'}</span>
                      <div>
                        <b>{a.title}</b>
                        <span className="tiny muted">{a.brief}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </Panel>

      <Panel title={`结局收藏 · ${seenEnding.size}/${ENDING_COUNT}`}>
        <p className="tiny faint" style={{ marginTop: 0 }}>
          每段生涯走完十年会得到一个结局，同时达成的其它结局也一并解锁。
          没见过的只显示达成条件。
        </p>
        <div className="ach-list">
          {ENDINGS.map((e) => {
            const got = seenEnding.has(e.key)
            return (
              <div key={e.key} className={`ach${got ? ' got' : ''}`}>
                <span className="mark">{got ? '★' : '☆'}</span>
                <div>
                  <b>{got ? e.title : '？？？'}</b>
                  <span className="tiny muted">{e.brief}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="生涯累计">
        <div className="grid c4" style={{ gap: 12 }}>
          <div className="stat"><span className="k">执教生涯</span><span className="v sm">{profile.record.careers} 段</span></div>
          <div className="stat"><span className="k">走完十年</span><span className="v sm">{profile.record.finished} 次</span></div>
          <div className="stat"><span className="k">中途下课</span><span className="v sm">{profile.record.sacked} 次</span></div>
          <div className="stat"><span className="k">累计冠军</span><span className="v sm">{profile.record.titles} 座</span></div>
          <div className="stat"><span className="k">世界冠军</span><span className="v sm">{profile.record.worldTitles} 座</span></div>
          <div className="stat"><span className="k">单段最多</span><span className="v sm">{profile.record.bestHaul} 座</span></div>
          <div className="stat"><span className="k">执教赛季</span><span className="v sm">{profile.record.seasons} 个</span></div>
          <div className="stat"><span className="k">执教过的俱乐部</span><span className="v sm">{profile.record.clubs.length} 家</span></div>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
          <span className="tiny faint">账号 ID</span>
          <b className="mono" style={{ fontSize: 12 }}>{id ? (shown ? id : masked) : '尚未创建'}</b>
          {id && <button className="sm ghost" onClick={() => setShown((v) => !v)}>{shown ? '隐藏' : '显示'}</button>}
          {id && <button className="sm ghost" onClick={copy}>{copied ? '已复制' : '复制'}</button>}
        </div>
        <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
          这串 ID 和开瓦包是同一个账号，<b>相当于账号密码，不要发给别人</b>。
          换手机时在任意一个游戏里填进去，成就、结局和卡牌收藏都会跟过来。
        </p>
      </Panel>
    </div>
  )
}
