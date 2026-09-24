/**
 * The one bus automations listen to: what happened to which note, with the frontmatter before
 * and after, which properties changed and where the change came from.
 *
 * It is built on the metadata cache rather than on the raw vault events, because a note's type
 * — which is what decides whether it is a task at all — only exists once the cache has parsed
 * it. That is also why a new note is announced after it settles: a note made from a template
 * is created empty and filled a moment later, and announcing the empty one would say it had
 * no type.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { NoteEventBus } from '@/automations/NoteEventBus'
import { kindsFor, changedKeys } from '@/automations/diff'
import type { NoteChange } from '@/automations/types'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'

let app: FakeApp
let bus: NoteEventBus
let seen: NoteChange[]
let origins: Map<string, { origin: 'local' | 'external'; chain: string[] }>

const file = (path: string) => app.vault.getAbstractFileByPath(path) as TFile

/** What Obsidian does after a save: new frontmatter in the cache, then `changed`. */
function save(path: string, frontmatter: Record<string, unknown>, body = 'text') {
  app.setFrontmatter(path, frontmatter)
  app.emit('metadataCache', 'changed', file(path), `---\nx: 1\n---\n${body}`, {})
}

beforeEach(() => {
  vi.useFakeTimers()
  app = buildFakeVault([
    { path: 'Tasks/Buy milk.md', frontmatter: { type: 'task', created: '2026-09-01' } },
    { path: 'Films/Heat.md', frontmatter: { type: 'movie', rating: 7 } },
    { path: 'Plain.md' },
  ])
  origins = new Map()
  seen = []
  bus = new NoteEventBus(
    app as never,
    (path) => origins.get(path) ?? { origin: 'local', chain: [] },
    { settleMs: 1000, maxSettleMs: 5000 }
  )
  bus.start()
  bus.subscribe((change) => seen.push(change))
})

afterEach(() => {
  bus.stop()
  vi.useRealTimers()
})

describe('a task', () => {
  it('completed: completed filled in, with before and after', () => {
    save('Tasks/Buy milk.md', { type: 'task', created: '2026-09-01', completed: '2026-09-24' })

    expect(seen).toHaveLength(1)
    const [change] = seen
    expect(change.kinds).toEqual(
      expect.arrayContaining(['task.completed', 'task.changed', 'note.changed'])
    )
    expect(change.kinds).not.toContain('task.reopened')
    expect(change.before).toEqual({ type: 'task', created: '2026-09-01' })
    expect(change.after).toEqual({ type: 'task', created: '2026-09-01', completed: '2026-09-24' })
    expect(change.changed).toEqual(['completed'])
    expect(change.type).toBe('task')
    expect(change.path).toBe('Tasks/Buy milk.md')
    expect(change.origin).toBe('local')
  })

  it('reopened: completed emptied', () => {
    save('Tasks/Buy milk.md', { type: 'task', completed: '2026-09-24' })
    seen = []
    save('Tasks/Buy milk.md', { type: 'task', completed: '' })

    expect(seen[0].kinds).toContain('task.reopened')
    expect(seen[0].kinds).not.toContain('task.completed')
  })

  it('date changed: any of date, dateTime, due, dueTime', () => {
    save('Tasks/Buy milk.md', { type: 'task', created: '2026-09-01', due: '2026-09-30' })

    expect(seen[0].kinds).toContain('task.date-changed')
    expect(seen[0].changed).toEqual(['due'])
  })

  it('changed in its text only: task.changed with the body marked, no frontmatter keys', () => {
    save('Tasks/Buy milk.md', { type: 'task', created: '2026-09-01' }, 'two litres')

    expect(seen[0].kinds).toEqual(['task.changed', 'note.changed'])
    expect(seen[0].changed).toEqual([])
    expect(seen[0].bodyChanged).toBe(true)
  })

  it('created: announced once it settles, with the frontmatter it settled on', async () => {
    await app.vault.create('Tasks/New.md', '')
    app.emit('vault', 'create', file('Tasks/New.md'))
    // A template fills it a moment later.
    vi.advanceTimersByTime(300)
    save('Tasks/New.md', { type: 'task', created: '2026-09-24' })

    expect(seen).toHaveLength(0)
    vi.advanceTimersByTime(1000)

    expect(seen).toHaveLength(1)
    expect(seen[0].kinds).toEqual(['task.created', 'note.created'])
    expect(seen[0].before).toBeNull()
    expect(seen[0].after).toEqual({ type: 'task', created: '2026-09-24' })
  })

  it('created: a note that becomes a task counts as a task created', () => {
    save('Plain.md', { type: 'task' })

    expect(seen[0].kinds).toContain('task.created')
    expect(seen[0].changed).toEqual(['type'])
  })

  it('a note that stops being a task is no longer a task event', () => {
    save('Tasks/Buy milk.md', { type: 'note' })

    expect(seen[0].kinds).toEqual(['note.changed'])
  })
})

