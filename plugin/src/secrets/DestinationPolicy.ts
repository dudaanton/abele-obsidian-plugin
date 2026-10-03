/** Credential destination trust is local to an installation, never part of synced settings. */
export interface Destination {
  keyId: string
  name: string
  origin: string
}
export interface DestinationStorage {
  load(): unknown
  save(value: Record<string, string[]>): void
}
export function httpOrigin(raw: string): string | null {
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.origin
      : null
  } catch {
    return null
  }
}

export class DestinationPolicy {
  constructor(private readonly storage: DestinationStorage) {}
  private accepted(): Record<string, string[]> | null {
    const value = this.storage.load()
    if (value === null || value === undefined) return null
    // Corruption is not a new installation: do not silently trust all current addresses again.
    if (typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, origins]) => Array.isArray(origins) && origins.every((o) => typeof o === 'string')
      )
    )
  }
  initialize(destinations: Destination[]): void {
    if (this.accepted() !== null) return
    this.storage.save({})
    this.accept(destinations)
  }
  accept(destinations: Destination[]): void {
    const accepted = this.accepted() ?? {}
    for (const { keyId, origin } of destinations) {
      if (keyId.startsWith('abele-store-key') || !httpOrigin(origin)) continue
      const previous = Object.hasOwn(accepted, keyId) ? accepted[keyId] : []
      Object.defineProperty(accepted, keyId, {
        value: [...new Set([...previous, origin])],
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    this.storage.save(accepted)
  }
  forget({ keyId, origin }: Destination): void {
    const accepted = this.accepted() ?? {}
    if (Object.hasOwn(accepted, keyId)) {
      accepted[keyId] = accepted[keyId].filter((entry) => entry !== origin)
    }
    this.storage.save(accepted)
  }
  pending(destinations: Destination[]): Destination[] {
    const accepted = this.accepted() ?? {}
    return destinations.filter(
      ({ keyId, origin }) => !Object.hasOwn(accepted, keyId) || !accepted[keyId].includes(origin)
    )
  }
  check(keyId: string, url: string, configured: Destination[]): void {
    const origin = httpOrigin(url)
    if (!origin) throw new Error('A key requires a valid HTTP(S) address without URL credentials')
    if (keyId.startsWith('abele-store-key')) throw new Error('The secret store key cannot be sent')
    const matching = configured.filter((d) => d.keyId === keyId && d.origin === origin)
    if (!matching.length) throw new Error('This key is not configured for that address')
    if (this.pending(matching).length)
      throw new Error(`Confirm ${origin} on this device: use Review key destinations`)
  }
}
