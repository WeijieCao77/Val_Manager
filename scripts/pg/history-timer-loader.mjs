// Explicit test-only loader: exercise the production boot/hourly callbacks quickly.
if (process.env.PG_ACCELERATE_HISTORY_TEST !== '1') throw new Error('test loader requires PG_ACCELERATE_HISTORY_TEST=1')
const timeout = globalThis.setTimeout, interval = globalThis.setInterval
let fired = false
globalThis.setTimeout = (fn, delay, ...args) => delay === 180000
  ? timeout(() => { console.log('TEST_HISTORY_BOOT_TIMER_FIRED'); fn(...args) }, 100)
  : timeout(fn, delay, ...args)
globalThis.setInterval = (fn, delay, ...args) => delay === 3600000
  ? interval(() => { if (!fired) { fired = true; console.log('TEST_HISTORY_HOURLY_TIMER_FIRED') }; fn(...args) }, 150)
  : interval(fn, delay, ...args)
