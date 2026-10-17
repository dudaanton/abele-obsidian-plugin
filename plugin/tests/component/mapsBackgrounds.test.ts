import { beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MapBackgroundSettings from '@/components/settings/MapBackgroundSettings.vue'
import MapBackgrounds from '@/components/settings/MapBackgrounds.vue'
import MapBackgroundEditor from '@/components/settings/MapBackgroundEditor.vue'
import Input from '@/components/obsidian/Input.vue'
import type { Background } from '@/maps/core/model'

const fake = vi.hoisted(() => ({
  config: { version: { value: 0 }, mapBackgrounds: [] as Background[], saveSettings: vi.fn() },
  dialog: null as Record<string, any> | null,
  settingsContainer: null as HTMLElement | null,
  dialogDocument: null as Document | null,
}))
vi.mock('@/services/AbeleConfig', async () => {
  const { ref } = await import('vue')
  fake.config.version = ref(0)
  return { AbeleConfig: { getInstance: () => fake.config } }
})
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: { vault: { configDir: '.obsidian', adapter: { exists: async () => false } } },
      settingsContainer: { value: fake.settingsContainer },
    }),
  },
}))
vi.mock('@/modal/componentDialog', () => ({
  openComponentDialog: (
    _: unknown,
    props: Record<string, unknown>,
    options?: { document?: Document }
  ) => {
    fake.dialog = props
    fake.dialogDocument = options?.document ?? null
    return { close: vi.fn() }
  },
}))

const background: Background = {
  id: 'sample',
  name: 'Sample terrain',
  light: ['https://example.test/style.json'],
  dark: [],
}
beforeEach(() => {
  fake.config.mapBackgrounds = []
  fake.config.version.value++
  fake.dialog = null
  fake.settingsContainer = document.implementation.createHTMLDocument('Sample settings').body
  fake.config.saveSettings.mockReset().mockImplementation(async () => {
    fake.config.version.value++
  })
})

it('adds, edits, reorders and removes only the plugin-owned background list', async () => {
  const wrapper = mount(MapBackgroundSettings)
  const rows = wrapper.findComponent(MapBackgrounds)
  rows.vm.$emit('add')
  expect(fake.dialogDocument).toBe(fake.settingsContainer.ownerDocument)
  fake.dialog!.onSave(background)
  await nextTick()
  expect(fake.config.mapBackgrounds).toEqual([background])
  rows.vm.$emit('edit', background)
  fake.dialog!.onSave({ ...background, name: 'Edited sample' })
  await nextTick()
  expect(fake.config.mapBackgrounds[0].name).toBe('Edited sample')
  const other = { ...background, id: 'other', name: 'Other sample' }
  rows.vm.$emit('reorder', [other, background])
  await nextTick()
  expect(fake.config.mapBackgrounds.map((b) => b.id)).toEqual(['other', 'sample'])
  rows.vm.$emit('remove', background)
  await nextTick()
  expect(fake.config.mapBackgrounds).toEqual([other])
  expect(fake.config.saveSettings).toHaveBeenCalledTimes(4)
  wrapper.unmount()
})

it('validates a draft and emits all raster layers only on Save', async () => {
  const wrapper = mount(MapBackgroundEditor, {
    global: { stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  const save = () =>
    wrapper
      .findAll('button')
      .find((b) => b.text() === 'Save')!
      .trigger('click')
  await save()
  expect(wrapper.emitted('save')).toBeUndefined()
  expect(wrapper.text()).toContain('Give it a name')
  await wrapper.findComponent(Input).find('input').setValue(' Sample terrain ')
  await wrapper
    .findAll('textarea')[0]
    .setValue('https://example.test/{z}/{x}/{y}.png\nhttps://example.test/labels/{z}/{x}/{y}.png')
  await save()
  expect(wrapper.emitted('save')![0][0]).toMatchObject({
    name: 'Sample terrain',
    light: ['https://example.test/{z}/{x}/{y}.png', 'https://example.test/labels/{z}/{x}/{y}.png'],
    dark: [],
  })
  expect(fake.config.saveSettings).not.toHaveBeenCalled()
  wrapper.unmount()
})
