import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import FileView from '@/components/nodeWork/FileView.vue'
import DebugSource from '@/components/debugger/DebugSource.vue'
import SelectionBar from '@/components/obsidian/SelectionBar.vue'
import { useVault } from '../helpers/testEnv'
import GithubBlob from '@/components/github/GithubBlob.vue'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import NodePathDebugFile from '@/components/nodeWork/NodePathDebugFile.vue'
import { LINKER } from '@/github/linking'
import { ref } from 'vue'
import { vi } from 'vitest'
import { resolveNodeCodeLink } from '@/node/codeLinks'
let view: VueWrapper | undefined
it('copies a working-tree link with the exact selected line range', async () => {
  useVault([])
  const target = {
    nodeId: 'node',
    registrationId: 'registration',
    projectId: 'project',
    kind: 'worktree' as const,
    id: 'tree',
  }
  const writeText = vi.fn().mockResolvedValue(undefined)
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    view = mount(FileView, {
      attachTo: document.body,
      props: { path: 'sample.ts', text: 'const sample = 1', mode: 'file', codeTarget: target },
    })
    await flushPromises()
    const range = document.createRange()
    range.selectNodeContents(view.get('.cm-line').element)
    window.getSelection()!.addRange(range)
    view.getComponent(SelectionBar).vm.$emit('pick', 'link')
    expect(writeText).toHaveBeenCalledOnce()
    expect(resolveNodeCodeLink(writeText.mock.calls[0][0], target)).toEqual({
      path: 'sample.ts',
      line: 1,
      endLine: 1,
    })
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})
afterEach(() => {
  view?.unmount()
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})
it('keeps selected node code actions out of the file context menu', async () => {
  useVault([])
  view = mount(FileView, {
    attachTo: document.body,
    props: { path: 'sample.ts', text: 'const sample = 1', mode: 'file' },
  })
  await flushPromises()
  const range = document.createRange()
  range.selectNodeContents(view.get('.cm-line').element)
  window.getSelection()!.addRange(range)
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  view.get('.cm-line').element.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(view.emitted('menu')).toBeUndefined()
})
it('offers note insertion without losing the node selection line or side', async () => {
  useVault([])
  view = mount(FileView, {
    attachTo: document.body,
    props: { path: 'sample.ts', text: 'const sample = 1', mode: 'file' },
  })
  await flushPromises()
  const range = document.createRange()
  range.selectNodeContents(view.get('.cm-line').element)
  window.getSelection()!.addRange(range)
  const bar = view.getComponent(SelectionBar)
  expect(bar.props('actions').map((a: { id: string }) => a.id)).toEqual(['ask', 'add', 'note'])
  bar.vm.$emit('pick', 'note', { text: 'const sample = 1', from: 1, to: 1 })
  expect(view.emitted('note')?.[0]).toEqual([
    { text: 'const sample = 1', from: 1, to: 1, side: 'after' },
  ])
})
it('gives debugger selected words their path and all three actions', async () => {
  useVault([])
  view = mount(DebugSource, {
    props: { path: 'sample.ts', text: 'const sample = 1', breakpoints: [] },
  })
  await flushPromises()
  view.getComponent(SelectionBar).vm.$emit('pick', 'add', { text: 'sample', from: 1, to: 1 })
  expect(view.emitted('selection')?.[0]).toEqual([
    'add',
    { path: 'sample.ts', text: 'sample', from: 1, to: 1 },
  ])
})

it('retains exact node selection after a touch clears the native range', async () => {
  useVault([])
  view = mount(FileView, {
    attachTo: document.body,
    props: { path: 'sample.ts', text: 'const sample = 1', mode: 'file' },
  })
  await flushPromises()
  const range = document.createRange()
  range.selectNodeContents(view.get('.cm-line').element)
  window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  window.getSelection()!.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  view
    .getComponent(SelectionBar)
    .vm.$emit('pick', 'add', { text: 'const sample = 1', from: 1, to: 1 })
  expect(view.emitted('add')?.[0]).toEqual([
    { text: 'const sample = 1', from: 1, to: 1, side: 'after' },
  ])
})

