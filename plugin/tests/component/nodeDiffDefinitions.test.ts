import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { computed } from 'vue'
import { EditorView } from '@codemirror/view'
import GithubDiffFile from '@/components/github/GithubDiffFile.vue'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { LSP_CONNECTION } from '@/node/lspConnection'
import { FILE_DESTINATION } from '@/node/fileNavigation'
import { useVault } from '../helpers/testEnv'
import { Menu } from 'obsidian'
import { navFor, provideCodeNav } from '@/github/search/navAddon'
import { lspFor } from '@/node/lspContext'

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())
it.each(['working-sample', 'sample-commit', 'index-sample', 'untrusted'])(
  'resolves new-file coordinates in %s and never resolves removed lines',
  async (revision) => {
    useVault([])
    vi.spyOn(document, 'getSelection').mockReturnValue(null)
    const text = '\n'.repeat(19) + 'const sample = 1\nconsole.log(sample)\n'
    const definition = vi.fn(async () => [
      {
        path: 'target.ts',
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
      },
    ])
    const open = vi.fn()
    const client = {
      describe: async () => ({
        capabilities: { capabilities: { lsp_v1: { status: 'supported' } } },
      }),
      subscribe: async () => {},
      onEvent: () => () => {},
      lsp: {
        status: async () => [
          {
            language: 'typescript',
            found: true,
            ...(revision === 'untrusted' ? { reason: 'untrusted_folder' } : {}),
          },
        ],
        open: vi.fn(async () => ({ servers: ['typescript'] })),
        close: async () => {},
        diagnostics: async () => [],
        definition,
        hover: vi.fn(async () => ({ text: 'Sample symbol' })),
      },
    }
    const view = mount(GithubDiffFile, {
      props: {
        initiallyOpen: true,
        ...(revision === 'index-sample' ? { analysisRef: revision } : { refs: { head: revision } }),
        file: {
          path: 'sample.ts',
          hash: 'sample',
          status: 'modified',
          additions: 1,
          deletions: 1,
          reviewComments: [],
          patch:
            '@@ -20,2 +20,2 @@\n-const previous = 1\n+const sample = 1\n console.log(sample)\n',
        },
      },
      global: {
        provide: {
          [REPOSITORY_SOURCE as symbol]: computed(() => ({
            identity: {
              provider: 'node',
              node: 'sample-registration',
              project: 'sample-project',
              workspace: 'sample-worktree',
            },
            text: async () => text,
            navigation: { file: () => 'sample://file' },
          })),
          [LSP_CONNECTION as symbol]: { client, connect: async () => {} },
          [FILE_DESTINATION as symbol]: open,
        },
      },
      attachTo: document.body,
    })
    await flushPromises()
    const content = view.get('.cm-content').element as HTMLElement
    const editor = EditorView.findFromDOM(content)!
    const fallback = vi.fn()
    provideCodeNav(view.element as HTMLElement, {
      pathOf: () => 'sample.ts',
      goToDefinition: fallback,
      findReferences: vi.fn(),
    })
    if (revision === 'untrusted') {
      expect(client.lsp.open).not.toHaveBeenCalled()
      const show = vi.spyOn(Menu.prototype, 'showAtPosition')
      view
        .get('[data-lsp-analysis] button')
        .element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(show.mock.contexts.at(-1)!.items.some((item) => item.title.includes('trust'))).toBe(
        true
      )
      expect(definition).not.toHaveBeenCalled()
      return
    }
    for (const [word, line, character] of [
      ['sample', 19, 6],
      ['console', 20, 0],
    ] as const) {
      const at = editor.state.doc.toString().indexOf(word) + 1
      vi.spyOn(editor, 'posAtCoords').mockReturnValue(at)
      content.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, altKey: true })
      )
      await flushPromises()
      expect(definition).toHaveBeenLastCalledWith(
        expect.anything(),
        'sample.ts',
        { line, character },
        expect.any(AbortSignal)
      )
      expect(open).toHaveBeenCalled()
      expect(open).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: 'target.ts', line: 3 }),
        line + 1
      )
    }
    const references = vi.fn(async () => {})
    lspFor(content)!.references = references
    const navigation = navFor(content)!
    navigation.findReferences('sample', { line: 2, character: 6 })
    await flushPromises()
    expect(references).toHaveBeenCalledWith('sample', { line: 19, character: 6 })
    navigation.findReferences('previous', { line: 1, character: 6 })
    await flushPromises()
    expect(references).toHaveBeenCalledOnce()
    // Phone long press uses the shared symbol menu.
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    vi.spyOn(editor, 'posAtCoords').mockReturnValue(
      editor.state.doc.toString().indexOf('sample') + 1
    )
    const press = new Event('touchstart', { bubbles: true })
    Object.assign(press, { touches: [{ clientX: 1, clientY: 1 }] })
    content.dispatchEvent(press)
    await new Promise((resolve) => setTimeout(resolve, 550))
    await flushPromises()
    const action = show.mock.contexts
      .at(-1)!
      .items.find((item) => item.title.includes('Go to definition'))!
    expect(action).toBeDefined()
    action.handler?.()
    await flushPromises()
    expect(client.lsp.hover).toHaveBeenCalledWith(
      expect.anything(),
      'sample.ts',
      { line: 19, character: 6 },
      expect.any(AbortSignal)
    )
    expect(client.lsp.open.mock.calls.every((call) => (call as unknown[])[2] === text)).toBe(true)
    definition.mockClear()
    vi.spyOn(editor, 'posAtCoords').mockReturnValue(
      editor.state.doc.toString().indexOf('previous') + 1
    )
    content.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, altKey: true })
    )
    await flushPromises()
    expect(definition).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  }
)
