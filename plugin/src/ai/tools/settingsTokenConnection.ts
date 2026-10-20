import { normalizeServerUrl, serverUrlProblem } from '@abele/sync-sdk/protocol'
import { Platform } from 'obsidian'
import { defaultSelective } from '@/sync/connection'
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
        selective: structuredClone(one.selective ?? defaultSelective(Platform.isMobile)),
      },
    ])
  )
}
export function validTokenPath(path: string): boolean {
  const parts = path.split('.')
  if (parts.some((one) => ['__proto__', 'constructor', 'prototype'].includes(one))) return false
  if (parts.length === 2) return true
  const connection = tokenView()[parts[2]]
  if (!connection || parts.length < 4) return false
  let value: unknown = connection
  for (const [index, part] of parts.slice(3).entries()) {
    if (Array.isArray(value)) return index === parts.length - 4 && /^(0|[1-9]\d*)$/.test(part)
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return false
    value = (value as Record<string, unknown>)[part]
  }
  return true
}
export function tokenValue(path: string): unknown {
  const parts = path.split('.')
  if (parts.length === 2) return tokenView()
  if (!validTokenPath(path)) return undefined
  let value = tokenView()[parts[2]]
  for (const part of parts.slice(3)) value = (value as Record<string, unknown>)[part]
  return value
}
export async function writeToken(path: string, value: unknown): Promise<string | null> {
  const parts = path.split('.')
  if (!validTokenPath(path) || parts.length < 4) return 'Change one connection field at a time.'
  const ui = tokenUi.value
  if (!ui) return 'Sync connections are not available.'
  if (parts[3] === 'address' && typeof value === 'string' && value !== '') {
    const problem = serverUrlProblem(value)
    if (problem) return problem
  }
  try {
    let patch: Parameters<typeof ui.updateConnection>[1]
    if (parts[3] === 'selective') {
      const selective = (
        tokenView()[parts[2]] as { selective: import('@abele/sync-sdk/core').SelectiveSettings }
      ).selective
      if (parts.length === 4)
        patch = { selective: value as import('@abele/sync-sdk/core').SelectiveSettings }
      else {
        let target = selective as unknown as Record<string, unknown>
        for (const part of parts.slice(4, -1)) target = target[part] as Record<string, unknown>
        Object.defineProperty(target, parts.at(-1), {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        })
        patch = { selective }
      }
    } else
      patch = parts[3] === 'address' ? { address: value as string } : { paused: value as boolean }
    await ui.updateConnection(parts[2], patch)
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
