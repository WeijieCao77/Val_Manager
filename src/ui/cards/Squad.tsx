import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardSlot } from '../Card'
import { Panel } from '../common'
import {
  SQUAD_PRESETS, autoSquad, clearPreset, collection, levelOf, loadPreset,
  personTaken, presetsOf, renamePreset, savePreset, setSlot,
} from '../../engine/gacha'
import { SQUAD_SLOTS, chemistry, isCoachCard, isPlayerCard, cardById, squadRating } from '../../engine/cards'
import { roleGaps } from '../../engine/arena'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import ShareSquad from './ShareSquad'
import type { CardFilter } from './Filters'

const WHY_CN = { club: '同队', nat: '同国籍', region: '同赛区' } as const

export default function SquadScreen() {
  const { g, commit, toast } = useCards()
  const [picking, setPicking] = useState<number | 'coach' | null>(null)
  const [q, setQ] = useState('')
  // 「卡组选选手的地方也加个筛选器」. The same bar as the collection and the
  // trading post — metal, region, position (with 指挥), club — because a
  // collection of four hundred cards is not a list you scroll to find the
  // Chinese sentinel you meant.
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)
  const [sharing, setSharing] = useState(false)

  const level = (id: string) => levelOf(g, id)
  const presets = presetsOf(g)
  const [renaming, setRenaming] = useState<number | null>(null)
  // Not memoised on g.squad: the squad object is mutated in place, so a memo
  // keyed on it never recomputes and the chemistry panel goes stale the moment
  // a slot changes. Ten pairs of comparisons is not worth caching anyway.
  const chem = chemistry(g.squad)
  const rating = squadRating(g.squad, level)
  const gaps = roleGaps(g.squad)
  const filled = g.squad.slots.filter(Boolean).length

  /** everything that could go in this seat, before the filter bar narrows it */
  const pool = useMemo(() => {
    const want = picking === 'coach' ? 'coach' : 'player'
    return collection(g)
      .filter(({ card }) => (want === 'coach' ? isCoachCard(card) : isPlayerCard(card)))
      .map(({ card }) => card)
  }, [g, picking])

  const options = useMemo(() => {
    const want = picking === 'coach' ? 'coach' : 'player'
    const text = q.trim().toLowerCase()
    return collection(g)
      .filter(({ card }) => (want === 'coach' ? isCoachCard(card) : isPlayerCard(card)))
      .filter(({ card }) => matchesFilter(card, filter))
      .filter(({ card }) => {
        if (!text) return true
        const name = isPlayerCard(card)
          ? `${card.ign} ${card.realName ?? ''} ${card.clubTag ?? ''} ${card.roles.join('')}`
          : `${card.name} ${card.clubTag ?? ''}`
        return name.toLowerCase().includes(text)
      })
      // the ones that cover the seat being filled float to the top
      .sort((a, b) => {
        if (typeof picking === 'number') {
          const role = SQUAD_SLOTS[picking]
          const fa = isPlayerCard(a.card) && a.card.roles.includes(role) ? 1 : 0
          const fb = isPlayerCard(b.card) && b.card.roles.includes(role) ? 1 : 0
          if (fa !== fb) return fb - fa
        }
        return b.rating - a.rating
      })
  }, [g, picking, q, filter])

  const pick = (cardId: string | null) => {
    if (picking === 'coach') g.squad.coach = cardId
    else if (typeof picking === 'number') setSlot(g, picking, cardId)
    setPicking(null)
    setQ('')
    setFilter(EMPTY_FILTER)
    commit(true)
  }

  return (
    <>
      {/* Three fives, because the people who asked for this keep two or three
          on the go — an all-EMEA one, an all-Pacific one, and the one with
          their favourites in it — and rebuilding a five card by card to try
          the other one is what stops them trying it at all. */}
      <Panel
        title="卡组配置"
        actions={<span className="tiny muted">存 {SQUAD_PRESETS} 套，随时切换</span>}
      >
        <div className="row wrap" style={{ gap: 8 }}>
          {presets.map((rec, i) => {
            const score = rec ? squadRating(rec.squad, level) : 0
            const filledN = rec ? rec.squad.slots.filter(Boolean).length : 0
            return (
              <div key={i} className="preset-box">
                {renaming === i ? (
                  <input
                    autoFocus
                    defaultValue={rec?.name ?? `配置 ${i + 1}`}
                    maxLength={12}
                    onBlur={(e) => { renamePreset(g, i, e.target.value); setRenaming(null); commit(true) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  />
                ) : (
                  <button
                    className="preset-name"
                    title="改名字"
                    onClick={() => rec && setRenaming(i)}
                  >
                    {rec?.name ?? `配置 ${i + 1}`}
                  </button>
                )}
                <div className="tiny faint mono">
                  {rec ? `${filledN}/5 人 · 阵容分 ${score}` : '空'}
                </div>
                <div className="row" style={{ gap: 5, marginTop: 6 }}>
                  <button
                    className="sm"
                    onClick={() => {
                      const r = savePreset(g, i)
                      commit(true)
                      toast(`当前卡组已存进「${r.name}」。`)
                    }}
                  >
                    存
                  </button>
                  <button
                    className="sm primary"
                    disabled={!rec}
                    onClick={() => {
                      const r = loadPreset(g, i)
                      commit(true)
                      toast(r.missing
                        ? `已读取「${rec!.name}」，${r.missing} 张卡已不在收藏里，位置留空。`
                        : `已切换到「${rec!.name}」。`)
                    }}
                  >
                    读
                  </button>
                  {rec && (
                    <button
                      className="sm ghost"
                      title="清空这个位置"
                      onClick={() => { clearPreset(g, i); commit(true) }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          存的是卡的编号，分解掉的卡读出来时位置会空着。
        </p>
      </Panel>

      <Panel
        title="我的卡组"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button
              className="sm"
              onClick={() => { g.squad = autoSquad(g); commit(true); toast('已按评分、默契和指挥自动组队。') }}
            >
              自动组队
            </button>
            {/* 「可以生成一张图片分享阵容，还可以扫二维码直接打开」 */}
            <button className="sm" onClick={() => setSharing(true)}>分享阵容</button>
            {/* One click, no dialog —「卡组里加一个一键清空当前配置的功能」.
                Clearing five seats one modal at a time was the only way to
                start a five from nothing. The saved presets are untouched,
                so a wrong click costs a 「读」. */}
            <button
              className="sm ghost"
              title="清空五个位置和教练，存过的配置不受影响"
              onClick={() => {
                if (!g.squad.slots.some(Boolean) && !g.squad.coach) { toast('卡组已经是空的。'); return }
                for (let i = 0; i < g.squad.slots.length; i++) setSlot(g, i, null)
                g.squad.coach = null
                commit(true)
                toast('已清空当前卡组，存过的配置还在。')
              }}
            >
              清空卡组
            </button>
          </div>
        }
      >
        <div className="cm-squad">
          {SQUAD_SLOTS.map((role, i) => {
            const id = g.squad.slots[i]
            const card = id ? cardById(id) : null
            return card ? (
              <CardFace
                key={i}
                card={card}
                level={level(card.id)}
                selected={chem.misfits.includes(i)}
                onClick={() => setPicking(i)}
                footer={chem.misfits.includes(i) ? `不熟悉${role}`
                  // he covers this position but it is not his first — say so
                  // affirmatively, or a badge that disagrees with the column
                  // reads as a misplacement
                  : isPlayerCard(card) && card.role !== role && role !== '自由人'
                    ? `${role} · 兼任`
                    : role}
              />
            ) : (
              <CardSlot key={i} label={role} onClick={() => setPicking(i)} />
            )
          })}
        </div>

        <div className="row wrap" style={{ gap: 16, marginTop: 16, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 150 }}>
            <div className="tiny faint">教练</div>
            {g.squad.coach && cardById(g.squad.coach) ? (
              <div style={{ marginTop: 6 }}>
                <CardFace
                  card={cardById(g.squad.coach)!}
                  level={level(g.squad.coach)}
                  size="sm"
                  onClick={() => setPicking('coach')}
                />
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <CardSlot label="教练" onClick={() => setPicking('coach')} hint="教练包里开得到" />
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="row" style={{ gap: 20, marginBottom: 10 }}>
              <div>
                <div className="tiny faint">阵容分</div>
                <div className="display" style={{ fontSize: 34, lineHeight: 1 }}>{rating}</div>
              </div>
              <div>
                <div className="tiny faint">默契</div>
                <div className="display" style={{
                  fontSize: 34, lineHeight: 1,
                  color: chem.score >= 60 ? 'var(--win)' : chem.score >= 35 ? 'var(--warn)' : 'var(--loss)',
                }}>
                  {chem.score}
                </div>
              </div>
            </div>

            <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
              默契来自真实关系：<b>同一支俱乐部</b>最高，其次<b>同国籍</b>，再次<b>同赛区</b>。默契高的阵容能打赢评分更高的对手。
            </p>

            {filled < 5 && <p className="small warn">还差 {5 - filled} 个人。</p>}
            {!!gaps.length && (
              <p className="small warn">没人打得了：{gaps.join('、')}，比赛里会吃亏。</p>
            )}
            {chem.noIgl && filled > 0 && <p className="small warn">没有指挥，中局决策会吃亏。</p>}
            {!!chem.notes.length && (
              <p className="tiny faint" style={{ marginBottom: 0 }}>{chem.notes.join(' · ')}</p>
            )}

            {!!chem.links.length && (
              <div style={{ marginTop: 12 }}>
                <div className="tiny faint" style={{ marginBottom: 5 }}>默契关系（{chem.links.length} 条）</div>
                <div className="row wrap" style={{ gap: 5 }}>
                  {chem.links.map((l, i) => {
                    const a = g.squad.slots[l.a] ? cardById(g.squad.slots[l.a]!) : undefined
                    const b = g.squad.slots[l.b] ? cardById(g.squad.slots[l.b]!) : undefined
                    if (!isPlayerCard(a) || !isPlayerCard(b)) return null
                    return (
                      <span
                        key={i}
                        className="trait"
                        data-good="y"
                        title={`${a.ign} × ${b.ign}：${WHY_CN[l.why]}`}
                      >
                        {a.ign} × {b.ign} · {WHY_CN[l.why]}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {sharing && <ShareSquad onClose={() => setSharing(false)} />}

      {picking !== null && (
        <div className="modal-bg" onClick={() => setPicking(null)}>
          <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{picking === 'coach' ? '选一名教练' : `选一名${SQUAD_SLOTS[picking]}`}</h2>
              <div className="spacer" />
              <button className="ghost sm" onClick={() => pick(null)}>清空这个位置</button>
              <button className="ghost sm" onClick={() => setPicking(null)}>关闭</button>
            </div>
            <div className="modal-body">
              <CardFilters
                value={filter}
                onChange={setFilter}
                pool={pool}
                extra={
                  <input
                    className="sm"
                    // grows into whatever the bar has left rather than a fixed
                    // 190px, which cut the placeholder off on a phone
                    style={{ flex: '1 1 170px', minWidth: 130, padding: '4px 7px' }}
                    placeholder="搜 ID / 真名 / 战队"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                }
              />
              {options.length === 0 ? (
                <p className="empty">
                  {pool.length === 0
                    ? (picking === 'coach' ? '还没有教练卡，去开一个教练包。' : '没有可选的卡，先去抽卡。')
                    : '这些条件下没有卡，放宽一点看看。'}
                </p>
              ) : (
                <div className="cm-grid sm">
                  {options.slice(0, 120).map(({ card, owned }) => {
                    const inSquad = g.squad.slots.includes(card.id) || g.squad.coach === card.id
                    // the same man under another card — picking him replaces
                    // that one rather than putting him on twice
                    const dupPerson = typeof picking === 'number'
                      && personTaken(g, card.id, picking)
                    const fits = typeof picking === 'number' && isPlayerCard(card)
                      && card.roles.includes(SQUAD_SLOTS[picking])
                    return (
                      <CardFace
                        key={card.id}
                        card={card}
                        level={owned.level}
                        size="sm"
                        dimmed={inSquad}
                        onClick={() => pick(card.id)}
                        footer={inSquad ? '已上场' : dupPerson ? '会顶替本人'
                          : fits ? '位置吻合' : undefined}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
