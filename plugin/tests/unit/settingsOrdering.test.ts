import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useSettingsSave } from '@/composables/useSettingsSave'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'
import { deferred } from '../helpers/deferred'

it('preserves an edit whose debounced save finishes before an older reload returns', async () => {
  useVault([])
  const disk = new FakeSettings()
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  await config.loadSettings()
  const incoming = { ...config.exportSettings(), refreshDelay: 777 }
  const field = ref(config.tasksFolder)
  let save!: () => void
  const view = mount(
    defineComponent({
      setup() {
        ;({ save } = useSettingsSave(
          () => {
            config.tasksFolder = field.value
          },
          () => {
            field.value = config.tasksFolder
          }
        ))
        return () => h('input', { value: field.value })
      },
    })
  )
  const entered = deferred<void>()
  const readDone = deferred<void>()
  const loadData = disk.loadData.bind(disk)
  const load = vi.spyOn(disk, 'loadData').mockImplementation(async () => {
    const snapshot = await loadData()
    entered.resolve()
    await readDone.promise
    return snapshot
  })
  try {
    field.value = 'Sample saved edit'
    save()
    disk.stored = incoming
    const reload = config.reloadSettings()
    await entered.promise
    await advance(500)
    expect(disk.saved.at(-1)).toMatchObject({ tasksFolder: 'Sample saved edit' })
    readDone.resolve()
    await reload
    await nextTick()
    expect(field.value).toBe('Sample saved edit')
    expect(config.tasksFolder).toBe('Sample saved edit')
    expect(config.refreshDelay).toBe(777)
    await config.saveSettings()
    expect(disk.saved.at(-1)).toMatchObject({ tasksFolder: 'Sample saved edit', refreshDelay: 777 })
  } finally {
    readDone.resolve()
    load.mockRestore()
    view.unmount()
    config.destroy()
  }
})

const advance = useFakeClock()

// BUG: reload replaces the applied local edit while the debounce keeps the screen from reseeding;
// the eventual save writes incoming settings instead of reconciling the pending edit.
it('preserves a pending local edit and unrelated incoming settings across a reload', async () => {
  useVault([])
  const disk = new FakeSettings()
  const config = AbeleConfig.getInstance()
  config.init(disk as never)
  await config.loadSettings()
  const incoming = { ...config.exportSettings(), refreshDelay: 777 }
  const field = ref(config.tasksFolder)
  let save!: () => void
  const view = mount(
    defineComponent({
      setup() {
        ;({ save } = useSettingsSave(
          () => {
            config.tasksFolder = field.value
          },
          () => {
            field.value = config.tasksFolder
          }
        ))
        return () => h('input', { value: field.value })
      },
    })
  )
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
      tasksFolder: 'Sample local tasks',
      refreshDelay: 777,
    })
  } finally {
    view.unmount()
    config.destroy()
  }
})
