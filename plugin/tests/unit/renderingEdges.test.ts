import { expect, it } from 'vitest'
import { placeDiagram } from '@/mermaid/renderMermaid'
import { guardInlineCode } from '@/markdown/untrustedCode'
import { figureAt, tablePage } from '@/reader/figures'
import { cleanDocument } from '@/reader/bookSafety'
import { frameOptions } from '@/vendor/foliate-js/frame-options.js'

it('cleans a Mermaid SVG before attaching it, keeping labels and local markers', () => {
  const el = document.createElement('div')
  const svg = placeDiagram(el, {
    ok: true,
    renderId: 'abele-mermaid-fixture-d',
    width: 100,
    height: 100,
    svg: '<svg onload="sample()"><a href="java&#10;script:sample()"><text>sample</text></a><path marker-end="url(#arrow)"/><foreignObject><div><img src="https://images.example.org/sample.png" onerror="sample()"><iframe src="https://pages.example.org"></iframe><span>label</span></div></foreignObject></svg>',
  })
  expect(svg.outerHTML).not.toMatch(/onload|onerror|javascript|iframe/i)
  expect(svg.querySelector('path')?.getAttribute('marker-end')).toBe('url(#arrow)')
  expect(svg.querySelector('span')?.textContent).toBe('label')
  // Internet images in replies were not approved for removal.
  expect(svg.querySelector('img')?.getAttribute('src')).toBe(
    'https://images.example.org/sample.png'
  )
})

it('guards a huge README with unmatched backtick runs in bounded time', () => {
  const text = Array.from({ length: 1900 }, (_, i) => 'x' + '`'.repeat(i + 1)).join(' ')
  const start = performance.now()
  expect(guardInlineCode(text)).toBe(text)
  expect(performance.now() - start).toBeLessThan(750)
})

it('does not let the figure viewer fetch an image blocked in the book page', () => {
  const img = document.createElement('img')
  img.src = 'https://images.example.org/sample.png'
  img.getBoundingClientRect = () => ({ width: 400, height: 300 }) as DOMRect
  expect(figureAt(img)).toBeNull()
  img.src = 'blob:sample'
  expect(figureAt(img)?.kind).toBe('image')
})

it('drops comments and processing instructions before table HTML reparsing', () => {
  const doc = new DOMParser().parseFromString(
    '<table><tr><td>sample</td></tr></table>',
    'text/html'
  )
  const table = doc.querySelector('table')!
  table.append(doc.createProcessingInstruction('sample', 'value'), doc.createComment('sample'))
  expect(tablePage(table)).not.toMatch(/<!--|<\?sample/)
})

it('rejects page-type data URLs in later srcset entries', () => {
  const doc = new DOMParser().parseFromString(
    '<img srcset="sample.png 1x, data:text/html;base64,AA 2x">',
    'text/html'
  )
  cleanDocument(doc)
  expect(doc.querySelector('img')?.hasAttribute('srcset')).toBe(false)
})

it('starts book frames without scripting until a platform configures them', () => {
  expect(frameOptions.sandbox).toBe('allow-same-origin')
})
