import type { ScopedSecretPort } from './scopedJoin'
export function scopedSecretSlot(id: string): string {
  if (!/^abele-scoped-(?:invitation|installation)-[a-z0-9-]+(?::(?:binding|accepted))?$/.test(id))
    throw new Error('Unexpected scoped keychain slot')
  const legacy = id.replaceAll(':', '-')
  if (legacy.length <= 64) return legacy
  const match =
    /^abele-scoped-(invitation|installation)-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(binding|accepted)$/.exec(
      id
    )
  if (!match) throw new Error('Unexpected scoped keychain identity')
  // Lossless UUID encoding; keep credentials and their exact stored descriptors unchanged.
  return `abele-scoped-${match[1] === 'invitation' ? 'invite' : 'install'}-${match[2].replaceAll('-', '')}-${match[3]}`
}
export function scopedSecretPort(road: {
  getLocal(id: string): string
  setLocal(id: string, value: string): void
}): ScopedSecretPort {
  return {
    get: (id) => {
      const slot = scopedSecretSlot(id)
      const value = road.getLocal(slot)
      if (value || slot === id.replaceAll(':', '-')) return value
      // Earlier hosts accepted overlong proof slots. Read both without mutating the proof
      // or descriptor; newer Obsidian releases may refuse even a legacy lookup.
      try {
        return road.getLocal(id.replaceAll(':', '-'))
      } catch {
        return ''
      }
    },
    set: (id, value) => road.setLocal(scopedSecretSlot(id), value),
  }
}
