import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { SecretStore } from '@/secrets/SecretStore'

it('keeps a queued passphrase change while an older encrypted store reload finishes', async () => {
  const app = useVault([])
  const disk = new FakeSettings({ refreshDelay: 500 })
  config.init(disk as never)
  await config.loadSettings()
  const requested = deferred<void>()
  let capturing = false
  const store = new SecretStore({
    keychain: () => app.secretStorage,
    read: () => config.secretStore,
    write: async (file) => {
      config.secretStore = file
      const saved = config.saveSettings()
      if (capturing) requested.resolve()
      await saved
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
  capturing = true
  const before = disk.saved.length
  const changing = store.changePassphrase('sample-new-phrase', { iterations: 1000 })
  try {
    await requested.promise
    const saved = JSON.parse(JSON.stringify(config.secretStore))
    expect(disk.saved).toHaveLength(before) // IO cannot overtake the reload's read/apply.
    release.resolve()
    await Promise.all([reading, changing])
    await store.load()
    expect(config.secretStore).toEqual(saved)
    expect(store.status.value).toBe('unlocked')
    expect(store.get('sample-key')).toBe('invented-value')
    expect(config.refreshDelay).toBe(888)
  } finally {
    release.resolve()
    await Promise.all([reading, changing])
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

it('serializes a reload behind a requested passphrase save instead of reading old ciphertext', async () => {
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
    events.push('reload reads written file')
    readEntered.resolve()
    expect(snapshot.secretStore).toEqual(next)
    snapshot.refreshDelay = 888
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
  expect(next).not.toEqual(old)
  const reading = config.reloadSettings()
  try {
    write.release()
    await readEntered.promise
    await Promise.all([changing, reading])
    expect(events.slice(0, 4)).toEqual([
      'save requested',
      'save completes',
      'reload reads written file',
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
      if (ordering === 'awaited') {
        release.resolve()
        await first
      }
      config.editorSyntaxHighlight = false
      const second = config.saveSettings()
      release.resolve()
      await Promise.all([first, second])
      expect(disk.saved.at(-1)?.editorSyntaxHighlight).toBe(false)
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
