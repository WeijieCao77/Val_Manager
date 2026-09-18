/** One reusable CPU worker per server process; no database connection is held while it runs. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

import { verifyCupBundle } from './opencup-engine-archive.js'

if (!isMainThread) {
  const source = workerData?.build ? await verifyCupBundle(workerData.build) : null
  const engine = source ? await import(`data:text/javascript;base64,${source.toString('base64')}`) : await import('./dist-server/engine.mjs')
  parentPort.on('message', ({ id, args }) => {
    try { parentPort.postMessage({ id, value: engine.playOpenCupMatch(...args) }) }
    catch (error) { parentPort.postMessage({ id, error: error.message }) }
  })
}

export function createCupComputer() {
  let worker = null
  let buildHash = null
  let nextId = 0
  const pending = new Map()
  const fail = (error) => {
    const old = worker
    worker = null
    old?.terminate().catch(() => {})
    for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(error) }
    pending.clear()
  }
  return {
    compute(args, build = null) {
      if (pending.size) return Promise.reject(new Error('cup worker is busy'))
      if (worker && buildHash !== (build?.hash ?? null)) { const old = worker; worker = null; old.terminate().catch(() => {}) }
      if (!worker) {
        buildHash = build?.hash ?? null
        const current = new Worker(new URL(import.meta.url), { execArgv: [], workerData: { build } })
        worker = current
        current.on('message', ({ id, value, error }) => {
          const task = pending.get(id)
          if (!task) return
          pending.delete(id)
          clearTimeout(task.timeout)
          current.unref()
          if (error) task.reject(new Error(error)); else task.resolve(value)
        })
        current.on('error', (e) => { if (worker === current) fail(e) })
        current.on('exit', (code) => { if (worker === current) fail(new Error(`cup worker exited (${code})`)) })
      }
      worker.ref()
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timeout = setTimeout(() => fail(new Error('cup simulation timeout')), 30_000)
        pending.set(id, { resolve, reject, timeout })
        worker.postMessage({ id, args })
      })
    },
    close() { fail(new Error('cup worker closed')) },
  }
}
