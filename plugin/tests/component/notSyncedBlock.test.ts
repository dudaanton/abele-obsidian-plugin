import { expect, it } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import NotSyncedBlock from '@/components/sync/NotSyncedBlock.vue'
import PathLabel from '@/components/obsidian/PathLabel.vue'
import { Platform } from 'obsidian'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import StatusDot from '@/components/obsidian/StatusDot.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { shareSetSource } from '@/sync/shareSets'
import { historyConnection } from '@/sync/tokenHistory'
import type { NotSyncedItem } from '@/sync/notSynced'

const item: NotSyncedItem = {
  path: 'Notes/sample.md',
  kind: 'held',
  direction: 'in',
  since: '2026-01-01T00:00:00Z',
}
it('keeps the not-synced count and warning above a mixed shared-set synced summary', () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const previous = shareSetSource.value,
    selected = historyConnection.value
  shareSetSource.value = {
    items: () => [
      { id: 'sample-detached', kind: 'folder', path: 'Dropped', state: { kind: 'detached' } },
      { id: 'sample-active', kind: 'folder', path: 'Active', state: { kind: 'synced' } },
    ],
  } as never
  ui.registry.setStatus(id, 'idle')
  ui.refresh()
  ui.activity.value = { [id]: { notSynced: [item] } }
  const view = shallowMount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: { stubs: { Modal: { template: '<main><slot /></main>' } } },
  })
  try {
    expect(view.find('.abele-sync-window__line').text()).toBe('1 file not synced')
    expect(view.findComponent(StatusDot).props('tone')).toBe('orange')
  } finally {
    view.unmount()
    shareSetSource.value = previous
    historyConnection.value = selected
  }
})
it('shortens a long path in the shared kit while retaining its full detail', async () => {
  const path = 'Projects/Research/Collected sources/Long reference folder/Working notes/sample.md'
  const view = mount(PathLabel, { props: { path, maxLength: 32 } })
  expect(view.find('.abele-path-label__path').text()).toContain('…')
  expect(view.find('.abele-path-label__path').text().length).toBeLessThanOrEqual(32)
  await view.find('[role=button]').trigger('click')
  expect(view.text()).toContain(path)
  view.unmount()
})
it('shows folder and fact in one plain metadata line on phone', () => {
  const saved = Platform.isMobile
  Reflect.set(Platform, 'isMobile', true)
  const view = mount(NotSyncedBlock, {
    props: {
      items: [
        {
          ...item,
          path: 'Projects/Research/Collected material/Long working folder/sample.md',
          fact: 'changed while it was being placed',
        },
      ],
    },
  })
  try {
    expect(view.find('.abele-not-synced__meta').text()).toBe(
      'Projects/Research/Collected material/Long working folder · changed while it was being placed · since Jan 1'
    )
    expect(view.findComponent(PathLabel).exists()).toBe(false)
  } finally {
    view.unmount()
    Reflect.set(Platform, 'isMobile', saved)
  }
})
it('hides an empty list and exposes its unreadable state', async () => {
  const view = mount(NotSyncedBlock, { props: { items: [] } })
  expect(view.text()).toBe('')
  await view.setProps({ error: true, items: [item] })
  expect(view.find('[role=alert]').text()).toContain('Could not read')
  expect(view.findAll('.abele-not-synced__row')).toHaveLength(0)
  view.unmount()
})
it.each(['', 'invalid', '1970-01-01T00:00:00Z'])('omits an unavailable since date: %s', (since) => {
  const view = mount(NotSyncedBlock, { props: { items: [{ ...item, since }] } })
  expect(view.find('.abele-not-synced__meta').text()).toBe('Notes')
  view.unmount()
})
it('renders a thousand-entry group in bounded pages and retries the selected row', async () => {
  const rows = Array.from({ length: 1243 }, (_, n) => ({ ...item, path: `Notes/sample-${n}.md` }))
  const view = mount(NotSyncedBlock, { props: { items: rows } })
  expect(view.findAll('.abele-not-synced__row')).toHaveLength(50)
  expect(view.text()).toContain('1,243')
  const retries = view.findAll('[data-icon=refresh-cw]')
  if (retries.length) await retries[0].trigger('click')
  view.unmount()
})
it('keeps the full path in row details and emits a scoped retry', async () => {
  const view = mount(NotSyncedBlock, { props: { items: [item] } })
  const retry = view.findAll('a').find((link) => link.text() === 'Retry')!
  await retry.trigger('click')
  expect(view.emitted('retry')).toEqual([[[item.path]]])
  expect(view.text()).toContain('Notes')
  view.unmount()
})
