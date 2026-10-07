import { afterEach, expect, it } from 'vitest'
import type { App } from 'obsidian'
import type AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ConnectionKeeper } from '@/sync/connectionKeeper'
import { CONNECTION_KEY } from '@/sync/connection'
import { createAgent } from '@/ai/agents/types'
import { FakeSettings } from '../helpers/fakeSettings'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const config = AbeleConfig.getInstance()
afterEach(() => config.destroy())

it('loads a synthetic 1.72.0 settings file without losing current features or inventing a sync identity', async () => {
  const app = useVault([])
  const previous = {
    refreshDelay: 777,
    tasksFolder: 'Sample tasks',
    taskPriorityProperty: 'sample-priority',
    calendarCompletion: {
      '["sample-feed","sample-event",null]': { feedId: 'sample-feed', seenAt: 1234 },
    },
    calendars: { feeds: [], refreshMinutes: 15 },
    canvasViewer: false,
    editorSyntaxHighlight: false,
    counterProperties: ['sample-count'],
    linter: { exclude: ['Sample archive'], rules: {} },
    secretStore: false,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      secrets: [{ id: 'sample-key-id', name: 'Sample key', keyId: 'sample-slot' }],
      agents: [
        createAgent({ id: 'sample-agent', name: 'Sample helper', toolDiscovery: 'by-group' }),
      ],
      chatHistory: [
        { path: 'Chats/sample.abchat', title: 'Sample', created: '2026-01-01T00:00:00Z' },
      ],
    },
  }
  const disk = Object.assign(new FakeSettings(previous), {
    app,
    manifest: { id: 'abele', dir: '.obsidian/plugins/abele' },
  })
  config.init(disk as unknown as AbelePlugin)
  await config.loadSettings()
  await new ConnectionKeeper(() => undefined).open(app as unknown as App)
  const settings = config.exportSettings()
  expect(settings).toMatchObject({
    refreshDelay: 777,
    tasksFolder: 'Sample tasks',
    taskPriorityProperty: 'sample-priority',
    canvasViewer: false,
    editorSyntaxHighlight: false,
    secretStore: false,
    counterProperties: ['sample-count'],
    sync: { keySignature: null },
  })
  expect(settings.linter).toEqual(previous.linter)
  expect(settings.calendars?.refreshMinutes).toBe(15)
  expect(settings.calendarCompletion).toEqual(previous.calendarCompletion)
  expect(settings.ai?.secrets).toEqual(previous.ai.secrets)
  expect(settings.ai?.agents.find((agent) => agent.id === 'sample-agent')?.toolDiscovery).toBe(
    'by-group'
  )
  expect(config.ai.chatHistory).toEqual(previous.ai.chatHistory)
  expect(app.loadLocalStorage(CONNECTION_KEY)).toMatchObject({
    serverUrl: '',
    deviceId: '',
    deviceTokenId: '',
    migrated: true,
  })
  await config.saveSettings()
  const beforeReload = config.exportSettings()
  await config.loadSettings()
  expect(config.exportSettings()).toEqual(beforeReload)
})

it('applies both shared sync and existing data migrations on the same load', async () => {
  useVault([])
  const disk = new FakeSettings({
    refreshDelay: 555,
    tasksFolder: 'Sample incoming',
    sync: { keySignature: { property: 'sample-private', value: 'yes' } },
    ai: {
      ...DEFAULT_AI_SETTINGS,
      secrets: [{ name: 'Sample legacy', keyId: 'sample-key' }],
      agents: [createAgent({ id: 'sample-helper', name: 'Sample helper' })],
    },
  })
  config.init(disk as unknown as AbelePlugin)
  await config.loadSettings()
  expect(config.sync).toEqual({ keySignature: { property: 'sample-private', value: 'yes' } })
  const id = config.ai.secrets[0].id
  expect(id).toEqual(expect.any(String))
  expect(id.length).toBeGreaterThan(0)
  expect(config.tasksFolder).toBe('Sample incoming')
  await config.loadSettings()
  expect(config.ai.secrets[0].id).toBe(id)
  expect(config.sync.keySignature?.property).toBe('sample-private')
})

it('preserves an explicit local edit and unrelated incoming fields when a queued save completes after the read', async () => {
  useVault([])
  const disk = new FakeSettings()
  config.init(disk as unknown as AbelePlugin)
  await config.loadSettings()
  const read = disk.delays.holdNext('load')
  disk.stored = { ...config.exportSettings(), refreshDelay: 888 }
  const reload = config.reloadSettings()
  await read.entered
  config.editSettings(() => {
    config.tasksFolder = 'Sample local edit'
  })
  const saved = config.saveSettings()
  const observed = deferred<void>()
  saved.then(() => observed.resolve())
  read.release()
  await reload
  await observed.promise
  expect(config.exportSettings()).toMatchObject({
    tasksFolder: 'Sample local edit',
    refreshDelay: 888,
  })
  expect(disk.saved.at(-1)).toMatchObject({ tasksFolder: 'Sample local edit', refreshDelay: 888 })
})
