/**
 * What a public leaderboard is allowed to print.
 *
 * The card account's name is whatever the player typed into a box, and until
 * now it was only ever shown back to the person who typed it. A leaderboard
 * puts it in front of everybody, which brings two problems that are not really
 * about code — somebody will type something vile, and two people will pick the
 * same name — and one that is: the check has to run on READ, because the names
 * already in the table were accepted before any of this existed.
 *
 * The blocklist is deliberately short and deliberately extensible. It is not
 * trying to be a moderation system; it is trying to keep the obvious off a
 * screen that anybody can open. Anything it hides can be renamed by its owner
 * in the account screen, which is why the row says 「已隐藏」 rather than
 * vanishing — a name that silently disappears is a bug report.
 */

/**
 * Fold the tricks people use to slip a word past a substring match.
 *
 * Full-width characters, spacing, punctuation, repeats and the handful of
 * digit-for-letter substitutions everybody uses. Not exhaustive and not meant
 * to be: each of these costs the person trying one more attempt, and the
 * leaderboard is not worth an arms race.
 */
function normalize(raw) {
  return String(raw ?? '')
    .toLowerCase()
    // full-width ASCII → ASCII
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    // anything that is not a letter, a digit or a CJK character is noise
    .replace(/[^a-z0-9一-龥]/g, '')
    // 「fuuuuuck」 is 「fuck」 — collapsed all the way down, or a long enough
    // run walks straight past the match
    .replace(/(.)\1+/g, '$1')
}

/** The name broken into words, each folded the same way. */
const words = (raw) =>
  String(raw ?? '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5\uff01-\uff5e]+/)
    .map(normalize)
    .filter(Boolean)

/**
 * Long enough that a substring match cannot pick up a real name.
 *
 * The test for this list is 「could an innocent word contain it」. 「nigger」
 * cannot; 「rape」 very much can, and lives in the other list.
 */
const BLOCKED_SUB = [
  'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'faggot', 'retard',
  'whore', 'penis', 'vagina', 'pedophile', 'incest', 'hitler',
  '傻逼', '沙比', '煞笔', '草泥马', '操你妈', '狗屎', '婊子', '贱人',
  '妓女', '鸡巴', '强奸', '轮奸', '尼玛', '死全家', '智障', '弱智', '纳粹', '希特勒',
  // impersonating the game itself is its own kind of trouble
  '管理员', 'moderator', '客服',
]

/**
 * Short or ambiguous: must BE a word, not merely appear inside one.
 *
 * Otherwise 「rape」 takes grape and drape, 「dick」 takes Dickens, 「cunt」
 * takes Scunthorpe and 「ass」 takes assassin — all of which are somebody's
 * actual name somewhere.
 */
const BLOCKED_WORD = [
  'ass', 'cum', 'sex', 'dick', 'rape', 'slut', 'cunt', 'nazi', 'kkk', 'admin',
  '屄', '操', '肏', '屌', '你妈', '妈的', '滚蛋', '官方',
]

export function isBlocked(name) {
  const flat = normalize(name)
  if (!flat) return false
  if (BLOCKED_SUB.some((w) => flat.includes(normalize(w)))) return true
  const parts = words(name)
  const exact = new Set(BLOCKED_WORD.map(normalize))
  if (exact.has(flat)) return true
  return parts.some((p) => exact.has(p))
}

export function displayName(name, idHash) {
  const tag = String(idHash ?? '').slice(0, 4).toUpperCase() || '????'
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 16)
  if (!clean) return { name: '无名经理', tag, hidden: false }
  if (isBlocked(clean)) return { name: '已隐藏', tag, hidden: true }
  return { name: clean, tag, hidden: false }
}
