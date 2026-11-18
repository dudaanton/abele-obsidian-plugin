import { afterEach, expect, it } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SectionSettings } from '@/sync/abeleSectionEngine'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'

const config = AbeleConfig.getInstance()
afterEach(() => config.destroy())
async function setup() {
  useVault([])
  const disk = new FakeSettings({ tasksFolder: 'Shared', reader: { fontSize: 100 } })
  let saved: unknown
  config.init(disk as never)
  const sections = new SectionSettings({
    read: () => saved,
    write: (value) => {
      saved = value
    },
  })
  config.sectionSettings = sections
  await config.loadSettings()
  await config.saveSettings()
  return {
    disk,
    sections,
    restart: () =>
      new SectionSettings({
        read: () => saved,
        write: (value) => {
          saved = value
        },
      }),
  }
}
it('never publishes unticked edits and hydrates them after an incoming settings file', async () => {
  const { disk, sections, restart } = await setup()
  const shared = structuredClone(disk.stored) as Record<string, unknown>
  sections.choose('reader', false, config.exportSettings())
  config.reader.fontSize = 125
  await config.saveSettings()
  expect((disk.stored as any).reader.fontSize).toBe(100)
  disk.stored = {
    ...shared,
    tasksFolder: 'Remote',
    reader: { ...(shared.reader as object), fontSize: 150 },
  }
  await config.reloadSettings()
  expect(config.reader.fontSize).toBe(125)
  expect(config.tasksFolder).toBe('Remote')
  config.sectionSettings = restart()
  await config.loadSettings()
  expect(config.reader.fontSize).toBe(125)
})
it('an incoming section wins over an unsaved edit and the original is restorable', async () => {
  const { disk, sections } = await setup()
  config.editSettings(() => {
    config.reader.fontSize = 125
  })
  disk.stored = { ...config.exportSettings(), reader: { ...config.reader, fontSize: 150 } }
  await config.reloadSettings()
  expect(config.reader.fontSize).toBe(150)
  expect(sections.kept).toMatchObject([{ id: 'reader' }])
  config.applySettings(sections.restore('reader', config.exportSettings()))
  await config.saveSettings()
  expect((disk.stored as any).reader.fontSize).toBe(125)
})
