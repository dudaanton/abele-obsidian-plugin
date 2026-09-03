/**
 * The second host for a comment card: a dialog, for a pane with no margin and for a phone.
 *
 * happy-dom computes no layout, so nothing here can prove the input stays above the keyboard —
 * that is the screenshot pass. What it can prove is the wiring that decides it: the kit is
 * asked for a sheet rather than a dialog, the card is handed the same entry the marker knows,
 * and the one value that says a card is expanded is set while the sheet lives and put back
 * when it goes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, toRaw } from 'vue'
import CommentSheet from '@/components/CommentSheet.vue'
import { CommentEntry } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

/** The kit modal teleports into a real Obsidian dialog; the slot is all this tier needs. */
const ModalStub = {
  name: 'ObsidianModal',
  props: ['title', 'size'],
  emits: ['close'],
  template: '<div class="modal-stub"><slot /></div>',
}

/** The card has a test of its own; here it stands for "whatever was handed the entry". */
const CardStub = {
  name: 'CommentCard',
  props: ['entry'],
  template: '<div class="card-stub" />',
}

const entry = () =>
  new CommentEntry({
    id: 'vue-1',
    ids: ['k7d2ph'],
    notePath: 'Notes/Anchor.md',
    markerFrom: 20,
  })

const mountSheet = (subject = entry()) =>
  mount(CommentSheet, {
    props: { entry: subject },
    global: { stubs: { ObsidianModal: ModalStub, CommentCard: CardStub } },
  })

beforeEach(() => {
  // The service watches its own `open` and asks each session where its note is, which goes
  // through the comment folder: without a vault and a configuration behind it, expanding a
  // card throws before the sheet is ever asked anything.
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  CommentService.getInstance().destroy()
})

afterEach(() => {
  CommentService.getInstance().destroy()
})

describe('the comment sheet', () => {
  it('titles itself with the note the comment is anchored in', () => {
    const view = mountSheet()

    expect(view.findComponent(ModalStub).props('title')).toBe('Anchor')
  })

  it('asks the kit for a sheet, not for a dialog', () => {
    const view = mountSheet()

    expect(view.findComponent(ModalStub).props('size')).toBe('sheet')
  })

  it('hands the card the entry the marker was pressed on', () => {
    const subject = entry()
    const view = mountSheet(subject)

    // `toRaw`, because a mounted component's props are reactive: the card is handed a proxy
    // of the entry the test made, and identity is the assertion that matters.
    expect(toRaw(view.findComponent(CardStub).props('entry'))).toBe(subject)
  })

  it('expands the card it is showing, everywhere', () => {
    mountSheet()

    // The marker in the text reads the same value, so the icon and the sheet agree.
    expect(CommentService.getInstance().open.value).toBe('k7d2ph')
  })

  it('folds the card again when it closes, and keeps the session', () => {
    const service = CommentService.getInstance()
    // A stand-in for a loaded comment: this tier never opens a file, and what is asserted is
    // that closing a sheet folds a card rather than disposing of the conversation behind it.
    // `destroy()` flushes and disposes of whatever is in the map, so the stub answers both.
    service.sessions.set('k7d2ph', {
      id: 'session-1',
      flush: async () => {},
      destroy: () => {},
    } as unknown as ChatSession)
    const view = mountSheet()

    view.unmount()

    expect(service.open.value).toBeNull()
    expect(service.sessions.get('k7d2ph')).toBeTruthy()
  })

  it('closes when the card is folded from inside it', async () => {
    const view = mountSheet()
    // The sheet expands the card on mount; the watcher has to have seen that before folding
    // means anything, or both changes collapse into one tick that starts and ends at null.
    await nextTick()

    CommentService.getInstance().open.value = null
    await nextTick()

    expect(view.emitted('close')).toHaveLength(1)
  })

  it('leaves a card that belongs to another marker alone when it closes', () => {
    const service = CommentService.getInstance()
    const view = mountSheet()
    service.open.value = '3mq0xa'

    view.unmount()

    expect(service.open.value).toBe('3mq0xa')
  })
})
