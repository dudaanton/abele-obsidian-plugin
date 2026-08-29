/**
 * Running a script now leaves a record of itself.
 *
 * Every way of starting a script goes through `execute`, so that is where the record is made —
 * which also means `execute` had to grow an argument without breaking the four callers that
 * were already passing an `AbortSignal` in that position. Both halves are checked here: that a
 * run is recorded, honestly, from wherever it was asked for, and that the old call still works.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const SCRIPT = `// @name Tag notes
// @description Adds a tag
// @param tag string "Tag to add"

log('starting')
await new Promise((resolve) => setTimeout(resolve, 0))
if (params.tag === 'boom') throw new Error('no such tag')
return 'tagged ' + params.tag
`

const SLOW = `// @name Slow
while (true) {
  await new Promise((resolve) => setTimeout(resolve, 5))
}
`

let service: ScriptService

const fakePlugin = () => ({
  addCommand: vi.fn(),
  removeCommand: vi.fn(),
  addStatusBarItem: vi.fn(() => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }),
})

beforeEach(async () => {
  useVault([
    { path: 'Scripts/tag.js', content: SCRIPT },
    { path: 'Scripts/slow.js', content: SLOW },
  ])
  ScriptRuns.destroy()
  ScriptService.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = fakePlugin()
  service = ScriptService.getInstance()
  await service.discover()
})

const runs = () => ScriptRuns.getInstance().runs.value

describe('a script that ran', () => {
  it('is on the list, with what it was given and what it returned', async () => {
    await service.execute('Scripts/tag.js', { tag: 'todo' }, { source: 'command' })

    expect(runs()).toHaveLength(1)
    expect(runs()[0]).toMatchObject({
      name: 'Tag notes',
      path: 'Scripts/tag.js',
      params: { tag: 'todo' },
      source: 'command',
      status: 'done',
    })
    expect(runs()[0].result).toContain('tagged todo')
  })

  it('kept what it printed, line by line', async () => {
    await service.execute('Scripts/tag.js', { tag: 'todo' }, { source: 'command' })

    expect(runs()[0].log.map((line) => line.text)).toEqual(['starting'])
  })

  it('says who asked for it', async () => {
    await service.execute('Scripts/tag.js', { tag: 'a' }, { source: 'link' })

    expect(runs()[0].source).toBe('link')
  })

  /** The agent is the caller that cannot say who it is from inside a tool. */
  it('is put down to the agent when nobody said', async () => {
    await service.execute('Scripts/tag.js', { tag: 'a' })

    expect(runs()[0].source).toBe('agent')
  })
})

describe('a script that threw', () => {
  it('is recorded as failed, with the message, and still throws to its caller', async () => {
    await expect(service.execute('Scripts/tag.js', { tag: 'boom' })).rejects.toThrow('no such tag')

    expect(runs()[0]).toMatchObject({ status: 'failed', error: 'no such tag' })
  })
})

describe('a script that was stopped', () => {
  it('is recorded as stopped rather than as a failure', async () => {
    const running = service.execute('Scripts/slow.js', {}, { source: 'command' })
    await vi.waitFor(() => expect(runs()).toHaveLength(1))

    ScriptRuns.getInstance().stop(runs()[0].id)
    await expect(running).rejects.toThrow()

    expect(runs()[0].status).toBe('stopped')
  })

  it('can be stopped through the signal its caller passed, as before', async () => {
    const controller = new AbortController()
    const running = service.execute('Scripts/slow.js', {}, controller.signal)
    await vi.waitFor(() => expect(runs()).toHaveLength(1))

    controller.abort()
    await expect(running).rejects.toThrow()

    expect(runs()[0].status).toBe('stopped')
  })
})

describe('the old way of calling execute', () => {
  it('still takes a signal and a form handler where it always did', async () => {
    const forms: unknown[] = []

    const result = await service.execute(
      'Scripts/tag.js',
      { tag: 'todo' },
      new AbortController().signal,
      async (fields) => {
        forms.push(fields)
        return null
      }
    )

    expect(result).toContain('tagged todo')
    expect(runs()[0].status).toBe('done')
  })
})

describe('what the script says it is doing', () => {
  it('is kept against the run rather than only flashed in the status bar', async () => {
    useVault([{ path: 'Scripts/status.js', content: '// @name Status\nawait setStatus("page 3")' }])
    await service.discover()

    await service.execute('Scripts/status.js', {}, { source: 'command' })

    expect(runs()[0].note).toBe('page 3')
  })
})

describe('two scripts at once', () => {
  it('each get their own row, and stopping one leaves the other going', async () => {
    // Both loop until stopped, so their rejections are caught up front rather than awaited.
    const ended: string[] = []
    const first = service
      .execute('Scripts/slow.js', {}, { source: 'command' })
      .catch(() => ended.push('first'))
    const second = service
      .execute('Scripts/slow.js', {}, { source: 'command' })
      .catch(() => ended.push('second'))
    await vi.waitFor(() => expect(runs()).toHaveLength(2))

    ScriptRuns.getInstance().stop(runs()[0].id)
    await vi.waitFor(() => expect(ended).toHaveLength(1))

    expect(runs().filter((run) => run.status === 'running')).toHaveLength(1)

    ScriptRuns.getInstance().stopAll()
    await Promise.all([first, second])
  })
})
