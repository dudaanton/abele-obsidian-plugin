import { vi } from 'vitest'
import { SyncEngine, type FileSystem, type StateStore } from '@abele/sync-sdk/core'
import { tokenHostFixture } from './tokenHostFixture'
import { openTokenLedger } from '@/sync/tokenLedger'
import { TokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { tokenExternalBinding } from '@/sync/tokenExternalBinding'
import type { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

/** Build-only native host fixture. The real engine is constructed; its automatic start is
 * suppressed so assertions can inspect startup barriers before any exchange. */
export async function tokenBuildFixture(extraPath?: string) {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('Unexpected network before explicit exchange')
  })
  const s = tokenHostFixture(fetcher)
  await s.app.vault.adapter.mkdir('Media')
  await s.app.vault.adapter.write('Media/sample.bin', 'sample original')
  if (extraPath) {
    await s.app.vault.adapter.mkdir(extraPath.slice(0, extraPath.lastIndexOf('/')))
    await s.app.vault.adapter.write(extraPath, 'ordinary bytes')
  }
  const record = s.registry.records()[0],
    binding = await tokenExternalBinding(record, s.keys.get(record.secretReference)!)
  const store = await openTokenLedger(s.factory, s.registry, record, () => {})
  const hosts: TokenEngines[] = [s.host]
  vi.spyOn(SyncEngine.prototype, 'start').mockImplementation(() => {})
  const build = async () => {
    const ui = new TokenUi(
      s.registry,
      {
        get: (reference) => s.keys.get(reference) ?? null,
        set: (reference, key) => {
          s.keys.set(reference, key)
        },
        remove: (reference) => {
          s.keys.delete(reference)
        },
      },
      fetcher,
      s.ui.reviews
    )
    const host = new TokenEngines(
      s.app as never,
      ui,
      (reference) => s.keys.get(reference) ?? null,
      { indexedDB: s.factory, fetch: fetcher }
    )
    hosts.push(host)
    const controller = (
      host as unknown as {
        create(
          record: import('@/sync/tokenConnectionRegistry').TokenConnectionRecord,
          prior: Promise<void>
        ): { start(): Promise<void> }
      }
    ).create(s.registry.records()[0], Promise.resolve())
    await controller.start()
    const runtime = (host as unknown as { live: Map<string, TokenEngineRuntime> }).live.get(
      record.id
    )!
    const options = (runtime as unknown as { options: { fs: FileSystem; state: StateStore } })
      .options
    return {
      host,
      ui,
      runtime,
      engine: runtime.engine,
      vault: runtime.client,
      fs: options.fs,
      store: options.state as IndexedDbStateStore,
    }
  }
  const close = async () => {
    store.close()
    for (const host of hosts.reverse()) await host.close()
  }
  return { ...s, record, binding, store, fetcher, build, close }
}
