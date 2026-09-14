/** Storage addressing without loading migration, world data or the simulator. */
let namespace = ''
export function setSaveNamespace(ns: string): void { namespace = ns ? `${ns}:` : '' }
export const saveNamespace = (): string => namespace.replace(/:$/, '')
export const savePrefix = (): string => `valmanager:${namespace}save:`
export const saveIndexKey = (): string => `valmanager:${namespace}index`
