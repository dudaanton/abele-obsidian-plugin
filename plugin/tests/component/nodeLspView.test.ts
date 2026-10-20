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
import { computed } from 'vue'
import { Menu } from 'obsidian'
vi.mock('@/node/advertisedMethods', () => ({ nodeAdvertisesMethod: () => true }))
enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

describe('node language diagnostics in the shared file viewer', () => {
  it('anchors the diagnostics list to its header button for pointer and keyboard activation', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const view = mount(NodeLspFixture, { props: { state: 'errors' }, attachTo: document.body })
    await flushPromises()
    const button = [...document.querySelectorAll('.abele-file-view__tools button')].find((button) =>
      button.textContent?.includes('Diagnostics:')
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
    expect(document.body.textContent).toContain('Diagnostics: 2')
    const context = lspFor(code)!
    expect(context.document.listeners.size).toBeGreaterThan(0)
    view.unmount()
    await flushPromises()
    expect(context.document.listeners.size).toBe(0)
  })
  it.each([
    ['missing', 'abele-node lsp install --popular'],
    ['untrusted', 'Trust folder'],
    ['eslint', 'TypeScript analysis remains available.'],
  ] as const)('explains %s without hiding the code', async (state, message) => {
    const view = mount(NodeLspFixture, { props: { state }, attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain(message)
    expect(document.querySelector('.cm-content')?.textContent).toContain('export const sample')
    view.unmount()
  })
})
