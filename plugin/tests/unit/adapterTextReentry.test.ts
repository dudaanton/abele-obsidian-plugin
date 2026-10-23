import { expect, it } from 'vitest'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { adapterPathGate, adapterConfigRevision } from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'

it('finishes an ordinary text write that delegates to a gated binary write', async () => {
  const app = buildFakeVault([])
  const tracker = ChangeTracker.install(app as never)
  try {
    adapterConfigRevision(app.vault.adapter, 'private')
    adapterPathGate(app.vault.adapter)
    await app.vault.adapter.write('sample.md', 'local text')
    expect(await app.vault.adapter.read('sample.md')).toBe('local text')
  } finally {
    tracker.uninstall()
  }
})
