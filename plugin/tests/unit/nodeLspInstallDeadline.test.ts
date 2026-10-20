import { afterEach, expect, it, vi } from 'vitest'
import { RequestChannel } from '@abele/channel-client'
import type { AuthenticatedChannel } from '@abele/channel-protocol'

afterEach(() => vi.useRealTimers())
it('allows an explicit server installation to outlive ordinary request deadlines', async () => {
  vi.useFakeTimers()
  const transport = { send: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  const requests = new RequestChannel({ transport } as unknown as AuthenticatedChannel)
  let settled = false
  const installing = requests.request('lsp.v1.install', { languages: ['typescript'] }).then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  try {
    await vi.advanceTimersByTimeAsync(6000)
    expect(settled).toBe(false)
    expect(transport.close).not.toHaveBeenCalled()
  } finally {
    await requests.close()
    await installing
  }
})
