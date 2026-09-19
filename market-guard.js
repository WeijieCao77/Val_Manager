/**
 * Scripts on the trading post.
 *
 * 「有几个人写了脚本 24 小时抢交易，别人挂的便宜卡直接一口价拍掉。」 The
 * difference between a script and a person is on the ledger already: HOW SOON
 * after a card was listed it was bought outright, how often, and from how many
 * different people. card_offers has when the winning bid was made,
 * card_listings has when the card went up — so this reads history and needs
 * no new bookkeeping.
 *
 * The thresholds were first guessed from how the client works, and the guess
 * was wrong: read against the live ledger on 2026-09-19 (161 accounts, a week
 * of trades each) a keen person wins a race in 3–6 seconds routinely, and a
 * sniping script is not faster than that — it polls every few seconds and its
 * median is 5 to 30 s. What it does that nobody does by hand is win DOZENS of
 * those races a day, from dozens of different sellers, day after day
 * (813806CD: 664 一口价 in a week from 65 sellers, median 5.4 s; B596D4CE: 516
 * over 22 of the day's 24 hours). And a second kind turned up that nobody had
 * reported: pairs of accounts passing cards back and forth by script, 470
 * times a day at a machine's cadence, with purchases 0.7 s after the listing.
 *
 * What counts is a 一口价 purchase, by its age. A seller counts a few times
 * and no more (SELLER_CAP a day, SELLER_CAP_WEEK a week): two friends — or a
 * player and his alt — handing cards over ARE quick, and that is one seller,
 * however often; sniping is quick purchases from MANY.
 *
 *   A  ultra (≤ 2 s)  ≥ 5 in 24 h                     no hand is that fast: load, tap, tap, confirm
 *                                                     (entries in a 保护期 draw count here, won or lost)
 *   B  quick (≤ 45 s), capped a seller, ≥ 40 in 24 h   forty races won in a day, from a dozen people or more
 *   C  the same over 7 days ≥ 120                      the patient version of B
 *   D  fresh (≤ 5 min) ≥ 100 in 7 d over ≥ 20 of the 24 clock hours   nobody is awake for all of them
 *   E  trading purchases from ONE seller ≥ 30 in 24 h  a main and its alt passing cards across (owner, 2026-09-19:
 *                                                      「这种大小号来回倒检测到也封」 — it was watch-only for a few hours)
 *
 * (A was three at first; the owner made it five on 2026-09-19 and had everybody
 * suspended until then let out.) On that week's ledger these catch 35 of the 161 and leave out the people at
 * the edge (26–39 capped quick purchases on their best day) — those and anybody
 * half-way to a rule are put in front of the owner (「watch」) and not touched.
 * Since the 保护期 (the same day) 「quick」 is measured to 45 s past the END of the
 * protected minute; that was reasoned, not replayed — there was no ledger with a
 * 保护期 in it yet — and is the first thing to re-read against one.
 *
 * Collecting is not trading (owner, 2026-09-19, after rule E suspended four people in an hour: 「很多玩家
 * 会选『没有的卡』，一个一个去拍市场上他没有且价格不高的卡」). On the hot end of this market every cheap
 * card goes within minutes, so somebody filling a collection buys as fresh, as often and from the same prolific
 * sellers as a script does — by age alone the two cannot be told apart. What differs is WHAT is bought: a
 * collector buys each card once and keeps it (Leee: 78 purchases, 77 different cards, none resold), a script
 * buys the same card again and again or puts it straight back on the shelf (4EF44D06: 1899 purchases of 640
 * cards; 0930F66C: two in three relisted). So B, C and E count only TRADING purchases — a card this account
 * had already bought in the window, or one it listed again afterwards. Replayed over the same 161 accounts:
 * everybody suspended by mistake falls to a fifth of a threshold or less, every sniper and every pair stays
 * over, and E's distribution is two humps with nothing between 26 and 187. A and D are about what a body can
 * do and count every purchase as before.
 *
 * Which of them suspend by themselves (owner, 2026-09-19, 「稳一点」): only A and E. What the owner wants gone is
 * a script that buys the instant a card appears — 「卡一发出来它就秒」 — and accounts passing cards between
 * themselves, two, three or four in a ring. What must never be touched is a person who ticks 「没有的卡」 and
 * buys whatever on the shelf looks fairly priced, one card after another, dozens at a time when he has the coins:
 * those cards have mostly been on the shelf a while (bronze nobody else wants), and none of it is speed. A is
 * speed and nothing else. E is a card going round: bought from the same seller again and again, or bought and
 * put back on the shelf, thirty times in a day — which is what a ring looks like from any seat in it (each
 * account keeps buying the same cards from the one before it), and no age limit on it, so waiting out the
 * protected minute hides nothing. B, C and D describe a script too, but a very keen person could brush them,
 * so they put an account in front of the owner (「watch」, with the rule's letter) and suspend nobody.
 * MARKET_GUARD_AUTO lists the letters that do; the default is A,E.
 *
 * Suspensions (MARKET_GUARD=ban, the default): three days the first
 * time, five after that. MARKET_GUARD=watch bans nobody; =off does nothing.
 *
 * Suspended means: no listing, no bidding, no buying, no swaps. Withdrawing,
 * answering and collecting still work, so nothing a suspended account already
 * had on the table is stranded. Evidence is kept with the ban, the owner can
 * lift one (which also forgives everything before the lift), and only
 * purchases made after an account's last ban count toward its next.
 */
