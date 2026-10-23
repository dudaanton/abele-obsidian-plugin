import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { expect, it } from 'vitest'
import OtherSettings from '@/components/settings/OtherSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Section from '@/components/obsidian/Section.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'

it.each([false, true])(
  'refreshes the open syntax switch after incoming enabled=%s and flips it on the first click',
  async (incoming) => {
    useVault([])
    const disk = new FakeSettings()
    const config = AbeleConfig.getInstance()
    config.init(disk as never)
    await config.loadSettings()
    config.editorSyntaxHighlight = !incoming
    await config.saveSettings()
    const screen = mount(OtherSettings)
    const row = screen
      .findAllComponents(Setting)
      .find((setting) => setting.props('name') === 'Editor syntax highlighting')!
    const toggle = row.findComponent(Checkbox)
    try {
      expect(toggle.props('isEnabled')).toBe(!incoming)
      disk.stored = { ...config.exportSettings(), editorSyntaxHighlight: incoming }
      await config.reloadSettings()
      await nextTick()
      expect(toggle.props('isEnabled')).toBe(incoming)
      expect(toggle.classes().includes('is-enabled')).toBe(incoming)
      await toggle.trigger('click')
      await flushPromises()
      expect(config.editorSyntaxHighlight).toBe(!incoming)
      expect(disk.saved.at(-1)?.editorSyntaxHighlight).toBe(!incoming)
      expect(toggle.props('isEnabled')).toBe(!incoming)
    } finally {
      screen.unmount()
      config.destroy()
    }
  }
)

it('toggles the current setting even when a version update has not rendered yet', async () => {
  useVault([])
  const disk = new FakeSettings()
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  await config.loadSettings()
  config.editorSyntaxHighlight = true
  const screen = mount(OtherSettings)
  try {
    const row = screen
      .findAllComponents(Setting)
      .find((setting) => setting.props('name') === 'Editor syntax highlighting')!
    config.editorSyntaxHighlight = false
    config.version.value++
    await row.findComponent(Checkbox).trigger('click')
    await flushPromises()
    expect(config.editorSyntaxHighlight).toBe(true)
    expect(disk.saved.at(-1)?.editorSyntaxHighlight).toBe(true)
    expect(row.findComponent(Checkbox).props('isEnabled')).toBe(true)
  } finally {
    screen.unmount()
    config.destroy()
  }
})

it('sets the other settings out under headings by what they are about', () => {
  useVault([])
  AbeleConfig.getInstance().applySettings(undefined)
  const screen = mount(OtherSettings)
  try {
    const sections = screen.findAllComponents(Section)
    expect(sections.map((s) => s.props('title'))).toEqual([
      'Look',
      'Drawn by Abele in a note',
      'Opening notes',
      'Attachment folders',
      'Maps',
      'Backgrounds',
      'The plugin',
    ])
    const under = (title: string) =>
      sections
        .find((s) => s.props('title') === title)!
        .findAllComponents(Setting)
        .map((s) => s.props('name'))
    expect(under('Look')).toEqual([
      'Full-width sidebars',
      'Half-width sidebars on tablet',
      'CSS snippets folder',
    ])
    expect(under('Drawn by Abele in a note')).toEqual(
      expect.arrayContaining([
        'Own drawing of properties',
        'Counter properties',
        'Draw diagrams',
        'Open canvases in Abele',
        'Editor syntax highlighting',
      ])
    )
    expect(under('Opening notes')).toEqual(['Remember where notes were left'])
    expect(under('Maps')).toEqual(['Coordinates property', 'Map style'])
    expect(under('Backgrounds')).toEqual(['No backgrounds of your own', 'Add a background'])
    expect(under('The plugin')).toEqual(['Changelog', 'Keyboard diagnostics'])
    // Nothing was dropped on the way: every setting is under one of the headings.
    const all = screen.findAllComponents(Setting).map((s) => s.props('name'))
    expect(
      sections.flatMap((s) => s.findAllComponents(Setting).map((x) => x.props('name')))
    ).toEqual(all)
  } finally {
    screen.unmount()
  }
})
