import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { computed } from 'vue'
import { Menu } from 'obsidian'
import NodeLspTools from '@/components/nodeWork/NodeLspTools.vue'
import FileView from '@/components/nodeWork/FileView.vue'
import GithubBlob from '@/components/github/GithubBlob.vue'
import { LSP_CONNECTION } from '@/node/lspConnection'
import { NodeService } from '@/node/NodeService'
import { REPOSITORY_SOURCE } from '@/repository/context'

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-linked-worktree',
}
function client() {
  return {
    describe: vi.fn(async () => ({
      capabilities: { capabilities: { lsp_v1: { status: 'supported' } } },
    })),
    subscribe: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
    lsp: {
      status: vi.fn(async () => [{ language: 'typescript', found: true }]),
      open: vi.fn(async () => ({ servers: ['typescript'] })),
      close: vi.fn(async () => {}),
      diagnostics: vi.fn(async () => []),
    },
  }
}
function menu(host: HTMLElement) {
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  host.querySelector<HTMLButtonElement>('[data-lsp-analysis] button')!.click()
  return show.mock.contexts
    .at(-1)!
    .items.map((item) => item.title)
    .join('\n')
}
function tools(fake = client(), props = {}, connected = true) {
  const host = document.body.appendChild(document.createElement('div'))
  const view = mount(NodeLspTools, {
    props: {
      root: document.createElement('div'),
      glyphHost: host,
      target,
      path: 'src/sample.test.ts',
      text: 'sample',
      ...props,
    },
    global: {
      provide: connected
        ? { [LSP_CONNECTION as symbol]: { client: fake, connect: async () => {} } }
        : {},
    },
  })
  return {
    host,
    view,
    fake,
    dispose: () => {
      view.unmount()
      host.remove()
    },
  }
}
describe('analysis admission explanations', () => {
  it('keeps the glyph when file contents are omitted', async () => {
    const view = mount(FileView, {
      props: {
        path: 'sample.ts',
        text: '',
        codeTarget: target,
        change: {
          kind: 'modified',
          path: 'sample.ts',
          before: '',
          after: '',
          added: 0,
          removed: 0,
          previewNote: 'Sample content omitted',
        },
      },
      global: { stubs: { SelectionBar: true, NodeFileTools: true } },
      attachTo: document.body,
    })
    await flushPromises()
    expect(view.findComponent(NodeLspTools).exists()).toBe(true)
    expect(menu(view.element)).toContain('File contents are not available for analysis.')
  })
  it('keeps an explanation when a repository connection is not known', () => {
    vi.spyOn(NodeService, 'connectionIfKnown').mockReturnValue(undefined)
    const view = mount(GithubBlob, {
      props: {
        text: 'sample',
        file: { host: '', owner: '', repo: '', ref: 'Working tree', path: 'sample.ts' },
      },
      global: {
        provide: {
          [REPOSITORY_SOURCE as symbol]: computed(() => ({
            identity: {
              provider: 'node',
              installation: 'sample-installation',
              node: target.registrationId,
              project: target.projectId,
              workspace: target.id,
            },
          })),
        },
        stubs: { NodeLspTools: true, GithubCode: true },
      },
    })
    expect(view.findComponent(NodeLspTools).exists()).toBe(true)
    expect(view.getComponent(NodeLspTools).props('disabledReason')).toBe('noConnection')
  })
  it.each([
    ['offline', { offline: true }, 'The node is offline.'],
    ['past revision', { disabledReason: 'pastRevision' }, 'This view is a past revision.'],
    ['comparison', { disabledReason: 'comparison' }, 'Open the file view to analyze code.'],
    ['large file', { text: '界'.repeat(180000) }, 'File too large for analysis (limit: 512 KiB).'],
  ])('explains %s in the glyph menu without opening a buffer', async (_name, props, reason) => {
    const f = tools(client(), props)
    await flushPromises()
    expect(f.host.querySelector('[data-lsp-analysis]')?.getAttribute('data-state')).toBe('off')
    expect(menu(f.host)).toContain(reason)
    expect(f.fake.lsp.open).not.toHaveBeenCalled()
    f.dispose()
  })
  it('settles a missing connection with an explanation', async () => {
    vi.spyOn(NodeService, 'connectionIfKnown').mockReturnValue(undefined)
    const f = tools(client(), {}, false)
    await flushPromises()
    expect(menu(f.host)).toContain('No connection to this node is available.')
    expect(f.host.querySelector('[data-lsp-analysis]')?.getAttribute('data-state')).toBe('off')
    f.dispose()
  })
  it('explains a node without language analysis', async () => {
    const fake = client()
    fake.describe.mockResolvedValue({ capabilities: { capabilities: {} } } as never)
    const f = tools(fake)
    await flushPromises()
    expect(menu(f.host)).toContain('Code analysis is not available on this node.')
    f.dispose()
  })
  it('shows a describe timeout and offers retry even before capability discovery', async () => {
    const fake = client()
    fake.describe.mockRejectedValueOnce(new Error('Sample description timeout'))
    const f = tools(fake)
    await flushPromises()
    expect(menu(f.host)).toContain('Sample description timeout')
    expect(menu(f.host)).toContain('Restart analysis')
    f.dispose()
  })
  it('does not label installed analyzers running when none accepts the file', async () => {
    const fake = client()
    fake.lsp.open.mockResolvedValue({ servers: [] })
    const f = tools(fake)
    await flushPromises()
    expect(menu(f.host)).toContain('No language server accepted this file.')
    expect(menu(f.host)).not.toContain('TypeScript — running')
    f.dispose()
  })
  it('passes the worktree identity for a test file, never the project identity or branch name', async () => {
    const f = tools()
    await flushPromises()
    expect(f.fake.lsp.status).toHaveBeenCalledWith({ worktree_id: target.id })
    expect(f.fake.lsp.open).toHaveBeenCalledWith(
      { worktree_id: target.id },
      'src/sample.test.ts',
      'sample',
      undefined,
      expect.any(AbortSignal)
    )
    f.dispose()
  })
  it('keeps analysis visible for a modified worktree file opened as a comparison', async () => {
    const view = mount(FileView, {
      props: {
        path: 'src/sample.test.ts',
        text: 'after',
        codeTarget: target,
        mode: 'diff',
        change: {
          path: 'src/sample.test.ts',
          before: 'before',
          after: 'after',
          kind: 'modified',
        } as never,
      },
      global: {
        stubs: {
          Diff: { template: '<div><slot name="title" /></div>' },
          SelectionBar: true,
          NodeFileTools: true,
        },
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(view.findComponent(NodeLspTools).exists()).toBe(true)
    expect(menu(view.element)).toContain('Open the file view to analyze code.')
  })
  it.each(['WORKTREE', 'working-sample-observation', 'sample-commit'])(
    'keeps the node glyph present for repository ref %s',
    async (ref) => {
      vi.spyOn(NodeService, 'connectionIfKnown').mockReturnValue({
        client: { target: { expected_node_id: target.nodeId } },
      } as never)
      const view = mount(GithubBlob, {
        props: { text: 'sample', file: { host: '', owner: '', repo: '', ref, path: 'sample.ts' } },
        global: {
          provide: {
            [REPOSITORY_SOURCE as symbol]: computed(() => ({
              identity: {
                provider: 'node',
                installation: 'sample-installation',
                node: target.registrationId,
                project: target.projectId,
                workspace: target.id,
              },
            })),
          },
          stubs: { NodeLspTools: true, GithubCode: true },
        },
      })
      expect(view.findComponent(NodeLspTools).exists()).toBe(true)
      expect(view.getComponent(NodeLspTools).props('disabledReason')).toBe(
        ref === 'sample-commit' ? 'pastRevision' : undefined
      )
    }
  )
})
