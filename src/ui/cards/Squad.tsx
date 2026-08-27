import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardSlot } from '../Card'
import { Panel } from '../common'
import { autoSquad, collection, levelOf, personTaken, setSlot } from '../../engine/gacha'
import { SQUAD_SLOTS, chemistry, isCoachCard, isPlayerCard, cardById, squadRating } from '../../engine/cards'
import { roleGaps } from '../../engine/arena'

const WHY_CN = { club: '同队', nat: '同国籍', region: '同赛区' } as const

export default function SquadScreen() {
  const { g, commit, toast } = useCards()
  const [picking, setPicking] = useState<number | 'coach' | null>(null)
  const [q, setQ] = useState('')

  const level = (id: string) => levelOf(g, id)
  // Not memoised on g.squad: the squad object is mutated in place, so a memo
  // keyed on it never recomputes and the chemistry panel goes stale the moment
  // a slot changes. Ten pairs of comparisons is not worth caching anyway.
  const chem = chemistry(g.squad)
  const rating = squadRating(g.squad, level)
  const gaps = roleGaps(g.squad)
  const filled = g.squad.slots.filter(Boolean).length

  const options = useMemo(() => {
    const want = picking === 'coach' ? 'coach' : 'player'
    const text = q.trim().toLowerCase()
    return collection(g)
      .filter(({ card }) => (want === 'coach' ? isCoachCard(card) : isPlayerCard(card)))
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
  }, [g, picking, q])

  const pick = (cardId: string | null) => {
    if (picking === 'coach') g.squad.coach = cardId
    else if (typeof picking === 'number') setSlot(g, picking, cardId)
    setPicking(null)
    setQ('')
    commit(true)
  }

  return (
    <>
      <Panel
        title="我的卡组"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button
              className="sm"
              onClick={() => { g.squad = autoSquad(g); commit(true); toast('已按默契和评分自动组队。') }}
            >
              自动组队
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
                footer={chem.misfits.includes(i) ? `不熟悉${role}` : role}
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
              默契来自真实关系：<b>同一支俱乐部</b>最高，其次<b>同国籍</b>，再次<b>同赛区</b>。
              一套默契高的阵容，能打赢平均分比它高四五分的全明星——这是这个模式最值钱的一条规则。
            </p>

            {filled < 5 && <p className="small warn">还差 {5 - filled} 个人。</p>}
            {!!gaps.length && (
              <p className="small warn">没人打得了：{gaps.join('、')}——比赛里会被针对。</p>
            )}
            {chem.noIgl && filled > 0 && <p className="small warn">阵容里没有指挥，中局决策会吃亏。</p>}
            {!!chem.notes.length && (
              <p className="tiny faint" style={{ marginBottom: 0 }}>{chem.notes.join(' · ')}</p>
            )}

            {!!chem.links.length && (
              <div style={{ marginTop: 12 }}>
                <div className="tiny faint" style={{ marginBottom: 5 }}>已连上的关系（{chem.links.length} 条）</div>
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
              <input
                autoFocus
                placeholder="搜 ID / 真名 / 战队 / 位置"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              {options.length === 0 ? (
                <p className="empty">
                  {picking === 'coach' ? '还没有教练卡，去开一个教练包。' : '没有可选的卡，先去抽卡。'}
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
