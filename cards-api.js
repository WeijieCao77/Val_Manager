/**
 * Accounts for the card mode — the smallest thing that can be called one.
 *
 * The rest of this game has no accounts on purpose, and that stays true for
 * the career mode. The card mode needs one thing the career mode does not: a
 * calendar the player cannot move. A daily check-in that trusts the device
 * clock is not a daily check-in, it is a button. So the server owns the date,
 * and owning the date means the collection has to live here too.
 *
 * What identity means here: the player is handed one random string and told to
 * write it down. There is no email, no password, no recovery, and nothing that
 * could identify a person. The server never stores the string itself — only
 * its SHA-256 — so the table is a pile of hashes and game saves, and a copy of
 * it does not let anyone log in as anybody.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { displayName } from './names.js'
import { progressOf } from './progress.js'

/**
 * The rules, running here.
 *
 * `npm run build:server` bundles src/engine/server.ts into dist-server/ for
 * the deployed process, which is plain Node and cannot read TypeScript. The
 * check scripts run under tsx, which can, and they run against a checkout
 * where the bundle may be missing or stale — so the source is the fallback,
 * and under tsx it is also the truth.
 */
async function loadEngine() {
  const fromBundle = await import('./dist-server/engine.mjs').catch(() => null)
  if (fromBundle && !process.env.ENGINE_FROM_SOURCE) return fromBundle
  return import('./src/engine/server.ts')
}
export const engine = await loadEngine()

export const CARD_SCHEMA = `
create table if not exists card_accounts (
  id_hash  text primary key,
  created  timestamptz not null default now(),
  seen     timestamptz not null default now(),
  name     text,
  rev      int not null default 1,
  state    jsonb not null
);
create index if not exists card_seen_idx on card_accounts (seen desc);
-- "seen" is bumped by reads as well as writes, so it cannot date a save. The
-- stamina meter needs to know when the state itself was last WRITTEN, which is
-- a different question and needs its own column. (No backticks in here: this
-- is a template literal and one would end it.)
alter table card_accounts add column if not exists saved timestamptz;
-- The ladder total this account has been SEEN at, and when. Growth between two
-- saves is bounded by 体力: 15 banked, one point back every 50 minutes, two a
-- ladder match. A save that outruns that clock did not come from playing.
alter table card_accounts add column if not exists ladder_seen int;
alter table card_accounts add column if not exists ladder_at timestamptz;
alter table card_accounts add column if not exists suspect boolean not null default false;
-- A pardon, and where it was granted. The absolute check asks whether the
-- whole record could have been played since the account was made; a player
-- the owner has cleared — a weekend of unlimited 体力 during a test, an
-- evening against a server that was down — would fail it again on his very
-- next save. So a pardon moves the origin: from here on, only what he adds
-- past pardon_seen is measured, over the time since pardon_at.
alter table card_accounts add column if not exists pardon_seen int;
alter table card_accounts add column if not exists pardon_at timestamptz;
-- One pass over the accounts that existed before the clock check did. Nothing
-- here has a baseline to measure growth from, so the only question askable of
-- them is the crude one: could this record have been played AT ALL since the
-- account was made? Ten matches of slack absorbs clock skew and the odd
-- 仅本机 evening; past that, a record is not slightly optimistic, it is
-- invented. Runs once — ladder_at is null only for rows that never saved
-- through the check — and never over somebody the owner has pardoned.
update card_accounts set suspect = true
where ladder_at is null
  and pardon_at is null
  and coalesce((state->'ladder'->>'wins')::int, 0)
    + coalesce((state->'ladder'->>'losses')::int, 0)
    > 10 + floor((15 + extract(epoch from (now() - created)) / 3000) / 2)
  and state->'ladder'->>'wins' ~ '^[0-9]{1,7}$'
  and state->'ladder'->>'losses' ~ '^[0-9]{1,7}$';
update card_accounts set saved = seen where saved is null;
-- the 好友对战码 is the first eight characters of id_hash, and looking one up
-- is otherwise a sequential scan of every account in the table
create index if not exists card_code_idx on card_accounts (left(id_hash, 8));
-- Cards handed to a friend. A gift is a row rather than a direct write into
-- somebody else's save: the receiver's client is the only thing that may edit
-- his collection, so the gift waits here until he next opens the game.
create table if not exists card_gifts (
  id       bigserial primary key,
  from_h   text not null,
  to_h     text not null,
  card_id  text not null,
  note     text,
  sent     timestamptz not null default now(),
  claimed  timestamptz
);
create index if not exists gift_to_idx on card_gifts (to_h) where claimed is null;

-- The trading post.
--
-- Both sides pay in when they act and collect afterwards, which is what stops
-- either of them being left holding nothing. Listing escrows the CARD; making
-- an offer escrows the COINS. Whatever the outcome — sold, declined, expired,
-- withdrawn — every escrow ends up as a row in card_mail for somebody to
-- collect, so a player who never comes back cannot strand the other one.
create table if not exists card_listings (
  id       bigserial primary key,
  seller_h text not null,
  card_id  text not null,
  level    int not null default 0,
  ask      int not null,
  status   text not null default 'open',
  created  timestamptz not null default now(),
  closed   timestamptz,
  -- consecutive offers the seller let expire; three and it comes off the shelf
  ignored  int not null default 0
);
create index if not exists listing_open_idx on card_listings (created desc) where status = 'open';
create index if not exists listing_seller_idx on card_listings (seller_h);

create table if not exists card_offers (
  id       bigserial primary key,
  listing  bigint not null references card_listings(id),
  buyer_h  text not null,
  price    int not null,
  status   text not null default 'open',
  made     timestamptz not null default now(),
  settled  timestamptz
);
create index if not exists offer_open_idx on card_offers (listing) where status = 'open';
create index if not exists offer_buyer_idx on card_offers (buyer_h);

-- Everything waiting to be collected, and everything worth telling somebody.
-- A row with a card or coins on it is a delivery; a row with neither is a
-- notification. One table, because the inbox shows them together anyway.
create table if not exists card_mail (
  id      bigserial primary key,
  to_h    text not null,
  kind    text not null,
  card_id text,
  level   int not null default 0,
  coins   int not null default 0,
  -- an unopened pack, which is what a compensation or a giveaway usually is
  pack    text,
  count   int not null default 1,
  body    jsonb,
  made    timestamptz not null default now(),
  taken   timestamptz
);
create index if not exists mail_to_idx on card_mail (to_h) where taken is null;
-- added after the table existed; harmless on a fresh database
alter table card_mail add column if not exists pack text;
alter table card_mail add column if not exists count int not null default 1;

-- A card swap between two friends: like for like, one 体力 a side.
-- The proposer's card sits here in escrow from the moment it is offered; the
-- friend's leaves their account only when they accept. Every ending — done,
-- declined, cancelled, expired — sends both cards somewhere through
-- card_mail, so nobody is left holding nothing.
create table if not exists card_swaps (
  id         bigserial primary key,
  from_h     text not null,
  to_h       text not null,
  give_id    text not null,
  give_level int not null default 0,
  want_id    text not null,
  status     text not null default 'open',
  made       timestamptz not null default now(),
  settled    timestamptz
);
create index if not exists swap_to_idx on card_swaps (to_h) where status = 'open';
create index if not exists swap_from_idx on card_swaps (from_h) where status = 'open';
`

