import { expect, it } from 'vitest'
import {
  footerViewFrom,
  renameFooterView,
  setCalendarYear,
  calendarYearOf,
  setLogsCalendar,
} from '@/helpers/footerView'

it('keeps independent year views per note and section through reload and rename', () => {
  let state = setCalendarYear({}, 'Example.md', 'logs', true)
  state = setCalendarYear(state, 'Other.md', 'tasks', true)
  state = setLogsCalendar(state, 'Example.md', true)
  state = setLogsCalendar(state, 'Example.md', false)
  state = renameFooterView(
    footerViewFrom(JSON.parse(JSON.stringify(state))),
    'Example.md',
    'Moved.md'
  )
  expect(calendarYearOf(state, 'Moved.md', 'logs')).toBe(true)
  expect(calendarYearOf(state, 'Moved.md', 'tasks')).toBe(false)
  expect(calendarYearOf(state, 'Other.md', 'tasks')).toBe(true)
  expect(
    setCalendarYear(setCalendarYear(state, 'Moved.md', 'logs', false), 'Other.md', 'tasks', false)
  ).toEqual({})
})

it('ignores invalid stored year values', () => {
  expect(footerViewFrom({ 'Example.md': { logsYear: 'yes', tasksYear: 1 } })).toEqual({})
})
