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
  masterPoints, oppBumpFor, canPlay, spendPlay, STAMINA_COST,
} from './gacha'
export type { GachaState } from './gacha'
export { rankName } from './gacha'
export { applyMail, escrowCard, restoreCard, mailLine } from './inbox'
export type { MailItem } from './inbox'
export { cardById, isPlayerCard, SALVAGE, PLAYER_CARDS, COACH_CARDS, RARITY_CN } from './cards'
export { progressOf } from '../../progress.js'
export { answerFor, kindFor, imgOf } from './challenge'
