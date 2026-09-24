/**
 * Which rule runs for which change, and how often.
 *
 * The engine is where the safety lives: a rule's own writes must not set it off again, a note
 * being typed into must not start a script per keystroke, a loop between two rules must be
 * cut, and a change that arrived by sync must not run the same script on every device.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AutomationEngine, ruleMatches } from '@/automations/AutomationEngine'
import {
  normalizeRule,
  type AutomationEvent,
  type AutomationRule,
  type NoteChange,
} from '@/automations/types'

const change = (overrides: Partial<NoteChange> = {}): NoteChange => ({
  kinds: ['task.completed', 'task.changed', 'note.changed'],
  path: 'Tasks/Buy milk.md',
  type: 'task',
  before: { type: 'task' },
  after: { type: 'task', completed: '2026-09-24', area: 'home' },
  changed: ['completed'],
  bodyChanged: false,
  origin: 'local',
  chain: [],
  at: Date.now(),
  ...overrides,
})

const rule = (overrides: Partial<AutomationRule> = {}): AutomationRule =>
  normalizeRule({
    id: 'r1',
    name: 'Log it',
    event: 'task.completed',
    scriptName: 'Log',
    throttleSeconds: 0,
    ...overrides,
  })

describe('a rule matches', () => {
  it('its event, among the kinds of the change', () => {
    expect(ruleMatches(rule(), change())).toBe(true)
    expect(ruleMatches(rule({ event: 'task.reopened' }), change())).toBe(false)
  })

  it('not when switched off or with no script', () => {
    expect(ruleMatches(rule({ enabled: false }), change())).toBe(false)
    expect(ruleMatches(rule({ scriptName: '' }), change())).toBe(false)
  })

  it('a note type, any case, and any type when none is given', () => {
    const film = change({ kinds: ['note.changed'], type: 'Movie', path: 'Films/Heat.md' })

    expect(ruleMatches(rule({ event: 'note.changed', noteTypes: ['movie'] }), film)).toBe(true)
    expect(ruleMatches(rule({ event: 'note.changed', noteTypes: ['book'] }), film)).toBe(false)
    expect(ruleMatches(rule({ event: 'note.changed' }), film)).toBe(true)
  })

  it('ignores the type filter for a task event: a task is a task', () => {
    expect(ruleMatches(rule({ noteTypes: ['movie'] }), change())).toBe(true)
  })

  it('a folder, at any depth, and not a folder that only starts the same', () => {
    expect(ruleMatches(rule({ folders: ['Tasks'] }), change())).toBe(true)
    expect(ruleMatches(rule({ folders: ['Task'] }), change())).toBe(false)
    expect(
      ruleMatches(rule({ folders: ['Tasks'] }), change({ path: 'Tasks/Home/Buy milk.md' }))
    ).toBe(true)
  })

  it('a property equal to a value, or only filled in when no value is given', () => {
    expect(ruleMatches(rule({ property: 'area', value: 'home' }), change())).toBe(true)
    expect(ruleMatches(rule({ property: 'area', value: 'work' }), change())).toBe(false)
    expect(ruleMatches(rule({ property: 'area' }), change())).toBe(true)
    expect(ruleMatches(rule({ property: 'project' }), change())).toBe(false)
    const listed = change({ after: { type: 'task', area: ['home', 'garden'] } })
    expect(ruleMatches(rule({ property: 'area', value: 'garden' }), listed)).toBe(true)
  })

  it('a deleted note by what it was', () => {
    const gone = change({
      kinds: ['note.deleted'],
      type: 'movie',
      path: 'Films/Heat.md',
      before: { type: 'movie', seen: 'yes' },
      after: null,
    })
    const r = rule({ event: 'note.deleted', noteTypes: ['movie'], property: 'seen', value: 'yes' })

    expect(ruleMatches(r, gone)).toBe(true)
  })

  it('a change from elsewhere only when the rule asks for those', () => {
    const synced = change({ origin: 'external' })

    expect(ruleMatches(rule(), synced)).toBe(false)
    expect(ruleMatches(rule({ includeExternal: true }), synced)).toBe(true)
  })
})

describe('the engine', () => {
  let rules: AutomationRule[]
  let runs: { rule: string; event: AutomationEvent; chain: string[] }[]
  let notices: string[]
  let allowed: boolean
  let engine: AutomationEngine

  beforeEach(() => {
    vi.useFakeTimers()
    rules = [rule()]
    runs = []
    notices = []
    allowed = true
    engine = new AutomationEngine({
      rules: () => rules,
      canRun: () => allowed,
      run: async (r, event, chain) => {
        runs.push({ rule: r.id, event, chain })
      },
      notify: (message) => notices.push(message),
    })
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('runs the matching rule with the event it waited for', () => {
    engine.handle(change())

    expect(runs).toHaveLength(1)
    expect(runs[0].event).toMatchObject({
      kind: 'task.completed',
      path: 'Tasks/Buy milk.md',
      before: { type: 'task' },
      changed: ['completed'],
      rule: { id: 'r1', name: 'Log it' },
    })
    expect(runs[0].chain).toEqual(['r1'])
  })

  it('runs nothing while the settings could not be read', () => {
    allowed = false
    engine.handle(change())

    expect(runs).toHaveLength(0)
  })

  describe('throttled per note', () => {
    beforeEach(() => {
      rules = [rule({ event: 'note.changed', throttleSeconds: 10 })]
    })

    it('runs the first at once and folds the rest into one run at the end', () => {
      engine.handle(change({ changed: ['a'], before: { v: 1 }, after: { v: 2 } }))
      engine.handle(change({ changed: ['b'], before: { v: 2 }, after: { v: 3 } }))
      engine.handle(change({ changed: ['c'], before: { v: 3 }, after: { v: 4 } }))
      expect(runs).toHaveLength(1)

      vi.advanceTimersByTime(10_000)

      expect(runs).toHaveLength(2)
      expect(runs[1].event.before).toEqual({ v: 2 })
      expect(runs[1].event.after).toEqual({ v: 4 })
      expect(runs[1].event.changed).toEqual(['b', 'c'])
    })

    it('keeps notes apart', () => {
      engine.handle(change())
      engine.handle(change({ path: 'Tasks/Other.md' }))

      expect(runs).toHaveLength(2)
    })
  })

  describe('loops', () => {
    it('a change the rule itself wrote does not run it again', () => {
      engine.handle(change({ chain: ['r1'] }))

      expect(runs).toHaveLength(0)
    })

    it('another rule still runs, and carries the chain on', () => {
      rules = [rule(), rule({ id: 'r2', name: 'Other' })]
      engine.handle(change({ chain: ['r1'] }))

      expect(runs.map((r) => r.rule)).toEqual(['r2'])
      expect(runs[0].chain).toEqual(['r1', 'r2'])
    })

    it('a chain three rules long is cut', () => {
      rules = [rule({ id: 'r4' })]
      engine.handle(change({ chain: ['r1', 'r2', 'r3'] }))

      expect(runs).toHaveLength(0)
    })

    it('too many runs in a minute pause every automation, and say so once', () => {
      rules = [rule({ event: 'note.changed' })]
      for (let i = 0; i < 40; i++) engine.handle(change({ path: `Notes/${i}.md` }))

      expect(runs).toHaveLength(30)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatch(/paused/i)

      vi.advanceTimersByTime(120_000)
      engine.handle(change({ path: 'Notes/later.md' }))
      expect(runs).toHaveLength(30)

      // Changing an automation is the person looking at it: they run again.
      engine.reset()
      engine.handle(change({ path: 'Notes/later.md' }))
      expect(runs).toHaveLength(31)
    })
  })
})

describe('a rule as stored', () => {
  it('is filled in from whatever was saved', () => {
    const made = normalizeRule({ id: 'x', event: 'nonsense' as never, throttleSeconds: -1 })

    expect(made).toMatchObject({
      id: 'x',
      enabled: true,
      event: 'task.completed',
      noteTypes: [],
      folders: [],
      params: {},
      throttleSeconds: 5,
      includeExternal: false,
    })
  })
})
