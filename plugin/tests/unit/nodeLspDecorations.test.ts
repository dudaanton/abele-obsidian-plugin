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
it('renders highlighted markdown without interpreting server HTML', () => {
  const content = document.createElement('div')
  appendLspHoverContent(
    content,
    '```typescript\nconst sample: number\n```\n\nUse `sample`.\n\n- First\n- Second\n\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))'
  )
  expect(content.querySelector('pre code')?.textContent).toBe('const sample: number')
  expect(content.querySelector('pre code span')).not.toBeNull()
  expect(content.textContent).not.toContain('```')
  expect(content.querySelector('.abele-lsp-documentation code')?.textContent).toBe('sample')
  expect(content.querySelectorAll('li')).toHaveLength(2)
  expect(content.querySelector('script, [onclick], a[href^="javascript:"]')).toBeNull()
})

it('keeps link labels readable and permits only safe destinations', () => {
  const content = document.createElement('div')
  appendLspHoverContent(
    content,
    '```ts\nconst sample: number\n```\n\nSee [the `guide`](https://example.invalid/guide) and [unsafe](javascript:alert(1)).'
  )
  const links = content.querySelectorAll('a')
  expect(links[0].textContent).toBe('the guide')
  expect(links[0].querySelector('code')?.textContent).toBe('guide')
  expect(links[0].getAttribute('href')).toBe('https://example.invalid/guide')
  expect(links[1].textContent).toBe('unsafe')
  expect(links[1].hasAttribute('href')).toBe(false)
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
    const token = view.contentDOM
      .querySelector('.cm-line')!
      .appendChild(document.createElement('span'))
    token.textContent = 'sample'
    // A navigation decoration can redraw the token during the same mouse event.
    view.contentDOM.addEventListener('mousemove', () => token.remove(), { once: true })
    token.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 10,
        clientY: 20,
        ctrlKey: true,
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
    // Moving into the scrollable tooltip must still allow key release to dismiss it.
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: popup }))
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    await vi.waitFor(() => expect(document.querySelector('.abele-lsp-message pre')).toBeNull())
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

it('keeps a fast hover response when analysis republishes unchanged diagnostics', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
  doc.supported = true
  vi.spyOn(doc, 'hover').mockImplementation(async () => {
    // A warm server can publish its cached diagnostics before the hover response.
    await Promise.resolve()
    doc.diagnostics = []
    for (const listener of doc.listeners) listener()
    return 'const sample: number'
  })
  const remove = provideLsp(root, { document: doc, navigate: () => {} })
  const view = new EditorView({
    parent: root,
    doc: 'const sample = 1',
    extensions: [nodeLspExtension()],
  })
  try {
    vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 10, bottom: 30 })
    await Promise.resolve()
    view.contentDOM
      .querySelector('.cm-line')!
      .dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20, ctrlKey: true })
      )
    await vi.waitFor(
      () =>
        expect(document.querySelector('.abele-lsp-message pre')?.textContent).toBe(
          'const sample: number'
        ),
      { timeout: 1500 }
    )
  } finally {
    view.destroy()
    remove()
    await doc.close()
    root.remove()
    vi.restoreAllMocks()
  }
})

it.each(['Control', 'Meta', 'Alt'])(
  'requires %s for types, including a key pressed over a stationary symbol',
  async (key) => {
    const root = document.body.appendChild(document.createElement('div'))
    const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
    doc.supported = true
    const hover = vi.spyOn(doc, 'hover').mockResolvedValue('const sample: number')
    const remove = provideLsp(root, { document: doc, navigate: () => {} })
    const view = new EditorView({
      parent: root,
      doc: 'const sample = 1',
      extensions: [nodeLspExtension()],
    })
    try {
      vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
      vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 10, bottom: 30 })
      const move = () =>
        view.contentDOM
          .querySelector('.cm-line')!
          .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20 }))
      // Syntax and diagnostic redraws can replace the token under a stationary pointer.
      const token = view.contentDOM
        .querySelector('.cm-line')!
        .appendChild(document.createElement('span'))
      token.textContent = 'sample'
      token.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20 }))
      token.remove()
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(hover).not.toHaveBeenCalled()
      expect(document.querySelector('.abele-lsp-message')).toBeNull()
      {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            ctrlKey: key === 'Control',
            metaKey: key === 'Meta',
            altKey: key === 'Alt',
          })
        )
        await vi.waitFor(() =>
          expect(document.querySelector('.abele-lsp-message pre')).not.toBeNull()
        )
        document.dispatchEvent(new KeyboardEvent('keyup', { key }))
        await vi.waitFor(() => expect(document.querySelector('.abele-lsp-message')).toBeNull())
      }
      hover.mockClear()
      doc.diagnostics = [
        {
          source: 'typescript',
          message: 'Sample problem',
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
        },
      ]
      for (const listener of doc.listeners) listener()
      move()
      await vi.waitFor(() =>
        expect(document.querySelector('.abele-lsp-problem')?.textContent).toContain(
          'Sample problem'
        )
      )
      expect(hover).not.toHaveBeenCalled()
    } finally {
      view.destroy()
      remove()
      await doc.close()
      root.remove()
      vi.restoreAllMocks()
    }
  }
)

