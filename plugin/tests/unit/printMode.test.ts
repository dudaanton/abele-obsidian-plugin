import { afterEach, expect, it } from 'vitest'
import { isPrintMode } from '@/markdown/printMode'

afterEach(() => document.body.replaceChildren())

it.each(['workspace', 'app-container'])('ignores a note print class inside %s', (cls) => {
  const workspace = document.body.appendChild(document.createElement('div'))
  workspace.className = cls
  const note = workspace.appendChild(document.createElement('div'))
  note.className = 'print'
  expect(isPrintMode(note.appendChild(document.createElement('p')))).toBe(false)
})

it('recognizes only the closest print root directly under its own document body', () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  expect(isPrintMode(root)).toBe(true)
  const child = root.appendChild(document.createElement('p'))
  expect(isPrintMode(child)).toBe(true)
  child.className = 'print'
  expect(isPrintMode(child)).toBe(false)
  root.remove()
  expect(isPrintMode(root)).toBe(false)
})

it.each(['workspace', 'app-container'])(
  'rejects an export-shaped root that is itself %s',
  (cls) => {
    const root = document.body.appendChild(document.createElement('div'))
    root.className = `print ${cls}`
    expect(isPrintMode(root)).toBe(false)
  }
)
