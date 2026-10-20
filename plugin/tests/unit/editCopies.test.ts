import { expect, it } from 'vitest'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { vi } from 'vitest'
import { EditCopies, EDIT_COPIES_KEY } from '@/sync/editCopies'

it('validates retained history once for a batch and rechecks it once inside the durable transaction', async () => {
  const fs = new MemoryFileSystem(),
    store = new MemoryStateStore(),
    copies = new EditCopies()
  copies.expect(['sample'])
  copies.register('sample', store, () => true)
  await fs.writeAtomic('retained.md', new Uint8Array([1]), 10)
  await copies.capture(fs, ['retained.md'])
  const paths = Array.from({ length: 8 }, (_, i) => 'changed-' + i + '.md')
  for (const path of paths) await fs.writeAtomic(path, new Uint8Array([2]), 20)
  const read = vi.spyOn(store, 'getMeta'),
    write = vi.spyOn(store, 'setMeta')
  await copies.capture(fs, paths)
  expect(read.mock.calls.filter(([key]) => key === EDIT_COPIES_KEY)).toHaveLength(2)
  expect(write.mock.calls.filter(([key]) => key === EDIT_COPIES_KEY)).toHaveLength(1)
  expect((await copies.list(store)).map((copy) => copy.path).sort()).toEqual(
    ['retained.md', ...paths].sort()
  )
})

it('preserves a large placement batch without rewriting every accumulated byte for each file', async () => {
  const fs = new MemoryFileSystem(),
    store = new MemoryStateStore(),
    copies = new EditCopies()
  copies.expect(['connection'])
  copies.register('connection', store, () => true)
  const paths = Array.from({ length: 4 }, (_, i) => 'plugin-' + i + '.js')
  for (const path of paths) await fs.writeAtomic(path, new Uint8Array(65536).fill(255), 10)
  const write = vi.spyOn(store, 'setMeta')
  await copies.capture(fs, paths)
  expect((await copies.list(store)).map((one) => one.path)).toEqual(paths)
  const written = write.mock.calls
    .filter(([key]) => key === EDIT_COPIES_KEY)
    .reduce((total, [, value]) => total + value.length, 0)
  expect(written).toBeLessThan(4 * 65536 * 6)
})

it('never reads excluded installed code while preserving a directory placement', async () => {
  const fs = new MemoryFileSystem(),
    copies = new EditCopies()
  await fs.writeAtomic('.obsidian/plugins/abele/main.js', new Uint8Array([1]), 10)
  copies.expect(['connection'])
  copies.register('connection', new MemoryStateStore(), () => false)
  const read = vi.spyOn(fs, 'read')
  await copies.capture(fs, ['.obsidian/plugins/abele/main.js'])
  expect(read).not.toHaveBeenCalled()
})

it('persists an independent immutable copy for every destination before a fast result replaces it', async () => {
  const fs = new MemoryFileSystem(),
    a = new MemoryStateStore(),
    b = new MemoryStateStore()
  const copies = new EditCopies()
  copies.expect(['fast', 'offline'])
  copies.register('fast', a, () => true)
  copies.register('offline', b, () => true)
  await fs.writeAtomic('sample.md', new TextEncoder().encode('local edit'), 12)
  await copies.capture(fs, ['sample.md'])
  await fs.writeAtomic('sample.md', new TextEncoder().encode('server result'), 20)
  const first = await copies.list(a),
    second = await copies.list(b)
  expect(first[0].bytes).toEqual([...new TextEncoder().encode('local edit')])
  expect(second[0].bytes).toEqual(first[0].bytes)
  first[0].bytes[0] = 0
  expect((await copies.list(a))[0].bytes).toEqual(second[0].bytes)
  expect((await copies.list(b))[0].mtime).toBe(12)
  expect((await copies.list(b))[0].base).toBeNull()
})

it('holds placement when retained immutable bytes no longer match their recorded hash', async () => {
  const fs = new MemoryFileSystem(),
    store = new MemoryStateStore(),
    copies = new EditCopies()
  copies.expect(['destination'])
  copies.register('destination', store, () => true)
  await fs.writeAtomic('sample.md', new Uint8Array([1]), 10)
  await copies.capture(fs, ['sample.md'])
  const retained = await copies.list(store)
  retained[0].bytes = [2]
  await store.setMeta(EDIT_COPIES_KEY, JSON.stringify(retained))
  await expect(copies.capture(fs, ['sample.md'])).rejects.toThrow(/recovery|integrity/)
  expect(await fs.read('sample.md')).toEqual(new Uint8Array([1]))
})

it('retains simultaneous edits on unrelated paths in each destination', async () => {
  const fs = new MemoryFileSystem(),
    store = new MemoryStateStore(),
    copies = new EditCopies()
  copies.expect(['destination'])
  copies.register('destination', store, () => true)
  await fs.writeAtomic('one.md', new Uint8Array([1]), 10)
  await fs.writeAtomic('two.md', new Uint8Array([2]), 10)
  await Promise.all([copies.capture(fs, ['one.md']), copies.capture(fs, ['two.md'])])
  expect((await copies.list(store)).map((copy) => copy.path).sort()).toEqual(['one.md', 'two.md'])
})

it('refuses replacement if an expected destination cannot persist its copy', async () => {
  const fs = new MemoryFileSystem(),
    copies = new EditCopies()
  copies.expect(['unready'])
  await fs.writeAtomic('sample.md', new Uint8Array([1]), 10)
  await expect(copies.capture(fs, ['sample.md'])).rejects.toThrow(/capture/)
  expect(await fs.read('sample.md')).toEqual(new Uint8Array([1]))
})

it('permits offload of a large acknowledged mobile file without a fresh read or another preserved copy', async () => {
  const fs = new MemoryFileSystem(),
    store = new MemoryStateStore(),
    copies = new EditCopies()
  const size = 200 * 1024 * 1024,
    sha = 'a'.repeat(64),
    path = 'sample.bin'
  const base = {
    path,
    wirePath: path,
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha,
    size,
    mtime: 10,
  }
  await store.put(base)
  fs.stat = async () => ({ path, size, mtime: 10 })
  fs.fingerprint = vi.fn(async () => {
    throw new Error('Bounded file reads are unavailable; the fallback limit is 50 MiB')
  })
  const receipt = vi.fn(async () => ({ size, sha, mtime: 10 }))
  const open = vi.fn(async () => {
    throw new Error('Unexpected large preservation read')
  })
  fs.openRead = open
  copies.expect(['sample'])
  copies.register('sample', store, () => true)
  await copies.capture(fs, [path], receipt)
  expect(receipt).toHaveBeenCalledWith(path)
  expect(fs.fingerprint).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(await copies.list(store)).toEqual([])
  receipt.mockRejectedValueOnce(new Error('Recorded file changed; file kept'))
  await expect(copies.capture(fs, [path], receipt)).rejects.toThrow('Recorded file changed')
  expect(await store.get(path)).toEqual(base)
})
