/**
 * net.ts for a build that has no network — the 小红书 小工具 offline zip.
 *
 * Aliased in by vite.config.minitool.ts. Deliberately contains no reference to
 * `fetch` or `sendBeacon`: the container's checklist is grepped against the
 * shipped bundle, and a banned call that is merely unreachable still counts.
 *
 * Callers read `NET` and take their existing offline path; the two functions
 * are here only so the module's shape matches, and simply say no.
 */

export const NET = false

export const netFetch = (_url: string, _init?: RequestInit): Promise<Response> =>
  Promise.reject(new Error('offline build: no network'))

export const netBeacon = (_url: string, _blob: Blob): boolean => false
