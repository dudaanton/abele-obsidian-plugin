import { expect, it, vi } from 'vitest'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { openTokenLedger } from '@/sync/tokenLedger'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

it('requires explicit recovery before building any token sync or fabricating provenance', async () => {
  const fetcher = vi.fn(async () => {
    throw Error('Unexpected transport')
  })
  const { app, registry, factory, host, ui, id, keys } = tokenHostFixture(fetcher as never)
  await app.vault.adapter.writeBinary(
    'sample.md',
    new TextEncoder().encode('Unsent local content').buffer as ArrayBuffer
  )
  const record = registry.records()[0]
  const state = await openTokenLedger(factory, registry, record, () => {})
  state.close()
  await IndexedDbStateStore.delete(factory, record.ledgerId)
  const watch = vi.spyOn(ObsidianFileSystem.prototype, 'watch')
  try {
    host.start()
    await ui.connectionsChanged()
    expect(registry.records().find((one) => one.id === id)?.status).toBe('error')
    expect(fetcher).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
    expect(keys.size).toBe(1)
    expect(await app.vault.adapter.read('sample.md')).toBe('Unsent local content')
    expect(app.loadLocalStorage('abele-script-provenance')).toBeNull()
    expect(await app.vault.adapter.exists('.abele-script-managed')).toBe(false)
    expect(ui.runtimes.has(id)).toBe(false)
  } finally {
    await host.close()
    vi.restoreAllMocks()
  }
})
