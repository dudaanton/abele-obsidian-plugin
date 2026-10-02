import { afterEach, expect, it, vi } from 'vitest'
import { inspectDeckSlide } from '@/slides/inspection'
import { parseDeck } from '@/slides/core/markdown'
import { useVault } from '../helpers/testEnv'

vi.mock('@/markdown/renderUntrusted', () => ({
  renderUntrustedMarkdown: async (target: HTMLElement, source: string) => {
    const heading = target.ownerDocument.createElement('h1')
    heading.textContent = source.replace(/^# /, '')
    target.append(heading)
  },
}))
afterEach(() => document.body.replaceChildren())

it('inspects slide three under its own numbered CSS rather than first-slide CSS', async () => {
  const app = useVault([])
  const deck = parseDeck(
    '# First\n---\n# Second\n---\n# Third\n```css\n[data-slide="1"] h1 { font-size: 16px }\n[data-slide="3"] h1 { font-size: 900px }\n```'
  )
  const result = await inspectDeckSlide(
    app as never,
    'sample-deck.md',
    deck,
    2,
    async (root, report) => ({
      number: root.querySelector<HTMLElement>('.abele-slide')!.dataset.slide,
      font: getComputedStyle(root.querySelector('h1')!).fontSize,
      report: report.slide,
    })
  )
  expect(result).toEqual({ number: '3', font: '900px', report: 3 })
  expect(document.querySelector('.abele-deck-inspection-host')).toBeNull()
})
