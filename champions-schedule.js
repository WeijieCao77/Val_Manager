import { readFileSync } from 'node:fs'
export const CHAMPIONS = { id: 'shanghai-2026', title: '2026 无畏契约上海全球冠军赛', start: '2026-09-24', end: '2026-10-18', source: 'https://valorantesports.com/en-US/news/champions-shanghai-everything-you-need-to-know', calendar: 'https://www.vlr.gg/event/ical/2766' }
export const chinaDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
export function parseChampionsCalendar(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const rows = []
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const value = name => block.match(new RegExp('(?:^|\\n)' + name + ':([^\\r\\n]+)'))?.[1]
    const start = value('DTSTART')?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
    const summary = value('SUMMARY') ?? ''
    const teams = summary.match(/^(.+?) vs\. (.+?) - Valorant Champions 2026$/)
    if (!start || !summary.endsWith(' - Valorant Champions 2026') || value('STATUS') === 'CANCELLED') continue
    const date = new Date(`${start[1]}-${start[2]}-${start[3]}T${start[4]}:${start[5]}:${start[6]}Z`)
    if (!Number.isFinite(date.getTime())) continue
    const day = chinaDay(date)
    if (day < CHAMPIONS.start || day > CHAMPIONS.end) continue
    rows.push({ id: value('UID') ?? date.toISOString(), day, time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(date), a: teams?.[1].slice(0, 60) ?? 'TBD', b: teams?.[2].slice(0, 60) ?? 'TBD', start: date.toISOString() })
  }
  return rows.sort((a,b) => a.start.localeCompare(b.start)).slice(0, 100)
}
export const SEED_MATCHES = parseChampionsCalendar(readFileSync(new URL('./data/champions-shanghai-2026.ics', import.meta.url), 'utf8'))
export function makeSchedule(sql, fetcher = fetch) {
  let matches = SEED_MATCHES, syncedAt = '2026-09-24T07:31:08Z', checkedAt = 0, pending = null, restored = false, stale = false
  return async function readSchedule() {
    if (!restored && sql) {
      restored = true
      const [saved] = await sql`select value from site_config where key = 'champions_calendar'`
      // only if nothing fresher has been fetched while that read was out
      if (saved?.value?.matches?.length && !(saved.value.syncedAt < syncedAt)) { matches = saved.value.matches; syncedAt = saved.value.syncedAt }
    }
    if (Date.now() - checkedAt > 30 * 60_000 && !pending) {
      checkedAt = Date.now()
      pending = (async () => {
        try {
          const response = await fetcher(CHAMPIONS.calendar, { signal: AbortSignal.timeout(5000) })
          if (!response.ok) throw new Error('schedule unavailable')
          const text = await response.text()
          if (text.length > 200_000) throw new Error('schedule too large')
          const next = parseChampionsCalendar(text)
          if (!next.length) throw new Error('empty schedule')
          matches = next; syncedAt = new Date().toISOString(); stale = false
          if (sql) await sql`insert into site_config(key,value) values('champions_calendar',${JSON.stringify({ matches, syncedAt })}::jsonb) on conflict(key) do update set value=excluded.value, updated=now()`
        } catch { stale = true } finally { pending = null }
      })()
    }
    // The refresh runs behind the answer: every tab polls this, and making all
    // of them wait out a slow upstream (up to the 5 s timeout) every half hour
    // stalled the whole feed. What was last known is served meanwhile.
    return { matches, syncedAt, stale }
  }
}
