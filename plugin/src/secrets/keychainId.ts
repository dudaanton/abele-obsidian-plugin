/**
 * Obsidian's keychain takes an id of lowercase letters, digits and dashes and throws on
 * anything else. Ids made by `nanoid` carry capitals and underscores, so a slot named after
 * one has to be spelled out first — or saving the secret throws and nothing is kept.
 */
const VALID = /^[a-z0-9-]+$/

export const isKeychainId = (id: string): boolean => VALID.test(id)

/**
 * `prefix-part`, with `part` kept as it is when the keychain already takes it (so a slot saved
 * before keeps its name) and spelled out otherwise: a capital as `-` and its small letter, a
 * dash as `--`, anything else as `-0` and its code in four hex digits. No two parts that
 * differ come out the same.
 */
export function keychainId(prefix: string, part: string): string {
  if (VALID.test(part)) return `${prefix}-${part}`
  let out = ''
  for (const ch of part) {
    if (/[a-z0-9]/.test(ch)) out += ch
    else if (/[A-Z]/.test(ch)) out += `-${ch.toLowerCase()}`
    else if (ch === '-') out += '--'
    else out += `-0${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`
  }
  return `${prefix}-${out}`
}
