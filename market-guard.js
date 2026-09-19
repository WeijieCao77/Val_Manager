/**
 * Scripts on the trading post.
 *
 * 「有几个人写了脚本 24 小时抢交易，别人挂的便宜卡直接一口价拍掉。」 A script
 * polls the shelf every second and buys the instant a cheap 一口价 appears; a
 * person's shelf refreshes every two minutes and a purchase is three taps.
 * The difference is on the ledger already, and cannot be hidden without giving
 * the advantage up: HOW SOON after a card was listed it was bought outright.
 * card_offers has when the winning bid was made, card_listings has when the
 * card went up — so this reads history, needs no new bookkeeping, and judged
 * the week before it shipped on the day it shipped.
 *
 * What counts is a 一口价 purchase (an accepted bid at the listing's buy-now
 * price), by its age: fast (within FAST_SEC of the listing), quick, fresh.
 *
 *   A  fast  ≥ 3 in 24 h, from ≥ 3 sellers     nobody's thumbs do this thrice a day
 *   B  quick ≥ 8 in 24 h, from ≥ 5 sellers     a slower script, or one with a delay
 *   C  fresh ≥ 20 in 7 d over ≥ 20 clock hours  nobody is awake for all of them
 *
 * Sellers are counted because two friends handing a card over ARE fast — one
 * lists, the other is waiting — and that is one seller, however often.
 *
 * A and B suspend trading (MARKET_GUARD=ban, the default): three days the
 * first time, five after that. C, and anybody half-way to A or B, is only put
 * in front of the owner (「watch」) — it is the pattern a patient script would
 * fall back to, but it is also the one a very keen person could brush, so a
 * person decides. MARKET_GUARD=watch bans nobody; =off does nothing.
 *
 * Suspended means: no listing, no bidding, no buying, no swaps. Withdrawing,
 * answering and collecting still work, so nothing a suspended account already
 * had on the table is stranded. Evidence is kept with the ban, the owner can
 * lift one (which also forgives everything before the lift), and only
 * purchases made after an account's last ban count toward its next.
 */
export const GUARD = {
  FAST_SEC: 8, QUICK_SEC: 45, FRESH_SEC: 300,
  FAST_N: 3, FAST_SELLERS: 3,
  QUICK_N: 8, QUICK_SELLERS: 5,
  FRESH_N: 20, FRESH_HOURS: 20,
  FIRST_DAYS: 3, REPEAT_DAYS: 5,
}
const DAY = 86_400_000

export const GUARD_SCHEMA = `
create table if not exists market_bans (
  id       bigserial primary key,
  id_hash  text not null,
  until    timestamptz not null,
  rule     text not null,
  evidence jsonb not null default '{}'::jsonb,
  by       text not null default 'auto',
  made     timestamptz not null default now(),
  lifted   timestamptz
);
create index if not exists market_bans_who_idx on market_bans (id_hash, made desc);
`

/**
 * One account's 一口价 purchases → what they look like.
 * buys: [{ made, created, seller }] (dates or ms). Pure, so the check script can walk its edges.
 */
export function judge(buys, now = Date.now()) {
  const rows = buys.map((b) => {
    const made = new Date(b.made).getTime()
    return { made, age: (made - new Date(b.created).getTime()) / 1000, seller: b.seller }
  }).filter((b) => Number.isFinite(b.age) && b.age >= 0 && b.made <= now)
  const day = rows.filter((b) => now - b.made <= DAY)
  const week = rows.filter((b) => now - b.made <= 7 * DAY)
  const within = (list, sec) => list.filter((b) => b.age <= sec)
  const sellers = (list) => new Set(list.map((b) => b.seller)).size
  const fast = within(day, GUARD.FAST_SEC)
  const quick = within(day, GUARD.QUICK_SEC)
  const fresh = within(week, GUARD.FRESH_SEC)
  const hours = new Set(fresh.map((b) => new Date(b.made).getUTCHours())).size
  const counts = {
    day: day.length, week: week.length,
    fast: fast.length, fastSellers: sellers(fast),
    quick: quick.length, quickSellers: sellers(quick),
    fresh: fresh.length, freshHours: hours,
    fastest: rows.length ? Math.round(Math.min(...rows.map((b) => b.age)) * 10) / 10 : null,
  }
  let verdict = null
  let rule = null
  if (fast.length >= GUARD.FAST_N && counts.fastSellers >= GUARD.FAST_SELLERS) { verdict = 'ban'; rule = 'A' }
  else if (quick.length >= GUARD.QUICK_N && counts.quickSellers >= GUARD.QUICK_SELLERS) { verdict = 'ban'; rule = 'B' }
  else if (fresh.length >= GUARD.FRESH_N && hours >= GUARD.FRESH_HOURS) { verdict = 'watch'; rule = 'C' }
  else if (fast.length >= 2 || quick.length >= Math.ceil(GUARD.QUICK_N / 2) || fresh.length >= GUARD.FRESH_N / 2) { verdict = 'watch'; rule = 'near' }
  return { verdict, rule, counts }
}

