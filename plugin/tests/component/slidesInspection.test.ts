import { afterEach, expect, it, vi } from 'vitest'
import { inspectDeckSlide, slidePicture } from '@/slides/inspection'
import { parseDeck } from '@/slides/core/markdown'
import { useVault } from '../helpers/testEnv'

const capture = vi.hoisted(() => vi.fn())
vi.mock('dom-to-image-more', () => ({ default: { toPng: capture } }))

vi.mock('@/markdown/renderUntrusted', () => ({
  renderUntrustedMarkdown: async (target: HTMLElement, source: string) => {
    const heading = target.ownerDocument.createElement('h1')
    heading.textContent = source.replace(/^# /, '')
    target.append(heading)
  },
}))
afterEach(() => document.body.replaceChildren())

it('keeps fragmented article paragraphs in flow when exporting the styled clone', async () => {
  const root = document.createElement('div')
  const article = root.appendChild(document.createElement('section'))
  article.className = 'abele-slide-article'
  const body = article.appendChild(document.createElement('div'))
  body.className = 'abele-slide-region-body'
  for (const text of [
    'Long first paragraph',
    'Following paragraph',
    'Sized paragraph',
    'Styled paragraph',
  ])
    body.appendChild(document.createElement('p')).textContent = text
  const paragraph = root.querySelector('p')!
  vi.spyOn(paragraph, 'getClientRects').mockReturnValue([{}, {}] as unknown as DOMRectList)
  const sized = body.querySelectorAll('p')[2]
  sized.style.height = '225px'
  vi.spyOn(sized, 'getClientRects').mockReturnValue([{}, {}] as unknown as DOMRectList)
  Object.defineProperty(body.querySelectorAll('p')[3], 'computedStyleMap', {
    value: () => new Map([['height', '200px']]),
  })
  capture.mockImplementationOnce(async (_root, options) => {
    const clone = root.cloneNode(true) as HTMLElement
    // The image library freezes resolved dimensions, including a fragmented block's height.
    for (const p of clone.querySelectorAll('p')) {
      p.style.height = '200px'
      p.style.blockSize = '200px'
    }
    await options.onclone?.(clone)
    expect(clone.querySelector('p')!.style.height).toBe('')
    expect(clone.querySelector('p')!.style.blockSize).toBe('')
    expect(clone.querySelectorAll('p')[1].style.height).toBe('')
    expect(clone.querySelectorAll('p')[2].style.height).toBe('225px')
    expect(clone.querySelectorAll('p')[3].style.height).toBe('200px')
    return 'data:image/png;base64,AAAA'
  })
  await slidePicture(root, '16:9')
  expect(paragraph.style.height).toBe('')
  expect(sized.style.height).toBe('225px')
})

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
