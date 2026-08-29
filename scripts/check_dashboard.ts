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
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
