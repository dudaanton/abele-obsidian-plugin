/**
 * The Attachment folders group in the Other settings: one row per folder rule, a notes folder
 * and an attachments folder side by side, a bin to remove it, and a plus to add one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AttachmentRulesSettings from '@/components/settings/AttachmentRulesSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Search from '@/components/obsidian/Search.vue'
import Icon from '@/components/obsidian/Icon.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
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

const ruleRows = (v: VueWrapper) =>
  v.findAllComponents(Setting).filter((s) => s.classes('abele-attachment-rules__rule'))

const settle = async () => {
  vi.advanceTimersByTime(600)
  await nextTick()
}

describe('attachment folder rules settings', () => {
  it('says every note keeps the vault folder while there is no rule', () => {
    view = mount(AttachmentRulesSettings)
    expect(ruleRows(view)).toHaveLength(0)
    expect(view.findComponent(EmptyState).props('text')).toContain("Obsidian's own")
  })

  it('draws a row per rule with two folder fields from the kit and a bin', () => {
    config.attachmentRules = [
      { notesFolder: 'Sample Projects', attachmentsFolder: 'Sample Projects/files' },
      { notesFolder: '/', attachmentsFolder: './' },
    ]
    view = mount(AttachmentRulesSettings)
    const rows = ruleRows(view)
    expect(rows.map((row) => row.props('name'))).toEqual(['Notes in Sample Projects', 'Every note'])
    expect(rows.map((row) => row.props('desc'))).toEqual([
      'Attachments go to Sample Projects/files.',
      'Attachments go beside the note.',
    ])
    const fields = rows[0].findAllComponents(Search)
    expect(fields.map((field) => field.props('modelValue'))).toEqual([
      'Sample Projects',
      'Sample Projects/files',
    ])
    expect(fields.every((field) => field.props('suggester') === FolderSuggest)).toBe(true)
    expect(rows[0].findComponent(Icon).props('icon')).toBe('trash')
    expect(view.findComponent(EmptyState).exists()).toBe(false)
  })

  it('adds a rule, saves it as it is typed, and removes it again', async () => {
    view = mount(AttachmentRulesSettings)
    const add = view
      .findAllComponents(Setting)
      .find((s) => s.classes('abele-attachment-rules__add'))!
    await add.findComponent(Icon).vm.$emit('click')
    await nextTick()
    expect(ruleRows(view)[0].props('name')).toBe('New rule')
    expect(ruleRows(view)[0].props('desc')).toContain('Fill in both folders')

    const [notes, attachments] = ruleRows(view)[0].findAllComponents(Search)
    notes.vm.$emit('update:model-value', 'Sample Projects/')
    attachments.vm.$emit('update:model-value', './images')
    await settle()
    expect(config.attachmentRules).toEqual([
      { notesFolder: 'Sample Projects/', attachmentsFolder: './images' },
    ])
    expect(config.saveSettings).toHaveBeenCalled()
    expect(ruleRows(view)[0].props('desc')).toBe('Attachments go to images beside the note.')

    await ruleRows(view)[0].findComponent(Icon).vm.$emit('click')
    await settle()
    expect(config.attachmentRules).toEqual([])
    expect(ruleRows(view)).toHaveLength(0)
  })

  it('keeps the other rows as they are when one in the middle goes', async () => {
    config.attachmentRules = [
      { notesFolder: 'A', attachmentsFolder: 'a files' },
      { notesFolder: 'B', attachmentsFolder: 'b files' },
      { notesFolder: 'C', attachmentsFolder: 'c files' },
    ]
    view = mount(AttachmentRulesSettings)
    await ruleRows(view)[1].findComponent(Icon).vm.$emit('click')
    await settle()
    expect(config.attachmentRules.map((rule) => rule.notesFolder)).toEqual(['A', 'C'])
    expect(
      ruleRows(view).map((row) => row.findAllComponents(Search)[1].props('modelValue'))
    ).toEqual(['a files', 'c files'])
  })
})

describe('attachment folder rules settings, changed underneath', () => {
  it('draws rules that arrive while the screen is open', async () => {
    view = mount(AttachmentRulesSettings)
    config.attachmentRules = [
      { notesFolder: 'Sample Inbox', attachmentsFolder: 'Sample Inbox/files' },
    ]
    config.version.value++
    await nextTick()
    expect(ruleRows(view).map((row) => row.props('name'))).toEqual(['Notes in Sample Inbox'])
  })

  it('does not draw the rows again after its own save, so the field being typed in stays', async () => {
    config.attachmentRules = [{ notesFolder: 'Sample A', attachmentsFolder: 'a files' }]
    view = mount(AttachmentRulesSettings)
    const field = ruleRows(view)[0].findAllComponents(Search)[0]
    field.vm.$emit('update:model-value', 'Sample AB')
    await settle()
    config.version.value++
    await nextTick()
    expect(config.attachmentRules).toEqual([
      { notesFolder: 'Sample AB', attachmentsFolder: 'a files' },
    ])
    expect(ruleRows(view)[0].findAllComponents(Search)[0].vm.$.uid).toBe(field.vm.$.uid)
  })
})
