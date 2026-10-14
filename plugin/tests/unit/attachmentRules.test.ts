import { describe, expect, it } from 'vitest'
import {
  attachmentRuleFor,
  attachmentRulesFrom,
  attachmentSetting,
  attachmentSettingFor,
  normalizeFolder,
  type AttachmentRule,
} from '@/media/attachmentRules'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'

const rule = (notesFolder: string, attachmentsFolder: string): AttachmentRule => ({
  notesFolder,
  attachmentsFolder,
})

describe('attachment folder rules', () => {
  const rules = [
    rule('Sample Projects', 'Sample Projects/files'),
    rule('Sample Projects/Deep/Deeper', 'deep files'),
    rule('Sample Projects/Deep', 'mid files'),
  ]

  it('takes a note directly in a ruled folder', () => {
    expect(attachmentSettingFor(rules, 'Sample Projects/note.md')).toBe('Sample Projects/files')
  })

  it('takes notes in every subfolder of a ruled folder', () => {
    expect(attachmentSettingFor(rules, 'Sample Projects/a/b/c/note.md')).toBe(
      'Sample Projects/files'
    )
  })

  it('lets the deepest covering rule win, whatever the order of the list', () => {
    expect(attachmentSettingFor(rules, 'Sample Projects/Deep/note.md')).toBe('mid files')
    expect(attachmentSettingFor(rules, 'Sample Projects/Deep/Deeper/x/note.md')).toBe('deep files')
  })

  it('leaves a note outside every rule to the vault setting', () => {
    expect(attachmentRuleFor(rules, 'Elsewhere/note.md')).toBeNull()
    expect(attachmentRuleFor(rules, 'note.md')).toBeNull()
    expect(attachmentRuleFor([], 'Sample Projects/note.md')).toBeNull()
  })

  it('does not take a sibling whose name only begins like the ruled folder', () => {
    expect(attachmentRuleFor(rules, 'Sample Projects 2/note.md')).toBeNull()
    expect(attachmentRuleFor(rules, 'Sample Projects.md')).toBeNull()
  })

  it('reads / as the vault root, under every deeper rule', () => {
    const withRoot = [rule('/', 'All files'), ...rules]
    expect(attachmentSettingFor(withRoot, 'note.md')).toBe('All files')
    expect(attachmentSettingFor(withRoot, 'Elsewhere/x/note.md')).toBe('All files')
    expect(attachmentSettingFor(withRoot, 'Sample Projects/note.md')).toBe('Sample Projects/files')
  })

  it('ignores slashes at either end, doubled and backslashes', () => {
    const typed = [rule(' /Sample Projects//Deep/ ', '/Files//here/')]
    expect(attachmentSettingFor(typed, 'Sample Projects/Deep/note.md')).toBe('Files/here')
    expect(
      attachmentSettingFor([rule('Sample Projects\\Deep', 'x')], 'Sample Projects/Deep/n.md')
    ).toBe('x')
  })

  it('compares folders without regard to case', () => {
    expect(attachmentSettingFor(rules, 'sample projects/deep/note.md')).toBe('mid files')
  })

  it('treats a rule with an empty folder as unfinished', () => {
    expect(attachmentRuleFor([rule('', 'files')], 'note.md')).toBeNull()
    expect(attachmentRuleFor([rule('Sample Projects', '  ')], 'Sample Projects/n.md')).toBeNull()
  })

  it('gives the first of two rules on the same folder', () => {
    const twice = [rule('A', 'first'), rule('a/', 'second')]
    expect(attachmentSettingFor(twice, 'A/n.md')).toBe('first')
  })

  it('follows a rename of the folder only through the rule text', () => {
    const before = [rule('Sample Projects', 'files')]
    expect(attachmentRuleFor(before, 'Renamed Projects/n.md')).toBeNull()
  })

  it('writes the attachments folder as Obsidian writes its setting', () => {
    expect(attachmentSetting('/')).toBe('/')
    expect(attachmentSetting('.')).toBe('./')
    expect(attachmentSetting('./')).toBe('./')
    expect(attachmentSetting('./images/')).toBe('./images')
    expect(attachmentSetting('Files/')).toBe('Files')
    expect(normalizeFolder('//a//b//')).toBe('a/b')
  })

  it('keeps only well-formed rules from a settings file', () => {
    expect(attachmentRulesFrom(undefined)).toEqual([])
    expect(
      attachmentRulesFrom([
        rule('A', 'B'),
        null,
        { notesFolder: 'A' },
        { notesFolder: 1, attachmentsFolder: 'B' },
      ])
    ).toEqual([rule('A', 'B')])
  })
})

describe('attachment folder rules as settings', () => {
  it('travel in the Other block of a settings transfer', async () => {
    const { collectEntries, applyEntries } = await import('@/transfer/entries')
    const rules = [rule('Sample Projects', 'Sample Projects/files')]
    const source = { refreshDelay: 500, attachmentRules: rules } as AbeleSettings
    const entry = collectEntries(source).find((item) => item.section === 'other')!
    expect(entry.data).toMatchObject({ attachmentRules: rules })
    expect(applyEntries([entry], { refreshDelay: 500 } as AbeleSettings).attachmentRules).toEqual(
      rules
    )
  })

  it('are saved and read back with the settings file', async () => {
    useVault([])
    const disk = new FakeSettings({ refreshDelay: 500, attachmentRules: [rule('A', 'B'), 7] })
    const config = AbeleConfig.getInstance()
    config.init(disk as never)
    try {
      await config.loadSettings()
      expect(config.attachmentRules).toEqual([rule('A', 'B')])
      config.attachmentRules.push(rule('/', 'All files'))
      await config.saveSettings()
      await config.reloadSettings()
      expect(config.attachmentRules).toEqual([rule('A', 'B'), rule('/', 'All files')])
    } finally {
      config.destroy()
    }
  })
})
