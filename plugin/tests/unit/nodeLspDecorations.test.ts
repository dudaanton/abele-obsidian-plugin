import { expect, it, vi } from 'vitest'
import { Menu } from 'obsidian'
import { EditorView } from '@codemirror/view'
import { NodeLspDocument } from '@/node/NodeLspDocument'
import { provideLsp } from '@/node/lspContext'
import { nodeLspExtension } from '@/node/lspExtension'
import { codeNavAddon } from '@/github/search/navAddon'
import { appendLspHoverContent } from '@/node/lspMenu'

it('preserves multiline signatures and treats documentation as plain text', () => {
  const content = document.createElement('div')
  const signature = 'function sample(\n  value: string\n): number'
  appendLspHoverContent(content, `${signature}\n\nReturns <sample>.`)
  expect(content.querySelector('pre code')?.textContent).toBe(signature)
  expect(content.querySelector('.abele-lsp-documentation')?.textContent).toBe('Returns <sample>.')
  expect(content.querySelector('sample')).toBeNull()
})
it('includes type documentation in the symbol menu used by long press', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
  doc.supported = true
  vi.spyOn(doc, 'hover').mockResolvedValue('const sample: number\nSample documentation.')
  const remove = provideLsp(root, { document: doc, navigate: () => {} })
  const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const view = new EditorView({
    parent: root,
    doc: 'const sample = 1',
    extensions: [codeNavAddon()],
  })
  try {
    vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
    view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await vi.waitFor(() => expect(shown).toHaveBeenCalled())
    const menu = shown.mock.instances[0] as unknown as {
      items: { disabled: boolean; title: string | DocumentFragment }[]
    }
    const info = menu.items.find((item) => item.disabled)
    expect((info?.title as unknown as DocumentFragment)?.textContent).toContain(
      'Sample documentation.'
    )
    expect((info?.title as DocumentFragment).querySelector('code')?.textContent).toBe(
      'const sample: number'
    )
  } finally {
    view.destroy()
    remove()
    await doc.close()
    root.remove()
    vi.restoreAllMocks()
  }
})

it('renders the hover response with type and documentation', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
  doc.supported = true
  doc.diagnostics = [1, 2].map((severity) => ({
    severity,
    source: severity === 1 ? 'typescript' : 'eslint',
    message: severity === 1 ? 'Sample type error' : 'Sample lint warning',
    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
  }))
  let finish!: (text: string) => void
  const hover = vi.spyOn(doc, 'hover').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const remove = provideLsp(root, { document: doc, navigate: () => {} })
  const view = new EditorView({
    parent: root,
    doc: 'const sample = 1',
    extensions: [nodeLspExtension()],
  })
  try {
    vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 10, bottom: 30 })
    view.contentDOM.querySelector('.cm-line')!.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 10,
        clientY: 20,
      })
    )
    await vi.waitFor(() => expect(hover).toHaveBeenCalled())
    finish('const sample: number\nSample documentation.')
    await vi.waitFor(() =>
      expect(document.querySelector('.abele-lsp-message')?.textContent).toContain(
        'Sample documentation.'
      )
    )
    expect(document.querySelector('.abele-lsp-message')?.textContent).toContain(
      'const sample: number'
    )
    const popup = document.querySelector('.abele-lsp-message')!
    expect([...popup.children].map((child) => child.tagName)).toEqual([
      'DIV',
      'DIV',
      'HR',
      'PRE',
      'DIV',
    ])
    expect(popup.querySelector('.abele-lsp-problem')?.textContent).toBe(
      '●Sample type error · TypeScript'
    )
    expect(popup.querySelector('.abele-lsp-problem__source')?.textContent).toBe(' · TypeScript')
    expect(popup.querySelectorAll('.abele-lsp-problem__dot')).toHaveLength(2)
    expect(
      [...popup.querySelectorAll<HTMLElement>('.abele-lsp-problem__dot')].map(
        (dot) => dot.style.color
      )
    ).toEqual(['var(--text-error)', 'var(--text-warning)'])
    expect(popup.querySelector('pre code')?.textContent).toBe('const sample: number')
    expect(popup.querySelector('.abele-lsp-documentation')?.textContent).toBe(
      'Sample documentation.'
    )
  } finally {
    view.destroy()
    remove()
    await doc.close()
    root.remove()
    vi.restoreAllMocks()
  }
})

it('renders both diagnostic sources, tolerates stale ranges, and clears marks on a new push', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
  doc.supported = true
  doc.diagnostics = [
    {
      source: 'typescript',
      message: 'Sample type error',
      severity: 1,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    },
    {
      source: 'eslint',
      message: 'Sample lint warning',
      severity: 2,
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 10 } },
    },
    {
      source: 'typescript',
      message: 'Stale range',
      range: { start: { line: 20, character: 0 }, end: { line: 20, character: 1 } },
    },
  ]
  const remove = provideLsp(root, { document: doc, navigate: () => {} })
  const view = new EditorView({
    parent: root,
    doc: 'let sample = 1',
    extensions: [nodeLspExtension()],
  })
  try {
    await Promise.resolve()
    expect(view.dom.querySelector('.abele-lsp-error')?.getAttribute('title')).toBe(
      'typescript: Sample type error'
    )
    expect(view.dom.querySelector('.abele-lsp-warning')?.getAttribute('title')).toBe(
      'eslint: Sample lint warning'
    )
    expect(view.dom.querySelector('.abele-lsp-gutter')?.textContent).toContain('●')
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 20, bottom: 30 })
    vi.spyOn(view, 'lineBlockAtHeight').mockReturnValue(view.lineBlockAt(0))
    view.dom
      .querySelector('.abele-lsp-gutter span[title]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(show).toHaveBeenCalled())
    vi.restoreAllMocks()
    doc.diagnostics = []
    for (const listener of doc.listeners) listener()
    expect(view.dom.querySelectorAll('.abele-lsp-error, .abele-lsp-warning')).toHaveLength(0)
  } finally {
    view.destroy()
    remove()
    await doc.close()
    root.remove()
  }
})
