/**
 * Names that reach an object's prototype rather than a field of it. A path walked through one,
 * and assigned at the end, lands on a prototype — `Object.prototype` itself when the walk
 * starts from a shared object, and every object in the app then has the key. So no path built
 * from settings, an agent's call or a synced file may walk one, anywhere.
 */
export const PROTOTYPE_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
])

/** Whether `name` is one of `PROTOTYPE_NAMES`. */
export const isPrototypeName = (name: string): boolean => PROTOTYPE_NAMES.has(name)
