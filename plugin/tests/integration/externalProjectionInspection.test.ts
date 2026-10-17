import { performance } from 'node:perf_hooks'
import { desktopFsPort } from '../helpers/desktopRequire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectionEvidence, EXTERNAL_INSPECTION_KEY } from '@/sync/external/pluginSafety'
import { MAX_PROJECTION_BYTES, recognizeProjection } from '@/sync/external/projection'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.restoreAllMocks())

describe('bounded persisted external projection inspection', () => {
  it('inspects only selected folders and exact group members without reading their neighbours', async () => {
    const app = useVault([
      { path: 'Shared/note.md', content: 'ordinary' },
      { path: 'Shared/.hidden/item.txt', content: 'ordinary' },
      { path: 'Notes/member.md', content: 'ordinary' },
      ...Array.from({ length: 200 }, (_, i) => ({ path: `Private/${i}.md`, content: 'private' })),
    ])
    const list = vi.spyOn(app.vault.adapter, 'list')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const index = vi.spyOn(app.vault, 'getFiles')
    await projectionEvidence(app as never, () => {}, true, new Set(), {
      roots: ['Shared'],
      paths: ['Notes/member.md'],
    })
    expect(list.mock.calls.map(([path]) => path)).toEqual(['Shared', 'Shared/.hidden'])
    expect(read.mock.calls.map(([path]) => path).sort()).toEqual([
      'Notes/member.md',
      'Shared/.hidden/item.txt',
      'Shared/note.md',
    ])
    expect(index).not.toHaveBeenCalled()
  })
  it('inspects only exact group members without listing any folder', async () => {
    const app = useVault([
      { path: 'Notes/member.md', content: 'ordinary' },
      { path: 'Notes/neighbour.md', content: 'private' },
    ])
    const list = vi.spyOn(app.vault.adapter, 'list')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    await projectionEvidence(app as never, () => {}, true, new Set(), {
      roots: [],
      paths: ['Notes/member.md'],
    })
    expect(list).not.toHaveBeenCalled()
    expect(read.mock.calls.map(([path]) => path)).toEqual(['Notes/member.md'])
  })
  it('accepts a not-yet-materialized folder without listing the vault root', async () => {
    const app = useVault([{ path: 'Private/note.md', content: 'private' }])
    const list = vi.spyOn(app.vault.adapter, 'list')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    await expect(
      projectionEvidence(app as never, () => {}, true, new Set(), {
        roots: ['Shared'],
      })
    ).resolves.toBeNull()
    expect(list).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
  it.each(['delete', 'rename'])(
    'skips a captured indexed path after %s while listing directories',
    async (action) => {
      const app = useVault([{ path: 'Notes/gone.md', content: 'ordinary' }])
      const list = app.vault.adapter.list.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (path) => {
        const result = await list(path)
        if (path === '') {
          if (action === 'delete')
            await app.vault.delete(app.vault.getFileByPath('Notes/gone.md')!, true)
          else await app.vault.adapter.rename('Notes/gone.md', 'Notes/renamed.md')
        }
        return result
      })
      await expect(projectionEvidence(app as never)).resolves.toBeNull()
    }
  )
  it('cancels a pending read, checkpoints completed evidence and resumes without rereading it', async () => {
    const app = useVault(
      Array.from({ length: 12 }, (_, index) => ({ path: `Notes/${index}.md`, content: 'ordinary' }))
    )
    const controller = new AbortController()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = app.vault.adapter.readBinary.bind(app.vault.adapter)
    const reads = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
      if (Number(path.split('/')[1].split('.')[0]) >= 8) await gate
      return original(path)
    })
    const progress = vi.fn()
    const inspection = projectionEvidence(app as never, () => {}, true, new Set(), {
      signal: controller.signal,
      progress,
    }).catch((error) => error)
    try {
      await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(8, 12))
      controller.abort()
      expect(await inspection).toBeInstanceOf(Error)
      const saved = app.loadLocalStorage(EXTERNAL_INSPECTION_KEY) as { entries: unknown[] }
      expect(saved.entries).toHaveLength(8)
      release()
      await new Promise((resolve) => setTimeout(resolve, 1))
      expect(app.loadLocalStorage(EXTERNAL_INSPECTION_KEY)).toEqual(saved)
      reads.mockClear()
      expect(await projectionEvidence(app as never)).toBeNull()
      expect(reads).toHaveBeenCalledTimes(4)
      expect(
        reads.mock.calls.every(([path]) => Number(path.split('/')[1].split('.')[0]) >= 8)
      ).toBe(true)
    } finally {
      release()
      controller.abort()
    }
  })
  it('checks files concurrently with at most eight adapter operations in flight', async () => {
    const app = useVault(
      Array.from({ length: 24 }, (_, index) => ({
        path: `.hidden/${index}.md`,
        content: 'ordinary',
      }))
    )
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    let running = 0,
      peak = 0
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      try {
        return await stat(path)
      } finally {
        running--
      }
    })
    expect(await projectionEvidence(app as never)).toBeNull()
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
  })
  it('never reads large files, including hidden/excluded files and multi-gigabyte video', async () => {
    const app = useVault([
      { path: 'Media/sample-video.bin', content: 'small synthetic fixture' },
      { path: '.hidden/sample-large.bin', content: 'small synthetic fixture' },
    ])
    app.vault.getFileByPath('Media/sample-video.bin')!.stat.size = 2 * 1024 * 1024 * 1024
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      const found = await stat(path)
      return found?.type === 'file' ? { ...found, size: 2 * 1024 * 1024 * 1024 } : found
    })
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    expect(await projectionEvidence(app as never)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('does not decode an entire oversized buffer supplied directly to marker recognition', () => {
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    const bytes = new TextEncoder().encode(
      '{"format":"abele.external",' + ' '.repeat(MAX_PROJECTION_BYTES * 4)
    )
    expect(recognizeProjection(bytes)).toBe(true)
    expect(decode.mock.calls).toHaveLength(1)
    expect((decode.mock.calls[0][0] as Uint8Array).byteLength).toBeLessThanOrEqual(
      MAX_PROJECTION_BYTES
    )
  })

  it('uses a bounded prefix capability when available and decodes no bytes beyond the projection cap', async () => {
    const app = useVault([{ path: 'sample.txt', content: 'ordinary bytes' }])
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const prefix = vi.fn(async (_path: string, limit: number) => {
      expect(limit).toBe(MAX_PROJECTION_BYTES)
      return new TextEncoder().encode('ordinary bytes')
    })
    ;(app.vault.adapter as any).readBinaryPrefix = prefix
    try {
      expect(await projectionEvidence(app as never)).toBeNull()
      expect(prefix).toHaveBeenCalledOnce()
      expect(read).not.toHaveBeenCalled()
    } finally {
      delete (app.vault.adapter as any).readBinaryPrefix
    }
  })

  it('uses a native bounded read on desktop instead of allocating an entire file buffer', async () => {
    const app = useVault([{ path: 'sample.txt', content: 'ordinary bytes' }])
    const whole = vi.spyOn(app.vault.adapter, 'readBinary')
    const close = vi.fn(async () => {})
    const read = vi.fn(
      async (buffer: Uint8Array, _offset: number, length: number, position: number) => {
        expect(length).toBe(MAX_PROJECTION_BYTES)
        expect(position).toBe(0)
        const bytes = new TextEncoder().encode('ordinary bytes')
        buffer.set(bytes)
        return { bytesRead: bytes.length }
      }
    )
    const adapter = app.vault.adapter as any
    adapter.getFullPath = (path: string) => '/vault/' + path
    adapter.fsPromises = {
      lstat: async () => ({ dev: 1, ino: 1, isSymbolicLink: () => false }),
      open: vi.fn(async () => ({ read, close, stat: async () => ({ dev: 1, ino: 1 }) })),
    }
    desktopFsPort(adapter.fsPromises)
    try {
      expect(await projectionEvidence(app as never)).toBeNull()
      expect(whole).not.toHaveBeenCalled()
      expect(read).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
    } finally {
      delete adapter.getFullPath
      delete adapter.fsPromises
    }
  })

  it('persists path/size/mtime inspection results so thousands of unchanged files are not reread on the next build', async () => {
    const count = 3000
    const app = useVault(
      Array.from({ length: count }, (_, index) => ({
        path: `Notes/sample-${index}.md`,
        content: 'ordinary content',
      }))
    )
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const before = performance.now()
    expect(await projectionEvidence(app as never)).toBeNull()
    const coldMs = performance.now() - before
    expect(read).toHaveBeenCalledTimes(count)
    read.mockClear()
    const warm = performance.now()
    // A new host facade shares only persisted vault-local storage, not a scanner object.
    const reopened = {
      vault: app.vault,
      loadLocalStorage: app.loadLocalStorage.bind(app),
      saveLocalStorage: app.saveLocalStorage.bind(app),
    }
    expect(await projectionEvidence(reopened as never)).toBeNull()
    const warmMs = performance.now() - warm
    expect(read).not.toHaveBeenCalled()
    console.info('Projection inspection counts', {
      count,
      coldMs,
      warmMs,
      warmReads: read.mock.calls.length,
    })
    expect(warmMs).toBeLessThan(coldMs * 2 + 1000)
    await app.vault.adapter.write('Notes/sample-0.md', 'changed ordinary content')
    expect(await projectionEvidence(reopened as never)).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps extension-independent marker holds for small moved files, including cache hits', async () => {
    const app = useVault([
      { path: 'Media/sample-moved.txt', content: '{"fo\\u0072mat":"abele.external", broken' },
    ])
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    expect(await projectionEvidence(app as never)).toBe('Media/sample-moved.txt')
    expect(await projectionEvidence(app as never)).toBe('Media/sample-moved.txt')
    expect(read).toHaveBeenCalledOnce()
  })
})