/**
 * The most 大师 points one win can possibly be worth.
 *
 * masterPoints() pays MASTER_WIN 20, plus 3 for every point the opponent
 * rates above 84, plus 8 on a streak. The clubs stop at 89 and oppBumpFor()
 * adds at most 10, so the best win in the game is 20 + (99 - 84) * 3 + 8.
 *
 * It matters because the board ranks on points, not matches: bounding how
 * many matches an account can have played does nothing if the score attached
 * to them is a free number. check_cheat.ts re-derives this from the engine
 * every run, so the two cannot drift apart quietly.
 */
export const MAX_POINTS_PER_WIN = 73

/** Bodies are capped well under this; 512KB is the point of refusing to look. */
export const MAX_STATE = 512 * 1024

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')

/**
 * How much of the hash a battle code is.
 *
 * Eight hex characters: short enough to read out loud or type off a phone,
 * long enough that four billion of them makes walking the space pointless.
 * The leaderboard's #tag is the first four of the same hash, so a code and a
 * tag agree with each other, which is what makes 「#1C14 是你吗」 work.
 */
export const CODE_LEN = 8
export const battleCode = (idHash) => String(idHash ?? '').slice(0, CODE_LEN).toUpperCase()

/**
 * The id the client is told to keep.
 *
 * Crockford base32 without I, L, O and U, so nothing in it can be misread off
 * a screenshot, which is the only way most people will ever back it up. Twenty
 * characters is 100 bits: this string is the whole of authentication, so it
 * has to be unguessable even though the endpoint answers quickly.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function normalizeId(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    // the four letters the alphabet leaves out are exactly the four people
    // mistype, so read them as what they were meant to be rather than refusing
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V')
  const body = s.startsWith('VM') ? s.slice(2) : s
  if (body.length !== 20) return null
  if ([...body].some((c) => !ALPHABET.includes(c))) return null
  return `VM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`
}

/**
 * Today, where the players are.
 *
 * Fixed to Asia/Shanghai rather than the visitor's zone: the streak has to
 * roll over at one moment for everybody, or a browser set to UTC-11 gets a
 * second check-in every evening.
 */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
