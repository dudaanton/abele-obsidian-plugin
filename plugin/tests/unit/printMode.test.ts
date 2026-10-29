import { afterEach, expect, it } from 'vitest'
import { isPrintMode, markPrintRoot } from '@/markdown/printMode'

afterEach(() => document.body.replaceChildren())

it.each(['workspace', 'app-container'])('ignores a note print class inside %s', (cls) => {
  const workspace = document.body.appendChild(document.createElement('div'))
  workspace.className = cls
  const note = workspace.appendChild(document.createElement('div'))
  note.className = 'print'
  expect(isPrintMode(note.appendChild(document.createElement('p')))).toBe(false)
})

it('recognizes a print root directly under its own document body through nested print classes', () => {
  const root = document.body.appendChild(document.createElement('div'))
  root.className = 'print'
  expect(isPrintMode(root)).toBe(true)
  const child = root.appendChild(document.createElement('p'))
  expect(isPrintMode(child)).toBe(true)
  child.className = 'print'
  expect(isPrintMode(child)).toBe(true)
  root.remove()
  expect(isPrintMode(root)).toBe(false)
})

it('keeps explicitly trusted detached render containers in print mode', () => {
  const detached = document.createElement('div')
  detached.className = 'print'
  const child = detached.appendChild(document.createElement('p'))
  expect(isPrintMode(child)).toBe(false)
  markPrintRoot(detached)
  expect(isPrintMode(detached)).toBe(true)
  expect(isPrintMode(child)).toBe(true)
  detached.classList.remove('print')
  expect(isPrintMode(child)).toBe(true)
  expect(isPrintMode(document.createElement('div'))).toBe(false)
})

it.each(['workspace', 'app-container'])(
  'rejects an export-shaped root that is itself %s',
  (cls) => {
    const root = document.body.appendChild(document.createElement('div'))
    root.className = `print ${cls}`
    expect(isPrintMode(root)).toBe(false)
  }
)
