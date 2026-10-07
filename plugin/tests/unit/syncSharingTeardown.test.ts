import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { SyncService } from '@/sync/SyncService'
import { pendingTeardown } from '@/sync/teardownBarrier'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

it('includes production sharing teardown in the app reload barrier', async () => {
  const app = useVault([])
  const service = SyncService.getInstance()
  service.init(app as never, { registerDomEvent: vi.fn(), register: vi.fn() } as never)
  const gate = deferred<void>()
  const close = vi.fn(() => gate.promise)
  service.sharing.value = { close, scope: ref(null) } as never
  const stopping = service.destroy()
  let completed = false
  pendingTeardown(app as never).then(() => { completed = true })
  try {
    expect(close).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(completed).toBe(false)
  } finally {
    gate.resolve()
    await stopping
  }
  await pendingTeardown(app as never)
  expect(completed).toBe(true)
})
