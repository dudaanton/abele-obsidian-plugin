import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { Menu, Modal } from 'obsidian'
import TimeEntryItem from '@/components/TimeEntryItem.vue'
import MigrateFromDataviewModal from '@/components/MigrateFromDataviewModal.vue'
import { TimeEntry } from '@/entities/TimeEntry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createTask } from '@/commands/createTask'
import { useVault } from '../helpers/testEnv'

vi.mock('@/commands/createTask', () => ({
  createTask: vi.fn(async () => ({ wikilink: '[[sample-task]]' })),
}))
function sampleEntry() {
  const entry = new TimeEntry({ wikilink: '[[sample-entry]]' })
  entry.loaded = true
  vi.spyOn(entry, 'load').mockResolvedValue()
  return entry
}
let view: VueWrapper | undefined
beforeEach(() => {
  AbeleConfig.getInstance().applySettings(undefined)
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false)
  )
})
afterEach(() => {
  view?.unmount()
  document.querySelectorAll('.modal-container').forEach((el) => el.remove())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function answer(accepted: boolean, label: string, message: string) {
  const dialog = document.querySelector('.abele-modal')!
  expect(dialog?.querySelector('.abele-confirm__message')?.textContent).toBe(message)
  Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => b.textContent === (accepted ? label : 'Cancel'))!
    .click()
}

it.each([false, true])(
  'time-entry removal waits for themed confirmation, accepted=%s',
  async (accepted) => {
    useVault([])
    const entry = sampleEntry()
    const remove = vi.spyOn(entry, 'remove').mockResolvedValue()
    const menu = vi.spyOn(Menu.prototype, 'showAtPosition')
    view = mount(TimeEntryItem, { shallow: true, props: { entry } })
    await view.trigger('contextmenu')
    const shown = menu.mock.instances[0] as unknown as { items: { handler: () => void }[] }
    shown.items[0].handler()
    expect(remove).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
    answer(accepted, 'Delete', 'Are you sure you want to delete this time entry?')
    await flushPromises()
    expect(remove).toHaveBeenCalledTimes(accepted ? 1 : 0)
    entry.cleanup()
  }
)

it.each([false, true])(
  'Dataview import waits for themed confirmation, accepted=%s',
  async (accepted) => {
    const app = useVault([{ path: 'sample-source.md', content: '- [ ] Sample task' }])
    const task = {
      task: true,
      path: 'sample-source.md',
      text: 'Sample task',
      position: { start: { offset: 0 }, end: { offset: 19 } },
    }
    Object.assign(app, {
      plugins: {
        plugins: { dataview: { api: { query: async () => ({ value: { values: [task] } }) } } },
      },
    })
    view = mount(MigrateFromDataviewModal, {
      shallow: true,
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    const state = (view.vm as unknown as { $: { setupState: Record<string, () => Promise<void>> } })
      .$.setupState
    await state.search()
    const write = vi.spyOn(app.vault.adapter, 'write')
    const proceeding = state.promptProceeding()
    expect(write).not.toHaveBeenCalled()
    expect(createTask).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
    answer(
      accepted,
      'Proceed',
      'Do you have backups of your notes? Proceeding will remove tasks from your notes.'
    )
    await proceeding
    expect(createTask).toHaveBeenCalledTimes(accepted ? 1 : 0)
    expect(write).toHaveBeenCalledTimes(accepted ? 1 : 0)
    if (accepted)
      expect(write).toHaveBeenCalledWith(
        'sample-source.md',
        expect.stringContaining('[[sample-task]]')
      )
  }
)

it('closing a confirmation without accepting cancels the pending action', async () => {
  useVault([])
  const entry = sampleEntry()
  const remove = vi.spyOn(entry, 'remove').mockResolvedValue()
  const menu = vi.spyOn(Menu.prototype, 'showAtPosition')
  const modal = vi.spyOn(Modal.prototype, 'open')
  view = mount(TimeEntryItem, { shallow: true, props: { entry } })
  await view.trigger('contextmenu')
  ;(menu.mock.instances[0] as unknown as { items: { handler: () => void }[] }).items[0].handler()
  expect(modal).toHaveBeenCalledOnce()
  ;(modal.mock.instances[0] as Modal).close()
  await flushPromises()
  expect(remove).not.toHaveBeenCalled()
  entry.cleanup()
})
