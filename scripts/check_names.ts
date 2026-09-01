/**
 * What a public leaderboard is allowed to print.
 *
 *   npx tsx scripts/check_names.ts
 *
 * The card account's name was a private label until the ladder put it on a
 * screen anybody can open. Two things then have to hold, and both of them are
 * about people rather than code: somebody will type something vile, and two
 * people will pick the same name.
 *
 * The check runs on READ, never on write, because every name already in the
 * table was accepted before any of this existed — a filter at the point of
 * naming would have covered none of them.
 */
import { displayName, isBlocked, looksLikeId } from '../names.js'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- ordinary names go through untouched
{
  const fine = ['阿伟', 'Kejing', '猪之家', 'shiba犬', 'M1ng929', '教练老张', 'aspas粉']
  const passed = fine.filter((n) => !isBlocked(n))
  check('正常名字一个都不拦', passed.length === fine.length,
    fine.filter((n) => isBlocked(n)).join(' ') || '')
  const d = displayName('阿伟', 'abcdef0123')
  check('显示原名，带四位识别码', d.name === '阿伟' && d.tag === 'ABCD' && !d.hidden,
    `${d.name} #${d.tag}`)
}

// ---- and the obvious does not
{
  const nope = ['fuck you', '傻逼', 'NIGGER', '草泥马', 'f  u  c  k', 'ｆｕｃｋ',
    'fuuuuuck', 'sh1t', 'admin', '官方客服']
  const caught = nope.filter((n) => isBlocked(n))
  check('该拦的都拦住了', caught.length === nope.length,
    nope.filter((n) => !isBlocked(n)).map((n) => `「${n}」`).join(' ') || '')
  const d = displayName('傻逼', 'ff00aa11')
  check('拦住的显示「已隐藏」而不是消失', d.name === '已隐藏' && d.hidden,
    '整行不见了会被当成 bug 报上来')
  check('被隐藏的人仍然有识别码，排名还在', d.tag === 'FF00')
}

// ---- short words that a substring match would get wrong
{
  const innocent = ['assassin', 'Cassandra', 'Sussex', '操作大师', 'classic']
  const wrong = innocent.filter((n) => isBlocked(n))
  check('短词只按整名匹配，不误伤', wrong.length === 0, wrong.join(' '))
  check('但整个名字就是那个词时还是拦', isBlocked('ass') && isBlocked('操'))
}

// ---- the discriminator
{
  const a = displayName('阿伟', '1111aaaa')
  const b = displayName('阿伟', '2222bbbb')
  check('同名的两个人分得开', a.tag !== b.tag, `${a.name}#${a.tag} vs ${b.name}#${b.tag}`)
  check('同一个账号每次都是同一个码',
    displayName('阿伟', '1111aaaa').tag === a.tag)
  // the id is the password; only its hash may be shown
  check('识别码来自哈希，不是 ID 本身', a.tag === '1111')
}

// ---- 把账号 ID 当昵称的人
//
// 排行榜上线一小时就抓到一个：第 24 名叫「VM-9DJ0-X6C7-8EP」。这个游戏没有
// 密码也没有邮箱，ID 就是全部的认证，而账号页上 ID 和昵称输入框挨在一起。
{
  check('整串 ID 当名字会被认出来', looksLikeId('VM-9DJ0-X6C7-8EP'))
  check('去掉横线也认得', looksLikeId('VM9DJ0X6C78EP'))
  check('小写也认得', looksLikeId('vm-9dj0-x6c7-8ep'))
  check('完整的 ID 更认得', looksLikeId('VM-ABCD-EFGH-JKMN-PQRS-TVWX'))
  const d = displayName('VM-9DJ0-X6C7-8EP', 'abcd1234')
  check('隐藏，而且说得清是为什么', d.hidden && d.name === '已隐藏' && d.why === 'id')
  check('截断之前就判断——半串 ID 也是半个密码',
    displayName('VM-ABCD-EFGH-JKMN-PQRS-TVWX', 'abcd').hidden)

  const fine = ['VM', 'VMware 老王', '小 VM', 'VIM', 'vm2']
  const wrong = fine.filter((n) => looksLikeId(n))
  check('正常带 VM 的名字不受影响', wrong.length === 0, wrong.join(' '))
}

// ---- empty and hostile input
{
  check('没起名字的有个默认名', displayName('', 'abcd').name === '无名经理')
  check('只有空格也算没起名', displayName('   ', 'abcd').name === '无名经理')
  check('超长名字被截断', displayName('一'.repeat(50), 'abcd').name.length === 16)
  check('没有 id 也不会崩', displayName('阿伟', undefined as never).tag === '????')
  check('名字是 null 也不会崩', displayName(null as never, 'abcd').name === '无名经理')
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
