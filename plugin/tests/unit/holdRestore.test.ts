import { expect, it, vi } from 'vitest'
import { holdRestore } from '../e2e/helpers/holdRestore'

it('settles the delayed restore after its release handle is removed, keeping the method callable', async () => {
  const original = vi.fn(async (id: string) => id)
  const client = { restoreDeleted: original }
  let release: (() => void) | undefined = holdRestore(client)
  const pending = client.restoreDeleted('first')
  expect(original).not.toHaveBeenCalled()
  release()
  release = undefined
  expect(await pending).toBe('first')
  expect(await client.restoreDeleted('second')).toBe('second')
  expect(client.restoreDeleted).toBe(original)
})
