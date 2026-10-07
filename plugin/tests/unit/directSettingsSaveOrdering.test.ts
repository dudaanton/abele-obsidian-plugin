import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { SecretStore } from '@/secrets/SecretStore'

it('keeps a completed passphrase change when an older encrypted store read returns', async () => {
  const app = useVault([])
  const disk = new FakeSettings({ refreshDelay: 500 })
  config.init(disk as never)
  await config.loadSettings()
  const store = new SecretStore({
    keychain: () => app.secretStorage,
    read: () => config.secretStore,
    write: async (file) => {
      config.secretStore = file
      await config.saveSettings()
    },
    ids: () => ['sample-key'],
    conflictCopies: async () => [],
    now: () => 1000,
  })
  store.set('sample-key', 'invented-value')
  await store.enable('sample-old-phrase', { iterations: 1000 })
  const entered = deferred<void>(),
    release = deferred<void>()
  vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
    const snapshot = JSON.parse(JSON.stringify(disk.stored))
    snapshot.refreshDelay = 888
    entered.resolve()
    await release.promise
    return snapshot
  })
  const reading = config.reloadSettings()
  await entered.promise
  try {
    await store.changePassphrase('sample-new-phrase', { iterations: 1000 })
    const saved = JSON.parse(JSON.stringify(config.secretStore))
    release.resolve()
    await reading
    await store.load()
    expect(config.secretStore).toEqual(saved)
    expect(store.status.value).toBe('unlocked')
    expect(store.get('sample-key')).toBe('invented-value')
    expect(config.refreshDelay).toBe(888)
  } finally {
    release.resolve()
    await reading
  }
})

it('keeps a passphrase save queued while reload waits for tool descriptions', async () => {
  const app = useVault([])
  const disk = new FakeSettings({ refreshDelay: 500 })
  config.init(disk as never)
  await config.loadSettings()
  const toolsEntered = deferred<void>(),
    releaseTools = deferred<void>(),
    requested = deferred<void>()
  let holding = false
  const store = new SecretStore({
    keychain: () => app.secretStorage,
    read: () => config.secretStore,
    write: async (file) => {
      config.secretStore = file
      const saved = config.saveSettings()
      if (holding) requested.resolve()
      await saved
    },
    ids: () => ['sample-key'],
    conflictCopies: async () => [],
    now: () => 1000,
  })
  store.set('sample-key', 'invented-value')
  await store.enable('sample-old-phrase', { iterations: 1000 })
  const incoming = JSON.parse(JSON.stringify(config.exportSettings()))
  incoming.refreshDelay = 888
  incoming.ai.prompts.toolDescriptions = { read: 'Sample tool override' }
  disk.stored = incoming
  vi.doMock('@/ai/tools', () => ({
    codeToolDescriptions: async () => {
      toolsEntered.resolve()
      await releaseTools.promise
      return {}
    },
  }))
  const reading = config.reloadSettings()
  await toolsEntered.promise
  holding = true
  const changing = store.changePassphrase('sample-new-phrase', { iterations: 1000 })
  try {
    await requested.promise
    const next = JSON.parse(JSON.stringify(config.secretStore))
    expect(next).not.toEqual(incoming.secretStore)
    releaseTools.resolve()
    await Promise.all([reading, changing])
    expect(config.secretStore).toEqual(next)
    expect((disk.stored as any).secretStore).toEqual(next)
    await store.load()
    expect(store.status.value).toBe('unlocked')
    expect(store.get('sample-key')).toBe('invented-value')
    expect(config.refreshDelay).toBe(888)
    // Protection ends for reads begun after acknowledgment; a genuinely newer file wins.
    disk.stored = { ...config.exportSettings(), secretStore: incoming.secretStore }
    await config.reloadSettings()
    expect(config.secretStore).toEqual(incoming.secretStore)
  } finally {
    releaseTools.resolve()
    await Promise.all([reading, changing])
    vi.doUnmock('@/ai/tools')
  }
})

