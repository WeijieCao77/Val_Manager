import type { GameState } from './types'

const record = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const numbers = (v: unknown, keys: string[]) => record(v) && keys.every(k => finite(v[k]))
// Not Object.hasOwn: Chrome before 93 lacks it, and in mainland China Chrome
// often cannot reach its update server, so those versions are still around.
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key)

/** Validate the original save contract before migration. Optional newer fields
 * remain optional; missing balances or players cannot safely be invented. */
export function assertCareerSave(value: unknown): asserts value is GameState {
  const fail = () => { throw new Error('存档数据不完整或已损坏，无法读取。请使用其他存档或备份。') }
  if (!record(value)) return fail()
  const s = value
  if (!numbers(s, ['seed', 'year', 'day']) || typeof s.managerName !== 'string'
    || typeof s.myTeam !== 'string' || !record(s.teams) || !record(s.players)
    || !has(s.teams, s.myTeam) || !record(s.comps)
    || !Array.isArray(s.fixtures) || !Array.isArray(s.news)
    || !numbers(s.finances, ['balance']) || !Array.isArray(s.finances.log)) return fail()
  for (const [id, t] of Object.entries(s.teams)) {
    if (!record(t) || t.id !== id || typeof t.name !== 'string'
      || !strings(t.roster) || !strings(t.starters) || !record(t.tactics)
      || !numbers(t, ['budget', 'rating', 'reputation', 'facilities'])
      || t.roster.some((pid: string) => !has(s.players, pid))
      || t.starters.some((pid: string) => !t.roster.includes(pid))) return fail()
    if (t.supportStaff != null && (!Array.isArray(t.supportStaff)
      || t.supportStaff.some((p: unknown) => !numbers(p, ['salary']) || !record(p) || typeof p.name !== 'string'))) return fail()
  }
  for (const [id, p] of Object.entries(s.players)) {
    if (!record(p) || p.id !== id || typeof p.ign !== 'string'
      || !numbers(p, ['age', 'overall', 'potential', 'form', 'morale', 'fatigue', 'salary', 'value', 'contractYears', 'loyalty', 'ambition'])
      || !numbers(p.attrs, ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl'])
      || !numbers(p.season, ['maps', 'rounds', 'kills', 'deaths', 'assists', 'firstKills', 'firstDeaths', 'damage', 'clutches', 'mvps'])
      || !numbers(p.career, ['maps', 'rounds', 'kills', 'deaths', 'assists', 'firstKills', 'firstDeaths', 'damage', 'clutches', 'mvps'])) return fail()
  }
  for (const c of Object.values(s.comps)) {
    if (!record(c) || !strings(c.teams) || !strings(c.finished) || !record(c.standings)) return fail()
    for (const row of Object.values(c.standings)) {
      if (!numbers(row, ['w', 'l', 'mapW', 'mapL', 'roundW', 'roundL', 'pts'])
        || !record(row) || typeof row.teamId !== 'string') return fail()
    }
  }
  for (const f of s.fixtures) {
    if (!record(f) || !finite(f.day)) return fail()
    if (f.result != null && (!record(f.result) || !Array.isArray(f.result.maps)
      || f.result.maps.some((m: unknown) => !record(m) || (m.lines != null && !record(m.lines))))) return fail()
    for (const m of f.result?.maps ?? []) {
      for (const line of Object.values(m.lines ?? {})) {
        if (Array.isArray(line)) {
          if (line.length !== 9 || !line.every(finite)) return fail()
        } else if (!record(line) || !Object.values(line).every(finite)) return fail()
      }
    }
  }
  for (const n of s.news) if (!record(n) || !finite(n.day) || typeof n.kind !== 'string' || typeof n.text !== 'string') return fail()
  for (const row of s.finances.log) if (!numbers(row, ['day', 'amount']) || typeof row.label !== 'string') return fail()
  if (s.lastResults != null && !strings(s.lastResults)) return fail()
  if (s.training != null && (!record(s.training) || !Object.values(s.training).every(v => typeof v === 'string'))) return fail()
  if (s.manager != null && (!record(s.manager)
    || !numbers(s.manager.skills, ['training', 'negotiation', 'tactics', 'scouting', 'medical', 'business', 'locker', 'youth']))) return fail()
  if (s.life != null) {
    const l = s.life
    if (!numbers(l, ['startYear', 'wallet', 'hunger', 'mood', 'tickedOn'])
      || !Array.isArray(l.ledger) || l.ledger.some((r: unknown) => !numbers(r, ['cd', 'amount']) || !record(r) || typeof r.label !== 'string')
      || !numbers(l.auto, ['budget', 'spent']) || !record(l.cooldowns) || !Object.values(l.cooldowns).every(finite)) return fail()
  }
  // These were optional at launch and are filled by migration / engine defaults.
  for (const key of ['offers', 'honours', 'enquiries', 'jobOffers', 'jobApplications',
    'staffOffers', 'staffApproaches', 'sponsorTalks', 'gigs', 'ventures', 'staff', 'patchLog', 'disputes', 'birthdays']) {
    if (s[key] != null && (!Array.isArray(s[key]) || s[key].some((row: unknown) => !record(row)))) return fail()
  }
}
