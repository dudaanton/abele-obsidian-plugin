/**
 * The join dialog: what a device is asked before it syncs a vault that already has files.
 *
 * Which question it asks is decided before it opens (`join.ts`); what is asserted here is that
 * each one says what will happen in words, that the only question with a choice in it offers the
 * three sides with "merge both" already chosen, that the version that loses is said to be kept,
 * and that nothing is answered by closing it.
 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import JoinVaultModal from '@/components/settings/sync/JoinVaultModal.vue'
import Card from '@/components/obsidian/Card.vue'
import Button from '@/components/obsidian/Button.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Input from '@/components/obsidian/Input.vue'
import type { JoinQuestion } from '@/sync/join'

const question = (over: Partial<JoinQuestion> = {}): JoinQuestion => ({
  kind: 'choose',
  vaultName: 'Home',
  here: { files: 3, settings: 0 },
  there: { files: 5, settings: 0 },
  ...over,
})

const open = (props: Record<string, unknown> = {}) =>
  mount(JoinVaultModal, {
    props: {
      question: question(),
      deviceName: 'Desktop — Home',
      busy: false,
      error: null,
      ...props,
    },
  })
type View = ReturnType<typeof open>

/** What the dialog says: its body is teleported into Obsidian's modal, out of the root's reach. */
const said = (view: View): string =>
  (view.findComponent(ObsidianModal).vm as unknown as { modal: { modalEl: HTMLElement } }).modal
    .modalEl.textContent ?? ''

/** A name typed into the device name field. */
async function typeName(view: View, text: string): Promise<void> {
  view.findComponent(Input).vm.$emit('update:modelValue', text)
  await flushPromises()
}

const choices = (view: View) =>
  view.findAllComponents(Card).map((card) => ({
    title: card.props('title') as string,
    selected: card.props('selected') as boolean,
  }))

const button = (view: View, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)

describe('files on both sides', () => {
  it('offers the three sides, with merge both chosen', () => {
    const view = open()

    expect(choices(view)).toEqual([
      { title: 'Merge both', selected: true },
      { title: 'This device wins', selected: false },
      { title: 'The server wins', selected: false },
    ])
  })

  it('counts both sides, and says the version that loses is kept', () => {
    const view = open()

    expect(said(view)).toContain('Here: 3 files · On the server: 5 files')
    for (const card of view.findAllComponents(Card)) {
      expect(card.props('description')).toContain(
        'The version that loses is kept in Version history'
      )
    }
  })

  it('names the settings among the files, so a vault of nothing but settings is not a mystery', () => {
    const view = open({ question: question({ here: { files: 4, settings: 4 } }) })

    expect(said(view)).toContain('Here: 4 files, 4 of them Obsidian settings')
  })

  it('says so when the server could not be counted', () => {
    const view = open({ question: question({ there: null }) })

    expect(said(view)).toContain('On the server: could not be counted')
  })

  it('connects with the side chosen, and the name typed', async () => {
    const view = open()
    await view.findAllComponents(Card)[2]!.trigger('click')
    await typeName(view, 'Work laptop')

    await button(view, 'Connect')!.trigger('click')

    expect(choices(view).find((c) => c.selected)?.title).toBe('The server wins')
    expect(view.emitted('connect')).toEqual([[{ prefer: 'theirs', deviceName: 'Work laptop' }]])
  })

  it('connects with no side at all for merge both', async () => {
    const view = open()

    await button(view, 'Connect')!.trigger('click')

    expect(view.emitted('connect')).toEqual([[{ prefer: null, deviceName: 'Desktop — Home' }]])
  })

  it('answers nothing when it is cancelled', async () => {
    const view = open()

    await button(view, 'Cancel')!.trigger('click')

    expect(view.emitted('close')).toHaveLength(1)
    expect(view.emitted('connect')).toBeUndefined()
  })
})

describe('files on one side only', () => {
  it('says the files here will be uploaded, and offers no sides', async () => {
    const view = open({ question: question({ there: { files: 0, settings: 0 }, kind: 'upload' }) })

    expect(said(view)).toContain('Its 3 files will be uploaded.')
    expect(view.findAllComponents(Card)).toHaveLength(0)
    await button(view, 'Connect')!.trigger('click')
    expect(view.emitted('connect')).toEqual([[{ prefer: undefined, deviceName: 'Desktop — Home' }]])
  })

  it("says the server's files will be downloaded", () => {
    const view = open({ question: question({ here: { files: 0, settings: 0 }, kind: 'download' }) })

    expect(said(view)).toContain("The server's 5 files will be downloaded.")
    expect(view.findAllComponents(Card)).toHaveLength(0)
  })

  it('says one file, not one files', () => {
    const view = open({
      question: question({ here: { files: 1, settings: 0 }, kind: 'upload' }),
    })

    expect(said(view)).toContain('Its 1 file will be uploaded.')
  })
})

describe('a vault this device synced before', () => {
  it('asks nothing about sides, and says it picks up where it left off', () => {
    const view = open({ question: question({ kind: 'reconnect' }) })

    expect(said(view)).toContain('This device picks up where it left off.')
    expect(view.findAllComponents(Card)).toHaveLength(0)
  })
})

describe('the device name', () => {
  it('cannot connect under no name', async () => {
    const view = open()
    await typeName(view, '  ')

    expect(button(view, 'Connect')!.props('disabled')).toBe(true)
  })

  /** A transfer brought the device, name and all: there is nothing to name. */
  it('is not asked for when the device already has one', async () => {
    const view = open({ deviceName: undefined })

    expect(view.findComponent(Input).exists()).toBe(false)
    await button(view, 'Connect')!.trigger('click')
    expect(view.emitted('connect')).toEqual([[{ prefer: null, deviceName: '' }]])
  })
})

describe('while connecting', () => {
  it('takes no second press, and says why the last one failed', () => {
    const view = open({ busy: true, error: 'the server said no' })

    expect(button(view, 'Connect')!.props('disabled')).toBe(true)
    expect(said(view)).toContain('the server said no')
  })
})
