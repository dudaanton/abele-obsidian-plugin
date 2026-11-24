import type { App } from 'obsidian'
import type { Keychain } from '@/secrets/SecretStore'

const owned = (id: string) => /^(abele-sync-device-|abele-scoped-)/.test(id)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The host records access even for absent keys and retains it after deletion. */
export function syncSecretKeychain(app: App): Keychain {
  const host = app.secretStorage as Keychain & {
    listSecrets?(): string[]
    /** Update the live cache too, so a queued host save cannot resurrect retired rows. */
    secretsMeta?: Record<string, unknown>
  }
  const prune = (retired?: string) => {
    if (!host.listSecrets) return
    const live = new Set(host.listSecrets())
    const saved: unknown = app.loadLocalStorage('secrets-meta')
    const memory = host.secretsMeta
    let changed = false
    for (const metadata of [saved, memory]) {
      if (!object(metadata)) continue
      for (const id of Object.keys(metadata)) {
        if (owned(id) && (id === retired || !live.has(id))) {
          delete metadata[id]
          changed = true
        }
      }
    }
    if (changed) app.saveLocalStorage('secrets-meta', object(memory) ? memory : saved)
  }
  prune()
  return {
    getSecret: (id) => {
      // Verification of a removed token must not allocate another access record.
      if (owned(id) && host.listSecrets && !host.listSecrets().includes(id)) return null
      return host.getSecret(id)
    },
    setSecret: (id, value) => host.setSecret(id, value),
    deleteSecret: (id) => {
      const removed = host.deleteSecret ? host.deleteSecret(id) : (host.setSecret(id, ''), true)
      if (owned(id)) prune(id)
      return removed
    },
  }
}
