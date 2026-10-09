import { AbeleError } from '@abele/sync-protocol'

interface Continuity<T> {
  pending(): Promise<boolean>
  items(): Promise<T[]>
  blocked(item: T): Promise<boolean>
  send(item: T | 'replay'): Promise<void>
  /** Atomically retain the exact rejected journal and sources before vacating the active slot. */
  hold(item: T | 'replay', error: AbeleError): Promise<void>
  receive(): Promise<void>
  report(error: unknown): void
}
const ITEM_REFUSALS = new Set([
  'forbidden',
  'quota_exceeded',
  'too_large',
  'stale_base',
  'leaves_scope',
  'invalid_request',
  'path_taken',
  'case_collision',
  'unreferenced_attachment',
  'scripts_forbidden',
  'settings_forbidden',
])

/** A failed send never suppresses receive. Uncertain requests retain their active identity. */
export async function receiveDespiteRejectedItems<T>(port: Continuity<T>): Promise<void> {
  const send = async (item: T | 'replay') => {
    try {
      await port.send(item)
      return true
    } catch (error) {
      // A replay's current refusal cannot prove an earlier attempt never committed.
      if (item !== 'replay' && error instanceof AbeleError && ITEM_REFUSALS.has(error.code)) {
        await port.hold(item, error)
        port.report(error)
        return true
      }
      port.report(error)
      return false
    }
  }
  let ready = true
  try {
    if (await port.pending()) ready = await send('replay')
    if (ready)
      for (const item of await port.items()) {
        if (!(await port.blocked(item)) && !(await send(item))) break
      }
  } finally {
    await port.receive()
  }
}
