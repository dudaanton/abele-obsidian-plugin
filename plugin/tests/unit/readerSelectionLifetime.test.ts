import { afterEach, expect, it, vi } from 'vitest'
import { BookReading } from '@/reader/BookReading'
import { emptyBookModel } from '@/reader/model'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('releases selection listeners for an EPUB chapter no longer in the renderer', async () => {
  vi.useFakeTimers()
  const first = document.implementation.createHTMLDocument('Sample first page')
  const second = document.implementation.createHTMLDocument('Sample second page')
  let live = [first]
  const reading = Object.assign(Object.create(BookReading.prototype), {
    docIndex: new WeakMap(),
    selectionWatches: new Map(),
    loadGeneration: 0,
    marks: {},
    model: emptyBookModel(),
    engine: { renderer: { getContents: () => live.map((doc) => ({ doc })) } },
  }) as BookReading
  const read = vi
    .spyOn(reading as unknown as { readSelection(doc: Document): void }, 'readSelection')
    .mockImplementation(() => {})
  reading.watchSelection(first, 0)
  live = [second]
  reading.watchSelection(second, 1)
  first.dispatchEvent(new Event('selectionchange'))
  await vi.advanceTimersByTimeAsync(250)
  expect(read).not.toHaveBeenCalled()
  reading.dispose()
})

it('cancels selection callbacks and detaches page listeners when reading is disposed', async () => {
  vi.useFakeTimers()
  const reading = Object.assign(Object.create(BookReading.prototype), {
    docIndex: new WeakMap(),
    selectionWatches: new Map(),
    engine: { renderer: { getContents: () => [] } },
    loadGeneration: 0,
    marks: {},
    model: emptyBookModel(),
  }) as BookReading
  const read = vi
    .spyOn(reading as unknown as { readSelection(doc: Document): void }, 'readSelection')
    .mockImplementation(() => {})
  const doc = document.implementation.createHTMLDocument('Sample page')
  reading.watchSelection(doc, 0)
  doc.dispatchEvent(new Event('selectionchange'))
  reading.dispose()
  await vi.advanceTimersByTimeAsync(250)
  expect(read).not.toHaveBeenCalled()
  doc.dispatchEvent(new Event('selectionchange'))
  await vi.advanceTimersByTimeAsync(250)
  expect(read).not.toHaveBeenCalled()
})
