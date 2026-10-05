/**
 * A manager turn cut short between two of its days is still saved (2026-10-05).
 *
 *   npx tsx scripts/check_manager_turn_abort.ts
 *
 * The dashboard runs a turn a day at a time and gives the browser the thread
 * between days (Dashboard.tsx runTurn). Codex's review found the gap: the back
 * button in that gap unmounted the mode, runTurn returned without its commit,
 * and the parent's flush only wrote when a save timer was pending — so the days
 * already played were never written.
 *
 * This runs the REAL runTurn, lifted out of Dashboard.tsx by the TypeScript
 * parser (not a copy of its loop), against stubs for the engine and the
 * browser, and checks: every played day marks the career unsaved; a turn
 * abandoned mid-way plays no further day and reports nothing; a turn whose
 * start timer fires after the screen is gone plays nothing; and the parent's
 * flushes write when the career is marked unsaved, not only on a pending timer.
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const src = readFileSync('src/ui/Dashboard.tsx', 'utf8')
const ast = ts.createSourceFile('Dashboard.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer = ''
const walk = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'runTurn' && node.initializer) initializer = node.initializer.getText(ast)
  ts.forEachChild(node, walk)
}
walk(ast)
check('Dashboard.tsx 里找到 runTurn', !!initializer)

type Run = (fast: boolean) => Promise<void>
/** runTurn with its closure stubbed; `leaveAt` = the yield at which the mode is left (0 = never) */
function harness(opts: { leaveAt?: number; mountedAtStart?: boolean; dayMs?: number }) {
  let time = 0
  let yields = 0
  const st = { marks: 0, reports: 0, busyOff: 0 }
  const mountedRef = { current: opts.mountedAtStart ?? true }
  const game = { day: 10, year: 2026 }
  const env: Record<string, unknown> = {
    game, mountedRef, simDayRef: { current: null },
    performance: { now: () => time },
    cycleDays: () => 7, windowOpen: () => false, windowEnd: () => 99,
    advanceDay: (g: { day: number }) => { g.day++; time += opts.dayMs ?? 60; return { pendingMine: null, seasonEnded: false } },
    stopsBeforeNextMatch: () => false,
    fmtDay: () => '',
    markUnsaved: () => { st.marks++ },
    handleReports: () => { st.reports++ },
    setBusy: () => { st.busyOff++ },
    window: {
      setTimeout: (cb: () => void) => {
        yields++
        if (opts.leaveAt && yields === opts.leaveAt) mountedRef.current = false
        cb()
      },
    },
  }
  const js = ts.transpileModule(`const runTurn = ${initializer}; return runTurn;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runTurn = new Function(...Object.keys(env), js)(...Object.values(env)) as Run
  return { runTurn, game, st }
}

{
  const h = harness({})
  await h.runTurn(false)
  check('整回合：7 天都标记未保存，回合结束才汇报一次', h.game.day === 17 && h.st.marks === 7 && h.st.reports === 1 && h.st.busyOff === 1,
    `day ${h.game.day} marks ${h.st.marks} reports ${h.st.reports}`)
}
{
  const h = harness({ leaveAt: 1 })
  await h.runTurn(true)
  check('中途离开：已打完的那天标记了未保存', h.game.day === 11 && h.st.marks === 1, `day ${h.game.day} marks ${h.st.marks}`)
  check('中途离开：不再推进下一天，也不汇报', h.st.reports === 0)
  check('中途离开：组件已卸载，不再 setBusy', h.st.busyOff === 0)
}
{
  const h = harness({ mountedAtStart: false })
  await h.runTurn(true)
  check('开局计时器到点时画面已离开：一天都不推进', h.game.day === 10 && h.st.marks === 0 && h.st.reports === 0)
}

// the parent: every flush writes on an unsaved mark as well as a pending timer
const mg = readFileSync('src/ManagerGame.tsx', 'utf8')
check('ManagerGame：卸载/隐藏/pagehide 的 flush 也看未保存标记',
  /const flush = \(\) => \{ if \(saveTimer\.current != null \|\| dirtyRef\.current\) saveNow\(\) \}/.test(mg))

// the real saveNow, lifted out of ManagerGame.tsx: a write that throws (or is refused as 'behind')
// must leave the career marked unsaved, so the next flush tries again (Codex recheck, 2026-10-05)
{
  const mgAst = ts.createSourceFile('ManagerGame.tsx', mg, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let saveNowSrc = ''
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(mgAst) === 'saveNow' && node.initializer && ts.isCallExpression(node.initializer)) {
      saveNowSrc = node.initializer.arguments[0].getText(mgAst)
    }
    ts.forEachChild(node, find)
  }
  find(mgAst)
  check('ManagerGame.tsx 里找到 saveNow', !!saveNowSrc)
  const run = (results: (string | Error)[]) => {
    let calls = 0
    const env: Record<string, unknown> = {
      saveTimer: { current: null }, dirtyRef: { current: true },
      gameRef: { current: { day: 5, year: 2026 } },
      warnedSaveRef: { current: false }, sizeSentRef: { current: true },
      autosave: () => { const r = results[calls++]; if (r instanceof Error) throw r; return r },
      setSaveWarn: () => {}, track: () => {}, packState: () => '', window: { clearTimeout: () => {} },
    }
    const js = ts.transpileModule(`return (${saveNowSrc})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    const saveNow = new Function(...Object.keys(env), js)(...Object.values(env)) as () => void
    const st = env as { saveTimer: { current: unknown }; dirtyRef: { current: boolean } }
    // the parent's flush, as asserted above
    const flush = () => { if (st.saveTimer.current != null || st.dirtyRef.current) saveNow() }
    return { saveNow, flush, st, calls: () => calls }
  }
  {
    const h = run([new Error('QuotaExceededError'), 'saved'])
    h.saveNow()
    check('存档写入抛错：未保存标记保留', h.st.dirtyRef.current === true)
    h.flush()
    check('存储恢复后，退出时的 flush 再存一次并清掉标记', h.calls() === 2 && h.st.dirtyRef.current === false, `${h.calls()} 次`)
  }
  {
    const h = run(['behind'])
    h.saveNow()
    check('被另一个更新的标签页拒绝（behind）：不算存好，标记保留', h.st.dirtyRef.current === true)
  }
  {
    const h = run(['shrunk'])
    h.saveNow()
    check('压缩后写入成功（shrunk）：算存好', h.st.dirtyRef.current === false)
  }
}
check('ManagerGame：打开存档页、重新开始前都按未保存标记写盘',
  /k === 'saves' && unsaved\(\)\) saveNow\(\)/.test(mg) && /onRestart=\{\(\) => \{ if \(unsaved\(\)\) saveNow\(\)/.test(mg))
check('ManagerGame：markUnsaved 交给了 ctx', /markUnsaved: \(\) => \{ dirtyRef\.current = true \}/.test(mg))

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
