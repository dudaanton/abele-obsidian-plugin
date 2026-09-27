/**
 * The question about many files deleted at once on this device (phase 3b, decision 8).
 *
 * The engine holds such deletes back until somebody decides. What is asserted here: the dialog
 * says how many and shows the first twenty, "Delete everywhere" asks first and "Put them back"
 * does not, the decision names exactly the files shown, and what is said afterwards matches what
 * happened — including a decision taken while sync is paused, which is carried out on Resume.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Notice } from 'obsidian'
import type { HeldDelete } from '@abele/sync-core'
import HeldDeletesModal from '@/components/sync/HeldDeletesModal.vue'
import HeldDeletesBlock from '@/components/sync/HeldDeletesBlock.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { useVault } from '../helpers/testEnv'

/** The dialog itself is Obsidian's; unwrapping it puts the body where a query can reach it. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

const heldOf = (count: number): HeldDelete[] =>
  Array.from({ length: count }, (_, n) => ({ path: `Notes/Note ${n}.md`, fileId: `f${n}` }))

const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS, state: 'idle' }),
  decideDeletes: vi.fn(),
  note: vi.fn(),
  heldPrompt: { decided: ref<{ kind: 'confirm' | 'restore'; count: number } | null>(null) },
}

const open = (held: HeldDelete[]) =>
  mount(HeldDeletesModal, { props: { held }, global: { stubs: STUBS } })
type View = ReturnType<typeof open>

const button = (view: View, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)

beforeEach(() => {
  useVault([])
  Notice.shown.length = 0
  service.status.value = { ...DISCONNECTED_STATUS, state: 'idle' }
  service.heldPrompt.decided.value = null
  service.decideDeletes.mockImplementation(async (_kind: string, ids: string[]) => ({
    decided: ids.length,
    applied: true,
  }))
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the held deletes dialog', () => {
  it('says how many, and shows the first twenty with how many more', () => {
    const view = open(heldOf(312))

    expect(view.text()).toContain('312 files were deleted on this device at once')
    const rows = view.findAllComponents(TreeItem)
    expect(rows).toHaveLength(20)
    expect(rows[0]!.props('text')).toBe('Notes/Note 0.md')
    expect(view.text()).toContain('and 292 more')
  })

  it('names one file as one', () => {
    const view = open(heldOf(1))

    expect(view.text()).toContain('1 file was deleted on this device')
    expect(view.text()).not.toContain('more')
  })

  it('asks before deleting everywhere, and then sends exactly the files shown', async () => {
    const view = open(heldOf(60))

    await button(view, 'Delete everywhere')!.trigger('click')
    expect(service.decideDeletes).not.toHaveBeenCalled()
    const confirm = view.findComponent(ConfirmModal)
    expect(confirm.props('message')).toMatch(/server's trash/)
    expect(confirm.props('message')).toMatch(/every device/)

    confirm.vm.$emit('confirm')
    await flushPromises()

    expect(service.decideDeletes).toHaveBeenCalledWith(
      'confirm',
      heldOf(60).map((one) => one.fileId)
    )
    expect(Notice.shown.some((text) => text.includes('60 files were deleted everywhere'))).toBe(
      true
    )
    expect(view.emitted('close')).toBeTruthy()
  })

  it('puts them back without asking', async () => {
    const view = open(heldOf(60))

    await button(view, 'Put them back')!.trigger('click')
    await flushPromises()

    expect(service.decideDeletes).toHaveBeenCalledWith(
      'restore',
      heldOf(60).map((one) => one.fileId)
    )
    expect(Notice.shown.some((text) => text.includes('60 files are coming back'))).toBe(true)
  })

  it('says a decision taken while paused is carried out on Resume', async () => {
    service.decideDeletes.mockResolvedValue({ decided: 60, applied: false })
    service.status.value = { ...service.status.value, state: 'paused' }
    const view = open(heldOf(60))

    await button(view, 'Put them back')!.trigger('click')
    await flushPromises()

    expect(Notice.shown.some((text) => text.includes('when sync is resumed'))).toBe(true)
  })

  it('says so when none of them is held any more', async () => {
    service.decideDeletes.mockResolvedValue({ decided: 0, applied: false })
    const view = open(heldOf(3))

    await button(view, 'Put them back')!.trigger('click')
    await flushPromises()

    expect(Notice.shown.some((text) => text.includes('no longer held'))).toBe(true)
  })

  it('leaves them held when put off, deciding nothing', async () => {
    const view = open(heldOf(60))

    await button(view, 'Decide later')!.trigger('click')

    expect(service.decideDeletes).not.toHaveBeenCalled()
    expect(view.emitted('close')).toBeTruthy()
  })

  it('keeps the question open with the reason when the decision fails', async () => {
    service.decideDeletes.mockRejectedValue(new Error('the database closed'))
    const view = open(heldOf(3))

    await button(view, 'Put them back')!.trigger('click')
    await flushPromises()

    expect(view.text()).toContain('the database closed')
    expect(view.emitted('close')).toBeFalsy()
  })
})

describe('the held deletes block on the Sync tab', () => {
  it('says an answer is waiting for Resume, and that answering again replaces it', () => {
    service.status.value = { ...service.status.value, state: 'paused' }
    service.heldPrompt.decided.value = { kind: 'confirm', count: 60 }
    const view = mount(HeldDeletesBlock, { props: { held: heldOf(60) }, global: { stubs: STUBS } })

    expect(view.text()).toContain(
      'Decided: delete everywhere (60 files), carried out when sync is resumed. Answering again replaces it.'
    )
  })

  it('deletes everywhere exactly the files its confirmation named, though the hold grew', async () => {
    const view = mount(HeldDeletesBlock, { props: { held: heldOf(60) }, global: { stubs: STUBS } })

    await button(view as never, 'Delete everywhere')!.trigger('click')
    await view.setProps({ held: heldOf(80) })
    const confirm = view.findComponent(ConfirmModal)
    expect(confirm.props('title')).toBe('Delete 60 files everywhere?')

    confirm.vm.$emit('confirm')
    await flushPromises()

    expect(service.decideDeletes).toHaveBeenCalledWith(
      'confirm',
      heldOf(60).map((one) => one.fileId)
    )
  })

  it('puts back exactly the files shown when pressed, though the hold grew', async () => {
    let finish: (value: unknown) => void = () => undefined
    service.decideDeletes.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const view = mount(HeldDeletesBlock, { props: { held: heldOf(5) }, global: { stubs: STUBS } })

    await button(view as never, 'Put them back')!.trigger('click')
    await view.setProps({ held: heldOf(9) })
    finish({ decided: 5, applied: true })
    await flushPromises()

    expect(service.decideDeletes).toHaveBeenCalledWith(
      'restore',
      heldOf(5).map((one) => one.fileId)
    )
  })

  it('lists the files as rows that are read, not tab stops that do nothing', () => {
    const view = mount(HeldDeletesBlock, { props: { held: heldOf(3) }, global: { stubs: STUBS } })

    const rows = view.findAll('.tree-item-self')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.attributes('tabindex')).toBeUndefined()
      expect(row.classes()).not.toContain('is-clickable')
    }
  })

  it('offers the same two answers, and no putting off', () => {
    const view = mount(HeldDeletesBlock, { props: { held: heldOf(5) }, global: { stubs: STUBS } })

    const texts = view.findAllComponents(Button).map((b) => b.props('text'))
    expect(texts).toContain('Delete everywhere')
    expect(texts).toContain('Put them back')
    expect(texts).not.toContain('Decide later')
  })
})
