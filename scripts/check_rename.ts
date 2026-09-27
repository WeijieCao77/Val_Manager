/**
 * A name changes once a week (owner, 2026-09-27): reports name an account by 昵称 #tag.
 *
 *   npx tsx scripts/check_rename.ts
 */
import { RENAME_DAYS, SERVER_KEYS, mergeClientFields, newGacha, renameFrom } from '../src/engine/gacha'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const DAY = 86_400_000
const t0 = Date.parse('2026-09-27T12:00:00Z')
const g = newGacha('VM-TEST-RENAME', '经理', '2026-09-20')
check('一周', RENAME_DAYS === 7)
mergeClientFields(g, { name: '经理' }, t0)
check('名字没变不算改名', g.nameAt === undefined)
mergeClientFields(g, { name: '新名字' }, t0)
check('第一次改：可以', g.name === '新名字' && g.nameAt === t0)
mergeClientFields(g, { name: '又改了' }, t0 + 6 * DAY)
check('六天后再改：不行，名字不动', g.name === '新名字' && g.nameAt === t0)
check('下次可改的时间', renameFrom(g) === t0 + 7 * DAY)
mergeClientFields(g, { name: '又改了' }, t0 + 7 * DAY)
check('满七天：可以', g.name === '又改了' && g.nameAt === t0 + 7 * DAY)
mergeClientFields(g, { name: '又改了', nameAt: 0 } as never, t0 + 7 * DAY + 1)
check('客户端改不了改名时间', g.nameAt === t0 + 7 * DAY && (SERVER_KEYS as readonly string[]).includes('nameAt'))
mergeClientFields(g, { squad: g.squad }, t0 + 8 * DAY)
check('只存阵容不碰名字', g.name === '又改了')

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
