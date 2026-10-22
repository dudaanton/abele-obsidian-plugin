import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { Text } from '@codemirror/state'
import { lspOffset } from '@/node/lspExtension'
import { lspFor } from '@/node/lspContext'
import NodeLspFixture from '@/testing/NodeLspFixture.vue'
import GithubBlob from '@/components/github/GithubBlob.vue'
import NodeLspTools from '@/components/nodeWork/NodeLspTools.vue'
import { NodeService } from '@/node/NodeService'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { computed, ref, nextTick } from 'vue'
import { Menu } from 'obsidian'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import NodeFileTools from '@/components/nodeWork/NodeFileTools.vue'
import { LSP_CONNECTION } from '@/node/lspConnection'
vi.mock('@/node/advertisedMethods', () => ({ nodeAdvertisesMethod: () => true }))
enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

describe('node language diagnostics in the shared file viewer', () => {
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
    expect(document.body.textContent).toContain('Language server missing')
    const button = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Install popular servers')
    )!
    button.click()
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
    const button = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Install popular servers')
    )!
    button.click()
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
      expect(document.body.textContent).toContain('TypeScript analysis remains available.')
      expect(document.querySelector('[data-lsp-diagnostics]')).not.toBeNull()
      view.unmount()
    }
  )
  it.each([
    ['missing', 'abele-node lsp install --popular'],
    ['untrusted', 'Trust folder'],
    ['eslint', 'TypeScript analysis remains available.'],
  ] as const)('explains %s without hiding the code', async (state, message) => {
    const view = mount(NodeLspFixture, { props: { state }, attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain(message)
    if (state !== 'eslint') expect(document.querySelector('[data-lsp-diagnostics]')).toBeNull()
    expect(document.querySelector('.cm-content')?.textContent).toContain('export const sample')
    view.unmount()
  })
})
