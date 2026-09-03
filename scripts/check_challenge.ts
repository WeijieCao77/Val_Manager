/**
 * The daily challenge, played out for a year.
 *
 *   npx tsx scripts/check_challenge.ts [days]
 *
 * It is the same puzzle for everybody on a given date, which is the whole
 * point of it and also the thing that cannot be fixed after the fact: a day
 * whose answer resolves to nobody, or whose picture is missing, is a day every
 * player on earth gets a broken screen. So every date for the next year is
 * generated here and checked end to end — the answer exists, it is in the list
 * you are allowed to guess, its artwork is on disk, and guessing it wins.
 *
 * The economy is asserted too. It costs coins, and a reward loop that pays out
 * less than it takes is a tax, not a reason to come back.
 */
import { existsSync } from 'node:fs'
import { WORLD_PLAYERS } from '../src/engine/world'
import { fileURLToPath } from 'node:url'
import {
  allChoices, answerFor, CHALLENGE_COST, CHALLENGE_REFUND, CHALLENGE_TRIES,
  challengeBlock, challengeToday, choicesFor, evaluate, guessChallenge, kindFor, kindOfId,
  detail, newChallenge, rewardFor,
} from '../src/engine/challenge'
import type { ChallengeKind } from '../src/engine/challenge'
import { newGacha, PACKS } from '../src/engine/gacha'
import { AGENT_CN } from '../src/engine/content'
import type { GachaState } from '../src/engine/gacha'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!bad && !ok) console.log('')
  if (!ok) bad++
}

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ID = 'VM-TEST'
const fresh = (): GachaState => newGacha(ID, '审计', '2026-09-01')
const dateAt = (n: number): string =>
  new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10)

// ---- a year of puzzles, every one of them playable
{
  const days = Number(process.argv[2] ?? 365)
  const seen = new Map<ChallengeKind, number>()
  const answers = new Map<ChallengeKind, Set<string>>()
  const missingArt: string[] = []
  const unguessable: string[] = []
  let unwinnable = 0
  let noArt = 0

  for (let i = 0; i < days; i++) {
    const day = dateAt(i)
    const kind = kindFor(day, ID)
    const answer = answerFor(day, ID)
    seen.set(kind, (seen.get(kind) ?? 0) + 1)
    ;(answers.get(kind) ?? answers.set(kind, new Set()).get(kind)!).add(answer)

    // it must be in the ONE list the player picks from — all four kinds are
    // in the same picker now, because the screen no longer says which kind
    // today is
    if (!allChoices().some((c) => c.id === answer)) unguessable.push(`${day} ${kind} ${answer}`)
    if (kindOfId(answer) !== kind) unguessable.push(`${day} ${answer} 类型认错了`)

    // ...and it must have a picture, or the reveal is a grey box
    const g = fresh()
    const turn = guessChallenge(g, day, answer)
    if (!turn.solved) unwinnable++
    if (!turn.row.img) noArt++
    else if (!existsSync(PUBLIC + turn.row.img)) {
      missingArt.push(`${day} ${kind} ${turn.row.img}`)
    }
  }

  check(`${days} 天里每一天的答案都在可选列表里`, unguessable.length === 0,
    unguessable.slice(0, 3).join(' / '))
  check('猜中答案就算赢', unwinnable === 0, `${unwinnable} 天猜中了也不算赢`)
  check('每个答案都有图', missingArt.length === 0, missingArt.slice(0, 3).join(' / '))
  check('答案永远不会是没照片的选手', noArt === 0, `${noArt} 天答案没有图`)
  check('四种题型都会出现',
    (['player', 'team', 'map', 'agent'] as ChallengeKind[]).every((k) => (seen.get(k) ?? 0) > 0),
    [...seen].map(([k, n]) => `${k} ${n}`).join(' · '))
  check('选手题的答案不会老是同一个人',
    (answers.get('player')?.size ?? 0) > 50, `一年里出过 ${answers.get('player')?.size} 个不同选手`)
  console.log(`     题型分布：${[...seen].map(([k, n]) => `${k} ${n} 天`).join('，')}`)
}

