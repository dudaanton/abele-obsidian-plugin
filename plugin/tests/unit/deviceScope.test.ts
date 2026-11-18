import { expect, it } from 'vitest'
import { deviceScopeMatcher, readDeviceScope, writeDeviceScope } from '@/sync/deviceScope'
import type { ShareItem } from '@/sync/shareSets'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'

const folder: ShareItem = { kind: 'folder', id: 'folder-a', path: 'Garden' }
const file: ShareItem = { kind: 'file', id: 'file-a', path: 'Notes/Plan.md' }

it('keeps selections independent in two token records across registry reopen', () => {
  const records = new Map<string, unknown>()
  const local = {
    loadLocalStorage: (key: string) => structuredClone(records.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      records.set(key, structuredClone(value))
    },
  }
  const registry = TokenConnectionRegistry.open(local)
  const first = registry.add(),
    second = registry.add()
  writeDeviceScope(registry.storage(first), [folder])
  writeDeviceScope(registry.storage(second), [file])
  const reopened = TokenConnectionRegistry.open(local)
  expect(readDeviceScope(reopened.storage(first))).toEqual([folder])
  expect(readDeviceScope(reopened.storage(second))).toEqual([file])
})

it('persists a device selection independently and never widens damaged data', () => {
  const records = new Map<string, unknown>()
  const local = {
    loadLocalStorage: (key: string) => records.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      records.set(key, value)
    },
  }
  expect(readDeviceScope(local)).toBeNull()
  writeDeviceScope(local, [folder, file])
  expect(readDeviceScope(local)).toEqual([folder, file])
  expect(() => writeDeviceScope(local, [])).toThrow()
  const key = [...records.keys()][0]
  records.set(key, { items: 'broken' })
  expect(() => readDeviceScope(local)).toThrow(/scope/i)
})

it('includes selected files, folder descendants and ancestors, without sibling leakage', () => {
  const scope = deviceScopeMatcher([folder, file], () => [])
  expect(scope.ignores('Garden/Flowers.md')).toBe(false)
  expect(scope.ignores('Garden')).toBe(false)
  expect(scope.ignores('Gardening/Flowers.md')).toBe(true)
  expect(scope.ignores('Notes')).toBe(false)
  expect(scope.ignores('Notes/Plan.md')).toBe(false)
  expect(scope.ignores('Notes/Other.md')).toBe(true)
  expect(scope.ignores('Other')).toBe(true)
})

it('keeps a missing or empty group narrow and resolves its current members', () => {
  const group: ShareItem = { kind: 'group', id: 'group-a', path: 'Groups/Reading.md' }
  const scope = deviceScopeMatcher([group], () => ['Groups/Reading.md', 'Books/One.md'])
  expect(scope.ignores('Books/One.md')).toBe(false)
  expect(scope.ignores('Books/Two.md')).toBe(true)
  expect(deviceScopeMatcher([group], () => []).ignores('Other.md')).toBe(true)
  expect(deviceScopeMatcher(null, () => []).ignores('Other.md')).toBe(false)
})
