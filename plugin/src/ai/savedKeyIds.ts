import type { AiSecret } from './types'

/** Stable identities for older named-key records, without changing their keychain references. */
export function savedKeysWithIds(keys: AiSecret[] = []): Array<AiSecret & { id: string }> {
  const slots = new Map<string, number>()
  for (const key of keys) if (key.keyId) slots.set(key.keyId, (slots.get(key.keyId) ?? 0) + 1)
  const used = new Set<string>()
  return keys.map((key) => {
    const label = encodeURIComponent(key.name || 'unnamed')
    const legacy = key.keyId
      ? slots.get(key.keyId)! > 1
        ? `${key.keyId}:${label}`
        : key.keyId
      : `legacy-secret:${label}`
    const base = key.id || legacy
    let id = base
    let duplicate = 1
    while (used.has(id)) id = `${base}:${++duplicate}`
    used.add(id)
    return { ...key, id }
  })
}
