import { beforeEach, expect, it, vi } from 'vitest'
import * as connection from '@/sync/connection'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'

vi.mock('@/sync/connection', async (original) => {
  const actual = await original<typeof import('@/sync/connection')>()
  return { ...actual, selectiveProblem: vi.fn(actual.selectiveProblem) }
})

function local() {
  const data = new Map<string, unknown>()
  return {
    data,
    loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
}
const validations = () => vi.mocked(connection.selectiveProblem).mock.calls.length

beforeEach(() => vi.mocked(connection.selectiveProblem).mockClear())

it('validates the stored registry once for repeated reads', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store)
  registry.add()
  registry.records()
  const before = validations()
  for (let i = 0; i < 10; i++) {
    registry.records()
    void registry.selectedId
  }
  expect(validations()).toBe(before)
})

it('reads every write through any registry over the same storage', () => {
  const store = local(),
    first = TokenConnectionRegistry.open(store),
    second = TokenConnectionRegistry.open(store)
  const one = first.add()
  expect(second.records().map((record) => record.id)).toEqual([one])
  const two = second.add()
  expect(first.records().map((record) => record.id)).toEqual([one, two])
  first.select(two)
  expect(second.selectedId).toBe(two)
  second.setPaused(one, true)
  expect(first.records()[0].paused).toBe(true)
})

it('notices a document stored around the registry and fails the same way on bad input', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store)
  const id = registry.add()
  registry.records()
  const doc = store.loadLocalStorage(TOKEN_REGISTRY_KEY) as { records: { paused: boolean }[] }
  doc.records[0].paused = true
  store.saveLocalStorage(TOKEN_REGISTRY_KEY, doc)
  expect(registry.records()[0]).toMatchObject({ id, paused: true })
  store.saveLocalStorage(TOKEN_REGISTRY_KEY, { ...doc, version: 3 })
  expect(() => registry.records()).toThrow(/requires recovery/)
  expect(() => registry.records()).toThrow(/requires recovery/)
})

it('hands out copies a caller cannot use to change the remembered document', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store)
  const id = registry.add()
  registry.records()[0].paused = true
  expect(registry.records()[0]).toMatchObject({ id, paused: false })
})

it('answers an ownership check without copying the registry, and sees later writes', () => {
  const store = local(),
    registry = TokenConnectionRegistry.open(store)
  const id = registry.add()
  registry.records()
  const parse = vi.spyOn(JSON, 'parse')
  try {
    for (let i = 0; i < 100; i++) expect(registry.hasRecord((one) => one.id === id)).toBe(true)
    // Ownership is checked at every sync effect; copying the whole registry each time is the cost.
    expect(parse).not.toHaveBeenCalled()
  } finally {
    parse.mockRestore()
  }
  registry.forget(id)
  expect(registry.hasRecord((one) => one.id === id)).toBe(false)
})
