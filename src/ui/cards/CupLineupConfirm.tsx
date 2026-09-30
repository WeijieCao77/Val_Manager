import ChampionLineup from './ChampionLineup'
import { useDialogFocus } from './useDialogFocus'
import { cardById, cardName, squadRating } from '../../engine/cards'
import type { Squad } from '../../engine/cards'
import { levelOf } from '../../engine/gacha'
import type { GachaState } from '../../engine/gacha'
import type { CupPick } from '../../engine/openCupClient'

/**
 * 确认参赛阵容 — the sheet between 报名 and the sign-up itself, for 全服杯 and 组队杯.
 *
 * Both cups used to read the five at the start, whatever it was by then: a
 * player who signed up, then changed the squad for the ladder, played the cup
 * with a five they had not chosen for it, and one who changed it back
 * afterwards saw neither on the report. Signing up now records the five shown
 * here, and the start plays exactly that five (at the levels it reads then).
 */
export default function CupLineupConfirm({
  g, squad, starts, swap, busy, onConfirm, onClose,
}: {
  g: GachaState
  squad: Squad
  starts: string
  /** already signed up: this replaces the registered five */
  swap: boolean
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onClose() })
  const level = (id: string) => levelOf(g, id)
  const ids = [...squad.slots, squad.coach].filter((id): id is string => !!id)
  const levels = Object.fromEntries(ids.map((id) => [id, level(id)]))
  return (
    <div className="modal-bg" onClick={() => { if (!busy) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="确认参赛阵容" tabIndex={-1} className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{swap ? '换成这套阵容' : '确认参赛阵容'}</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose} disabled={busy}>关闭</button>
        </div>
        <div className="modal-body">
          <ChampionLineup five={{ slots: squad.slots, coach: squad.coach, levels }} />
          <p className="small" style={{ margin: '10px 0 4px' }}>
            {lineupText(squad, level)}
          </p>
          <p className="small muted" style={{ margin: 0, lineHeight: 1.7 }}>
            阵容分 <b>{squadRating(squad, level)}</b>。{starts} 开赛，<b>按这套阵容上场</b>，强化等级按开赛时算。
            报名后再改卡组不影响这一场；想换，回来点「换成现在的阵容」。
          </p>
          <div className="row" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
            <div className="spacer" />
            <button className="sm" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary sm" onClick={onConfirm} disabled={busy}>
              {busy ? '提交中…' : swap ? '确认更换' : '确认报名'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 「A +3 · B +5 · … · 教练 C +1」 */
export function lineupText(five: CupPick, level: (id: string) => number): string {
  const name = (id: string) => { const c = cardById(id); return `${c ? cardName(c) : id} +${level(id)}` }
  const players = five.slots.filter((id): id is string => !!id).map(name)
  return [...players, ...(five.coach ? [`教练 ${name(five.coach)}`] : [])].join(' · ')
}

/** the registered five and the squad on the 卡组 page, seat for seat */
export const samePick = (a: CupPick, b: CupPick): boolean =>
  a.coach === b.coach && a.slots.length === b.slots.length && a.slots.every((id, i) => id === b.slots[i])

/**
 * 已报名 — the five this entry will field, and a way to swap it while the cup is still open.
 * An entry made before picks were recorded has none: it plays the five at the start, as it always did.
 */
export function SignedLineup({
  g, pick, busy, onSwap,
}: {
  g: GachaState
  pick: CupPick | undefined
  busy: boolean
  onSwap: () => void
}) {
  const level = (id: string) => levelOf(g, id)
  const now: CupPick = { slots: g.squad.slots.slice(0, 5), coach: g.squad.coach }
  const filled = now.slots.filter(Boolean).length === 5
  if (!pick) {
    return (
      <p className="tiny faint" style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
        开赛时用你当时的卡组。
        {filled && <button className="sm ghost" style={{ marginLeft: 6 }} disabled={busy} onClick={onSwap}>锁定现在的阵容</button>}
      </p>
    )
  }
  const differs = !samePick(pick, now)
  return (
    <div style={{ marginTop: 8 }}>
      <p className="tiny" style={{ margin: 0, lineHeight: 1.7 }}>
        <span className="muted">报名阵容：</span>{lineupText(pick, level)}
      </p>
      {differs && (
        <p className="tiny" style={{ margin: '4px 0 0', lineHeight: 1.7 }}>
          <span style={{ color: 'var(--warn)' }}>和现在的卡组不一样，本场按报名阵容上场。</span>
          {filled && <button className="sm ghost" style={{ marginLeft: 6 }} disabled={busy} onClick={onSwap}>换成现在的阵容</button>}
        </p>
      )}
    </div>
  )
}