// ---- one day, played wrong all the way down
{
  const day = dateAt(3)
  const g = fresh()
  const answer = answerFor(day, ID)
  const wrong = choicesFor(kindFor(day, ID)).filter((c) => c.id !== answer).slice(0, CHALLENGE_TRIES)
  const before = g.coins

  const first = guessChallenge(g, day, wrong[0].id)
  check('第一次猜才扣钱', g.coins === before - CHALLENGE_COST, `${before} → ${g.coins}`)
  check('猜错不结束', !first.finished)

  for (let i = 1; i < CHALLENGE_TRIES - 1; i++) guessChallenge(g, day, wrong[i].id)
  check('用光之前还能继续', !g.challenge!.done, `已猜 ${g.challenge!.guesses.length} 次`)

  const last = guessChallenge(g, day, wrong[CHALLENGE_TRIES - 1].id)
  check(`猜满 ${CHALLENGE_TRIES} 次就结束`, last.finished && !last.solved)
  check('没猜中退一半', g.coins === before - CHALLENGE_COST + CHALLENGE_REFUND,
    `${before} → ${g.coins}`)
  check('结束之后不能再玩', !!challengeBlock(g, day), challengeBlock(g, day) ?? '')
}

// ---- 奖励梯度，和它到底值不值那 300
{
  check('一次猜中给十连包', rewardFor(1, true, 1).pack === 'ten')
  check('三次以内给选拔包', rewardFor(3, true, 1).pack === 'elite')
  check('用满次数给试训包', rewardFor(6, true, 1).pack === 'scout')
  check('连续第七天额外给一个十连包', rewardFor(4, true, 7).streakPack === 'ten')
  const worst = rewardFor(CHALLENGE_TRIES, true, 1)
  const worthOfWorst = PACKS[worst.pack!].cost + worst.coins
  check('最差的一次胜利也比入场费值钱', worthOfWorst > CHALLENGE_COST,
    `${worthOfWorst} 金币的东西 vs ${CHALLENGE_COST} 入场`)
  check('输了的一天只亏 150', CHALLENGE_COST - CHALLENGE_REFUND === 150)
}

// ---- 连胜：连着解开才算，断一天清零
{
  const g = fresh()
  for (let i = 0; i < 3; i++) {
    const day = dateAt(10 + i)
    guessChallenge(g, day, answerFor(day, ID))
  }
  check('连着解开三天，连胜是 3', g.challenge!.streak === 3, `${g.challenge!.streak}`)
  check('累计解开数也在涨', g.challenge!.total === 3, `${g.challenge!.total}`)

  // skip a day, then solve again
  const later = dateAt(15)
  guessChallenge(g, later, answerFor(later, ID))
  check('中间断了一天，连胜从头算', g.challenge!.streak === 1, `${g.challenge!.streak}`)
  check('最好成绩记住了', g.challenge!.best === 3, `${g.challenge!.best}`)

  // opening a new day's puzzle without playing it must not credit a streak
  const g2 = fresh()
  const d1 = dateAt(20)
  guessChallenge(g2, d1, answerFor(d1, ID))
  challengeToday(g2, dateAt(21))
  challengeToday(g2, dateAt(22))
  check('只是打开看看，不会白拿连胜', g2.challenge!.streak === 0, `${g2.challenge!.streak}`)
}

// ---- 提示：猜中的那一行必须每格都对，而且第一格永远是「类型」
{
  for (const offset of [0, 1, 2, 4]) {
    const day = dateAt(offset)
    const g = fresh()
    const row = guessChallenge(g, day, answerFor(day, ID)).row
    const allHit = row.cells.every((c) => c.mark === 'hit')
    check(`${kindFor(day, ID)} 题猜中时每一格都是对的`, allHit,
      row.cells.map((c) => `${c.label}${c.mark}`).join(' '))
    check(`${kindFor(day, ID)} 题第一格是类型`, row.cells[0]?.label === '类型')
  }
}

// ---- 猜错类型时，只告诉你类型不对，不泄露别的
{
  const day = dateAt(0)          // 这天是地图题
  const g = fresh()
  const wrongKind = allChoices().find((c) => c.kind !== kindFor(day, ID))!
  const row = guessChallenge(g, day, wrongKind.id).row
  check('猜了别的类型，只回一格「类型」', row.cells.length === 1,
    row.cells.map((c) => c.label).join(' '))
  check('而且那一格是错的', row.cells[0]?.mark === 'miss')
  check('但仍然给了它自己的图（图才是谜面）', !!row.img, row.img ?? '没有')
}

