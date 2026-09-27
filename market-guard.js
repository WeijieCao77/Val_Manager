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
// F and G (倒卡) report first: on 2026-09-26 the ledger showed rings trading hundreds of times a day, and how many
// accounts they would suspend is read off the owner's list before they suspend by themselves
const autoRules = (v = process.env.MARKET_GUARD_AUTO) => new Set(String(v ?? 'A,E').toUpperCase().split(/[^A-G]+/).filter(Boolean))
const DAY = 86_400_000

/**
 * 倒卡: coins moved between accounts through the market (owner, 2026-09-26, with a screenshot: a gold nobody
 * trades, 起拍 700, 一口价 168,397 — 「有零有整，一看就是小号把钱倒到大号」). Rules A–E look at how a buyer buys;
 * these look at what a sale is: its price against what the same card at the same level goes for (saleValue),
 * and how often the same two accounts trade. Both sides of it are suspended — the account the coins came
 * from is usually a throwaway, and the one they went to is the point of it.
 *
 *   F  one sale at F_RATIO × what the card goes for, and at least F_GAP over it
 *   G  the same two accounts trade G_N times inside 24 h, either way round, and it is not somebody filling a
 *      collection from a prolific seller: the cards went BOTH ways between them, or G_OVER_N of the trades were
 *      at G_RATIO × the card's price or more (owner: 「一天内两三次两个号互相倒，就已经很明显了」)
 *
 * Only trades in the last 24 h trigger it, and only after the account's last ban or lift, like the rest.
 */
export const TRANSFER = {
  F_RATIO: 20, F_GAP: 30_000,
  G_N: 3, G_RATIO: 3, G_OVER_N: 2,
}

/**
 * One account's trades (bought or sold) → does any of them move coins? Pure.
 * trades: [{ other, bought, price, ref, at }] — `ref` is what that card at that level goes for (saleValue).
 * Returns { verdict, rule, others, evidence } — `others` are the accounts on the far side to suspend with it.
 */
export function judgeTransfers(trades, now = Date.now(), AUTO = autoRules()) {
  const T = TRANSFER
  const rows = trades.map((t) => ({ ...t, at: new Date(t.at).getTime(), ratio: t.price / Math.max(1, t.ref), over: t.price - t.ref }))
    .filter((t) => Number.isFinite(t.at) && t.at <= now && now - t.at <= DAY)
  const dumps = rows.filter((t) => t.ratio >= T.F_RATIO && t.over >= T.F_GAP)
  const byOther = new Map()
  for (const t of rows) byOther.set(t.other, [...(byOther.get(t.other) ?? []), t])
  const loops = []
  for (const [other, list] of byOther) {
    if (list.length < T.G_N) continue
    const both = list.some((t) => t.bought) && list.some((t) => !t.bought)
    const pricey = list.filter((t) => t.ratio >= T.G_RATIO).length
    if (both || pricey >= T.G_OVER_N) loops.push({ other, n: list.length, both, pricey })
  }
  const round = (x) => Math.round(x * 10) / 10
  const evidence = {
    dumps: dumps.slice(0, 6).map((t) => ({ other: String(t.other).slice(0, 8), bought: t.bought, price: t.price, ref: t.ref, ratio: round(t.ratio), card: t.card ?? null })),
    loops: loops.slice(0, 6).map((l) => ({ other: String(l.other).slice(0, 8), n: l.n, both: l.both, pricey: l.pricey })),
  }
  // near: worth the owner's eye, not a suspension
  const near = rows.some((t) => t.ratio >= T.F_RATIO / 2 && t.over >= T.F_GAP / 3)
    || [...byOther.values()].some((l) => l.length >= T.G_N - 1 && l.some((t) => t.bought) && l.some((t) => !t.bought))
  const rule = dumps.length ? 'F' : loops.length ? 'G' : null
  if (rule) {
    const others = [...new Set([...dumps.map((t) => t.other), ...loops.map((l) => l.other)])]
    return { verdict: AUTO.has(rule) ? 'ban' : 'watch', rule, others, evidence }
  }
  return { verdict: near ? 'watch' : null, rule: near ? 'transfer' : null, others: [], evidence }
}

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