describe('a note', () => {
  it('changed: the properties that differ, added and removed', () => {
    save('Films/Heat.md', { type: 'movie', seen: true })

    expect(seen[0].kinds).toEqual(['note.changed'])
    expect(seen[0].changed.sort()).toEqual(['rating', 'seen'])
    expect(seen[0].type).toBe('movie')
  })

  it('a re-index that changed nothing is not an event', () => {
    save('Films/Heat.md', { type: 'movie', rating: 7 }, 'same')
    seen = []
    save('Films/Heat.md', { type: 'movie', rating: 7 }, 'same')

    expect(seen).toHaveLength(0)
  })

  it('renamed: old and new path, frontmatter carried over', async () => {
    const heat = file('Films/Heat.md')
    const { fileManager } = app as unknown as {
      fileManager: { renameFile: (file: TFile, to: string) => Promise<void> }
    }
    await fileManager.renameFile(heat, 'Films/Heat (1995).md')
    app.emit('vault', 'rename', heat, 'Films/Heat.md')

    expect(seen[0].kinds).toEqual(['note.renamed'])
    expect(seen[0].oldPath).toBe('Films/Heat.md')
    expect(seen[0].path).toBe('Films/Heat (1995).md')
    expect(seen[0].after).toEqual({ type: 'movie', rating: 7 })
    expect(seen[0].type).toBe('movie')

    // And the next change of it is compared against what it had.
    save('Films/Heat (1995).md', { type: 'movie', rating: 9 })
    expect(seen[1].before).toEqual({ type: 'movie', rating: 7 })
  })

  it('deleted: the frontmatter it had, type included', () => {
    app.emit('vault', 'delete', file('Films/Heat.md'))

    expect(seen[0].kinds).toEqual(['note.deleted'])
    expect(seen[0].before).toEqual({ type: 'movie', rating: 7 })
    expect(seen[0].after).toBeNull()
    expect(seen[0].type).toBe('movie')
  })

  it('created and deleted before it settled: nothing at all', async () => {
    await app.vault.create('Scratch.md', '')
    app.emit('vault', 'create', file('Scratch.md'))
    app.emit('vault', 'delete', file('Scratch.md'))
    vi.advanceTimersByTime(6000)

    expect(seen).toHaveLength(0)
  })

  it('ignores anything that is not a note', async () => {
    await app.vault.create('Scripts/run.js', '')
    app.emit('vault', 'create', file('Scripts/run.js'))
    vi.advanceTimersByTime(6000)

    expect(seen).toHaveLength(0)
  })
})

describe('where a change came from', () => {
  it('is asked of the origin source, chain included', () => {
    origins.set('Films/Heat.md', { origin: 'external', chain: ['r1'] })
    save('Films/Heat.md', { type: 'movie', rating: 8 })

    expect(seen[0].origin).toBe('external')
    expect(seen[0].chain).toEqual(['r1'])
  })

  it('for a new note, at the moment it was created', async () => {
    await app.vault.create('Films/New.md', '')
    origins.set('Films/New.md', { origin: 'external', chain: [] })
    app.emit('vault', 'create', file('Films/New.md'))
    origins.delete('Films/New.md')
    save('Films/New.md', { type: 'movie' })
    vi.advanceTimersByTime(1500)

    expect(seen[0].origin).toBe('external')
  })
})

describe('stopped', () => {
  it('hears nothing', () => {
    bus.stop()
    save('Films/Heat.md', { type: 'movie', rating: 1 })

    expect(seen).toHaveLength(0)
  })
})

describe('the diff itself', () => {
  it('compares values, not references, arrays and dates included', () => {
    expect(changedKeys({ a: [1, 2], b: 'x' }, { a: [1, 2], b: 'x' })).toEqual([])
    expect(changedKeys({ a: [1, 2] }, { a: [2, 1] })).toEqual(['a'])
    expect(changedKeys(null, { a: 1 })).toEqual(['a'])
  })

  it('a task created already completed is created, not completed', () => {
    expect(
      kindsFor({ created: true, before: null, after: { type: 'task', completed: '2026-01-01' } })
    ).toEqual(['task.created', 'note.created'])
  })
})
