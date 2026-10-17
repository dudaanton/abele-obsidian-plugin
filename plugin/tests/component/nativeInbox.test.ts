import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NativeNotifications from '@/components/github/NativeNotifications.vue'
import { useVault } from '../helpers/testEnv'
import { reactive } from 'vue'
import { NotificationsView } from '@/github/notifications/NotificationsView'
import { WorkspaceLeaf } from 'obsidian'
it('labels an unavailable saved account in the single inbox selector', async () => {
  const app = useVault([]),
    view = new NotificationsView(new WorkspaceLeaf())
  view.app = app as never
  Object.defineProperty(view, 'contentEl', { value: view.containerEl.children[1] })
  await view.setState({ connection: 'missing-sample', inboxVersion: 1 }, { history: false })
  await view.onOpen()
  try {
    await flushPromises()
    const selected = view.contentEl.querySelector('select')?.selectedOptions[0]
    expect(selected?.textContent).toBe('Unavailable connection')
  } finally {
    await view.onClose()
  }
})
it('reloads when a saved inbox filter is restored', async () => {
  useVault([])
  const state = reactive({ which: 'all' as 'all' | 'unread', repo: '' })
  const inbox = { load: vi.fn().mockResolvedValue({ items: [], cutoff: '', complete: true }) }
  const view = mount(NativeNotifications, { props: { inbox: inbox as never, state } })
  await flushPromises()
  state.which = 'unread'
  await flushPromises()
  expect(inbox.load).toHaveBeenLastCalledWith('unread')
  view.unmount()
})
it('shows Read but no Done and keeps mutations separate from opening', async () => {
  useVault([])
  const row = {
    id: '7',
    repo: 'sample/project',
    title: 'Sample notification',
    type: 'Issue',
    unread: true,
    pinned: false,
    updatedAt: '',
    url: 'https://git.example.test/sample/project/issues/7',
    tab: true,
  }
  const inbox = {
    load: vi.fn().mockResolvedValue({ items: [row], cutoff: '', complete: true }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    open: vi.fn().mockReturnValue({ url: row.url, tab: true }),
  }
  const view = mount(NativeNotifications, {
    props: { inbox: inbox as never, state: { which: 'all', repo: '' } },
  })
  await flushPromises()
  expect(view.text()).toContain('Sample notification')
  expect(view.find('select').text()).toContain('All repositories')
  expect(view.find('[aria-label="Done"]').exists()).toBe(false)
  await view.find('.abele-native-notification__read').trigger('click')
  await flushPromises()
  expect(inbox.markRead).toHaveBeenCalledWith(row)
  expect(inbox.open).not.toHaveBeenCalled()
  await view
    .find('.abele-github-notification__self')
    .trigger('click', { ctrlKey: true, metaKey: true })
  expect(view.emitted('open')?.at(-1)).toEqual([row.url, true, 'tab'])
  view.unmount()
})
