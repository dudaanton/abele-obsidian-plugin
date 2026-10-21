import { expect, it, vi } from 'vitest'
import { sha256 as reference } from '@abele/sync-sdk/core'
import { sha256 } from '@/sync/external/hash'

// BUG: SDK buffered hashing runs the complete incremental loop in one browser task.
it.fails('SDK hashing yields a browser task for buffered content', async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024)
  let heartbeat = false
  const timer = setTimeout(() => {
    heartbeat = true
  }, 0)
  try {
    await reference(bytes)
    expect(heartbeat).toBe(true)
  } finally {
    clearTimeout(timer)
  }
})

it('yields browser tasks during hashing without changing the content identity', async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 17).fill(37)
  const expected = await reference(bytes)
  const yieldTask = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  vi.stubGlobal('scheduler', { yield: yieldTask })
  let heartbeat = false
  const timer = setTimeout(() => {
    heartbeat = true
  }, 0)
  try {
    expect(await sha256(bytes)).toBe(expected)
    expect(heartbeat).toBe(true)
    expect(yieldTask).toHaveBeenCalled()
  } finally {
    clearTimeout(timer)
  }
})
