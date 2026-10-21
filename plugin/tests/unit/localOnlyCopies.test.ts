import { expect, it } from 'vitest'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { LocalOnlyCopies, LOCAL_ONLY_COPIES } from '@/sync/localOnlyCopies'

it('follows a kept identity into another shared folder and through folder renames after restart', () => {
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
  restarted.releaseSelected(id, ['Unrelated'])
  expect(restarted.has('Other shared/Moved.md')).toBe(true)
  expect((local.loadLocalStorage(LOCAL_ONLY_COPIES) as { id: string }[])[0].id).toBe(saved[0].id)
  restarted.releaseSelected(id, ['Other shared'])
  expect(
    new LocalOnlyCopies(TokenConnectionRegistry.open(local)).has('Other shared/Moved.md')
  ).toBe(false)
})
