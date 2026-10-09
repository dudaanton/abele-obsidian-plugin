import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectionEvidence } from '@/sync/external/pluginSafety'
import { MAX_PROJECTION_BYTES, recognizeProjection } from '@/sync/external/projection'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.restoreAllMocks())

describe('bounded persisted external projection inspection', () => {
  it('never reads large files, including hidden/excluded files and multi-gigabyte video', async () => {
    const app = useVault([
      { path: 'Media/sample-video.bin', content: 'small synthetic fixture' },
      { path: '.hidden/sample-large.bin', content: 'small synthetic fixture' },
    ])
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
    adapter.getFullPath = (path: string) => path
    adapter.fsPromises = { open: vi.fn(async () => ({ read, close })) }
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
