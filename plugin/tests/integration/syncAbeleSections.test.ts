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
it('keeps the last successfully saved shared version when unticking a section', async () => {
  const { disk, sections } = await setup()
  config.reader.fontSize = 125
  await config.saveSettings()
  expect(sections.differs('reader', config.exportSettings())).toBe(false)
  sections.choose('reader', false, config.exportSettings())
  config.reader.fontSize = 150
  await config.saveSettings()
  expect((disk.stored as any).reader.fontSize).toBe(125)
  expect(sections.choose('reader', true, config.exportSettings(), 'vault').reader.fontSize).toBe(
    125
  )
})
it('does not advance the shared version after a failed settings write', async () => {
  const { disk, sections } = await setup()
  config.reader.fontSize = 125
  const gate = disk.delays.holdNext('save')
  const saving = config.saveSettings()
  const rejected = expect(saving).rejects.toThrow('sample interrupted write')
  await gate.entered
  gate.reject(new Error('sample interrupted write'))
  await rejected
  expect(sections.differs('reader', config.exportSettings())).toBe(true)
  sections.choose('reader', false, config.exportSettings())
  await config.saveSettings()
  expect((disk.stored as any).reader.fontSize).toBe(100)
})
it('publishes the chosen device version after restarting before its first settings write', async () => {
  const { disk, sections, restart } = await setup()
  sections.choose('reader', false, config.exportSettings())
  config.reader.fontSize = 125
  await config.saveSettings()
  sections.choose('reader', true, config.exportSettings(), 'device')
  config.sectionSettings = restart()
  await config.loadSettings()
  expect(config.reader.fontSize).toBe(125)
  await config.saveSettings()
  expect((disk.stored as any).reader.fontSize).toBe(125)
})
it('retains the chosen private section when an older settings file arrives before restart', async () => {
  const { disk, sections, restart } = await setup()
  config.reader.fontSize = 125
  await config.saveSettings()
  sections.choose('reader', false, config.exportSettings())
  config.reader.fontSize = 150
  await config.saveSettings()
  sections.choose('reader', true, config.exportSettings(), 'device')
  disk.stored = { ...config.exportSettings(), reader: { ...config.reader, fontSize: 100 } }
  const restarted = restart()
  config.sectionSettings = restarted
  await config.loadSettings()
  expect(config.reader.fontSize).toBe(100)
  expect(restarted.restore('reader', config.exportSettings()).reader.fontSize).toBe(150)
})
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
