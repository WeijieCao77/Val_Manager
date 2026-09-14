/**
 * The dashboard's browser script actually parses.
 *
 * It lives inside a template literal in dashboard.js, which means
 * `node --check dashboard.js` validates the Node module wrapped around it and
 * never looks at the code itself. A duplicate `const h` shipped that way: the
 * file passed every check, and the page rendered its header, its buttons and
 * nothing else, because the whole script died on a SyntaxError before the
 * first line ran.
 *
 * So this pulls the script back out of the rendered HTML and asks a real
 * parser about it — the same thing the browser does, which is the only opinion
 * that counts.
 *
 *     npx tsx scripts/check_dashboard.ts
 */
import { readFileSync } from 'node:fs'
import { dashboardHtml } from '../dashboard.js'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const html = dashboardHtml()
const m = html.match(/<script>([\s\S]*?)<\/script>/)
check('页面里找得到浏览器脚本', !!m, m ? `${m[1].length} 字符` : '没有 <script>')

if (m) {
  const src = m[1]
  let err = ''
  try {
    // Function() parses without running, which is what we want: this code
    // touches document and fetch and must never execute here.
    new Function(src)
  } catch (e) {
    err = (e as Error).message
  }
  check('浏览器脚本能被解析（重复声明、括号不配对都会在这里挂）', !err, err)

  // The panels reference these; a typo makes an empty panel rather than an
  // error, which is the quieter and therefore worse failure.
  for (const fn of ['homeRows', 'careerRows', 'unlockRows', 'funnelRows']) {
    check(`用到的 ${fn} 有定义`,
      new RegExp(`(const|function)\\s+${fn}\\b`).test(src))
  }

  // Every panel the server sends data for should be read by the page, and
  // every key the page reads should be sent — a panel wired to a field that
  // does not exist renders as a blank box nobody notices.
  // by property, not by `d.x` — the helpers take the payload under their own
  // parameter names, so anchoring on the variable gives a false alarm
  for (const key of ['home', 'careers', 'unlocks', 'accounts', 'funnel', 'depth']) {
    check(`面板读了 .${key}`, new RegExp(`\\.${key}\\b`).test(src))
  }

  // 批量发放 splits the box with regexes, and a regex written in a template
  // literal loses its backslashes unless they are doubled: \s arrives in the
  // browser as a bare s and still parses. So run the rendered code.
  const parse = src.match(/function gParse\(text\) \{[\s\S]*?\n\}/)
  check('找得到 gParse', !!parse)
  if (parse) {
    const gParse = new Function(`${parse[0]}; return gParse`)()
    const a = gParse('aabbccdd\nAABBCCDD，11223344 VM-2222-2222-2222-2222-2222')
    check('gParse 按换行、逗号、空格分开，重复只算一个', a.list.length === 4 && a.unique === 3 && a.odd.length === 0, JSON.stringify(a))
    const b = gParse('VM-2222 2222-2222-2222-2222')
    check('中间带空格的一个 ID 还是一个', b.list.length === 1 && b.unique === 1, JSON.stringify(b))
    const c = gParse('aabbccdd hello')
    check('认不出的单列出来', c.odd.length === 1 && c.odd[0] === 'hello', JSON.stringify(c))
  }
  const imp = src.match(/\.match\((\/VM[^\n]*?\/gi)\)/)
  check('找得到导入文件用的正则', !!imp)
  if (imp) {
    const re = new Function(`return ${imp[1]}`)()
    const csv = '名字,对战码\n小明,aabbccdd\n小红,VM-2222-2222-2222-2222-2222\n哈希,' + 'ab'.repeat(32) + '\n'
    const hits = csv.match(re) || []
    check('导入 csv 挑出对战码和 ID，别的列不管', hits.length === 2 && hits[0] === 'aabbccdd' && hits[1] === 'VM-2222-2222-2222-2222-2222', JSON.stringify(hits))
  }
  check('审核台不用 confirm()', !/rvAct[\s\S]*?confirm\(/.test(src.slice(src.indexOf('人工审核'), src.indexOf('微信群二维码'))))
}

// The page is a template literal on the server, and its <script> runs in a
// browser that has none of the server's imports: a bare STAMINA_POINT_SEC in
// the client code was 「读不到数据：STAMINA_POINT_SEC is not defined」 on the
// live admin page (2026-09-07). Every name imported at the top of
// dashboard.js must be interpolated, never written into the script as is.
{
  const src = readFileSync(new URL('../dashboard.js', import.meta.url), 'utf8')
  const imported = [...src.matchAll(/^import \{([^}]+)\} from/gm)].flatMap((x) => x[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!)).filter(Boolean)
  const script = m ? m[1] : ''
  const leaked = imported.filter((name) => new RegExp(`\\b${name}\\b`).test(script))
  check('浏览器脚本里没有裸露的服务端常量', leaked.length === 0, leaked.join(', ') || `检查了 ${imported.length} 个名字`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
