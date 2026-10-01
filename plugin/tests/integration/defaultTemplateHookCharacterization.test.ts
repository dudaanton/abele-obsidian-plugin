import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TFolder, type TAbstractFile } from 'obsidian'
import AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { gate } from '../helpers/taskHarness'
import { configureAbele, dailyJournal } from '../helpers/testEnv'
import { templateHarness } from '../helpers/templateHarness'

// Drive public onload while omitting unrelated startup subsystems, never calling the
// private registration method or copying its event handler into the test.
vi.mock('@/helpers/startupSteps', () => ({
  beginStartup: vi.fn(),
  startupStep: (name: string, run: () => void) => {
    if (name === 'links') run()
  },
  startupStepAsync: async () => {},
}))
vi.mock('@/secrets/host', () => ({ createPluginSecrets: () => ({}) }))
vi.mock('@/secrets/SecretStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/secrets/SecretStore')>()),
  setSecrets: vi.fn(),
}))
vi.mock('@/helpers/fieldFocus', () => ({ registerFocusRelease: vi.fn() }))
vi.mock('@/helpers/keyboardDiagnostics', () => ({ setKeyboardDiagnostics: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(AbeleConfig.getInstance(), 'init').mockImplementation(() => {})
  configureAbele()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false }
  vi.spyOn(AbeleConfig.getInstance(), 'isPathExcludedFromDefaultTemplate').mockReturnValue(false)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup() {
  const env = templateHarness([
    { path: 'Notes/empty.md' },
    { path: 'Notes/content.md', content: 'keep' },
    { path: 'Media/sample.png' },
  ])
  await env.template('Default body', { template_for: 'default' })
  const ready: (() => void)[] = []
  Object.assign(env.app.workspace, { onLayoutReady: (fn: () => void) => ready.push(fn) })
  const on = vi.spyOn(env.app.vault, 'on')
  const plugin = Object.assign(Object.create(AbelePlugin.prototype) as AbelePlugin, {
    app: env.app,
    addSettingTab: vi.fn(),
    registerEvent: vi.fn(),
    registerObsidianProtocolHandler: vi.fn(),
  })
  await plugin.onload()
  expect(on).not.toHaveBeenCalled()
  ready.forEach((fn) => fn())
  const callback = on.mock.calls.find(([name]) => name === 'create')![1] as (
    file: TAbstractFile
  ) => Promise<void>
  return { ...env, callback, file: env.app.vault.getFileByPath('Notes/empty.md')! }
}

describe('default template on newly created notes', () => {
  it('registers after layout readiness, waits the grace period and fills an empty note', async () => {
    const env = await setup()
    const pending = env.callback(env.file)
    await vi.advanceTimersByTimeAsync(999)
    expect(await env.app.vault.read(env.file)).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(await env.app.vault.read(env.file)).toBe('Default body')
  })

  it('does not overwrite content added during the grace period', async () => {
    const env = await setup()
    const pending = env.callback(env.file)
    await env.app.vault.modify(env.file, 'Arrived from another writer')
    await vi.runAllTimersAsync()
    await pending
    expect(await env.app.vault.read(env.file)).toBe('Arrived from another writer')
  })

  // BUG: the emptiness check happens before the awaited template read. Text arriving
  // after that check is overwritten by the final vault.modify rather than preserved.
  it('preserves content arriving while the default template itself is being read', async () => {
    const env = await setup()
    const reading = gate()
    const resume = gate()
    const read = env.app.vault.read.bind(env.app.vault)
    vi.spyOn(env.app.vault, 'read').mockImplementation(async (file) => {
      if (file.path === 'Templates/sample.md') {
        reading.release()
        await resume.promise
      }
      return read(file)
    })
    const pending = env.callback(env.file)
    await vi.advanceTimersByTimeAsync(1000)
    await reading.promise
    await env.app.vault.modify(env.file, 'Concurrent content')
    resume.release()
    await pending
    expect(await read(env.file)).toBe('Concurrent content')
  })

  it('preserves unsaved input arriving during the template read and skips callbacks', async () => {
    const env = await setup()
    env.app.setFrontmatter('Templates/sample.md', {
      type: 'template',
      template_for: 'default',
      callbacks: 'command:sample',
    })
    const reading = gate()
    const resume = gate()
    const read = env.app.vault.read.bind(env.app.vault)
    vi.spyOn(env.app.vault, 'read').mockImplementation(async (file) => {
      if (file.path === 'Templates/sample.md') {
        reading.release()
        await resume.promise
      }
      return read(file)
    })
    const pending = env.callback(env.file)
    await vi.advanceTimersByTimeAsync(1000)
    await reading.promise
    env.workspace.getLeavesOfType.mockReturnValue([
      { view: { file: env.file, editor: { getValue: () => 'New unsaved input' } } },
    ] as never)
    resume.release()
    await pending
    expect(await read(env.file)).toBe('')
    expect(env.commands.executeCommandById).not.toHaveBeenCalled()
  })

  it('checks the current disk content inside the atomic process callback', async () => {
    const env = await setup()
    const process = env.app.vault.process.bind(env.app.vault)
    vi.spyOn(env.app.vault, 'process').mockImplementation(async (file, fn) => {
      await env.app.vault.modify(file, 'Arrived at the write boundary')
      return process(file, fn)
    })
    const pending = env.callback(env.file)
    await vi.runAllTimersAsync()
    await pending
    expect(await env.app.vault.read(env.file)).toBe('Arrived at the write boundary')
    expect(env.app.vault.process).toHaveBeenCalledOnce()
  })

  it('checks unsaved editor content and treats whitespace-only notes as empty', async () => {
    const env = await setup()
    env.workspace.getLeavesOfType.mockReturnValue([
      { view: { file: env.file, editor: { getValue: () => 'Unsaved content' } } },
    ] as never)
    let pending = env.callback(env.file)
    await vi.runAllTimersAsync()
    await pending
    expect(await env.app.vault.read(env.file)).toBe('')
    env.workspace.getLeavesOfType.mockReturnValue([])
    await env.app.vault.modify(env.file, ' \n\t ')
    pending = env.callback(env.file)
    await vi.runAllTimersAsync()
    await pending
    expect(await env.app.vault.read(env.file)).toBe('Default body')
  })

  it('ignores folders, attachments, excluded paths, journals and nonempty notes', async () => {
    const env = await setup()
    await env.callback(new TFolder())
    await env.callback(env.app.vault.getFileByPath('Media/sample.png')!)
    vi.mocked(AbeleConfig.getInstance().isPathExcludedFromDefaultTemplate).mockReturnValue(true)
    await env.callback(env.file)
    vi.mocked(AbeleConfig.getInstance().isPathExcludedFromDefaultTemplate).mockReturnValue(false)
    configureAbele({ journals: [dailyJournal()] })
    const journal = await env.app.vault.create('Journals/2028/2028-03-01.md', '')
    env.app.setFrontmatter(journal.path, { type: 'journal' })
    await env.callback(journal)
    expect(vi.getTimerCount()).toBe(0)
    const pending = env.callback(env.app.vault.getFileByPath('Notes/content.md')!)
    await vi.runAllTimersAsync()
    await pending
    expect(await env.app.vault.read(env.app.vault.getFileByPath('Notes/content.md')!)).toBe('keep')
    expect(await env.app.vault.read(journal)).toBe('')
  })
})