export function makeMarketGuard(sql, { bg = null, mode = process.env.MARKET_GUARD ?? 'ban', displayName = null } = {}) {
  const work = bg ?? sql
  const off = mode === 'off' || !sql
  /** id_hash → until (ms), every ban still running; small, re-read once a minute */
  let active = new Map()
  let activeAt = 0
  let loading = null
  async function loadActive(force = false) {
    if (off) return active
    if (!force && Date.now() - activeAt < 60_000) return active
    loading ??= work`select id_hash, max(until) as until from market_bans where lifted is null and until > now() group by id_hash`
      .then((rows) => { active = new Map(rows.map((r) => [r.id_hash, new Date(r.until).getTime()])); activeAt = Date.now() })
      // a database without the table yet bans nobody; asked again in a minute
      .catch((err) => { activeAt = Date.now(); if (!/market_bans/.test(err.message)) console.warn('guard: bans unread', err.message) })
      .finally(() => { loading = null })
    await loading
    return active
  }

  /** null, or { until, why } — what a suspended account is told. */
  async function banOf(me) {
    if (off || !me) return null
    const until = (await loadActive()).get(me)
    if (!until || until <= Date.now()) return null
    return { until, why: `检测到脚本抢拍，交易已暂停到 ${stamp(until)}。有误请联系群主。` }
  }
  // 北京时间, whoever's server this is
  const stamp = (ms) => {
    const d = new Date(ms + 8 * 3600_000)
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  }

  const buysOf = (me, since) => work`
    select o.made, l.created, l.seller_h as seller, l.card_id, o.price
    from card_offers o join card_listings l on l.id = o.listing
    where o.buyer_h = ${me} and o.status = 'accepted'
      and l.buyout is not null and o.price >= l.buyout
      and o.made > ${since}
    order by o.made desc limit 500`

  /** When this account's slate was last wiped: its newest ban (or the lift of it). */
  async function slate(me) {
    const last = await work`
      select made, lifted, (select count(*)::int from market_bans where id_hash = ${me} and lifted is null) as strikes
      from market_bans where id_hash = ${me} order by made desc limit 1`
    const from = last.length ? new Date(last[0].lifted ?? last[0].made).getTime() : 0
    return { since: new Date(Math.max(from, Date.now() - 7 * DAY)), strikes: last[0]?.strikes ?? 0 }
  }

  async function ban(me, { days, rule, evidence = {}, by = 'auto' }) {
    const until = new Date(Date.now() + days * DAY)
    // one running ban an account: two purchases a moment apart are both looked at, and both would write one
    const made = await work`
      insert into market_bans (id_hash, until, rule, evidence, by)
      select ${me}, ${until}, ${rule}, ${work.json(evidence)}, ${by}
      where ${by} = 'owner' or not exists (select 1 from market_bans where id_hash = ${me} and lifted is null and until > now())
      returning until`
    if (!made.length) { await loadActive(true); return active.get(me) ?? null }
    active.set(me, until.getTime())
    console.warn(`guard: ${me.slice(0, 8)} suspended ${days}d (${rule}, by ${by})`)
    return until.getTime()
  }

  /** Look at one account — called after each 一口价 purchase, off the request's clock. */
  async function check(me) {
    if (off) return null
    const { since, strikes } = await slate(me)
    const buys = await buysOf(me, since)
    const found = judge(buys)
    if (found.verdict === 'ban' && mode === 'ban' && !(await banOf(me))) {
      const days = strikes ? GUARD.REPEAT_DAYS : GUARD.FIRST_DAYS
      const sample = buys.slice(0, 12).map((b) => ({
        card: b.card_id, price: b.price, made: b.made,
        age: Math.round((new Date(b.made) - new Date(b.created)) / 100) / 10, seller: String(b.seller).slice(0, 8),
      }))
      found.until = await ban(me, { days, rule: found.rule, evidence: { counts: found.counts, sample } })
    }
    return found
  }
  const checkSoon = (me) => { if (!off) check(me).catch((err) => console.warn('guard: check failed', err.message)) }

  /** Everybody who bought outright this week, judged — the first run after a deploy, and the owner's 「重新扫一遍」. */
  async function scan() {
    if (off) return []
    const buyers = await work`
      select o.buyer_h, count(*)::int as n
      from card_offers o join card_listings l on l.id = o.listing
      where o.status = 'accepted' and l.buyout is not null and o.price >= l.buyout
        and o.made > now() - interval '7 days'
      group by o.buyer_h having count(*) >= 2 order by n desc limit 300`
    const out = []
    for (const b of buyers) {
      const found = await check(b.buyer_h)
      if (found?.verdict) out.push({ id_hash: b.buyer_h, ...found })
    }
    return out
  }

  /** For the owner: who is suspended, who was, and who is worth a look. */
  async function report({ rescan = false } = {}) {
    const flagged = rescan || mode !== 'off' ? await scan() : []
    await loadActive(true)
    const bans = await work`select id, id_hash, until, rule, evidence, by, made, lifted from market_bans order by made desc limit 200`
    const names = new Map()
    const want = [...new Set([...bans.map((b) => b.id_hash), ...flagged.map((f) => f.id_hash)])]
    if (want.length) {
      for (const r of await work`select id_hash, name from card_accounts where id_hash = any(${want})`) names.set(r.id_hash, r.name)
    }
    const who = (h) => ({ code: h.slice(0, 8).toUpperCase(), name: displayName ? displayName(names.get(h), h).name : names.get(h) ?? null })
    return {
      mode, rules: GUARD,
      bans: bans.map((b) => ({ id: String(b.id), ...who(b.id_hash), until: b.until, rule: b.rule, by: b.by, made: b.made, lifted: b.lifted, running: !b.lifted && new Date(b.until) > new Date(), evidence: b.evidence })),
      flagged: flagged.map((f) => ({ ...who(f.id_hash), verdict: f.verdict, rule: f.rule, counts: f.counts })),
    }
  }

  async function byCode(code) {
    const c = String(code ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8}$/.test(c)) return null
    const rows = await work`select id_hash from card_accounts where id_hash like ${c + '%'} limit 2`
    return rows.length === 1 ? rows[0].id_hash : null
  }
  /** The owner's hand: suspend by 对战码, or lift (which forgives what came before). */
  async function manual({ code, action, days, note }) {
    const me = await byCode(code)
    if (!me) return { ok: false, why: '没有这个对战码' }
    if (action === 'lift') {
      const rows = await work`update market_bans set lifted = now() where id_hash = ${me} and lifted is null and until > now() returning id`
      active.delete(me)
      return { ok: true, lifted: rows.length }
    }
    if (action === 'ban') {
      const d = Math.max(1, Math.min(30, Math.round(Number(days)) || GUARD.FIRST_DAYS))
      const until = await ban(me, { days: d, rule: 'manual', evidence: { note: String(note ?? '').slice(0, 200) }, by: 'owner' })
      return { ok: true, until }
    }
    if (action === 'check') return { ok: true, ...(await check(me)) }
    return { ok: false, why: 'action' }
  }

  return { mode, banOf, check, checkSoon, scan, report, manual, invalidate() { active = new Map(); activeAt = 0 } }
}
