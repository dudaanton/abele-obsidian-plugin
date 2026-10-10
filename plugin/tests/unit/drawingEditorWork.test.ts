import { afterEach, expect, it, vi } from 'vitest'
import { drawingEmbedsInEditor } from '@/drawing/embed'

let destroy: (() => void) | undefined
afterEach(() => {
  destroy?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('does not search pictures on typing, but finds inserted embeds and changed links', async () => {
  vi.useFakeTimers()
  const contentDOM = document.createElement('div')
  const dom = document.createElement('div')
  const queries = vi.spyOn(contentDOM, 'querySelectorAll')
  const link = vi.fn(() => null)
  let path = 'sample.md'
  const plugin = drawingEmbedsInEditor(
    { metadataCache: { getFirstLinkpathDest: link } } as never,
    () => path
  )({ dom, contentDOM } as never)
  destroy = plugin.destroy
  await vi.advanceTimersByTimeAsync(20)
  queries.mockClear()
  for (let i = 0; i < 20; i++) {
    contentDOM.append(document.createTextNode('word'))
    plugin.update()
    await vi.advanceTimersByTimeAsync(20)
  }
  expect(queries).toHaveBeenCalledTimes(0)
  const embed = contentDOM.appendChild(document.createElement('span'))
  embed.className = 'internal-embed'
  embed.setAttribute('src', 'sample.svg')
  await vi.advanceTimersByTimeAsync(20)
  expect(link).toHaveBeenCalledWith('sample.svg', 'sample.md')
  embed.setAttribute('src', 'other.svg')
  await vi.advanceTimersByTimeAsync(20)
  expect(link).toHaveBeenCalledWith('other.svg', 'sample.md')
  path = 'other.md'
  plugin.update()
  await vi.advanceTimersByTimeAsync(20)
  expect(link).toHaveBeenLastCalledWith('other.svg', 'other.md')
})
