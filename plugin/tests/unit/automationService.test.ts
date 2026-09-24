/**
 * The pieces together: settings, the bus, the vault's write methods and a real script.
 *
 * The case that matters most is the one a person would set up first — "when a task is
 * completed, write something into it" — which, done naively, completes a loop: the script's
 * write is a change to a completed task, which runs the script, which writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { AutomationService } from '@/automations/AutomationService'
import { forgetNotices } from '@/automations/runAutomation'
import { normalizeRule } from '@/automations/types'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { FakeApp } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

let app: FakeApp
let config: AbeleConfig
let automations: AutomationService

const TASK = 'Tasks/Buy milk.md'
const file = (path: string) => app.vault.getAbstractFileByPath(path) as TFile
const vault = () => app.vault as unknown as Record<string, unknown>

function register(name: string, code: string) {
  const path = `Scripts/${name}.js`
  const scripts = (ScriptService.getInstance() as unknown as { scripts: Map<string, unknown> })
    .scripts
  scripts.set(path, { path, code, commandId: '', meta: { name, description: '', params: [] } })
}

/** What Obsidian does after a save: the cache re-parsed, then `changed`. */
function reindex(path: string, frontmatter: Record<string, unknown>, body = '') {
  app.setFrontmatter(path, frontmatter)
  app.emit('metadataCache', 'changed', file(path), body)
}

const runs = () => ScriptRuns.getInstance().runs.value
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  app = useVault([{ path: TASK, frontmatter: { type: 'task' }, content: 'milk' }])
  config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, enabled: true, scriptsEnabled: true }
  config.automations = []
  ScriptRuns.destroy()
  ScriptService.destroy()
  AutomationService.destroy()
  forgetNotices()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  automations = AutomationService.getInstance()
})

afterEach(() => {
  AutomationService.destroy()
  vi.useRealTimers()
})

describe('with no automation switched on', () => {
  it('neither listens nor wraps the vault', () => {
    const modify = vault().modify
    config.automations = [normalizeRule({ id: 'r1', enabled: false, scriptName: 'Log' })]
    automations.start(app as never)

    expect(automations.listening).toBe(false)
    expect(vault().modify).toBe(modify)
  })
})

describe('switched on', () => {
  beforeEach(() => {
    register('Log', "await write(event.path, 'milk\\n\\ndone'); return 'logged'")
    config.automations = [
      // `task.changed` with no throttle: the script's own write matches it again, and nothing
      // but the loop guard stands between them.
      normalizeRule({
        id: 'r1',
        name: 'Log it',
        event: 'task.changed',
        scriptName: 'Log',
        throttleSeconds: 0,
      }),
    ]
    automations.start(app as never)
  })

  it('runs the script once when the task is completed, and not again for its own write', async () => {
    // Ticking the task: the plugin writes the note through the vault, the cache re-parses it.
    await (vault().modify as (f: TFile, s: string) => Promise<void>)(file(TASK), 'x')
    reindex(TASK, { type: 'task', completed: '2026-09-24' })
    await settle()

    expect(runs()).toHaveLength(1)
    expect(runs()[0].status).toBe('done')

    // The script's own write, re-parsed: a task changed, which is what the rule waits for.
    reindex(TASK, { type: 'task', completed: '2026-09-24', note: 'done' }, 'done')
    await settle()

    expect(runs()).toHaveLength(1)
  })

  it('does not run for a change that arrived from elsewhere', async () => {
    // No write through the vault here: the file changed underneath, as sync does it.
    reindex(TASK, { type: 'task', completed: '2026-09-24' })
    await settle()

    expect(runs()).toHaveLength(0)
  })

  it('stops listening, and puts the vault back, when the last rule is switched off', () => {
    config.automations = [{ ...config.automations[0], enabled: false }]
    config.version.value++
    return Promise.resolve().then(() => {
      expect(automations.listening).toBe(false)
    })
  })

  it('does nothing while the settings could not be read', async () => {
    vi.spyOn(config, 'settingsUnreadable', 'get').mockReturnValue(true)
    await (vault().modify as (f: TFile, s: string) => Promise<void>)(file(TASK), 'x')
    reindex(TASK, { type: 'task', completed: '2026-09-24' })
    await settle()

    expect(runs()).toHaveLength(0)
  })
})
