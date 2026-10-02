import { expect, it, vi } from 'vitest'
import { PdfInk } from '@/reader/ink/PdfInk'
import { emptyBookModel } from '@/reader/model'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

it('does not redraw ink from an incoming file read that finishes after the book closes', async () => {
  const app = useVault([{ path: 'sample-book.pdf' }])
  const incoming = deferred<unknown>()
  const ink = new PdfInk({
    app,
    file: app.vault.getFileByPath('sample-book.pdf'),
    model: emptyBookModel(),
    pdf: { pageEvents: new EventTarget() },
    engine: {},
    stage: () => null,
    where: () => ({ title: 'Sample' }),
  } as never)
  ;(ink as unknown as { store: unknown }).store = {
    pageOf: () => 0,
    changed: () => incoming.promise,
  }
  const redraw = vi
    .spyOn(ink as unknown as { redraw(index: number): void }, 'redraw')
    .mockImplementation(() => {})
  const pending = (ink as unknown as { fileChanged(path: string): Promise<void> }).fileChanged(
    'sample-ink.md'
  )
  ink.destroy()
  incoming.resolve({ width: 600, height: 800, strokes: [] })
  await pending
  expect(redraw).not.toHaveBeenCalled()
  redraw.mockRestore()
})
