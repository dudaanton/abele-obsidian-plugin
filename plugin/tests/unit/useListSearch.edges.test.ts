import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { SEARCH_DELAY_MS, useListSearch } from '@/composables/useListSearch'
import { useVault } from '../helpers/testEnv'

interface Row {
  path: string
  title: string
}
const row = (n: number): Row => ({ path: `Notes/Row ${n}.md`, title: `Title ${n}` })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('list search — bounded reads and concurrent changes', () => {
  let app: ReturnType<typeof useVault>
  let scope: EffectScope
  const source = ref<Row[]>([])
  const search = () =>
    scope.run(() =>
      useListSearch(() => source.value, {
        pathOf: (r) => r.path,
        textOf: (r, body) => `${r.title}\n${body ?? 'fallback'}`,
      })
    )!
  const type = async (s: ReturnType<typeof search>, query: string) => {
    s.query.value = query
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    await flushPromises()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    scope = effectScope()
    source.value = [row(0), row(1)]
    app = useVault(
      source.value.map((r) => ({
        path: r.path,
        content: 'Orchard apples',
        frontmatter: { secret: 'properties-only' },
      }))
    )
  })
  afterEach(() => {
    scope.stop()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('does no IO while closed, debounces the latest query and returns a copy of the source', async () => {
    const s = search()
    expect(s.results.value).toEqual(source.value)
    expect(s.results.value).not.toBe(source.value)
    s.query.value = 'absent'
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    expect(s.terms.value).toEqual([])
    expect(app.stats.read).toBe(0)
    s.close()
    s.toggle()
    await flushPromises()
    s.query.value = 'wrong'
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS - 1)
    s.query.value = 'APPLES orchard'
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS - 1)
    expect(s.terms.value).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(s.terms.value).toEqual(['apples', 'orchard'])
    expect(s.results.value).toEqual(source.value)
    expect(app.stats.read).toBe(2)
    await type(s, 'properties-only')
    expect(s.results.value).toEqual([])
  })

  it('reads at most fifty notes at once, then advances by completed batches', async () => {
    source.value = Array.from({ length: 101 }, (_, i) => row(i))
    app = useVault(source.value.map((r) => ({ path: r.path })))
    const pending: ReturnType<typeof deferred<string>>[] = []
    const read = vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
      const d = deferred<string>()
      pending.push(d)
      return d.promise
    })
    const s = search()
    s.toggle()
    await nextTick()
    expect(read).toHaveBeenCalledTimes(50)
    pending.slice(0, 49).forEach((d) => d.resolve('apples'))
    await flushPromises()
    expect(read).toHaveBeenCalledTimes(50)
    pending[49].resolve('apples')
    await flushPromises()
    expect(read).toHaveBeenCalledTimes(100)
    pending.slice(50).forEach((d) => d.resolve('apples'))
    await flushPromises()
    expect(read).toHaveBeenCalledTimes(101)
    pending[100].resolve('pears')
    await flushPromises()
    await type(s, 'pears')
    expect(s.results.value.map((r) => r.path)).toEqual([row(100).path])
    expect(read).toHaveBeenCalledTimes(101)
  })

  it('keeps fallback text for missing files and failed reads, retrying failures on the next query', async () => {
    source.value.push({ path: 'Missing.md', title: 'Lost fallback' })
    const read = vi.spyOn(app.vault, 'cachedRead').mockRejectedValue(new Error('unavailable'))
    const s = search()
    s.toggle()
    await flushPromises()
    await type(s, 'fallback')
    expect(s.results.value).toEqual(source.value)
    read.mockResolvedValue('Recovered orchard')
    await type(s, 'recovered')
    expect(s.results.value.map((r) => r.path)).toEqual([row(0).path, row(1).path])
  })

  it('ignores the result of an older read pass that finishes after the replacement list', async () => {
    source.value = [row(0)]
    const old = deferred<string>()
    const newer = deferred<string>()
    vi.spyOn(app.vault, 'cachedRead')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise)
    const s = search()
    s.toggle()
    await nextTick()
    // Same raw entry, new list: a second pass replaces the first without changing its key.
    source.value = [...source.value]
    await nextTick()
    newer.resolve('fresh pears')
    await flushPromises()
    old.resolve('obsolete apples')
    await flushPromises()
    await type(s, 'fresh')
    expect(s.results.value).toEqual(source.value)
    await type(s, 'obsolete')
    expect(s.results.value).toEqual([])
  })

  it('cancels pending typing and reads on close, and reopening does not inherit old terms', async () => {
    const old = deferred<string>()
    vi.spyOn(app.vault, 'cachedRead').mockReturnValueOnce(old.promise).mockResolvedValue('fresh')
    const s = search()
    s.toggle()
    await nextTick()
    s.query.value = 'obsolete'
    await nextTick()
    s.close()
    old.resolve('obsolete')
    await flushPromises()
    s.toggle()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    expect(s.query.value).toBe('')
    expect(s.terms.value).toEqual([])
    await type(s, 'obsolete')
    expect(s.results.value).toEqual([])
  })

  // BUG: a completed read is stamped with the file's current mtime, not the mtime when
  // reading started. Editing during cachedRead can cache old text as the new version forever.
  it.fails('rereads a note edited while its earlier text was still being read', async () => {
    source.value = [row(0)]
    const old = deferred<string>()
    const read = vi
      .spyOn(app.vault, 'cachedRead')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue('fresh pears')
    const s = search()
    s.toggle()
    await nextTick()
    const file = app.vault.getFileByPath(row(0).path)!
    await app.vault.modify(file, 'fresh pears')
    file.stat.mtime++
    old.resolve('obsolete apples')
    await flushPromises()
    await type(s, 'fresh')
    expect(s.results.value.map((r) => r.path)).toEqual([row(0).path])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('caches by raw item and mtime, rereads only the changed note and stops the typing timer on disposal', async () => {
    const s = search()
    s.toggle()
    await flushPromises()
    app.resetStats()
    source.value = [...source.value]
    await flushPromises()
    expect(app.stats.read).toBe(0)
    const file = app.vault.getFileByPath(row(1).path)!
    await app.vault.modify(file, 'new pears')
    file.stat.mtime++
    await type(s, 'pears')
    expect(app.stats.read).toBe(1)
    expect(s.results.value.map((r) => r.path)).toEqual([row(1).path])
    s.query.value = 'unfinished'
    await nextTick()
    scope.stop()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    expect(s.terms.value).toEqual(['pears'])
  })
})
