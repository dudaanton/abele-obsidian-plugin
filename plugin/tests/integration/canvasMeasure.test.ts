import { afterEach, expect, it, vi } from 'vitest'
import { MarkdownRenderer, type App } from 'obsidian'
import { renderedCard } from '@/canvas/measureAdapter'
import { buildFakeVault } from '../helpers/fakeVault'
const node = {
  id: 'sample',
  type: 'text' as const,
  text: '# Sample',
  x: 0,
  y: 0,
  width: 200,
  height: 600,
}
const app = () => buildFakeVault([]) as unknown as App
afterEach(() => vi.restoreAllMocks())
it('measures real card DOM with the view CSS and cleans its host', async () => {
  const render = vi
    .spyOn(MarkdownRenderer, 'render')
    .mockImplementation(async (_app, _text, el) => {
      expect(el.classList.contains('abele-canvas-card')).toBe(true)
      expect(el.classList.contains('markdown-rendered')).toBe(true)
      Object.defineProperty(el, 'scrollHeight', { get: () => 60 })
      Object.defineProperty(el, 'scrollWidth', { get: () => parseFloat(el.style.width) })
    })
  const card = await renderedCard(app(), node, 'sample.canvas', () => true)
  try {
    expect(render).toHaveBeenCalledOnce()
    expect(card.measure(node)).toMatchObject({
      width: 200,
      height: 93,
      contentWidth: 168,
      contentHeight: 60,
    })
    expect(card.measure({ ...node, styleAttributes: { shape: 'diamond' } }).height).toBeGreaterThan(
      120
    )
  } finally {
    card.release()
  }
  expect(document.querySelector('.abele-canvas-cards')).toBeNull()
})
it('releases the host when rendering fails', async () => {
  vi.spyOn(MarkdownRenderer, 'render').mockRejectedValue(new Error('Sample renderer failure'))
  await expect(renderedCard(app(), node, 'sample.canvas', () => true)).rejects.toThrow(
    'renderer failure'
  )
  expect(document.querySelector('.abele-canvas-cards')).toBeNull()
})
it('refuses media, inaccessible linked content, and cancellation before rendering', async () => {
  const render = vi.spyOn(MarkdownRenderer, 'render')
  await expect(
    renderedCard(app(), { ...node, text: '![[sample-note]]' }, 'sample.canvas', () => true)
  ).rejects.toThrow('embedded')
  await expect(
    renderedCard(app(), { ...node, type: 'file', file: 'sample.md' }, 'sample.canvas', () => false)
  ).rejects.toThrow('outside scope')
  const controller = new AbortController()
  controller.abort()
  await expect(
    renderedCard(app(), node, 'sample.canvas', () => true, controller.signal)
  ).rejects.toThrow()
  expect(render).not.toHaveBeenCalled()
})
