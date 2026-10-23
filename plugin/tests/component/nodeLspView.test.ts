import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { lspOffset } from '@/node/lspExtension'
import { lspFor, lspNavigation } from '@/node/lspContext'
import NodeLspFixture from '@/testing/NodeLspFixture.vue'
import GithubBlob from '@/components/github/GithubBlob.vue'
import NodeLspTools from '@/components/nodeWork/NodeLspTools.vue'
import { NodeService } from '@/node/NodeService'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { computed, ref, nextTick } from 'vue'
import { Menu, Platform } from 'obsidian'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import NodeFileTools from '@/components/nodeWork/NodeFileTools.vue'
import { LSP_CONNECTION } from '@/node/lspConnection'
import { FILE_DESTINATION } from '@/node/fileNavigation'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'
vi.mock('@/node/advertisedMethods', () => ({ nodeAdvertisesMethod: vi.fn(() => true) }))
enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(nodeAdvertisesMethod).mockReturnValue(true)
  Object.assign(Platform, { isMobile: false, isPhone: false })
})

function openAnalysisAction(title: string) {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  document.querySelector<HTMLButtonElement>('[data-lsp-analysis] button')!.click()
  const menu = show.mock.contexts.at(-1)!
  const item = menu.items.find((item) => item.title === title)!
  expect(item).toBeDefined()
  item.handler?.()
}