it.each([true, false])(
  'offers GitHub word actions only in the bar with assistant enabled=%s',
  async (enabled) => {
    useVault([])
    const linker = {
      canAsk: () => enabled,
      ask: vi.fn(),
      copy: vi.fn(),
      insertSnippet: vi.fn(),
      blobLink: vi.fn().mockResolvedValue({
        url: 'https://github.com/sample/project/blob/sample/src/sample.ts#L1',
        label: 'Sample lines',
      }),
    }
    view = mount(GithubBlob, {
      attachTo: document.body,
      props: {
        text: 'const sample = 1',
        file: {
          owner: 'sample',
          repo: 'project',
          ref: 'main',
          path: 'src/sample.ts',
          host: 'github.com',
        } as never,
      },
      global: { provide: { [LINKER as symbol]: linker } },
    })
    await flushPromises()
    const actions = view
      .getComponent(SelectionBar)
      .props('actions')
      .map((a: { id: string }) => a.id)
    expect(actions).toEqual(
      enabled ? ['ask', 'add', 'note', 'code', 'link'] : ['add', 'note', 'code', 'link']
    )
    const line = view.get('.cm-line').element
    const range = document.createRange()
    range.selectNodeContents(line)
    window.getSelection()!.addRange(range)
    const show = vi.spyOn((await import('obsidian')).Menu.prototype, 'showAtMouseEvent')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    line.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(show).not.toHaveBeenCalled()
    view.getComponent(SelectionBar).vm.$emit('pick', 'link', { text: 'sample', from: 1, to: 1 })
    await flushPromises()
    expect(linker.blobLink).toHaveBeenCalledWith({ from: 1, to: 1 })
    expect(linker.copy).toHaveBeenCalled()
    show.mockRestore()
  }
)

it('forwards node and debugger selections to the file host for ask, add and note', async () => {
  useVault([])
  const model = {
    busy: ref(false),
    error: ref(''),
    mode: ref('file'),
    document: ref({ path: 'sample.ts', text: 'sample' }),
  }
  view = mount(NodePathFilePane, { props: { model: model as never } })
  const selection = { text: 'sample', from: 1, to: 1, side: 'after' }
  for (const action of ['ask', 'add', 'note']) {
    view.getComponent(FileView).vm.$emit(action, selection)
    expect(view.emitted(action)?.[0]).toEqual([selection])
  }
  await view.setProps({
    debug: {
      registrationId: 'sample-node',
      conversationId: 'sample-chat',
      sourceId: 'sample-source',
      debugSessionId: 'sample-debug',
      incarnation: 'sample-build',
      path: 'sample.ts',
      text: 'sample',
    },
  })
  for (const action of ['ask', 'add', 'note']) {
    view
      .getComponent(NodePathDebugFile)
      .vm.$emit('selection', action, { text: 'sample', from: 1, to: 1, path: 'sample.ts' })
    expect(view.emitted(action)?.[1]).toEqual([selection])
  }
})

it('returns to the file and notifies the host when its debug source is revealed', async () => {
  useVault([])
  const model = {
    busy: ref(false),
    error: ref(''),
    mode: ref('file'),
    document: ref({ path: 'sample.ts', text: 'sample' }),
  }
  view = mount(NodePathFilePane, {
    props: {
      model: model as never,
      debug: {
        registrationId: 'sample-node',
        conversationId: 'sample-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-build',
        path: 'sample.ts',
        text: 'sample',
      },
    },
  })
  model.mode.value = 'diff'
  await flushPromises()
  view.getComponent(NodePathDebugFile).vm.$emit('reveal', 1)
  await flushPromises()
  expect(model.mode.value).toBe('file')
  expect(view.emitted('reveal')).toEqual([[1]])
  expect(view.findComponent(FileView).exists()).toBe(true)
  expect(view.findComponent(NodePathDebugFile).exists()).toBe(true)
  expect(view.find('.abele-diff').exists()).toBe(false)
})