/** what the game pays for a card of each rarity: nobody sells below it, so no card is worth less */
const FLOOR = { mythic: 4000, gold: 700, silver: 200, bronze: 60 }
/**
 * What a card at a level is usually worth, from the month's sales (refRows: { card_id, level, n, med }).
 * Its own median when it sold at least three times at that level; else the median of its rarity at that
 * level (a 冷门卡 has no market of its own, and a gold nobody trades is still a gold); never under salvage.
 */
export function saleValue(refRows, cardById = null) {
  const own = new Map(refRows.map((r) => [`${r.card_id}|${r.level}`, r]))
  const rarityOf = (id) => cardById?.(id)?.rarity ?? null
  const byRarity = new Map()
  for (const r of refRows) {
    if (r.n < 3) continue
    const k = `${rarityOf(r.card_id)}|${r.level}`
    const list = byRarity.get(k) ?? []
    list.push(r.med)
    byRarity.set(k, list)
  }
  const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const rarityMed = new Map([...byRarity].map(([k, xs]) => [k, med(xs)]))
  return (cardId, level) => {
    const rarity = rarityOf(cardId)
    const floor = FLOOR[rarity] ?? 60
    const o = own.get(`${cardId}|${level}`)
    if (o && o.n >= 3) return { ref: Math.max(floor, o.med), n: o.n, from: 'card' }
    const r = rarityMed.get(`${rarity}|${level}`) ?? rarityMed.get(`${rarity}|0`)
    return { ref: Math.max(floor, r ?? floor), n: o?.n ?? 0, from: r ? 'rarity' : 'floor' }
  }
}