// ---- 没有照片的选手：可以猜，但不会是答案，也不会渲染成裂图
{
  const faceless = allChoices().filter((c) => c.kind === 'player'
    && !evaluate('player', c.id, c.id).img)
  check('确实有一批选手没有照片', faceless.length > 0, `${faceless.length} 人`)
  const day = dateAt(2)          // 选手题
  const g = fresh()
  const row = guessChallenge(g, day, faceless[0].id).row
  check('没照片的选手照样能被猜', row.id === faceless[0].id)
  check('没照片时不给一个会裂的图片地址', !row.img, row.img ?? '(无)')
}

// ---- 选手 · 战队 · 地图 · 英雄，都在同一个选择列表里
{
  const kinds = new Set(allChoices().map((c) => c.kind))
  check('四种东西在同一个池子里', kinds.size === 4, [...kinds].join(' '))
  check('池子大小是四类之和',
    allChoices().length === (['player', 'team', 'map', 'agent'] as const)
      .reduce((n, k) => n + choicesFor(k).length, 0),
    `${allChoices().length} 个`)
  const ids = allChoices().map((c) => c.id)
  check('跨类别的 id 不重名', new Set(ids).size === ids.length)
}

// ---- 中文和英文都要能搜到
{
  const all = allChoices()
  const agents = all.filter((c) => c.kind === 'agent')
  // Not "has a Chinese character": KAY/O is officially K/O on the national
  // server, which is a real translated name with no CJK in it.
  const named = agents.filter((c) => c.name === AGENT_CN[c.id])
  check('每个英雄都用官方译名显示', named.length === agents.length,
    `${named.length}/${agents.length}，例：${agents.slice(0, 3).map((c) => `${c.name}(${c.hint})`).join(' ')}`)
  check('英雄的英文名仍然能搜到（在 hint 里）',
    agents.every((c) => c.hint.includes(c.id)))
  // the reported case, exactly
  const search = (q: string) => all.filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()) || c.hint.toLowerCase().includes(q.toLowerCase()))
  check('搜「铁臂」能找到 Breach', search('铁臂').some((c) => c.id === 'Breach'))
  check('搜「暮蝶」能找到 Clove', search('暮蝶').some((c) => c.id === 'Clove'))
  check('搜「Breach」也还找得到', search('Breach').some((c) => c.id === 'Breach'))
  check('地图中英文都能搜', search('微风').some((c) => c.id === 'Breeze')
    && search('Breeze').some((c) => c.id === 'Breeze'))
  check('赛区能用中文搜', search('太平洋').some((c) => c.kind === 'team'))
}

// ---- 买不起就不让进，而不是扣成负数
{
  const g = fresh()
  g.coins = CHALLENGE_COST - 1
  const day = dateAt(30)
  check('金币不够时挡住', !!challengeBlock(g, day), challengeBlock(g, day) ?? '')
  check('挡住的理由说了要多少钱',
    (challengeBlock(g, day) ?? '').includes(String(CHALLENGE_COST)))
}

// ---- 老存档没有这个字段，也要能直接玩
{
  const g = fresh()
  delete (g as { challenge?: unknown }).challenge
  const day = dateAt(40)
  const turn = guessChallenge(g, day, answerFor(day, ID))
  check('没有 challenge 字段的老存档照样能玩', turn.solved && !!g.challenge)
}

