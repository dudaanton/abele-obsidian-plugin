import { expect, it, vi } from 'vitest'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { LocalOnlyCopies, LOCAL_ONLY_COPIES } from '@/sync/localOnlyCopies'

it('follows a kept identity into another shared folder and through folder renames after restart', async () => {
  const values = new Map<string, unknown>()
  const local = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  const registry = TokenConnectionRegistry.open(local)
  const id = registry.add()
  registry.storage(id).saveLocalStorage('abele-sync-token-state:local-only', ['Old/Kept.md'])
  const copies = new LocalOnlyCopies(registry)
  copies.renamed('Old/Kept.md', 'Shared/Moved.md')
  expect(copies.has('Shared/Moved.md')).toBe(true)
  expect(copies.has('Old/Kept.md')).toBe(false)
  const saved = local.loadLocalStorage(LOCAL_ONLY_COPIES) as { id: string; path: string }[]
  const restarted = new LocalOnlyCopies(TokenConnectionRegistry.open(local))
  restarted.renamed('Shared', 'Other shared')
  expect(restarted.has('Other shared/Moved.md')).toBe(true)
  expect(restarted.has('Shared/Moved.md')).toBe(false)
  await restarted.releaseSelected(id, ['Unrelated'])
  expect(restarted.has('Other shared/Moved.md')).toBe(true)
  expect((local.loadLocalStorage(LOCAL_ONLY_COPIES) as { id: string }[])[0].id).toBe(saved[0].id)
  await expect(
    restarted.releaseSelected(id, ['Other shared'], async () => {
      throw new Error('Ledger unavailable')
    })
  ).rejects.toThrow('Ledger unavailable')
  expect(restarted.has('Other shared/Moved.md')).toBe(true)
  const retire = vi.fn(async (held: (path: string) => boolean) => {
    expect(held('Other shared/Moved.md')).toBe(true)
    expect(restarted.has('Other shared/Moved.md')).toBe(true)
  })
  await restarted.releaseSelected(id, ['Other shared'], retire)
  expect(retire).toHaveBeenCalledOnce()
  expect(
    new LocalOnlyCopies(TokenConnectionRegistry.open(local)).has('Other shared/Moved.md')
  ).toBe(false)
})

it('retires a deleted kept identity durably so restart and a later ordinary file are not fenced', async () => {
  const values = new Map<string, unknown>()
  const local = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  const registry = TokenConnectionRegistry.open(local),
    id = registry.add()
  registry.storage(id).saveLocalStorage('abele-sync-token-state:local-only', ['Old/Kept.md'])
  const copies = new LocalOnlyCopies(registry)
  copies.renamed('Old/Kept.md', 'Shared/Kept.md')
  copies.deleted('Shared/Kept.md')
  const restarted = new LocalOnlyCopies(TokenConnectionRegistry.open(local))
  await expect(restarted.assertPublishSafe(async () => false)).resolves.toBeUndefined()
  expect(restarted.has('Shared/Kept.md')).toBe(false)
})

it('allows explicitly forgetting a missing copy after delete persistence failed, but refuses an existing file', async () => {
  const values = new Map<string, unknown>()
  let broken = false
  const local = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      if (broken) throw new Error('Storage unavailable')
      values.set(key, structuredClone(value))
    },
  }
  const registry = TokenConnectionRegistry.open(local),
    id = registry.add()
  registry.storage(id).saveLocalStorage('abele-sync-token-state:local-only', ['Sample/Kept.md'])
  const copies = new LocalOnlyCopies(registry)
  broken = true
  expect(() => copies.deleted('Sample/Kept.md')).toThrow()
  const restarted = new LocalOnlyCopies(TokenConnectionRegistry.open(local))
  const report = vi.fn()
  await expect(restarted.assertPublishSafe(async () => false, report)).rejects.toThrow('kept-copy')
  expect(report).toHaveBeenCalledWith(['Sample/Kept.md'])
  await expect(restarted.forgetMissing('Sample/Kept.md', async () => true)).rejects.toThrow(
    'exists'
  )
  broken = false
  await restarted.forgetMissing('Sample/Kept.md', async () => false)
  await expect(
    new LocalOnlyCopies(TokenConnectionRegistry.open(local)).assertPublishSafe(async () => false)
  ).resolves.toBeUndefined()
})

it.each(['throw', 'lost-write'])(
  'keeps a moved copy fenced when identity storage has a %s failure',
  async (failure) => {
    const values = new Map<string, unknown>()
    let broken = false
    const local = {
      loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
      saveLocalStorage: (key: string, value: unknown) => {
        if (broken && key === LOCAL_ONLY_COPIES) {
          if (failure === 'throw') throw new Error('Storage unavailable')
          return
        }
        values.set(key, structuredClone(value))
      },
    }
    const registry = TokenConnectionRegistry.open(local)
    const id = registry.add()
    registry.storage(id).saveLocalStorage('abele-sync-token-state:local-only', ['Old/Kept.md'])
    const copies = new LocalOnlyCopies(registry)
    broken = true
    expect(() => copies.renamed('Old/Kept.md', 'Shared/Kept.md')).toThrow()
    expect(copies.has('Shared/Kept.md')).toBe(true)
    copies.refresh()
    expect(copies.has('Shared/Kept.md')).toBe(true)
    const restarted = new LocalOnlyCopies(TokenConnectionRegistry.open(local))
    await expect(
      restarted.assertPublishSafe(async (path) => path === 'Shared/Kept.md')
    ).rejects.toThrow('kept-copy')
    broken = false
    copies.renamed('Shared/Kept.md', 'Shared/Again.md')
    expect(copies.has('Shared/Again.md')).toBe(true)
    expect(new LocalOnlyCopies(TokenConnectionRegistry.open(local)).has('Shared/Again.md')).toBe(
      true
    )
    await expect(
      new LocalOnlyCopies(TokenConnectionRegistry.open(local)).assertPublishSafe(
        async (path) => path === 'Shared/Again.md'
      )
    ).resolves.toBeUndefined()
  }
)
