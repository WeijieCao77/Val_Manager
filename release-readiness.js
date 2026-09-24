/** Required release objects. Read-only checks fail closed before a container is routed traffic. */
export const REQUIRED_COLUMNS = {
  championsModeration: ['champion_messages.status', 'champion_messages.request_key', 'champion_messages.account_hash', 'champion_message_reviews.message_id'],
  accounts: ['card_accounts.rev'],
  idempotency: ['card_requests.id_hash', 'card_requests.request_id', 'card_requests.action', 'card_requests.reply'],
  statsFold: ['rollup_state.last_id', 'rollup_day_sessions.secs'],
  marketSummary: ['card_listings.cur_price', 'card_listings.top_bid', 'card_listings.open_n'],
  openCupBalance: ['open_cups.balance_version'],
  openCupSwiss: ['open_cups.engine_hash', 'open_cup_engine_builds.compressed', 'open_cups.phase', 'open_cups.stage_round', 'open_cups.playoff', 'open_cups.format_version', 'open_cup_entries.swiss_wins', 'open_cup_entries.swiss_losses', 'open_cup_matches.stage', 'open_cup_matches.lease_until', 'open_cup_matches.lease_token', 'open_cup_matches.bo', 'open_cup_payouts.cup_id'],
}
export const REQUIRED_UNIQUE = {
  championsRequestUniqueness: ['champion_messages', 'account_hash,request_key'],
  engineUniqueness: ['open_cup_engine_builds', 'hash'],
  requestUniqueness: ['card_requests', 'id_hash,request_id'],
  matchUniqueness: ['open_cup_matches', 'cup_id,round,slot'],
  payoutUniqueness: ['open_cup_payouts', 'cup_id,id_hash'],
}
export async function releaseFeatures(sql) {
  const cols = await sql.unsafe(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)
  const have = new Set(cols.map(r => `${r.table_name}.${r.column_name}`))
  const features = Object.fromEntries(Object.entries(REQUIRED_COLUMNS).map(([k, need]) => [k, need.every(c => have.has(c))]))
  const indexes = await sql.unsafe(`select t.relname as table_name,
    string_agg(a.attname, ',' order by k.n) as keys
    from pg_index i join pg_class t on t.oid = i.indrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    join lateral unnest(i.indkey) with ordinality k(attnum,n) on k.n <= i.indnkeyatts
    join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum
    where ns.nspname='public' and i.indisunique and i.indisvalid and i.indisready
      and i.indpred is null and i.indexprs is null
    group by t.relname, i.indexrelid`)
  for (const [name, [table, keys]] of Object.entries(REQUIRED_UNIQUE))
    features[name] = indexes.some(i => i.table_name === table && i.keys === keys)
  return features
}
