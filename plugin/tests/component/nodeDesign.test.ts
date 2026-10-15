import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import FileView from '@/components/nodeWork/FileView.vue'
import PairDialog from '@/components/nodeWork/PairDialog.vue'
import NodePlace from '@/components/nodeWork/NodePlace.vue'
import NodeModes from '@/components/nodeWork/NodeModes.vue'
import HistoryView from '@/components/nodeWork/HistoryView.vue'
import FileTree from '@/components/nodeWork/FileTree.vue'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import { ref } from 'vue'

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  mounted.splice(0).forEach((view) => view.unmount())
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})
const folder = {
  id: 'project',
  name: 'Sample repository',
  path: '/sample',
  git: true,
  copies: [
    {
      id: 'tree',
      kind: 'project' as const,
      branch: 'trunk',
      path: '/sample',
      changed: 0,
      chats: [{ id: 'chat', title: 'Sample chat', when: 'Just now' }],
    },
  ],
}
function keep(view: ReturnType<typeof mount>) {
  mounted.push(view)
  return view
}

describe('node design corrections', () => {
  it('reads the code as a node card, retains the full fingerprint and hides the ID in its tooltip', async () => {
    const view = keep(
      mount(PairDialog, {
        props: {
          step: 'paste',
          initial: 'sample-code',
          device: 'Sample device',
          parse: () => ({
            name: 'Sample node',
            nodeId: 'sample-node-id',
            host: 'sample.invalid',
            port: 443,
            fingerprint: 'abcd'.repeat(8),
            expires: '10 more minutes',
          }),
        },
      })
    )
    await flushPromises()
    expect(view.find('dl').exists()).toBe(false)
    expect(view.get('.abele-pair__card-name').attributes('aria-label')).toContain('sample-node-id')
    expect(view.get('.abele-pair__card-expires').text()).toBe('10 min')
    expect(view.findAll('.abele-pair__key > span').map((g) => g.text())).toEqual(
      Array(8).fill('abcd')
    )
  })
  it('uses the real read-only code viewer and redraws when switching out of a diff', async () => {
    const view = keep(
      mount(FileView, {
        props: { path: 'sample.ts', text: 'export const value = 1\n', mode: 'file' },
      })
    )
    await flushPromises()
    const editor = EditorView.findFromDOM(view.get('.cm-editor').element)!
    expect(editor.state.facet(EditorState.readOnly)).toBe(true)
    expect(view.find('.cm-lineNumbers').exists()).toBe(true)
    await view.setProps({ text: 'export const value = 2\n' })
    await flushPromises()
    expect(view.get('.cm-content').text()).toContain('value = 2')
  })
  it(
    'places first-line selection actions below the selection instead of over the file header',
    async () => {
      const view = keep(
        mount(FileView, {
          attachTo: document.body,
          global: { stubs: { teleport: true } },
          props: { path: 'sample.ts', text: 'export const sample = 1', mode: 'file' },
        })
      )
      await flushPromises()
      vi.spyOn(
        view.get('.abele-file-view__header').element,
        'getBoundingClientRect'
      ).mockReturnValue({ top: 60, bottom: 100 } as DOMRect)
      const range = document.createRange()
      range.selectNodeContents(view.get('.cm-line').element)
      vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 120,
        left: 20,
      } as DOMRect)
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      await new Promise((resolve) => setTimeout(resolve, 400))
      await flushPromises()
      expect(view.get('.abele-selection-bar').attributes('style')).toContain('top: 126px')
    }
  )
  it('does not quote a selection outside this file through its context menu', async () => {
    const view = keep(
      mount(FileView, {
        attachTo: document.body,
        props: { path: 'sample.ts', text: 'sample code', mode: 'file' },
      })
    )
    await flushPromises()
    const other = document.createElement('div')
    other.textContent = 'unrelated text'
    document.body.append(other)
    const range = document.createRange()
    range.selectNodeContents(other)
    window.getSelection()!.addRange(range)
    await view.trigger('contextmenu')
    expect(view.emitted('menu')?.[0]?.[1]).toBe('')
    other.remove()
  })
  it('edits with the real renderer without replacing it after each keystroke', async () => {
    const model = {
      document: ref({ text: 'export const value = 1\n' }),
      filePath: ref('sample.ts'),
      editing: ref(true),
      draftText: ref('export const value = 1\n'),
      saving: ref(false),
      draft: ref(null),
      editText: vi.fn((text: string) => {
        model.draftText.value = text
      }),
    }
    const view = keep(
      mount(NodePathEditorPane, {
        props: { model: model as never },
        global: { stubs: { NodeFileSaveState: true } },
      })
    )
    await flushPromises()
    const editor = EditorView.findFromDOM(view.get('.cm-editor').element)!
    expect(editor.state.facet(EditorState.readOnly)).toBe(false)
    editor.dispatch({ changes: { from: 21, to: 22, insert: '2' } })
    await flushPromises()
    expect(model.editText).toHaveBeenCalledWith('export const value = 2\n')
    expect(EditorView.findFromDOM(view.get('.cm-editor').element)).toBe(editor)
  })
  it.each(['unified', 'split'] as const)(
    'offers selected diff text and its line without signs in %s layout',
    async (layout) => {
      const view = keep(
        mount(FileView, {
          attachTo: document.body,
          global: { stubs: { teleport: true } },
          props: {
            path: 'sample.ts',
            text: 'first\nnew value',
            layout,
            change: {
              path: 'sample.ts',
              kind: 'modified',
              added: 1,
              removed: 1,
              before: 'first\nold value',
              after: 'first\nnew value',
            },
          },
        })
      )
      const text = view.get('.abele-diff__line_added .abele-diff__text').element
      const range = document.createRange()
      range.selectNodeContents(text)
      vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 120,
        left: 20,
      } as DOMRect)
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 400))
      await flushPromises()
      await view.get('[data-action="ask"]').trigger('click')
      expect(view.emitted('ask')?.[0]).toEqual([
        { text: 'new value', from: 2, to: 2, side: 'after' },
      ])
    }
  )
  it('preserves internal blank lines when quoting selected diff text', async () => {
    const view = keep(
      mount(FileView, {
        attachTo: document.body,
        global: { stubs: { teleport: true } },
        props: {
          path: 'sample.ts',
          text: 'new\n\nend',
          change: {
            path: 'sample.ts',
            kind: 'modified',
            added: 1,
            removed: 1,
            before: 'old\n\nend',
            after: 'new\n\nend',
          },
        },
      })
    )
    const first = view.get('.abele-diff__line_added .abele-diff__text').element
    const last = view.findAll('.abele-diff__text').at(-1)!.element
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.childNodes.length)
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 160,
      left: 20,
    } as DOMRect)
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    await view.get('[data-action="ask"]').trigger('click')
    expect(view.emitted('ask')?.[0]).toEqual([
      { text: 'new\n\nend', from: 1, to: 3, side: 'after' },
    ])
  })
  it('carries historical selection actions with their file path', () => {
    const view = keep(
      mount(HistoryView, {
        props: {
          open: 'sample-commit',
          commits: [
            {
              hash: 'sample-commit',
              subject: 'Sample change',
              author: 'Sample',
              day: 'Today',
              when: 'Just now',
              files: [
                {
                  path: 'sample.ts',
                  kind: 'added',
                  added: 1,
                  removed: 0,
                  before: '',
                  after: 'sample',
                },
              ],
            },
          ],
        },
      })
    )
    const selection = { text: 'sample', from: 1, to: 1, side: 'after' }
    view.getComponent(FileView).vm.$emit('ask', selection)
    expect(view.emitted('ask')?.[0]).toEqual(['sample.ts', selection])
    view.getComponent(FileView).vm.$emit('add', selection)
    expect(view.emitted('add')?.[0]).toEqual(['sample.ts', selection])
  })
  it('puts folded-directory changes in the glyph column and emits only the nested file menu', async () => {
    const change = {
      path: 'src/sample.ts',
      kind: 'modified' as const,
      unseen: true,
      added: 1,
      removed: 1,
      before: 'old',
      after: 'new',
    }
    const view = keep(
      mount(FileTree, {
        props: {
          mode: 'all',
          changes: [change],
          entries: [
            {
              path: 'src',
              name: 'src',
              kind: 'folder',
              children: [{ path: 'src/sample.ts', name: 'sample.ts', kind: 'file', change }],
            },
          ],
        },
      })
    )
    expect(view.find('.abele-change-codes__glyph .abele-status-dot').exists()).toBe(true)
    await view.get('.tree-item-self').trigger('click')
    await view.get('[data-path="src/sample.ts"]').trigger('contextmenu')
    expect(view.emitted('menu')?.map((e) => e[1])).toEqual(['src/sample.ts'])
  })
  it('writes a large count of changes whole beside its mode', () => {
    const view = keep(mount(NodeModes, { props: { mode: 'files', git: true, pulls: false, changes: 12400 } }))
    const changes = view.findAll('[role="tab"]')[1]
    expect(changes.text()).toBe('12400')
    expect(changes.attributes('aria-label')).toBe('Changes: 12400 files')
  })
  it('keeps the place menu apart from the place search: its glyph opens only the menu', async () => {
    const view = keep(
      mount(NodePlace, { props: { node: 'Sample node', folder: folder.name, branch: 'trunk' } })
    )
    await view.get('.abele-node-place > .abele-obsidian-icon').trigger('click')
    expect(view.emitted('menu')).toHaveLength(1)
    expect(view.emitted('pick')).toBeUndefined()
  })
})

it('anchors suggestion glyphs to the first title line despite a second note line', () => {
  const nodeSuggestSource = readFileSync(
    join(__dirname, '../../src/components/nodeWork/nodeSuggest.css'),
    'utf8'
  )
  const styles = nodeSuggestSource.match(
    /\.suggestion-item\.mod-complex\.abele-node-suggestion \.suggestion-icon\.abele-node-suggestion__kind \{([^}]+)\}/
  )?.[1]
  expect(styles).toMatch(/align-self: flex-start/)
  expect(styles).toMatch(/height: 1lh/)
  expect(styles).toMatch(/align-items: center/)
})