/**
 * 上架保护期 (market-api.js): for this long after a card goes up a buy-now is an entry in a draw, and only
 * after it does a buy-now buy at once. It lives here because the guard's clocks are read from it: the race
 * a script wins now starts when the minute ENDS, so 「quick」 runs to QUICK_SEC past that moment, and a
 * purchase in the two seconds after it is as inhuman as one in the two seconds after the listing.
 */
export const PROTECT_SEC = 60

export const GUARD = {
  ULTRA_SEC: 2, QUICK_SEC: PROTECT_SEC + 45, FRESH_SEC: 300,
  // 大小号来回倒: this many TRADING purchases (bought before, or listed again) from ONE seller in a day, any age
  LOOP_N: 30,
  ULTRA_N: 5,
  SELLER_CAP: 3, QUICK_DAY: 40,
  SELLER_CAP_WEEK: 10, QUICK_WEEK: 120,
  FRESH_N: 100, FRESH_HOURS: 20,
  FIRST_DAYS: 3, REPEAT_DAYS: 5,
}
/** the rules that suspend by themselves; the rest only report */
const autoRules = (v = process.env.MARKET_GUARD_AUTO) => new Set(String(v ?? 'A,E').toUpperCase().split(/[^A-E]+/).filter(Boolean))
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
 * buys: [{ made, created, seller, card_id?, flipped?, won? }] (dates or ms). Pure, so the check script can walk its edges.
 */
