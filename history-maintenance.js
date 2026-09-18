/** One fold/prune job per process. Failed folds never authorize pruning. */
export function createHistoryMaintenance({ getSql, rollup, pruneFolded, prune, days }) {
  let running = null
  let requestedRows = Infinity
  return function keepHistory(maxRows) {
    if (!Number.isInteger(maxRows) || maxRows < 1) return Promise.reject(new RangeError('history row ceiling must be a positive integer'))
    requestedRows = Math.min(requestedRows, maxRows)
    if (running) return running
    // Assign running before any injected operation can synchronously re-enter.
    running = Promise.resolve().then(async () => {
      const sql = getSql()
      if (!sql) return { skipped: true, folded: null, pruned: 0 }
      const folded = await rollup(sql)
      let pruned = 0, appliedRows = Infinity
      // A concurrent pressure trigger may request a stricter ceiling. It joins
      // this job; after a successful fold it can tighten pruning without racing
      // another rollup. pruneFolded still enforces the committed watermark.
      while (requestedRows < appliedRows) {
        appliedRows = requestedRows
        pruned += Number(await pruneFolded(sql, prune, days, appliedRows)) || 0
      }
      return { skipped: false, folded, pruned }
    }).finally(() => { running = null; requestedRows = Infinity })
    return running
  }
}
