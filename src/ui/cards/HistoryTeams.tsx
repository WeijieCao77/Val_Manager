import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import MatchReport from './Report'
import { playLevelOf } from '../../engine/gacha'
import type { ArenaResult } from '../../engine/arena'
import { cardById, isPlayerCard } from '../../engine/cards'
import {
  HISTORY_CHAPTERS, HISTORY_STAGES, historyEntry, historyState, stageOpen,
} from '../../engine/historyTeams'
import type { HistoryOutcome, HistoryStage } from '../../engine/historyTeams'
import { track } from '../../engine/telemetry'

/**
 * 历代强队: a retired five against twelve world-event winners, chapter by
 * chapter (engine/historyTeams.ts). Played on the server like the 征途.
 */
export default function HistoryTeams() {
  const { g, act, toast } = useCards()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<{ st: HistoryStage; res: ArenaResult; out: HistoryOutcome } | null>(null)
  // a read for the screen: historyState cleans a copy, the server keeps the record
  const h = historyState(JSON.parse(JSON.stringify({ history: g.history ?? {} })))
  const entry = historyEntry(g.squad)
  const level = (id: string) => playLevelOf(g, id)

  const play = async (st: HistoryStage) => {
    setBusy(true)
    const r = await act('history_play', { stage: st.id })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const { res, out } = r.result as { res: ArenaResult; out: HistoryOutcome }
    track('card_match', { mode: 'history', won: res.win, stage: st.id })
    setShown({ st, res, out })
  }

  return (
    <>
      <Panel title="历代强队" actions={<span className="tiny muted">不花体力 · 输了免费重打</span>}>
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          带五名退役选手，挑战 12 支拿过世界赛冠军的队伍。对手是那一届上场最多的五个人，
          分数用现役同一套算法、按当时为止的数据算。按顺序打，<b>每打通一章送退役选手包 ×1，全部打通再送 1 个</b>。
        </p>
        {!entry.ok && <p className="small neg" style={{ marginBottom: 0 }}>{entry.why} 去「卡组」换上五名退役选手。</p>}
      </Panel>

      {shown && (
        <MatchReport
          result={shown.res}
          opponentId={shown.st.tag}
          opponentName={`${shown.st.short} ${shown.st.team}`}
          mySquad={g.squad}
          level={level}
          onClose={() => setShown(null)}
          extra={
            <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
              {shown.out.firstClear && <span className="chiplet" style={{ color: 'var(--win)' }}>首次击败</span>}
              {shown.out.chapterDone && <span className="chiplet" style={{ color: 'var(--warn)' }}>第 {shown.out.chapterDone} 章打通</span>}
              {shown.out.full && <span className="chiplet" style={{ color: 'var(--warn)' }}>全部打通</span>}
              {shown.out.packs > 0 && <span className="chiplet" style={{ color: 'var(--warn)' }}>退役选手包 ×{shown.out.packs}</span>}
            </div>
          }
        />
      )}

      {HISTORY_CHAPTERS.map((ch) => {
        const stages = HISTORY_STAGES.filter((s) => s.chapter === ch)
        const done = stages.filter((s) => h.cleared.includes(s.id)).length
        return (
          <Panel
            key={ch}
            title={`第 ${ch} 章`}
            actions={<span className="tiny muted">{h.paid.includes(ch) ? '已打通，退役选手包已领' : `${done}/3 · 打通送退役选手包 ×1`}</span>}
          >
            {stages.map((st) => {
              const beaten = h.cleared.includes(st.id)
              const open = stageOpen(h, st.id)
              const tries = h.tries[st.id] ?? 0
              return (
                <div key={st.id} className="cm-quest">
                  <div className="cm-quest-info">
                    <b>{st.team}</b>
                    <span className="tiny faint">　{st.year} {st.event.replace(/^\d{4} /, '')}{st.result} · 对手均分 {st.rating}</span>
                    <div className="tiny muted" style={{ marginTop: 4, lineHeight: 1.6 }}>
                      {st.five.slots.map((id) => {
                        const c = id ? cardById(id) : undefined
                        return isPlayerCard(c) ? `${c.ign} ${c.rating}` : ''
                      }).filter(Boolean).join(' · ')}
                    </div>
                    {tries > 0 && <div className="tiny faint">打了 {tries} 场{beaten ? '，已击败' : ''}</div>}
                  </div>
                  <button
                    className={beaten ? 'sm' : 'primary sm'}
                    disabled={busy || !open || !entry.ok}
                    onClick={() => void play(st)}
                    title={open ? undefined : '先打赢前面的关'}
                  >
                    {!open ? '未解锁' : beaten ? '再打' : '挑战'}
                  </button>
                </div>
              )
            })}
          </Panel>
        )
      })}
    </>
  )
}
