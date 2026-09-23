import { useDialogFocus } from './useDialogFocus'
import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardSlot } from '../Card'
import { Panel } from '../common'
import {
  autoSquad, collection, levelOf, personTaken, setSlot,
} from '../../engine/gacha'
import { SQUAD_SLOTS, chemistry, isCoachCard, isPlayerCard, cardById, squadPaper, squadPower, squadPowerPoints, squadRating } from '../../engine/cards'
import { roleGaps } from '../../engine/arena'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import ShareSquad from './ShareSquad'
import SquadPresets from './SquadPresets'
import CardDetail from './CardDetail'
import { GapOdds } from './GapOdds'
import type { CardFilter } from './Filters'

const WHY_CN = { club: '同队', nat: '同国籍', region: '同赛区' } as const
const COACH_WHY_CN = { club: '同队', coached: '带过', region: '同赛区' } as const
const fmt = (n: number) => n.toLocaleString('en-US')

export default function SquadScreen() {
  const { g, version, commit, toast, go } = useCards()
  const [picking, setPicking] = useState<number | 'coach' | null>(null)
  // 「先点开，展示这张卡的详细信息……然后还有个按键是点替换」: a seat with a
  // card in it opens the card (level, upgrade, market price) first; an empty
  // seat still goes straight to the picker
  const [viewing, setViewing] = useState<number | 'coach' | null>(null)
  const [q, setQ] = useState('')
  // 「卡组选选手的地方也加个筛选器」. The same bar as the collection and the
  // trading post — metal, region, position (with 指挥), club — because a
  // collection of four hundred cards is not a list you scroll to find the
  // Chinese sentinel you meant.
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)
  const [sharing, setSharing] = useState(false)
  const pickerRef = useDialogFocus(() => setPicking(null), picking !== null)

  const level = (id: string) => levelOf(g, id)
  // Not memoised on g.squad: the squad object is mutated in place, so a memo
  // keyed on it never recomputes and the chemistry panel goes stale the moment
  // a slot changes. Ten pairs of comparisons is not worth caching anyway.
  const chem = chemistry(g.squad)
  const rating = squadRating(g.squad, level)
  const power = squadPower(g.squad, level)
  const paper = squadPaper(g.squad, level)
  const pts = squadPowerPoints
  const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))
  const gaps = roleGaps(g.squad)
  const filled = g.squad.slots.filter(Boolean).length

  /** everything that could go in this seat, before the filter bar narrows it */
  const pool = useMemo(() => {
    const want = picking === 'coach' ? 'coach' : 'player'
    return collection(g)
      .filter(({ card }) => (want === 'coach' ? isCoachCard(card) : isPlayerCard(card)))
      .map(({ card }) => card)
  }, [g, picking, version])

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
  }, [g, picking, q, filter, version])

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
      <SquadPresets />

      <Panel
        title="我的卡组"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
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
        <p className="small muted" style={{ marginTop: 0 }}>{filled < 5 ? `已上阵 ${filled}/5 位选手。点空位挑选，或使用自动组队补齐阵容。` : '五人阵容已就绪。点选手卡可查看详情、升级或替换。'}</p>
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
                onClick={() => setViewing(i)}
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
                  onClick={() => setViewing('coach')}
                />
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <CardSlot label="教练" onClick={() => setPicking('coach')} hint="教练包里开得到" />
              </div>
            )}
          </div>

          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div className="row" style={{ gap: 20, marginBottom: 6 }}>
              <div>
                <div className="tiny faint">阵容战力</div>
                <div className="display" style={{ fontSize: 34, lineHeight: 1 }}>{fmt(power)}</div>
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
              <div>
                <div className="tiny faint">阵容分</div>
                <div className="display" style={{ fontSize: 34, lineHeight: 1 }}>{rating}</div>
              </div>
            </div>
            {/* The terms, so a number like 43,800 can be read: five cards' 战力
                added up, then what the room does to it. Same terms as 阵容分,
                at five hundred a point, from the unrounded score — a single
                level shows as +100 here where the mean-then-round hid it. */}
            {filled > 0 && (
              <div className="tiny muted mono" style={{ marginBottom: 8, lineHeight: 1.7 }}>
                五人 {fmt(pts(paper.mean - paper.growth + paper.misfits * 6 / paper.players))}
                {paper.growth > 0 && ` · 强化 ${signed(pts(paper.growth))}`}
                {paper.misfits > 0 && ` · 错位 ${signed(-pts(paper.misfits * 6 / paper.players))}`}
                {` · 默契 ${signed(pts(paper.chem))}`}
                {paper.lift !== 0 && ` · 教练 ${signed(pts(paper.lift))}`}
                {paper.uncalled > 0 && ` · 无指挥 ${signed(-pts(paper.uncalled))}`}
                {paper.short > 0 && ` · 缺人 ${signed(-pts(paper.short))}`}
              </div>
            )}

            <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
              战力综合反映当前培养与阵容搭配，实际比赛还受对手、战术和临场表现影响。
              教练的战术、培养、激励和等级都计入战力，教练带来的默契另算。
              默契来自真实关系：<b>同一支俱乐部</b>最高，其次<b>同国籍</b>，再次<b>同赛区</b>。默契高的阵容能打赢评分更高的对手。
            </p>
            <GapOdds />

            {filled < 5 && <p className="small warn">还差 {5 - filled} 个人。</p>}
            {!!gaps.length && (
              <p className="small warn">没人打得了：{gaps.join('、')}，比赛里会吃亏。</p>
            )}
            {chem.noIgl && filled > 0 && <p className="small warn">没有指挥，中局决策会吃亏。</p>}
            {!!chem.notes.length && (
              <p className="tiny faint" style={{ marginBottom: 0 }}>{chem.notes.join(' · ')}</p>
            )}

            {!!(chem.links.length + chem.coachLinks.length) && (
              <div style={{ marginTop: 12 }}>
                <div className="tiny faint" style={{ marginBottom: 5 }}>默契关系（{chem.links.length + chem.coachLinks.length} 条）</div>
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
                  {chem.coachLinks.map((l) => {
                    const coach = g.squad.coach ? cardById(g.squad.coach) : undefined
                    const p = g.squad.slots[l.slot] ? cardById(g.squad.slots[l.slot]!) : undefined
                    if (!isCoachCard(coach) || !isPlayerCard(p)) return null
                    return (
                      <span key={`c${l.slot}`} className="trait" data-good="y" title={`教练 ${coach.name} × ${p.ign}：${COACH_WHY_CN[l.why]}`}>
                        {coach.name} × {p.ign} · {COACH_WHY_CN[l.why]}
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

      {viewing !== null && (() => {
        const id = viewing === 'coach' ? g.squad.coach : g.squad.slots[viewing]
        if (!id || !g.cards[id]) return null
        const seat = viewing === 'coach' ? '教练' : SQUAD_SLOTS[viewing]
        return (
          <CardDetail
            cardId={id}
            onClose={() => setViewing(null)}
            actions={
              <>
                <button className="primary sm" onClick={() => { setPicking(viewing); setViewing(null) }}>
                  替换（{seat}）
                </button>
                <button
                  className="sm ghost"
                  onClick={() => {
                    if (viewing === 'coach') g.squad.coach = null
                    else setSlot(g, viewing, null)
                    setViewing(null)
                    commit(true)
                  }}
                >
                  移出卡组
                </button>
              </>
            }
          />
        )
      })()}

      {picking !== null && (
        <div className="modal-bg" onClick={() => setPicking(null)}>
          <div ref={pickerRef} role="dialog" aria-modal="true" aria-label="选择阵容卡牌" tabIndex={-1} className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
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
                    type="search" aria-label="搜索阵容选手" placeholder="搜 ID / 真名 / 战队"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                }
              />
              {options.length === 0 ? (
                <div className="cm-empty" role="status"><p>
                  {pool.length === 0
                    ? (picking === 'coach' ? '还没有教练卡，去开一个教练包。' : '没有可选的卡，先去抽卡。')
                    : '这些条件下没有卡，放宽一点看看。'}
                </p>{pool.length === 0
                  ? <button onClick={() => { setPicking(null); go('packs') }}>去抽卡</button>
                  : <button onClick={() => { setQ(''); setFilter(EMPTY_FILTER) }}>清除搜索与筛选</button>}</div>
              ) : (
                <div className="cm-grid sm">
                  {options.map(({ card, owned }) => {
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
