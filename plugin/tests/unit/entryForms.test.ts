/**
 * What the task and transaction dialogs read from a note and write back to it.
 *
 * A form shows a note as a title and a description, and a handful of properties. Saving
 * writes exactly those and nothing else: a property the form does not show, or one it shows
 * empty, must come out of the save as it went in — or, when the form cleared it, gone.
 */
import { describe, it, expect } from 'vitest'
import {
  splitNoteBody,
  joinNoteBody,
  replaceNoteBody,
  applyFrontmatterPatch,
  taskFrontmatterPatch,
  transactionFrontmatterPatch,
  taskValuesToCreateDTO,
} from '@/helpers/entryForms'

describe('splitNoteBody', () => {
  it('takes the first line as the title and the rest as the description', () => {
    expect(splitNoteBody('Buy milk\nTwo litres\n\n- [ ] oat')).toEqual({
      title: 'Buy milk',
      description: 'Two litres\n\n- [ ] oat',
    })
  })

  it('skips blank lines before the title and between it and the description', () => {
    expect(splitNoteBody('\n\nBuy milk\n\n\nTwo litres\n')).toEqual({
      title: 'Buy milk',
      description: 'Two litres',
    })
  })

  it('reads an empty body as nothing at all', () => {
    expect(splitNoteBody('')).toEqual({ title: '', description: '' })
    expect(splitNoteBody('\n \n')).toEqual({ title: '', description: '' })
  })
})

describe('joinNoteBody', () => {
  it('puts the description under the title', () => {
    expect(joinNoteBody('Buy milk', 'Two litres')).toBe('Buy milk\nTwo litres\n')
  })

  it('writes a title alone when there is no description', () => {
    expect(joinNoteBody('Buy milk', '  \n')).toBe('Buy milk\n')
  })

  it('round-trips what it split', () => {
    const body = 'Buy milk\nTwo litres\n\n- [ ] oat\n'
    const { title, description } = splitNoteBody(body)
    expect(joinNoteBody(title, description)).toBe(body)
  })
})

describe('replaceNoteBody', () => {
  it('keeps the frontmatter block exactly as it was', () => {
    const raw = "---\ntype: task\nlabels:\n  - 'a'\n---\nOld\n"
    expect(replaceNoteBody(raw, 'New\n')).toBe("---\ntype: task\nlabels:\n  - 'a'\n---\nNew\n")
  })

  it('writes the body alone into a note without frontmatter', () => {
    expect(replaceNoteBody('Old\n', 'New\n')).toBe('New\n')
  })
})

describe('applyFrontmatterPatch', () => {
  it('sets what has a value, removes what is null and leaves everything else', () => {
    const fm: Record<string, unknown> = { type: 'task', date: '2026-01-01', labels: ['x'] }
    applyFrontmatterPatch(fm, { date: null, due: '2026-02-02' })
    expect(fm).toEqual({ type: 'task', labels: ['x'], due: '2026-02-02' })
  })
})

describe('taskFrontmatterPatch', () => {
  it('writes dates and times in the formats the task note uses', () => {
    expect(
      taskFrontmatterPatch({
        title: 'T',
        description: '',
        date: '2026-09-26',
        time: '14:30',
        due: '2026-09-30',
        dueTime: null,
        recurrence: 'every week',
      })
    ).toEqual({
      date: '2026-09-26',
      dateTime: '14:30',
      due: '2026-09-30',
      dueTime: null,
      recurrence: 'every week',
    })
  })

  it('drops a time that has no date to belong to', () => {
    const patch = taskFrontmatterPatch({
      title: 'T',
      description: '',
      date: null,
      time: '09:00',
      due: null,
      dueTime: '10:00',
      recurrence: null,
    })
    expect(patch.dateTime).toBeNull()
    expect(patch.dueTime).toBeNull()
  })
})

describe('taskValuesToCreateDTO', () => {
  it('carries the title, the body and the dates with their times', () => {
    const dto = taskValuesToCreateDTO({
      title: 'Call Anna',
      description: 'About [[Trip]]',
      date: '2026-09-26',
      time: '14:30',
      due: null,
      dueTime: null,
      recurrence: null,
    })
    expect(dto.title).toBe('Call Anna')
    expect(dto.content).toBe('Call Anna\nAbout [[Trip]]\n')
    expect(dto.date?.format('YYYY-MM-DD HH:mm')).toBe('2026-09-26 14:30')
    expect(dto.dateTime?.format('HH:mm')).toBe('14:30')
    expect(dto.due).toBeUndefined()
    expect(dto.recurrence).toBeUndefined()
  })

  it('names an untitled task the way a new task note is named', () => {
    const dto = taskValuesToCreateDTO({
      title: ' ',
      description: '',
      date: null,
      time: null,
      due: null,
      dueTime: null,
      recurrence: null,
    })
    expect(dto.title).toBe('New Task')
    expect(dto.content).toBe('')
  })
})

describe('transactionFrontmatterPatch', () => {
  it('writes the properties a transaction note carries, empty ones removed', () => {
    expect(
      transactionFrontmatterPatch({
        title: 'Coffee',
        description: '',
        date: '2026-09-26',
        from: '[[Card]]',
        to: '[[Cafe]]',
        amount: 3.5,
        currency: 'EUR',
        foreignAmount: null,
        foreignCurrency: null,
        category: '',
        groups: [],
      })
    ).toEqual({
      date: '2026-09-26',
      from: '[[Card]]',
      to: '[[Cafe]]',
      amount: 3.5,
      currency: 'EUR',
      foreignAmount: null,
      foreignCurrency: null,
      category: null,
      groups: null,
    })
  })
})