describe('node language diagnostics in the shared file viewer', () => {
  it('consumes the macOS contextmenu event after Ctrl-click navigation', async () => {
    const _fixture = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const content = document.querySelector<HTMLElement>('.cm-content')!
    const editor = EditorView.findFromDOM(content)!
    vi.spyOn(editor, 'posAtCoords').mockReturnValue(15)
    const context = lspFor(content)!
    const navigate = vi.spyOn(context, 'navigate').mockImplementation(() => {})
    vi.spyOn(context.document, 'query').mockResolvedValue([
      {
        path: 'first.d.ts',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
      },
      {
        path: 'second.d.ts',
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 6 } },
      },
    ])
    const menu = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    content
      .querySelector('.cm-line')!
      .dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
      )
    content
      .querySelector('.cm-line')!
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
      )
    await flushPromises()
    expect(navigate).toHaveBeenCalledOnce()
    expect(menu).not.toHaveBeenCalled()
  })
  it('shows only a menu for right-click, including Ctrl-right-click, and replaces existing surfaces', async () => {
    const _fixture = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const content = document.querySelector<HTMLElement>('.cm-content')!
    vi.spyOn(EditorView.findFromDOM(content)!, 'posAtCoords').mockReturnValue(15)
    const context = lspFor(content)!
    const navigate = vi.spyOn(context, 'navigate').mockImplementation(() => {})
    const closeNavigation = vi.fn()
    context.closeNavigation = closeNavigation
    const menu = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const hide = vi.spyOn(Menu.prototype, 'hide')
    const gesture = (button: number, ctrlKey: boolean, metaKey = false) => {
      for (const type of button === 2 ? ['mousedown', 'contextmenu'] : ['mousedown'])
        content
          .querySelector('.cm-line')!
          .dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, button, ctrlKey, metaKey })
          )
    }
    gesture(2, true)
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    expect(menu).toHaveBeenCalledOnce()
    gesture(0, false, true)
    await flushPromises()
    expect(hide).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledOnce()
    gesture(2, false)
    await flushPromises()
    expect(closeNavigation).toHaveBeenCalledOnce()
    expect(menu).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledOnce()
  })
  it.each(['menu', 'navigation'] as const)(
    'discards a pending %s after the other gesture',
    async (pending) => {
      const _fixture = mount(NodeLspFixture, {
        props: { state: 'errors' },
        attachTo: document.body,
      })
      await flushPromises()
      const content = document.querySelector<HTMLElement>('.cm-content')!
      vi.spyOn(EditorView.findFromDOM(content)!, 'posAtCoords').mockReturnValue(15)
      const context = lspFor(content)!
      const navigate = vi.spyOn(context, 'navigate').mockImplementation(() => {})
      const menu = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
      let finish!: () => void
      const delayed = new Promise<void>((resolve) => {
        finish = resolve
      })
      if (pending === 'menu')
        vi.spyOn(context.document, 'hover').mockImplementation(async () => {
          await delayed
          return 'const sample: string'
        })
      else
        vi.spyOn(context.document, 'query').mockImplementation(async () => {
          await delayed
          return [
            {
              path: 'sample.d.ts',
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
            },
          ]
        })
      const navigateGesture = () =>
        content.querySelector('.cm-line')!.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            metaKey: true,
          })
        )
      const menuGesture = () =>
        content
          .querySelector('.cm-line')!
          .dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
          )
      if (pending === 'menu') {
        menuGesture()
        navigateGesture()
      } else {
        navigateGesture()
        menuGesture()
      }
      await flushPromises()
      finish()
      await flushPromises()
      expect(menu).toHaveBeenCalledTimes(pending === 'menu' ? 0 : 1)
      expect(navigate).toHaveBeenCalledTimes(pending === 'menu' ? 1 : 0)
    }
  )
  it.each(['definition', 'references'] as const)(
    'sends a %s to the owning file history',
    async (kind) => {
      const fixture = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
      await flushPromises()
      const tools = fixture.getComponent(NodeLspTools)
      const client = lspFor(document.querySelector('.abele-lsp-root')!)!.document.client
      vi.spyOn(client.lsp, kind).mockResolvedValue([
        {
          path: 'destination.ts',
          range: { start: { line: 6, character: 0 }, end: { line: 6, character: 4 } },
        },
      ])
      const root = document.createElement('div')
      const destination = vi.fn()
      mount(NodeLspTools, {
        props: { ...tools.props(), root, glyphHost: null },
        global: {
          provide: {
            [LSP_CONNECTION as symbol]: { client, connect: async () => {} },
            [FILE_DESTINATION as symbol]: destination,
          },
        },
      })
      await flushPromises()
      const nav = lspNavigation(root, null)!
      if (kind === 'definition')
        await nav.goToDefinition('sample', 'sample.ts', { line: 1, character: 13 })
      else nav.findReferences('sample', { line: 1, character: 13 })
      await flushPromises()
      expect(destination).toHaveBeenCalledWith(
        {
          kind: 'file',
          target: tools.props('target'),
          path: 'destination.ts',
          line: 7,
        },
        2
      )
    }
  )
  it('uses reader text for navigation alongside an unsaved editor and restores it on editor close', async () => {
    const fixture = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const tools = fixture.getComponent(NodeLspTools)
    const readerRoot = document.querySelector('.abele-lsp-root')!
    const doc = lspFor(readerRoot)!.document
    const readerText = tools.props('text')
    let remote = readerText
    vi.spyOn(doc.client.lsp, 'open').mockImplementation(async (_root, _path, text) => {
      remote = text
      return { servers: ['typescript'] }
    })
    const definitionTexts: string[] = []
    const definition = vi.spyOn(doc.client.lsp, 'definition').mockImplementation(async () => {
      definitionTexts.push(remote)
      expect(remote).toBe(readerText)
      return []
    })
    const close = vi.spyOn(doc.client.lsp, 'close')
    const split = mount(NodeLspTools, {
      props: {
        ...tools.props(),
        root: document.createElement('div'),
        glyphHost: null,
        text: 'unsaved editor draft',
      },
      global: {
        provide: { [LSP_CONNECTION as symbol]: { client: doc.client, connect: async () => {} } },
      },
    })
    await flushPromises()
    expect(remote).toBe('unsaved editor draft')
    const fallback = { pathOf: () => 'sample.ts', goToDefinition: vi.fn(), findReferences: vi.fn() }
    await lspNavigation(readerRoot, fallback)!.goToDefinition('sample', 'sample.ts', {
      line: 0,
      character: 13,
    })
    expect(definition).toHaveBeenCalledOnce()
    expect(definitionTexts).toEqual([readerText])
    await split.setProps({ text: 'another editor draft' })
    // A pending debounced edit must not overwrite the reader after the editor closes.
    split.unmount()
    await flushPromises()
    expect(remote).toBe(readerText)
    expect(close).not.toHaveBeenCalled()
    fixture.unmount()
    await flushPromises()
    expect(close).toHaveBeenCalledOnce()
  })
  it('shows the initial status error in the analysis menu and recovers through Restart', async () => {
    const root = document.createElement('div')
    const glyphHost = document.body.appendChild(document.createElement('div'))
    const client = {
      describe: async () => ({
        capabilities: { capabilities: { lsp_v1: { status: 'supported' } } },
      }),
      onEvent: () => () => {},
      subscribe: async () => {},
      lsp: {
        status: vi
          .fn()
          .mockRejectedValueOnce(new Error('Sample status failure'))
          .mockResolvedValue([]),
        open: vi.fn(async () => ({ servers: ['typescript'] })),
        diagnostics: async () => [],
        close: async () => {},
      },
    }
    const view = mount(NodeLspTools, {
      props: {
        root,
        glyphHost,
        path: 'sample.ts',
        text: 'sample',
        target: {
          kind: 'workspace',
          id: 'sample-workspace',
          projectId: 'sample-project',
          registrationId: 'sample-node',
          nodeId: 'sample-node',
        },
      },
      global: { provide: { [LSP_CONNECTION as symbol]: { client, connect: async () => {} } } },
    })
    await flushPromises()
    const glyph = glyphHost.querySelector('[data-lsp-analysis]')!
    expect(glyph.getAttribute('data-state')).toBe('failed')
    expect(root.querySelector('[role="alert"], .abele-lsp-status')).toBeNull()
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    glyph.querySelector<HTMLButtonElement>('button')!.click()
    const items = show.mock.contexts.at(-1)!.items
    expect(items.some((item) => item.title.includes('Sample status failure'))).toBe(true)
    items.find((item) => item.title === 'Restart analysis')!.handler?.()
    await flushPromises()
    expect(glyph.getAttribute('data-state')).not.toBe('failed')
    expect(client.lsp.open).toHaveBeenCalledOnce()
    view.unmount()
    glyphHost.remove()
    await flushPromises()
  })
  it('keeps a shared document alive and detaches only the departing view listener', async () => {
    const fixture = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const tools = fixture.getComponent(NodeLspTools)
    const doc = lspFor(document.querySelector('.cm-editor')!)!.document
    const open = vi.spyOn(doc.client.lsp, 'open')
    const close = vi.spyOn(doc.client.lsp, 'close')
    const listeners = doc.listeners.size
    const split = mount(NodeLspTools, {
      props: { ...tools.props(), root: document.createElement('div'), glyphHost: null },
      global: {
        provide: { [LSP_CONNECTION as symbol]: { client: doc.client, connect: async () => {} } },
      },
    })
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
    expect(doc.listeners.size).toBe(listeners + 1)
    split.unmount()
    await flushPromises()
    expect(close).not.toHaveBeenCalled()
    expect(doc.listeners.size).toBe(listeners)
    expect(doc.diagnostics).toHaveLength(2)
    fixture.unmount()
    await flushPromises()
    expect(close).toHaveBeenCalledOnce()
  })
  it.each([
    ['ready', 'check', []],
    ['loading', 'loader', []],
    ['eslint', 'check', ['How to set up ESLint']],
    ['untrusted', 'shield-alert', ['Trust this folder…']],
    ['failed', 'circle-alert', ['Restart analysis']],
    ['errors', 'check', ['Restart analysis']],
    ['off', 'circle-off', []],
  ] as const)('uses state icons and applicable actions for %s', async (state, icon, actions) => {
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const view = mount(NodeLspFixture, { props: { state }, attachTo: document.body })
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-lsp-analysis] button')!.click()
    const items = show.mock.contexts.at(-1)!.items
    expect(items.filter((item) => !item.disabled).map((item) => item.title)).toEqual(actions)
    const statuses = items.filter((item) => item.disabled)
    expect(statuses[0].icon).toBe(icon)
    expect(statuses.every((item) => item.checked === null)).toBe(true)
    expect(statuses).toHaveLength(state === 'off' ? 1 : 2)
    if (state === 'eslint') expect(statuses[1].icon).toBe('circle-alert')
    if (state === 'failed')
      expect(statuses[0].title).toBe('TypeScript — stopped: Sample analysis server stopped')
    expect(document.querySelector('button[data-lsp-settle]')).toBeNull()
    view.unmount()
  })
  it.each([
    'missing',
    'untrusted',
    'loading',
    'errors',
    'eslint',
    'failed',
    'off',
    'ready',
  ] as const)('keeps %s analysis status out of the file body', async (state) => {
    const view = mount(NodeLspFixture, { props: { state }, attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('.abele-file-view .abele-lsp-status')).toBeNull()
    expect(document.querySelector('[data-lsp-analysis]')).not.toBeNull()
    expect(document.querySelector('.abele-file-view [data-lsp-analysis]')).toBeNull()
    view.unmount()
  })
  it('analyzes and searches the displayed text when a locked editor retains a different draft', async () => {
    const model = {
      filePath: ref('sample.ts'),
      editing: ref(false),
      draftText: ref('retained draft'),
      document: ref({ text: 'visible disk text' }),
      saving: ref(false),
      draft: ref(undefined),
    }
    const view = mount(NodePathEditorPane, {
      props: {
        model: model as never,
        locked: true,
        target: {
          nodeId: 'sample-node',
          registrationId: 'sample-registration',
          projectId: 'sample-project',
          kind: 'workspace',
          id: 'sample-workspace',
        },
      },
      global: {
        stubs: {
          NodeLspTools: true,
          NodeFileTools: true,
          GithubCode: true,
          NodeFileSaveState: true,
        },
      },
    })
    expect(view.getComponent(GithubCode).props('text')).toBe('visible disk text')
    expect(view.getComponent(NodeLspTools).props('text')).toBe('visible disk text')
    expect(view.getComponent(NodeFileTools).props('text')).toBe('visible disk text')
    model.editing.value = true
    await nextTick()
    expect(view.getComponent(NodeLspTools).props('text')).toBe('retained draft')
    expect(view.getComponent(NodeFileTools).props('text')).toBe('retained draft')
  })
  it('anchors the diagnostics list to its header button for pointer and keyboard activation', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const view = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const button = [...document.querySelectorAll('.abele-file-view__tools button')].find(
      (button) => button.getAttribute('aria-label') === 'Diagnostics: 2'
    )!
    button.click()
    await flushPromises()
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      document
    )
    view.unmount()
  })
  it('rechecks availability after an explicit install without reopening the view', async () => {
    const view = mount(NodeLspFixture, { props: { state: 'missing' }, attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('[data-lsp-analysis]')?.getAttribute('data-state')).toBe(
      'degraded'
    )
    openAnalysisAction('Install popular servers')
    await flushPromises()
    expect(document.body.textContent).not.toContain('Language server missing')
    expect(
      lspFor(document.querySelector('.cm-editor')!)?.document.status.every((status) => status.found)
    ).toBe(true)
    view.unmount()
  })
  it('keeps the authenticated node identity separate from the registration when jumping from a repository', () => {
    vi.spyOn(NodeService, 'connectionIfKnown').mockReturnValue({
      client: { target: { expected_node_id: 'sample-authenticated-node' } },
    } as never)
    const source = {
      identity: {
        provider: 'node',
        installation: 'sample-installation',
        node: 'sample-registration',
        project: 'sample-project',
        workspace: 'sample-worktree',
      },
    }
    const view = mount(GithubBlob, {
      props: {
        text: 'const sample = 1',
        file: { host: '', owner: '', repo: '', ref: 'Working tree', path: 'sample.ts' },
      },
      global: {
        provide: { [REPOSITORY_SOURCE as symbol]: computed(() => source) },
        stubs: { NodeLspTools: true, GithubCode: true },
      },
    })
    expect(view.getComponent(NodeLspTools).props('target')).toMatchObject({
      nodeId: 'sample-authenticated-node',
      registrationId: 'sample-registration',
      id: 'sample-worktree',
    })
  })
  it('installs the popular server list only after an explicit click', async () => {
    const view = mount(NodeLspFixture, { props: { state: 'missing' }, attachTo: document.body })
    await flushPromises()
    const context = lspFor(document.querySelector('.cm-editor')!)!
    const install = vi.spyOn(context.document.client.lsp, 'install').mockResolvedValue([])
    expect(install).not.toHaveBeenCalled()
    openAnalysisAction('Install popular servers')
    await flushPromises()
    expect(install).toHaveBeenCalledWith([
      'typescript',
      'python',
      'eslint',
      'json',
      'css',
      'html',
      'yaml',
      'bash',
      'go',
      'rust',
    ])
    view.unmount()
  })
  it('converts UTF-16 positions and rejects ranges outside the visible document', () => {
    const text = Text.of(['😀sample', 'next'])
    expect(lspOffset(text, { line: 0, character: 2 })).toBe(2)
    expect(lspOffset(text, { line: 1, character: 2 })).toBe(11)
    expect(lspOffset(text, { line: 2, character: 0 })).toBeNull()
    expect(lspOffset(text, { line: 0, character: 100 })).toBeNull()
  })
  it('shows both sources in code and releases the document on unmount', async () => {
    const view = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const code = document.querySelector('.cm-editor')!
    expect(code).not.toBeNull()
    expect(code.querySelector('.abele-lsp-error')?.getAttribute('title')).toContain('typescript')
    expect(code.querySelector('.abele-lsp-warning')?.getAttribute('title')).toContain('eslint')
    expect(document.querySelector('[data-lsp-diagnostics]')?.textContent).toBe('2')
    expect(
      document.querySelector('[data-lsp-diagnostics]')?.classList.contains('clickable-icon')
    ).toBe(true)
    expect(
      document
        .querySelector('[data-lsp-diagnostics]')
        ?.classList.contains('abele-obsidian-icon_color-red')
    ).toBe(true)
    const context = lspFor(code)!
    expect(context.document.listeners.size).toBeGreaterThan(0)
    context.document.diagnostics = context.document.diagnostics.filter(
      (item) => item.severity === 2
    )
    for (const listener of context.document.listeners) listener()
    await nextTick()
    expect(document.querySelector('[data-lsp-diagnostics]')?.textContent).toBe('1')
    expect(
      document
        .querySelector('[data-lsp-diagnostics]')
        ?.classList.contains('abele-obsidian-icon_color-orange')
    ).toBe(true)
    context.document.diagnostics = []
    for (const listener of context.document.listeners) listener()
    await nextTick()
    expect(document.querySelector('[data-lsp-diagnostics]')).toBeNull()
    view.unmount()
    await flushPromises()
    expect(context.document.listeners.size).toBe(0)
  })
  it.each([undefined, 'missing: install eslint in this project'])(
    'keeps TypeScript diagnostics available when only the optional lint server is missing (%s)',
    async (projectEslint) => {
      const view = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
      await flushPromises()
      const context = lspFor(document.querySelector('.abele-lsp-root')!)!
      context.document.status = context.document.status.map((status) =>
        status.language === 'eslint'
          ? { ...status, found: false, project_eslint: projectEslint }
          : status
      )
      for (const listener of context.document.listeners) listener()
      await nextTick()
      expect(document.body.textContent).not.toContain('Language server missing')
      const glyph = document.querySelector('[data-lsp-analysis]')!
      expect(glyph.getAttribute('data-state')).toBe('degraded')
      expect(glyph.querySelector('button')?.getAttribute('aria-label')).toContain(
        'Code analysis: TypeScript only. ESLint isn’t set up.'
      )
      expect(document.querySelector('.abele-file-view .abele-lsp-status')).toBeNull()
      expect(document.querySelector('[data-lsp-diagnostics]')).not.toBeNull()
      view.unmount()
    }
  )
  it.each([
    ['missing', 'degraded', 'orange', 'Code analysis: '],
    ['untrusted', 'degraded', 'orange', 'Code analysis: folder not trusted'],
    ['loading', 'starting', 'faint', 'Code analysis is starting…'],
    ['eslint', 'degraded', 'orange', 'Code analysis: TypeScript only. ESLint isn’t set up.'],
    ['errors', 'ready', undefined, 'Code analysis: TypeScript, ESLint'],
    ['failed', 'failed', 'red', 'Code analysis failed'],
    ['off', 'off', undefined, 'Code analysis is off for this file'],
    ['ready', 'ready', undefined, 'Code analysis: TypeScript, ESLint'],
  ] as const)('shows %s in a stable header action', async (state, expected, tone, tooltip) => {
    const view = mount(NodeLspFixture, { props: { state }, attachTo: document.body })
    await flushPromises()
    const glyph = document.querySelector('[data-lsp-analysis]')!
    expect(glyph.getAttribute('data-state')).toBe(expected)
    expect(glyph.querySelector('button')?.getAttribute('aria-label')).toContain(tooltip)
    expect(
      glyph.querySelector('.abele-status-dot')?.classList.contains('abele-status-dot_' + tone)
    ).toBe(tone ? true : undefined)
    expect(!!glyph.querySelector('.abele-status-dot_pulse')).toBe(state === 'loading')
    expect(document.querySelector('.cm-content')?.textContent).toContain('export const sample')
    view.unmount()
  })
  it('opens the same analyser menu from the phone overflow row', async () => {
    Object.assign(Platform, { isMobile: true, isPhone: true })
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const view = mount(NodeLspFixture, { props: { state: 'eslint' }, attachTo: document.body })
    await flushPromises()
    const showOverflow = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    document.querySelector<HTMLButtonElement>('[data-lsp-overflow]')!.click()
    const overflow = showOverflow.mock.contexts.at(-1)!
    const analysis = overflow.items.find((item) => item.title === 'Code analysis')!
    expect(analysis.icon).toBe('scan-search')
    analysis.handler?.()
    const menu = show.mock.contexts.at(-1)!
    expect(menu.items.map((item) => item.title)).toContain('ESLint — not set up in this project')
    expect(menu.items.find((item) => item.title === 'TypeScript — running')?.icon).toBe('check')
    expect(
      menu.items.find((item) => item.title === 'ESLint — not set up in this project')?.icon
    ).toBe('circle-alert')
    view.unmount()
  })
  it('keeps failures and recovery in the header and exposes analyser states in its menu', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const view = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const doc = lspFor(document.querySelector('.cm-editor')!)!.document
    doc.error = 'Sample server stopped'
    for (const listener of doc.listeners) listener()
    await nextTick()
    expect(document.querySelector('[data-lsp-analysis]')?.getAttribute('data-state')).toBe('failed')
    expect(document.querySelector('.abele-status-dot_red')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('[data-lsp-analysis] button')!.click()
    const menu = show.mock.contexts.at(-1)!
    expect(menu.items.filter((item) => item.disabled).map((item) => item.title)).toContain(
      'TypeScript — stopped: Sample server stopped'
    )
    expect(document.querySelector('.abele-file-view')?.textContent).not.toContain(
      'Sample server stopped'
    )
    doc.error = ''
    for (const listener of doc.listeners) listener()
    await nextTick()
    expect(document.querySelector('[data-lsp-analysis]')?.getAttribute('data-state')).toBe('ready')
    view.unmount()
  })
  it('keeps missing setup orange when a server includes an explanatory diagnostic', async () => {
    const view = mount(NodeLspFixture, { props: { state: 'eslint' }, attachTo: document.body })
    await flushPromises()
    const doc = lspFor(document.querySelector('.cm-editor')!)!.document
    doc.status.find((status) => status.language === 'eslint')!.diagnostic =
      'Sample configuration missing'
    for (const listener of doc.listeners) listener()
    await nextTick()
    expect(document.querySelector('[data-lsp-analysis]')?.getAttribute('data-state')).toBe(
      'degraded'
    )
    view.unmount()
  })
  it.each([true, false])(
    'offers trust only when the connection advertises that owner action: %s',
    async (owner) => {
      vi.mocked(nodeAdvertisesMethod).mockImplementation(
        (_client, method) => method !== 'project.trust' || owner
      )
      const show = vi.spyOn(Menu.prototype, 'showAtPosition')
      const view = mount(NodeLspFixture, { props: { state: 'untrusted' }, attachTo: document.body })
      await flushPromises()
      document.querySelector<HTMLButtonElement>('[data-lsp-analysis] button')!.click()
      expect(
        show.mock.contexts.at(-1)!.items.some((item) => item.title === 'Trust this folder…')
      ).toBe(owner)
      view.unmount()
    }
  )
})
