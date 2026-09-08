/**
 * What the server needs from the engine, in one place.
 *
 * Bundled by `npm run build:server` into dist-server/engine.mjs and imported
 * by cards-api.js, which is plain JavaScript and cannot read TypeScript.
 * Nothing here is new code — it is the same rules the client ran, exported so
 * the server can run them instead. See engine/cardActions.ts for why.
 */
export { runAction, wantsRival, squadForPlay, ACTIONS } from './cardActions'
export type { ActEnv, ActResult } from './cardActions'
export {
  newGacha, migrateGacha, mergeClientFields, takeServerFields, clampState, refreshDaily,
  primeStamina, pendingOpponent, SERVER_KEYS, CLIENT_KEYS, STARTER_COINS, GACHA_VERSION,
  masterPoints, oppBumpFor, canPlay, spendPlay, STAMINA_COST, STAMINA_MAX, STAMINA_REGEN_MS,
} from './gacha'
export type { GachaState } from './gacha'
export { rankName } from './gacha'
export { applyMail, escrowCard, restoreCard, mailLine } from './inbox'
export type { MailItem } from './inbox'
export { cardById, isPlayerCard, SALVAGE, ALL_CARDS, PLAYER_CARDS, COACH_CARDS, RARITY_CN } from './cards'
// the shelf is filtered and sorted before it is paged, so the server needs the
// same predicate the filter bar runs — see engine/cardFilter.ts
export { matchesFilter, matchesQuery, readFilter, filterActive } from './cardFilter'
export type { CardFilter } from './cardFilter'
export { progressOf } from '../../progress.js'
export { answerFor, kindFor, imgOf } from './challenge'
