/**
 * The 机制说明 panel, checked against the engine it describes.
 *
 *   npx tsx scripts/check_rules_panel.ts
 *
 * Publishing exact numbers is the whole point of that panel — a rule the
 * player has to reverse-engineer anyway is worse than the number — but exact
 * numbers in prose rot the first time somebody retunes the engine, and rotted
 * documentation is worse than none: it is a lie the game tells on purpose.
 *
 * So every figure in the panel that is an exported constant is asserted here.
 * The ones that are inline coefficients cannot be checked this way and are not
 * pretended to be; what this does catch is the class of change most likely to
 * happen — somebody moves a named constant and the panel keeps the old value.
 */
import { readFileSync } from 'node:fs'
import { NEUTRAL } from '../src/engine/bonds'
import { TRUST_START } from '../src/engine/trust'
import { SPONSOR_MAX, SPONSOR_SLOT_TIERS } from '../src/engine/commercial'
import { TITLE_REP_WORTH } from '../src/engine/season'
import { KEPT_GAIN, LISTED_COST, LOYALTY_NEW, RENEWAL_GAIN, TITLE_LOYALTY } from '../src/engine/loyalty'

const panel = readFileSync(new URL('../src/ui/Rules.tsx', import.meta.url), 'utf8')

let bad = 0
const says = (needle: string, why: string) => {
  const ok = panel.includes(needle)
  if (!ok) { bad++; console.log(`FAIL 面板里找不到「${needle}」 — ${why}`) }
  else console.log(`ok   ${why}  — 「${needle}」`)
}

// bonds.ts: relationships drift toward NEUTRAL, and the match reads (rapport - NEUTRAL)
says(`朝 +${NEUTRAL} 回归`, '关系回归的目标值')
says(`（默契 − ${NEUTRAL}）× 0.18`, '默契进比赛的系数')

// trust.ts: where trust starts, and what a renewal reads it against
says(`从 ${TRUST_START} 起步`, '信任的起始值')
says(`(信任 − ${TRUST_START}) × 0.55`, '续约时信任的权重')
says(`朝 ${TRUST_START} 回归`, '信任的回归目标')

// commercial.ts: how many logos fit on a shirt, and when a new slot opens
says(`${SPONSOR_MAX} 个起`, '赞助栏位起始数')
says(SPONSOR_SLOT_TIERS.join('、'), '开新栏位的声望档位')
says(`最多 ${SPONSOR_MAX + SPONSOR_SLOT_TIERS.length} 个`, '赞助栏位上限')

// loyalty.ts: the one the group asked how to farm, back when the answer was
// that you could not
says(`从 ${LOYALTY_NEW} 起步`, '新签球员的归属感起点')
says(`重置成 ${LOYALTY_NEW}`, '换队之后归属感重置')
says(`−${LISTED_COST}`, '挂牌扣的归属感')
says(`赛区冠军 +${TITLE_LOYALTY.regional}`, '赛区冠军的归属感')
says(`国际冠军 +${TITLE_LOYALTY.international}`, '国际冠军的归属感')
says(`'续约', d: '+${RENEWAL_GAIN}`, '续约给的归属感')
says(`+${KEPT_GAIN}。前提是他自己没想走`, '挡掉报价给的归属感')

// season.ts: what a trophy is worth to your own name
says(`赛区冠军 +${TITLE_REP_WORTH.regional}`, '赛区冠军的声望')
says(`国际冠军 +${TITLE_REP_WORTH.international}`, '国际冠军的声望')

// the panel must not quietly become a wall of unsourced claims: every section
// has to say what the thing DOES, not only what moves it
const sections = panel.match(/key: '/g)?.length ?? 0
const uses = panel.match(/\n    use: \[/g)?.length ?? 0
if (sections !== uses) {
  bad++
  console.log(`FAIL 每一节都要有「它影响什么」 — ${sections} 节，${uses} 个 use`)
} else console.log(`ok   每一节都写了它影响什么  — ${sections} 节`)

// and it must not drift back to dangerouslySetInnerHTML, which is what the
// shared <Rich> exists to avoid
if (panel.includes('dangerouslySetInnerHTML')) {
  bad++
  console.log('FAIL 面板不该用 dangerouslySetInnerHTML，加粗走 <Rich>')
} else console.log('ok   加粗走 <Rich>，没有 dangerouslySetInnerHTML')

console.log(bad ? `\n${bad} 项对不上，改了引擎就要改这一页` : '\n全部对得上')
process.exit(bad ? 1 : 0)
