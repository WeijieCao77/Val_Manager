/**
 * Matches played off the main thread, a bounded number at a time.
 *
 * A ladder BO5 is eight to ten milliseconds of pure CPU (up to a hundred on a
 * cold JIT), and it ran on the event loop inside a database transaction: the
 * match held one of the four interactive connections while it computed, and
 * every other request — the market's shelf included — waited for the loop.
 * Here the match is handed to a worker thread with the account as it was read;
 * no connection is held and the loop stays free. The caller writes the result
 * afterwards in a short transaction of its own (see act() in cards-api.js).
 *
 * Bounded on purpose. MATCH_WORKERS threads (two by default, the second only
 * started when the first is busy) and at most MATCH_QUEUE matches waiting
 * behind them (200: about a second and a half of work for two threads); past
 * that the caller is told 「排队的人太多」 and nothing has been spent. Measured
 * 2026-09-19 at 300 closed-loop sessions: two threads played 2260 matches to
 * one thread's 1249 and the market's p95 did not move (260 ms against 218). The bound is per process — two containers overlap for a minute
 * on a deploy, and twice a small number is still a small number.
 *
 * Nothing here is durable, and nothing needs to be: a match that is lost with
 * its worker was never written, so the account is exactly as it was.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads'

if (!isMainThread) {
  const engine = await import('./dist-server/engine.mjs')
  parentPort.on('message', ({ id, g, action, args, env }) => {
    try {
      const t = performance.now()
      const out = engine.runAction(g, action, args, env)
      parentPort.postMessage({ id, out, g, ms: performance.now() - t })
    } catch (error) {
      parentPort.postMessage({ id, error: error?.message ?? String(error) })
    }
  })
}

const intEnv = (v, dflt, lo, hi) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt)

export class MatchQueueFull extends Error {
  constructor() { super('match queue full'); this.queueFull = true }
}

export function createMatchComputer({
  workers = intEnv(process.env.MATCH_WORKERS, 2, 1, 4),
  queue = intEnv(process.env.MATCH_QUEUE, 200, 1, 1000),
  timeoutMs = 20_000,
} = {}) {
  /** @type {{ worker: Worker, task: object | null }[]} */
  const threads = []
  const waiting = []
  let nextId = 0
  let closed = false
  const stats = { done: 0, failed: 0, refused: 0, maxWaiting: 0 }

  function spawn() {
    const slot = { worker: new Worker(new URL(import.meta.url), { execArgv: [] }), task: null }
    const gone = (error) => {
      const i = threads.indexOf(slot)
      if (i < 0) return
      threads.splice(i, 1)
      slot.worker.terminate().catch(() => {})
      if (slot.task) { clearTimeout(slot.task.timer); stats.failed++; slot.task.reject(error); slot.task = null }
      pump()
    }
    slot.gone = gone
    slot.worker.on('message', ({ id, out, g, ms, error }) => {
      const task = slot.task
      if (!task || task.id !== id) return
      clearTimeout(task.timer)
      slot.task = null
      slot.worker.unref()
      if (error) { stats.failed++; task.reject(new Error(error)) } else { stats.done++; task.resolve({ out, g, ms }) }
      pump()
    })
    slot.worker.on('error', gone)
    slot.worker.on('exit', (code) => gone(new Error(`match worker exited (${code})`)))
    // an idle worker must not keep a check script alive
    slot.worker.unref()
    threads.push(slot)
    return slot
  }

  function pump() {
    if (closed) return
    while (waiting.length) {
      let slot = threads.find((s) => !s.task)
      if (!slot && threads.length < workers) slot = spawn()
      if (!slot) return
      const task = waiting.shift()
      slot.task = task
      task.started = performance.now()
      task.timer = setTimeout(() => slot.gone(new Error('match timeout')), timeoutMs)
      slot.worker.ref()
      slot.worker.postMessage({ id: task.id, g: task.g, action: task.action, args: task.args, env: task.env })
    }
  }

  return {
    /** Runs engine.runAction(g, …) on a worker; resolves to { out, g, ms } with g as the action left it. */
    run(g, action, args, env) {
      if (closed) return Promise.reject(new Error('match computer closed'))
      if (waiting.length >= queue) { stats.refused++; return Promise.reject(new MatchQueueFull()) }
      return new Promise((resolve, reject) => {
        waiting.push({ id: ++nextId, g, action, args, env, resolve, reject, timer: null })
        stats.maxWaiting = Math.max(stats.maxWaiting, waiting.length)
        pump()
      })
    },
    stats: () => ({ ...stats, workers: threads.length, busy: threads.filter((s) => s.task).length, waiting: waiting.length, limit: { workers, queue } }),
    close() {
      closed = true
      for (const task of waiting.splice(0)) task.reject(new Error('match computer closed'))
      for (const slot of threads.splice(0)) {
        if (slot.task) { clearTimeout(slot.task.timer); slot.task.reject(new Error('match computer closed')) }
        slot.worker.terminate().catch(() => {})
      }
    },
  }
}
