import { normalizeServerUrl } from '@abele/sync-protocol'
import { tokenUi } from '@/sync/tokenUi'

/** Public device-only token preferences. Credentials and ledger identities are never settings. */
export const isTokenPath = (path: string) =>
  path === 'sync.connections' || path.startsWith('sync.connections.')
export function tokenView(): Record<string, unknown> {
  return Object.fromEntries(
    (tokenUi.value?.registry.records() ?? []).map((one) => [
      one.id,
      {
        address: one.address,
        paused: one.paused,
      },
    ])
  )
}
export function validTokenPath(path: string): boolean {
  const parts = path.split('.')
  return (
    parts.length === 2 ||
    (parts.length === 4 &&
      ['address', 'paused'].includes(parts[3]) &&
      Object.hasOwn(tokenView(), parts[2]))
  )
}
export function tokenValue(path: string): unknown {
  const parts = path.split('.')
  if (parts.length === 2) return tokenView()
  if (!validTokenPath(path)) return undefined
  return (tokenView()[parts[2]] as Record<string, unknown>)[parts[3]]
}
export async function writeToken(path: string, value: unknown): Promise<string | null> {
  const parts = path.split('.')
  if (!validTokenPath(path) || parts.length !== 4) return 'Change one connection field at a time.'
  const ui = tokenUi.value
  if (!ui) return 'Sync connections are not available.'
  try {
    await ui.updateConnection(
      parts[2],
      parts[3] === 'address' ? { address: value as string } : { paused: value as boolean }
    )
    return null
  } catch {
    return `"${path}" was not changed. This token stays with its original server; open sync settings for details.`
  }
}
export function tokenNext(path: string, value: unknown): unknown {
  return path.endsWith('.address') && typeof value === 'string' && value !== ''
    ? (normalizeServerUrl(value) ?? value)
    : value
}
export function tokenFailure(path: string): string | null {
  const id = path.split('.')[2],
    ui = tokenUi.value
  return ui?.registry.records().find((one) => one.id === id)?.status === 'error'
    ? (ui.activity.value[id]?.error ?? 'Open sync settings for details.')
    : null
}
