import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { App, TFile } from 'obsidian'
import type { OpenedBook } from '@/reader/openBook'
import { openVaultBook } from '@/reader/vaultBook'
import { forgetBookTexts, loadBookText } from '@/reader/bookText'

vi.mock('@/reader/vaultBook', () => ({ openVaultBook: vi.fn() }))

const app = {
  vault: { readBinary: async () => new ArrayBuffer(0) },
} as unknown as App
const file = (mtime: number): TFile =>
  ({ path: 'sample-book.fb2', basename: 'sample-book', extension: 'fb2', stat: { mtime } }) as TFile
const opened = (): OpenedBook => ({ book: { sections: [] }, destroy: vi.fn() })
const deferred = () => {
  let resolve!: (book: OpenedBook) => void
  let reject!: (error: Error) => void
  const promise = new Promise<OpenedBook>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

beforeEach(() => vi.mocked(openVaultBook).mockReset())
afterEach(() => forgetBookTexts())

it('shares an unchanged book and releases it once on unload', async () => {
  const book = opened()
  vi.mocked(openVaultBook).mockResolvedValue(book)
  const loading = loadBookText(app, file(1))
  expect(loadBookText(app, file(1)) === loading).toBe(true)
  await loading
  expect(book.destroy).not.toHaveBeenCalled()
  forgetBookTexts()
  await Promise.resolve()
  expect(book.destroy).toHaveBeenCalledOnce()
})

it('releases every replaced book instead of losing its resource owner on a file change', async () => {
  const books = Array.from({ length: 6 }, opened)
  for (const [index, book] of books.entries()) {
    vi.mocked(openVaultBook).mockResolvedValueOnce(book)
    await loadBookText(app, file(index))
    for (const prior of books.slice(0, index)) expect(prior.destroy).toHaveBeenCalledOnce()
    expect(book.destroy).not.toHaveBeenCalled()
  }
  forgetBookTexts()
  await Promise.resolve()
  for (const book of books) expect(book.destroy).toHaveBeenCalledOnce()
})

it('releases a replaced book even when its opening finishes after its replacement', async () => {
  const pending = deferred()
  const oldBook = opened()
  const newBook = opened()
  vi.mocked(openVaultBook).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newBook)
  const oldLoading = loadBookText(app, file(1))
  const newLoading = loadBookText(app, file(2))
  await newLoading
  pending.resolve(oldBook)
  await oldLoading
  await Promise.resolve()
  expect(oldBook.destroy).toHaveBeenCalledOnce()
  expect(newBook.destroy).not.toHaveBeenCalled()
  expect(loadBookText(app, file(2)) === newLoading).toBe(true)
})

it.each(['replace', 'unload'] as const)(
  'a failed old opening cannot evict the current book after %s',
  async (action) => {
    const pending = deferred()
    const book = opened()
    vi.mocked(openVaultBook).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(book)
    const oldLoading = loadBookText(app, file(1))
    // Let the first opening reach the deferred source before unload creates a new entry.
    await Promise.resolve()
    if (action === 'unload') forgetBookTexts()
    const currentFile = file(action === 'replace' ? 2 : 1)
    const newLoading = loadBookText(app, currentFile)
    await newLoading
    pending.reject(new Error('Sample opening failed'))
    await expect(oldLoading).rejects.toThrow('Sample opening failed')
    expect(loadBookText(app, currentFile) === newLoading).toBe(true)
    expect(openVaultBook).toHaveBeenCalledTimes(2)
    expect(book.destroy).not.toHaveBeenCalled()
  }
)