export const serverDay = () => DAY_FMT.format(new Date())

/**
 * The server's clock, in epoch ms.
 *
 * 体力 accrues by the hour, so the client needs a moment as well as a date —
 * and for the same reason the date is ours, the moment has to be too. The
 * client keeps the offset between this and its own clock and reads through it.
 */
export const serverNow = () => Date.now()

const sameId = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The most a client's cosmetic fields may weigh. Names and three fives, not a collection. */
export const MAX_CLIENT = 64 * 1024

/**
 * What a client may write into its account: the cosmetic fields, and nothing
 * else.
 *
 * The collection used to arrive whole, with a note here that checking it was
 * theatre. It was — because the client was the one that had rolled the packs.
 * It no longer is. A save carries the name, the five on the table, the
 * presets and the friendlies; a `coins` in the same body is not refused, it
 * is simply never read. An older client still sends its whole state, so the
 * same fields are picked out of that.
 */
export function vetClient(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const k of engine.CLIENT_KEYS) if (k in raw) out[k] = raw[k]
  if (JSON.stringify(out).length > MAX_CLIENT) return null
  return out
}

/**
 * The account as it is written: the id is deleted first. The state carries
 * the id in memory, and the id is the whole of the login — the table holds a
 * hash of it for exactly the reason it must not hold the thing itself.
 */
const stored = (state) => {
  const { id, ...rest } = state
  void id
  return rest
}

/** A seed the client never held. */
const freshSeed = () => randomBytes(4).readUInt32LE(0)

