/**
 * Three test accounts with cards and a five each, for trying 抢五 and 选秀夜 on a local server
 * (DATABASE_URL=pglite:// — wiped on every restart, so run this after each start).
 *
 *   PORT=8098 node scripts/seed_swift_local.mjs
 *
 * Log in on the page with 「已经有 ID 了」 and one of the ids below.
 */
const B = `http://localhost:${process.env.PORT ?? 8098}`
const post = async (p, body, auth) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer devtoken' } : {}) }, body: JSON.stringify(body) }); return r.json() }
const ROLES = ['决斗者', '先锋', '控场', '哨卫']
for (const [id, name] of [['VM-TEST-0000-0000-0000-00A1', '甲队'], ['VM-TEST-0000-0000-0000-00B2', '乙队'], ['VM-TEST-0000-0000-0000-00C3', '丙队']]) {
  console.log(name, (await post('/api/card/claim', { id, name })).ok)
  console.log(' grant', (await post('/api/admin/grant', { who: id, pack: 'ten', count: 6 }, true)).ok)
  console.log(' mail', (await post('/api/card/act', { id, action: 'mail_take', args: {} })).ok)
  for (let i = 0; i < 6; i++) { const r = await post('/api/card/act', { id, action: 'open', args: { kind: 'ten', payWith: 'pack' } }); if (!r.ok) console.log(' open', r) }
  const l = await post('/api/card/load', { id })
  const st = l.state
  console.log(' cards', Object.keys(st.cards).length, 'rev', l.rev)
  globalThis.__name = name
  // pick by role from the card ids the engine knows: use the role encoded in the client's ALL_CARDS via a dynamic import
  const { cardById, isPlayerCard } = await import(new URL('../dist-server/engine.mjs', import.meta.url).href)
  const owned = Object.keys(st.cards).map(cardById).filter(isPlayerCard).sort((a, b) => b.rating - a.rating)
  const slots = []; const people = new Set()
  for (const r of [...ROLES, null]) { const c = owned.find((x) => (r ? x.role === r : true) && !slots.includes(x.id) && !people.has(x.playerId)); if (c) { slots.push(c.id); people.add(c.playerId) } }
  const squad = { slots, coach: null }
  const s = await post('/api/card/save', { id, client: { name, squad, presets: st.presets ?? [], friends: st.friends ?? [] }, baseRev: l.rev })
  console.log(' id', id, 'squad', slots.map((x) => cardById(x).ign).join(' '), s.ok ?? s)
}