it('keeps the written store when reload reads old ciphertext after the save was requested', async () => {
  const app = useVault([])
  const disk = new FakeSettings({ refreshDelay: 500 })
  config.init(disk as never)
  await config.loadSettings()
  const events: string[] = []
  let recording = false
  const store = new SecretStore({
    keychain: () => app.secretStorage,
    read: () => config.secretStore,
    write: async (file) => {
      config.secretStore = file
      if (recording) events.push('save requested')
      await config.saveSettings()
    },
    ids: () => ['sample-key'],
    conflictCopies: async () => [],
    now: () => 1000,
  })
  store.set('sample-key', 'invented-value')
  await store.enable('sample-old-phrase', { iterations: 1000 })
  const old = JSON.parse(JSON.stringify(config.secretStore))
  const write = disk.delays.holdNext('save')
  const saveData = disk.saveData.bind(disk)
  vi.spyOn(disk, 'saveData').mockImplementation(async (data) => {
    await saveData(data)
    events.push('save completes')
  })
  const readEntered = deferred<void>()
  vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
    const snapshot = JSON.parse(JSON.stringify(disk.stored))
    expect(snapshot.secretStore).toEqual(old)
    snapshot.refreshDelay = 888
    events.push('reload reads old file')
    readEntered.resolve()
    return snapshot
  })
  const apply = config.applySettings.bind(config)
  vi.spyOn(config, 'applySettings').mockImplementation((...args) => {
    events.push('reload applies')
    return apply(...args)
  })
  recording = true
  const changing = store.changePassphrase('sample-new-phrase', { iterations: 1000 })
  await write.entered
  const next = JSON.parse(JSON.stringify(config.secretStore))
  const reading = config.reloadSettings()
  try {
    await readEntered.promise
    expect(events).toEqual(['save requested', 'reload reads old file'])
    write.release()
    await Promise.all([changing, reading])
    expect(events.slice(0, 4)).toEqual([
      'save requested',
      'reload reads old file',
      'save completes',
      'reload applies',
    ])
    expect(config.secretStore).toEqual(next)
    expect((disk.stored as any).secretStore).toEqual(next)
    expect(config.refreshDelay).toBe(888)
    await store.load()
    expect(store.status.value).toBe('unlocked')
    expect(store.get('sample-key')).toBe('invented-value')
    config.editorSyntaxHighlight = !config.editorSyntaxHighlight
    await config.saveSettings()
    expect((disk.stored as any).secretStore).toEqual(next)
  } finally {
    write.release()
    await Promise.all([changing, reading])
  }
})

const config = AbeleConfig.getInstance()
afterEach(() => {
  config.destroy()
  vi.restoreAllMocks()
})

it.each(['awaited', 'queued'] as const)(
  'retains a completed direct on/off save cycle during a stale read (%s)',
  async (ordering) => {
    useVault([])
    const disk = new FakeSettings({ refreshDelay: 500, editorSyntaxHighlight: false })
    config.init(disk as never)
    await config.loadSettings()
    const before = { ...config.exportSettings(), editorSyntaxHighlight: true, refreshDelay: 888 }
    disk.stored = before
    const entered = deferred<void>(),
      release = deferred<void>()
    vi.spyOn(disk, 'loadData').mockImplementationOnce(async () => {
      const snapshot = JSON.parse(JSON.stringify(disk.stored))
      entered.resolve()
      await release.promise
      return snapshot
    })
    const reading = config.reloadSettings()
    await entered.promise
    try {
      // The direct screen path: no editSettings/useSettingsSave registration.
      config.editorSyntaxHighlight = true
      const first = config.saveSettings()
      if (ordering === 'awaited') await first
      config.editorSyntaxHighlight = false
      const second = config.saveSettings()
      await Promise.all([first, second])
      expect(disk.saved.at(-1)?.editorSyntaxHighlight).toBe(false)
      release.resolve()
      await reading
      expect(config.editorSyntaxHighlight).toBe(false)
      expect(config.refreshDelay).toBe(888)
      expect(disk.stored).toMatchObject({ editorSyntaxHighlight: false, refreshDelay: 888 })
    } finally {
      release.resolve()
      await reading
    }
  }
)
