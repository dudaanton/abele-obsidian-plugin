import { expect, it, vi } from 'vitest'
import { closeOwnedWindows } from '../e2e/helpers/closeOwnedWindows'
it('closes an owned temporary window despite repeated polite-close failures before forgetting its vault', async () => {
  let open = true
  const close = vi.fn(() => {
    throw new Error('sample polite close failed')
  })
  const force = vi.fn(() => {
    open = false
  })
  const wait = vi.fn(async () => {
    if (open) throw new Error('sample window still open')
  })
  await closeOwnedWindows(close, force, wait)
  expect(open).toBe(false)
  expect(close).toHaveBeenCalledTimes(3)
  expect(force).toHaveBeenCalledOnce()
})

it('does not authorize forgetting or removing a vault if forced close cannot be confirmed', async () => {
  const forget = vi.fn()
  const cleanup = async () => {
    await closeOwnedWindows(
      () => {},
      () => {},
      async () => {
        throw new Error('sample still open')
      }
    )
    forget()
  }
  await expect(cleanup()).rejects.toThrow('could not be closed')
  expect(forget).not.toHaveBeenCalled()
})
