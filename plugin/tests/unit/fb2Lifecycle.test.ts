import { afterEach, expect, it, vi } from 'vitest'
import { buildFb2 } from '../fixtures/books/otherFormats'

afterEach(() => vi.restoreAllMocks())

it('allocates no stylesheet URL on import and releases every book URL on close', async () => {
  const create = vi.spyOn(URL, 'createObjectURL')
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const { makeFB2 } = await import('@/vendor/foliate-js/fb2.js')
  expect(create).not.toHaveBeenCalled()
  const book = await makeFB2(new Blob([buildFb2()]))
  expect(book.sections.length).toBeGreaterThan(0)
  const page = book.sections[0].createDocument()
  expect(page.querySelector('style')?.textContent).toContain('text-indent: 1em')
  const urls = create.mock.results.map((result) => result.value)
  expect(urls.length).toBeGreaterThan(0)
  book.destroy()
  expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(urls.sort())
})
