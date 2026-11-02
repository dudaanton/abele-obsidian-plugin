import { expect, it, vi } from 'vitest'
import { diffReferenceSymbol, installDiffReferences } from '@/node/diffReferences'
import { Menu } from 'obsidian'
import { mount, flushPromises } from '@vue/test-utils'
import FileView from '@/components/nodeWork/FileView.vue'
import { LSP_CONNECTION } from '@/node/lspConnection'
import { useVault } from '../helpers/testEnv'

it.each(['unified', 'split'] as const)('navigates a rendered %s node diff', async (layout) => {
  useVault([])
  const text = 'const sample = 1\nconsole.log(sample)'
  const definition = vi.fn(async () => [
    {
      path: 'target.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
    },
  ])
  const navigate = vi.fn()
  const client = {
    describe: async () => ({ capabilities: { capabilities: { lsp_v1: { status: 'supported' } } } }),
    subscribe: async () => {},
    onEvent: () => () => {},
    lsp: {
      status: async () => [{ language: 'typescript', found: true }],
      open: vi.fn(async () => ({ servers: ['typescript'] })),
      close: async () => {},
      diagnostics: async () => [],
      definition,
    },
  }
  const view = mount(FileView, {
    props: {
      path: 'sample.ts',
      text,
      mode: 'diff',
      layout,
      codeTarget: {
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        projectId: 'sample-project',
        kind: 'worktree',
        id: 'sample-worktree',
      },
      change: {
        path: 'sample.ts',
        kind: 'modified',
        before: 'const previous = 1\nconsole.log(sample)',
        after: text,
      } as never,
    },
    global: {
      stubs: { SelectionBar: true, NodeFileTools: true },
      provide: { [LSP_CONNECTION as symbol]: { client, connect: async () => {}, navigate } },
    },
    attachTo: document.body,
  })
  const original = document.caretRangeFromPoint
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  try {
    await flushPromises()
    for (const line of [1, 2]) {
      const span = view.get(
        `.abele-diff__line[data-line-b="${line}"]:not(.abele-diff__line_left) .abele-diff__text`
      ).element
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()!
      while (!node.textContent?.includes('sample')) node = walker.nextNode()!
      const range = document.createRange()
      range.setStart(node, node.textContent!.indexOf('sample') + 1)
      range.collapse(true)
      document.caretRangeFromPoint = vi.fn(() => range)
      for (const modifier of ['metaKey', 'ctrlKey']) {
        span.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            [modifier]: true,
          })
        )
        await flushPromises()
        expect(definition).toHaveBeenLastCalledWith(
          expect.anything(),
          'sample.ts',
          { line: line - 1, character: line === 1 ? 6 : 12 },
          expect.any(AbortSignal)
        )
        expect(navigate).toHaveBeenCalled()
      }
      span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      show.mock.contexts.at(-1)!.items[0].handler?.()
      await flushPromises()
      expect(client.lsp.open).toHaveBeenCalledWith(
        expect.anything(),
        'sample.ts',
        text,
        undefined,
        expect.any(AbortSignal)
      )
    }
    view
      .get('.abele-diff__line_removed .abele-diff__text')
      .element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(show.mock.contexts.at(-1)!.items[0].title).toContain('past revision')
  } finally {
    document.caretRangeFromPoint = original
    show.mockRestore()
    view.unmount()
  }
})

it('maps an after-side symbol to its full-file position and rejects removed or stale lines', () => {
  const root = document.createElement('div')
  const row = document.createElement('div')
  row.className = 'abele-diff__line'
  row.dataset.lineB = '2'
  const text = document.createElement('span')
  text.className = 'abele-diff__text'
  text.textContent = '  sample()'
  row.append(text)
  root.append(row)
  document.body.append(root)
  const range = document.createRange()
  range.setStart(text.firstChild!, 4)
  range.collapse(true)
  const original = document.caretRangeFromPoint
  document.caretRangeFromPoint = vi.fn(() => range)
  const event = new MouseEvent('contextmenu', { clientX: 4, clientY: 4 })
  Object.defineProperty(event, 'target', { value: text })
  expect(diffReferenceSymbol(root, event, 'header\n  sample()')).toEqual({
    name: 'sample',
    position: { line: 1, character: 2 },
  })
  const run = vi.fn()
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const remove = installDiffReferences(root, () => 'header\n  sample()', run)
  text.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const menu = show.mock.contexts.at(-1)!
  expect(menu.items.map((item) => item.title)).toEqual([
    'Go to definition of sample',
    'Find references to sample',
  ])
  menu.items[1].handler?.()
  expect(run).toHaveBeenCalledWith('references', {
    name: 'sample',
    position: { line: 1, character: 2 },
  })
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', shiftKey: true }))
  expect(run).toHaveBeenCalledTimes(2)
  remove()
  show.mockRestore()
  row.classList.add('abele-diff__line_removed')
  expect(diffReferenceSymbol(root, event, 'header\n  sample()')).toBeNull()
  row.classList.remove('abele-diff__line_removed')
  expect(diffReferenceSymbol(root, event, 'header\nchanged()')).toBeNull()
  document.caretRangeFromPoint = original
  document.getSelection()?.removeAllRanges()
  root.remove()
})
