import { describe, expect, it, vi } from 'vitest'
import { createBooksApi } from '@/scripting/booksApi'
import { BookPlaces } from '@/reader/positions'

const places = () => new BookPlaces({ read: async () => '{}', write: async () => {} })

describe('script reader books', () => {
  it('removes aborted subscriptions from plugin disposal rather than retaining closed views', () => {
    const pending = new Set<() => void>()
    const removed = vi.fn()
    const host = {
      files: () => [],
      places: places(),
      getFile: () => null,
      leaves: () => [],
      newLeaf: () => ({ view: {}, setViewState: async () => {} }),
      reveal: async () => {},
      onDispose: (stop: () => void) => {
        pending.add(stop)
        return () => {
          pending.delete(stop)
          removed()
        }
      },
    }
    for (let n = 0; n < 50; n++) {
      const api = createBooksApi(host)
      const controller = new AbortController()
      const callback = vi.fn()
      const stop = api.onChange(callback, { signal: controller.signal })
      expect(pending.size).toBe(1)
      controller.abort()
      stop()
      expect(pending.size).toBe(0)
      host.places.invalidate()
      expect(callback).not.toHaveBeenCalled()
    }
    expect(removed).toHaveBeenCalledTimes(50)
  })

  it('invalidates a tab-dependent highlight count on reader closure and removes the layout listener on abort', async () => {
    const file = { path: 'Sample/book.pdf', extension: 'pdf' }
    let open = true
    const readerListeners = new Set<() => void>()
    const api = createBooksApi({
      files: () => [file],
      places: places(),
      getFile: () => file,
      leaves: () => [],
      newLeaf: () => ({ view: {}, setViewState: async () => {} }),
      reveal: async () => {},
      highlightCount: () => (open ? 5 : null),
      onReadersChanged: (notify: () => void) => {
        readerListeners.add(notify)
        return () => {
          readerListeners.delete(notify)
        }
      },
    })
    const controller = new AbortController()
    let displayedCount: number | null = (await api.get(file.path))!.highlightCount
    const change = vi.fn(async () => {
      displayedCount = (await api.get(file.path))!.highlightCount
    })
    api.onChange(change, { signal: controller.signal })
    expect(displayedCount).toBe(5)
    open = false
    for (const notify of readerListeners) notify()
    await vi.waitFor(() => {
      expect(change).toHaveBeenCalledOnce()
      expect(displayedCount).toBeNull()
    })
    controller.abort()
    expect(readerListeners.size).toBe(0)
  })

  it('queries files, opens a dedicated tab and observes local changes until aborted', async () => {
    const store = places()
    const file = { path: 'Sample/book.pdf', extension: 'pdf' }
    const open = vi.fn(async () => {})
    const reveal = vi.fn(async () => {})
    const leaf = { setViewState: open, view: {}, setEphemeralState: vi.fn() }
    const api = createBooksApi({
      files: () => [file],
      places: store,
      getFile: (path) => (path === file.path ? file : null),
      leaves: () => [],
      newLeaf: () => leaf,
      reveal,
    })
    expect((await api.list())[0].position).toBeNull()
    const controller = new AbortController()
    const change = vi.fn()
    api.onChange(change, { signal: controller.signal })
    await store.set('path:Sample/book.pdf', { path: file.path, cfi: 'p', fraction: 0 })
    expect(change).toHaveBeenCalledTimes(1)
    controller.abort()
    await store.set('path:Sample/book.pdf', { path: file.path, cfi: 'q', fraction: 1 })
    expect(change).toHaveBeenCalledTimes(1)
    expect((await api.get(file.path))?.finished).toBe(true)
    await api.open(file.path)
    expect(open).toHaveBeenCalledWith({
      type: 'abele-book',
      state: { file: file.path },
      active: true,
    })
    expect(reveal).toHaveBeenCalledWith(leaf)
    await store.flush()
  })
})
