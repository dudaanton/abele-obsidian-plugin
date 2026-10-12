/**
 * Settings → Nodes: each node a row with its state and address in a quiet line; pairing a node
 * elsewhere and adding the one on this computer are rows of their own, and the local node's
 * name, address and token are asked for in a window.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import NodesSettings from '@/components/settings/NodesSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Button from '@/components/obsidian/Button.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'

const f = vi.hoisted(() => ({ nodes: undefined as unknown }))
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: () => f.nodes } }))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({ activeSession: ref(null), tabOrder: ref([]), getSession: () => null }),
  },
}))

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.replaceChildren()
})

function screen(add = vi.fn(async () => {})) {
  f.nodes = {
    nodes: ref([
      { id: 'sample-up', label: 'Sample desk', url: 'http://127.0.0.1:7777' },
      { id: 'sample-down', label: 'Sample server', url: 'https://sample.invalid' },
    ]),
    connection: (id: string) => ({
      state: ref(id === 'sample-up' ? 'connected' : 'disconnected'),
      error: ref(id === 'sample-up' ? '' : 'node_unreachable'),
      connect: async () => {},
      delegation: {},
    }),
    add,
  }
  wrapper = mount(NodesSettings, {
    global: { stubs: { NodePairingDialog: { template: '<div data-pairing />' } } },
  })
  return { wrapper, add }
}
const setting = (name: string) =>
  wrapper!.findAllComponents(Setting).find((s) => s.props('name') === name)!
const button = (text: string) =>
  wrapper!.findAllComponents(Button).find((b) => b.props('text') === text)!

/** The window's Add, wherever its footer puts it: Cancel comes first there. */
const addButton = (modal: {
  findAllComponents: (c: typeof Button) => { props: (k: string) => unknown }[]
}) =>
  modal.findAllComponents(Button).find((b) => b.props('text') === 'Add') as never as ReturnType<
    typeof modal.findAllComponents
  >[number] & { trigger: (e: string) => Promise<void> }

it('says how each node is doing and where it is, an error code in words', () => {
  screen()
  expect(setting('Sample desk').props('desc')).toBe('Connected · http://127.0.0.1:7777')
  expect(setting('Sample server').props('desc')).toBe('node unreachable · https://sample.invalid')
})

it('pairs a node on another computer from a row of its own', async () => {
  screen()
  await setting('Pair a node on another computer').findComponent(Button).trigger('click')
  expect(wrapper!.find('[data-pairing]').exists()).toBe(true)
})

it('asks for the local node in a window, and closes it once the node is added', async () => {
  const { add } = screen()
  expect(wrapper!.findComponent(ObsidianModal).exists()).toBe(false)
  await setting('Add the node on this computer').findComponent(Button).trigger('click')
  const modal = wrapper!.findComponent(ObsidianModal)
  expect(modal.props('title')).toBe('Add the node on this computer')
  expect(modal.findAllComponents(Setting).map((s) => s.props('name'))).toEqual([
    'Name',
    'Address',
    'Token',
  ])
  const footer = modal.findAllComponents(Button).map((b) => [b.props('text'), b.props('accent')])
  // As Obsidian's dialogs order them: Cancel, then the answer last.
  expect(footer).toEqual([
    ['Cancel', false],
    ['Add', true],
  ])
  // Nothing to add with no token.
  expect(addButton(modal).props('disabled')).toBe(true)
  const token = document.querySelector<HTMLInputElement>(
    'input[aria-label="Node installation token"]'
  )!
  token.value = 'sample-token'
  token.dispatchEvent(new Event('input'))
  await flushPromises()
  await addButton(modal).trigger('click')
  await flushPromises()
  expect(add).toHaveBeenCalledWith('Local node', 'http://127.0.0.1:7777', 'sample-token')
  expect(wrapper!.findComponent(ObsidianModal).exists()).toBe(false)
})

it('keeps the window open and says why when the node cannot be added', async () => {
  screen(vi.fn(async () => Promise.reject(new Error('Sample token refused'))))
  await setting('Add the node on this computer').findComponent(Button).trigger('click')
  const token = document.querySelector<HTMLInputElement>(
    'input[aria-label="Node installation token"]'
  )!
  token.value = 'sample-token'
  token.dispatchEvent(new Event('input'))
  await flushPromises()
  await addButton(wrapper!.findComponent(ObsidianModal)).trigger('click')
  await flushPromises()
  expect(wrapper!.findComponent(ObsidianModal).exists()).toBe(true)
  expect(document.body.textContent).toContain('Sample token refused')
})

it('closes the window with Cancel, adding nothing', async () => {
  const { add } = screen()
  await setting('Add the node on this computer').findComponent(Button).trigger('click')
  await button('Cancel').trigger('click')
  expect(wrapper!.findComponent(ObsidianModal).exists()).toBe(false)
  expect(add).not.toHaveBeenCalled()
})
