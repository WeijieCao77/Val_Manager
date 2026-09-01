/**
 * How much play a card save represents.
 *
 * Every term here only ever goes up, and the list is short on purpose because
 * the rule this feeds is a safety property: packs opened, ladder matches
 * played, and how many people you have a friendly record against.
 *
 * `pulls` is the backbone. It rises on every single pack and nothing in the
 * game lowers it, so two copies of an account almost always separate on it
 * alone; the other two are there for the accounts that trade and play rather
 * than open.
 *
 * What is NOT counted, and why, because each of these was in a draft:
 *
 *   coins        — spent as well as earned; the larger pile is not the later one.
 *   daily.streak — resets to 1 on a missed day. Counting it would have refused
 *                  the check-in of every player coming back after a week, which
 *                  is precisely the player least able to afford another bug.
 *   friend W/L   — the friend list is capped at 24 and the oldest entry is
 *                  dropped, taking its matches with it. The LENGTH is safe
 *                  (it rises to the cap and stays); the sum is not.
 *   cards owned  — it counted until the trading post existed. Listing a card
 *                  puts it in escrow and takes it off your side, and a player
 *                  selling the 彩卡 he does not want in order to keep opening
 *                  packs is the whole point of that market. Counting it would
 *                  have made every such sale look like a rollback and be
 *                  refused. Losing it costs little: you cannot gain a card
 *                  without pulling, being given one, or buying one, and the
 *                  first of those moves `pulls` anyway.
 *
 * This answers "which of two copies of the same account happened last", and it
 * is a better question than "which clock says later": two devices disagree
 * about the time, but neither of them can un-play a match.
 *
 * Deliberately at the repo root and shared by the client and the server rather
 * than written twice. The rule is a safety property — a save may not move an
 * account backwards — and a safety property enforced by two copies of a
 * function is a safety property with two chances to drift.
 */
export function progressOf(s) {
  if (!s || typeof s !== 'object') return -1
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const ladder = s.ladder && typeof s.ladder === 'object' ? s.ladder : {}
  const friends = Array.isArray(s.friends) ? s.friends.length : 0
  return n(s.pulls) + n(ladder.wins) + n(ladder.losses) + friends
}
