import { expect, it, vi } from 'vitest'
import { Platform, type App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngines } from '@/sync/tokenEngines'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['server', 'group-peer', 'mobile-server'] as const)(
  'receives a fresh group member from %s outside an existing folder connection',
  async (source) => {
    const wasMobile = Platform.isMobile
    Platform.isMobile = source === 'mobile-server'
    const app = buildFakeVault([
      {
        path: source === 'mobile-server' ? 'Local/private.bin' : 'Private/sample.md',
        content: 'private',
      },
    ])
    const awaitingReconcile = new Set<string>()
    if (source === 'mobile-server') {
      // A hidden staging file has no adapter index entry. Mobile rename moves the
      // bytes but emits no creation for the new visible name, and has no watcher.
      const rename = app.vault.adapter.rename.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
        await rename(from, to)
        if (from.startsWith('.obsidian/') && !to.startsWith('.obsidian/')) awaitingReconcile.add(to)
      })
      const file = app.vault.getFileByPath.bind(app.vault),
        files = app.vault.getFiles.bind(app.vault)
      const abstract = app.vault.getAbstractFileByPath.bind(app.vault),
        markdown = app.vault.getMarkdownFiles.bind(app.vault)
      vi.spyOn(app.vault, 'getFileByPath').mockImplementation((path) =>
        awaitingReconcile.has(path) ? null : file(path)
      )
      vi.spyOn(app.vault, 'getFiles').mockImplementation(() =>
        files().filter((file) => !awaitingReconcile.has(file.path))
      )
      vi.spyOn(app.vault, 'getAbstractFileByPath').mockImplementation((path) =>
        awaitingReconcile.has(path) ? null : abstract(path)
      )
      vi.spyOn(app.vault, 'getMarkdownFiles').mockImplementation(() =>
        markdown().filter((file) => !awaitingReconcile.has(file.path))
      )
      Object.assign(app.vault.adapter, {
        reconcileInternalFile: vi.fn(async (path: string) => {
          awaitingReconcile.delete(path)
        }),
      })
    }
    const registry = TokenConnectionRegistry.open(app),
      metadata = new MemoryStateStore()
    const keys = new Map<string, string>()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, value: string) => {
        keys.set(id, value)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const folder = { kind: 'folder' as const, id: 'folder-root', path: 'Sample library/Shared' }
    const group = { kind: 'group' as const, id: 'group-root', path: 'Sample library/Sample.md' }
    const definitions = [
      {
        scope: folder,
        path: 'Sample library/Shared/sample.md',
        text: 'folder content',
        id: 'folder-file',
      },
      { scope: group, path: group.path, text: 'group root', id: group.id },
      {
        scope: group,
        path: 'Sample library/member.md',
        text: '---\ngroups: ["[[Sample library/Sample]]", "[[Other group]]"]\n---\nmember',
        id: 'group-member',
      },
    ]
    const files = await Promise.all(
      definitions.slice(0, source === 'group-peer' ? 2 : 3).map(async (one) => {
        const bytes = new TextEncoder().encode(one.text)
        return {
          ...one,
          bytes,
          item: {
            file_id: one.id,
            version_id: one.id + '-version',
            path: one.path,
            sha: await sha256(bytes),
            size: bytes.length,
            mtime: 1000,
            kind: 'note',
          },
        }
      })
    )
    const uploads = new Map<string, Uint8Array>()
    let cursor = 1
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input)),
        headers = new Headers(init?.headers)
      const scope = headers.get('authorization') === 'Bearer ' + 'a'.repeat(43) ? folder : group
      if (url.pathname === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: scope.id + '-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000000, quota_bytes: null },
        })
      if (url.pathname === '/v2/manifest')
        return Response.json({
          cursor,
          next: null,
          items: files.filter((one) => one.scope === scope).map((one) => one.item),
        })
      if (url.pathname === '/v2/changes') return Response.json({ cursor, next: null, items: [] })
      if (url.pathname.startsWith('/v2/uploads/')) {
        uploads.set(
          url.pathname.split('/').at(-1)!,
          new Uint8Array(await new Response(init?.body).arrayBuffer())
        )
        return new Response(null, { status: 201 })
      }
      if (url.pathname === '/v2/commit') {
        const ops = JSON.parse(String(init?.body)).ops as {
          op: string
          path: string
          mtime: number
          sha?: string
          size?: number
        }[]
        for (const op of ops)
          if (op.op !== 'mkdir') {
            expect(op.op).toBe('create')
            expect(op.path).toBe(definitions[2].path)
            const bytes = uploads.get(op.sha!)!
            files.push({
              ...definitions[2],
              bytes,
              item: {
                file_id: definitions[2].id,
                version_id: 'created-member-version',
                path: op.path,
                sha: op.sha!,
                size: op.size!,
                mtime: op.mtime,
                kind: 'note',
              },
            })
          }
        cursor++
        return Response.json({
          cursor,
          results: ops.map((op) => ({
            status: 'applied',
            file_id: op.op === 'mkdir' ? op.path + '-directory' : definitions[2].id,
            version_id: op.op === 'mkdir' ? 'directory-version' : 'created-member-version',
            seq: cursor,
            path: op.path,
            sha: op.sha ?? null,
            size: op.size ?? 0,
            mtime: op.mtime,
          })),
        })
      }
      if (url.pathname.includes('/content')) {
        const file = files.find((one) => url.pathname.includes('/' + one.id + '/'))!
        const range = headers.get('range')?.match(/^bytes=(\d+)-(\d+)$/)
        if (!range) return new Response(file.bytes)
        const start = Number(range[1]),
          end = Number(range[2])
        return new Response(file.bytes.slice(start, end + 1), {
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${end}/${file.bytes.length}`,
            'content-length': String(end - start + 1),
          },
        })
      }
      throw new Error('Unexpected request: ' + url.pathname)
    })
    const ui = new TokenUi(registry, secrets, transport, {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    })
    const host = new TokenEngines(app as unknown as App, ui, secrets.get, {
      fetch: transport,
      indexedDB: new IDBFactory(),
      fallbackMs: 60000,
      pollMs: 60000,
      WebSocket: class {
        constructor() {
          throw new Error('No test socket')
        }
      } as never,
    })
    let closeOwner: (() => Promise<void>) | undefined
    try {
      if (source === 'group-peer') {
        const owner = buildFakeVault([
          {
            path: definitions[2].path,
            raw: definitions[2].text,
            frontmatter: { groups: ['[[Sample library/Sample]]', '[[Other group]]'] },
          },
          { path: 'Private/unrelated.md', content: 'unrelated local bytes' },
        ])
        const ownerReads = vi.spyOn(owner.vault.adapter, 'readBinary')
        const ownerRegistry = TokenConnectionRegistry.open(owner),
          ownerKeys = new Map<string, string>()
        const ownerSecrets = {
          get: (id: string) => ownerKeys.get(id) ?? null,
          set: (id: string, key: string) => {
            ownerKeys.set(id, key)
          },
          remove: (id: string) => {
            ownerKeys.delete(id)
          },
        }
        const ownerMetadata = new MemoryStateStore()
        const ownerUi = new TokenUi(ownerRegistry, ownerSecrets, transport, {
          executables: new ExecutableReview(ownerMetadata),
          attachments: new AttachmentConsent(ownerMetadata),
          close: () => {},
        })
        const ownerHost = new TokenEngines(owner as unknown as App, ownerUi, ownerSecrets.get, {
          fetch: transport,
          indexedDB: new IDBFactory(),
          fallbackMs: 60000,
          pollMs: 60000,
          WebSocket: class {
            constructor() {
              throw new Error('No test socket')
            }
          } as never,
        })
        closeOwner = () => ownerHost.close()
        await ownerUi.connect(
          encodeAccessToken({
            v: 1,
            address: 'https://sync.example',
            key: 'b'.repeat(43),
            scope: group,
          })
        )
        const id = ownerRegistry.records()[0].id
        await vi.waitFor(() => expect(ownerUi.runtimes.has(id)).toBe(true))
        await ownerUi.sync(id)
        await ownerUi.sync(id)
        expect(ownerReads.mock.calls.some(([path]) => path.startsWith('Private/'))).toBe(false)
      }
      const connections =
        source === 'mobile-server'
          ? ([[group, 'b']] as const)
          : ([
              [folder, 'a'],
              [group, 'b'],
            ] as const)
      for (const [scope, key] of connections) {
        await ui.connect(
          encodeAccessToken({ v: 1, address: 'https://sync.example', key: key.repeat(43), scope })
        )
        const id = registry.records().find((one) => one.scope?.id === scope.id)!.id
        await vi.waitFor(() => expect(ui.runtimes.has(id)).toBe(true))
        await ui.sync(id)
      }
      if (source !== 'mobile-server')
        expect(await app.vault.adapter.read('Sample library/Shared/sample.md')).toBe(
          'folder content'
        )
      expect(await app.vault.adapter.read(group.path)).toBe('group root')
      expect(await app.vault.adapter.read('Sample library/member.md')).toContain('[[Other group]]')
      expect(app.vault.getFileByPath(group.path)).not.toBeNull()
      expect(app.vault.getFileByPath('Sample library/member.md')).not.toBeNull()
      const groupId = registry.records().find((row) => row.scope?.kind === 'group')!.id
      expect(ui.runtimes.get(groupId)?.scanSnapshot?.().lastPull).toMatchObject({
        complete: true,
        paths: expect.arrayContaining([group.path, 'Sample library/member.md']),
      })
      expect(registry.records().every((one) => !one.rootIssue)).toBe(true)
    } finally {
      await host.close()
      await closeOwner?.()
      Platform.isMobile = wasMobile
    }
  }
)
