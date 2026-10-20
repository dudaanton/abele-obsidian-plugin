import { expect, it, vi } from 'vitest'
import { Menu } from 'obsidian'
import { EditorView } from '@codemirror/view'
import { NodeLspDocument } from '@/node/NodeLspDocument'
import { provideLsp } from '@/node/lspContext'
import { nodeLspExtension } from '@/node/lspExtension'

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