it('hands pending GitHub note snippets to the linker so it can handle a failed permalink', async () => {
  useVault([])
  let reject!: (error: Error) => void
  const pending = new Promise<never>((_resolve, fail) => {
    reject = fail
  })
  const failed = vi.fn()
  const linker = {
    canAsk: () => true,
    blobLink: () => pending,
    insertSnippet: vi.fn(async (snippet: Promise<unknown>) => {
      try {
        await snippet
      } catch (error) {
        failed(error)
      }
    }),
  }
  view = mount(GithubBlob, {
    props: {
      text: 'const sample = 1',
      file: {
        owner: 'sample',
        repo: 'project',
        ref: 'main',
        path: 'sample.ts',
        host: 'github.com',
      } as never,
    },
    global: { provide: { [LINKER as symbol]: linker } },
  })
  await flushPromises()
  view.getComponent(SelectionBar).vm.$emit('pick', 'code', { text: 'sample', from: 1, to: 1 })
  expect(linker.insertSnippet).toHaveBeenCalledWith(expect.any(Promise))
  reject(new Error('Sample unavailable link'))
  await flushPromises()
  expect(failed).toHaveBeenCalled()
})

it('retains link insertion separately from insertion with code in the floating menu', async () => {
  useVault([])
  const link = {
    url: 'https://github.com/sample/project/blob/main/sample.ts#L1',
    label: 'sample.ts:1',
  }
  const linker = {
    canAsk: () => true,
    blobLink: vi.fn().mockResolvedValue(link),
    insert: vi.fn(),
    insertSnippet: vi.fn(),
  }
  view = mount(GithubBlob, {
    props: {
      text: 'const sample = 1',
      file: {
        host: 'github.com',
        owner: 'sample',
        repo: 'project',
        ref: 'main',
        path: 'sample.ts',
      } as never,
    },
    global: { provide: { [LINKER as symbol]: linker } },
  })
  await flushPromises()
  const bar = view.getComponent(SelectionBar)
  bar.vm.$emit('pick', 'note', { text: 'sample', from: 1, to: 1 })
  expect(linker.insert).toHaveBeenCalledWith(expect.any(Promise))
  expect(await linker.insert.mock.calls[0][0]).toEqual(link)
  expect(linker.insertSnippet).not.toHaveBeenCalled()
  bar.vm.$emit('pick', 'code', { text: 'sample', from: 1, to: 1 })
  expect(linker.insertSnippet).toHaveBeenCalledWith(expect.any(Promise))
})

it('marks navigation destinations without showing an execution line in pending node code', async () => {
  useVault([])
  const model = {
    notice: ref(''),
    error: ref(''),
    busy: ref(false),
    mode: ref('file'),
    document: ref({
      path: 'sample.ts',
      text: 'const first = 1\nconst second = 2',
      target: {
        nodeId: 'node',
        registrationId: 'registration',
        projectId: 'project',
        kind: 'worktree',
        id: 'tree',
      },
    }),
  }
  view = mount(NodePathFilePane, { attachTo: document.body, props: { model: model as never } })
  await flushPromises()
  expect(view.findComponent(DebugSource).exists()).toBe(true)
  await view.setProps({ line: 2 })
  await flushPromises()
  expect(view.get('.abele-github-code__line_target').text()).toContain('second')
  expect(view.find('.abele-debug-source__line_here').exists()).toBe(false)
  await view.setProps({ line: 1 })
  await flushPromises()
  expect(view.get('.abele-github-code__line_target').text()).toContain('first')
  await view.setProps({ line: undefined })
  await flushPromises()
  expect(view.find('.abele-github-code__line_target').exists()).toBe(false)
})
