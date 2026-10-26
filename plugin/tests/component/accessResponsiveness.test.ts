import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import AiScopeEditor from '@/components/AiScopeEditor.vue'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { createMcpServer } from '@/ai/mcp/types'
import { nodeAgentHost } from '@/ai/tools/node/owner'
import { defineComponent, h, onUpdated } from 'vue'

// A paired host with slow inventories. None should be requested by permission controls.
vi.mock('@/ai/tools/node/owner', async (original) => ({
  ...(await original<typeof import('@/ai/tools/node/owner')>()),
  nodeAgentHost: vi.fn(async () => ({
    nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
    connection: () => ({
      client: {
        request: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 300))
          return Array.from({ length: 1000 }, (_, i) => ({
            id: `sample-${i}`,
            session: `session-${i}`,
            worktree: `worktree-${i}`,
          }))
        }),
      },
    }),
  })),
}))

afterEach(() => {
  ScopeResolver.getInstance().destroy()
  vi.restoreAllMocks()
})

it('opens optional tools and two small MCP groups without contacting a slow paired host, and updates only the changed dropdown', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    mcpServers: [0, 1].map((i) =>
      createMcpServer({
        id: `sample-${i}`,
        name: `Sample server ${i}`,
        url: `https://example.com/${i}/mcp`,
        tools: [
          { name: 'sample_read', description: 'Read sample data', inputSchema: { type: 'object' } },
        ],
      })
    ),
  }
  const network = vi.spyOn(globalThis, 'fetch')
  const updated = vi.fn()
  const TrackedDropdown = defineComponent({
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    setup(props, { attrs }) {
      onUpdated(updated)
      return () =>
        h(
          'select',
          { ...attrs, value: props.modelValue },
          props.options.map((option: { value: string; display: string }) =>
            h('option', { value: option.value }, option.display)
          )
        )
    },
  })
  const view = mount(ToolModesEditor, {
    props: { toolModes: {}, collapsed: true, bySection: true },
    global: { stubs: { Dropdown: TrackedDropdown } },
  })
  expect(view.findAll('.abele-tool-modes__row')).toHaveLength(0)
  for (const heading of view.findAll('.abele-fold-heading')) await heading.trigger('click')
  // Node permissions come from folder levels, never this optional-tool editor.
  const groups = view.findAll('.abele-fold-heading__text').map((heading) => heading.text())
  expect(groups).not.toContain('Node')
  expect(groups).not.toContain('Nodes')
  expect(view.text()).not.toContain('Read files and search')
  expect(view.find('.abele-tool-modes__action').exists()).toBe(false)
  expect(view.text()).toContain('Sample server 0')
  expect(view.text()).toContain('Sample server 1')
  updated.mockClear()
  await view.setProps({ toolModes: { fetch: 'ask' } })
  expect(updated).toHaveBeenCalledTimes(1)
  expect(nodeAgentHost).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
  view.unmount()
})

it('does not read vault metadata or mount tool rows for collapsed access groups', () => {
  const app = useVault(Array.from({ length: 20000 }, (_, i) => ({ path: `Notes/Sample ${i}.md` })))
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [] }
  app.resetStats()
  const view = mount(ToolModesEditor, { props: { toolModes: {}, collapsed: true } })
  const reads = app.stats.getFileCache
  const rows = view.findAll('.abele-tool-modes__row').length
  console.log('collapsed access', { metadataReads: reads, toolRows: rows })
  view.unmount()
  expect(reads).toBe(0)
  expect(rows).toBe(0)
})

it('yields before resolving hundreds of overlapping groups in a 20k-note vault', async () => {
  const groups = Array.from({ length: 300 }, (_, i) => ({
    path: `Groups/Sample ${i}.md`,
    frontmatter: { groups: i ? [`[[Groups/Sample ${i - 1}]]`] : [] },
  }))
  const app = useVault([
    ...groups,
    ...Array.from({ length: 20000 }, (_, i) => ({
      path: `Notes/Sample ${i}.md`,
      frontmatter: { groups: ['[[Groups/Sample 299]]'] },
    })),
  ])
  app.resetStats()
  const start = performance.now()
  const view = mount(AiScopeEditor, {
    props: {
      entries: groups.map(({ path }) => ({ type: 'group' as const, path })),
      fullVaultAccess: false,
    },
  })
  const reads = app.stats.getAbstractFileByPath
  console.log('scope mount', {
    ms: Math.round(performance.now() - start),
    pathReads: reads,
    metadataReads: app.stats.getFileCache,
  })
  expect(reads).toBeLessThanOrEqual(200)
  expect(app.stats.getFileCache).toBeLessThanOrEqual(200)
  try {
    await vi.waitFor(() => expect(view.find('progress').exists()).toBe(false), { timeout: 20000 })
    expect(view.findAll('.abele-scope-mgr__entry-type').map((row) => Number(row.text()))).toEqual(
      groups.map((_group, i) => 20300 - i)
    )
    console.log('scope counts complete', { ms: Math.round(performance.now() - start) })
  } finally {
    view.unmount()
  }
}, 25000)
