import { describe, expect, it, vi } from 'vitest'
vi.mock('obsidian', async (original) => {
  class StringValue {
    constructor(private value: unknown) {}
    toString() {
      return String(this.value)
    }
    isTruthy() {
      return !!this.value
    }
  }
  class ListValue {
    private items: StringValue[]
    constructor(values: unknown[]) {
      this.items = values.map((v) => new StringValue(v))
    }
    length() {
      return this.items.length
    }
    get(i: number) {
      return this.items[i]
    }
    isTruthy() {
      return this.items.length > 0
    }
  }
  return { ...(await original<object>()), StringValue, ListValue, NullValue: class {} }
})
import { mapRows } from '@/bases/mapRows'
import { ListValue, StringValue, type BasesEntry, type BasesPropertyId } from 'obsidian'

describe('Bases map adapter', () => {
  const selectors = { coordinates: 'formula.position' as BasesPropertyId, icon: null, color: null }
  it('uses evaluated native rows and isolates formula failures without writes', () => {
    const row = (name: string, throws = false) =>
      ({
        file: { path: `${name}.md`, basename: name },
        getValue: () => {
          if (throws) throw Error('formula')
          return new ListValue([0, 12])
        },
      }) as unknown as BasesEntry
    const result = mapRows([row('Sample'), row('Broken', true)], selectors, [], String)
    expect(result.places).toMatchObject([{ path: 'Sample.md', lat: 0, lon: 12 }])
    expect(result.skipped).toMatchObject([{ path: 'Broken.md', reason: 'formula-error' }])
  })
  it('considers only the first twenty properties before hiding marker properties', () => {
    const order = Array.from({ length: 25 }, (_, i) => `note.p${i}` as BasesPropertyId)
    const row = {
      file: { path: 'Sample.md', basename: 'Sample' },
      getValue: (id: string) => new StringValue(id === selectors.coordinates ? '1, 2' : id),
    } as unknown as BasesEntry
    const result = mapRows([row], selectors, [selectors.coordinates, ...order], String)
    expect(result.places[0].properties).toHaveLength(19)
    expect(result.places[0].properties.at(-1)?.name).toBe('note.p18')
  })
})
