/**
 * telemetry.ts for the offline 小工具 build: there is nowhere to report to.
 *
 * Aliased in by vite.config.minitool.ts. The real module's queue, heartbeat
 * and session timers all exist to get events to a server, so with the server
 * gone the whole thing goes rather than idling — and with it the last
 * `sendBeacon` in the bundle.
 */

type Props = Record<string, string | number | boolean | null | undefined>

export function track(_name: string, _props?: Props): void {}
export function startTelemetry(): void {}
export function _stopTelemetry(): void {}
