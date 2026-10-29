import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { registerChartCodeblock } from '@/editor/ChartCodeblock'
import { registerMapCodeblock } from '@/editor/MapCodeblock'
import { useVault } from '../helpers/testEnv'
import { slideDividers } from '@/slides/dividers'
import { registerSnippetBlock } from '@/github/snippetCard'

afterEach(() => vi.unstubAllGlobals())

it('prints every code card line without a virtualized editor', () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const code = Array.from({ length: 80 }, (_, i) => `const sampleValue${i} = ${i}`).join('\n')
  registerSnippetBlock((_language, render) => {
    render(
      'url: https://github.com/example/sample/blob/main/sample.ts\nlabel: Sample code\nlang: ts\n---\n' +
        code,
      root,
      { addChild() {} } as unknown as MarkdownPostProcessorContext
    )
  })
  expect(root.querySelector('pre code')?.textContent).toBe(code)
  expect(root.querySelector('.cm-editor')).toBeNull()
})

beforeEach(() => {
  useVault([])
  vi.stubGlobal('createSvg', (tag: string) =>
    document.createElementNS('http://www.w3.org/2000/svg', tag)
  )
  document.body.replaceChildren()
})

it('prints presentation body without source directives when the host supplies no source sections', () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  const marker = root.appendChild(document.createElement('p'))
  marker.textContent = '::slide{layout=title}::'
  root.appendChild(document.createElement('p')).textContent = 'Sample slide body'
  slideDividers(root, {
    frontmatter: { type: 'presentation' },
    getSectionInfo: () => null,
  } as unknown as MarkdownPostProcessorContext)
  expect(root.textContent).not.toContain('::slide')
  expect(root.textContent).toContain('Sample slide body')
})

it.each([false, true])(
  'only paginates the exported presentation itself (embedded: %s)',
  (embedded) => {
    const print = document.body.appendChild(document.createElement('div'))
    print.className = 'print'
    const exported = print.appendChild(document.createElement('div'))
    exported.className = 'markdown-rendered'
    const root = embedded ? exported.appendChild(document.createElement('div')) : exported
    if (embedded) root.className = 'markdown-embed markdown-rendered'
    root.innerHTML =
      '<p>::slide{layout=title}::</p><p>First body</p><hr><p>::slide{layout=content}::</p><p>Second body</p>'
    slideDividers(root, {
      frontmatter: { type: 'presentation' },
      getSectionInfo: () => null,
    } as unknown as MarkdownPostProcessorContext)
    expect(root.querySelectorAll('.abele-print-slide-start')).toHaveLength(embedded ? 0 : 2)
    expect(root.querySelector('hr')).not.toBeNull()
    expect(root.textContent).not.toContain('::slide')
    expect(root.textContent).toContain('First body')
    expect(root.textContent).toContain('Second body')
  }
)

it('draws a complete chart without layout or animation in the hidden export window', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  document.body.style.setProperty('--font-interface', '"Sample Sans", sans-serif')
  registerChartCodeblock((_language, render) => {
    render('title: Sample chart\nseries:\n  - data: [1, 3, 2]', root, {
      addChild() {},
    } as unknown as MarkdownPostProcessorContext)
  })
  expect(root.querySelector('svg path')).not.toBeNull()
  expect(root.firstElementChild?.localName).toBe('svg')
  expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 720 300')
  expect(root.querySelector('canvas')).toBeNull()
  expect(root.textContent).toContain('Sample chart')
})

it('prints map coordinates and routes without relying on network tiles or WebGL', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  registerMapCodeblock((_language, render) => {
    render('points:\n  - lat: 10\n    lon: 20\n    label: Sample place', root, {
      addChild() {},
    } as unknown as MarkdownPostProcessorContext)
  })
  expect(root.textContent).toContain('Sample place')
  expect(root.textContent).toContain('10')
  expect(root.querySelector('svg')).not.toBeNull()
  expect(root.querySelector('canvas')).toBeNull()
})
