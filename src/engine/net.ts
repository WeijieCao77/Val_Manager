/**
 * The one place this game talks to a server.
 *
 * Every request goes through here so that a build target with no network at
 * all can swap this module out and leave the game's own logic untouched. That
 * target is the 小红书 小工具 container: it runs the game from an offline zip
 * and blocks `fetch` outright, so the calls must be gone from the bundle, not
 * merely failing inside it.
 *
 * Nothing else changes for the offline build, because every caller already
 * copes with a request that does not arrive — a phone in a tunnel has always
 * been able to produce that, and the localStorage mirror is what answers it.
 */

/** Whether this build can reach a server at all. False in the offline build. */
export const NET = true

export const netFetch = (url: string, init?: RequestInit): Promise<Response> =>
  fetch(url, init)

/** Survives the page going away, where a request does not. */
export const netBeacon = (url: string, blob: Blob): boolean =>
  navigator.sendBeacon?.(url, blob) ?? false
