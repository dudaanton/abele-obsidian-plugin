/**
 * The record of what has been run this session.
 *
 * It is the only place a finished script leaves a trace — nothing is written to the vault — so
 * what matters is that a run's ending is recorded once and honestly (told to stop is not the
 * same as failed), and that a script left running in a loop cannot fill memory unnoticed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptRuns, MAX_RUNS } from '@/scripting/ScriptRuns'

let runs: ScriptRuns

const begin = (name = 'Tag notes', stop: () => void = () => {}) =>
  runs.start({ path: `Scripts/${name}.js`, name, params: { tag: 'todo' }, source: 'command', stop })

beforeEach(() => {
  ScriptRuns.destroy()
  runs = ScriptRuns.getInstance()
})

describe('a run that has started', () => {
  it('is on the list, running, from the moment it begins', () => {
    const id = begin()

    expect(runs.find(id)).toMatchObject({ name: 'Tag notes', status: 'running' })
    expect(runs.running()).toHaveLength(1)
  })

  it('is at the top, above the ones that came before it', () => {
    begin('First')
    begin('Second')

    expect(runs.runs.value.map((r) => r.name)).toEqual(['Second', 'First'])
  })

  it('keeps what it was given, so it can be run again exactly as it was', () => {
    const id = begin()

    expect(runs.find(id)?.params).toEqual({ tag: 'todo' })
  })
})

describe('what a run says while it goes', () => {
  it('keeps each line with the time it was printed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T10:00:00Z'))
    const id = begin()

    runs.append(id, 'reading 12 notes')
    vi.advanceTimersByTime(5000)
    runs.append(id, 'done')

    const log = runs.find(id)?.log ?? []
    expect(log.map((l) => l.text)).toEqual(['reading 12 notes', 'done'])
    expect(log[1].at - log[0].at).toBe(5000)
    vi.useRealTimers()
  })

  it('carries what the script last said it was doing', () => {
    const id = begin()

    runs.setNote(id, 'page 3 of 9')

    expect(runs.find(id)?.note).toBe('page 3 of 9')
  })
})

describe('how a run ends', () => {
  it('finishes with what it returned', () => {
    const id = begin()

    runs.finish(id, '12 notes tagged')

    expect(runs.find(id)).toMatchObject({ status: 'done', result: '12 notes tagged' })
    expect(runs.find(id)?.finishedAt).toBeTypeOf('number')
  })

  it('fails with what went wrong', () => {
    const id = begin()

    runs.fail(id, 'read is not a function')

    expect(runs.find(id)).toMatchObject({ status: 'failed', error: 'read is not a function' })
  })

  /** Told to stop is a decision, not a fault, and the list should not colour it red. */
  it('says it was stopped rather than that it failed', () => {
    const id = begin()

    runs.markStopped(id)

    expect(runs.find(id)?.status).toBe('stopped')
  })

  it('does not change its ending once it has one', () => {
    const id = begin()

    runs.markStopped(id)
    runs.fail(id, 'too late')

    expect(runs.find(id)).toMatchObject({ status: 'stopped', error: '' })
  })
})

describe('stopping', () => {
  it('runs whatever the run left behind for stopping it', () => {
    const stop = vi.fn()
    const id = begin('Tag notes', stop)

    runs.stop(id)

    expect(stop).toHaveBeenCalled()
  })

  it('stops everything still going, and nothing that is not', () => {
    const first = vi.fn()
    const second = vi.fn()
    const gone = vi.fn()
    const id = begin('Done', gone)
    runs.finish(id, '')
    begin('One', first)
    begin('Two', second)

    runs.stopAll()

    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
    expect(gone).not.toHaveBeenCalled()
  })
})

describe('clearing the list', () => {
  it('takes away what has ended and leaves what has not', () => {
    const done = begin('Done')
    runs.finish(done, '')
    begin('Going')

    runs.clearFinished()

    expect(runs.runs.value.map((r) => r.name)).toEqual(['Going'])
  })

  it('forgets one run when that is what was asked', () => {
    const id = begin('Done')
    runs.finish(id, '')

    runs.forget(id)

    expect(runs.runs.value).toHaveLength(0)
  })

  it('will not forget a run that is still going', () => {
    const id = begin()

    runs.forget(id)

    expect(runs.runs.value).toHaveLength(1)
  })
})

describe('a session that runs a great many scripts', () => {
  it('keeps the most recent and drops the oldest', () => {
    for (let i = 0; i < MAX_RUNS + 10; i++) runs.finish(begin(`Run ${i}`), '')

    expect(runs.runs.value).toHaveLength(MAX_RUNS)
    expect(runs.runs.value[0].name).toBe(`Run ${MAX_RUNS + 9}`)
    expect(runs.runs.value.at(-1)?.name).toBe(`Run ${10}`)
  })

  /** Dropping a run that is still going would leave a script nobody can see or stop. */
  it('never drops one that is still going, however old', () => {
    const stuck = begin('Stuck')
    for (let i = 0; i < MAX_RUNS + 10; i++) runs.finish(begin(`Run ${i}`), '')

    expect(runs.find(stuck)).toBeDefined()
    expect(runs.runs.value).toHaveLength(MAX_RUNS)
  })
})
