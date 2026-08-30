/// <reference types="vite/client" />

/**
 * True only in the 小红书 小工具 build (vite.config.minitool.ts), where the
 * page runs from an offline zip inside a WebView: no network, no clipboard
 * API, and nowhere for a link to open. Guarding on a compile-time constant
 * rather than a runtime check means the other build keeps the web behaviour
 * and the offline bundle drops the branch entirely.
 */
declare const __MINITOOL__: boolean
