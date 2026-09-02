import type { GameState, Tactics } from '../engine/types'
import { mapCn } from '../engine/content'

export const SLIDERS: {
  key: keyof Tactics; label: string; lo: string; hi: string; hint: string
}[] = [
  { key: 'pace', label: '节奏', lo: '慢速运营', hi: '快速突破', hint: '快节奏提升进攻端压制力，但防守容易被拉扯。双决斗吃这个，双哨卫怕这个。' },
  { key: 'utility', label: '道具', lo: '节省', hi: '全开', hint: '道具全开两端都强，道具属性高的五人收益更大；双控场靠它活。' },
  { key: 'aggression', label: '侵略性', lo: '保守', hi: '激进', hint: '激进打法进攻收益高，防守端风险更大；对面是双决斗时别拉满。' },
  { key: 'adaptability', label: '中局应变', lo: '照战术板', hi: '随机应变', hint: '应变能力依赖指挥（IGL），落后时更容易翻盘。' },
]

export const DEFAULT_TACTICS: Tactics = {
  pace: 50, utility: 55, aggression: 50, adaptability: 50,
}

/**
 * The four dials, wherever they are being set.
 *
 * These belong to a map, not to a settings page — the agent sheet was already
 * per map, and one set of sliders for three different maps was the thing
 * people asked about. With `map` the control edits that map's own setting
 * (created from the general one the first time it is touched); without it, it
 * edits the general setting that every map without its own falls back to.
 * `compact` trims the explanations down when space is tight.
 */
export default function TacticSliders({
  game, commit, compact = false, map,
}: { game: GameState; commit: () => void; compact?: boolean; map?: string }) {
  const me = game.teams[game.myTeam]
  const own = map ? game.mapTactics?.[map] : undefined
  const cur: Tactics = own ?? me.tactics
  const set = (k: keyof Tactics, v: number) => {
    if (map) game.mapTactics = { ...(game.mapTactics ?? {}), [map]: { ...cur, [k]: v } }
    else me.tactics = { ...me.tactics, [k]: v }
    commit()
  }
  const forget = () => {
    if (!map) { me.tactics = { ...DEFAULT_TACTICS }; commit(); return }
    const next = { ...(game.mapTactics ?? {}) }
    delete next[map]
    game.mapTactics = Object.keys(next).length ? next : undefined
    commit()
  }

  return (
    <>
      {SLIDERS.map((s) => (
        <div key={s.key} style={{ marginBottom: compact ? 9 : 16 }}>
          <div className="slider-row">
            <span className="small">{s.label}</span>
            <input
              type="range" min={0} max={100} value={cur[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
            />
            <span className="mono right" style={{ fontWeight: 700 }}>{cur[s.key]}</span>
          </div>
          <div className="row tiny muted" style={{ justifyContent: 'space-between', marginTop: -6 }}>
            <span>{s.lo}</span><span>{s.hi}</span>
          </div>
          {!compact && <div className="tiny muted" style={{ marginTop: 4 }}>{s.hint}</div>}
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        {map ? (
          own ? (
            <>
              <span className="tag" style={{ borderColor: 'var(--accent-line)', color: 'var(--accent)' }}>
                {mapCn(map)} 专用
              </span>
              <button className="sm ghost" onClick={forget}>改回通用设置</button>
            </>
          ) : (
            <span className="tiny faint">现在用的是通用设置——一拖就变成{mapCn(map)}专用</span>
          )
        ) : (
          <button className="sm ghost" onClick={forget}>重置为默认</button>
        )}
      </div>
    </>
  )
}
