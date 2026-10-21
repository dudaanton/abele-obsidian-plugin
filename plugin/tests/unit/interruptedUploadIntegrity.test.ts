import { expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  ExpectedWrites,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'

it.each([
  [true, true],
  [false, true],
  [true, false],
  [false, false],
])(
  'reuses verified bytes at another local path (recorded=%s, bounded=%s)',
  async (recorded, bounded) => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const bytes = new TextEncoder().encode('sample duplicate content')
    const sha = await sha256(bytes)
    await fs.writeAtomic('existing.md', bytes, 1000)
    if (recorded)
      await state.put({
        path: 'existing.md',
        wirePath: 'existing.md',
        fileId: 'existing-file',
        versionId: 'existing-version',
        sha,
        size: bytes.length,
        mtime: 1000,
      })
    const ports = Object.assign(fs, {
      openRead: async (path: string) => ({
        size: bytes.length,
        read: async (offset: number, length: number) =>
          (await fs.read(path)).slice(offset, offset + length),
        assertUnchanged: async () => {},
        close: async () => {},
      }),
      beginAtomicWrite: vi.fn(async () => {
        throw new Error('Unexpected staging')
      }),
      reopenStage: async () => {
        throw new Error('Unexpected recovery')
      },
    })
    const openVersion = vi.fn(async () => {
      throw new Error('Unexpected remote download')
    })
    const getBlob = vi.fn(async () => {
      throw new Error('Unexpected blob download')
    })
    const client = {
      manifest: async () => ({
        items: [
          {
            file_id: 'copy-file',
            version_id: 'copy-version',
            path: 'copy.md',
            sha,
            size: bytes.length,
            mtime: 2000,
            seq: 5,
            kind: 'note',
          },
        ],
        head_seq: 5,
        next: null,
      }),
      changes: async () => ({ items: [], head_seq: 5, next_since: 5 }),
      openVersion,
      getBlob,
    } as unknown as EngineClient
    const before = await fs.stat('existing.md')
    if (!bounded) {
      Reflect.deleteProperty(ports, 'beginAtomicWrite')
      Reflect.deleteProperty(ports, 'reopenStage')
    }
    await pull(client, ports, state, {
      filter: { excluded: () => false },
      dirty: new Set(),
      expected: new ExpectedWrites(),
    })
    expect(openVersion).not.toHaveBeenCalled()
    expect(getBlob).not.toHaveBeenCalled()
    expect(await fs.read('copy.md')).toEqual(bytes)
    expect(await fs.stat('existing.md')).toEqual(before)
  }
)

it.each(['missing', 'same', 'older'])(
  'resumes over identical local bytes without downloading or writing them (recorded=%s)',
  async (recorded) => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const bytes = new TextEncoder().encode('sample unchanged local note')
    await fs.writeAtomic('sample.md', bytes, 1000)
    const sha = await sha256(bytes)
    const item = {
      file_id: 'sample-file',
      version_id: 'sample-version',
      path: 'sample.md',
      sha,
      size: bytes.length,
      mtime: 2000,
      seq: 5,
      kind: 'note',
    }
    if (recorded !== 'missing')
      await state.put({
        path: 'sample.md',
        wirePath: 'sample.md',
        fileId: item.file_id,
        versionId: recorded === 'older' ? 'sample-prior-version' : item.version_id,
        sha,
        size: bytes.length,
        mtime: 1000,
      })
    const getBlob = vi.fn(async () => bytes.slice())
    const client = {
      manifest: async () => ({ items: [item], head_seq: 5, next: null }),
      changes: async () => ({ items: [], head_seq: 5, next_since: 5 }),
      getBlob,
    } as unknown as EngineClient
    const write = vi.spyOn(fs, 'writeAtomic'),
      move = vi.spyOn(fs, 'move'),
      remove = vi.spyOn(fs, 'remove')
    const before = await fs.stat('sample.md')
    const options = {
      filter: { excluded: () => false },
      dirty: new Set<string>(),
      expected: new ExpectedWrites(),
    }
    // A committed server version may be ahead of the durable local entry after an interruption.
    // Each call constructs a fresh puller, retaining only durable state and the local filesystem.
    await pull(client, fs, state, options)
    await pull(client, fs, state, options)
    expect(write).not.toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await fs.read('sample.md')).toEqual(bytes)
    expect(await fs.stat('sample.md')).toEqual(before)
    expect(await state.getCursor()).toBe(5)
    expect(await state.byFileId(item.file_id)).toMatchObject({ sha, versionId: item.version_id })
    expect(getBlob).not.toHaveBeenCalled()
  }
)

it.each([32, 2 * 1024 * 1024])(
  'adopts matching bounded content without opening a remote version (bytes=%s)',
  async (size) => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const bytes = new Uint8Array(size).fill(7)
    await fs.writeAtomic('sample.bin', bytes, 1000)
    const sha = await sha256(bytes)
    const beginAtomicWrite = vi.fn(async () => {
      throw new Error('Unexpected file staging')
    })
    const ports = Object.assign(fs, {
      openRead: async (path: string) => ({
        size: (await fs.stat(path))!.size,
        read: async (offset: number, length: number) =>
          (await fs.read(path)).slice(offset, offset + length),
        assertUnchanged: async () => {},
        close: async () => {},
      }),
      beginAtomicWrite,
      reopenStage: async () => {
        throw new Error('Unexpected stage recovery')
      },
    })
    const openVersion = vi.fn(async () => {
      throw new Error('Unexpected remote version')
    })
    const getBlob = vi.fn(async () => {
      throw new Error('Unexpected blob')
    })
    const client = {
      manifest: async () => ({
        items: [
          {
            file_id: 'sample-file',
            version_id: 'sample-version',
            path: 'sample.bin',
            sha,
            size,
            mtime: 2000,
            seq: 5,
            kind: 'attachment',
          },
        ],
        head_seq: 5,
        next: null,
      }),
      changes: async () => ({ items: [], head_seq: 5, next_since: 5 }),
      openVersion,
      getBlob,
    } as unknown as EngineClient
    const before = await fs.stat('sample.bin'),
      write = vi.spyOn(fs, 'writeAtomic')
    await pull(client, ports, state, {
      filter: { excluded: () => false },
      dirty: new Set(),
      expected: new ExpectedWrites(),
    })
    expect(openVersion).not.toHaveBeenCalled()
    expect(getBlob).not.toHaveBeenCalled()
    expect(beginAtomicWrite).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(await fs.stat('sample.bin')).toEqual(before)
    expect(await sha256(await fs.read('sample.bin'))).toBe(sha)
  }
)
