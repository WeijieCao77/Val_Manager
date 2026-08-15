import { useMemo, useState } from 'react'
import { createNewGame, WORLD_PLAYERS, WORLD_TEAMS } from '../engine/world'
import { setupSeason } from '../engine/season'
import { importSave } from '../engine/save'
import { REGION_CN, REGIONS } from '../engine/types'
import type { GameState, Region } from '../engine/types'
import { money, OvrBadge } from './common'

export default function NewGame({
  onStart, canContinue, onContinue,
}: { onStart: (g: GameState) => void; canContinue: boolean; onContinue: () => void }) {
  const [region, setRegion] = useState<Region>('China')
  const [tier, setTier] = useState<1 | 2>(1)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const squadStrength = useMemo(() => {
    const byTeam: Record<string, number> = {}
    for (const t of WORLD_TEAMS) {
      const squad = WORLD_PLAYERS.filter((p) => p.teamId === t.id)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 5)
      byTeam[t.id] = squad.length
        ? Math.round(squad.reduce((s, p) => s + p.overall, 0) / squad.length)
        : 0
    }
    return byTeam
  }, [])

  const list = useMemo(
    () => WORLD_TEAMS
      .filter((t) => t.region === region && t.tier === tier)
      .sort((a, b) => (squadStrength[b.id] ?? 0) - (squadStrength[a.id] ?? 0)),
    [region, tier, squadStrength],
  )

  const selected = teamId ? WORLD_TEAMS.find((t) => t.id === teamId) : null

  const begin = () => {
    if (!teamId) {
      setErr('请先选择一支战队。')
      return
    }
    if (tier === 2 && list.length < 4) {
      setErr('该赛区暂无可运行的次级联赛，请先选择其他赛区或一级联赛战队。')
      return
    }
    const g = createNewGame(teamId, name.trim() || '无名经理')
    setupSeason(g)
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
      <p className="muted" style={{ marginTop: 0, marginBottom: 26 }}>
        无畏契约电竞经理 · 执掌一支战队，征战 VCT 四大赛区与次级联赛
      </p>

      <div className="row wrap" style={{ marginBottom: 22 }}>
        {canContinue && (
          <button className="primary" onClick={onContinue}>继续上次存档</button>
        )}
        <label className="row" style={{ gap: 6 }}>
          <span className="tag" style={{ cursor: 'pointer', padding: '7px 14px' }}>导入存档文件</span>
          <input
            type="file" accept=".json,.valsave" style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
        </label>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>1 · 选择赛区</h2>
        </div>
        <div className="panel-body">
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            <div className="seg">
              {REGIONS.map((r) => (
                <button key={r} className={region === r ? 'on' : ''} onClick={() => { setRegion(r); setTeamId(null) }}>
                  {REGION_CN[r]}
                </button>
              ))}
            </div>
            <div className="seg">
              <button className={tier === 1 ? 'on' : ''} onClick={() => { setTier(1); setTeamId(null) }}>
                一级联赛 VCT
              </button>
              <button className={tier === 2 ? 'on' : ''} onClick={() => { setTier(2); setTeamId(null) }}>
                次级联赛 Challengers
              </button>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            {tier === 1
              ? '一级联赛：资源充足、对手强劲，目标直指 Masters 与 Champions。'
              : '次级联赛：预算有限，需要通过 Ascension 升级赛打进 VCT——更硬核的开局。'}
          </p>
          {tier === 2 && list.length < 4 && (
            <p className="small neg" style={{ marginBottom: 0 }}>
              该赛区目前收录的次级联赛战队不足 4 支，无法组成联赛。本作只使用真实战队与真实
              选手，不会用虚构队伍凑数——待补全 vlr.gg 的 Challengers 数据后即可开放。
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>2 · 选择战队</h2>
        </div>
        <div className="panel-body">
          <div className="team-pick">
            {list.map((t) => (
              <button
                key={t.id}
                className={`team-card${teamId === t.id ? ' sel' : ''}`}
                onClick={() => { setTeamId(t.id); setErr(null) }}
              >
                <div className="n">{t.name}</div>
                <div className="row small muted" style={{ gap: 8 }}>
                  <OvrBadge value={squadStrength[t.id] ?? 0} />
                  <span>{money(t.budget)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>3 · 经理信息</h2>
        </div>
        <div className="panel-body">
          <div className="grid c2">
            <div>
              <label className="small muted">经理名字</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入你的名字"
                maxLength={20}
              />
            </div>
            {selected && (
              <div>
                <label className="small muted">已选择</label>
                <div className="row" style={{ gap: 10, paddingTop: 7 }}>
                  <b style={{ fontSize: 17 }}>{selected.name}</b>
                  <span className="tag">{REGION_CN[selected.region as Region]}</span>
                  <span className="tag">阵容强度 {squadStrength[selected.id]}</span>
                  <span className="tag">预算 {money(selected.budget)}</span>
                </div>
              </div>
            )}
          </div>
          {err && <p className="neg small">{err}</p>}
          <div style={{ marginTop: 16 }}>
            <button className="primary" onClick={begin} disabled={!teamId}>开始职业生涯 →</button>
          </div>
        </div>
      </div>

      <p className="tiny muted" style={{ marginTop: 24, lineHeight: 1.8 }}>
        游戏内所有战队与选手均为真实人物，没有任何虚构角色。阵容、国籍、位置与全部
        比赛数据（Rating / ACS / K/D / KAST / ADR / KPR / 首杀率）取自 <b>vlr.gg</b> 的
        VCT 2026 赛季统计；选手真名与生日取自 <b>Liquipedia</b>。
        八项能力值由这些真实数据按分位映射得出——枪法来自实际 ACS / ADR / 爆头率，
        意识来自实际 KAST 与首死率，因此能力值反映的是他们真实的表现水平。
        合同、薪资与俱乐部预算为游戏平衡所需的估算值。
      </p>
    </div>
  )
}