it.each(['keydown', 'keyup'])(
  'handles Option %s when the focused pane stops key propagation',
  async (handledType) => {
    const root = document.body.appendChild(document.createElement('div'))
    const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
    doc.supported = true
    const hover = vi.spyOn(doc, 'hover').mockResolvedValue('const sample: number')
    const remove = provideLsp(root, { document: doc, navigate: () => {} })
    const view = new EditorView({
      parent: root,
      doc: 'const sample = 1',
      extensions: [nodeLspExtension()],
    })
    const handled = vi.fn((event: Event) => event.stopPropagation())
    view.contentDOM.addEventListener(handledType, handled)
    try {
      vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
      vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 10, bottom: 30 })
      view.contentDOM
        .querySelector('.cm-line')!
        .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20 }))
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })
      )
      await vi.waitFor(() => expect(hover).toHaveBeenCalled())
      await vi.waitFor(() =>
        expect(document.querySelector('.abele-lsp-message pre')).not.toBeNull()
      )
      view.contentDOM.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))
      await vi.waitFor(() => expect(document.querySelector('.abele-lsp-message')).toBeNull())
      expect(handled).toHaveBeenCalledOnce()
    } finally {
      view.contentDOM.removeEventListener(handledType, handled)
      view.destroy()
      remove()
      await doc.close()
      root.remove()
      vi.restoreAllMocks()
    }
  }
)

it.each(['Control', 'Meta', 'Alt'])(
  'navigates once with %s without host selection',
  async (key) => {
    const root = document.body.appendChild(document.createElement('div'))
    const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
    doc.supported = true
    const query = vi.spyOn(doc, 'query').mockResolvedValue([
      {
        path: 'definition.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      },
    ])
    const navigate = vi.fn()
    const hostMouseDown = vi.fn((event: MouseEvent) => {
      expect(event.defaultPrevented).toBe(false)
      return true
    })
    const remove = provideLsp(root, { document: doc, navigate })
    const view = new EditorView({
      parent: root,
      doc: 'const sample = 1',
      extensions: [
        nodeLspExtension(),
        codeNavAddon(),
        // Stand in for host selection handling after navigation has declined the event.
        EditorView.domEventHandlers({ mousedown: hostMouseDown }),
      ],
    })
    try {
      vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
      const modifiers = {
        ctrlKey: key === 'Control',
        metaKey: key === 'Meta',
        altKey: key === 'Alt',
      }
      view.contentDOM
        .querySelector('.cm-line')!
        .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...modifiers }))
      expect(view.dom.querySelector('.abele-github-code__definition')?.textContent).toBe('sample')
      const selection = view.state.selection
      for (const type of ['mousedown', 'click', 'contextmenu']) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...modifiers })
        view.contentDOM.querySelector('.cm-line')!.dispatchEvent(event)
      }
      await Promise.resolve()
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
      expect(hostMouseDown).not.toHaveBeenCalled()
      expect(query).toHaveBeenCalledOnce()
      expect(view.state.selection).toBe(selection)
    } finally {
      view.destroy()
      remove()
      await doc.close()
      root.remove()
      vi.restoreAllMocks()
    }
  }
)

it.each(['release', 'leave'])(
  'discards a pending type response after %s, even across view updates',
  async (action) => {
    const root = document.body.appendChild(document.createElement('div'))
    const doc = new NodeLspDocument({} as never, { workspace_id: 'sample-root' }, 'sample.ts')
    doc.supported = true
    let finish!: (text: string) => void
    const response = new Promise<string>((resolve) => {
      finish = resolve
    })
    const hover = vi.spyOn(doc, 'hover').mockReturnValue(response)
    const remove = provideLsp(root, { document: doc, navigate: () => {} })
    const view = new EditorView({
      parent: root,
      doc: 'const sample = 1',
      extensions: [nodeLspExtension()],
    })
    try {
      vi.spyOn(view, 'posAtCoords').mockReturnValue(8)
      vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 10, bottom: 30 })
      view.contentDOM
        .querySelector('.cm-line')!
        .dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 20, ctrlKey: true })
        )
      await vi.waitFor(() => expect(hover).toHaveBeenCalled())
      if (action === 'release')
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
      else view.dom.dispatchEvent(new MouseEvent('mouseleave'))
      view.dispatch({})
      await new Promise((resolve) => setTimeout(resolve, 50))
      finish('const sample: number')
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(document.querySelector('.abele-lsp-message')).toBeNull()
    } finally {
      view.destroy()
      remove()
      await doc.close()
      root.remove()
      vi.restoreAllMocks()
    }
  }
)
