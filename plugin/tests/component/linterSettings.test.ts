/**
 * The linter's settings tab: every rule listed with its switch, a rule set up in its dialog, and
 * what is typed kept as the list it stands for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import LinterSettings from '@/components/settings/LinterSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { BUILTIN_RULES } from '@/linter/rules'
import { linterSettingsFrom } from '@/linter/settings'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | null = null
let config: AbeleConfig

const stubs = {
  Section: {
    props: ['title', 'desc'],
    template: '<section><slot name="desc" /><slot /></section>',
  },
  Setting: {
    props: ['name', 'desc'],
    template: '<div class="stub-setting" :data-name="name">{{ name }}<slot /></div>',
  },
  ObsidianModal: { template: '<div class="stub-modal"><slot /><slot name="footer" /></div>' },
  Dropdown: {
    props: ['modelValue', 'options'],
    emits: ['update:model-value'],
    template:
      '<select class="stub-dropdown" @change="$emit(\'update:model-value\', $event.target.value)"><option v-for="o in options" :value="o.value">{{ o.display }}</option></select>',
  },
}

beforeEach(() => {
  useVault([])
  config = AbeleConfig.getInstance()
  config.linter = linterSettingsFrom({})
  vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
    config.version.value++
  })
  wrapper = mount(LinterSettings, { global: { stubs } })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

const settingNamed = (name: string) =>
  wrapper!.findAll('.stub-setting').find((s) => s.attributes('data-name') === name)!

describe('the linter settings', () => {
  it('list every built-in rule', () => {
    const names = wrapper!.findAll('.stub-setting').map((s) => s.attributes('data-name'))
    for (const rule of BUILTIN_RULES) expect(names).toContain(rule.title)
  })

  it('switch a rule on and keep it', async () => {
    await settingNamed('No tags').find('.checkbox-container').trigger('click')
    expect(config.saveSettings).toHaveBeenCalled()
    expect(config.linter.rules['no-tags']?.enabled).toBe(true)
  })

  it('keep the folders to skip as a list', async () => {
    const input = settingNamed('Folders to skip').find('input')
    await input.setValue('Templates, Archive/** ,')
    expect(config.linter.exclude).toEqual(['Templates', 'Archive/**'])
  })

  it('set a rule up in its dialog: severity, where, and its own list', async () => {
    await settingNamed('Required properties').find('.abele-obsidian-icon').trigger('click')
    const modal = wrapper!.find('.stub-modal')
    expect(modal.exists()).toBe(true)

    await modal.find('.stub-dropdown').setValue('warning')
    const field = (name: string) =>
      modal
        .findAll('.stub-setting')
        .find((s) => s.attributes('data-name') === name)!
        .find('input')
    await field('Only in').setValue('Notes, Projects/*/Tasks')
    await field('Properties').setValue('created: {{ctime}}, type: note')

    const rule = config.linter.rules['required-properties']
    expect(rule.severity).toBe('warning')
    expect(rule.folders).toEqual(['Notes', 'Projects/*/Tasks'])
    expect(rule.params.properties).toEqual(['created: {{ctime}}', 'type: note'])

    await modal
      .findAll('button')
      .find((b) => b.text() === 'As it ships')!
      .trigger('click')
    expect(config.linter.rules['required-properties']).toBeUndefined()
  })
})
