import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

it('does not reserve the whole vault for an empty recovery during ordinary scans', async () => {
  const app = useVault([{ path: 'other.md', content: 'sample' }]),
    gate = deferred<void>()
  const placement = pathCoordinatorOf(app.vault).run(['sample.md'], () => gate.promise)
  const fs = new ObsidianFileSystem(app as never)
  let listed = false
  const scan = (async () => {
    for await (const file of fs.list()) expect(file.path).toBe('other.md')
    listed = true
  })()
  try {
    await vi.waitFor(() => expect(listed).toBe(true), { timeout: 100 })
  } finally {
    gate.resolve()
    await placement
    await scan
  }
})
