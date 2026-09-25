/**
 * Fails the test that leaves a delayed write behind.
 *
 * A settings screen holds its disk write back for half a second, and a chat coalesces its file
 * writes the same way. A test that ends with one of those still waiting — a screen never
 * unmounted, a session never destroyed — lets it fire after the test is over, usually after its
 * stubs are restored, where the real `saveSettings` meets no plugin and throws. That surfaced as
 * an unhandled error after a fully passing run, at random, depending only on how loaded the
 * machine was — and named no test.
 *
 * So every timer is remembered with where it was set, and after each test any still pending
 * whose callback ends in one of those writes fails that test, by name, deterministically.
 */
import { afterEach, beforeEach } from 'vitest'

/** Stack frames that mark a timer as a write waiting to happen. */
const WRITE_BEHIND = [/useSettingsSave/, /ChatSession\.markDirty/]

const pending = new Map<unknown, string>()
const realSet = globalThis.setTimeout
const realClear = globalThis.clearTimeout

function patchedSet(this: unknown, handler: unknown, ...rest: unknown[]) {
  const stack = new Error().stack ?? ''
  const tracked = WRITE_BEHIND.some((frame) => frame.test(stack))
  if (!tracked || typeof handler !== 'function') {
    return (realSet as (...args: unknown[]) => unknown).call(this, handler, ...rest)
  }
  const id: unknown = (realSet as (...args: unknown[]) => unknown).call(
    this,
    (...args: unknown[]) => {
      pending.delete(key(id))
      ;(handler as (...a: unknown[]) => unknown)(...args)
    },
    ...rest
  )
  pending.set(key(id), stack)
  return id
}

function patchedClear(this: unknown, id: unknown) {
  pending.delete(key(id))
  return (realClear as (...args: unknown[]) => unknown).call(this, id)
}

/** Node returns a `Timeout` object, the DOM a number; `clearTimeout` accepts either form. */
function key(id: unknown): unknown {
  return typeof id === 'object' && id !== null ? Number(id) : id
}

globalThis.setTimeout = patchedSet as typeof setTimeout
globalThis.clearTimeout = patchedClear as typeof clearTimeout
if (typeof window !== 'undefined' && window !== (globalThis as unknown)) {
  window.setTimeout = patchedSet as typeof window.setTimeout
  window.clearTimeout = patchedClear as typeof window.clearTimeout
}

beforeEach(() => {
  pending.clear()
})

// Registered first, so it runs after every test file's own `afterEach` — the unmounts and
// destroys that are supposed to settle these timers.
afterEach(() => {
  if (pending.size === 0) return
  const stacks = [...pending.values()]
  for (const id of pending.keys()) realClear(id as Parameters<typeof clearTimeout>[0])
  pending.clear()
  const where = stacks.map((s) => s.split('\n').slice(2, 8).join('\n')).join('\n---\n')
  throw new Error(
    `The test ended with ${stacks.length} delayed write(s) still waiting. Unmount the ` +
      `component or destroy/flush the chat session before the test ends.\n${where}`
  )
})
