import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY, WriteJournal } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([
  ['/', 'folder'],
  ['Other', 'folder'],
  ['/', 'group'],
  ['Other', 'group'],
] as const)(
  'recovers only the selected owner when %s and a %s connection share a vault journal',
  async (firstRoot, secondKind) => {
    const app = buildFakeVault([{ path: 'Shared/kept.md', content: 'kept' }])
    const registry = TokenConnectionRegistry.open(app)
    const keys = new Map<string, string>()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, key: string) => {
        keys.set(id, key)
      },
    }
    const scopes = [
      { kind: 'folder' as const, id: 'first-scope', path: firstRoot },
      { kind: secondKind, id: 'second-scope', path: 'Shared' },
    ]
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname
      const first = new Headers(init?.headers).get('authorization')?.includes('a'.repeat(43))
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: first ? 'first-token' : 'second-token',
          space_id: 'sample-space',
          scope: scopes[first ? 0 : 1],
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      if (path === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body)) as {
          ops: Array<{ path: string; sha?: string; size?: number; mtime?: number }>
        }
        return Response.json({
          cursor: 1,
          results: ops.map((op) => ({
            status: 'applied',
            file_id: crypto.randomUUID(),
            version_id: crypto.randomUUID(),
            seq: 1,
            path: op.path,
            sha: op.sha ?? null,
            size: op.size ?? 0,
            mtime: op.mtime ?? 0,
          })),
        })
      }
      if (path.startsWith('/v2/uploads/')) return new Response(null, { status: 201 })
      return Response.json({ items: [], cursor: 0, next: null })
    })
    const metadata = new MemoryStateStore()
    const ui = new TokenUi(registry, secrets, transport, {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    })
    const factory = new IDBFactory()
    const make = () =>
      new TokenEngines(app as unknown as App, ui, secrets.get, {
        fetch: transport,
        indexedDB: factory,
        WebSocket: class {
          constructor() {
            throw new Error('No test socket')
          }
        } as unknown as typeof WebSocket,
      })
    const hosts: TokenEngines[] = []
    const token = (index: number) =>
      encodeAccessToken({
        v: 1,
        address: 'https://sync.example',
        key: (index ? 'b' : 'a').repeat(43),
        scope: scopes[index],
      })
    const ready = async (id: string) => {
      await vi.waitFor(() =>
        expect(
          ui.runtimes.has(id) || registry.records().find((row) => row.id === id)?.status === 'error'
        ).toBe(true)
      )
      expect(ui.activity.value[id]?.error).toBeUndefined()
      expect(ui.runtimes.has(id)).toBe(true)
    }
    try {
      let host = make()
      hosts.push(host)
      await ui.connect(token(0))
      const first = registry.records()[0].id
      await ready(first)
      await host.close()
      registry.setPaused(first, true)
      const foreign = [
        { owner: first, target: 'Other/pending.md', temp: 'Other/pending.tmp' },
        { owner: first, target: 'Other/swapped.md', backup: 'Other/swapped.old', installed: true },
        { target: 'Legacy/pending.md', temp: 'Legacy/pending.tmp' },
      ]
      const retained = [{ owner: first, target: 'Other/retained.md', backup: 'Other/retained.old' }]
      app.saveLocalStorage(JOURNAL_KEY, foreign)
      app.saveLocalStorage(RECOVERED_WRITES_KEY, retained)
      host = make()
      hosts.push(host)
      await ui.connect(token(1))
      const second = registry.records().find((row) => row.id !== first)!.id
      await ready(second)
      await host.close()
      await app.vault.adapter.write('Shared/owned.tmp', 'never installed')
      app.saveLocalStorage(JOURNAL_KEY, [
        ...foreign,
        { owner: second, target: 'Shared/target.md', temp: 'Shared/owned.tmp' },
      ])
      const calls: string[] = []
      const spies: Array<{ mockRestore(): void }> = []
      for (const method of [
        'list',
        'stat',
        'exists',
        'read',
        'readBinary',
        'writeBinary',
        'remove',
        'rename',
      ] as const) {
        const port = app.vault.adapter[method]
        const original = (vi.isMockFunction(port) ? port.getMockImplementation()! : port).bind(
          app.vault.adapter
        )
        spies.push(
          vi
            .spyOn(app.vault.adapter, method)
            .mockImplementation(async (path: string, ...args: never[]) => {
              calls.push(path)
              if (method === 'rename') calls.push(String(args[0]))
              return original(path, ...args)
            })
        )
      }
      try {
        host = make()
        hosts.push(host)
        host.start()
        await ready(second)
        expect(new WriteJournal(app).entries()).toEqual(foreign)
        expect(new WriteJournal(app).recovered()).toEqual(retained)
        expect(calls.some((path) => /^(Other|Legacy)(\/|$)/.test(path))).toBe(false)
        expect(calls).toContain('Shared/owned.tmp')
        expect(await app.vault.adapter.exists('Shared/owned.tmp')).toBe(false)
        expect(await app.vault.adapter.exists('Shared/target.md')).toBe(false)
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    } finally {
      for (const host of hosts) await host.close()
    }
  }
)
