import { useMemo, useState } from 'react'
import { createNewGame, WORLD_PLAYERS, WORLD_TEAMS } from '../engine/world'
import { setupSeason } from '../engine/season'
import { importSave } from '../engine/save'
import { track } from '../engine/telemetry'
import { hashStr } from '../engine/rng'
import {
  AGE_MAX, AGE_MIN, POINT_STEP, SKILL_CN, SKILL_HINT, SKILL_MAX, TALENT_POINTS,
  ageBand, canManage, createManager, dealOrigins, spendPoint,
} from '../engine/manager'
import type { ManagerOrigin } from '../engine/manager'
import { REGION_CN, REGIONS } from '../engine/types'
import type { GameState, Region } from '../engine/types'
import { money, OvrBadge, Bar } from './common'

export default function NewGame({
  onStart, canContinue, onContinue,
}: { onStart: (g: GameState) => void; canContinue: boolean; onContinue: () => void }) {
  const [name, setName] = useState('')
  const [age, setAge] = useState(24)
  const [originKey, setOriginKey] = useState<string | null>(null)
  const [region, setRegion] = useState<Region>('China')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // the three on offer are dealt from the eight, and stay fixed for this run
  const [dealSeed] = useState(() => (hashStr(String(Date.now())) >>> 0))
  const offered = useMemo(() => dealOrigins(dealSeed, 3), [dealSeed])
  const origin = offered.find((o) => o.key === originKey) ?? null
  const [spent, setSpent] = useState<Record<string, number>>({})

  const manager = useMemo(
    () => {
      if (!origin) return null
      const m = createManager(name, age, origin.key)
      // replay the allocation on top of a fresh manager, so it survives the memo
      for (const [k, n] of Object.entries(spent)) {
        for (let i = 0; i < n; i++) spendPoint(m, k as never, 1)
      }
      return m
    },
    [name, age, origin, spent],
  )
  const band = ageBand(age)

  const squadStrength = useMemo(() => {
    const by: Record<string, number> = {}
    for (const t of WORLD_TEAMS) {
      const s = WORLD_PLAYERS.filter((p) => p.teamId === t.id)
        .sort((a, b) => b.overall - a.overall).slice(0, 5)
      by[t.id] = s.length ? Math.round(s.reduce((n, p) => n + p.overall, 0) / s.length) : 0
    }
    return by
  }, [])

  // the strongest three in each league are never on offer at the start
  const lockedTop = useMemo(() => {
    const set = new Set<string>()
    for (const r of REGIONS) {
      WORLD_TEAMS.filter((t) => t.region === r && t.tier === 1)
        .sort((a, b) => b.rating - a.rating).slice(0, 3)
        .forEach((t) => set.add(t.id))
    }
    return set
  }, [])

  const byTier = useMemo(() => {
    const inRegion = WORLD_TEAMS.filter((t) => t.region === region)
      .sort((a, b) => (squadStrength[b.id] ?? 0) - (squadStrength[a.id] ?? 0))
    return {
      1: inRegion.filter((t) => t.tier === 1),
      2: inRegion.filter((t) => t.tier === 2),
    }
  }, [region, squadStrength])

  const available = (t: (typeof WORLD_TEAMS)[number]) =>
    !!manager && canManage(manager.reputation, t.reputation, lockedTop.has(t.id))

  const selected = teamId ? WORLD_TEAMS.find((t) => t.id === teamId) : null

  const begin = () => {
    if (!manager) return setErr('请先选择一个出身。')
    if (!teamId) return setErr('请先选择一支战队。')
    const g = createNewGame(teamId, manager.name, undefined, manager)
    setupSeason(g)
    track('career_start', {
      club: selected?.tag ?? null,
      tier: selected?.tier === 1 ? 'VCT' : 'CHAL',
      region: selected?.region ?? null,
      origin: originKey,
      age,
    })
    onStart(g)
  }

  const onImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        onStart(importSave(String(reader.result)))
      } catch (e) {
        setErr(e instanceof Error ? e.message : '存档读取失败。')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="newgame">
      <h1>VAL<span className="r"> MANAGER</span></h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
        无畏契约电竞经理 · 执掌一支战队，征战 VCT 四大赛区与次级联赛
      </p>

      <div className="row wrap" style={{ marginBottom: 20 }}>
        {canContinue && <button className="primary" onClick={onContinue}>继续上次存档</button>}
        <label>
          <span className="tag" style={{ cursor: 'pointer', padding: '7px 14px' }}>导入存档文件</span>
          <input type="file" accept=".json" style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        </label>
      </div>

      {/* ---------------------------------------------------------- 1 你是谁 */}
      <div className="panel">
        <div className="panel-head"><h2>1 · 你是谁</h2></div>
        <div className="panel-body">
          <div className="grid c2">
            <div>
              <label className="small muted">名字</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="输入你的名字" maxLength={20} />
            </div>
            <div>
              <label className="small muted">
                年龄 · <b>{band.label}</b>
              </label>
              <div className="row" style={{ gap: 10 }}>
                <input type="range" min={AGE_MIN} max={AGE_MAX} value={age}
                  onChange={(e) => { setAge(Number(e.target.value)); setTeamId(null) }} />
                <input type="number" min={AGE_MIN} max={AGE_MAX} value={age}
                  style={{ width: 74 }}
                  onChange={(e) => { setAge(Number(e.target.value) || AGE_MIN); setTeamId(null) }} />
              </div>
              <div className="tiny faint" style={{ marginTop: 4 }}>{band.note}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- 2 出身 */}
      <div className="panel">
        <div className="panel-head">
          <h2>2 · 出身（随机抽到 3 个，选 1 个）</h2>
        </div>
        <div className="panel-body">
          <div className="grid c3">
            {offered.map((o) => (
              <OriginCard
                key={o.key} origin={o}
                selected={originKey === o.key}
                onPick={() => { setOriginKey(o.key); setTeamId(null); setErr(null) }}
              />
            ))}
          </div>
          <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0 }}>
            每个出身都是 2 强 1 弱、幅度相同，没有强弱之分，差别只在你拿到哪些工具。
            出身主要影响背景故事与起步声望。
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------- 3 球队 */}
      <div className="panel">
        <div className="panel-head">
          <h2>3 · 选择战队</h2>
          {manager && (
            <>
              <div className="spacer" />
              <span className="tag t1">声望 {manager.reputation}</span>
            </>
          )}
        </div>
        <div className="panel-body">
          {!manager ? (
            <div className="empty">先确定你的年龄与出身，才知道哪些俱乐部愿意请你。</div>
          ) : (
            <>
              <div className="seg" style={{ marginBottom: 14 }}>
                {REGIONS.map((r) => (
                  <button key={r} className={region === r ? 'on' : ''}
                    onClick={() => { setRegion(r); setTeamId(null) }}>{REGION_CN[r]}</button>
                ))}
              </div>
              {([1, 2] as const).map((tier) => byTier[tier].length > 0 && (
                <div key={tier} style={{ marginBottom: 16 }}>
                  <div className="nav-group" style={{ padding: '0 0 7px' }}>
                    {tier === 1
                      ? `一级联赛 · VCT ${REGION_CN[region]}（${byTier[tier].length} 队）`
                      : `次级联赛 · Challengers ${REGION_CN[region]}（${byTier[tier].length} 队）`}
                    <span className="tiny faint" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                      {tier === 1
                        ? 'Kickoff → Stage 1 → Stage 2，可争夺 Masters 与 Champions'
                        : '两个赛段，冠军通过 Ascension 升入 VCT'}
                    </span>
                  </div>
                  <div className="team-pick">
                {byTier[tier].map((t) => {
                  const ok = available(t)
                  const top = lockedTop.has(t.id)
                  return (
                    <button key={t.id}
                      className={`team-card${teamId === t.id ? ' sel' : ''}${ok ? '' : ' locked'}`}
                      disabled={!ok}
                      title={top ? '联赛顶尖球队，需要靠成绩解锁' : ok ? '' : '你的声望还不足以接手这支球队'}
                      onClick={() => { setTeamId(t.id); setErr(null) }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                        <div className="n">{t.name}</div>
                        <span className={`tag ${t.tier === 1 ? 't1' : ''}`}>
                          {t.tier === 1 ? 'VCT' : 'CHAL'}
                        </span>
                      </div>
                      <div className="row small muted" style={{ gap: 8 }}>
                        <OvrBadge value={squadStrength[t.id] ?? 0} />
                        <span>{money(t.budget)}</span>
                        {!ok && <span className="tiny">{top ? '🔒 顶级' : '🔒 声望不足'}</span>}
                      </div>
                    </button>
                  )
                })}
                  </div>
                </div>
              ))}
              <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0 }}>
                声望决定哪些俱乐部愿意请你。每个赛区最强的三支球队开局永远锁定——
                那是靠成绩换来的位置，不是开局能挑的。
              </p>
            </>
          )}
        </div>
      </div>

      {selected && manager && (
        <div className="panel own">
          <div className="panel-body">
            <div className="row wrap" style={{ gap: 10 }}>
              <b style={{ fontSize: 17 }}>{selected.name}</b>
              <span className="tag">{REGION_CN[selected.region as Region]}</span>
              <span className="tag">阵容强度 {squadStrength[selected.id]}</span>
              <span className="tag">{manager.age} 岁 · {origin?.label}</span>
            </div>
          </div>
        </div>
      )}

      {manager && (
        <div className="panel">
          <div className="panel-head">
            <h2>天赋点 · 剩余 {manager.points ?? 0} / {TALENT_POINTS}</h2>
            {Object.keys(spent).length > 0 && (
              <button className="sm ghost" onClick={() => setSpent({})}>重置</button>
            )}
          </div>
          <div className="panel-body">
            <p className="small muted" style={{ marginTop: 0 }}>
              每点 +{POINT_STEP}，上限 {SKILL_MAX}。<b>8 点不够样样精通</b>——
              可以把两项拉满，也可以摊平但都不突出。出身决定你从哪开始，天赋决定你走向哪。
            </p>
            <div className="grid c2" style={{ gap: 10 }}>
              {(Object.keys(SKILL_CN) as (keyof typeof SKILL_CN)[]).map((k) => {
                const v = manager.skills[k]
                const base = manager.baseSkills?.[k] ?? v
                const added = spent[k] ?? 0
                return (
                  <div key={k} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="small" style={{ width: 52 }}>
                      {SKILL_CN[k]}
                      {base > 50 && <span className="tiny" style={{ color: 'var(--win)' }}> ▲</span>}
                      {base < 50 && <span className="tiny" style={{ color: 'var(--accent)' }}> ▼</span>}
                    </span>
                    <button className="sm ghost" disabled={added <= 0}
                      onClick={() => setSpent((x) => ({ ...x, [k]: (x[k] ?? 0) - 1 }))}>−</button>
                    <Bar value={v} />
                    <span className="mono small" style={{ width: 24 }}>{v}</span>
                    <button className="sm" disabled={(manager.points ?? 0) <= 0 || v >= SKILL_MAX}
                      onClick={() => setSpent((x) => ({ ...x, [k]: (x[k] ?? 0) + 1 }))}>+</button>
                    <span className="tiny faint" style={{ flex: 1 }}>{SKILL_HINT[k]}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {err && <p className="neg small">{err}</p>}
      <div style={{ marginTop: 14 }}>
        <button className="primary" onClick={begin} disabled={!manager || !teamId}>
          开始职业生涯 →
        </button>
      </div>

      <p className="tiny faint" style={{ marginTop: 20, marginBottom: 0 }}>
        猪之家 制作
      </p>
      <p className="tiny muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
        游戏内所有战队与选手均为真实人物。阵容、国籍、位置与全部比赛数据取自 <b>vlr.gg</b> 的
        VCT 2026 赛季统计；真名、生日、教练与指挥取自 <b>Liquipedia</b>；英雄池取自真实出场记录。
        八项能力值由这些真实数据按分位映射得出。合同、薪资与预算为游戏平衡所需的估算值。
      </p>
    </div>
  )
}

function OriginCard({
  origin, selected, onPick,
}: { origin: ManagerOrigin; selected: boolean; onPick: () => void }) {
  return (
    <button className={`origin-card${selected ? ' sel' : ''}`} onClick={onPick}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b style={{ fontSize: 15 }}>{origin.label}</b>
        <span className="tiny faint">声望 {origin.repMod >= 0 ? '+' : ''}{origin.repMod}</span>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 10px', lineHeight: 1.6 }}>{origin.blurb}</p>
      <div className="row wrap" style={{ gap: 4 }}>
        {origin.strong.map((s) => (
          <span key={s} className="trait" data-good="y" title={SKILL_HINT[s]}>{SKILL_CN[s]}</span>
        ))}
        <span className="trait" data-good="n" title={SKILL_HINT[origin.weak]}>{SKILL_CN[origin.weak]}</span>
      </div>
      {!!origin.startingFunds && (
        <div className="tiny pos" style={{ marginTop: 8 }}>
          自带启动资金 {money(origin.startingFunds)}
        </div>
      )}
    </button>
  )
}
