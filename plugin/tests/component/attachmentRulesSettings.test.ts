/**
 * The Attachment folders group in the Other settings, drawn as Obsidian draws its own "Default
 * location for new attachments": per rule a «Notes in» row with the folder and a bin, and an
 * «Attachments go to» row with Obsidian's three choices and the field the choice needs. A plus
 * beside the heading adds a rule; with none, one muted line and a button say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AttachmentRulesSettings from '@/components/settings/AttachmentRulesSettings.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Search from '@/components/obsidian/Search.vue'
import Input from '@/components/obsidian/Input.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import type { AttachmentRule } from '@/media/attachmentRules'
import { AbeleConfig } from '@/services/AbeleConfig'
import { configureAbele, useVault } from '../helpers/testEnv'

let config: AbeleConfig
let view: VueWrapper | null = null

beforeEach(() => {
  vi.useFakeTimers()
  useVault([])
  config = configureAbele()
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  view?.unmount()
  view = null
  config.attachmentRules = []
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const rule = (
  notesFolder: string,
  location: AttachmentRule['location'],
  attachmentsFolder = '',
  subfolder = ''
): AttachmentRule => ({ notesFolder, location, attachmentsFolder, subfolder })

const rowsOf = (v: VueWrapper, cls: string) =>
  v.findAllComponents(Setting).filter((s) => s.classes(`abele-attachment-rules__${cls}`))
const notesRows = (v: VueWrapper) => rowsOf(v, 'notes')
const placeRows = (v: VueWrapper) => rowsOf(v, 'place')
const addIcon = (v: VueWrapper) =>
  v
    .findComponent(Section)
    .findAllComponents(Icon)
    .find((i) => i.props('icon') === 'plus')!

const settle = async () => {
  vi.advanceTimersByTime(600)
  await nextTick()
}

describe('attachment folder rules settings', () => {
  it('says rules are absent in one muted line with a button to add one', async () => {
    view = mount(AttachmentRulesSettings)
    expect(notesRows(view)).toHaveLength(0)
    const empty = view.findComponent(EmptyState)
    expect(empty.props('text')).toBe("No rules: attachments follow Obsidian's setting.")
    const button = empty.findComponent(Button)
    expect(button.props('text')).toBe('Add a rule')
    await button.vm.$emit('click')
    await nextTick()
    expect(notesRows(view)).toHaveLength(1)
    expect(view.findComponent(EmptyState).exists()).toBe(false)
  })

  it('puts the group description and a plus beside the heading', () => {
    view = mount(AttachmentRulesSettings)
    const section = view.findComponent(Section)
    expect(section.props('title')).toBe('Attachment folders')
    expect(section.props('desc')).toBe(
      'Files pasted or dropped into a note in one of these folders go to the folder its rule names. The deepest folder wins.'
    )
    expect(addIcon(view).props('tooltip')).toBe('Add a rule')
  })

  it('draws each rule as two named rows, the bin on the notes row beside its field', () => {
    config.attachmentRules = [
      rule('Sample Projects', 'folder', 'Sample Projects/files'),
      rule('/', 'note'),
    ]
    view = mount(AttachmentRulesSettings)
    expect(notesRows(view).map((r) => r.props('name'))).toEqual(['Notes in', 'Notes in'])
    expect(placeRows(view).map((r) => r.props('name'))).toEqual([
      'Attachments go to',
      'Attachments go to',
    ])
    expect(notesRows(view).every((r) => !r.props('desc'))).toBe(true)
    const first = notesRows(view)[0]
    const field = first.findComponent(Search)
    expect(field.props('modelValue')).toBe('Sample Projects')
    expect(field.props('suggester')).toBe(FolderSuggest)
    const bin = first.findComponent(Icon)
    expect([bin.props('icon'), bin.props('tooltip')]).toEqual(['trash', 'Remove this rule'])
    expect(notesRows(view)[1].findComponent(Search).props('modelValue')).toBe('Whole vault')
  })

  it("offers Obsidian's three places, with the field each one needs", async () => {
    config.attachmentRules = [rule('Sample Notes', 'folder', 'Sample files', 'pictures')]
    view = mount(AttachmentRulesSettings)
    const place = () => placeRows(view!)[0]
    const dropdown = place().findComponent(Dropdown)
    expect(dropdown.props('options')).toEqual([
      { value: 'note', display: 'Same folder as the note' },
      { value: 'folder', display: 'In the folder specified below' },
      { value: 'subfolder', display: "In subfolder under the note's folder" },
    ])
    expect(dropdown.props('modelValue')).toBe('folder')
    expect(place().findComponent(Search).props('modelValue')).toBe('Sample files')
    expect(place().findComponent(Search).props('suggester')).toBe(FolderSuggest)
    expect(place().findComponent(Input).exists()).toBe(false)

    dropdown.vm.$emit('update:model-value', 'subfolder')
    await nextTick()
    expect(place().findComponent(Search).exists()).toBe(false)
    expect(place().findComponent(Input).props('modelValue')).toBe('pictures')
    await settle()
    expect(config.attachmentRules).toEqual([
      rule('Sample Notes', 'subfolder', 'Sample files', 'pictures'),
    ])

    place().findComponent(Dropdown).vm.$emit('update:model-value', 'note')
    await nextTick()
    expect(place().findComponent(Search).exists()).toBe(false)
    expect(place().findComponent(Input).exists()).toBe(false)
    await settle()
    expect(config.attachmentRules[0].location).toBe('note')
  })

  it('saves a typed subfolder name and a typed notes folder', async () => {
    config.attachmentRules = [rule('Sample Notes', 'subfolder')]
    view = mount(AttachmentRulesSettings)
    placeRows(view)[0].findComponent(Input).vm.$emit('update:model-value', 'scans')
    notesRows(view)[0].findComponent(Search).vm.$emit('update:model-value', 'Sample Notes/Inbox')
    await settle()
    expect(config.attachmentRules).toEqual([rule('Sample Notes/Inbox', 'subfolder', '', 'scans')])
  })

  it('reads Whole vault, or a bare slash, as the vault root', async () => {
    config.attachmentRules = [rule('Sample Notes', 'note')]
    view = mount(AttachmentRulesSettings)
    const field = notesRows(view)[0].findComponent(Search)
    field.vm.$emit('update:model-value', 'Whole vault')
    await settle()
    expect(config.attachmentRules[0].notesFolder).toBe('/')
    field.vm.$emit('update:model-value', '/')
    await settle()
    expect(config.attachmentRules[0].notesFolder).toBe('/')
    // What was typed stays in the field rather than being swapped under the cursor.
    expect(notesRows(view)[0].findComponent(Search).props('modelValue')).toBe('/')
  })

  it('adds a rule from the plus and removes one with its bin, keeping the others', async () => {
    config.attachmentRules = [
      rule('A', 'folder', 'a files'),
      rule('B', 'folder', 'b files'),
      rule('C', 'folder', 'c files'),
    ]
    view = mount(AttachmentRulesSettings)
    await notesRows(view)[1].findComponent(Icon).vm.$emit('click')
    await settle()
    expect(config.attachmentRules.map((r) => r.notesFolder)).toEqual(['A', 'C'])
    expect(placeRows(view).map((r) => r.findComponent(Search).props('modelValue'))).toEqual([
      'a files',
      'c files',
    ])
    await addIcon(view).vm.$emit('click')
    await settle()
    expect(config.attachmentRules.at(-1)).toEqual(rule('', 'folder'))
  })
})

describe('attachment folder rules settings, changed underneath', () => {
  it('draws rules that arrive while the screen is open', async () => {
    view = mount(AttachmentRulesSettings)
    config.attachmentRules = [rule('Sample Inbox', 'note')]
    config.version.value++
    await nextTick()
    expect(notesRows(view).map((r) => r.findComponent(Search).props('modelValue'))).toEqual([
      'Sample Inbox',
    ])
  })

  it('does not draw the rows again after its own save, so the field being typed in stays', async () => {
    config.attachmentRules = [rule('Sample A', 'folder', 'a files')]
    view = mount(AttachmentRulesSettings)
    const field = notesRows(view)[0].findComponent(Search)
    field.vm.$emit('update:model-value', 'Sample AB')
    await settle()
    config.version.value++
    await nextTick()
    expect(config.attachmentRules).toEqual([rule('Sample AB', 'folder', 'a files')])
    expect(notesRows(view)[0].findComponent(Search).vm.$.uid).toBe(field.vm.$.uid)
  })
})
