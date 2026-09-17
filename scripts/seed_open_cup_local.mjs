/**
 * Fill a LOCAL server's 全服杯 with accounts, over its real HTTP routes.
 *
 *   node scripts/seed_open_cup_local.mjs [base=http://localhost:8097] [accounts=13] [first=1]
 *
 * For the `val-server-cup` launch config (in-process database, fast cup
 * clock, admin token `devtoken`). Each account is claimed, handed five
 * 十连包 by the desk, opens them (that is the fifty pulls the sign-up asks
 * for), seats the best five it pulled — one per seat, no man twice — and
 * signs up. Refuses anything that is not localhost.
 */
const base = process.argv[2] ?? 'http://localhost:8097'
const count = Number(process.argv[3] ?? 13)
const first = Number(process.argv[4] ?? 1)
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('local servers only')
const { createHash } = await import('node:crypto')

const post = async (path, body, auth) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer devtoken' } : {}) },
    body: JSON.stringify(body),
  })
  return r.json().catch(() => ({ ok: false, status: r.status }))
}
const idOf = (i) => `VM-TEST-0000-0000-0000-${String(i).padStart(4, '0')}`
const world = await import('../dist-server/engine.mjs')
const SEATS = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const ready = []

for (let i = first; i < first + count; i++) {
  const id = idOf(i)
  const code = createHash('sha256').update(id).digest('hex').slice(0, 8)
  await post('/api/card/claim', { id, name: `测试${i}号` })
  await fetch(`${base}/api/admin/verify?code=${code}&via=local-test`, { method: 'POST', headers: { Authorization: 'Bearer devtoken' } })
  await post('/api/admin/grant', { who: id, pack: 'ten', count: 5, note: '本地全服杯测试' }, true)
  const client = { squad: { slots: [null, null, null, null, null], coach: null }, presets: [], friends: [] }
  await post('/api/card/act', { id, action: 'mail_take', args: {}, client })
  let state = null
  for (let k = 0; k < 5; k++) state = (await post('/api/card/act', { id, action: 'open', args: { kind: 'ten', payWith: 'pack' }, client })).state ?? state
  if (!state) { console.log(`${id}: could not open packs`); continue }
  const owned = Object.keys(state.cards).map((c) => world.cardById(c)).filter(Boolean)
  const players = owned.filter((c) => world.isPlayerCard(c)).sort((a, b) => b.rating - a.rating)
  const used = new Set()
  const slots = SEATS.map((seat) => {
    const pick = players.find((c) => !used.has(c.playerId ?? c.id) && (seat === '自由人' || c.roles.includes(seat)))
      ?? players.find((c) => !used.has(c.playerId ?? c.id))
    if (!pick) return null
    used.add(pick.playerId ?? pick.id)
    return pick.id
  })
  const coach = owned.find((c) => c.kind === 'coach')?.id ?? null
  // the five rides in on an action's client fields, which the server merges and stores
  const saved = await post('/api/card/act', { id, action: 'mail_seen', args: {}, client: { ...client, squad: { slots, coach } } })
  ready.push(id)
  console.log(`${id} #${code.toUpperCase()}  five ${saved.ok !== false}`)
}
// everybody signs up at the end, together, so a fast local clock cannot split them across two cups
for (const id of ready) {
  const joined = await post('/api/card/opencup/join', { id })
  console.log(`${id} join ${joined.ok ? `ok, ${joined.score} 分` : joined.why}`)
}
