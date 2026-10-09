import { expect, it } from 'vitest'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-core'
import { EditCopies, EDIT_COPIES_KEY } from '@/sync/editCopies'

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
