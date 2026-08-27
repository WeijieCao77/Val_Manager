import { useGame } from './ctx'
import { Modal } from './common'
import { fmtDay } from './common'
import type { DayReport } from '../engine/season'
import type { Fixture } from '../engine/types'

/**
 * What happened while time was passing.
 *
 * Only the last note used to surface, as a toast — so advancing a week threw
 * away everything except whichever line happened to be printed last. A turn
 * ends by telling you what it did, and nothing moves on until you have read it.
 */

/** Sort a note into a bucket by the marker the engine put on it. */
function bucketOf(note: string): string {
  // the season's own markers are not events — they head the list
  if (/^——/.test(note)) return '赛季进程'
  if (/^💼|^📋|^💰|^⏳|^📰|签下|报价|挂牌|转会|加盟|要价|合同/.test(note)) return '转会与商务'
  if (/^⚕️|^📉|^📈|^📊|^🔥|^🥶|^🎓|^🗺|^🤝|训练|熟练度|能力值|康复|状态/.test(note)) return '训练与状态'
  if (/^💢|^🚨|^💔|^👋|^🎂|^🎖|士气|信任|关系|不满|退役|生日|生涯/.test(note)) return '更衣室'
  if (/^🏆|^🏅|^🏁|^🎫|^📩|^🚪|^⚠|董事会|目标|排名|冠军|赛段/.test(note)) return '俱乐部'
  return '其他'
}

const ORDER = ['赛季进程', '俱乐部', '转会与商务', '训练与状态', '更衣室', '其他']

export default function Digest({
  reports, fromDay, onClose,
}: { reports: DayReport[]; fromDay: number; onClose: () => void }) {
  const { game, openMatch } = useGame()

  const notes = reports.flatMap((r) => r.notes)
  const played: Fixture[] = reports.flatMap((r) => r.playedMine)
  const days = game.day - fromDay

  const groups = new Map<string, string[]>()
  for (const n of notes) {
    const k = bucketOf(n)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(n)
  }

  const stageChanged = reports.some((r) => r.stageChanged)
  const nothing = !notes.length && !played.length

  return (
    <Modal
      title={days <= 1 ? `${fmtDay(game.day, game.year)} · 今天` : `${fmtDay(fromDay, game.year)} — ${fmtDay(game.day, game.year)} · 这 ${days} 天`}
      onClose={onClose}
    >
      {stageChanged && (
        <div className="tag t1" style={{ marginBottom: 10 }}>赛段已推进</div>
      )}

      {played.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>比赛</div>
          {played.map((f) => {
            const r = f.result
            if (!r) return null
            const mine = f.teamA === game.myTeam
            const won = (r.mapsWonA > r.mapsWonB) === mine
            return (
              <button key={f.id} className="recent-row" onClick={() => { onClose(); openMatch(f) }}>
                <span className={won ? 'pos' : 'neg'} style={{ width: 16 }}>{won ? '胜' : '负'}</span>
                <span className="mono" style={{ width: 36 }}>
                  {mine ? r.mapsWonA : r.mapsWonB}–{mine ? r.mapsWonB : r.mapsWonA}
                </span>
                <span className="small" style={{ flex: 1, textAlign: 'left' }}>
                  {game.teams[mine ? f.teamB : f.teamA]?.tag}
                </span>
                <span className="tag">{f.comp === 'scrim' ? '训练赛' : game.comps[f.comp]?.name ?? f.comp}</span>
                <span className="tiny faint">点击查看</span>
              </button>
            )
          })}
        </div>
      )}

      {ORDER.filter((k) => groups.has(k)).map((k) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>{k}</div>
          {groups.get(k)!.map((n, i) => (
            <div key={i} className="news-item"><span className="small">{n}</span></div>
          ))}
        </div>
      ))}

      {nothing && (
        <div className="empty">
          这{days <= 1 ? '一天' : `${days} 天`}平静地过去了，没有需要你处理的事。
        </div>
      )}

      <div className="row" style={{ gap: 10, marginTop: 16 }}>
        <button className="primary" onClick={onClose}>知道了</button>
      </div>
    </Modal>
  )
}
