import type { GameState, Tactics } from '../engine/types'

export const SLIDERS: {
  key: keyof Tactics; label: string; lo: string; hi: string; hint: string
}[] = [
  { key: 'pace', label: '节奏', lo: '慢速运营', hi: '快速突破', hint: '快节奏提升进攻端压制力，但防守容易被拉扯。' },
  { key: 'utility', label: '道具', lo: '节省', hi: '全开', hint: '道具开销大能提升整体执行力，对道具能力强的阵容收益更高。' },
  { key: 'aggression', label: '侵略性', lo: '保守', hi: '激进', hint: '激进打法进攻收益高，防守端风险更大。' },
  { key: 'adaptability', label: '中局应变', lo: '照战术板', hi: '随机应变', hint: '应变能力依赖指挥（IGL），落后时更容易翻盘。' },
]

export const DEFAULT_TACTICS: Tactics = {
  pace: 50, utility: 55, aggression: 50, adaptability: 50,
}

/**
 * The four dials, wherever they are being set.
 *
 * These belong to a match, not to a settings page — a team does not pick one
 * approach in January and hold it all season. The same control therefore
 * appears before kickoff and inside a timeout, `compact` trimming the
 * explanations down when space is tight.
 */
export default function TacticSliders({
  game, commit, compact = false,
}: { game: GameState; commit: () => void; compact?: boolean }) {
  const me = game.teams[game.myTeam]
  const set = (k: keyof Tactics, v: number) => {
    me.tactics = { ...me.tactics, [k]: v }
    commit()
  }

  return (
    <>
      {SLIDERS.map((s) => (
        <div key={s.key} style={{ marginBottom: compact ? 9 : 16 }}>
          <div className="slider-row">
            <span className="small">{s.label}</span>
            <input
              type="range" min={0} max={100} value={me.tactics[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
            />
            <span className="mono small right">{me.tactics[s.key]}</span>
          </div>
          <div className="row tiny muted" style={{ justifyContent: 'space-between', marginTop: -6 }}>
            <span>{s.lo}</span><span>{s.hi}</span>
          </div>
          {!compact && <div className="tiny muted" style={{ marginTop: 4 }}>{s.hint}</div>}
        </div>
      ))}
      <button
        className="sm ghost"
        onClick={() => { me.tactics = { ...DEFAULT_TACTICS }; commit() }}
      >
        重置为默认
      </button>
    </>
  )
}
