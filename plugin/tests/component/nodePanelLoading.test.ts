import { mount, flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import NodePathSidebar from '@/components/nodeWork/NodePathSidebar.vue'
import NodeModes from '@/components/nodeWork/NodeModes.vue'
import StateLine from '@/components/obsidian/StateLine.vue'
import { NodeService } from '@/node/NodeService'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const setup = (loaded = false) => {
  useVault([])
  const model = {
    registrationId: 'sample-registration',
    current: ref({ id: 'sample-tree', projectId: 'sample-project', kind: 'worktree' }),
    currentCopy: ref({ id: 'sample-tree', branch: 'main', kind: 'project' }),
    currentFolder: ref({ name: 'sample-app', git: true }),
    folders: ref([{}]),
    unavailable: ref(false),
    capabilities: ref([]),
    error: ref(''),
    busy: ref(false),
    panelMode: ref('changes'),
    panelBase: ref(''),
    panelBranch: ref(),
    panelHistory: shallowRef(),
    panelPulls: ref(),
    entries: ref([{ name: 'sample.ts', path: 'sample.ts', kind: 'file' }]),
    changes: ref([]),
    inspection: ref(loaded ? { entries: [], changes: [] } : undefined),
    treeProgress: ref({ state: 'reading', count: 1240 }),
    treeCursors: ref({}),
    selectedChat: ref(''),
    gitBusy: ref(''),
    receivedAt: ref(''),
    port: {},
    loadPanelBranch: vi.fn(async () => {}),
  }
  const view = mount(NodePathSidebar, {
    props: {
      model: model as never,
      phase: 'ready',
      node: { name: 'Sample node', status: 'connected' },
    },
  })
  return { model, view }
}
it('shows one pulsing first-load line at the tree edge', () => {
  const { view } = setup()
  expect(view.get('.abele-node-sidebar__first .abele-state-line__text').text()).toBe(
    'Loading changes…'
  )
  expect(view.getComponent(StateLine).props('pulse')).toBe(true)
  expect(view.find('.abele-empty-state').exists()).toBe(false)
  view.unmount()
})
it('keeps the tree on reload and moves the slow count and log into the footer', async () => {
  vi.useFakeTimers()
  const connection = {
    state: ref('connected'),
    client: { channel: { channel: { welcome: { methods: ['node.log.v1.tail'] } } } },
  }
  vi.spyOn(NodeService, 'peekConnection').mockReturnValue(connection as never)
  const { view } = setup(true)
  expect(view.get('.abele-file-tree').exists()).toBe(true)
  expect(view.get('[data-connection-footer]').text()).toContain('Updating changes…')
  await vi.advanceTimersByTimeAsync(3000)
  expect(view.get('[data-connection-footer]').text()).toMatch(
    /Still reading the files….*1.240 so far/
  )
  expect(view.get('[data-connection-footer] a').text()).toBe('Node log')
  expect(view.get('.abele-file-tree').text()).not.toContain('Still reading')
  view.unmount()
})
it('uses the tree empty line with no tab count, while files retain the whole tree', async () => {
  const { model, view } = setup(true)
  model.panelBranch.value = {
    state: { base: 'main', ahead: 0, behind: 0, unpushed: 0 },
    committed: [],
  } as never
  model.treeProgress.value = undefined as never
  await flushPromises()
  expect(view.get('.abele-file-tree .search-empty-state').text()).toBe('Nothing changed.')
  const modes = view.getComponent(NodeModes)
  expect(modes.props('changes')).toBe(0)
  expect(
    modes
      .findAllComponents({ name: 'Icon' })
      .find((icon) => icon.props('icon') === 'file-diff')
      ?.props('textRight')
  ).toBeUndefined()
  model.panelMode.value = 'files'
  await flushPromises()
  expect(view.get('.abele-file-tree').text()).toContain('sample.ts')
  expect(view.text()).not.toContain('Nothing changed.')
  view.unmount()
})
it('keeps first-load files and history wording short', async () => {
  const { model, view } = setup()
  model.panelMode.value = 'files'
  await flushPromises()
  expect(view.get('.abele-node-sidebar__first').text()).toBe('Loading files…')
  Object.assign(model, { loadPanelHistory: async () => {} })
  model.panelHistory.value = { busy: ref(true), commits: ref([]), error: ref('') } as never
  model.panelMode.value = 'history'
  await flushPromises()
  expect(view.get('.abele-node-sidebar__history').text()).toBe('Loading history…')
  view.unmount()
})
it('stops loading when the initial tree read fails and never calls the failure an empty change set', async () => {
  const { model, view } = setup()
  model.entries.value = []
  model.treeProgress.value = { state: 'failed', count: 0, error: 'sample_failure' } as never
  await flushPromises()
  expect(view.text()).not.toContain('Loading changes…')
  expect(view.text()).not.toContain('Nothing changed.')
  expect(view.text()).toContain("Couldn't read the files")
  view.unmount()
})
