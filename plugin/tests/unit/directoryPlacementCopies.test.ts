import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { EngineError, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { EditCopies } from '@/sync/editCopies'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([
  { fileCount: 0, uploading: false, retry: false },
  { fileCount: 1024, uploading: false, retry: false },
  { fileCount: 1024, uploading: false, retry: true },
  { fileCount: 1024, uploading: true, retry: false },
])(
  'bounds preservation to overwritten files (files=$fileCount, uploading=$uploading, retry=$retry)',
  async ({ fileCount, uploading, retry }) => {
    const scope = { kind: 'folder' as const, id: 'shared', path: 'Container/Shared' }
    const app = buildFakeVault(
      Array.from({ length: 4000 }, (_, i) => ({
        path: `Container/Other/bucket-${i % 40}/sample-${i}.md`,
        content: 'unrelated',
      }))
    )
    await app.vault.createFolder(scope.path)
    const fs = new ObsidianFileSystem(app as unknown as App, {
      fileScope: scope.path,
      preserveEmptyDirectories: true,
    })
    const copies = new EditCopies(),
      copyStore = new MemoryStateStore(),
      metadata = new MemoryStateStore()
    copies.expect(['sample'])
    copies.register('sample', copyStore, (path) => path.startsWith(scope.path + '/'))
    const operations = { list: 0, stat: 0, read: 0, store: 0 }
    let preserving = false
    let modeledMs = 0
    for (const [method, field] of [
      ['list', 'list'],
      ['stat', 'stat'],
      ['readBinary', 'read'],
    ] as const) {
      const original = app.vault.adapter[method].bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, method).mockImplementation(async (...args: never[]) => {
        modeledMs += 10
        if (preserving) operations[field]++
        return original(...args)
      })
    }
    for (const method of ['get', 'getMeta', 'setMeta', 'transaction'] as const) {
      const original = copyStore[method].bind(copyStore)
      vi.spyOn(copyStore, method).mockImplementation((...args: never[]) => {
        operations.store++
        modeledMs += 10
        return original(...args)
      })
    }
    const preserve = vi.fn(async (paths: readonly string[]) => {
      preserving = true
      try {
        const affected = new Set(paths)
        for await (const info of fs.placementFiles(paths)) affected.add(info.path)
        await copies.capture(fs, [...affected])
      } finally {
        preserving = false
      }
    })
    const item = (path: string) => ({
      file_id: path === scope.path ? scope.id : path,
      version_id: 'v-' + path,
      path,
      kind: 'directory',
      mtime: 1000,
    })
    const directories = [
      item('Container'),
      item(scope.path),
      ...Array.from({ length: 60 }, (_, i) => item(scope.path + '/section-' + i)),
    ]
    const payloads = new Map<string, Uint8Array>()
    const files = []
    for (let i = 0; i < fileCount; i++) {
      const bytes = new Uint8Array(20 * 1024).fill(120)
      bytes.set(new TextEncoder().encode('sample-' + i))
      const id = 'content-' + i
      payloads.set(id, bytes)
      files.push({
        file_id: id,
        version_id: 'v-' + id,
        path: scope.path + '/section-' + (i % 60) + '/sample-' + i + '.md',
        kind: 'note',
        mtime: 1000,
        size: bytes.length,
        sha: await sha256(bytes),
      })
    }
    const items = [...directories, ...files],
      boundary = fileCount ? 1000 : 32
    if (uploading) {
      for (const directory of directories.slice(2)) await app.vault.createFolder(directory.path)
      for (const file of files) {
        const created = await app.vault.createBinary(
          file.path,
          payloads.get(file.file_id)!.buffer as ArrayBuffer
        )
        // The fake binary creator does not update the index's size/mtime automatically.
        created.stat = { ...created.stat, size: file.size, mtime: file.mtime }
      }
    }
    let contentRequests = 0
    let wholeContentRequests = 0
    let retried = false
    let requests = 0
    let uploaded = 0
    let committedContent = 0
    const runtime = new TokenEngineRuntime({
      id: 'sample',
      encoded: encodeAccessToken({
        v: 1,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        scope,
      }),
      fs: coordinatedFileSystem(fs, new PathCoordinator(), () => {}, preserve),
      state: new MemoryStateStore(),
      reviews: {
        executables: new ExecutableReview(metadata),
        attachments: new AttachmentConsent(metadata),
        close: () => {},
      },
      fetch: async (input, init) => {
        requests++
        modeledMs += 10
        const url = new URL(String(input))
        if (url.pathname === '/v2/connection')
          return Response.json({
            protocol: 2,
            token_id: 'sample-token',
            space_id: 'sample-space',
            scope,
            status: 'active',
            limits: { max_file_bytes: 1000000, quota_bytes: null },
          })
        if (url.pathname === '/v2/changes')
          return Response.json({ items: [], cursor: 100, next: null })
        if (url.pathname === '/v2/manifest')
          return Response.json({
            items: (uploading
              ? []
              : url.searchParams.has('next')
                ? [directories[1], ...items.slice(boundary)]
                : items.slice(0, boundary)
            ).filter((item) => item.path === scope.path || item.path.startsWith(scope.path + '/')),
            cursor: 100,
            next: uploading || url.searchParams.has('next') ? null : 'second',
          })
        if (url.pathname.startsWith('/v2/uploads/')) {
          uploaded++
          return new Response(null, { status: 204 })
        }
        if (url.pathname.endsWith('/content')) {
          contentRequests++
          if (!new Headers(init?.headers).has('range')) wholeContentRequests++
          const bytes = payloads.get(url.pathname.split('/')[3])!
          const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')
          if (retry && range && url.pathname.includes('/content-1000/')) {
            // Yield the request without tying retry ordering to a wall-clock sleep.
            await Promise.resolve()
            if (!retried) {
              retried = true
              throw new EngineError('offline', 'Sample transfer interrupted')
            }
          }
          return range
            ? new Response(bytes.slice(Number(range[1]), Number(range[2]) + 1), {
                status: 206,
                headers: {
                  'content-range': `bytes ${range[1]}-${range[2]}/${bytes.length}`,
                  'content-length': String(Number(range[2]) - Number(range[1]) + 1),
                },
              })
            : new Response(bytes)
        }
        if (url.pathname === '/v2/commit') {
          committedContent += JSON.parse(String(init?.body)).ops.filter(
            (op: { op: string }) => op.op === 'create'
          ).length
          return Response.json({
            cursor: 100,
            results: JSON.parse(String(init?.body)).ops.map((op: { path: string; op: string }) =>
              op.op === 'create'
                ? { status: 'applied', ...files.find((file) => file.path === op.path)!, seq: 100 }
                : {
                    status: 'applied',
                    ...item(op.path),
                    seq: 100,
                    sha: '0'.repeat(64),
                    size: 0,
                  }
            ),
          })
        }
        throw new Error('Unexpected fixture request')
      },
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
    const started = performance.now()
    try {
      await runtime.sync()
      expect(runtime.engine.status).toMatchObject({ state: 'idle', pending: 0, lastError: null })
      if (uploading) {
        expect(uploaded).toBe(fileCount)
        expect(committedContent).toBe(fileCount)
      }
      if (!uploading) {
        expect(wholeContentRequests).toBe(0)
        expect(contentRequests).toBe(fileCount + Number(retry))
        expect(retried).toBe(retry)
      }
      expect(preserve).toHaveBeenCalledTimes(uploading ? 0 : fileCount)
      expect(operations.list).toBe(0)
      expect(operations.read).toBe(0)
      expect(operations.stat).toBeLessThanOrEqual(fileCount * 2)
      expect(operations.store).toBe(0)
      expect(requests).toBeLessThan(fileCount * 2 + 20)
      // Fixed setup plus at most 40 modeled I/O operations per transferred file.
      expect(modeledMs).toBeLessThan(30_000 + fileCount * 40 * 10)
      const elapsedMs = performance.now() - started
      // Operation counts above prove bounded work; wall time is diagnostic under contention.
      console.log(
        '[bounded folder placement]',
        JSON.stringify({
          fileCount,
          uploading,
          bytes: fileCount * 20 * 1024,
          elapsedMs,
          operations,
          requests,
        })
      )
      for (const dir of directories.slice(1))
        expect((await app.vault.adapter.stat(dir.path))?.type).toBe('folder')
      for (const file of files)
        expect(await sha256(new Uint8Array(await app.vault.adapter.readBinary(file.path)))).toBe(
          file.sha
        )
    } finally {
      await runtime.close()
      vi.restoreAllMocks()
    }
  },
  // Includes hashing, transfer and verification of 1,024 files, with real async tasks.
  40_000 + 1024 * 200
)
