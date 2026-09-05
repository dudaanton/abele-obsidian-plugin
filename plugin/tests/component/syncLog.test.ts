/**
 * The sync log, as the dialog behind the status bar shows it.
 *
 * The buffer is the service's own array, mutated in place, and this dialog is a window onto it
 * rather than a copy — so a sync running while it is open writes into the list being read.
 * Copy is the point of the dialog: a sync failure is a thing somebody reports, and a log they
 * have to retype is a log nobody sends.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import SyncLogModal from '@/components/sync/SyncLogModal.vue'
import Button from '@/components/obsidian/Button.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { useVault } from '../helpers/testEnv'

/** The dialog itself is Obsidian's; unwrapping it puts the body where a query can reach it. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS }),
  log: ref<string[]>([]),
  isConnected: vi.fn(() => true),
  client: vi.fn(() => null),
  syncNow: vi.fn(),
  note: vi.fn(),
}

const open = () => mount(SyncLogModal, { global: { stubs: STUBS } })

/** A clipboard of our own, since happy-dom ships none. */
const clipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

beforeEach(() => {
  useVault([])
  service.log.value = []
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the sync log', () => {
  it('says nothing has happened rather than showing an empty block', () => {
    const screen = open()

    expect(screen.findComponent(EmptyState).exists()).toBe(true)
    expect(screen.find('.abele-sync-log__feed').exists()).toBe(false)
  })

  it('shows the buffer oldest first, so the newest line is at the bottom', () => {
    service.log.value = ['first', 'second', 'third']
    const screen = open()

    expect(screen.findAll('.abele-sync-log__line').map((line) => line.text())).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  /** The service mutates its array in place; a dialog holding a copy would freeze at open. */
  it('takes up a line written while it is open', async () => {
    service.log.value = ['first']
    const screen = open()

    service.log.value.push('second')
    await flushPromises()

    expect(screen.findAll('.abele-sync-log__line')).toHaveLength(2)
  })

  it('puts the whole log on the clipboard', async () => {
    const writeText = clipboard()
    service.log.value = ['first', 'second']
    const screen = open()

    await screen.findComponent(Button).trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('first\nsecond')
  })

  it('offers nothing to copy when there is nothing to copy', () => {
    const screen = open()

    expect(screen.findComponent(Button).props('disabled')).toBe(true)
  })
})
