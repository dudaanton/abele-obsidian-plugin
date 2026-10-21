import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { historyConnection } from '@/sync/tokenHistory'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { shareSetSource, type ConnectionItem } from '@/sync/shareSets'
import ConnectionItems from '@/components/sync/ConnectionItems.vue'
import RemoveCopyModal from '@/components/sync/RemoveCopyModal.vue'

it('keeps the dot beside long status text in a non-wrapping row at phone width', () => {
  const ui = tokenUiFixture()
  const id = ui.rows.value[0].id
  ui.publish(id, {
    transfer: {
      stage: 'Downloading',
      completed: 5,
      total: 720,
      totalKnown: true,
      bytes: 1024,
      totalBytes: 7 * 1024 * 1024,
    },
  })
  const style = document.createElement('style')
  const source = readFileSync('src/components/sync/ConnectionWindow.vue', 'utf8')
  style.textContent = compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]).css
  document.head.append(style)
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    attachTo: document.body,
    global: {
      stubs: {
        Modal: { template: '<div style="width: 320px"><slot /></div>' },
        SelectiveSync: true,
      },
    },
  })
  try {
    const line = view.get('.abele-sync-window__line').element
    const row = line.parentElement!
    expect(row.querySelector('.abele-status-dot')).not.toBeNull()
    expect(row.querySelector('.abele-sync-window__server')).toBeNull()
    expect(getComputedStyle(row).display).toBe('flex')
    expect(getComputedStyle(row).flexWrap).toBe('nowrap')
    expect(getComputedStyle(line).minWidth).toBe('0')
  } finally {
    view.unmount()
    style.remove()
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  historyConnection.value = null
})

it('prints an idle sync time once and keeps the server address only in the title', () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.registry.setStatus(id, 'idle')
  ui.refresh()
  ui.activity.value = { [id]: { lastSync: Date.now() } }
  const host = new URL(ui.rows.value[0].address).host
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: {
      stubs: {
        Modal: { props: ['title'], template: '<section><h1>{{ title }}</h1><slot /></section>' },
        SelectiveSync: true,
      },
    },
  })
  try {
    expect(view.get('.abele-sync-window__line').text()).toMatch(/^Synced /)
    expect(view.findAll('.abele-sync-window__server')).toHaveLength(0)
    expect(view.text().split(host)).toHaveLength(2)
  } finally {
    view.unmount()
  }
})

it('waits for fresh edited-copy counts before opening the removal confirmation', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const item: ConnectionItem = {
    id: 'detached-a',
    path: 'Sample',
    kind: 'folder',
    state: { kind: 'detached' },
    files: 2,
    edited: 0,
  }
  let resolve!: (item: ConnectionItem) => void
  const pending = new Promise<ConnectionItem>((done) => {
    resolve = done
  })
  vi.spyOn(ui.itemSets, 'items').mockReturnValue([item])
  const preview = vi.spyOn(ui.itemSets, 'previewCopy').mockReturnValue(pending)
  const before = shareSetSource.value
  shareSetSource.value = ui.itemSets
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: {
      stubs: {
        Modal: { template: '<div><slot /></div>' },
        SelectiveSync: true,
        RemoveCopyModal: true,
      },
    },
  })
  try {
    view.getComponent(ConnectionItems).vm.$emit('remove-copy', item)
    await flushPromises()
    expect(preview).toHaveBeenCalledWith(id, item.id)
    expect(view.findComponent(RemoveCopyModal).exists()).toBe(false)
    resolve({ ...item, edited: 1 })
    await flushPromises()
    expect(view.getComponent(RemoveCopyModal).props('item').edited).toBe(1)
  } finally {
    view.unmount()
    shareSetSource.value = before
  }
})

it('offers explicit confirmed recovery for a missing kept copy', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.publish(id, { missingKeptCopies: ['Sample/Missing.md'] })
  const forget = vi.fn(async () => {})
  ui.forgetMissingKeptCopy = forget
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: {
      stubs: {
        Modal: { template: '<div><slot /></div>' },
        SelectiveSync: true,
        ConfirmModal: {
          template: '<button class="confirm-forget" @click="$emit(\'confirm\')">Confirm</button>',
        },
      },
    },
  })
  const button = view.findAll('button').find((one) => one.text() === 'Forget this kept copy')
  expect(button).toBeDefined()
  await button!.trigger('click')
  expect(forget).not.toHaveBeenCalled()
  await view.get('.confirm-forget').trigger('click')
  await flushPromises()
  expect(forget).toHaveBeenCalledWith('Sample/Missing.md')
  view.unmount()
})

it('shows the shared transfer line, current path and timed recent activity', () => {
  const ui = tokenUiFixture()
  const id = ui.rows.value[0].id
  ui.publish(id, {
    transfer: {
      stage: 'Downloading',
      completed: 2,
      total: 3,
      totalKnown: true,
      bytes: 2048,
      totalBytes: 4096,
      currentFile: 'Notes/sample.md',
    },
    events: [
      { at: 1000, text: 'Downloaded Notes/earlier.md' },
      { at: 2000, text: 'Not sent Notes/unsent.md: quota_exceeded' },
    ],
  })
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: { stubs: { Modal: { template: '<div><slot /></div>' }, SelectiveSync: true } },
  })
  try {
    expect(view.find('.abele-sync-window__line').text()).toBe(
      'Downloading · 2 of 3 files · 2 of 4 KB'
    )
    expect(view.find('progress').attributes('aria-label')).toBe('2 of 3')
    expect(view.text()).toContain('Notes/sample.md')
    expect(view.findAll('.abele-sync-window__time')).toHaveLength(2)
    expect(view.text()).toContain('Downloaded Notes/earlier.md')
    expect(view.text()).toContain('Not sent Notes/unsent.md')
    expect(view.text()).toContain('command palette')
  } finally {
    view.unmount()
  }
})

it('gives held deletes and staged settings the opened connection port', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const port = {
    settingsPrompt: {
      refresh: vi.fn(async () => {}),
      staged: ref([{ path: '.obsidian/sample.json' }]),
    },
  }
  vi.spyOn(TokenSettingsPort, 'forConnection').mockReturnValue(port as never)
  ui.runtimes.set(id, {
    heldDeletes: async () => [{ fileId: 'sample', path: 'sample.md' }],
  } as never)
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: {
      stubs: {
        Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        HeldDeletesBlock: true,
        StagedSettingsBlock: true,
        SelectiveSync: true,
      },
    },
  })
  try {
    await flushPromises()
    expect(view.findComponent({ name: 'HeldDeletesBlock' }).props('port')).toBe(port)
    expect(view.findComponent({ name: 'StagedSettingsBlock' }).props('port')).toBe(port)
    const trust = view.findAll('.setting-item').find((one) => one.text().includes('Trusted'))!
    expect(trust.text()).toContain('incoming code')
    await trust.find('[role="checkbox"]').trigger('click')
    expect(ui.registry.records().find((one) => one.id === id)?.trusted).toBe(true)
  } finally {
    view.unmount()
  }
})

it('shows first-pull stage and counts as quiet visible text', () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.publish(id, { pull: { stage: 'Receiving files', completed: 3, total: 12 } })
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: { stubs: { Modal: { template: '<div><slot /></div>' }, SelectiveSync: true } },
  })
  try {
    expect(view.find('.abele-sync-window__progress').text()).toBe('Receiving files · 3 of 12')
  } finally {
    view.unmount()
  }
})
