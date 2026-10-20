import { expect, it, vi } from 'vitest'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { openTokenLedger } from '@/sync/tokenLedger'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { EXTERNAL_STATE_KEY } from '@abele/sync-sdk/core'

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
it('holds unreadable external recovery evidence before transport or watchers can start', async () => {
  const fetcher = vi.fn(async () => {
      throw new Error('Unexpected transport')
    }),
    one = tokenHostFixture(fetcher as never)
  const record = one.registry.records()[0],
    state = await openTokenLedger(one.factory, one.registry, record, () => {})
  await state.setMeta(EXTERNAL_STATE_KEY, 'not a recoverable document')
  state.close()
  const watch = vi.spyOn(ObsidianFileSystem.prototype, 'watch')
  try {
    one.host.start()
    await one.ui.connectionsChanged()
    expect(one.registry.records()[0].status).toBe('error')
    expect(fetcher).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
    expect(one.keys.size).toBe(1)
  } finally {
    await one.host.close()
    vi.restoreAllMocks()
  }
})