// ---- 每个账号一道题 -----------------------------------------------------
//
// It used to be the same puzzle for everybody, so one person could solve it,
// post the answer, and every other account collected the reward for typing it
// in — which with alt accounts is not sharing, it is a coin printer.
{
  const day = '2026-09-04'
  const ids = ['VM-AAAA', 'VM-BBBB', 'VM-CCCC', 'VM-DDDD', 'VM-EEEE', 'VM-FFFF']
  const answers = ids.map((id) => answerFor(day, id))
  const kinds = ids.map((id) => kindFor(day, id))
  console.log('\n同一天，六个账号：')
  for (let i = 0; i < ids.length; i++) console.log(`  ${ids[i]}  ${kinds[i]}  ${answers[i]}`)

  check('不是所有账号都同一个答案', new Set(answers).size > 1, `${new Set(answers).size} 种答案`)
  check('题目类型也会不一样', new Set(kinds).size > 1, `${new Set(kinds).size} 种类型`)

  // the property that must NOT break: the same account asked twice gets the
  // same puzzle, or a reload would reroll it
  for (const id of ids) {
    check(`${id} 刷新之后还是同一道题`,
      answerFor(day, id) === answerFor(day, id) && kindFor(day, id) === kindFor(day, id))
  }
  check('同一个账号，换一天就换一道题',
    answerFor('2026-09-05', ids[0]) !== answerFor(day, ids[0])
    || kindFor('2026-09-05', ids[0]) !== kindFor(day, ids[0]))

  let same = 0
  let total = 0
  for (let d = 1; d <= 14; d++) {
    const dd = `2026-09-${String(d).padStart(2, '0')}`
    const a = answerFor(dd, ids[0])
    for (const id of ids.slice(1)) { total++; if (answerFor(dd, id) === a) same++ }
  }
  console.log(`  两周里，把答案抄给别的账号还能用的比例：${(same / total * 100).toFixed(1)}%`)
  check('抄答案基本上没用了', same / total < 0.15, `${same}/${total}`)
}

// ---- 图有多糊 -----------------------------------------------------------
//
// The picture is drawn at `detail(used)` cells across the frame. The opening
// frame has to be a few patches of colour — a crest at six cells cannot be
// read, at sixteen it can — and every miss has to buy a real step of clarity.
{
  const steps = Array.from({ length: CHALLENGE_TRIES }, (_, i) => detail(i))
  console.log(`\n每猜错一次的清晰度（横向格数）：${steps.map((s) => (Number.isFinite(s) ? s : '原图')).join(' → ')}`)
  check('开局最多八格，看不出是人是队', steps[0] <= 8, `${steps[0]}`)
  check('最后一次猜的时候是原图', !Number.isFinite(steps[CHALLENGE_TRIES - 1]))
  for (let i = 1; i < CHALLENGE_TRIES - 1; i++) {
    check(`猜错 ${i} 次比 ${i - 1} 次至少清楚一半`, steps[i] >= steps[i - 1] * 1.5, `${steps[i - 1]} → ${steps[i]}`)
  }
  check('猜完之后不会再变', detail(CHALLENGE_TRIES) === Infinity && detail(CHALLENGE_TRIES + 3) === Infinity)
}

// ---- 国籍一格写的是名字，台湾、香港、澳门写作中国台湾 / 中国香港 / 中国澳门 ----
// 「SpiritZ1 的国籍显示的是 TW」——一个代码不该以两个大写字母的样子漏到题面上。
{
  const byNat = (nat: string) => WORLD_PLAYERS.find((p) => p.nat === nat)!
  const tw = byNat('tw'), hk = byNat('hk'), cn = byNat('cn'), kr = byNat('kr')
  const natCell = (answer: string, guess: string) =>
    evaluate('player', answer, guess).cells.find((c) => c.label === '国籍')!
  check('台湾选手的国籍写作「中国台湾」', natCell(cn.id, tw.id).value === '中国台湾', natCell(cn.id, tw.id).value)
  check('香港选手的国籍写作「中国香港」', natCell(cn.id, hk.id).value === '中国香港', natCell(cn.id, hk.id).value)
  check('其他国家也写名字，不写代码', natCell(cn.id, kr.id).value === '韩国', natCell(cn.id, kr.id).value)
  check('拿中国台湾去猜中国大陆，算「接近」而不是「错」', natCell(cn.id, tw.id).mark === 'near')
  check('拿中国香港去猜中国台湾，同样是「接近」', natCell(tw.id, hk.id).mark === 'near')
  check('同一个代码才是「命中」', natCell(tw.id, tw.id).mark === 'hit')
  check('韩国对中国还是「错」', natCell(cn.id, kr.id).mark === 'miss')
  check('题面上再也没有 TW / HK / MO 三个字母',
    WORLD_PLAYERS.every((p) => !/^(TW|HK|MO)$/.test(natCell(p.id, p.id).value)))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
