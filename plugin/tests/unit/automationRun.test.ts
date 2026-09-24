/**
 * An automation's script, run for real: what it is handed, what it is told about the note, and
 * what becomes of its writes and its failures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { forgetNotices, runAutomation } from '@/automations/runAutomation'
import { normalizeRule, type AutomationEvent, type AutomationRule } from '@/automations/types'
import { useVault } from '../helpers/testEnv'

let service: ScriptService
let marks: { path: string; chain: string[] }[]
const marker = { markChain: (path: string, chain: string[]) => marks.push({ path, chain }) }

function register(name: string, code: string, params: string[] = []): string {
  const path = `Scripts/${name}.js`
  const scripts = (service as unknown as { scripts: Map<string, unknown> }).scripts
  scripts.set(path, {
    path,
    code,
    commandId: '',
    meta: {
      name,
      description: '',
      params: params.map((p) => ({ name: p, type: 'string', required: false, description: '' })),
    },
  })
  return path
}

const event = (overrides: Partial<AutomationEvent> = {}): AutomationEvent => ({
  kind: 'task.completed',
  kinds: ['task.completed', 'task.changed', 'note.changed'],
  path: 'Tasks/Buy milk.md',
  type: 'task',
  before: { type: 'task' },
  after: { type: 'task', completed: '2026-09-24', area: 'home' },
  changed: ['completed'],
  bodyChanged: false,
  origin: 'local',
  at: 0,
  rule: { id: 'r1', name: 'Log it' },
  ...overrides,
})

const rule = (overrides: Partial<AutomationRule> = {}) =>
  normalizeRule({
    id: 'r1',
    name: 'Log it',
    event: 'task.completed',
    scriptName: 'Log',
    ...overrides,
  })

const lastRun = () => ScriptRuns.getInstance().runs.value[0]

beforeEach(() => {
  useVault([{ path: 'Tasks/Buy milk.md', frontmatter: { type: 'task' }, content: 'milk' }])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ScriptRuns.destroy()
  ScriptService.destroy()
  service = ScriptService.getInstance()
  marks = []
  Notice.shown.length = 0
  forgetNotices()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the script', () => {
  it('reads what happened as `event`', async () => {
    register(
      'Log',
      'return JSON.stringify({ kind: event.kind, path: event.path, before: event.before, changed: event.changed, origin: event.origin })'
    )

    await runAutomation(rule(), event(), ['r1'], marker)

    expect(JSON.parse(lastRun().result)).toEqual({
      kind: 'task.completed',
      path: 'Tasks/Buy milk.md',
      before: { type: 'task' },
      changed: ['completed'],
      origin: 'local',
    })
    expect(lastRun().source).toBe('automation')
    expect(lastRun().trigger).toBe('Task completed · Tasks/Buy milk.md')
  })

  it('gets its parameters filled in from the note, as a header button would', async () => {
    register('Log', 'return params.line', ['line'])

    await runAutomation(
      rule({ params: { line: '{{title}} in {{area}} ({{event}})' } }),
      event(),
      ['r1'],
      marker
    )

    expect(lastRun().result).toBe('Buy milk in home (task.completed)')
  })

  it('of a deleted note, from what the note was', async () => {
    register('Log', 'return params.line', ['line'])

    await runAutomation(
      rule({ event: 'note.deleted', params: { line: '{{title}} was {{type}}' } }),
      event({
        kind: 'note.deleted',
        path: 'Gone.md',
        type: 'movie',
        before: { type: 'movie' },
        after: null,
      }),
      ['r1'],
      marker
    )

    expect(lastRun().result).toBe('Gone was movie')
  })

  it('marks every note it writes with the chain that led to it', async () => {
    register('Log', "await write(event.path, 'done'); await create('Log.md', 'x')")

    await runAutomation(rule(), event(), ['r0', 'r1'], marker)

    expect(marks).toEqual([
      { path: 'Tasks/Buy milk.md', chain: ['r0', 'r1'] },
      { path: 'Log.md', chain: ['r0', 'r1'] },
    ])
  })

  it('may call its own variable `event`, as scripts written before this did', async () => {
    register('Log', 'const event = 1\nreturn String(event + 1)')

    await runAutomation(rule(), event(), ['r1'], marker)

    expect(lastRun().result).toBe('2')
  })

  it('run any other way, finds `event` empty', async () => {
    const path = register('Log', 'return String(event)')

    await expect(service.execute(path, {}, { source: 'command' })).resolves.toBe('null')
  })
})

describe('a failure', () => {
  it('is a failed run in the list and one notice, not an exception', async () => {
    register('Log', "throw new Error('no log note')")

    await runAutomation(rule(), event(), ['r1'], marker)
    await runAutomation(rule(), event(), ['r1'], marker)

    expect(lastRun().status).toBe('failed')
    expect(lastRun().error).toBe('no log note')
    expect(Notice.shown.filter((m) => m.includes('Log it'))).toHaveLength(1)
  })

  it('of a script that is not there is a failed run naming it', async () => {
    await runAutomation(rule({ scriptName: 'Missing' }), event(), ['r1'], marker)

    expect(lastRun().status).toBe('failed')
    expect(lastRun().error).toContain('Missing')
    expect(lastRun().source).toBe('automation')
  })
})
