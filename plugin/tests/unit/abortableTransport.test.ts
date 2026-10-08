import { expect, it, vi } from 'vitest'
import { waitWithAbort } from '@/sync/scoped/abortableTransport'

it.each([false, true])(
  'rejects non-Error cancellation as an Error (already aborted=%s)',
  async (already) => {
    const controller = new AbortController()
    const reason = 'sample cancellation'
    const work = vi.fn(() => new Promise<void>(() => {}))
    if (already) controller.abort(reason)
    const result = waitWithAbort(controller.signal, work)
    if (!already) controller.abort(reason)
    await expect(result).rejects.toMatchObject({
      message: 'Scoped request was cancelled',
      cause: reason,
    })
    expect(work).toHaveBeenCalledTimes(already ? 0 : 1)
  }
)

it('preserves the original Error when cancelling a pending request', async () => {
  const controller = new AbortController()
  const reason = new Error('sample cancellation')
  const result = waitWithAbort(controller.signal, () => new Promise<void>(() => {}))
  controller.abort(reason)
  await expect(result).rejects.toBe(reason)
})