export function judge(buys, now = Date.now(), AUTO = autoRules()) {
  const rows = buys.map((b) => {
    const made = new Date(b.made).getTime()
    return { made, age: (made - new Date(b.created).getTime()) / 1000, seller: b.seller, won: b.won !== false, card: b.card_id ?? null, flipped: b.flipped === true }
  }).filter((b) => Number.isFinite(b.age) && b.age >= 0 && b.made <= now)
  // Since the 保护期 a buy-now in the first minute is an entry in a draw, and most entries lose. Volume is
  // still judged on cards actually bought; but an entry two seconds after the listing is a script's, won or lost.
  const entries = rows.filter((b) => now - b.made <= DAY)
  rows.splice(0, rows.length, ...rows.filter((b) => b.won))
  // Trading or collecting: a card bought before in the window, or listed again afterwards, is trading. A row
  // with no card id (the check script's paper cases) counts as trading, which is what every rule assumed before.
  const had = new Set()
  for (const b of rows.slice().sort((x, y) => x.made - y.made)) {
    b.trading = b.card === null || b.flipped || had.has(b.card)
    if (b.card !== null) had.add(b.card)
  }
  const day = rows.filter((b) => now - b.made <= DAY)
  const week = rows.filter((b) => now - b.made <= 7 * DAY)
  const within = (list, sec) => list.filter((b) => b.age <= sec)
  const perSeller = (list) => {
    const n = new Map()
    for (const b of list) n.set(b.seller, (n.get(b.seller) ?? 0) + 1)
    return n
  }
  /** each seller counted `cap` times at most: many purchases from one person are a hand-over, not a snipe */
  const capped = (list, cap) => [...perSeller(list).values()].reduce((sum, n) => sum + Math.min(n, cap), 0)
  // within two seconds of the listing, or of the moment its protected minute ended
  const ultra = entries.filter((b) => b.age <= GUARD.ULTRA_SEC || (b.age >= PROTECT_SEC && b.age <= PROTECT_SEC + GUARD.ULTRA_SEC))
  const trades = (list) => list.filter((b) => b.trading)
  const quickDay = within(trades(day), GUARD.QUICK_SEC)
  const quickWeek = within(trades(week), GUARD.QUICK_SEC)
  const fresh = within(week, GUARD.FRESH_SEC)
  const hours = new Set(fresh.map((b) => new Date(b.made).getUTCHours())).size
  const ages = week.map((b) => b.age).sort((a, b) => a - b)
  const round1 = (x) => Math.round(x * 10) / 10
  const counts = {
    day: day.length, week: week.length,
    // of the week's purchases, the ones that were trading rather than collecting — what B, C and E count
    trading: trades(week).length,
    ultra: ultra.length,
    quick: quickDay.length, quickCapped: capped(quickDay, GUARD.SELLER_CAP), quickSellers: perSeller(quickDay).size,
    quickWeek: quickWeek.length, quickWeekCapped: capped(quickWeek, GUARD.SELLER_CAP_WEEK),
    // the most trading purchases from any ONE seller today, however old the listing: cards going round between accounts
    loop: Math.max(0, ...perSeller(trades(day)).values()),
    fresh: fresh.length, freshHours: hours,
    fastest: ages.length ? round1(ages[0]) : null,
    median: ages.length ? round1(ages[Math.floor(ages.length / 2)]) : null,
  }
  const over = []
  if (counts.ultra >= GUARD.ULTRA_N) over.push('A')
  if (counts.loop >= GUARD.LOOP_N) over.push('E')
  if (counts.quickCapped >= GUARD.QUICK_DAY) over.push('B')
  if (counts.quickWeekCapped >= GUARD.QUICK_WEEK) over.push('C')
  if (counts.fresh >= GUARD.FRESH_N && hours >= GUARD.FRESH_HOURS) over.push('D')
  const auto = over.find((r) => AUTO.has(r))
  let verdict = null
  let rule = null
  if (auto) { verdict = 'ban'; rule = auto }
  else if (over.length) { verdict = 'watch'; rule = over[0] }
  else if (counts.loop >= GUARD.LOOP_N / 3) { verdict = 'watch'; rule = 'loop' }
  else if (counts.ultra >= 1 || counts.quickCapped >= 15 || counts.quickWeekCapped >= 60 || (hours >= 16 && counts.fresh >= 40)) { verdict = 'watch'; rule = 'near' }
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
    select o.made, l.created, l.seller_h as seller, l.card_id, o.price, (o.status = 'accepted') as won,
           -- bought and put back on the shelf: trading, not collecting
           exists (select 1 from card_listings r where r.seller_h = o.buyer_h and r.card_id = l.card_id and r.created > o.made) as flipped
    from card_offers o join card_listings l on l.id = o.listing
    -- 'expired' at the buy-now price is an entry in a 保护期 draw that somebody else won
    -- ('open' at that price is an entry whose draw has not happened yet)
    where o.buyer_h = ${me} and o.status in ('accepted', 'expired', 'open')
      and l.buyout is not null and o.price >= l.buyout
      and o.made > ${since}
    order by o.made desc limit 3000`

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
  async function check(me, { dry = false } = {}) {
    if (off) return null
    const { since, strikes } = await slate(me)
    const buys = await buysOf(me, since)
    const found = judge(buys)
    if (found.verdict === 'ban' && mode === 'ban' && !dry && !(await banOf(me))) {
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

  /**
   * Everybody who bought outright this week, judged — for the owner's list and the log line after boot.
   * It suspends nobody: a suspension only ever follows a purchase made while this code was running, so a
   * threshold that turns out wrong on live data is seen in the report before it has cost anybody anything.
   */
  async function scan() {
    if (off) return []
    const buyers = await work`
      select o.buyer_h, count(*)::int as n
      from card_offers o join card_listings l on l.id = o.listing
      where o.status = 'accepted' and l.buyout is not null and o.price >= l.buyout
        and o.made > now() - interval '7 days'
      group by o.buyer_h having count(*) >= 10 order by n desc limit 400`
    const out = []
    for (const b of buyers) {
      const found = await check(b.buyer_h, { dry: true })
      if (found?.verdict) out.push({ id_hash: b.buyer_h, ...found })
    }
    return out
  }

  /** For the owner: who is suspended, who was, and who is worth a look. */
  async function report() {
    const flagged = await scan()
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

  /**
   * How many cards each buyer bought in the last seven days — counts only, no names and no hashes — so a
   * threshold can be read against everybody and not only against the accounts it already flagged.
   * `all` is every purchase (an auction won or a buy-now), `buyouts` the buy-now ones the rules look at,
   * `trading` the buy-nows of a card bought before in the week or listed again afterwards (what B, C, E count).
   */
  async function weekly() {
    const rows = await work`
      with b as (
        select o.buyer_h, l.card_id, o.made,
               (l.buyout is not null and o.price >= l.buyout) as buyout,
               exists (select 1 from card_listings r where r.seller_h = o.buyer_h and r.card_id = l.card_id and r.created > o.made) as flipped,
               row_number() over (partition by o.buyer_h, l.card_id order by o.made) as nth
        from card_offers o join card_listings l on l.id = o.listing
        where o.status = 'accepted' and o.made > now() - interval '7 days'
      )
      select count(*)::int as n, (count(*) filter (where buyout))::int as buyouts,
             (count(*) filter (where buyout and (flipped or nth > 1)))::int as trading
      from b group by buyer_h`
    const active = await work`select count(*)::int as n from card_accounts where seen > now() - interval '7 days'`
    const sorted = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)
    return { ok: true, buyers: rows.length, activeAccounts: active[0]?.n ?? null, all: sorted('n'), buyouts: sorted('buyouts'), trading: sorted('trading') }
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
    if (action === 'check') return { ok: true, ...(await check(me, { dry: true })) }
    return { ok: false, why: 'action' }
  }

  return { mode, banOf, check, checkSoon, scan, report, manual, weekly, invalidate() { active = new Map(); activeAt = 0 } }
}
