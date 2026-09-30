import { expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useSettingsSave } from '@/composables/useSettingsSave'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'

const advance = useFakeClock()

// BUG: reload replaces the applied local edit while the debounce keeps the screen from reseeding;
// the eventual save writes incoming settings instead of reconciling the pending edit.
it.fails('preserves a pending local edit and unrelated incoming settings across a reload', async () => {
  useVault([])
  const disk = new FakeSettings()
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  await config.loadSettings()
  const incoming = { ...config.exportSettings(), refreshDelay: 777 }
  const field = ref(config.tasksFolder)
  let save!: () => void
  const view = mount(defineComponent({
    setup() {
      ;({ save } = useSettingsSave(
        () => { config.tasksFolder = field.value },
        () => { field.value = config.tasksFolder },
      ))
      return () => h('input', { value: field.value })
    },
  }))
  try {
    field.value = 'Sample local tasks'
    save()
    const read = disk.delays.holdNext('load')
    disk.stored = incoming
    const reload = config.reloadSettings()
    await read.entered
    read.release()
    await reload
    await nextTick()
    expect(field.value).toBe('Sample local tasks')
    const write = disk.delays.holdNext('save')
    await advance(500)
    await write.entered
    write.release()
    await advance()
    expect(disk.saved.at(-1)).toMatchObject({
      tasksFolder: 'Sample local tasks', refreshDelay: 777,
    })
  } finally {
    view.unmount()
    config.destroy()
  }
})
