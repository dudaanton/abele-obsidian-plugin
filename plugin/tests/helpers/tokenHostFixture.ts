import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { TokenUi } from '@/sync/tokenUi'
import { TokenEngines } from '@/sync/tokenEngines'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from './fakeVault'

export function tokenHostFixture(
  fetcher: typeof fetch,
  files: Parameters<typeof buildFakeVault>[0] = []
) {
  const app = buildFakeVault(files),
    registry = TokenConnectionRegistry.open(app),
    keys = new Map<string, string>()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, value: string) => {
      keys.set(id, value)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const id = registry.add(),
    scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
  registry.attach(
    id,
    { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope },
    { protocol: 2, token_id: 'sample-token', space_id: 'sample-space', scope, status: 'active' },
    secrets
  )
  const meta = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(meta),
    attachments: new AttachmentConsent(meta),
    close: () => {},
  }
  const ui = new TokenUi(registry, secrets, fetcher, reviews),
    factory = new IDBFactory()
  const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
    fetch: fetcher,
    indexedDB: factory,
  })
  return { app, registry, keys, id, ui, factory, host }
}
