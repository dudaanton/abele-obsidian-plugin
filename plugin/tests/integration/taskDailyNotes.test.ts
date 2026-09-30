import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { NoteRelations } from '@/entities/NoteRelations'
import { Task } from '@/entities/Task'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, dailyJournal, useVault } from '../helpers/testEnv'

const DAY = 'Journals/2028/2028-02-01.md'
const PATH = 'Tasks/Plant basil.md'
let relations: NoteRelations | undefined
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  configureAbele({ journals: [dailyJournal()] })
})
afterEach(() => {
  relations?.cleanup()
  relations = undefined
  VaultWatcherWrapper.destroy()
  vi.unstubAllEnvs()
})

const setup = (props: Record<string, unknown>) => {
  const app = useVault([
    { path: DAY, frontmatter: { type: 'journal' } },
    { path: PATH, frontmatter: { type: 'task', ...props }, content: 'Plant basil' },
  ])
  relations = new NoteRelations(DAY)
  return app
}

describe('task membership in a daily note', () => {
  it.each([
    [{}, false],
    [{ created: '2028-02-01' }, true],
    [{ created: '2028-01-31', date: '2028-02-01' }, true],
    [{ created: '2028-02-01', date: '2028-02-02' }, false],
    [{ date: '2028-01-31', due: '2028-02-01' }, true],
    [{ date: '2028-02-01', due: '2028-02-02' }, false],
    [{ created: '2028-02-01', due: 'not-a-date' }, false],
    [{ created: '2028-02-01', due: '' }, false],
    [{ created: '2028-02-01', due: null }, true],
    [{ created: '2028-01-01', completed: '2028-02-01' }, false],
    [{ date: '2028-02-01', completed: '2028-02-02' }, true],
    [{ scheduled: '2028-02-01', start: '2028-02-01' }, false],
  ])('uses due, then date, then created for %j → %s', (props, belongs) => {
    setup(props)
    expect(relations.tasks.has(PATH)).toBe(belongs)
  })

  it('keeps membership through completion and undo (the disappearing-footer regression)', () => {
    const app = setup({ date: '2028-02-01' })
    const file = app.vault.getFileByPath(PATH)!
    for (const completed of ['2028-02-02', undefined, '2028-03-01']) {
      app.setFrontmatter(PATH, { type: 'task', date: '2028-02-01', completed })
      app.emit('metadataCache', 'changed', file)
      app.emit('metadataCache', 'resolved')
      expect(relations.tasks.has(PATH)).toBe(true)
      const reopened = new NoteRelations(DAY)
      expect([...relations.tasks.keys()]).toEqual([...reopened.tasks.keys()])
      reopened.cleanup()
    }
  })

  it('distinguishes the daily-note endpoint rule from card range membership and sort date', () => {
    setup({ date: '2028-01-31', due: '2028-02-02' })
    expect(relations.tasks.has(PATH)).toBe(false)
    const task = new Task({
      wikilink: '[[Plant basil]]',
      date: dayjs('2028-01-31'),
      due: dayjs('2028-02-02'),
    })
    expect(task.isTaskRelatedToDate(dayjs('2028-02-01'))).toBe(true)
    expect(task.getTaskDate()?.format('YYYY-MM-DD')).toBe('2028-01-31')
    task.cleanup()
  })
})
