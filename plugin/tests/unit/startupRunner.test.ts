/**
 * Running the startup scripts: one after another in the order given, each on its own — one that
 * throws or hangs does not keep the others from running — without a form for anybody to fill
 * in, and with two ways out when a startup script is what breaks the start: the switch that
 * skips them all, and the memory of the script that was running when the app last went down.
 */
import { describe, it, expect, vi } from 'vitest'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { RUNNING_STARTUP_KEY, runStartupScripts, type StartupRun } from '@/scripting/startupRunner'
import type { ExecuteOptions } from '@/scripting/ScriptService'
import type { ParsedScript } from '@/scripting/types'

const parsed = (header: string): ParsedScript => {
  const meta = parseScriptHeader(header)!
  const slug = meta.name.toLowerCase().replace(/\s+/g, '-')
  return { path: `Scripts/${slug}.js`, code: '', commandId: `abele:script-${slug}`, meta }
}

const A = parsed('// @name First')
const B = parsed('// @name Second')
const C = parsed('// @name Third')

type Behaviour = (opts: ExecuteOptions, params: Record<string, unknown>) => Promise<string>

function setup(
  queue: ParsedScript[],
  behaviours: Record<string, Behaviour> = {},
  extra: Partial<StartupRun> = {}
) {
  const store = new Map<string, unknown>()
  const order: string[] = []
  const notices: string[] = []
  const markersSeen: unknown[] = []
  const run: StartupRun = {
    queue,
    paused: false,
    timeoutMs: 50,
    storage: {
      load: (key) => store.get(key) ?? null,
      save: (key, value) => {
        if (value === null) store.delete(key)
        else store.set(key, value)
      },
    },
    notify: (message) => notices.push(message),
    execute: async (path, params, opts) => {
      order.push(path)
      markersSeen.push(store.get(RUNNING_STARTUP_KEY))
      const behaviour = behaviours[path]
      return behaviour ? behaviour(opts, params) : 'ok'
    },
    ...extra,
  }
  return { run, store, order, notices, markersSeen }
}

describe('running the startup scripts', () => {
  it('runs each in the order given, one after another', async () => {
    const finished: string[] = []
    const slow: Behaviour = async () => {
      await new Promise((r) => setTimeout(r, 20))
      finished.push(A.path)
      return ''
    }
    // Nothing here is about the time limit; the default one is short enough that a busy machine
    // wakes the slow script past it, and the next one would start while it still runs.
    const { run, order } = setup(
      [A, B, C],
      {
        [A.path]: slow,
        [B.path]: async () => {
          finished.push(B.path)
          return ''
        },
      },
      { timeoutMs: 10_000 }
    )

    const report = await runStartupScripts(run)

    expect(order).toEqual([A.path, B.path, C.path])
    expect(finished).toEqual([A.path, B.path])
    expect(report.map((r) => r.outcome)).toEqual(['done', 'done', 'done'])
  })

  it('goes on past one that throws, and says which one in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { run, order } = setup([A, B], {
      [A.path]: async () => {
        throw new Error('boom')
      },
    })

    const report = await runStartupScripts(run)

    expect(order).toEqual([A.path, B.path])
    expect(report.map((r) => r.outcome)).toEqual(['failed', 'done'])
    expect(warn.mock.calls.flat().join(' ')).toContain('First')
    warn.mockRestore()
  })

  it('goes on past one that hangs once its time is up, and names it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { run, order } = setup([A, B], {
      [A.path]: () => new Promise<string>(() => {}),
    })

    const report = await runStartupScripts(run)

    expect(order).toEqual([A.path, B.path])
    expect(report.map((r) => r.outcome)).toEqual(['timeout', 'done'])
    expect(warn.mock.calls.flat().join(' ')).toContain('First')
    warn.mockRestore()
  })

  it('asks nothing: the run is a startup one, and a form inside it is dismissed', async () => {
    let answer: unknown = 'unset'
    let source: unknown
    const { run } = setup([A], {
      [A.path]: async (opts) => {
        source = opts.source
        answer = await opts.formHandler?.([{ name: 'x', label: 'X', type: 'text' }], 'run-1')
        return ''
      },
    })

    await runStartupScripts(run)

    expect(source).toBe('startup')
    expect(answer).toBeNull()
  })

  it('gives a script its defaults, and skips one that needs a value it has no default for', async () => {
    const withDefault = parsed('// @name Defaulted\n// @param n number? "N" = 3')
    const needy = parsed('// @name Needy\n// @param q string "Query"')
    let given: unknown
    const { run, order, notices } = setup([withDefault, needy, B], {
      [withDefault.path]: async (_opts, params) => {
        given = params
        return ''
      },
    })

    const report = await runStartupScripts(run)

    expect(given).toEqual({ n: 3 })
    expect(order).toEqual([withDefault.path, B.path])
    expect(report.map((r) => r.outcome)).toEqual(['done', 'skipped', 'done'])
    expect(notices.join(' ')).toContain('Needy')
  })

  it('runs nothing while the switch says to skip them', async () => {
    const { run, order } = setup([A, B], {}, { paused: true })

    const report = await runStartupScripts(run)

    expect(order).toEqual([])
    expect(report).toEqual([])
  })
})

describe('a startup script that brought the app down', () => {
  it('is remembered while it runs, and forgotten once it is done', async () => {
    const { run, store, markersSeen } = setup([A, B])

    await runStartupScripts(run)

    expect(markersSeen).toEqual([
      { path: A.path, name: 'First' },
      { path: B.path, name: 'Second' },
    ])
    expect(store.has(RUNNING_STARTUP_KEY)).toBe(false)
  })

  it('is skipped at the next start, once, with a notice naming it', async () => {
    const { run, store, order, notices } = setup([A, B])
    store.set(RUNNING_STARTUP_KEY, { path: A.path, name: 'First' })

    const report = await runStartupScripts(run)

    expect(order).toEqual([B.path])
    expect(report.map((r) => r.outcome)).toEqual(['skipped', 'done'])
    expect(notices.join(' ')).toContain('First')
    expect(store.has(RUNNING_STARTUP_KEY)).toBe(false)

    // The start after that runs it again.
    const again = await runStartupScripts(run)
    expect(again.map((r) => r.outcome)).toEqual(['done', 'done'])
  })

  it('is forgotten when the switch skips everything, so it is not held against the next start', async () => {
    const { run, store } = setup([A], {}, { paused: true })
    store.set(RUNNING_STARTUP_KEY, { path: A.path, name: 'First' })

    await runStartupScripts(run)

    expect(store.has(RUNNING_STARTUP_KEY)).toBe(false)
  })
})
