import { expect, it } from 'vitest'
import { columnTableScroller } from '../e2e/helpers/columnsFixture'

it('finds a table overflow container and stops at its column boundary', () => {
  const column = document.createElement('div')
  const wrapper = document.createElement('div')
  const table = document.createElement('table')
  column.append(wrapper)
  wrapper.append(table)
  expect(columnTableScroller(table, column)).toBe(column)
  Object.defineProperty(wrapper, 'scrollWidth', { value: 300 })
  Object.defineProperty(wrapper, 'clientWidth', { value: 100 })
  expect(columnTableScroller(table, column)).toBe(wrapper)
})

it('fails loudly instead of spinning on a repeated ancestor or missing column', () => {
  const repeated = { parentElement: null, scrollWidth: 0, clientWidth: 0 } as unknown as HTMLElement
  Object.defineProperty(repeated, 'parentElement', { value: repeated })
  expect(() =>
    columnTableScroller({ parentElement: repeated } as HTMLElement, document.createElement('div'))
  ).toThrow('column table ancestor search exceeded 256 steps')
  expect(() =>
    columnTableScroller(document.createElement('table'), document.createElement('div'))
  ).toThrow('column table ancestor search reached no column')
})