export function makeMarketGuard(sql, { bg = null, mode = process.env.MARKET_GUARD ?? 'ban', displayName = null, cardById = null } = {}) {
  const work = bg ?? sql
  const off = mode === 'off' || !sql
  /** id_hash → { until (ms), rule }, every ban still running; small, re-read once a minute */
  let active = new Map()
  let activeAt = 0
  let loading = null
  async function loadActive(force = false) {
    if (off) return active
    if (!force && Date.now() - activeAt < 60_000) return active
    loading ??= work`
      select distinct on (id_hash) id_hash, until, rule from market_bans
      where lifted is null and until > now() order by id_hash, until desc`
      .then((rows) => { active = new Map(rows.map((r) => [r.id_hash, { until: new Date(r.until).getTime(), rule: r.rule }])); activeAt = Date.now() })
      // a database without the table yet bans nobody; asked again in a minute
      .catch((err) => { activeAt = Date.now(); if (!/market_bans/.test(err.message)) console.warn('guard: bans unread', err.message) })
      .finally(() => { loading = null })
    await loading
    return active
  }

  /** null, or { until, why } — what a suspended account is told. */
  async function banOf(me) {
    if (off || !me) return null
    const { until, rule } = (await loadActive()).get(me) ?? {}
    if (!until || until <= Date.now()) return null
    const what = rule === 'F' || rule === 'G' ? '检测到账号之间倒卡' : '检测到脚本抢拍'
    return { until, why: `${what}，交易已暂停到 ${stamp(until)}。有误请联系群主。` }
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
    if (!made.length) { await loadActive(true); return active.get(me)?.until ?? null }
    active.set(me, { until: until.getTime(), rule })
    console.warn(`guard: ${me.slice(0, 8)} suspended ${days}d (${rule}, by ${by})`)
    return until.getTime()
  }

  /**
   * What each card at each level goes for (saleValue over the month's sales), read at most every half hour
   * and by one caller at a time: it is one grouped pass over a month of sales, and every purchase asks.
   */
  let values = null
  let valuesAt = 0
  let valuesLoading = null
  async function valueFn() {
    if (values && Date.now() - valuesAt < 30 * 60_000) return values
    valuesLoading ??= work`
      select l.card_id, l.level, count(*)::int as n,
             percentile_cont(0.5) within group (order by o.price)::int as med
      from card_offers o join card_listings l on l.id = o.listing
      where o.status = 'accepted' and l.status = 'sold' and l.closed > now() - interval '30 days'
      group by l.card_id, l.level`
      .then((rows) => { values = saleValue(rows, cardById); valuesAt = Date.now() })
      .finally(() => { valuesLoading = null })
    await valuesLoading
    return values
  }
  /** Every sale this account stood on either side of since `since` (a day at most is judged), priced. */
  async function tradesOf(me, since) {
    const day = new Date(Math.max(new Date(since).getTime(), Date.now() - DAY))
    const [bought, sold, value] = await Promise.all([
      work`
        select l.seller_h as other, o.price, l.card_id, l.level, l.closed as at
        from card_offers o join card_listings l on l.id = o.listing
        where o.buyer_h = ${me} and o.status = 'accepted' and l.status = 'sold' and l.closed > ${day}
        limit 2000`,
      work`
        select o.buyer_h as other, o.price, l.card_id, l.level, l.closed as at
        from card_listings l join card_offers o on o.listing = l.id and o.status = 'accepted'
        where l.seller_h = ${me} and l.status = 'sold' and l.closed > ${day}
        limit 2000`,
      valueFn(),
    ])
    const priced = (t, b) => ({ other: t.other, bought: b, price: t.price, ref: value(t.card_id, t.level).ref, at: t.at, card: t.card_id })
    return [...bought.map((t) => priced(t, true)), ...sold.map((t) => priced(t, false))].filter((t) => t.other !== me)
  }

  /** Look at one account — called after each purchase, off the request's clock. */
  async function check(me, { dry = false } = {}) {
    if (off) return null
    const { since, strikes } = await slate(me)
    const buys = await buysOf(me, since)
    const found = judge(buys)
    // coins moved between accounts: this one and whoever was on the other side of it
    const moved = judgeTransfers(await tradesOf(me, since))
    found.transfer = moved
    if (found.verdict !== 'ban' && moved.verdict) {
      if (moved.verdict === 'ban' || !found.verdict) { found.verdict = moved.verdict; found.rule = moved.rule }
    }
    if (found.verdict === 'ban' && mode === 'ban' && !dry && !(await banOf(me))) {
      const days = strikes ? GUARD.REPEAT_DAYS : GUARD.FIRST_DAYS
      const sample = buys.slice(0, 12).map((b) => ({
        card: b.card_id, price: b.price, made: b.made,
        age: Math.round((new Date(b.made) - new Date(b.created)) / 100) / 10, seller: String(b.seller).slice(0, 8),
      }))
      const rule = found.rule
      const byMoving = rule === 'F' || rule === 'G'
      const evidence = byMoving ? { transfer: moved.evidence, with: moved.others.map((h) => String(h).slice(0, 8)) } : { counts: found.counts, sample }
      found.until = await ban(me, { days, rule, evidence })
      // …and the far side of it, unless the owner let that account out after the trade (a lift forgives what came before)
      if (byMoving) {
        for (const other of moved.others) {
          if (await banOf(other)) continue
          const theirs = await slate(other)
          if (!(await tradesOf(other, theirs.since)).some((t) => t.other === me)) continue
          await ban(other, { days: theirs.strikes ? GUARD.REPEAT_DAYS : GUARD.FIRST_DAYS, rule, evidence: { transfer: moved.evidence, with: [me.slice(0, 8)] } })
        }
      }
    }
    return found
  }
  /**
   * After a sale, a moment later, one account at a time. Every auction that closes in a settler batch asks
   * for its winner to be looked at, and fifty checks racing for the background connections at once is the
   * shape of the 2026-09-17 slowness (market-sweep-pool-starvation); an account asked for twice is looked at once.
   */
  const queue = new Set()
  let draining = false
  const checkSoon = (me) => {
    if (off || !me) return
    queue.add(me)
    if (draining) return
    draining = true
    const t = setTimeout(drain, 500)
    t.unref?.()
  }
  async function drain() {
    try {
      while (queue.size) {
        const [me] = queue
        queue.delete(me)
        await check(me).catch((err) => console.warn('guard: check failed', err.message))
      }
    } finally { draining = false }
  }

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
    // 倒卡 over the week: every sale over F and every pair over G, whoever bought — the dry version of what now suspends
    const t = await transfers({ days: 7 })
    const moving = {
      sales: t.topSales.filter((x) => x.f).slice(0, 60),
      pairs: t.topPairs.filter((x) => x.g).slice(0, 60),
    }
    return {
      mode, rules: GUARD, transfer: TRANSFER, moving,
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

  /**
   * For the owner, read only: every sale of the last `days`, each priced against what that card at that level
   * usually goes for, and every pair of accounts that traded, with how often and which way. 「冷门卡挂一个巨额
   * 一口价，小号拍下」 is a price nobody else would pay for that card; 「两个号互相倒」 is the same two accounts
   * trading again and again. This is what a rule about either is read against before it suspends anybody.
   */
  async function transfers({ days = 14 } = {}) {
    const d = Math.max(1, Math.min(30, Math.round(Number(days)) || 14))
    // what a card at a level usually sells for: the median of the month, from every seller
    const refRows = await work`
      select l.card_id, l.level, count(*)::int as n,
             percentile_cont(0.5) within group (order by o.price)::int as med
      from card_offers o join card_listings l on l.id = o.listing
      where o.status = 'accepted' and l.status = 'sold' and l.closed > now() - interval '30 days'
      group by l.card_id, l.level`
    const sales = await work`
      select o.buyer_h as b, l.seller_h as s, l.card_id, l.level, o.price, l.ask, l.buyout,
             extract(epoch from o.made)::float8 as made, extract(epoch from l.created)::float8 as created,
             extract(epoch from l.closed)::float8 as closed
      from card_offers o join card_listings l on l.id = o.listing
      where o.status = 'accepted' and l.status = 'sold' and l.closed > now() - make_interval(days => ${d})`
    const value = saleValue(refRows, cardById)
    const rows = sales.map((r) => {
      const v = value(r.card_id, r.level)
      return { ...r, ref: v.ref, refN: v.n, refFrom: v.from, ratio: r.price / v.ref, over: Math.max(0, r.price - v.ref), bo: r.buyout != null && r.price >= r.buyout }
    })
    const buckets = [2, 3, 5, 10, 20, 50, 100, Infinity]
    const hist = buckets.map((hi, i) => {
      const lo = i ? buckets[i - 1] : 0
      const inIt = rows.filter((r) => r.ratio >= lo && r.ratio < hi)
      return { from: lo, to: hi === Infinity ? null : hi, n: inIt.length, buyouts: inIt.filter((r) => r.bo).length, over: inIt.reduce((a, r) => a + r.over, 0) }
    })
    // pairs, either way round
    const pairKey = (a, b) => (a < b ? a + b : b + a)
    const pairs = new Map()
    const perSeller = new Map()
    const perBuyer = new Map()
    for (const r of rows) {
      perSeller.set(r.s, (perSeller.get(r.s) ?? 0) + 1)
      perBuyer.set(r.b, (perBuyer.get(r.b) ?? 0) + 1)
      const [x, y] = r.b < r.s ? [r.b, r.s] : [r.s, r.b]
      const k = x + y
      let p = pairs.get(k)
      if (!p) pairs.set(k, p = { x, y, n: 0, xy: 0, yx: 0, paid: 0, over: 0, maxRatio: 0, times: [], cards: new Set() })
      p.n++; if (r.b === x) p.xy++; else p.yx++
      p.paid += r.price; p.over += r.over; p.maxRatio = Math.max(p.maxRatio, r.ratio); p.times.push({ at: r.closed, xBought: r.b === x, ratio: r.ratio }); p.cards.add(r.card_id)
    }
    const DAYSEC = 86400
    for (const p of pairs.values()) {
      p.times.sort((a, b) => a.at - b.at)
      let best = 0
      p.g = false
      for (let i = 0, j = 0; i < p.times.length; i++) {
        while (p.times[i].at - p.times[j].at > DAYSEC) j++
        best = Math.max(best, i - j + 1)
        // rule G on this 24 h: enough trades, and either both ways or enough of them overpriced
        const win = p.times.slice(j, i + 1)
        if (win.length >= TRANSFER.G_N && ((win.some((t) => t.xBought) && win.some((t) => !t.xBought)) || win.filter((t) => t.ratio >= TRANSFER.G_RATIO).length >= TRANSFER.G_OVER_N)) p.g = true
      }
      p.day = best
    }
    const list = [...pairs.values()]
    const dist = {}
    for (const p of list) {
      const k = Math.min(p.day, 6)
      const e = dist[k] ??= { pairs: 0, both: 0, overpaid3: 0, overpaid10: 0 }
      e.pairs++
      if (p.xy && p.yx) e.both++
      if (p.maxRatio >= 3) e.overpaid3++
      if (p.maxRatio >= 10) e.overpaid10++
    }
    const want = new Set()
    const topSales = rows.filter((r) => r.ratio >= 5 && r.over >= 3000).sort((a, b) => b.over - a.over).slice(0, 200)
    for (const r of topSales) { want.add(r.b); want.add(r.s) }
    const topPairs = list.filter((p) => p.day >= 2).sort((a, b) => b.g - a.g || b.day - a.day || b.over - a.over).slice(0, 200)
    for (const p of topPairs) { want.add(p.x); want.add(p.y) }
    const acc = new Map()
    if (want.size) {
      for (const a of await work`
        select id_hash, name, created, (state->>'pulls')::int as pulls, (state->>'coins')::int as coins
        from card_accounts where id_hash = any(${[...want]})`) acc.set(a.id_hash, a)
    }
    const who = (h) => {
      const a = acc.get(h)
      return {
        code: h.slice(0, 8).toUpperCase(), name: a ? (displayName ? displayName(a.name, h).name : a.name) : null,
        created: a?.created ?? null, pulls: a?.pulls ?? null, coins: a?.coins ?? null,
        sold: perSeller.get(h) ?? 0, bought: perBuyer.get(h) ?? 0,
      }
    }
    const ign = (id) => cardById?.(id)?.ign ?? cardById?.(id)?.name ?? id
    // who F and G would suspend over the window (both sides of each), and the rings they make
    const fHit = new Set()
    for (const r of rows) if (r.ratio >= TRANSFER.F_RATIO && r.over >= TRANSFER.F_GAP) { fHit.add(r.b); fHit.add(r.s) }
    const gHit = new Set()
    const link = new Map()
    for (const p of list) {
      if (!p.g) continue
      gHit.add(p.x); gHit.add(p.y)
      link.set(p.x, [...(link.get(p.x) ?? []), p.y]); link.set(p.y, [...(link.get(p.y) ?? []), p.x])
    }
    const seen = new Set()
    const rings = []
    for (const h of link.keys()) {
      if (seen.has(h)) continue
      const stack = [h]; const ring = []
      seen.add(h)
      while (stack.length) { const c = stack.pop(); ring.push(c); for (const n of link.get(c) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n) } }
      rings.push(ring)
    }
    const ringSizes = {}
    for (const r of rings) ringSizes[Math.min(r.length, 10)] = (ringSizes[Math.min(r.length, 10)] ?? 0) + 1
    // a few sales from each price band, to read by eye whether a band is people or rings
    const bands = [[3, 5], [5, 10], [10, 20], [20, 50]].map(([lo, hi]) => {
      const inBand = rows.filter((r) => r.ratio >= lo && r.ratio < hi && r.over >= 1000)
      const pick = []
      for (let i = 0; i < Math.min(20, inBand.length); i++) pick.push(inBand[Math.floor((i * inBand.length) / Math.min(20, inBand.length))])
      return { lo, hi, n: inBand.length, notG: inBand.filter((r) => !pairs.get(pairKey(r.b, r.s)).g).length, sample: pick }
    })
    for (const b of bands) for (const r of b.sample) { want.add(r.b); want.add(r.s) }
    const ringsTop = rings.sort((a, b) => b.length - a.length).slice(0, 15)
    for (const r of ringsTop) for (const h of r.slice(0, 12)) want.add(h)
    if (want.size) {
      for (const a of await work`
        select id_hash, name, created, (state->>'pulls')::int as pulls, (state->>'coins')::int as coins
        from card_accounts where id_hash = any(${[...want].filter((h) => !acc.has(h))})`) acc.set(a.id_hash, a)
    }
    return {
      ok: true, days: d, sales: rows.length, hist, pairDays: dist,
      wouldSuspend: { F: fHit.size, G: gHit.size, either: new Set([...fHit, ...gHit]).size, onlyG: [...gHit].filter((h) => !fHit.has(h)).length, ringSizes },
      rings: ringsTop.map((r) => ({ size: r.length, who: r.slice(0, 12).map(who) })),
      bands: bands.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, notG: b.notG, sample: b.sample.map((r) => ({
        buyer: who(r.b), seller: who(r.s), card: ign(r.card_id), rarity: cardById?.(r.card_id)?.rarity ?? null, level: r.level,
        price: r.price, ref: r.ref, refN: r.refN, ratio: Math.round(r.ratio * 10) / 10, bo: r.bo, g: pairs.get(pairKey(r.b, r.s)).g,
        pairN: pairs.get(pairKey(r.b, r.s)).n,
      })) })),
      topSales: topSales.map((r) => ({
        buyer: who(r.b), seller: who(r.s), card: ign(r.card_id), rarity: cardById?.(r.card_id)?.rarity ?? null, level: r.level,
        price: r.price, ask: r.ask, buyout: r.buyout, bo: r.bo, ref: r.ref, refN: r.refN, refFrom: r.refFrom,
        ratio: Math.round(r.ratio * 10) / 10, age: Math.round(r.made - r.created), at: new Date(r.closed * 1000).toISOString(),
        f: r.ratio >= TRANSFER.F_RATIO && r.over >= TRANSFER.F_GAP,
        pair: (() => { const p = pairs.get(pairKey(r.b, r.s)); return { n: p.n, day: p.day, both: !!(p.xy && p.yx) } })(),
      })),
      topPairs: topPairs.map((p) => ({
        a: who(p.x), b: who(p.y), n: p.n, aBought: p.xy, bBought: p.yx, day: p.day, cards: p.cards.size,
        paid: p.paid, over: Math.round(p.over), maxRatio: Math.round(p.maxRatio * 10) / 10, g: p.g,
      })),
      gPairs: list.filter((p) => p.g).length, fSales: rows.filter((r) => r.ratio >= TRANSFER.F_RATIO && r.over >= TRANSFER.F_GAP).length,
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
    if (action === 'check') return { ok: true, ...(await check(me, { dry: true })) }
    return { ok: false, why: 'action' }
  }

  return { mode, banOf, check, checkSoon, scan, report, manual, weekly, transfers, invalidate() { active = new Map(); activeAt = 0 } }
}
