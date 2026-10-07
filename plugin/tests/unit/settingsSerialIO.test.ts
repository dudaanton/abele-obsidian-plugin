import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const config = AbeleConfig.getInstance()
const oldStore = { encrypted: 'sample-original', key: { salt: 'sample-original-salt' } }
const localStore = { encrypted: 'sample-local', key: { salt: 'sample-local-salt' } }
const externalStore = { encrypted: 'sample-external', key: { salt: 'sample-external-salt' } }
afterEach(() => {
  config.destroy()
  vi.restoreAllMocks()
})
async function setup() {
  useVault([])
  const disk = new FakeSettings({ refreshDelay: 500, secretStore: oldStore })
  config.init(disk as never)
  await config.loadSettings()
  return disk
}

it.each(['managed', 'ordinary', 'no-op'] as const)(
  'takes the external store actually read after a delayed reload crosses a %s save',
  async (kind) => {
    const disk = await setup()
    const entered = deferred<void>(),
      release = deferred<void>()
    const write = disk.delays.holdNext('save')
    vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return JSON.parse(JSON.stringify(disk.stored)) // Read now, not when reload was requested.
    })
    if (kind === 'managed') config.secretStore = localStore
    if (kind === 'ordinary') config.refreshDelay = 333
    const saving = config.saveSettings()
    if (kind !== 'no-op') await write.entered
    const reading = config.reloadSettings()
    try {
      write.release()
      await saving
      await entered.promise
      disk.stored = { ...config.exportSettings(), refreshDelay: 777, secretStore: externalStore }
      release.resolve()
      await reading
      expect(config.secretStore).toEqual(externalStore)
      expect(config.refreshDelay).toBe(777)
      expect((disk.stored as any).secretStore).toEqual(externalStore)
      config.editorSyntaxHighlight = !config.editorSyntaxHighlight
      await config.saveSettings()
      expect((disk.stored as any).secretStore).toEqual(externalStore)
    } finally {
      write.release()
      release.resolve()
      await Promise.all([saving, reading])
    }
  }
)

it('orders a queued managed write after the delayed read and its application', async () => {
  const disk = await setup()
  const entered = deferred<void>(),
    release = deferred<void>()
  const events: string[] = []
  vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
    events.push('read starts')
    const stored = { ...config.exportSettings(), refreshDelay: 777, secretStore: oldStore }
    entered.resolve()
    await release.promise
    events.push('read ends')
    return stored
  })
  const apply = config.applySettings.bind(config)
  vi.spyOn(config, 'applySettings').mockImplementation((...args) => {
    events.push('apply')
    return apply(...args)
  })
  const save = disk.saveData.bind(disk)
  vi.spyOn(disk, 'saveData').mockImplementation(async (data) => {
    events.push('write starts')
    await save(data)
  })
  const reading = config.reloadSettings()
  await entered.promise
  config.secretStore = localStore
  const saving = config.saveSettings()
  try {
    release.resolve()
    await Promise.all([reading, saving])
    expect(events.slice(0, 3)).toEqual(['read starts', 'read ends', 'apply'])
    expect(events.indexOf('write starts')).toBeGreaterThan(events.indexOf('apply'))
    expect(config.secretStore).toEqual(localStore)
    expect((disk.stored as any).secretStore).toEqual(localStore)
    expect(config.refreshDelay).toBe(777)
    disk.stored = { ...config.exportSettings(), secretStore: externalStore }
    await config.reloadSettings()
    expect(config.secretStore).toEqual(externalStore)
    expect((disk.stored as any).secretStore).toEqual(externalStore)
  } finally {
    release.resolve()
    await Promise.all([reading, saving])
  }
})

it('accepts a new external store after a completed local save', async () => {
  const disk = await setup()
  config.secretStore = localStore
  await config.saveSettings()
  disk.stored = { ...config.exportSettings(), secretStore: externalStore }
  await config.reloadSettings()
  expect(config.secretStore).toEqual(externalStore)
  expect((disk.stored as any).secretStore).toEqual(externalStore)
})

it('does not deadlock when applying a reload requests a managed and ordinary save', async () => {
  const disk = await setup()
  disk.stored = { ...config.exportSettings(), refreshDelay: 777 }
  const apply = config.applySettings.bind(config)
  let nested: Promise<void> | undefined
  let requested = false
  vi.spyOn(config, 'applySettings').mockImplementation((...args) => {
    const migrated = apply(...args)
    if (!requested) {
      requested = true
      config.secretStore = localStore
      config.tasksFolder = 'Sample tasks'
      nested = config.saveSettings() // Schedule; the synchronous apply hook must not await IO.
    }
    return migrated
  })
  await config.reloadSettings()
  expect(nested).toBeDefined()
  await nested
  expect(config.secretStore).toEqual(localStore)
  expect(config.refreshDelay).toBe(777)
  expect((disk.stored as any).secretStore).toEqual(localStore)
  expect(disk.stored).toMatchObject({ tasksFolder: 'Sample tasks', refreshDelay: 777 })
})
