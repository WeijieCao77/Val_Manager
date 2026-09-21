/**
 * One pass at a time, and never for ever.
 *
 * Both cups keep their clock the same way: a tick every few seconds asks the
 * clock to bring the bracket up to date, and a pass already under way is the
 * answer to every other caller, so a page's nudge cannot start a second one.
 *
 * 2026-09-21, the 21:00 组队杯: five ties were played and then the cup stopped,
 * at round 0, for an hour and a half — no error in the log, nothing wrong in
 * the database, the solo cup on the same pools running normally. The pass had
 * simply stopped on an await that never answered (a pool connection that never
 * arrived, a worker that never replied), and because `running` is only cleared
 * when the pass finishes, every tick after that returned the same pending
 * promise. One await that does not settle froze the tournament permanently
 * and said nothing.
 *
 * So a pass is given a bell. If it has not come back by `limitMs` it is
 * abandoned: the caller is told, loudly, which is how it reaches the log, and
 * the next tick starts a fresh pass. Abandoning is safe because a cup round is
 * written idempotently by design — two passes that play the same tie compute
 * the same result from the same seeds and one of them writes nothing.
 */
export function makeCupPass({ name, limitMs = 120_000, onStall = null }) {
  let running = null
  const release = (mine) => { if (running === mine) running = null }
  return {
    /** the pass in flight, or null — the explicit callers' queue-behind check */
    get inflight() { return running },
    /** Run `fn` unless a pass is already in flight; either way, the pass to await. */
    run(fn) {
      if (running) return running
      let bell = null
      const rang = new Promise((_, reject) => {
        bell = setTimeout(() => {
          const waited = limitMs >= 1000 ? `${Math.round(limitMs / 1000)} 秒` : `${limitMs} 毫秒`
          const err = new Error(`${name}: 一次推进过了 ${waited} 还没回来，丢下重来`)
          err.stalled = true
          reject(err)
        }, limitMs)
        bell.unref?.()
      })
      const pass = Promise.resolve().then(fn)
      const guarded = Promise.race([pass, rang])
      running = guarded
      const done = () => { clearTimeout(bell); release(guarded) }
      // the abandoned pass may still be sitting on that await; whatever it
      // does in the end is nobody's business any more, and not an unhandled
      // rejection either
      void pass.then(done, done)
      void guarded.then(() => {}, (err) => { release(guarded); if (err?.stalled) onStall?.(err) })
      return guarded
    },
  }
}