export function makeCardApi(sql, { rateLimited, readBody, json, staticRoot }) {
  const guard = (req, res, bucket, max) => {
    if (rateLimited(bucket, max)) {
      json(res, 429, { ok: false, why: 'rate' })
      return true
    }
    return false
  }

  async function load(req, res, bucket) {
    // The id is the password, so this endpoint is the one worth guessing at.
    // 100 bits makes that hopeless on arithmetic alone; the limit is here so
    // it is also hopeless on time.
    if (guard(req, res, `cl:${bucket}`, 40)) return
    const today = serverDay()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 200, { ok: false, bad: true, today }); return }
    try {
      const rows = await sql`
        select state, rev, name, extract(epoch from coalesce(saved, seen)) * 1000 as saved
        from card_accounts where id_hash = ${hash(id)}`
      if (!rows.length) { json(res, 200, { ok: false, missing: true, today, now: serverNow() }); return }
      // Brought up to the current shape here, and the 体力 meter of a save with
      // no anchor is dated from the last moment the state was WRITTEN — the
      // last moment the meter was known to be where it claims to be. Written
      // back when that happens, or the anchor would be "now" on every load
      // and nothing would ever accrue. Deliberately not `seen`, which this
      // very handler bumps on the way past.
      const state = engine.migrateGacha(rows[0].state, id)
      const saved = Number(rows[0].saved) || null
      if (!state.daily.staminaAt) {
        state.daily.staminaAt = saved ?? serverNow()
        await sql`update card_accounts set state = ${sql.json(stored(state))}, seen = now()
                  where id_hash = ${hash(id)}`
      } else {
        await sql`update card_accounts set seen = now() where id_hash = ${hash(id)}`
      }
      json(res, 200, {
        ok: true, today, now: serverNow(), saved,
        rev: rows[0].rev, state: stored(state),
        // the client cannot work its own code out — it has the id, not the
        // hash, and hashing in the browser to learn something the server
        // already knows would be work for nothing
        code: battleCode(hash(id)),
      })
    } catch (err) {
      console.warn('cards: load failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /**
   * Write the client's cosmetic fields back, refusing to overwrite a newer
   * copy of them.
   *
   * A save carries the name, the five on the table, the presets and the
   * friendlies — and nothing else is read out of it. The collection itself
   * moves only through `act`. An older client still posts its whole state;
   * the same four fields are picked out of it and the rest is ignored, which
   * is how a tab that has not reloaded since this shipped keeps working
   * without being able to write a single coin.
   *
   * The revision check stays: a five from a tab that thawed out of the
   * background is still the older five, and the other device's is the one
   * the player just chose.
   */
  async function save(req, res, bucket) {
    if (guard(req, res, `cs:${bucket}`, 120)) return
    const today = serverDay()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    try {
      body = JSON.parse(await readBody(req, MAX_STATE + 4096))
    } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 400, { ok: false, bad: true, today }); return }
    if (body?.id && !sameId(normalizeId(body.id), id)) { json(res, 400, { ok: false }); return }
    const client = vetClient(body?.client ?? body?.state)
    if (!client) { json(res, 400, { ok: false, why: 'client' }); return }
    if (typeof body?.name === 'string') client.name = body.name.slice(0, 40)
    const baseRev = Number.isInteger(body?.baseRev) ? body.baseRev : null
    try {
      const held = await sql`select state, rev from card_accounts where id_hash = ${hash(id)}`
      if (!held.length) { json(res, 200, { ok: false, missing: true, today, now: serverNow() }); return }
      const merged = engine.mergeClientFields(engine.migrateGacha(held[0].state, id), client)
      // A null baseRev compares against nothing and matches nothing: a client
      // with no revision has, by definition, not seen what it is about to
      // write over. It gets the current copy back instead.
      const rows = await sql`
        update card_accounts
           set state = ${sql.json(stored(merged))},
               name  = ${merged.name ?? null},
               rev   = rev + 1,
               seen  = now(),
               saved = now()
         where id_hash = ${hash(id)} and rev = ${baseRev}::int
        returning rev`
      if (!rows.length) {
        const cur = await sql`select state, rev from card_accounts where id_hash = ${hash(id)}`
        json(res, 409, {
          ok: false, stale: true, today, now: serverNow(),
          rev: cur[0]?.rev ?? null, state: cur[0]?.state ?? null,
        })
        return
      }
      json(res, 200, {
        ok: true, today, now: serverNow(), rev: rows[0].rev,
        state: stored(merged), code: battleCode(hash(id)),
      })
    } catch (err) {
      console.warn('cards: save failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /**
   * Claim a freshly generated id.
   *
   * The account is BUILT here — the starter coins, the starter packs, the
   * seed — and only the name is taken from the request. It used to arrive
   * from the client, which made the opening state whatever the client said
   * it was. Separate from save so that saving can never quietly take over an
   * id that already belongs to somebody.
   */
  async function claim(req, res, bucket) {
    if (guard(req, res, `cn:${bucket}`, 20)) return
    const today = serverDay()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    // an older client posts a whole state here; it is read for the name only
    try { body = JSON.parse(await readBody(req, MAX_STATE + 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 400, { ok: false, today }); return }
    const name = typeof body?.name === 'string' ? body.name.slice(0, 40) : '经理'
    const state = engine.newGacha(id, name, today)
    state.daily.staminaAt = serverNow()
    try {
      const rows = await sql`
        insert into card_accounts (id_hash, name, state, saved, ladder_seen, ladder_at)
        values (${hash(id)}, ${name}, ${sql.json(stored(state))}, now(), 0, now())
        on conflict (id_hash) do nothing
        returning rev`
      if (!rows.length) { json(res, 409, { ok: false, taken: true, today }); return }
      json(res, 200, {
        ok: true, today, now: serverNow(), rev: rows[0].rev,
        state: stored(state), code: battleCode(hash(id)),
      })
    } catch (err) {
      console.warn('cards: claim failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /** Everything waiting in the inbox, taken off the table exactly once. */
  async function takeMail(me, db = sql) {
    const rows = await db`
      update card_mail set taken = now() where to_h = ${me} and taken is null
      returning kind, card_id, level, coins, pack, count, body, made`
    const mail = rows.map((r) => ({
      kind: r.kind, cardId: r.card_id, level: r.level, coins: r.coins,
      pack: r.pack ?? null, count: r.count ?? 1,
      body: r.body ?? {}, at: new Date(r.made).getTime(),
    }))
    // gifts sent before gifting was removed still have to arrive; they come
    // through the same door now
    const gifts = await db`
      update card_gifts set claimed = now()
      where to_h = ${me} and claimed is null
      returning from_h, card_id, note`
    if (gifts.length) {
      const names = await db`
        select id_hash, name from card_accounts where id_hash = any(${gifts.map((r) => r.from_h)})`
      const by = Object.fromEntries(names.map((n) => [n.id_hash, n]))
      for (const r of gifts) {
        const who = displayName(by[r.from_h]?.name, r.from_h)
        mail.push({
          kind: 'gift', cardId: r.card_id, level: 0, coins: 0, pack: null, count: 1,
          body: { who: `${who.name} #${who.tag}`, note: r.note ?? '' }, at: Date.now(),
        })
      }
    }
    return mail
  }

  /**
   * Do something that counts.
   *
   * This is the whole of the anti-cheat now, and it is not a check: it is
   * where the game runs. The client names an action and hands over its
   * cosmetic fields; the server loads the account it holds, lays those fields
   * over it, runs the same rules the client used to run — pack rolled from a
   * seed the client never saw, check-in dated by this clock, the match
   * simulated with the five this account actually owns — writes the result,
   * and hands the account back. What the client's localStorage said a moment
   * before is not consulted at any point.
   *
   * Optimistic on the row's revision rather than a transaction: if another
   * request wrote in between, the whole thing is run again on the fresh
   * copy, so two tabs opening packs at once open two packs and pay for both.
   * Mail taken off the table before a retry is carried into the retry, so a
   * delivery can never be marked taken and then lost.
   */
  async function act(req, res, bucket) {
    if (guard(req, res, `ca:${bucket}`, 240)) return
    const today = serverDay()
    const now = serverNow()
    if (!sql) { json(res, 200, { ok: false, offline: true, today }); return }
    let body
    try { body = JSON.parse(await readBody(req, MAX_CLIENT + 8192)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 400, { ok: false, bad: true, today }); return }
    const action = typeof body?.action === 'string' ? body.action : ''
    if (!engine.ACTIONS.includes(action) && action !== 'mail_take') {
      json(res, 200, { ok: false, why: '没有这个操作', today })
      return
    }
    const client = vetClient(body?.client)
    if (!client) { json(res, 400, { ok: false, why: 'client' }); return }
    const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {}
    const me = hash(id)
    try {
      // One attempt is one transaction. That matters for mail_take: the rows
      // are marked taken and the account that received them is written in
      // the same transaction, so a write that loses the revision race (or a
      // process that dies between the two) leaves the mail untaken rather
      // than gone. A lost race throws to roll back and the loop tries again.
      const run = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
      const STALE = Symbol('stale')
      for (let attempt = 0; attempt < 3; attempt++) {
        let reply
        try {
          reply = await run(async (db) => {
            const held = await db`select state, rev from card_accounts where id_hash = ${me}`
            if (!held.length) return { missing: true }
            const g = engine.mergeClientFields(engine.migrateGacha(held[0].state, id), client)
            let out
            if (action === 'mail_take') {
              const taken = await takeMail(me, db)
              engine.applyMail(g, taken)
              out = { ok: true, result: { mail: taken } }
            } else {
              const env = { now, today, seed: freshSeed() }
              if (engine.wantsRival(g, action)) env.rival = await pickRival(g.ladder.div, me)
              out = engine.runAction(g, action, args, env)
            }
            const total = g.ladder.wins + g.ladder.losses
            const rows = await db`
              update card_accounts
                 set state = ${db.json(stored(g))},
                     name  = ${g.name ?? null},
                     rev   = rev + 1,
                     seen  = now(),
                     saved = now(),
                     ladder_seen = ${total},
                     ladder_at   = now()
               where id_hash = ${me} and rev = ${held[0].rev}
              returning rev`
            if (!rows.length) throw STALE
            return { out, rev: rows[0].rev, state: stored(g) }
          })
        } catch (e) {
          if (e === STALE) continue
          throw e
        }
        if (reply.missing) { json(res, 200, { ok: false, missing: true, today, now }); return }
        const { out } = reply
        json(res, 200, {
          ok: out.ok,
          why: out.ok ? undefined : out.why,
          result: out.ok ? out.result : undefined,
          today, now, rev: reply.rev, state: reply.state, code: battleCode(me),
        })
        return
      }
      json(res, 409, { ok: false, busy: true, why: '账号正忙，再试一次。', today, now })
    } catch (err) {
      console.warn('cards: act failed', err.message)
      json(res, 500, { ok: false, today })
    }
  }

  /**
   * The public ladder, top hundred plus whoever is asking.
   *
   * Read straight off the accounts table — the card mode is the one part of
   * this game with a real server-side save, so a leaderboard costs a query
   * rather than a new system. Ranked the way the ladder itself ranks: the
   * division first, then the 大师 score, which has no ceiling and is the whole
   * point of the thing.
   *
   * The caller's own row comes back even when it is nowhere near the top,
   * because 「你在第几」 is the number that makes a leaderboard worth opening.
   * Sending an id is optional and the id is never echoed — only the four
   * characters of its hash that tell two players of the same name apart.
   */
  async function top(req, res, bucket) {
    if (guard(req, res, `ct:${bucket}`, 30)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let mine = null
    try {
      const body = JSON.parse(await readBody(req, 4096))
      const id = normalizeId(body?.id)
      if (id) mine = hash(id)
    } catch { /* an anonymous look at the board is fine */ }
    try {
      const rows = await sql`
        with ranked as (
          select
            id_hash, name,
            case when state->'ladder'->>'div' ~ '^[0-9]{1,2}$'
                 then (state->'ladder'->>'div')::int else 0 end as div,
            case when state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
                 then (state->'ladder'->>'points')::int else 0 end as points,
            case when state->'ladder'->>'stars' ~ '^[0-9]{1,3}$'
                 then (state->'ladder'->>'stars')::int else 0 end as stars,
            case when state->'ladder'->>'wins' ~ '^[0-9]{1,7}$'
                 then (state->'ladder'->>'wins')::int else 0 end as wins,
            case when state->'ladder'->>'losses' ~ '^[0-9]{1,7}$'
                 then (state->'ladder'->>'losses')::int else 0 end as losses
          from card_accounts
          where jsonb_typeof(state->'ladder') = 'object'
            -- An account whose matches once outran the 体力 clock keeps
            -- playing and keeps its collection; it just does not get to stand
            -- at the top of a board that means something to everybody else.
            and not suspect
        ), placed as (
          select *, rank() over (
            order by div desc, points desc, stars desc, wins desc, id_hash
          )::int as rk
          from ranked
        )
        select rk, id_hash, name, div, points, stars, wins, losses
        from placed
        -- one query either way: an empty string never matches a sha256, so
        -- the caller's own row joins the top hundred without a second shape
        where rk <= 100 or id_hash = ${mine ?? ''}
        order by rk
        limit 101`
      json(res, 200, {
        ok: true,
        rows: rows.map((r) => ({
          rank: r.rk,
          ...displayName(r.name, r.id_hash),
          div: r.div, points: r.points, stars: r.stars,
          wins: r.wins, losses: r.losses,
          me: !!mine && r.id_hash === mine,
        })),
      })
    } catch (err) {
      console.warn('cards: top failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  /**
   * Other people's fives, to play against.
   *
   * The world's 78 clubs stop at 89, so a ladder with no ceiling runs out of
   * opposition in about a week — and sharpening those clubs to cover for it
   * was always a stopgap. Real squads do not run out: they are already here,
   * they get better as their owners do, and beating one means something.
   *
   * Nothing live and nobody has to be online. What goes out is the five card
   * ids, the upgrade level of each, a display name and where they sit on the
   * ladder. No account id, no state, no way back to anybody's password — and
   * the name goes through the same filter the leaderboard uses, since it lands
   * on somebody else's screen either way.
   *
   * Picked from the division asked for, widening outward when that division is
   * thin, so a 大师 player is not handed a 青铜 five just because there are
   * more of them.
   */
  /**
   * One account's five, as it is allowed to appear on somebody else's screen.
   *
   * Five card ids, each one's upgrade level, a coach, a display name and a
   * ladder position. Nothing else — no account id, no state, no save. Shared
   * by the ladder's opponent pool and the friend room, because the two send
   * exactly the same thing and should never drift apart.
   */
  function squadOf(r) {
    const slots = Array.isArray(r.squad?.slots) ? r.squad.slots.slice(0, 5) : []
    // the field is `level` — see OwnedCard in engine/gacha.ts. It was `lv`
    // here for a day, and every rival five arrived un-upgraded
    const lvOf = (id) => {
      const lv = r.cards?.[id]?.level
      return typeof lv === 'number' && lv > 0 ? Math.min(20, Math.trunc(lv)) : 0
    }
    const levels = {}
    for (const id of slots) {
      const lv = lvOf(id)
      if (lv) levels[id] = lv
    }
    const coach = typeof r.squad?.coach === 'string' ? r.squad.coach : null
    if (coach && lvOf(coach)) levels[coach] = lvOf(coach)
    const shown = displayName(r.name, r.id_hash)
    return {
      name: shown.name, tag: `#${shown.tag}`,
      slots, coach, levels, div: r.div, points: r.points,
    }
  }

  /**
   * Other people's fives near a division, a dozen at random.
   *
   * Shared by the /rivals route and by the ladder action, which draws one of
   * these on the server when the division calls for a real opponent. An
   * account the 体力 clock has caught is left out: nobody should have to
   * play a five that was typed in.
   */
  async function rivalPool(div, mine) {
    return sql`
      with pool as (
        select
          id_hash, name, state->'squad' as squad, state->'cards' as cards,
          case when state->'ladder'->>'div' ~ '^[0-9]{1,2}$'
               then (state->'ladder'->>'div')::int else 0 end as div,
          case when state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
               then (state->'ladder'->>'points')::int else 0 end as points
        from card_accounts
        where jsonb_typeof(state->'squad'->'slots') = 'array'
          and jsonb_array_length(state->'squad'->'slots') = 5
          -- a five with an empty seat is not an opponent
          and (select count(*) from jsonb_array_elements(state->'squad'->'slots') e
               where jsonb_typeof(e) = 'string') = 5
          and not suspect
          and id_hash <> ${mine}
      )
      select id_hash, name, squad, cards, div, points
      from pool
      order by abs(div - ${div}), random()
      limit 12`
  }

  async function pickRival(div, mine) {
    const rows = await rivalPool(div, mine)
    const fives = rows.map(squadOf).filter((x) => x.slots.filter(Boolean).length === 5)
    return fives.length ? fives[Math.floor(Math.random() * fives.length)] : null
  }

  async function rivals(req, res, bucket) {
    if (guard(req, res, `cr:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let div = 5
    let mine = ''
    try {
      const body = JSON.parse(await readBody(req, 4096))
      const n = Number(body?.div)
      if (Number.isFinite(n)) div = Math.max(0, Math.min(5, Math.trunc(n)))
      const id = normalizeId(body?.id)
      if (id) mine = hash(id)
    } catch { /* defaults are fine */ }
    try {
      const rows = await rivalPool(div, mine)
      json(res, 200, { ok: true, rivals: rows.map(squadOf) })
    } catch (err) {
      console.warn('cards: rivals failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  /**
   * One friend's five, by battle code.
   *
   * The battle code is the first eight characters of the account's SHA-256 —
   * the same hash the leaderboard's #tag comes from, four characters longer.
   * It is deliberately NOT the account id: the id is the whole of the login
   * here, somebody已经 pasted theirs into a public name box once, and a code
   * meant to be posted in a group chat cannot be the same string. A hash
   * cannot be turned back into an id, so posting it costs nothing.
   *
   * Eight hex characters is four billion, which is far too many to walk, and
   * finding somebody's code buys you the right to play their squad anyway —
   * which is the entire point of the feature.
   *
   * Asynchronous like the ladder: the friend does not have to be online, and
   * what comes back is the snapshot they last saved.
   */
  async function friend(req, res, bucket) {
    if (guard(req, res, `cf:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let code = ''
    try {
      const body = JSON.parse(await readBody(req, 4096))
      code = String(body?.code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '')
    } catch { /* handled below */ }
    if (code.length !== CODE_LEN) { json(res, 200, { ok: false, bad: true }); return }
    try {
      const rows = await sql`
        select
          id_hash, name, state->'squad' as squad, state->'cards' as cards,
          case when state->'ladder'->>'div' ~ '^[0-9]{1,2}$'
               then (state->'ladder'->>'div')::int else 0 end as div,
          case when state->'ladder'->>'points' ~ '^[0-9]{1,9}$'
               then (state->'ladder'->>'points')::int else 0 end as points
        from card_accounts
        where left(id_hash, ${CODE_LEN}) = ${code}
        limit 2`
      if (!rows.length) { json(res, 200, { ok: false, missing: true }); return }
      // eight characters of a hash could in principle be shared; refusing is
      // the only honest answer, since guessing which one was meant is worse
      if (rows.length > 1) { json(res, 200, { ok: false, clash: true }); return }
      const r = rows[0]
      const slots = Array.isArray(r.squad?.slots) ? r.squad.slots : []
      if (slots.filter((x) => typeof x === 'string').length !== 5) {
        json(res, 200, { ok: false, empty: true })
        return
      }
      json(res, 200, { ok: true, friend: { ...squadOf(r), code } })
    } catch (err) {
      console.warn('cards: friend failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  /**
   * A friend's whole collection, by battle code — ids and levels only.
   *
   * The swap screen has to let you point at the card you want, and the five
   * on the table is not enough to point at. Same door as /friend: the code is
   * a thing people post on purpose, and what comes back identifies cards, not
   * the person holding them.
   */
  async function friendCards(req, res, bucket) {
    if (guard(req, res, `fc:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let code = ''
    try {
      const body = JSON.parse(await readBody(req, 4096))
      code = String(body?.code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '')
    } catch { /* handled below */ }
    if (code.length !== CODE_LEN) { json(res, 200, { ok: false, bad: true }); return }
    try {
      const rows = await sql`
        select id_hash, name, state->'cards' as cards
        from card_accounts where left(id_hash, ${CODE_LEN}) = ${code} limit 2`
      if (!rows.length) { json(res, 200, { ok: false, missing: true }); return }
      if (rows.length > 1) { json(res, 200, { ok: false, clash: true }); return }
      const r = rows[0]
      const shown = displayName(r.name, r.id_hash)
      const cards = Object.values(r.cards ?? {})
        .filter((c) => c && typeof c === 'object' && typeof c.id === 'string')
        .map((c) => ({
          id: c.id,
          level: typeof c.level === 'number' ? Math.max(0, Math.trunc(c.level)) : 0,
          dupes: typeof c.dupes === 'number' ? Math.max(0, Math.trunc(c.dupes)) : 0,
        }))
      json(res, 200, { ok: true, name: shown.name, tag: `#${shown.tag}`, code, cards })
    } catch (err) {
      console.warn('cards: friend cards failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  /**
   * Today's puzzle picture, for one account — and nothing that names it.
   *
   * The challenge used to draw its blurred subject from the ordinary asset
   * URL, faces/P267.webp, so dragging the picture out of the page (or reading
   * the address) handed over the answer by file name, at full clarity. This
   * route answers a POST with the bytes only: no id in the URL, a generic file
   * name, no caching — and the page draws them onto a canvas at the current
   * blur, so what can be dragged or saved is what is on screen.
   */
  async function puzzle(req, res, bucket) {
    if (guard(req, res, `pz:${bucket}`, 60)) return
    let id = null
    try { id = normalizeId(JSON.parse(await readBody(req, 4096))?.id) } catch { /* below */ }
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const today = serverDay()
    const kind = engine.kindFor(today, id)
    const rel = engine.imgOf(kind, engine.answerFor(today, id))
    if (!rel || !staticRoot) { json(res, 404, { ok: false }); return }
    try {
      const buf = await readFile(join(staticRoot, rel))
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline; filename="puzzle.webp"',
      })
      res.end(buf)
    } catch {
      json(res, 404, { ok: false })
    }
  }

  /**
   * Gifting is gone. Claiming is not.
   *
   * A free card transfer with no cost at all is an alt-account funnel: make
   * throwaway accounts, take the starter packs and the daily check-ins, and
   * hand everything to the one you actually play. Removed at the owner's call.
   *
   * The claim path below stays, deliberately and indefinitely. There may be
   * gifts already sent and not yet collected at the moment this ships, and
   * deleting the door they arrive through would quietly eat somebody's card.
   * The table drains on its own.
   */

  /** What is waiting for me, and marking it taken. */
  async function gifts(req, res, bucket) {
    if (guard(req, res, `gi:${bucket}`, 60)) return
    if (!sql) { json(res, 200, { ok: false, offline: true }); return }
    let body
    try { body = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(body?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    try {
      if (body?.claim) {
        // Handed over exactly once: the update returns only the rows it moved,
        // so two tabs claiming at the same moment cannot both be given the card.
        const rows = await sql`
          update card_gifts set claimed = now()
          where to_h = ${me} and claimed is null
          returning id, from_h, card_id, note`
        // `= any($1)` with a plain array, NOT sql(list): a nested tagged
        // template is a driver-specific helper, and the check harness — which
        // is a real Postgres behind a plain template — cannot build one. The
        // leaderboard was caught by exactly this once already.
        const names = rows.length
          ? await sql`select id_hash, name from card_accounts where id_hash = any(${rows.map((r) => r.from_h)})`
          : []
        const by = Object.fromEntries(names.map((n) => [n.id_hash, n]))
        json(res, 200, {
          ok: true,
          gifts: rows.map((r) => {
            const n = by[r.from_h]
            const who = displayName(n?.name, r.from_h)
            return { cardId: r.card_id, note: r.note, from: `${who.name} #${who.tag}` }
          }),
        })
        return
      }
      const n = await sql`select count(*)::int as n from card_gifts where to_h = ${me} and claimed is null`
      json(res, 200, { ok: true, waiting: n[0]?.n ?? 0 })
    } catch (err) {
      console.warn('cards: gifts failed', err.message)
      json(res, 500, { ok: false })
    }
  }

  return {
    /** Returns true when it handled the request. */
    async route(req, res, path, bucket) {
      if (path === '/api/card/top') { await top(req, res, bucket); return true }
      if (path === '/api/card/rivals') { await rivals(req, res, bucket); return true }
      if (path === '/api/card/friend') { await friend(req, res, bucket); return true }
      if (path === '/api/card/friend_cards') { await friendCards(req, res, bucket); return true }
      if (path === '/api/card/puzzle') { await puzzle(req, res, bucket); return true }
      if (path === '/api/card/gifts') { await gifts(req, res, bucket); return true }
      if (path === '/api/card/day') {
        json(res, 200, { ok: true, today: serverDay(), now: serverNow(), cloud: !!sql })
        return true
      }
      if (path === '/api/card/load') { await load(req, res, bucket); return true }
      if (path === '/api/card/save') { await save(req, res, bucket); return true }
      if (path === '/api/card/act') { await act(req, res, bucket); return true }
      if (path === '/api/card/claim') { await claim(req, res, bucket); return true }
      return false
    },
  }
}
