import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, markRaw, shallowRef, defineComponent, h } from 'vue'
import AiDiscussionAnchor from '@/components/AiDiscussionAnchor.vue'
import { setDiscussionAnchorResolver, type DiscussionAnchorView } from '@/ai/discussionAnchor'
import type { ChatSession } from '@/ai/ChatSession'

const listeners = vi.hoisted(() => new Map<string, (file: { path: string }) => void>())
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        vault: {
          on: (event: string, callback: (file: { path: string }) => void) => {
            listeners.set(event, callback)
            return event
          },
          offref: (event: string) => listeners.delete(event),
        },
      },
    }),
  },
}))
afterEach(() => listeners.clear())
let nextId = 0
const session = () =>
  markRaw({
    id: String(++nextId),
    anchor: ref({ note: 'Sample.md', quote: 'seed' }),
    agent: ref(null),
    toolModes: ref({}),
    permissionMode: ref('confirm-all'),
    messages: ref([]),
  }) as unknown as ChatSession
const view = (over: Partial<DiscussionAnchorView> = {}): DiscussionAnchorView => ({
  quote: 'seed',
  source: { icon: 'file-text', text: 'Sample' },
  context: [{ key: 'note', icon: 'file-text', title: 'Whole note' }],
  ...over,
})

it('starts collapsed, opens the actual context, and folds when another discussion opens', async () => {
  setDiscussionAnchorResolver(async () => view())
  const current = shallowRef(session())
  const wrapper = mount(
    defineComponent({ setup: () => () => h(AiDiscussionAnchor, { session: current.value }) })
  )
  await flushPromises()
  expect(wrapper.find('[aria-expanded="false"]').exists()).toBe(true)
  await wrapper.find('[aria-expanded]').trigger('click')
  expect(wrapper.text()).toContain('Whole note')
  current.value = session()
  await flushPromises()
  expect(wrapper.find('[aria-expanded="false"]').exists()).toBe(true)
  wrapper.unmount()
})

it('keeps long code words wrapped and expandable, and a deleted source has no link', async () => {
  setDiscussionAnchorResolver(async () =>
    view({
      quote: 'const seed = 1\n'.repeat(30),
      code: true,
      source: { icon: 'file-text', text: 'Sample', missing: 'deleted' },
    })
  )
  const wrapper = mount(AiDiscussionAnchor, { props: { session: session() } })
  await flushPromises()
  expect(wrapper.find('.abele-discussion-anchor__quote_code').exists()).toBe(true)
  expect(wrapper.find('.abele-quote__text_preview').exists()).toBe(true)
  expect(wrapper.find('a').exists()).toBe(false)
  expect(wrapper.text()).toContain('deleted')
  wrapper.unmount()
})

it('refreshes changed and deleted source state while open and releases subscriptions', async () => {
  let missing: 'changed' | 'deleted' | undefined
  setDiscussionAnchorResolver(async () =>
    view({ source: { icon: 'file-text', text: 'Sample', missing } })
  )
  const wrapper = mount(AiDiscussionAnchor, { props: { session: session() } })
  await flushPromises()
  missing = 'changed'
  listeners.get('modify')!({ path: 'Sample.md' })
  await flushPromises()
  expect(wrapper.text()).toContain('changed since')
  missing = 'deleted'
  listeners.get('delete')!({ path: 'Sample.md' })
  await flushPromises()
  expect(wrapper.text()).toContain('deleted')
  wrapper.unmount()
  expect(listeners.size).toBe(0)
})

it('refreshes context when the effective permission mode changes', async () => {
  const current = session()
  setDiscussionAnchorResolver(async (session) =>
    view({ context: [{ key: 'mode', icon: 'shield', title: session.permissionMode.value }] })
  )
  const wrapper = mount(AiDiscussionAnchor, { props: { session: current } })
  await flushPromises()
  await wrapper.find('[aria-expanded]').trigger('click')
  expect(wrapper.text()).toContain('confirm-all')
  current.permissionMode.value = 'allow-all'
  await flushPromises()
  expect(wrapper.text()).toContain('allow-all')
  wrapper.unmount()
})
