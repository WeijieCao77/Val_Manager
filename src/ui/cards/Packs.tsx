import { useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardBack } from '../Card'
import { Panel } from '../common'
import {
  PACKS, PACK_ORDER, QUESTS, HARD_PITY, SOFT_PITY,
  checkIn, claimQuest, collectionProgress, openPack, refreshDaily, salvage,
} from '../../engine/gacha'
import type { PackKind, Pulled, QuestKey } from '../../engine/gacha'
import { RARITY_CN, isPlayerCard } from '../../engine/cards'
import { track } from '../../engine/telemetry'

export default function Packs() {
  const { g, today, commit, toast } = useCards()
  const [opening, setOpening] = useState<Pulled[] | null>(null)
  const [shown, setShown] = useState(0)

  refreshDaily(g, today)
  const prog = collectionProgress(g)

  const open = (kind: PackKind, payWith: 'pack' | 'coins') => {
    try {
      const out = openPack(g, kind, payWith)
      track('card_pull', {
        kind,
        paid: payWith,
        gold: out.filter((p) => p.card.rarity === 'gold').length,
        dupes: out.filter((p) => p.dupe).length,
      })
      commit()
      setOpening(out)
      setShown(1)
    } catch (e) {
      toast(e instanceof Error ? e.message : '开不了')
    }
  }

  const done = () => {
    setOpening(null)
    setShown(0)
    commit(true)
  }

  const check = () => {
    const r = checkIn(g, today)
    if (!r.already) track('card_signin', { streak: r.streak })
    commit(true)
    toast(r.already ? '今天已经签过到了。' : `签到第 ${r.streak} 天：+${r.coins} 金币，卡包已入库。`)
  }

  const claim = (key: QuestKey) => {
    const n = claimQuest(g, key)
    if (n) { commit(true); toast(`任务完成，+${n} 金币。`) }
  }

  const signedToday = g.daily.claimed === today

  return (
    <>
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="每日签到" actions={<span className="tiny muted">连续 {g.daily.streak} 天</span>}>
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
            每天一次，送金币和卡包。连签 3 天多一个选拔包，连签 7 天送十连包。
            日期以服务器为准（北京时间），改手机时间没有用。
          </p>
          <div className="row" style={{ gap: 4, margin: '10px 0 12px' }}>
            {Array.from({ length: 7 }, (_, i) => {
              const day = i + 1
              // the streak runs past seven, so the strip shows where in the
              // current cycle of seven it is
              const hit = g.daily.streak > 0 ? ((g.daily.streak - 1) % 7) + 1 : 0
              const on = day <= hit
              return (
                <div
                  key={i}
                  title={day === 7 ? '十连包' : day % 3 === 0 ? '选拔包' : '试训包 + 300 金币'}
                  style={{
                    flex: 1, height: 30, borderRadius: 3, display: 'grid', placeItems: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: on ? 'var(--warn-wash)' : 'var(--panel-2)',
                    border: `1px solid ${on ? 'var(--warn)' : 'var(--line)'}`,
                    color: on ? 'var(--warn)' : 'var(--faint)',
                  }}
                >
                  {day === 7 ? '十连' : day % 3 === 0 ? '选拔' : day}
                </div>
              )
            })}
          </div>
          <button className="primary" onClick={check} disabled={signedToday}>
            {signedToday ? '今天已签到' : '签到'}
          </button>
        </Panel>

        <Panel title="今日任务" actions={<span className="tiny muted">{g.daily.taken.length}/{g.daily.picked.length}</span>}>
          {g.daily.picked.map((key) => {
            const q = QUESTS[key]
            const at = g.daily.progress[key] ?? 0
            const full = at >= q.target
            const taken = g.daily.taken.includes(key)
            return (
              <div key={key} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div>
                  <div className="small">{q.label}</div>
                  <div className="tiny faint mono">{Math.min(at, q.target)}/{q.target} · +{q.reward} 金币</div>
                </div>
                <button className="sm" onClick={() => claim(key)} disabled={!full || taken}>
                  {taken ? '已领' : full ? '领取' : '进行中'}
                </button>
              </div>
            )
          })}
          <p className="tiny faint" style={{ marginBottom: 0 }}>三个全部完成再送一个试训包。</p>
        </Panel>
      </div>

      <Panel
        title="卡包"
        actions={
          <span className="tiny muted">
            收集 {prog.owned}/{prog.total} ·
            距保底 {Math.max(0, HARD_PITY - g.pity)} 抽
            {g.pity >= SOFT_PITY ? '（已进入保底区间，出金率提升中）' : ''}
          </span>
        }
      >
        <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
          想买几个就买几个，没有次数限制——能开多少由金币决定。
          十连包不卖，只能靠升段、夺冠或连签七天拿。
        </p>
        <div className="pack-shelf">
          {PACK_ORDER.map((kind) => {
            const def = PACKS[kind]
            const own = g.packs[kind] ?? 0
            return (
              <div key={kind} className="pack-box">
                <h4>
                  {def.name}
                  {own > 0 && <span className="pack-own"> ×{own}</span>}
                </h4>
                <p>{def.blurb}</p>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary sm" onClick={() => open(kind, 'pack')} disabled={own < 1}>
                    打开（{own}）
                  </button>
                  {def.shop === false ? (
                    <span className="tiny faint" style={{ alignSelf: 'center' }}>非卖品</span>
                  ) : (
                    <button
                      className="sm"
                      onClick={() => open(kind, 'coins')}
                      disabled={g.coins < def.cost}
                    >
                      花 {def.cost} 金币
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {opening && (
        <PackStage
          pulled={opening}
          shown={shown}
          // ceiling is length + 1, not length: `finished` is `shown >
          // pulled.length`, so clamping at length meant the last card of a
          // multi-card pack could never be got past — the reveal sat on 3/3
          // and swallowed every click
          onNext={() => setShown((n) => Math.min(n + 1, opening.length + 1))}
          onDone={done}
          onSellAll={() => {
            let coins = 0
            for (const p of opening) if (p.dupe) coins += salvage(g, p.card.id, 1)
            commit(true)
            toast(coins ? `重复卡已分解，+${coins} 金币。` : '这一包没有重复卡。')
          }}
        />
      )}
    </>
  )
}

/**
 * One card turning over.
 *
 * The whole point of a pack is the half-second before you know what it is, and
 * a card that simply appears has no half-second. `key` on the caller restarts
 * the animation for each new card.
 */
function Flip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flip">
      <div className="flip-inner">
        <div className="flip-face flip-back"><CardBack /></div>
        <div className="flip-face flip-front">{children}</div>
      </div>
    </div>
  )
}

/**
 * The reveal.
 *
 * Cards come out worst-first and one tap at a time, because the whole point of
 * a ten-pull is the last card. Tapping again skips ahead; nobody should have
 * to sit through an animation twice.
 */
function PackStage({
  pulled, shown, onNext, onDone, onSellAll,
}: {
  pulled: Pulled[]; shown: number
  onNext: () => void; onDone: () => void; onSellAll: () => void
}) {
  // A single-card pack has nothing to summarise: showing a "strip" of one card
  // under the card you are already looking at reads as a bug. So one card goes
  // straight to its own reveal with the buttons under it, and a multi-card
  // pack flips through and then lays them all out.
  const single = pulled.length === 1
  const finished = single || shown > pulled.length
  const current = pulled[Math.min(shown, pulled.length) - 1]
  const dupes = pulled.filter((p) => p.dupe).length

  const actions = (
    <div className="row" style={{ gap: 8 }}>
      {dupes > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onSellAll() }}>
          分解 {dupes} 张重复卡
        </button>
      )}
      <button className="primary" onClick={(e) => { e.stopPropagation(); onDone() }}>收下</button>
    </div>
  )

  return (
    <div className="pack-stage" onClick={finished ? undefined : onNext}>
      {(current?.card.rarity === 'gold' || current?.card.rarity === 'mythic') && (
        <div key={shown} className={`pack-glow${current.card.rarity === 'mythic' ? ' holo' : ''}`} />
      )}
      <div className="pack-reveal">
        {(!finished || single) && current && (
          <>
            <Flip key={`${current.card.id}-${shown}`}>
              <CardFace card={current.card} size="lg" />
            </Flip>
            <div className="row" style={{ gap: 8, flexDirection: 'column' }}>
              <span
                className={`tag ${current.card.rarity === 'mythic' ? 'holo'
                  : current.card.rarity === 'gold' ? 't1' : 't2'}`}
              >
                {RARITY_CN[current.card.rarity]}
              </span>
              {isPlayerCard(current.card) && current.card.legend && (
                <span className="small" style={{ color: '#e9dcff', textAlign: 'center' }}>
                  <b>{current.card.legend.title}</b>
                  <br />
                  <span className="tiny muted">{current.card.legend.note}</span>
                </span>
              )}
              {current.dupe && <span className="tiny muted">重复 · 可分解 {current.salvage} 金币</span>}
            </div>
            {single ? actions : <div className="pack-hint">{shown}/{pulled.length} · 点任意位置继续</div>}
          </>
        )}
        {finished && !single && (
          <>
            <div className="pack-strip">
              {pulled.map((p, i) => (
                <div key={`${p.card.id}-${i}`} className="pack-card" style={{ animationDelay: `${i * 40}ms` }}>
                  <CardFace card={p.card} size="sm" footer={p.dupe ? '重复' : '新卡'} />
                </div>
              ))}
            </div>
            {actions}
          </>
        )}
      </div>
    </div>
  )
}
